import { describe, it, expect } from "vitest";
import { wavDurationMs, parseSayVoices } from "./say";

// Trimmed fixture mimicking `say -v ?`: name, padded to a locale + sample line.
const SAY_STDOUT = `Albert              en_US    # Hello! My name is Albert.
Bad News            en_US    # The light you see at the end of the tunnel...
Bahh                en_US    # Do not pull the wool over my eyes.
Bells               en_US    # Time flies when you are having fun.
Boing               en_US    # Spring has sprung, fall has fell.
Bubbles             en_US    # Pull the plug!
Cellos              en_US    # Doo doo doo.
Daniel              en_GB    # Hello! My name is Daniel.
Deranged            en_US    # I need to go on a really long vacation.
Fred                en_US    # I sure like being inside this fancy computer.
Good News           en_US    # Congratulations!
Hysterical          en_US    # Please stop tickling me!
Jester              en_US    # Hello! My name is Jester.
Junior              en_US    # Hello! My name is Junior.
Karen               en_AU    # Hello! My name is Karen.
Kathy               en_US    # Hello! My name is Kathy.
Moira               en_IE    # Hello! My name is Moira.
Organ               en_US    # Doo doo doo.
Pipe Organ          en_US    # We must rejoice in this morbid voice.
Ralph               en_US    # Hello! My name is Ralph.
Rishi               en_IN    # Hello! My name is Rishi.
Samantha            en_US    # Hello! My name is Samantha.
Superstar           en_US    # Are you a fan?
Tessa               en_ZA    # Hello! My name is Tessa.
Trinoids            en_US    # Hello! My name is Trinoids.
Whisper             en_US    # Pssst, hey you. Yeah you.
Wobble              en_US    # Hello! My name is Wobble.
Zarvox              en_US    # That looks like a peaceful planet.
Zosia               pl_PL    # Witaj, nazywam się Zosia.
`;

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

describe("parseSayVoices", () => {
  const voices = parseSayVoices(SAY_STDOUT);
  const ids = voices.map((v) => v.id);

  it("keeps normal English speech voices", () => {
    for (const name of ["Samantha", "Daniel", "Karen", "Moira", "Rishi", "Tessa"]) {
      expect(ids).toContain(name);
    }
  });

  it("excludes novelty voices", () => {
    for (const name of [
      "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Wobble",
      "Albert", "Jester", "Hysterical", "Organ", "Superstar", "Trinoids",
      "Whisper", "Zarvox", "Deranged", "Good News", "Pipe Organ", "Ralph",
      "Kathy", "Junior", "Fred",
    ]) {
      expect(ids).not.toContain(name);
    }
  });

  it("excludes non-English voices", () => {
    expect(ids).not.toContain("Zosia");
  });

  it("returns id equal to label for each voice", () => {
    for (const v of voices) expect(v.id).toBe(v.label);
  });
});
