import { describe, it, expect, vi } from "vitest";
import { speakText, splitAtProviderLimit } from "./agent-voice";
import { DEFAULT_CONFIG } from "./config";

describe("splitAtProviderLimit", () => {
  it("passes small chunks through and hard-splits oversized ones at word boundaries", () => {
    const chunk = { index: 0, text: "word ".repeat(100).trim(), sentenceIndexes: [0], words: [] };
    expect(splitAtProviderLimit([chunk], 1000)).toHaveLength(1);
    const split = splitAtProviderLimit([chunk], 120);
    expect(split.length).toBeGreaterThan(1);
    for (const c of split) expect(c.text.length).toBeLessThanOrEqual(120);
    expect(split.map((c) => c.text).join(" ")).toBe(chunk.text); // nothing lost
  });
});

describe("speakText", () => {
  it("cleans markdown and plays each chunk via the injected sink", async () => {
    const played: string[] = [];
    const res = await speakText("# Hi\n\nthis is a [test](http://x).", { ...DEFAULT_CONFIG, provider: "edge" }, {
      synthesizeAndPlay: async (chunks) => { for (const c of chunks) played.push(c.text); },
    });
    expect(res.ok).toBe(true);
    expect(res.spoken).toContain("Hi");
    expect(res.spoken).not.toMatch(/[#\[\]]/);
    expect(played.join(" ")).toContain("test");
  });

  it("never throws and reports ok:false with the reason when the sink fails", async () => {
    const res = await speakText("hello", { ...DEFAULT_CONFIG }, {
      synthesizeAndPlay: async () => { throw new Error("boom"); },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("boom");
  });

  it("returns ok:false for empty text without calling the sink", async () => {
    const sink = vi.fn();
    const res = await speakText("   ", { ...DEFAULT_CONFIG }, { synthesizeAndPlay: sink });
    expect(res.ok).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });
});
