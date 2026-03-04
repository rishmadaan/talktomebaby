import { createHash } from "crypto";
import { AudioResult } from "../providers/tts-provider";

const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB

interface CacheEntry {
  result: AudioResult;
  size: number;
  lastAccessed: number;
}

export class AudioCache {
  private cache = new Map<string, CacheEntry>();
  private totalSize = 0;

  static makeKey(text: string, provider: string, voice: string): string {
    const hash = createHash("sha256")
      .update(`${text}|${provider}|${voice}`)
      .digest("hex")
      .slice(0, 16);
    return hash;
  }

  get(key: string): AudioResult | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.result;
    }
    return undefined;
  }

  set(key: string, result: AudioResult): void {
    const size = result.audioBuffer.length;

    // Evict oldest entries if we'd exceed max size
    while (this.totalSize + size > MAX_CACHE_SIZE && this.cache.size > 0) {
      this.evictOldest();
    }

    // Don't cache if single entry exceeds max
    if (size > MAX_CACHE_SIZE) return;

    const existing = this.cache.get(key);
    if (existing) {
      this.totalSize -= existing.size;
    }

    this.cache.set(key, { result, size, lastAccessed: Date.now() });
    this.totalSize += size;
  }

  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get memoryUsage(): number {
    return this.totalSize;
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.totalSize -= entry.size;
      this.cache.delete(oldestKey);
    }
  }
}
