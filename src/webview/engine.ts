import { DocumentModel } from "../core/document-model";
import { Chunk } from "../core/chunker";
import { ChunkTimings } from "../core/timing";

export interface AudioLike {
  currentTime: number; duration: number; playbackRate: number; preservesPitch: boolean;
  paused: boolean; src: string;
  onended: (() => void) | null;
  onloadedmetadata: (() => void) | null;
  play(): Promise<void>; pause(): void;
}

export interface EngineCallbacks {
  requestChunk(chunkIndex: number, priority: boolean): void;
  onPosition(wordIndex: number, sentenceIndex: number): void;
  onState(state: "playing" | "paused" | "ended"): void;
  createAudio(): AudioLike;
  makeUrl(audio: Uint8Array, format: string): string;
  revokeUrl(url: string): void;
}

interface LoadedChunk {
  audio: AudioLike; url: string;
  timingsMs: { wordIndex: number; start: number; end: number }[] | null; // null until duration known (fraction unit)
  rawTimings: ChunkTimings;
}

const PREFETCH = 2;

export class Engine {
  private loaded = new Map<number, LoadedChunk>();
  private currentChunk = 0;
  private currentWord = -1;
  private speed = 1;
  private playing = false;
  private pendingJumpWord: number | null = null;
  private wordToSentence = new Map<number, number>();
  private wordToChunk = new Map<number, number>();
  private sentenceFirstWord = new Map<number, number>();

  constructor(
    private model: DocumentModel,
    private chunks: Chunk[],
    private cb: EngineCallbacks
  ) {
    for (const s of model.sentences) {
      if (s.words.length) this.sentenceFirstWord.set(s.index, s.words[0].index);
      for (const w of s.words) this.wordToSentence.set(w.index, s.index);
    }
    for (const c of chunks) for (const ref of c.words) this.wordToChunk.set(ref.wordIndex, c.index);
  }

  start(chunkIndex: number) {
    this.currentChunk = chunkIndex;
    this.playing = true;
    this.cb.requestChunk(chunkIndex, true);
    this.prefetch(chunkIndex + 1);
  }

  private prefetch(from: number) {
    for (let i = from; i < Math.min(from + PREFETCH, this.chunks.length); i++) {
      if (!this.loaded.has(i)) this.cb.requestChunk(i, false);
    }
  }

  receiveChunk(chunkIndex: number, data: { audio: Uint8Array; format: string; timings: ChunkTimings }) {
    if (this.loaded.has(chunkIndex)) return;
    const url = this.cb.makeUrl(data.audio, data.format);
    const audio = this.cb.createAudio();
    audio.preservesPitch = true;
    audio.playbackRate = this.speed;
    audio.src = url;
    const lc: LoadedChunk = {
      audio, url, rawTimings: data.timings,
      timingsMs: data.timings.unit === "ms" ? data.timings.words : null,
    };
    audio.onloadedmetadata = () => {
      if (lc.timingsMs === null) {
        const durMs = audio.duration * 1000;
        lc.timingsMs = data.timings.words.map((w) => ({
          wordIndex: w.wordIndex, start: w.start * durMs, end: w.end * durMs,
        }));
      }
      this.maybeStartChunk(chunkIndex);
    };
    audio.onended = () => this.handoff(chunkIndex);
    this.loaded.set(chunkIndex, lc);
    // happy path for fakes/tests where metadata may already be known
    if (!Number.isNaN(audio.duration)) audio.onloadedmetadata?.();
  }

  private maybeStartChunk(chunkIndex: number) {
    if (!this.playing || chunkIndex !== this.currentChunk) return;
    const lc = this.loaded.get(chunkIndex);
    if (!lc || lc.timingsMs === null) return;
    if (this.pendingJumpWord !== null) {
      const t = lc.timingsMs.find((w) => w.wordIndex === this.pendingJumpWord);
      lc.audio.currentTime = t ? t.start / 1000 : 0;
      this.pendingJumpWord = null;
    }
    void lc.audio.play();
    this.cb.onState("playing");
  }

  private handoff(endedChunk: number) {
    if (endedChunk !== this.currentChunk) return;
    const next = this.currentChunk + 1;
    if (next >= this.chunks.length) {
      this.playing = false;
      this.cb.onState("ended");
      return;
    }
    this.currentChunk = next;
    this.prefetch(next + 1);
    const lc = this.loaded.get(next);
    if (lc && lc.timingsMs !== null) {
      lc.audio.currentTime = 0;
      void lc.audio.play();
      this.cb.onState("playing");
    } else {
      this.cb.requestChunk(next, true);
    }
  }

  pause() {
    const lc = this.loaded.get(this.currentChunk);
    lc?.audio.pause();
    this.playing = false;
    this.cb.onState("paused");
  }

  resume() {
    this.playing = true;
    const sentence = this.wordToSentence.get(Math.max(this.currentWord, 0)) ?? 0;
    const firstWord = this.sentenceFirstWord.get(sentence);
    if (firstWord !== undefined) this.jumpToWord(firstWord);
    else this.maybeStartChunk(this.currentChunk);
  }

  jumpToWord(wordIndex: number) {
    const chunkIndex = this.wordToChunk.get(wordIndex);
    if (chunkIndex === undefined) return;
    const prev = this.loaded.get(this.currentChunk);
    prev?.audio.pause();
    this.currentChunk = chunkIndex;
    this.currentWord = wordIndex;
    this.playing = true;
    const lc = this.loaded.get(chunkIndex);
    if (lc && lc.timingsMs !== null) {
      const t = lc.timingsMs.find((w) => w.wordIndex === wordIndex);
      lc.audio.currentTime = t ? t.start / 1000 : 0;
      void lc.audio.play();
      this.cb.onState("playing");
      this.prefetch(chunkIndex + 1);
    } else {
      this.pendingJumpWord = wordIndex;
      this.cb.requestChunk(chunkIndex, true);
      this.prefetch(chunkIndex + 1);
    }
  }

  setSpeed(rate: number) {
    this.speed = rate;
    for (const lc of this.loaded.values()) lc.audio.playbackRate = rate;
  }

  stop() {
    for (const lc of this.loaded.values()) {
      lc.audio.pause();
      this.cb.revokeUrl(lc.url);
    }
    this.loaded.clear();
    this.playing = false;
  }

  // Called on a ~100ms interval by main.ts; resolves current word from audio time.
  tick() {
    const lc = this.loaded.get(this.currentChunk);
    if (!lc || lc.timingsMs === null) return;
    const ms = lc.audio.currentTime * 1000;
    let word = -1;
    for (const w of lc.timingsMs) {
      if (ms >= w.start) word = w.wordIndex;
      else break;
    }
    if (word >= 0 && word !== this.currentWord) {
      this.currentWord = word;
      this.cb.onPosition(word, this.wordToSentence.get(word) ?? 0);
    }
  }

  get isPlaying() { return this.playing; }
  get currentSentence() { return this.wordToSentence.get(Math.max(this.currentWord, 0)) ?? 0; }
}
