import { Chunk } from "./chunker";

export interface WordTiming { wordIndex: number; start: number; end: number }
export interface ChunkTimings { unit: "ms" | "fraction"; words: WordTiming[] }
export interface EdgeBoundary { text: string; offsetTicks: number; durationTicks: number }

const TICKS_PER_MS = 10_000;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function timingsFromEdge(chunk: Chunk, events: EdgeBoundary[]): ChunkTimings {
  const words: WordTiming[] = [];
  let wi = 0;
  for (const ev of events) {
    const target = norm(ev.text);
    if (!target) continue;
    // look ahead a small window for the matching word
    for (let look = wi; look < Math.min(wi + 3, chunk.words.length); look++) {
      const ref = chunk.words[look];
      const wordText = chunk.text.slice(ref.charStart, ref.charEnd);
      if (norm(wordText) === target || norm(wordText).startsWith(target)) {
        words.push({
          wordIndex: ref.wordIndex,
          start: Math.round(ev.offsetTicks / TICKS_PER_MS),
          end: Math.round((ev.offsetTicks + ev.durationTicks) / TICKS_PER_MS),
        });
        wi = look + 1;
        break;
      }
    }
  }
  return { unit: "ms", words };
}

export function timingsFromCharAlignment(
  chunk: Chunk, chars: string[], startSeconds: number[], endSeconds: number[]
): ChunkTimings {
  const words: WordTiming[] = chunk.words.flatMap((ref) => {
    if (ref.charStart >= chars.length) return [];
    const endIdx = Math.min(ref.charEnd, chars.length) - 1;
    return [{
      wordIndex: ref.wordIndex,
      start: Math.round(startSeconds[ref.charStart] * 1000),
      end: Math.round(endSeconds[endIdx] * 1000),
    }];
  });
  return { unit: "ms", words };
}

export function estimatedTimings(chunk: Chunk): ChunkTimings {
  const total = chunk.text.length || 1;
  const words: WordTiming[] = chunk.words.map((ref, i) => ({
    wordIndex: ref.wordIndex,
    start: ref.charStart / total,
    end: i === chunk.words.length - 1 ? 1 : ref.charEnd / total,
  }));
  return { unit: "fraction", words };
}
