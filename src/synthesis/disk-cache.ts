import { createHash } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import { ChunkAudio } from "./provider";
import { ChunkTimings } from "../core/timing";

interface Meta { format: "mp3" | "wav"; timings: ChunkTimings; size: number; lastAccess: number }

export class DiskCache {
  private accessClock = 0;

  constructor(private dir: string, private maxBytes: number) {}

  static makeKey(text: string, providerId: string, voiceId: string): string {
    return createHash("sha256").update(`${text} ${providerId} ${voiceId}`).digest("hex").slice(0, 24);
  }

  private binPath(key: string) { return join(this.dir, `${key}.bin`); }
  private metaPath(key: string) { return join(this.dir, `${key}.json`); }

  async get(key: string): Promise<ChunkAudio | undefined> {
    try {
      const meta: Meta = JSON.parse(await fs.readFile(this.metaPath(key), "utf8"));
      const audio = new Uint8Array(await fs.readFile(this.binPath(key)));
      meta.lastAccess = Date.now() + ++this.accessClock;
      await fs.writeFile(this.metaPath(key), JSON.stringify(meta));
      return { audio, format: meta.format, timings: meta.timings };
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: ChunkAudio): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const meta: Meta = {
      format: value.format, timings: value.timings,
      size: value.audio.byteLength, lastAccess: Date.now() + ++this.accessClock,
    };
    await fs.writeFile(this.binPath(key), Buffer.from(value.audio));
    await fs.writeFile(this.metaPath(key), JSON.stringify(meta));
    await this.evictIfNeeded();
  }

  private async evictIfNeeded(): Promise<void> {
    let entries: { key: string; meta: Meta }[] = [];
    try {
      const files = await fs.readdir(this.dir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const key = f.slice(0, -5);
        try { entries.push({ key, meta: JSON.parse(await fs.readFile(this.metaPath(key), "utf8")) }); }
        catch { entries.push({ key, meta: { format: "mp3", timings: { unit: "ms", words: [] }, size: 0, lastAccess: 0 } }); }
      }
    } catch { return; }
    let total = entries.reduce((n, e) => n + e.meta.size, 0);
    if (total <= this.maxBytes) return;
    entries.sort((a, b) => a.meta.lastAccess - b.meta.lastAccess);
    for (const e of entries) {
      if (total <= this.maxBytes) break;
      await fs.rm(this.binPath(e.key), { force: true });
      await fs.rm(this.metaPath(e.key), { force: true });
      total -= e.meta.size;
    }
  }
}
