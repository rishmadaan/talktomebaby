import { describe, it, expect, vi } from "vitest";
import { speakText } from "./agent-voice";
import { DEFAULT_CONFIG } from "./config";

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

  it("never throws and reports ok:false when the sink fails", async () => {
    const res = await speakText("hello", { ...DEFAULT_CONFIG }, {
      synthesizeAndPlay: async () => { throw new Error("boom"); },
    });
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for empty text without calling the sink", async () => {
    const sink = vi.fn();
    const res = await speakText("   ", { ...DEFAULT_CONFIG }, { synthesizeAndPlay: sink });
    expect(res.ok).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });
});
