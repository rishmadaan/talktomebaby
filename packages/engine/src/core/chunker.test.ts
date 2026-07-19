import { describe, it, expect } from "vitest";
import { buildChunks } from "./chunker";
import { parseDocument } from "./document-model";

const para = (n: number) => Array(12).fill(`Sentence number ${n} fills space.`).join(" ");
const doc = parseDocument([para(1), "", para(2), "", para(3)].join("\n"), "t.txt", 1);

describe("buildChunks", () => {
  it("never splits a sentence across chunks", () => {
    const chunks = buildChunks(doc, 400, 200);
    const all = chunks.flatMap((c) => c.sentenceIndexes);
    expect(all).toEqual([...Array(doc.sentences.length).keys()]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("chunk text is sentences joined with single spaces", () => {
    const chunks = buildChunks(doc, 400, 200);
    const c = chunks[0];
    expect(c.text).toBe(c.sentenceIndexes.map((i) => doc.sentences[i].text).join(" "));
  });

  it("word refs carry correct char offsets into chunk text", () => {
    const chunks = buildChunks(doc, 400, 200);
    for (const c of chunks) {
      for (const ref of c.words) {
        const w = doc.words[ref.wordIndex];
        expect(c.text.slice(ref.charStart, ref.charEnd)).toBe(w.text);
      }
    }
  });

  it("respects maxChars except for single oversized sentences", () => {
    const chunks = buildChunks(doc, 400, 200);
    for (const c of chunks) {
      if (c.sentenceIndexes.length > 1) expect(c.text.length).toBeLessThanOrEqual(400);
    }
  });
});
