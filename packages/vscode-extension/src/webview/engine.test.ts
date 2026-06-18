import { describe, it, expect, vi } from "vitest";
import { Engine, AudioLike, EngineCallbacks } from "./engine";
import { DocumentModel } from "../core/document-model";
import { Chunk } from "../core/chunker";
import { ChunkTimings } from "../core/timing";

class FakeAudio implements AudioLike {
  currentTime = 0; duration = NaN; playbackRate = 1; preservesPitch = true;
  paused = true; src = "";
  onended: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  _loaded(durationSec: number) { this.duration = durationSec; this.onloadedmetadata?.(); }
  _ended() { this.onended?.(); }
}

// Minimal 2-chunk session: words 0-1 in chunk 0, words 2-3 in chunk 1; one sentence per chunk
const model = {
  uri: "t", version: 1, blocks: [],
  sentences: [
    { index: 0, text: "a b.", source: { start: 0, end: 4 }, words: [
      { index: 0, text: "a", source: { start: 0, end: 1 } },
      { index: 1, text: "b.", source: { start: 2, end: 4 } } ] },
    { index: 1, text: "c d.", source: { start: 5, end: 9 }, words: [
      { index: 2, text: "c", source: { start: 5, end: 6 } },
      { index: 3, text: "d.", source: { start: 7, end: 9 } } ] },
  ],
  words: [] as DocumentModel["words"],
} as DocumentModel;
model.words = model.sentences.flatMap((s) => s.words);

const chunks: Chunk[] = [
  { index: 0, text: "a b.", sentenceIndexes: [0], words: [
    { wordIndex: 0, charStart: 0, charEnd: 1 }, { wordIndex: 1, charStart: 2, charEnd: 4 } ] },
  { index: 1, text: "c d.", sentenceIndexes: [1], words: [
    { wordIndex: 2, charStart: 0, charEnd: 1 }, { wordIndex: 3, charStart: 2, charEnd: 4 } ] },
];
const msTimings: ChunkTimings = { unit: "ms", words: [
  { wordIndex: 0, start: 0, end: 400 }, { wordIndex: 1, start: 500, end: 900 } ] };
const msTimings2: ChunkTimings = { unit: "ms", words: [
  { wordIndex: 2, start: 0, end: 400 }, { wordIndex: 3, start: 500, end: 900 } ] };

function setup() {
  const audios: FakeAudio[] = [];
  const cb: EngineCallbacks = {
    requestChunk: vi.fn(), onPosition: vi.fn(), onState: vi.fn(),
    createAudio: () => { const a = new FakeAudio(); audios.push(a); return a; },
    makeUrl: () => "blob:x", revokeUrl: vi.fn(),
  };
  const engine = new Engine(model, chunks, cb);
  return { engine, audios, cb };
}

describe("Engine", () => {
  it("requests the first chunk and the next ones ahead on start", () => {
    const { engine, cb } = setup();
    engine.start(0);
    expect(cb.requestChunk).toHaveBeenCalledWith(0, true);
    expect(cb.requestChunk).toHaveBeenCalledWith(1, false);
  });

  it("plays when audio arrives, hands off to preloaded next chunk on ended", () => {
    const { engine, audios, cb } = setup();
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: msTimings });
    audios[0]._loaded(1.0);
    expect(audios[0].paused).toBe(false);
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    audios[0]._ended();
    const second = audios.find((a) => a !== audios[0] && !a.paused);
    expect(second).toBeTruthy();
    expect(cb.onState).toHaveBeenLastCalledWith("playing");
  });

  it("resume restarts the current sentence", () => {
    const { engine, audios } = setup();
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: msTimings });
    audios[0]._loaded(1.0);
    audios[0].currentTime = 0.7;   // inside word 1, sentence 0 starts at 0ms
    engine.tick();                  // updates current word from time
    engine.pause();
    engine.resume();
    expect(audios[0].currentTime).toBe(0); // sentence start
    expect(audios[0].paused).toBe(false);
  });

  it("jumpToWord in an unloaded chunk requests it with priority and plays on arrival", () => {
    const { engine, audios, cb } = setup();
    engine.start(0);
    engine.jumpToWord(2);
    expect(cb.requestChunk).toHaveBeenCalledWith(1, true);
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    const a = audios[audios.length - 1];
    a._loaded(1.0);
    expect(a.paused).toBe(false);
    expect(a.currentTime).toBe(0); // word 2 starts at 0ms in chunk 1
  });

  it("setSpeed applies to current and future audio", () => {
    const { engine, audios } = setup();
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: msTimings });
    audios[0]._loaded(1.0);
    engine.setSpeed(1.75);
    expect(audios[0].playbackRate).toBe(1.75);
  });

  it("primeAt loads and seeks the target word but does NOT play (paused start)", () => {
    const { engine, audios, cb } = setup();
    engine.primeAt(2); // word 2 lives in chunk 1
    expect(cb.requestChunk).toHaveBeenCalledWith(1, true);
    expect(cb.onState).toHaveBeenLastCalledWith("paused");
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    const a = audios[audios.length - 1];
    a._loaded(1.0);
    expect(a.paused).toBe(true);          // primed, not playing
    expect(a.currentTime).toBe(0);        // seeked to word 2 (starts at 0ms)
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentSentence).toBe(1);
  });

  it("primeAt then resume plays from the primed word's sentence", () => {
    const { engine, audios, cb } = setup();
    engine.primeAt(2);
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    const a = audios[audios.length - 1];
    a._loaded(1.0);
    expect(a.paused).toBe(true);
    engine.resume();                      // resume from the primed position
    expect(a.paused).toBe(false);
    expect(a.currentTime).toBe(0);        // sentence 1 starts at word 2 (0ms)
    expect(cb.onState).toHaveBeenLastCalledWith("playing");
  });

  it("primeAt seeks to a mid-chunk word and primes paused there", () => {
    const { engine, audios } = setup();
    engine.primeAt(3); // word 3 in chunk 1, starts at 500ms
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    const a = audios[audios.length - 1];
    a._loaded(1.0);
    expect(a.paused).toBe(true);
    expect(a.currentTime).toBeCloseTo(0.5); // 500ms
  });

  it("resolves fraction timings to ms once duration is known", () => {
    const { engine, audios, cb } = setup();
    const frac: ChunkTimings = { unit: "fraction", words: [
      { wordIndex: 0, start: 0, end: 0.4 }, { wordIndex: 1, start: 0.5, end: 1 } ] };
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: frac });
    audios[0]._loaded(2.0); // 2s → word 1 starts at 1000ms
    audios[0].currentTime = 1.2;
    engine.tick();
    expect(cb.onPosition).toHaveBeenLastCalledWith(1, 0);
  });
});
