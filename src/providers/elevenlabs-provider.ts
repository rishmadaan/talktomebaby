import { ITtsProvider, TtsOptions, AudioResult, VoiceInfo } from "./tts-provider";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export class ElevenLabsProvider implements ITtsProvider {
  readonly name = "elevenlabs";
  readonly maxCharsPerRequest = 5000;
  readonly defaultVoice = DEFAULT_VOICE_ID;
  readonly voices: VoiceInfo[] = [
    { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel" },
  ];

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchVoices(): Promise<VoiceInfo[]> {
    try {
      const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
        headers: { "xi-api-key": this.apiKey },
      });
      if (!response.ok) return this.voices;
      const data = (await response.json()) as { voices: { voice_id: string; name: string }[] };
      return data.voices.map((v) => ({ id: v.voice_id, label: v.name }));
    } catch {
      return this.voices;
    }
  }

  async synthesize(text: string, options: TtsOptions): Promise<AudioResult> {
    const voiceId = options.voice || this.defaultVoice;
    const url = `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `ElevenLabs API error ${response.status}: ${body}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    return { audioBuffer, format: "mp3" };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${ELEVENLABS_API_URL}/user`, {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
