import { describe, it, expect, vi } from "vitest";
import { VoiceCache } from "./voice-cache";
import { VoiceInfo } from "./provider";

const VOICES: VoiceInfo[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }];

describe("VoiceCache", () => {
  it("reports miss then hit around set()", () => {
    const cache = new VoiceCache();
    expect(cache.has("edge")).toBe(false);
    expect(cache.get("edge")).toBeUndefined();
    cache.set("edge", VOICES);
    expect(cache.has("edge")).toBe(true);
    expect(cache.get("edge")).toEqual(VOICES);
  });

  it("resolve fetches once on a miss, then serves cached without re-fetching", async () => {
    const cache = new VoiceCache();
    const fetcher = vi.fn().mockResolvedValue(VOICES);
    const first = await cache.resolve("edge", fetcher);
    const second = await cache.resolve("edge", fetcher);
    expect(first).toEqual(VOICES);
    expect(second).toEqual(VOICES);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch (allows retry)", async () => {
    const cache = new VoiceCache();
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(VOICES);
    await expect(cache.resolve("edge", fetcher)).rejects.toThrow("network");
    expect(cache.has("edge")).toBe(false);
    const voices = await cache.resolve("edge", fetcher);
    expect(voices).toEqual(VOICES);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keys voices per provider independently", () => {
    const cache = new VoiceCache();
    cache.set("edge", VOICES);
    expect(cache.has("elevenlabs")).toBe(false);
    cache.set("elevenlabs", [{ id: "x", label: "X" }]);
    expect(cache.get("edge")).toEqual(VOICES);
    expect(cache.get("elevenlabs")).toEqual([{ id: "x", label: "X" }]);
  });

  it("invalidate removes a cached entry so the next resolve re-fetches", async () => {
    const cache = new VoiceCache();
    const fetcher = vi.fn().mockResolvedValue(VOICES);

    // Populate the cache.
    await cache.resolve("elevenlabs", fetcher);
    expect(cache.has("elevenlabs")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Invalidate — the entry should disappear.
    cache.invalidate("elevenlabs");
    expect(cache.has("elevenlabs")).toBe(false);
    expect(cache.get("elevenlabs")).toBeUndefined();

    // The next resolve should fetch again.
    const voices = await cache.resolve("elevenlabs", fetcher);
    expect(voices).toEqual(VOICES);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate on a provider with no cached entry is a no-op", () => {
    const cache = new VoiceCache();
    expect(() => cache.invalidate("sarvam")).not.toThrow();
    expect(cache.has("sarvam")).toBe(false);
  });
});
