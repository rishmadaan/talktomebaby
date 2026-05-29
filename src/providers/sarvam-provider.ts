import { ITtsProvider, TtsOptions, AudioResult, VoiceInfo } from "./tts-provider";
import { fetchWithTimeout } from "./fetch-timeout";

const SARVAM_API_URL = "https://api.sarvam.ai/text-to-speech";

export class SarvamProvider implements ITtsProvider {
  readonly name = "sarvam";
  readonly maxCharsPerRequest = 2500;
  readonly defaultVoice = "shubh";
  readonly voices: VoiceInfo[] = [
    { id: "shubh", label: "Shubh" },
    { id: "aditya", label: "Aditya" },
    { id: "ritu", label: "Ritu" },
    { id: "priya", label: "Priya" },
    { id: "neha", label: "Neha" },
    { id: "rahul", label: "Rahul" },
    { id: "pooja", label: "Pooja" },
    { id: "rohan", label: "Rohan" },
    { id: "simran", label: "Simran" },
    { id: "kavya", label: "Kavya" },
    { id: "amit", label: "Amit" },
    { id: "dev", label: "Dev" },
    { id: "ishita", label: "Ishita" },
    { id: "shreya", label: "Shreya" },
  ];

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(text: string, options: TtsOptions): Promise<AudioResult> {
    const response = await fetchWithTimeout(SARVAM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": this.apiKey,
      },
      body: JSON.stringify({
        text,
        target_language_code: "en-IN",
        model: "bulbul:v3",
        speaker: options.voice || this.defaultVoice,
        pace: options.speed ?? 1.0,
        output_audio_codec: "mp3",
        speech_sample_rate: 24000,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Sarvam API error ${response.status}: ${body}`
      );
    }

    const data = (await response.json()) as {
      request_id: string;
      audios: string[];
    };

    if (!data.audios || data.audios.length === 0) {
      throw new Error("Sarvam API returned no audio data");
    }

    const audioBuffer = Buffer.from(data.audios[0], "base64");
    return { audioBuffer, format: "mp3" };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(SARVAM_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": apiKey,
        },
        body: JSON.stringify({
          text: "Hello",
          target_language_code: "en-IN",
          model: "bulbul:v3",
          speaker: "shubh",
          output_audio_codec: "mp3",
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
