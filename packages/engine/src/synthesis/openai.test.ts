import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "./openai";
import { Chunk } from "../core/chunker";

const chunk: Chunk = { index: 0, text: "Hello world.", sentenceIndexes: [0], words: [] };

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIProvider", () => {
  it("has the expected static descriptor", () => {
    const p = new OpenAIProvider("k");
    expect(p.id).toBe("openai");
    expect(p.requiresKey).toBe(true);
    expect(p.timingQuality).toBe("estimated");
    expect(p.defaultVoice).toBe("alloy");
  });

  it("lists known OpenAI voices including alloy", async () => {
    const ids = (await new OpenAIProvider("k").listVoices()).map((v) => v.id);
    expect(ids).toContain("alloy");
    expect(ids).toContain("nova");
  });

  it("POSTs to the speech endpoint and returns mp3 audio with estimated timings", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await new OpenAIProvider("secret").synthesize(chunk, "nova", new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.headers.authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-4o-mini-tts", input: "Hello world.", voice: "nova", response_format: "mp3" });
    expect(out.format).toBe("mp3");
    expect(Array.from(out.audio)).toEqual([1, 2, 3, 4]);
    expect(out.timings.words).toBeDefined();
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key" })));
    await expect(new OpenAIProvider("k").synthesize(chunk, "alloy", new AbortController().signal)).rejects.toThrow(/OpenAI 401/);
  });
});
