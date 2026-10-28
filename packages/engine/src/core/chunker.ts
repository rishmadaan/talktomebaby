/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { DocumentModel } from "./document-model";

export interface ChunkWordRef { wordIndex: number; charStart: number; charEnd: number }
export interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }

// Caps of the chunks from the start sentence on, before the normal targets:
// the start sentence alone (0), then ramps up, so the first audio arrives fast
// and each chunk is synthesized while the shorter one before it plays.
const RAMP = [0, 500, 1000];

/**
 * @param startWordIndex where reading starts; its sentence opens a short first chunk.
 * Leave it out for the plain plan (the CLI: it has no prefetch, so a ramp is audible gaps).
 */
export function buildChunks(model: DocumentModel, maxChars = 2200, minChars = 1400, startWordIndex?: number): Chunk[] {
  const startSentence = startWordIndex === undefined ? -1 :
    model.sentences.find((s) => s.words.some((w) => w.index >= startWordIndex))?.index ?? 0;
  let sinceStart = -1; // chunks emitted since the start sentence; -1 before it
  // Map sentence index -> block index so we can prefer block boundaries
  const blockOf = new Map<number, number>();
  model.blocks.forEach((b, bi) => b.sentences.forEach((s) => blockOf.set(s.index, bi)));

  const chunks: Chunk[] = [];
  let cur: number[] = [];
  let curLen = 0;

  const flush = () => {
    if (!cur.length) return;
    const parts: string[] = [];
    const words: ChunkWordRef[] = [];
    let pos = 0;
    for (const si of cur) {
      const s = model.sentences[si];
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
    chunks.push({ index: chunks.length, text: parts.join(""), sentenceIndexes: cur, words });
    if (sinceStart >= 0) sinceStart++;
    cur = [];
    curLen = 0;
  };

  for (const s of model.sentences) {
    if (s.index === startSentence) { flush(); sinceStart = 0; }
    const ramping = sinceStart >= 0 && sinceStart < RAMP.length;
    const cap = ramping ? Math.min(RAMP[sinceStart], maxChars) : maxChars;
    const addLen = s.text.length + (cur.length ? 1 : 0);
    if (cur.length && curLen + addLen > cap) flush();
    const prevBlock = cur.length ? blockOf.get(cur[cur.length - 1]) : undefined;
    if (cur.length && curLen >= (ramping ? 0 : minChars) && blockOf.get(s.index) !== prevBlock) flush();
    cur.push(s.index);
    curLen += addLen;
  }
  flush();
  return chunks;
}
