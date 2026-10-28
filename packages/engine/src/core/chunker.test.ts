/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { describe, it, expect } from "vitest";
import { buildChunks } from "./chunker";
import { parseDocument } from "./document-model";

const para = (n: number) => Array(12).fill(`Sentence number ${n} fills space.`).join(" ");
const doc = parseDocument([para(1), "", para(2), "", para(3)].join("\n"), "t.txt", 1);
// 20 paragraphs of 12 distinct sentences (about 420 chars each): several plain chunks.
const longPara = (p: number) => Array.from({ length: 12 }, (_, j) => `Paragraph ${p} line ${j} fills space.`).join(" ");
const long = parseDocument(Array.from({ length: 20 }, (_, p) => longPara(p)).join("\n\n"), "long.txt", 1);

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

  it("opens a short first chunk at the start sentence, then ramps up", () => {
    const start = long.sentences[53];
    const chunks = buildChunks(long, 2200, 1400, start.words[2].index);
    const first = chunks.findIndex((c) => c.sentenceIndexes[0] === 53);
    expect(chunks[first].sentenceIndexes).toEqual([53]);
    expect(chunks[first + 1].text.length).toBeLessThanOrEqual(500);
    expect(chunks[first + 2].text.length).toBeLessThanOrEqual(1000);
    expect(chunks.flatMap((c) => c.sentenceIndexes)).toEqual([...Array(long.sentences.length).keys()]);
  });

  describe("from a start word, rejoins the plain plan (so later chunks stay cache hits)", () => {
    const plain = buildChunks(long);
    const holding = (si: number) => plain.findIndex((c) => c.sentenceIndexes.includes(si));
    const plan = (si: number) => buildChunks(long, 2200, 1400, long.sentences[si].words[0].index);

    it("keeps the plain chunks after the start sentence's own plain chunk, text for text", () => {
      for (const si of [53, 58]) { // two starts inside the same plain chunk, with plenty of it left
        const k = holding(si);
        expect(plain[k].sentenceIndexes.at(-1)! - si).toBeGreaterThan(20);
        const chunks = plan(si);
        const after = plain.slice(k + 1).map((c) => c.text);
        expect(chunks.slice(-after.length).map((c) => c.text)).toEqual(after);
        expect(chunks.slice(0, k).map((c) => c.text)).toEqual(plain.slice(0, k).map((c) => c.text));
        expect(chunks.find((c) => c.sentenceIndexes[0] === si)!.sentenceIndexes).toEqual([si]);
        expect(chunks.flatMap((c) => c.sentenceIndexes)).toEqual([...Array(long.sentences.length).keys()]);
      }
    });

    it("splits the next plain chunk too when little of the start's chunk is left", () => {
      const k = holding(53);
      const si = plain[k].sentenceIndexes.at(-1)!; // last sentence: nothing of its chunk is left
      const chunks = plan(si);
      const at = chunks.findIndex((c) => c.sentenceIndexes[0] === si);
      expect(chunks[at].sentenceIndexes).toEqual([si]);
      expect(chunks[at + 1].sentenceIndexes[0]).toBe(plain[k + 1].sentenceIndexes[0]);
      expect(chunks[at + 1].text.length).toBeLessThanOrEqual(500);
      expect(chunks[at + 1].text + " " + chunks[at + 2].text).toBe(plain[k + 1].text);
      const after = plain.slice(k + 2).map((c) => c.text);
      expect(chunks.slice(at + 3).map((c) => c.text)).toEqual(after);
      expect(chunks.flatMap((c) => c.sentenceIndexes)).toEqual([...Array(long.sentences.length).keys()]);
    });
  });

  it("starts fast from the top when asked to start at word 0", () => {
    expect(buildChunks(doc, 2200, 1400, 0)[0].sentenceIndexes).toEqual([0]);
  });

  it("without a start word, keeps the plain plan: a short reply is one chunk", () => {
    const reply = parseDocument("Done. I fixed the bug in the parser and added a test. All tests pass now.", "r", 1);
    const chunks = buildChunks(reply);
    expect(chunks.map((c) => c.text)).toEqual(["Done. I fixed the bug in the parser and added a test. All tests pass now."]);
  });
});
