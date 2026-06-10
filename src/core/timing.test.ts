import { describe, it, expect } from "vitest";
import { timingsFromEdge, timingsFromCharAlignment, estimatedTimings, EdgeBoundary } from "./timing";
import { Chunk } from "./chunker";

const chunk: Chunk = {
  index: 0,
  text: "Hello brave world. Yes!",
  sentenceIndexes: [0, 1],
  words: [
    { wordIndex: 0, charStart: 0, charEnd: 5 },   // Hello
    { wordIndex: 1, charStart: 6, charEnd: 11 },  // brave
    { wordIndex: 2, charStart: 12, charEnd: 18 }, // world.
    { wordIndex: 3, charStart: 19, charEnd: 23 }, // Yes!
  ],
};

describe("timingsFromEdge", () => {
  it("matches boundary events to words in order (ticks → ms)", () => {
    const events: EdgeBoundary[] = [
      { text: "Hello", offsetTicks: 0, durationTicks: 4_000_000 },
      { text: "brave", offsetTicks: 5_000_000, durationTicks: 4_000_000 },
      { text: "world", offsetTicks: 10_000_000, durationTicks: 4_000_000 }, // no punctuation
      { text: "Yes", offsetTicks: 16_000_000, durationTicks: 3_000_000 },
    ];
    const t = timingsFromEdge(chunk, events);
    expect(t.unit).toBe("ms");
    expect(t.words).toEqual([
      { wordIndex: 0, start: 0, end: 400 },
      { wordIndex: 1, start: 500, end: 900 },
      { wordIndex: 2, start: 1000, end: 1400 },
      { wordIndex: 3, start: 1600, end: 1900 },
    ]);
  });

  it("skips unmatched boundary events without derailing", () => {
    const events: EdgeBoundary[] = [
      { text: "Hello", offsetTicks: 0, durationTicks: 4_000_000 },
      { text: "uhm", offsetTicks: 4_500_000, durationTicks: 100_000 }, // not in chunk
      { text: "brave", offsetTicks: 5_000_000, durationTicks: 4_000_000 },
    ];
    const t = timingsFromEdge(chunk, events);
    expect(t.words.map((w) => w.wordIndex)).toEqual([0, 1]);
  });
});

describe("timingsFromCharAlignment", () => {
  it("accumulates character times into word spans (seconds → ms)", () => {
    const chars = chunk.text.split("");
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.1);
    const t = timingsFromCharAlignment(chunk, chars, starts, ends);
    expect(t.unit).toBe("ms");
    expect(t.words[0]).toEqual({ wordIndex: 0, start: 0, end: 500 });
    expect(t.words[3].start).toBeCloseTo(1900, 0);
  });
});

describe("estimatedTimings", () => {
  it("allocates fractions proportional to char position", () => {
    const t = estimatedTimings(chunk);
    expect(t.unit).toBe("fraction");
    expect(t.words[0].start).toBe(0);
    const last = t.words[t.words.length - 1];
    expect(last.end).toBe(1);
    for (let i = 1; i < t.words.length; i++) {
      expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start);
    }
  });
});
