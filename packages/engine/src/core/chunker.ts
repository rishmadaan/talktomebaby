/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { DocumentModel, Sentence } from "./document-model";

export interface ChunkWordRef { wordIndex: number; charStart: number; charEnd: number }
export interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }

// Caps of the chunks after the start sentence's own chunk: they ramp up, so the
// first audio arrives fast and each chunk is synthesized while the shorter one
// before it plays.
const RAMP = [500, 1000];
// A start sentence longer than SPLIT_OVER from the start word opens with a head of
// at most HEAD_MAX characters, so its first audio does not wait on the whole sentence.
const SPLIT_OVER = 200;
const HEAD_MAX = 160;

// [from, to) sentences; sentence `from` starts at char a and sentence `to - 1` ends
// before char b (both word starts), when a sentence is split across chunks.
type Range = [from: number, to: number, a?: number, b?: number];

// Each word's offset in its sentence text, found in order; a word not found is left out.
const locate = (s: Sentence) => {
  const out: { index: number; text: string; at: number }[] = [];
  let search = 0;
  for (const w of s.words) {
    const at = s.text.indexOf(w.text, search);
    if (at >= 0) { out.push({ index: w.index, text: w.text, at }); search = at + w.text.length; }
  }
  return out;
};

/**
 * @param startWordIndex where reading starts; its sentence opens a short first chunk
 * (one with more than 200 chars from the start word: any words before it, then a head
 * of at most 160 chars from it; the rest of the sentence opens the ramp).
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
  // `skip` chars of sentence `from` are already in an earlier chunk.
  const take = (from: number, to: number, max: number, min: number, skip = 0): number => {
    let end = from;
    let curLen = 0;
    for (; end < to; end++) {
      // Counts a joining space on every sentence but the document's first, as the plan always has.
      const addLen = model.sentences[end].text.length - (end === from ? skip : 0) + (end ? 1 : 0);
      if (end > from && curLen + addLen > max) break;
      if (end > from && curLen >= min && blockOf.get(end) !== blockOf.get(end - 1)) break;
      curLen += addLen;
    }
    return end;
  };

  // The plain plan, as [from, to) sentence ranges.
  const plain: [number, number][] = [];
  for (let i = 0; i < n; ) { const end = take(i, n, maxChars, minChars); plain.push([i, end]); i = end; }

  let ranges: Range[] = plain;
  if (startWordIndex !== undefined && n) {
    const start = model.sentences.find((s) => s.words.some((w) => w.index >= startWordIndex))?.index ?? 0;
    const k = plain.findIndex(([, to]) => start < to);
    const [from, to] = plain[k];
    ranges = plain.slice(0, k);
    // Pieces with the given caps, then whatever is left as one chunk.
    const ramp = (a: number, b: number, caps: number[], skip = 0) => {
      for (const cap of caps) {
        if (a >= b) return;
        const max = Math.min(cap, maxChars);
        const end = take(a, b, max, Math.floor(max / 2), skip); // half full first, so a heading does not ride alone
        ranges.push([a, end, skip]);
        a = end;
        skip = 0;
      }
      if (a < b) ranges.push([a, b]);
    };
    // A long start sentence: cut at word starts into [words before the start word,]
    // a head of at most HEAD_MAX chars from it, and the rest, which opens the ramp.
    // Not from word 0: a read from the top keeps its plan.
    const ss = model.sentences[start];
    const located = locate(ss);
    const i = located.findIndex((w) => w.index >= startWordIndex);
    let cut: { head: number; rest: number } | undefined;
    if (startWordIndex > 0 && i >= 0 && ss.text.length - located[i].at > SPLIT_OVER) {
      const head = located[i].at;
      let j = i + 1; // the rest's first word
      while (j + 1 < located.length && ss.text.slice(head, located[j + 1].at).trimEnd().length <= HEAD_MAX) j++;
      if (j < located.length) cut = { head, rest: located[j].at };
    }
    if (start > from) ranges.push([from, start]);
    if (cut) {
      if (cut.head) ranges.push([start, start + 1, 0, cut.head]); // synthesized only if the listener goes back
      ranges.push([start, start + 1, cut.head, cut.rest]);
      ramp(start, to, RAMP, cut.rest);
    } else {
      ranges.push([start, start + 1]);
      ramp(start + 1, to, RAMP);
    }
    let next = k + 1;
    const restLen = [...(cut ? [ss.text.slice(cut.rest)] : []), ...model.sentences.slice(start + 1, to).map((s) => s.text)].join(" ").length;
    // Too little left before the next plain chunk to cover its synthesis: split that one too.
    if (restLen < RAMP[0] && next < plain.length) { ramp(plain[next][0], plain[next][1], RAMP.slice(0, 1)); next++; }
    ranges.push(...plain.slice(next));
  }

  return ranges.map(([from, to, a = 0, b], index) => {
    const parts: string[] = [];
    const words: ChunkWordRef[] = [];
    let pos = 0;
    const sentenceIndexes: number[] = [];
    for (let si = from; si < to; si++) {
      const s = model.sentences[si];
      const lo = si === from ? a : 0;
      const hi = si === to - 1 && b !== undefined ? b : s.text.length;
      const text = hi < s.text.length ? s.text.slice(lo, hi).trimEnd() : s.text.slice(lo);
      sentenceIndexes.push(si);
      if (parts.length) { parts.push(" "); pos += 1; }
      for (const w of locate(s)) {
        if (w.at >= lo && w.at < hi) words.push({ wordIndex: w.index, charStart: pos + w.at - lo, charEnd: pos + w.at - lo + w.text.length });
      }
      parts.push(text);
      pos += text.length;
    }
    return { index, text: parts.join(""), sentenceIndexes, words };
  });
}
