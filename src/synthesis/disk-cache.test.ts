import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DiskCache } from "./disk-cache";
import { ChunkAudio } from "./provider";

const audio = (n: number, fill = 65): ChunkAudio => ({
  audio: new Uint8Array(n).fill(fill),
  format: "mp3",
  timings: { unit: "ms", words: [{ wordIndex: 0, start: 0, end: 100 }] },
});

describe("DiskCache", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "speakittome-cache-")); });

  it("round-trips audio and timings", async () => {
    const cache = new DiskCache(dir, 1024 * 1024);
    const key = DiskCache.makeKey("hello", "edge", "aria");
    await cache.set(key, audio(100));
    const got = await cache.get(key);
    expect(got?.format).toBe("mp3");
    expect(got?.audio.length).toBe(100);
    expect(got?.timings.words[0].end).toBe(100);
  });

  it("returns undefined on miss", async () => {
    const cache = new DiskCache(dir, 1024);
    expect(await cache.get("nope")).toBeUndefined();
  });

  it("evicts least-recently-used entries beyond the byte cap", async () => {
    const cache = new DiskCache(dir, 250);
    await cache.set("a", audio(100));
    await cache.set("b", audio(100));
    await cache.get("a");                 // a now more recent than b
    await cache.set("c", audio(100));     // exceeds 250 → evict b
    expect(await cache.get("a")).toBeDefined();
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBeDefined();
  });

  it("survives a new instance over the same dir (persistence)", async () => {
    const c1 = new DiskCache(dir, 1024 * 1024);
    await c1.set("k", audio(50));
    const c2 = new DiskCache(dir, 1024 * 1024);
    expect((await c2.get("k"))?.audio.length).toBe(50);
  });
});
