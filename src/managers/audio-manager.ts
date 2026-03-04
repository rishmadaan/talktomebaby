import * as vscode from "vscode";
import { ITtsProvider, TtsOptions } from "../providers/tts-provider";
import { AudioCache } from "../utils/cache";
import { SentenceInfo } from "../utils/text-parser";

const log = vscode.window.createOutputChannel("Read TTS", { log: true });

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

    await this.playNextSentence();
  }

  async playNextSentence() {
    log.info(`playNextSentence: index=${this.currentIndex}, total=${this.sentences.length}, provider=${this.provider?.name}`);
    if (!this.provider || this.currentIndex >= this.sentences.length) {
      log.info("playNextSentence: done (no provider or end of sentences)");
      this.setState("idle");
      this.currentIndex = -1;
      return;
    }

    if (this.abortController?.signal.aborted) {
      log.info("playNextSentence: aborted");
      return;
    }

    const sentence = this.sentences[this.currentIndex];
    log.info(`playNextSentence: sentence="${sentence.text.slice(0, 60)}..."`);
    this._onEvent.fire({
      type: "sentenceChange",
      sentenceIndex: this.currentIndex,
    });

    this.setState("loading");

    try {
      const config = vscode.workspace.getConfiguration("read-tts");
      const voice = config.get<string>("voice") || this.provider.defaultVoice;
      const speed = config.get<number>("speed") ?? 1.0;
      const options: TtsOptions = { voice, speed };

      // Check cache
      const cacheKey = AudioCache.makeKey(
        sentence.text,
        this.provider.name,
        voice
      );
      let result = this.cache.get(cacheKey);

      if (!result) {
        log.info(`Calling ${this.provider.name} API for sentence ${this.currentIndex}...`);
        // Chunk text if it exceeds provider limit
        const text = sentence.text.slice(
          0,
          this.provider.maxCharsPerRequest
        );
        result = await this.provider.synthesize(text, options);
        log.info(`API returned ${result.audioBuffer.length} bytes (${result.format})`);
        this.cache.set(cacheKey, result);
      } else {
        log.info(`Cache hit for sentence ${this.currentIndex}`);
      }

      if (this.abortController?.signal.aborted) {
        log.info("playNextSentence: aborted after API call");
        return;
      }

      // Send audio to webview for playback
      this.setState("playing");
      const base64 = result.audioBuffer.toString("base64");
      const dataUrl = `data:audio/${result.format};base64,${base64}`;
      log.info(`Sending playAudio to webview (${base64.length} chars base64)`);

      this.webviewProvider?.postMessage({
        command: "playAudio",
        audioUrl: dataUrl,
        sentenceText: sentence.text,
        sentenceIndex: this.currentIndex,
        totalSentences: this.sentences.length,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      log.error(`TTS Error: ${message}`);
      this._onEvent.fire({ type: "error", error: message });
      this.setState("idle");
      vscode.window.showErrorMessage(`TTS Error: ${message}`);
    }
  }

  // Called by webview when audio finishes playing
  onAudioEnded() {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.currentIndex++;
    this.playNextSentence();
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

  dispose() {
    this.stop();
    this.cache.clear();
    this._onEvent.dispose();
  }
}
