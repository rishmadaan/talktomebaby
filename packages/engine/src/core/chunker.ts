import { DocumentModel } from "./document-model";

export interface ChunkWordRef { wordIndex: number; charStart: number; charEnd: number }
export interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }

export function buildChunks(model: DocumentModel, maxChars = 2200, minChars = 1400): Chunk[] {
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
    cur = [];
    curLen = 0;
  };

  for (const s of model.sentences) {
    const addLen = s.text.length + (cur.length ? 1 : 0);
    if (cur.length && curLen + addLen > maxChars) flush();
    const prevBlock = cur.length ? blockOf.get(cur[cur.length - 1]) : undefined;
    if (cur.length && curLen >= minChars && blockOf.get(s.index) !== prevBlock) flush();
    cur.push(s.index);
    curLen += addLen;
  }
  flush();
  return chunks;
}
