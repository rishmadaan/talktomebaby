export interface TtsOptions {
  voice?: string;
  speed?: number;
}

export interface AudioResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav";
}

export interface VoiceInfo {
  id: string;
  label: string;
}

export interface ITtsProvider {
  readonly name: string;
  readonly maxCharsPerRequest: number;
  readonly defaultVoice: string;
  readonly voices: VoiceInfo[];
  synthesize(text: string, options: TtsOptions): Promise<AudioResult>;
  validateKey(apiKey: string): Promise<boolean>;
  fetchVoices?(): Promise<VoiceInfo[]>;
}
