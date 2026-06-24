import { Chunk } from "../core/chunker";
import { estimatedTimings } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const SARVAM_URL = "https://api.sarvam.ai/text-to-speech";
const VOICES = ["shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja",
  "rohan", "simran", "kavya", "amit", "dev", "ishita", "shreya"];

export class SarvamProvider implements TtsProvider {
  readonly id = "sarvam";
  readonly label = "Sarvam AI";
  readonly requiresKey = true;
  readonly timingQuality = "estimated" as const;
  readonly maxCharsPerRequest = 2500;
  readonly defaultVoice = "shubh";

  constructor(private apiKey: string) {}

  async listVoices(): Promise<VoiceInfo[]> {
    return VOICES.map((v) => ({ id: v, label: v[0].toUpperCase() + v.slice(1) }));
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const res = await fetch(SARVAM_URL, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "api-subscription-key": this.apiKey },
      body: JSON.stringify({
        text: chunk.text.slice(0, this.maxCharsPerRequest),
        target_language_code: "en-IN", model: "bulbul:v3", speaker: voice,
        output_audio_codec: "mp3", speech_sample_rate: 24000,
      }),
    });
    if (!res.ok) throw new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { audios: string[] };
    if (!data.audios?.length) throw new Error("Sarvam returned no audio");
    return {
      audio: new Uint8Array(Buffer.from(data.audios[0], "base64")),
      format: "mp3",
      timings: estimatedTimings(chunk),
    };
  }
}
