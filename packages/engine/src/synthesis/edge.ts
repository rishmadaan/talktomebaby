import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { Chunk } from "../core/chunker";
import { EdgeBoundary, timingsFromEdge } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const FALLBACK_VOICES: VoiceInfo[] = [
  { id: "en-US-AriaNeural", label: "Aria (US)" },
  { id: "en-US-GuyNeural", label: "Guy (US)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK)" },
  { id: "en-IN-NeerjaNeural", label: "Neerja (IN)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (AU)" },
];

export class EdgeProvider implements TtsProvider {
  readonly id = "edge";
  readonly label = "Edge TTS (free)";
  readonly requiresKey = false;
  readonly timingQuality = "exact" as const;
  readonly maxCharsPerRequest = 6000;
  readonly defaultVoice = "en-US-AriaNeural";

  async listVoices(): Promise<VoiceInfo[]> {
    try {
      const tts = new MsEdgeTTS();
      const voices = await tts.getVoices();
      const en = voices
        .filter((v) => v.Locale.startsWith("en-"))
        .map((v) => ({ id: v.ShortName, label: v.FriendlyName ?? v.ShortName }));
      return en.length > 0 ? en : FALLBACK_VOICES;
    } catch {
      return FALLBACK_VOICES;
    }
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    if (signal.aborted) throw new Error("aborted");

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: false,
    });

    // toStream is synchronous in msedge-tts >=2.x and returns the streams object.
    const { audioStream, metadataStream } = tts.toStream(chunk.text);

    const audioParts: Buffer[] = [];
    const boundaries: EdgeBoundary[] = [];

    return new Promise<ChunkAudio>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        try { audioStream.destroy(); } catch { /* ignore */ }
        try { metadataStream?.destroy(); } catch { /* ignore */ }
        try { tts.close(); } catch { /* ignore */ }
      };

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const succeed = (value: ChunkAudio) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const onAbort = () => fail(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });

      audioStream.on("data", (d: Buffer) => audioParts.push(d));
      audioStream.on("error", fail);

      // A malformed metadata frame must never crash synthesis.
      metadataStream?.on("data", (d: Buffer) => {
        try {
          const parsed = JSON.parse(d.toString("utf8"));
          for (const m of parsed.Metadata ?? []) {
            if (m.Type === "WordBoundary") {
              boundaries.push({
                text: m.Data?.text?.Text ?? "",
                offsetTicks: m.Data?.Offset ?? 0,
                durationTicks: m.Data?.Duration ?? 0,
              });
            }
          }
        } catch {
          /* ignore malformed metadata frames */
        }
      });
      metadataStream?.on("error", fail);

      const finish = () => {
        if (settled) return;
        const audio = new Uint8Array(Buffer.concat(audioParts));
        if (audio.byteLength === 0) {
          fail(new Error("Edge TTS returned no audio"));
          return;
        }
        succeed({ audio, format: "mp3", timings: timingsFromEdge(chunk, boundaries) });
      };

      // The audio stream ends with a null push -> "end", then "close".
      // Wait for the audio stream to finish; metadata frames all arrive before
      // the audio "end" since they are interleaved on the same WebSocket.
      audioStream.on("end", finish);
      audioStream.on("close", finish);
    });
  }
}
