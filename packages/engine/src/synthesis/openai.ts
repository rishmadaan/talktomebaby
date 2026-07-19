import { Chunk } from "../core/chunker";
import { estimatedTimings } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"];

export class OpenAIProvider implements TtsProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly requiresKey = true;
  readonly timingQuality = "estimated" as const;
  readonly maxCharsPerRequest = 4096;
  readonly defaultVoice = "alloy";

  constructor(private apiKey: string) {}

  async listVoices(): Promise<VoiceInfo[]> {
    return VOICES.map((v) => ({ id: v, label: v[0].toUpperCase() + v.slice(1) }));
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", input: chunk.text, voice, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, format: "mp3", timings: estimatedTimings(chunk) };
  }
}
