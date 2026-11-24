/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { Chunk } from "../core/chunker";
import { ChunkAudio, TtsProvider } from "./provider";
import { DiskCache } from "./disk-cache";

interface CacheLike {
  get(key: string): Promise<ChunkAudio | undefined>;
  set(key: string, value: ChunkAudio): Promise<void>;
}

// Cached timings name each word by its position inside the chunk, never by its
// document word index: after an edit above it (or in another file) the same
// text has different word indexes and must light its own words.
function toCached(chunk: Chunk, a: ChunkAudio): ChunkAudio {
  const ordinal = new Map(chunk.words.map((w, k) => [w.wordIndex, k]));
  const words = a.timings.words.flatMap((w) => {
    const k = ordinal.get(w.wordIndex);
    return k === undefined ? [] : [{ ...w, wordIndex: k }];
  });
  return { ...a, timings: { ...a.timings, words } };
}

/** The cached audio with timings mapped onto `chunk`'s words, or undefined if they do not fit. */
function fromCached(chunk: Chunk, a: ChunkAudio): ChunkAudio | undefined {
  if (a.timings.words.some((w) => w.wordIndex >= chunk.words.length)) return undefined;
  const words = a.timings.words.map((w) => ({ ...w, wordIndex: chunk.words[w.wordIndex].wordIndex }));
  return { ...a, timings: { ...a.timings, words } };
}

interface Job {
  chunk: Chunk;
  priority: boolean;
  seq: number;
  resolve: (a: ChunkAudio) => void;
  reject: (e: Error) => void;
}

export class SynthesisService {
  private inFlight = new Map<number, Promise<ChunkAudio>>();
  private queue: Job[] = [];
  private working = false;
  private seq = 0;
  private controller = new AbortController();

  constructor(
    private provider: TtsProvider,
    private voice: string,
    private cache?: CacheLike
  ) {}

  request(chunk: Chunk, priority = false): Promise<ChunkAudio> {
    const existing = this.inFlight.get(chunk.index);
    if (existing) {
      if (priority) this.bump(chunk.index);
      return existing;
    }
    const promise = new Promise<ChunkAudio>((resolve, reject) => {
      this.queue.push({ chunk, priority, seq: this.seq++, resolve, reject });
      this.queue.sort((a, b) =>
        a.priority !== b.priority ? (a.priority ? -1 : 1) : a.seq - b.seq
      );
    });
    this.inFlight.set(chunk.index, promise);
    promise.catch(() => {}).finally(() => this.inFlight.delete(chunk.index));
    void this.work();
    return promise;
  }

  private bump(chunkIndex: number) {
    const job = this.queue.find((j) => j.chunk.index === chunkIndex);
    if (job) {
      job.priority = true;
      this.queue.sort((a, b) =>
        a.priority !== b.priority ? (a.priority ? -1 : 1) : a.seq - b.seq
      );
    }
  }

  abortAll() {
    this.controller.abort();
    this.controller = new AbortController();
    for (const job of this.queue.splice(0)) job.reject(new Error("aborted"));
  }

  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        // Captured per job: abortAll() swaps the controller, and a retry must not
        // pick up the fresh signal and synthesize cancelled work again.
        const signal = this.controller.signal;
        try {
          const key = DiskCache.makeKey(job.chunk.text, this.provider.id, this.voice);
          const hit = await this.cache?.get(key);
          const cached = hit && fromCached(job.chunk, hit);
          if (cached) { job.resolve(cached); continue; }
          let result: ChunkAudio;
          try {
            result = await this.provider.synthesize(job.chunk, this.voice, signal);
          } catch (first) {
            if (signal.aborted) throw first;
            result = await this.provider.synthesize(job.chunk, this.voice, signal);
          }
          await this.cache?.set(key, toCached(job.chunk, result));
          job.resolve(result);
        } catch (err) {
          job.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      this.working = false;
    }
  }
}
