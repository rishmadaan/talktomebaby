import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Chunk } from "../core/chunker";
import { estimatedTimings } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const run = promisify(execFile);

export function wavDurationMs(bytes: Uint8Array): number | undefined {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return undefined;
  const byteRate = buf.readUInt32LE(28);
  // find the data chunk (it isn't always at offset 36)
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return byteRate > 0 ? Math.round((size / byteRate) * 1000) : undefined;
    off += 8 + size + (size % 2);
  }
  return undefined;
}

export class SayProvider implements TtsProvider {
  readonly id = "say";
  readonly label = "macOS say (offline)";
  readonly requiresKey = false;
  readonly timingQuality = "estimated" as const;
  readonly maxCharsPerRequest = 20000;
  readonly defaultVoice = "Samantha";

  async listVoices(): Promise<VoiceInfo[]> {
    try {
      const { stdout } = await run("say", ["-v", "?"]);
      return stdout.split("\n").flatMap((line) => {
        const m = line.match(/^([\w ()-]+?)\s{2,}([a-z]{2}[-_]\w+)/);
        return m && m[2].startsWith("en") ? [{ id: m[1].trim(), label: m[1].trim() }] : [];
      });
    } catch {
      return [{ id: "Samantha", label: "Samantha" }];
    }
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const out = join(tmpdir(), `speakittome-say-${Date.now()}-${chunk.index}.wav`);
    try {
      await run(
        "say",
        ["-v", voice, "-o", out, "--file-format=WAVE", "--data-format=LEI16@22050", chunk.text],
        { signal }
      );
      const audio = new Uint8Array(await fs.readFile(out));
      return { audio, format: "wav", timings: estimatedTimings(chunk) };
    } finally {
      await fs.rm(out, { force: true });
    }
  }
}
