/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { describe, it, expect, vi } from "vitest";
import { SynthesisService } from "./synthesis-service";
import { ChunkAudio, TtsProvider } from "./provider";
import { Chunk } from "../core/chunker";

const mkChunk = (i: number): Chunk => ({ index: i, text: `chunk ${i}`, sentenceIndexes: [i], words: [] });
const mkAudio = (): ChunkAudio => ({ audio: new Uint8Array(4), format: "mp3", timings: { unit: "ms", words: [] } });

function mockProvider(log: number[], delayMs = 5): TtsProvider {
  return {
    id: "mock", label: "Mock", requiresKey: false, timingQuality: "exact",
    maxCharsPerRequest: 9999, defaultVoice: "v",
    listVoices: async () => [],
    synthesize: vi.fn(async (chunk: Chunk) => {
      log.push(chunk.index);
      await new Promise((r) => setTimeout(r, delayMs));
      return mkAudio();
    }),
  };
}

describe("SynthesisService", () => {
  it("dedupes concurrent requests for the same chunk", async () => {
    const log: number[] = [];
    const svc = new SynthesisService(mockProvider(log), "v");
    const [a, b] = await Promise.all([svc.request(mkChunk(0)), svc.request(mkChunk(0))]);
    expect(a).toBe(b);
    expect(log).toEqual([0]);
  });

  it("priority requests jump the queue", async () => {
    const log: number[] = [];
    const svc = new SynthesisService(mockProvider(log), "v");
    const p0 = svc.request(mkChunk(0));            // starts immediately
    const p1 = svc.request(mkChunk(1));
    const p2 = svc.request(mkChunk(2));
    const p9 = svc.request(mkChunk(9), true);      // priority — should run before 1 and 2
    await Promise.all([p0, p1, p2, p9]);
    expect(log[0]).toBe(0);
    expect(log[1]).toBe(9);
  });

  it("uses the cache when provided", async () => {
    const log: number[] = [];
    const stored = new Map<string, ChunkAudio>();
    const cache = {
      get: async (k: string) => stored.get(k),
      set: async (k: string, v: ChunkAudio) => void stored.set(k, v),
    };
    const svc = new SynthesisService(mockProvider(log), "v", cache);
    await svc.request(mkChunk(0));
    const svc2 = new SynthesisService(mockProvider(log), "v", cache);
    await svc2.request(mkChunk(0));
    expect(log).toEqual([0]); // second service hit the cache
  });

  it("abortAll rejects queued work", async () => {
    const log: number[] = [];
    const svc = new SynthesisService(mockProvider(log, 50), "v");
    const p0 = svc.request(mkChunk(0));
    const p1 = svc.request(mkChunk(1));
    svc.abortAll();
    await expect(p1).rejects.toThrow();
    await p0.catch(() => {}); // in-flight may reject too; either is fine
  });

  it("does not retry a job that abortAll cancelled", async () => {
    const synthesize = vi.fn((_c: Chunk, _v: string, signal: AbortSignal) =>
      new Promise<ChunkAudio>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const svc = new SynthesisService({ ...mockProvider([]), synthesize }, "v");
    const p = svc.request(mkChunk(0));
    await new Promise((r) => setTimeout(r, 0));
    svc.abortAll();
    await expect(p).rejects.toThrow("aborted");
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("cached timings light the requesting chunk's own words, not the ones they were made for", async () => {
    const store = new Map<string, ChunkAudio>();
    const cache = { get: async (k: string) => store.get(k), set: async (k: string, v: ChunkAudio) => { store.set(k, v); } };
    const at = (index: number, first: number): Chunk => ({ index, text: "Hello there.", sentenceIndexes: [0], words: [
      { wordIndex: first, charStart: 0, charEnd: 5 }, { wordIndex: first + 1, charStart: 6, charEnd: 12 }] });
    const provider = { ...mockProvider([]), synthesize: vi.fn(async (c: Chunk) => ({
      audio: new Uint8Array(4), format: "mp3" as const,
      timings: { unit: "ms" as const, words: c.words.map((w, i) => ({ wordIndex: w.wordIndex, start: i * 100, end: i * 100 + 90 })) },
    })) };
    const svc = new SynthesisService(provider, "v", cache);
    await svc.request(at(0, 342));
    // The same text after an edit above it: word numbers moved by one.
    const hit = await svc.request(at(1, 343));
    expect(provider.synthesize).toHaveBeenCalledTimes(1);
    expect(hit.timings.words.map((w) => w.wordIndex)).toEqual([343, 344]);
  });
});
