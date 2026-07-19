import { describe, it, expect } from "vitest";
import { stripMarkdown, firstParagraph, capLength, cleanForSpeech } from "./clean-text";

describe("clean-text", () => {
  it("strips fenced code to a placeholder", () => {
    expect(stripMarkdown("a\n```\ncode\n```\nb")).toContain("code block omitted");
  });
  it("keeps link text, drops the url", () => {
    expect(stripMarkdown("see [docs](http://x)")).toBe("see docs");
  });
  it("removes heading and bullet markers", () => {
    expect(stripMarkdown("# Title\n- one\n- two")).not.toMatch(/[#*]/);
  });
  it("firstParagraph returns up to the first blank line", () => {
    expect(firstParagraph("one\n\ntwo")).toBe("one");
  });
  it("capLength truncates at a word boundary with an ellipsis", () => {
    const out = capLength("alpha beta gamma delta", 12);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(14);
  });
  it("cleanForSpeech full pipeline applies scope", () => {
    expect(cleanForSpeech("# H\n\nsecond", { scope: "first-paragraph", maxChars: 4000 })).toBe("H");
  });
});
