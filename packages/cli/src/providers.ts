import { EdgeProvider, SayProvider, OpenAIProvider, ElevenLabsProvider, SarvamProvider, TtsProvider } from "@talktomebaby/engine";
import { resolveKey } from "./config";

export function makeProvider(providerId: string): TtsProvider {
  switch (providerId) {
    case "edge": return new EdgeProvider();
    case "say": return new SayProvider();
    case "openai": return withKey("openai", (k) => new OpenAIProvider(k));
    case "elevenlabs": return withKey("elevenlabs", (k) => new ElevenLabsProvider(k));
    case "sarvam": return withKey("sarvam", (k) => new SarvamProvider(k));
    default: return new EdgeProvider();
  }
}

function withKey(provider: string, make: (key: string) => TtsProvider): TtsProvider {
  const key = resolveKey(provider);
  if (!key) throw new Error(`Missing API key for ${provider}. Set ${provider.toUpperCase()}_API_KEY or add it to the talktomebaby config.`);
  return make(key);
}
