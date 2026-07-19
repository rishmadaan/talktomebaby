import { parseDocument, buildChunks, play, Chunk } from "@talktomebaby/engine";
import { CliConfig } from "./config";
import { cleanForSpeech, firstParagraph } from "./clean-text";
import { summarize } from "./summarize";
import { makeProvider } from "./providers";

export interface SpeakDeps {
  synthesizeAndPlay?: (chunks: Chunk[], providerId: string, voice: string, signal: AbortSignal) => Promise<void>;
}

async function defaultSink(chunks: Chunk[], providerId: string, voice: string, signal: AbortSignal): Promise<void> {
  const provider = makeProvider(providerId);
  for (const chunk of chunks) {
    const out = await provider.synthesize(chunk, voice, signal);
    await play(out.audio, out.format, signal);
  }
}

export async function speakText(text: string, cfg: CliConfig, deps: SpeakDeps = {}): Promise<{ ok: boolean; spoken: string; error?: string }> {
  try {
    let spoken = cleanForSpeech(text, { scope: cfg.scope === "summary" ? "full" : cfg.scope, maxChars: cfg.maxChars });
    if (!spoken.trim()) return { ok: false, spoken: "" };
    if (cfg.scope === "summary") {
      const s = await summarize(spoken);
      spoken = s ? s.text : firstParagraph(spoken);
    }
    const chunks = buildChunks(parseDocument(spoken));
    const voice = cfg.voice[cfg.provider] || "";
    const sink = deps.synthesizeAndPlay || defaultSink;
    await sink(chunks, cfg.provider, voice, new AbortController().signal);
    return { ok: true, spoken };
  } catch (e) {
    // Never throws to the caller, but the reason must survive so the agent
    // path can log it: a missing key or dead player is otherwise invisible.
    return { ok: false, spoken: "", error: e instanceof Error ? e.message : String(e) };
  }
}
