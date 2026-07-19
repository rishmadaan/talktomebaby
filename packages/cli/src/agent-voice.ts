import { parseDocument, buildChunks, play, Chunk } from "@talktomebaby/engine";
import { CliConfig } from "./config";
import { capLength, cleanForSpeech, firstParagraph } from "./clean-text";
import { summarize } from "./summarize";
import { makeProvider } from "./providers";

export interface SpeakDeps {
  synthesizeAndPlay?: (chunks: Chunk[], providerId: string, voice: string, signal: AbortSignal) => Promise<void>;
}

// The semantic chunker only splits between sentences, so one giant sentence
// can exceed a provider's per-request limit (Sarvam silently slices at its
// cap). Hard-split any oversized chunk at word boundaries before synthesis;
// word timing refs are dropped, which the CLI never uses (audio only).
export function splitAtProviderLimit(chunks: Chunk[], limit: number): Chunk[] {
  if (!limit || limit <= 0) return chunks;
  const out: Chunk[] = [];
  for (const chunk of chunks) {
    if (chunk.text.length <= limit) { out.push({ ...chunk, index: out.length }); continue; }
    let rest = chunk.text;
    while (rest.length > limit) {
      const slice = rest.slice(0, limit);
      const cut = slice.lastIndexOf(" ") > limit * 0.5 ? slice.lastIndexOf(" ") : limit;
      out.push({ index: out.length, text: rest.slice(0, cut).trim(), sentenceIndexes: chunk.sentenceIndexes, words: [] });
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push({ index: out.length, text: rest, sentenceIndexes: chunk.sentenceIndexes, words: [] });
  }
  return out;
}

async function defaultSink(chunks: Chunk[], providerId: string, voice: string, signal: AbortSignal): Promise<void> {
  const provider = makeProvider(providerId);
  for (const chunk of splitAtProviderLimit(chunks, provider.maxCharsPerRequest)) {
    const out = await provider.synthesize(chunk, voice, signal);
    await play(out.audio, out.format, signal);
  }
}

export async function speakText(text: string, cfg: CliConfig, deps: SpeakDeps = {}): Promise<{ ok: boolean; spoken: string; error?: string }> {
  try {
    // Summary scope: clean WITHOUT the length cap (capping first would cut
    // the tail of a long reply, exactly where the ask to the user lives),
    // summarize, then cap the spoken result instead.
    let spoken = cleanForSpeech(text, cfg.scope === "summary"
      ? { scope: "full", maxChars: Number.MAX_SAFE_INTEGER }
      : { scope: cfg.scope, maxChars: cfg.maxChars });
    if (!spoken.trim()) return { ok: false, spoken: "" };
    if (cfg.scope === "summary") {
      const s = await summarize(spoken);
      spoken = capLength(s ? s.text : firstParagraph(spoken), cfg.maxChars);
    }
    const chunks = buildChunks(parseDocument(spoken, "talktomebaby-cli://agent", 0));
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
