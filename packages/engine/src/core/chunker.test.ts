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

  describe("a long start sentence is read in cells", () => {
    // 395 characters, one sentence, inside a document of several plain chunks.
    const longSentence =
      "When the committee finally met on Tuesday, after three postponements and a long exchange of letters about the venue, the budget, the agenda and who should chair it, " +
      "the members agreed that the report would be rewritten from the beginning, that every figure in it would be checked twice by someone who had not worked on it, " +
      "and that nothing would be published until the board had read it in full.";
    // Its cells: each at most 160 chars, cut after a word ending in a comma where that keeps 64.
    const cells = [
      "When the committee finally met on Tuesday, after three postponements and a long exchange of letters about the venue, the budget,",
      "the agenda and who should chair it, the members agreed that the report would be rewritten from the beginning,",
      "that every figure in it would be checked twice by someone who had not worked on it, and that nothing would be published until the board had read it in full.",
    ];
    const text = [longPara(0), longPara(1), `Intro sentence here. ${longSentence} After it comes this one.`,
      ...Array.from({ length: 10 }, (_, p) => longPara(p + 2))].join("\n\n");
    const m = parseDocument(text, "s.txt", 1);
    const ls = m.sentences.find((s) => s.text === longSentence)!;
    const plain = buildChunks(m);
    const holding = (c: Chunk[], wordIndex: number) => c.findIndex((x) => x.words.some((r) => r.wordIndex === wordIndex));
    // Every word once, in order, each indexing its own chunk's text.
    const sound = (chunks: Chunk[], d = m) => {
      for (const c of chunks) for (const r of c.words) expect(c.text.slice(r.charStart, r.charEnd)).toBe(d.words[r.wordIndex].text);
      expect(chunks.flatMap((c) => c.words.map((r) => r.wordIndex))).toEqual(d.words.map((w) => w.index));
    };
    // The start sentence's chunks joined back into one: the plan as it was before cells.
    const merged = (chunks: Chunk[], si: number) => chunks.reduce<{ text: string; sentenceIndexes: number[] }[]>((out, c) => {
      const prev = out.at(-1);
      if (prev && c.sentenceIndexes.join() === `${si}` && prev.sentenceIndexes.join() === `${si}`) prev.text += ` ${c.text}`;
      else out.push({ text: c.text, sentenceIndexes: c.sentenceIndexes });
      return out;
    }, []);

    it("from every start word: the chunk holding it is its cell, the same texts within a cell, and every other chunk as before", () => {
      const byCell = new Map<string, string[]>();
      const outside = new Set<string>();
      for (const w of ls.words) {
        const chunks = buildChunks(m, 2200, 1400, w.index);
        sound(chunks);
        const cell = chunks[holding(chunks, w.index)].text;
        expect(cells).toContain(cell);
        const texts = chunks.map((c) => c.text);
        if (byCell.has(cell)) expect(texts).toEqual(byCell.get(cell)); // a restart in the same cell: every text a cache hit
        else byCell.set(cell, texts);
        // The sentence's chunks: the cells before, the cell, the next cell, the cells after that; no empty one.
        const own = chunks.filter((c) => c.sentenceIndexes.join() === `${ls.index}`).map((c) => c.text);
        const c = cells.indexOf(cell);
        expect(own).toEqual([cells.slice(0, c).join(" "), cell, cells[c + 1], cells.slice(c + 2).join(" ")].filter(Boolean));
        // Joined back, the plan is ea2f5b2's for a start in this sentence: [0..24] [25] then the 500/1000 ramp and the plain tail.
        const back = merged(chunks, ls.index);
        expect(back.map((x) => [x.sentenceIndexes[0], x.sentenceIndexes.at(-1)])).toEqual([[0, 24], [25, 25], [26, 38], [39, 50], [51, 86], [87, 134], [135, 146]]);
        expect(back[1].text).toBe(longSentence);
        outside.add(JSON.stringify(chunks.filter((x) => !x.sentenceIndexes.includes(ls.index)).map((x) => x.text)));
      }
      expect([...byCell.keys()]).toEqual(cells);
      expect(outside.size).toBe(1); // no chunk outside the sentence depends on the start word
      const tail = JSON.parse([...outside][0]) as string[];
      expect(tail.slice(-2)).toEqual(plain.slice(-2).map((c) => c.text));
    });

    it("a start in the first cell has no chunk of words before it; in the last cell, none after it", () => {
      const first = buildChunks(m, 2200, 1400, ls.words[1].index).map((c) => c.text);
      const c0 = first.indexOf(cells[0]);
      expect(first[c0 - 1].endsWith("Intro sentence here.")).toBe(true);
      expect(first.slice(c0 + 1, c0 + 3)).toEqual([cells[1], cells[2]]);
      expect(first[c0 + 3].startsWith("After it comes this one.")).toBe(true);
      const last = buildChunks(m, 2200, 1400, ls.words.at(-1)!.index).map((c) => c.text);
      const at = last.indexOf(cells[2]);
      expect(last[at - 1]).toBe(`${cells[0]} ${cells[1]}`);
      expect(last[at + 1].startsWith("After it comes this one.")).toBe(true);
    });

    it("the cell after the start word's cell is a chunk alone; the cells after that are joined", () => {
      // 600 characters in four cells: w000..w031, w032..w063, w064..w095 (159 each), w096..w119. (120).
      const ws = (a: number, b: number) => Array.from({ length: b - a }, (_, q) => `w${String(a + q).padStart(3, "0")}`).join(" ");
      const d = parseDocument(`Intro. ${ws(0, 120)}.`, "w.txt", 1);
      const cell = [ws(0, 32), ws(32, 64), ws(64, 96), `${ws(96, 120)}.`];
      const plan = (w: number) => { const chunks = buildChunks(d, 2200, 1400, d.sentences[1].words[w].index); sound(chunks, d); return chunks.map((c) => c.text); };
      for (const w of [0, 31]) expect(plan(w)).toEqual(["Intro.", cell[0], cell[1], `${cell[2]} ${cell[3]}`]); // first cell
      for (const w of [64, 95]) expect(plan(w)).toEqual(["Intro.", `${cell[0]} ${cell[1]}`, cell[2], cell[3]]); // last-but-one: no joined rest
      expect(plan(32)).toEqual(["Intro.", cell[0], cell[1], cell[2], cell[3]]);
    });

    it("a cell ends after a comma only while it keeps at least 64 characters", () => {
      // "A b…b," is exactly 64 (or 63) characters; the words after it carry no comma.
      const tail = Array.from({ length: 40 }, (_, q) => `word${q}`).join(" ");
      const firstCell = (bs: number) => {
        const d = parseDocument(`Intro. A ${"b".repeat(bs)}, ${tail}.`, "c.txt", 1);
        const chunks = buildChunks(d, 2200, 1400, d.sentences[1].words[0].index);
        sound(chunks, d);
        return chunks[1].text;
      };
      expect(firstCell(61)).toBe(`A ${"b".repeat(61)},`);           // 64: cut after the comma
      expect(firstCell(60).startsWith(`A ${"b".repeat(60)}, word0`)).toBe(true); // 63: the comma is not a cut
      expect(firstCell(60).length).toBeLessThanOrEqual(160);
    });

    it("a single word longer than 160 characters is a cell by itself, first in the sentence or not", () => {
      const url = `https://example.com/${"a".repeat(150)}`; // 170
      const rest = "is where the full list of every change made to the parser this year lives, with the reasons for each.";
      const d = parseDocument(`Intro. ${url} ${rest} See ${url} ${rest}`, "u.txt", 1);
      const at = (s: number, t: string) => d.sentences[s].words.find((w) => w.text === t)!.index;
      expect(buildChunks(d, 2200, 1400, at(1, "parser")).map((c) => c.text)).toEqual(["Intro.", url, rest, `See ${url} ${rest}`]);
      expect(buildChunks(d, 2200, 1400, at(2, url)).map((c) => c.text)).toEqual([`Intro. ${url} ${rest}`, "See", url, rest]);
    });

    it("keeps today's plan for a sentence of at most 200 characters, from any word in it", () => {
      const s200 = `${"abcd ".repeat(39)}eeee.`;
      expect(s200.length).toBe(200);
      const d = parseDocument(`Intro. ${s200} Next one.`, "b.txt", 1);
      for (const w of d.sentences[1].words) expect(buildChunks(d, 2200, 1400, w.index).map((c) => c.text)).toEqual(["Intro.", s200, "Next one."]);
    });

    it("splits a start sentence of 201 characters, not of 200", () => {
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

    it("the CLI's plan (no start word) never splits a sentence", () => {
      expect(plain.flatMap((c) => c.sentenceIndexes)).toEqual(m.sentences.map((s) => s.index));
      expect(plain.some((c) => c.text.includes(longSentence))).toBe(true);
    });
  });
});
