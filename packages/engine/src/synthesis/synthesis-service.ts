import { Chunk } from "../core/chunker";
import { ChunkAudio, TtsProvider } from "./provider";
import { DiskCache } from "./disk-cache";

interface CacheLike {
  get(key: string): Promise<ChunkAudio | undefined>;
  set(key: string, value: ChunkAudio): Promise<void>;
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
        try {
          const key = DiskCache.makeKey(job.chunk.text, this.provider.id, this.voice);
          const cached = await this.cache?.get(key);
          if (cached) { job.resolve(cached); continue; }
          let result: ChunkAudio;
          try {
            result = await this.provider.synthesize(job.chunk, this.voice, this.controller.signal);
          } catch (first) {
            if (this.controller.signal.aborted) throw first;
            result = await this.provider.synthesize(job.chunk, this.voice, this.controller.signal);
          }
          await this.cache?.set(key, result);
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
