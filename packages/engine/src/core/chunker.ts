/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { DocumentModel } from "./document-model";

export interface ChunkWordRef { wordIndex: number; charStart: number; charEnd: number }
export interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }

// Caps of the chunks after the start sentence's own chunk: they ramp up, so the
// first audio arrives fast and each chunk is synthesized while the shorter one
// before it plays.
const RAMP = [500, 1000];

/**
 * @param startWordIndex where reading starts; its sentence opens a short first chunk.
 * Leave it out for the plain plan (the CLI: it has no prefetch, so a ramp is audible gaps).
 * With it, the plan is the plain plan with only the chunk holding the start sentence
 * (and, if little of that chunk is left, the next one) split up, so every later chunk
 * has the same text from any start and stays a disk-cache hit.
 */
export function buildChunks(model: DocumentModel, maxChars = 2200, minChars = 1400, startWordIndex?: number): Chunk[] {
  // Map sentence index -> block index so we can prefer block boundaries
  const blockOf = new Map<number, number>();
  model.blocks.forEach((b, bi) => b.sentences.forEach((s) => blockOf.set(s.index, bi)));
  const n = model.sentences.length;

  // End (exclusive) of the chunk opening at sentence `from`: at most `max` chars, or
  // earlier at a block boundary once `min` is reached. A first sentence always fits.
  const take = (from: number, to: number, max: number, min: number): number => {
    let end = from;
    let curLen = 0;
    for (; end < to; end++) {
      // Counts a joining space on every sentence but the document's first, as the plan always has.
      const addLen = model.sentences[end].text.length + (end ? 1 : 0);
      if (end > from && curLen + addLen > max) break;
      if (end > from && curLen >= min && blockOf.get(end) !== blockOf.get(end - 1)) break;
      curLen += addLen;
    }
    return end;
  };

  // The plain plan, as [from, to) sentence ranges.
  const plain: [number, number][] = [];
  for (let i = 0; i < n; ) { const end = take(i, n, maxChars, minChars); plain.push([i, end]); i = end; }

  let ranges = plain;
  if (startWordIndex !== undefined && n) {
    const start = model.sentences.find((s) => s.words.some((w) => w.index >= startWordIndex))?.index ?? 0;
    const k = plain.findIndex(([, to]) => start < to);
    const [from, to] = plain[k];
    ranges = plain.slice(0, k);
    // Pieces with the given caps, then whatever is left as one chunk.
    const ramp = (a: number, b: number, caps: number[]) => {
      for (const cap of caps) {
        if (a >= b) return;
        const max = Math.min(cap, maxChars);
        const end = take(a, b, max, Math.floor(max / 2)); // half full first, so a heading does not ride alone
        ranges.push([a, end]);
        a = end;
      }
      if (a < b) ranges.push([a, b]);
    };
    if (start > from) ranges.push([from, start]);
    ranges.push([start, start + 1]);
    ramp(start + 1, to, RAMP);
    let next = k + 1;
    const restLen = model.sentences.slice(start + 1, to).map((s) => s.text).join(" ").length;
    // Too little left before the next plain chunk to cover its synthesis: split that one too.
    if (restLen < RAMP[0] && next < plain.length) { ramp(plain[next][0], plain[next][1], RAMP.slice(0, 1)); next++; }
    ranges.push(...plain.slice(next));
  }

  return ranges.map(([from, to], index) => {
    const parts: string[] = [];
    const words: ChunkWordRef[] = [];
    let pos = 0;
    const sentenceIndexes: number[] = [];
    for (let si = from; si < to; si++) {
      const s = model.sentences[si];
      sentenceIndexes.push(si);
      if (parts.length) { parts.push(" "); pos += 1; }
      // word offsets: locate each word's text within the sentence text sequentially
      let search = 0;
      for (const w of s.words) {
        const at = s.text.indexOf(w.text, search);
        if (at >= 0) {
          words.push({ wordIndex: w.index, charStart: pos + at, charEnd: pos + at + w.text.length });
          search = at + w.text.length;
        }
      }
      parts.push(s.text);
      pos += s.text.length;
    }
    return { index, text: parts.join(""), sentenceIndexes, words };
  });
}
