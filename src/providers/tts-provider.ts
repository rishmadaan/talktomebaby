export interface TtsOptions {
  voice?: string;
  speed?: number;
}

export interface AudioResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav";
}

export interface ITtsProvider {
  readonly name: string;
  readonly maxCharsPerRequest: number;
  readonly defaultVoice: string;
  synthesize(text: string, options: TtsOptions): Promise<AudioResult>;
  validateKey(apiKey: string): Promise<boolean>;
}
