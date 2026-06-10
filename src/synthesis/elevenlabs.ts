import { Chunk } from "../core/chunker";
import { timingsFromCharAlignment } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsProvider implements TtsProvider {
  readonly id = "elevenlabs";
  readonly label = "ElevenLabs";
  readonly requiresKey = true;
  readonly timingQuality = "exact" as const;
  readonly maxCharsPerRequest = 5000;
  readonly defaultVoice = "21m00Tcm4TlvDq8ikWAM"; // Rachel

  constructor(private apiKey: string) {}

  async listVoices(): Promise<VoiceInfo[]> {
    try {
      const res = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": this.apiKey } });
      if (!res.ok) return [{ id: this.defaultVoice, label: "Rachel" }];
      const data = (await res.json()) as { voices: { voice_id: string; name: string }[] };
      return data.voices.map((v) => ({ id: v.voice_id, label: v.name }));
    } catch {
      return [{ id: this.defaultVoice, label: "Rachel" }];
    }
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const res = await fetch(`${BASE}/text-to-speech/${voice}/with-timestamps`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "xi-api-key": this.apiKey },
      body: JSON.stringify({ text: chunk.text, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      audio_base64: string;
      alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
    };
    const audio = new Uint8Array(Buffer.from(data.audio_base64, "base64"));
    const timings = timingsFromCharAlignment(
      chunk, data.alignment.characters,
      data.alignment.character_start_times_seconds, data.alignment.character_end_times_seconds
    );
    return { audio, format: "mp3", timings };
  }
}
