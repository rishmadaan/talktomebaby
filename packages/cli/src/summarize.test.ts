import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete process.env.GEMINI_API_KEY; delete process.env.OPENAI_API_KEY; });

describe("limitForModel", () => {
  it("keeps both the head and the tail of an over-long reply", async () => {
    const { limitForModel } = await import("./summarize");
    const text = "START " + "x".repeat(20000) + " what should I do next?";
    const out = limitForModel(text);
    expect(out.length).toBeLessThanOrEqual(12000 + 30);
    expect(out.startsWith("START")).toBe(true);
    expect(out.endsWith("what should I do next?")).toBe(true);
  });
});

describe("summarize", () => {
  it("returns null when no summarizer key is set", async () => {
    const { summarize } = await import("./summarize");
    expect(await summarize("hello")).toBeNull();
  });
  it("uses Gemini when GEMINI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "g";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "digest" }] } }] }) })));
    const { summarize } = await import("./summarize");
    expect(await summarize("long text")).toEqual({ text: "digest", provider: "gemini" });
  });
});
