import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete process.env.GEMINI_API_KEY; delete process.env.OPENAI_API_KEY; });

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
