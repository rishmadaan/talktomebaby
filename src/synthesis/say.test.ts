import { describe, it, expect } from "vitest";
import { wavDurationMs } from "./say";

function makeWav(dataBytes: number, byteRate: number): Uint8Array {
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(22050, 24); buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buf);
}

describe("wavDurationMs", () => {
  it("computes duration from data size and byte rate", () => {
    expect(wavDurationMs(makeWav(44100, 44100))).toBe(1000);
    expect(wavDurationMs(makeWav(22050, 44100))).toBe(500);
  });
  it("returns undefined for non-wav bytes", () => {
    expect(wavDurationMs(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });
});
