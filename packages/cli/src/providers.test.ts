import { describe, it, expect, afterEach } from "vitest";
import { makeProvider } from "./providers";

afterEach(() => { delete process.env.OPENAI_API_KEY; });

describe("makeProvider", () => {
  it("builds keyless providers", () => {
    expect(makeProvider("edge").id).toBe("edge");
    expect(makeProvider("say").id).toBe("say");
  });
  it("builds a keyed provider when the env key is present", () => {
    process.env.OPENAI_API_KEY = "k";
    expect(makeProvider("openai").id).toBe("openai");
  });
  it("throws a clear error when a required key is missing", () => {
    expect(() => makeProvider("elevenlabs")).toThrow(/Missing API key for elevenlabs/);
  });
  it("falls back to edge for an unknown id", () => {
    expect(makeProvider("nope").id).toBe("edge");
  });
});
