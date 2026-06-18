import { Chunk } from "../core/chunker";
import { ChunkTimings } from "../core/timing";

export interface VoiceInfo { id: string; label: string }
export interface ChunkAudio { audio: Uint8Array; format: "mp3" | "wav"; timings: ChunkTimings }

export interface TtsProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresKey: boolean;
  readonly timingQuality: "exact" | "estimated";
  readonly maxCharsPerRequest: number;
  readonly defaultVoice: string;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio>;
}
