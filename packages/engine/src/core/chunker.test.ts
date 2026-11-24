/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { describe, it, expect } from "vitest";
import { buildChunks, Chunk } from "./chunker";
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

  it("does not give a heading after the start sentence a chunk of its own", () => {
    const md = parseDocument(["Intro one. Intro two.", "# Setup", longPara(1), longPara(2)].join("\n\n"), "h.md", 1);
    const heading = md.sentences[2];
    expect(heading.text).toBe("Setup");
    const chunks = buildChunks(md, 2200, 1400, md.sentences[1].words[0].index);
    const at = chunks.findIndex((c) => c.sentenceIndexes[0] === 1);
    expect(chunks[at].sentenceIndexes).toEqual([1]);
    expect(chunks[at + 1].text).toBe(["Setup", longPara(1)].join(" "));
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

  describe("a long start sentence opens with a short head", () => {
    // 395 characters, one sentence, inside a document of several plain chunks.
    const longSentence =
      "When the committee finally met on Tuesday, after three postponements and a long exchange of letters about the venue, the budget, the agenda and who should chair it, " +
      "the members agreed that the report would be rewritten from the beginning, that every figure in it would be checked twice by someone who had not worked on it, " +
      "and that nothing would be published until the board had read it in full.";
    const text = [longPara(0), longPara(1), `Intro sentence here. ${longSentence} After it comes this one.`,
      ...Array.from({ length: 10 }, (_, p) => longPara(p + 2))].join("\n\n");
    const m = parseDocument(text, "s.txt", 1);
    const ls = m.sentences.find((s) => s.text === longSentence)!;
    const plain = buildChunks(m);
    const holding = (c: Chunk[], wordIndex: number) => c.findIndex((x) => x.words.some((r) => r.wordIndex === wordIndex));
    // Every word once, in order, each indexing its own chunk's text; the chunks after
    // `upTo` are the plain plan's last ones, text for text.
    const sound = (chunks: Chunk[], upTo: number) => {
      for (const c of chunks) for (const r of c.words) expect(c.text.slice(r.charStart, r.charEnd)).toBe(m.words[r.wordIndex].text);
      expect(chunks.flatMap((c) => c.words.map((r) => r.wordIndex))).toEqual(m.words.map((w) => w.index));
      const tail = chunks.slice(upTo + 1).map((c) => c.text);
      expect(tail.length).toBeGreaterThan(0);
      expect(tail).toEqual(plain.slice(-tail.length).map((c) => c.text));
    };

    it("from its first word: a head of at most 160 characters, then the rest opens the ramp", () => {
      const chunks = buildChunks(m, 2200, 1400, ls.words[0].index);
      const h = holding(chunks, ls.words[0].index);
      expect(chunks[h].text).toBe("When the committee finally met on Tuesday, after three postponements and a long exchange of letters about the venue, the budget, the agenda and who should chair");
      expect(chunks[h].text.length).toBeLessThanOrEqual(160);
      expect(chunks[h - 1].text.endsWith("Intro sentence here.")).toBe(true); // no chunk of the words before it
      expect(chunks[h].sentenceIndexes).toEqual([ls.index]);
      expect(chunks[h + 1].text.startsWith("it, the members agreed")).toBe(true);
      expect(chunks[h + 1].sentenceIndexes.slice(0, 2)).toEqual([ls.index, ls.index + 1]);
      expect(chunks[h + 1].text.length).toBeLessThanOrEqual(500);
      expect([chunks[h].text, chunks[h + 1].text].join(" ")).toBe(`${longSentence} After it comes this one.`);
      sound(chunks, h + 2);
    });

    it("from a word mid-sentence: the words before it, then a head from that word, then the rest", () => {
      const start = ls.words[12]; // "long"
      const chunks = buildChunks(m, 2200, 1400, start.index);
      const h = holding(chunks, start.index);
      expect(chunks[h - 1].text).toBe("When the committee finally met on Tuesday, after three postponements and a");
      expect(chunks[h - 1].sentenceIndexes).toEqual([ls.index]);
      expect(chunks[h].words[0].wordIndex).toBe(start.index); // the first audio holds the chosen word
      expect(chunks[h].text).toBe("long exchange of letters about the venue, the budget, the agenda and who should chair it, the members agreed that the report would be rewritten from the");
      expect(chunks[h + 1].text.startsWith("beginning, that every figure")).toBe(true);
      // The rest follows the 500 ramp: as full as it gets before the next sentence would overflow it.
      const rest = chunks[h + 1];
      expect(rest.text.length).toBeLessThanOrEqual(500);
      expect(rest.text.length + 1 + m.sentences[rest.sentenceIndexes.at(-1)! + 1].text.length).toBeGreaterThan(500);
      expect(`${chunks[h - 1].text} ${chunks[h].text} ${rest.text}`.startsWith(longSentence)).toBe(true);
      sound(chunks, h + 2);
    });

    it("keeps today's plan when at most 200 characters are left from the start word", () => {
      const pos: number[] = [];
      for (let q = 0, k = 0; k < ls.words.length; k++) { q = longSentence.indexOf(ls.words[k].text, q); pos.push(q); q += ls.words[k].text.length; }
      const k = pos.findIndex((p) => longSentence.length - p <= 200); // the first word with at most 200 left
      const whole = (c: Chunk[]) => c.some((x) => x.text === longSentence);
      expect(whole(buildChunks(m, 2200, 1400, ls.words[k].index))).toBe(true);
      expect(whole(buildChunks(m, 2200, 1400, ls.words[k - 1].index))).toBe(false);
    });

    it("splits at 201 characters from the start word, not at 200", () => {
      const doc = (n: number) => parseDocument(`Intro. ${"abcd ".repeat(39)}${"e".repeat(n - 196)}.`, "b.txt", 1);
      const whole = (n: number) => buildChunks(doc(n), 2200, 1400, 1).map((c) => c.text).includes(doc(n).sentences[1].text);
      expect(doc(200).sentences[1].text.length).toBe(200);
      expect(whole(200)).toBe(true);
      expect(whole(201)).toBe(false);
    });

    it("a read from the top keeps its plan, even with a long first sentence", () => {
      const top = parseDocument(`${longSentence}\n\nShort one. Another short one.`, "top.txt", 1);
      expect(buildChunks(top, 2200, 1400, 0).map((c) => c.text)).toEqual([longSentence, "Short one. Another short one."]);
    });

    it("a head is at least one word, however long that word", () => {
      const url = `https://example.com/${"a".repeat(180)}`;
      const d = parseDocument(`Intro. See ${url} for the full list of every change made to the parser this year and the reasons for each.`, "u.txt", 1);
      const start = d.words.find((w) => w.text === url)!;
      const chunks = buildChunks(d, 2200, 1400, start.index);
      expect(chunks.map((c) => c.text)).toEqual(["Intro.", "See", url, "for the full list of every change made to the parser this year and the reasons for each."]);
    });

    it("a long last word as the start leaves no rest, so the sentence stays whole", () => {
      const url = `https://example.com/${"a".repeat(200)}`;
      const d = parseDocument(`Intro. See ${url}`, "u.txt", 1);
      const chunks = buildChunks(d, 2200, 1400, d.words.find((w) => w.text === url)!.index);
      expect(chunks.map((c) => c.text)).toEqual(["Intro.", `See ${url}`]);
    });

    it("the CLI's plan (no start word) never splits a sentence", () => {
      expect(plain.flatMap((c) => c.sentenceIndexes)).toEqual(m.sentences.map((s) => s.index));
      expect(plain.some((c) => c.text.includes(longSentence))).toBe(true);
    });
  });
});
