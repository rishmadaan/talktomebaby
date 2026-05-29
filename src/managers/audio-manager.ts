import * as vscode from "vscode";
import { AudioResult, ITtsProvider, TtsOptions } from "../providers/tts-provider";
import { AudioCache } from "../utils/cache";
import { SentenceInfo } from "../utils/text-parser";

const log = vscode.window.createOutputChannel("Read TTS", { log: true });
const PREFETCH_AHEAD = 2;

export type PlaybackState = "idle" | "playing" | "paused" | "loading";

interface PlaybackEvent {
  type: "sentenceChange" | "stateChange" | "error";
  sentenceIndex?: number;
  state?: PlaybackState;
  error?: string;
}

export class AudioManager {
  private cache = new AudioCache();
  private provider: ITtsProvider | undefined;
  private sentences: SentenceInfo[] = [];
  private currentIndex = -1;
  private state: PlaybackState = "idle";
  private abortController: AbortController | undefined;
  private playbackId = 0;
  private inFlight = new Map<number, Promise<AudioResult>>();

  private _onEvent = new vscode.EventEmitter<PlaybackEvent>();
  readonly onEvent = this._onEvent.event;

  private webviewProvider:
    | { postMessage(msg: unknown): void }
    | undefined;

  setProvider(provider: ITtsProvider) {
    this.provider = provider;
  }

  setWebviewProvider(wp: { postMessage(msg: unknown): void }) {
    this.webviewProvider = wp;
  }

  getSentences(): SentenceInfo[] {
    return this.sentences;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getState(): PlaybackState {
    return this.state;
  }

  async startPlayback(
    sentences: SentenceInfo[],
    startIndex: number = 0
  ) {
    if (!this.provider) {
      throw new Error("No TTS provider configured. Use Read: Set API Key first.");
    }

    this.stop();
    this.sentences = sentences;
    this.currentIndex = startIndex;
    this.abortController = new AbortController();
    this.playbackId++;

    await this.playCurrentSentence();
  }

  async playCurrentSentence() {
    const runId = this.playbackId;
    const index = this.currentIndex;
    log.info(`playCurrentSentence: index=${index}, total=${this.sentences.length}, provider=${this.provider?.name}`);
    if (!this.provider || this.currentIndex >= this.sentences.length) {
      log.info("playCurrentSentence: done (no provider or end of sentences)");
      this.setState("idle");
      this.currentIndex = -1;
      return;
    }

    if (this.abortController?.signal.aborted) {
      log.info("playCurrentSentence: aborted");
      return;
    }

    const sentence = this.sentences[index];
    log.info(`playCurrentSentence: sentence="${sentence.text.slice(0, 60)}..."`);
    this.setState("loading");

    try {
      const audioPromise = this.getAudioForSentence(index);
      this.prefetchAround(index + 1);
      const result = await audioPromise;

      if (
        this.abortController?.signal.aborted ||
        runId !== this.playbackId ||
        index !== this.currentIndex
      ) {
        log.info("playCurrentSentence: stale or aborted after API call");
        return;
      }

      // Send audio to webview for playback
      this._onEvent.fire({
        type: "sentenceChange",
        sentenceIndex: index,
      });
      this.setState("playing");
      const base64 = result.audioBuffer.toString("base64");
      const dataUrl = `data:audio/${result.format};base64,${base64}`;
      log.info(`Sending playAudio to webview (${base64.length} chars base64)`);

      this.webviewProvider?.postMessage({
        command: "playAudio",
        playbackId: runId,
        audioUrl: dataUrl,
        sentenceText: sentence.text,
        sentenceIndex: index,
        totalSentences: this.sentences.length,
      });
      this.prefetchAround(index + 1);
    } catch (err: unknown) {
      if (runId !== this.playbackId || this.abortController?.signal.aborted) {
        return;
      }
      const message =
        err instanceof Error ? err.message : String(err);
      log.error(`TTS Error: ${message}`);
      this._onEvent.fire({ type: "error", error: message });
      this.setState("idle");
      vscode.window.showErrorMessage(`TTS Error: ${message}`);
    }
  }

  // Called by webview when audio finishes playing
  onAudioEnded(sentenceIndex?: number, playbackId?: number) {
    if (this.state !== "playing" && this.state !== "paused") return;
    if (
      playbackId !== undefined &&
      playbackId !== this.playbackId
    ) {
      return;
    }
    if (
      sentenceIndex !== undefined &&
      sentenceIndex !== this.currentIndex
    ) {
      return;
    }
    this.currentIndex++;
    this.playCurrentSentence();
  }

  seekPrevious() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.playbackId++;
      this.inFlight.clear();
      this.webviewProvider?.postMessage({ command: "stop" });
      this.prefetchAround(this.currentIndex);
      this.playCurrentSentence();
    }
  }

  pauseResume() {
    if (this.state === "playing") {
      this.setState("paused");
      this.webviewProvider?.postMessage({ command: "pause" });
    } else if (this.state === "paused") {
      this.setState("playing");
      this.webviewProvider?.postMessage({ command: "resume" });
    }
  }

  stop() {
    this.abortController?.abort();
    this.abortController = undefined;
    this.playbackId++;
    this.inFlight.clear();
    this.setState("idle");
    this.currentIndex = -1;
    this.sentences = [];
    this.webviewProvider?.postMessage({ command: "stop" });
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      entries: this.cache.size,
      memoryMB: Math.round(this.cache.memoryUsage / 1024 / 1024 * 10) / 10,
    };
  }

  private setState(state: PlaybackState) {
    this.state = state;
    this._onEvent.fire({ type: "stateChange", state });
  }

  private prefetchAround(startIndex: number) {
    if (!this.provider || this.abortController?.signal.aborted) return;

    const endIndex = Math.min(
      this.sentences.length,
      startIndex + PREFETCH_AHEAD
    );
    for (let index = startIndex; index < endIndex; index++) {
      if (index < 0 || this.inFlight.has(index)) continue;
      this.getAudioForSentence(index).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Prefetch failed for sentence ${index}: ${message}`);
      });
    }
  }

  private getAudioForSentence(index: number): Promise<AudioResult> {
    const existing = this.inFlight.get(index);
    if (existing) {
      return existing;
    }

    const promise = this.loadAudioForSentence(index).finally(() => {
      this.inFlight.delete(index);
    });
    this.inFlight.set(index, promise);
    return promise;
  }

  private async loadAudioForSentence(index: number): Promise<AudioResult> {
    if (!this.provider) {
      throw new Error("No TTS provider configured. Use Read: Set API Key first.");
    }

    const sentence = this.sentences[index];
    if (!sentence) {
      throw new Error(`Sentence ${index} is no longer available.`);
    }

    const config = vscode.workspace.getConfiguration("read-tts");
    const voice = config.get<string>("voice") || this.provider.defaultVoice;
    const speed = config.get<number>("speed") ?? 1.0;
    const options: TtsOptions = { voice, speed };

    const cacheKey = AudioCache.makeKey(
      sentence.text,
      this.provider.name,
      voice,
      speed
    );
    const cached = this.cache.get(cacheKey);
    if (cached) {
      log.info(`Cache hit for sentence ${index}`);
      return cached;
    }

    log.info(`Calling ${this.provider.name} API for sentence ${index}...`);
    const text = sentence.text.slice(0, this.provider.maxCharsPerRequest);
    const result = await this.provider.synthesize(text, options);
    log.info(`API returned ${result.audioBuffer.length} bytes (${result.format})`);
    this.cache.set(cacheKey, result);
    return result;
  }

  dispose() {
    this.stop();
    this.cache.clear();
    this._onEvent.dispose();
  }
}
