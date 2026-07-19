import { resolveKey } from "./config";

// Gemini models tried in order, Flash-Lite first: a per-turn summarizer is a
// high-volume cheap task, and Lite has higher free-tier limits and is not
// demand-throttled like premium Flash. Fall through on 429/404/503. Premium
// Flash is deliberately omitted since it uses scarce free quota for no quality
// gain on a digest.
export const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
export const OPENAI_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 8000;
const SUMMARIZERS = ["gemini", "openai"] as const;

function buildPrompt(text: string): string {
  return [
    "You are summarizing an AI assistant's reply, to be read aloud to the user while they work.",
    "Goal: the user gets EVERY distinct point without reading the full message, and it sounds good spoken.",
    "",
    "How to write it:",
    "- Cover each distinct point, result, decision, or action, point by point, ordered by importance, leading with the bottom line or anything that needs the user's attention.",
    "- ALWAYS include any request, question, invitation, or next step directed at the user, even soft or casual ones like \"tell me if...\", \"let me know...\", or \"want me to...\". This is the most important part.",
    "- End with that ask as the final sentence, so it is the last thing the user hears. If you must cut for length, cut detail, never the ask.",
    "- Speak naturally in the first person as the assistant: \"I\" for the assistant, \"you\" for the user. Conversational, not formal.",
    "- Signpost (\"First... then... also...\") only when there are three or more substantial, distinct points. For a single point or a few quick related actions, just say it in one or two natural sentences, do not force signposting.",
    "- Say each point once. Do not restate the same point at the start and end.",
    "- Be faithful to the message only. Do not invent, pad, soften, or add preamble like \"Summary:\" or \"In short\".",
    "- Never use markdown, bullets, numbering symbols, or headings; this is spoken, not written.",
    "- Do not read literal identifiers that sound bad aloud (file paths, code, long IDs, hashes, URLs); say them in plain words or skip them.",
    "- Be as tight as possible while still covering every point; never exceed about six short sentences.",
    "",
    "Message to summarize:",
    String(text).slice(0, 12000),
  ].join("\n");
}

// fetch with an abort timeout so a hung API never stalls the Stop hook.
async function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

interface GeminiPart {
  text?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: GeminiPart[];
    };
  }[];
}

async function summarizeGemini(text: string): Promise<string | null> {
  const key = resolveKey("gemini");
  if (!key) return null;
  let lastErr: unknown = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        // Key in a header, not the query string, so it cannot leak into logs.
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt(text) }] }] }),
      });
      if (!res.ok) {
        // 429 quota / 404 missing / 503 transient: try the next model.
        if (res.status === 429 || res.status === 404 || res.status === 503) {
          lastErr = new Error(`gemini ${model} ${res.status}`);
          continue;
        }
        throw new Error(`gemini ${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);
      }
      const json = (await res.json()) as GeminiResponse;
      const parts = json?.candidates?.[0]?.content?.parts;
      const out = parts?.map((p) => p.text).join(" ");
      if (out && out.trim()) return out.trim();
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

interface OpenAIResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

async function summarizeOpenAI(text: string): Promise<string | null> {
  const key = resolveKey("openai");
  if (!key) return null;
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: buildPrompt(text) }],
      max_tokens: 200,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as OpenAIResponse;
  const out = json?.choices?.[0]?.message?.content;
  return out ? out.trim() : null;
}

const SUMMARIZER_FNS: Record<(typeof SUMMARIZERS)[number], (text: string) => Promise<string | null>> = {
  gemini: summarizeGemini,
  openai: summarizeOpenAI,
};

export async function summarize(text: string): Promise<{ text: string; provider: string } | null> {
  if (!text || !text.trim()) return null;
  for (const provider of SUMMARIZERS) {
    const fn = SUMMARIZER_FNS[provider];
    try {
      const out = await fn(text);
      if (out) return { text: out, provider };
    } catch {
      // try the next summarizer
    }
  }
  return null;
}
