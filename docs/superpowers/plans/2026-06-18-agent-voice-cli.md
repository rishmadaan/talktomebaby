# Agent-Voice CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `talktomebaby` terminal CLI — the agent-voice member of the suite — that reads an AI agent's latest turn aloud (Claude Code / Codex), via a Stop hook or standalone, using the shared `@talktomebaby/engine`.

**Architecture:** A new `packages/cli` workspace package (npm `bin: talktomebaby`). It ports Mycroft's pure speech logic (clean-text, transcript reading, summarizer) to TypeScript, adds Codex transcript support, a cross-platform XDG config with env-first key resolution, a provider factory over the engine's providers, the agent-voice orchestration (read → clean → optional summarize → synthesize via engine → play via engine), idempotent Stop-hook installers, and the CLI entrypoint. Hard rule (ported from Mycroft): the agent command NEVER blocks the host — every path exits 0.

**Tech Stack:** TypeScript (CommonJS, ES2022), vitest. Depends on `@talktomebaby/engine`. Builds on branch `feat/monorepo-engine-extraction`.

## Global Constraints

- Build on the existing branch `feat/monorepo-engine-extraction`. Do not create new branches.
- Independence: the CLI must NOT depend on Mycroft or `~/labs/env`. Keys resolve from env vars first (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `SARVAM_API_KEY`, `GEMINI_API_KEY`), then `~/.config/talktomebaby/config.json` (respect `XDG_CONFIG_HOME`). Edge TTS + macOS say need no key.
- Reuse the engine; do not reimplement synthesis or playback. Import from `@talktomebaby/engine`: `parseDocument`, `buildChunks`, `EdgeProvider`, `SayProvider`, `OpenAIProvider`, `ElevenLabsProvider`, `SarvamProvider`, `TtsProvider`, `play`, `NoPlayerError`, `resolveProviderId`.
- Provider constructors (verified): `new EdgeProvider()`, `new SayProvider()` take no key; `new OpenAIProvider(key)`, `new ElevenLabsProvider(key)`, `new SarvamProvider(key)` take an api key string.
- Default provider: Edge TTS (free, cross-platform, no key).
- The `agent` command must never throw to the host: wrap everything, log errors to a file under `os.tmpdir()` or `$XDG_STATE_HOME`, and `process.exit(0)` on every path.
- TypeScript strict mode. No em dashes in any prose or generated content.
- Do NOT run `git add`/`git commit` (the orchestrator commits). Verify via `npm test -w talktomebaby-cli` and `npm run build -w talktomebaby-cli`.
- The `say` ad-hoc command is OUT of scope (cut from v1).

## Reference source to port (read these exact files; preserve behavior)

- `/Users/rish/labs/projects/mycroft/tools/lib/clean-text.js` → `clean-text.ts` (pure; direct TS port).
- `/Users/rish/labs/projects/mycroft/tools/lib/transcript.js` → `transcripts/claude.ts` (Claude JSONL reader; direct TS port).
- `/Users/rish/labs/projects/mycroft/tools/lib/summarize.js` → `summarize.ts` (Gemini→OpenAI; port, but take keys from the CLI config/env, not Mycroft's settings).

If those files are unreadable from the sandbox, the test code in each task is the authoritative behavioral contract — implement to satisfy the tests.

## Target File Structure

```
packages/cli/
  package.json            name "talktomebaby-cli"; bin { talktomebaby: dist/cli.js }; deps @talktomebaby/engine
  tsconfig.json
  vitest.config.ts
  src/
    cli.ts                arg parsing + command dispatch (the bin entry)
    config.ts             XDG config load/save + env-first key resolution
    clean-text.ts         ported (pure)
    summarize.ts          ported (Gemini→OpenAI), keys via config
    transcripts/
      claude.ts           ported Claude JSONL reader
      codex.ts            NEW Codex rollout reader
      index.ts            detectHost + lastAssistantText dispatch
    providers.ts          provider factory (config -> engine TtsProvider)
    agent-voice.ts        orchestration: read -> clean -> [summarize] -> synth -> play
    hooks/
      claude.ts           idempotent Stop-hook installer for Claude Code
      codex.ts            idempotent Stop-hook installer for Codex
    *.test.ts             colocated tests
```

---

### Task 1: CLI package scaffold + config

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/vitest.config.ts`
- Create: `packages/cli/src/config.ts`, `packages/cli/src/config.test.ts`

**Interfaces produced:**
- `export interface CliConfig { enabled: boolean; provider: string; voice: Record<string,string>; scope: "full"|"first-paragraph"|"summary"; maxChars: number }`
- `export function loadConfig(): CliConfig` / `export function saveConfig(c: CliConfig): CliConfig`
- `export function configPath(): string` (respects `XDG_CONFIG_HOME`, else `~/.config/talktomebaby/config.json`)
- `export function resolveKey(provider: string): string | undefined` (env var first, then config `keys` map)
- `export const DEFAULT_CONFIG: CliConfig`

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "talktomebaby-cli",
  "version": "0.1.0",
  "license": "MIT",
  "type": "commonjs",
  "bin": { "talktomebaby": "dist/cli.js" },
  "files": ["dist"],
  "scripts": {
    "build": "esbuild src/cli.ts --bundle --outfile=dist/cli.js --platform=node --format=cjs --banner:js=\"#!/usr/bin/env node\" && chmod +x dist/cli.js",
    "test": "vitest run"
  },
  "dependencies": { "@talktomebaby/engine": "*" },
  "devDependencies": { "@types/node": "^20.0.0", "esbuild": "^0.28.0", "typescript": "^5.3.0", "vitest": "^3.0.0" }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`** (same compilerOptions as the engine; rootDir src, outDir dist, no declaration needed)

```json
{
  "compilerOptions": {
    "module": "commonjs", "target": "ES2022", "outDir": "dist", "rootDir": "src",
    "lib": ["ES2022"], "sourceMap": true, "strict": true, "esModuleInterop": true,
    "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `packages/cli/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"], passWithNoTests: true } });
```

- [ ] **Step 4: Write the failing test `packages/cli/src/config.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "ttmb-cfg-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.OPENAI_API_KEY;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("config", () => {
  it("configPath honors XDG_CONFIG_HOME", async () => {
    const { configPath } = await import("./config");
    expect(configPath()).toBe(join(dir, "talktomebaby", "config.json"));
  });

  it("loadConfig returns defaults when no file exists (disabled, edge, full)", async () => {
    const { loadConfig } = await import("./config");
    const c = loadConfig();
    expect(c.enabled).toBe(false);
    expect(c.provider).toBe("edge");
    expect(c.scope).toBe("full");
  });

  it("saveConfig then loadConfig round-trips", async () => {
    const { loadConfig, saveConfig } = await import("./config");
    saveConfig({ ...loadConfig(), enabled: true, provider: "openai" });
    const c = loadConfig();
    expect(c.enabled).toBe(true);
    expect(c.provider).toBe("openai");
  });

  it("resolveKey prefers env var over config", async () => {
    const { resolveKey, saveConfig, loadConfig } = await import("./config");
    saveConfig({ ...loadConfig(), keys: { openai: "from-config" } } as any);
    process.env.OPENAI_API_KEY = "from-env";
    expect(resolveKey("openai")).toBe("from-env");
    delete process.env.OPENAI_API_KEY;
    expect(resolveKey("openai")).toBe("from-config");
  });
});
```

- [ ] **Step 5: Run test to verify it fails** — `npm install` (root) then `npm test -w talktomebaby-cli -- config`. Expected: FAIL (module not found).

- [ ] **Step 6: Implement `packages/cli/src/config.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface CliConfig {
  enabled: boolean;
  provider: string;
  voice: Record<string, string>;
  scope: "full" | "first-paragraph" | "summary";
  maxChars: number;
  keys?: Record<string, string>;
}

export const DEFAULT_CONFIG: CliConfig = {
  enabled: false,
  provider: "edge",
  voice: { edge: "en-US-AriaNeural", say: "Samantha", openai: "alloy", elevenlabs: "21m00Tcm4TlvDq8ikWAM", sarvam: "shubh" },
  scope: "full",
  maxChars: 4000,
};

const ENV_KEY: Record<string, string> = {
  openai: "OPENAI_API_KEY", elevenlabs: "ELEVENLABS_API_KEY", sarvam: "SARVAM_API_KEY", gemini: "GEMINI_API_KEY",
};

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "talktomebaby", "config.json");
}

export function loadConfig(): CliConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    return { ...DEFAULT_CONFIG, ...raw, voice: { ...DEFAULT_CONFIG.voice, ...(raw.voice || {}) } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(c: CliConfig): CliConfig {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(c, null, 2));
  return c;
}

export function resolveKey(provider: string): string | undefined {
  const env = ENV_KEY[provider] && process.env[ENV_KEY[provider]];
  if (env) return env;
  return loadConfig().keys?.[provider];
}
```

- [ ] **Step 7: Run tests + build** — `npm test -w talktomebaby-cli` then `npm run build -w talktomebaby-cli`. Expected: config tests pass; build exits 0 (note: `cli.ts` does not exist yet, so temporarily the build script will fail — skip the build check until Task 6; just confirm tests pass here).

- [ ] **Step 8: Report DONE** with test results.

---

### Task 2: clean-text port + transcript readers

**Files:**
- Create: `packages/cli/src/clean-text.ts` (+ `clean-text.test.ts`)
- Create: `packages/cli/src/transcripts/claude.ts`, `packages/cli/src/transcripts/codex.ts`, `packages/cli/src/transcripts/index.ts` (+ `transcripts/transcripts.test.ts`)

**Interfaces produced:**
- clean-text: `stripMarkdown(s): string`, `firstParagraph(s): string`, `capLength(s, n): string`, `cleanForSpeech(s, {scope, maxChars}): string`
- transcripts: `lastAssistantTextClaude(jsonl): string`, `lastAssistantTextCodex(jsonl): string`, `detectHost(path): "claude"|"codex"|"unknown"`, `lastAssistantText(jsonl, host): string`

- [ ] **Step 1: Port clean-text** — translate `/Users/rish/labs/projects/mycroft/tools/lib/clean-text.js` to TypeScript at `packages/cli/src/clean-text.ts` verbatim in behavior (same regexes, same `CODE_PLACEHOLDER`, same `cleanForSpeech(text, {scope, maxChars})` pipeline), converting `module.exports` to named `export`.

- [ ] **Step 2: clean-text test `packages/cli/src/clean-text.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { stripMarkdown, firstParagraph, capLength, cleanForSpeech } from "./clean-text";

describe("clean-text", () => {
  it("strips fenced code to a placeholder", () => {
    expect(stripMarkdown("a\n```\ncode\n```\nb")).toContain("code block omitted");
  });
  it("keeps link text, drops the url", () => {
    expect(stripMarkdown("see [docs](http://x)")).toBe("see docs");
  });
  it("removes heading and bullet markers", () => {
    expect(stripMarkdown("# Title\n- one\n- two")).not.toMatch(/[#*]/);
  });
  it("firstParagraph returns up to the first blank line", () => {
    expect(firstParagraph("one\n\ntwo")).toBe("one");
  });
  it("capLength truncates at a word boundary with an ellipsis", () => {
    const out = capLength("alpha beta gamma delta", 12);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(14);
  });
  it("cleanForSpeech full pipeline applies scope", () => {
    expect(cleanForSpeech("# H\n\nsecond", { scope: "first-paragraph", maxChars: 4000 })).toBe("H");
  });
});
```

- [ ] **Step 3: Port the Claude reader** — translate `/Users/rish/labs/projects/mycroft/tools/lib/transcript.js` to `packages/cli/src/transcripts/claude.ts`, exporting `lastAssistantTextClaude(jsonl: string): string` (same logic: find text after the last genuine human prompt; tool_result-only user lines do not reset the turn).

- [ ] **Step 4: Write the NEW Codex reader `packages/cli/src/transcripts/codex.ts`**

Codex rollout JSONL lines look like `{"type":"response_item","payload":{"type":"message","role":"assistant"|"user"|"developer","content":[{"type":"output_text"|"input_text","text":"..."}]}}`. The last assistant turn is the concatenation of `output_text` from `role:"assistant"` messages that appear after the last real user prompt (a `role:"user"` message with an `input_text` block).

```ts
interface CodexBlock { type?: string; text?: string }
interface CodexMsg { type?: string; role?: string; content?: CodexBlock[] }
interface CodexLine { type?: string; payload?: CodexMsg }

function parse(jsonl: string): CodexLine[] {
  const out: CodexLine[] = [];
  for (const line of String(jsonl).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* tolerate */ }
  }
  return out;
}

function msg(l: CodexLine): CodexMsg | null {
  return l && l.type === "response_item" && l.payload && l.payload.type === "message" ? l.payload : null;
}
function blockText(m: CodexMsg, kind: string): string {
  return (m.content || []).filter((b) => b && b.type === kind && typeof b.text === "string").map((b) => b.text as string).join("");
}

export function lastAssistantTextCodex(jsonl: string): string {
  const lines = parse(jsonl);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = msg(lines[i]);
    if (m && m.role === "user" && blockText(m, "input_text").trim()) { start = i + 1; break; }
  }
  const texts: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const m = msg(lines[i]);
    if (m && m.role === "assistant") {
      const t = blockText(m, "output_text") || blockText(m, "text");
      if (t) texts.push(t);
    }
  }
  return texts.join("\n\n").trim();
}
```

- [ ] **Step 5: Write the dispatch `packages/cli/src/transcripts/index.ts`**

```ts
import { lastAssistantTextClaude } from "./claude";
import { lastAssistantTextCodex } from "./codex";

export { lastAssistantTextClaude, lastAssistantTextCodex };

export function detectHost(transcriptPath: string): "claude" | "codex" | "unknown" {
  const p = transcriptPath || "";
  if (p.includes("/.codex/") || /rollout-.*\.jsonl$/.test(p)) return "codex";
  if (p.includes("/.claude/")) return "claude";
  return "unknown";
}

export function lastAssistantText(jsonl: string, host: "claude" | "codex"): string {
  return host === "codex" ? lastAssistantTextCodex(jsonl) : lastAssistantTextClaude(jsonl);
}
```

- [ ] **Step 6: transcripts test `packages/cli/src/transcripts/transcripts.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { lastAssistantTextClaude, lastAssistantTextCodex, detectHost, lastAssistantText } from "./index";

const claudeJsonl = [
  JSON.stringify({ type: "user", message: { role: "user", content: "old q" } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "old answer" }] } }),
  JSON.stringify({ type: "user", message: { role: "user", content: "new q" } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "Hello" }] } }),
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x" }] } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "world" }] } }),
].join("\n");

const codexJsonl = [
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "new q" }] } }),
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex answer" }] } }),
].join("\n");

describe("transcript readers", () => {
  it("claude reader returns only the final turn's text blocks", () => {
    expect(lastAssistantTextClaude(claudeJsonl)).toBe("Hello\n\nworld");
  });
  it("codex reader returns the assistant output after the last user prompt", () => {
    expect(lastAssistantTextCodex(codexJsonl)).toBe("Codex answer");
  });
  it("detectHost infers from path", () => {
    expect(detectHost("/home/u/.codex/sessions/2026/rollout-x.jsonl")).toBe("codex");
    expect(detectHost("/home/u/.claude/projects/p/abc.jsonl")).toBe("claude");
  });
  it("lastAssistantText dispatches by host", () => {
    expect(lastAssistantText(codexJsonl, "codex")).toBe("Codex answer");
  });
});
```

- [ ] **Step 7: Run tests** — `npm test -w talktomebaby-cli`. Expected: clean-text + transcript tests pass (plus Task 1 config tests).

- [ ] **Step 8: Report DONE** with test count.

---

### Task 3: summarizer port + provider factory

**Files:**
- Create: `packages/cli/src/summarize.ts` (+ `summarize.test.ts`)
- Create: `packages/cli/src/providers.ts` (+ `providers.test.ts`)

**Interfaces produced:**
- `export async function summarize(text: string): Promise<{ text: string; provider: string } | null>` (Gemini→OpenAI, keys via `resolveKey`)
- `export function makeProvider(providerId: string): TtsProvider` (throws a clear error if a required key is missing)

- [ ] **Step 1: Port the summarizer** — translate `/Users/rish/labs/projects/mycroft/tools/lib/summarize.js` to `packages/cli/src/summarize.ts`, preserving the prompt, the Gemini-models fallthrough, the 8s timeout, and the Gemini→OpenAI order. CHANGE: replace Mycroft's `getKey(provider)` with `resolveKey(provider)` from `./config`, and `SUMMARIZERS` with the literal `["gemini","openai"]`.

- [ ] **Step 2: summarizer test `packages/cli/src/summarize.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete process.env.GEMINI_API_KEY; delete process.env.OPENAI_API_KEY; });

describe("summarize", () => {
  it("returns null when no summarizer key is set", async () => {
    const { summarize } = await import("./summarize");
    expect(await summarize("hello")).toBeNull();
  });
  it("uses Gemini when GEMINI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "g";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "digest" }] } }] }) })));
    const { summarize } = await import("./summarize");
    expect(await summarize("long text")).toEqual({ text: "digest", provider: "gemini" });
  });
});
```

- [ ] **Step 3: Write `packages/cli/src/providers.ts`**

```ts
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
```

- [ ] **Step 4: providers test `packages/cli/src/providers.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { makeProvider } from "./providers";

afterEach(() => { delete process.env.OPENAI_API_KEY; });

describe("makeProvider", () => {
  it("builds keyless providers", () => {
    expect(makeProvider("edge").id).toBe("edge");
    expect(makeProvider("say").id).toBe("say");
  });
  it("builds a keyed provider when the env key is present", () => {
    process.env.OPENAI_API_KEY = "k";
    expect(makeProvider("openai").id).toBe("openai");
  });
  it("throws a clear error when a required key is missing", () => {
    expect(() => makeProvider("elevenlabs")).toThrow(/Missing API key for elevenlabs/);
  });
  it("falls back to edge for an unknown id", () => {
    expect(makeProvider("nope").id).toBe("edge");
  });
});
```

- [ ] **Step 5: Run tests** — `npm test -w talktomebaby-cli`. Expected: summarizer + provider tests pass.

- [ ] **Step 6: Report DONE** with test count.

---

### Task 4: agent-voice orchestration

**Files:**
- Create: `packages/cli/src/agent-voice.ts` (+ `agent-voice.test.ts`)

**Interfaces produced:**
- `export interface SpeakDeps { synthesizeAndPlay?: (chunks, providerId, voice, signal) => Promise<void> }` (injection seam for tests)
- `export async function speakText(text: string, cfg: CliConfig, deps?: SpeakDeps): Promise<{ ok: boolean; spoken: string }>` — clean → (scope summary?) summarize → cap → parseDocument → buildChunks → for each chunk: provider.synthesize → play. Returns the spoken string. Never throws.

- [ ] **Step 1: Write the failing test `packages/cli/src/agent-voice.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { speakText } from "./agent-voice";
import { DEFAULT_CONFIG } from "./config";

describe("speakText", () => {
  it("cleans markdown and plays each chunk via the injected sink", async () => {
    const played: string[] = [];
    const res = await speakText("# Hi\n\nthis is a [test](http://x).", { ...DEFAULT_CONFIG, provider: "edge" }, {
      synthesizeAndPlay: async (chunks) => { for (const c of chunks) played.push(c.text); },
    });
    expect(res.ok).toBe(true);
    expect(res.spoken).toContain("Hi");
    expect(res.spoken).not.toMatch(/[#\[\]]/);
    expect(played.join(" ")).toContain("test");
  });

  it("never throws and reports ok:false when the sink fails", async () => {
    const res = await speakText("hello", { ...DEFAULT_CONFIG }, {
      synthesizeAndPlay: async () => { throw new Error("boom"); },
    });
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for empty text without calling the sink", async () => {
    const sink = vi.fn();
    const res = await speakText("   ", { ...DEFAULT_CONFIG }, { synthesizeAndPlay: sink });
    expect(res.ok).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -w talktomebaby-cli -- agent-voice`. Expected: FAIL.

- [ ] **Step 3: Implement `packages/cli/src/agent-voice.ts`**

```ts
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

export async function speakText(text: string, cfg: CliConfig, deps: SpeakDeps = {}): Promise<{ ok: boolean; spoken: string }> {
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
  } catch {
    return { ok: false, spoken: "" };
  }
}
```

- [ ] **Step 4: Run tests** — `npm test -w talktomebaby-cli`. Expected: agent-voice tests pass.

- [ ] **Step 5: Report DONE** with test count.

---

### Task 5: hook installers

**Files:**
- Create: `packages/cli/src/hooks/claude.ts`, `packages/cli/src/hooks/codex.ts` (+ `hooks/hooks.test.ts`)

**Interfaces produced:**
- `installClaudeHook(settingsPath: string): { changed: boolean }` — idempotently add a `Stop` hook running `talktomebaby agent --agent claude` to a Claude `settings.json` (create file if missing, preserve other keys, do not duplicate).
- `installCodexHook(hooksPath: string): { changed: boolean }` — same for a Codex `.codex/hooks.json` `Stop` hook running `talktomebaby agent --agent codex`.

- [ ] **Step 1: Write the failing test `packages/cli/src/hooks/hooks.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installClaudeHook } from "./claude";
import { installCodexHook } from "./codex";

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), "ttmb-hook-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("installClaudeHook", () => {
  it("creates settings with a Stop hook and is idempotent", () => {
    const p = join(dir, "settings.json");
    expect(installClaudeHook(p).changed).toBe(true);
    const after = JSON.parse(readFileSync(p, "utf8"));
    const cmds = after.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds.some((c: string) => c.includes("talktomebaby agent"))).toBe(true);
    expect(installClaudeHook(p).changed).toBe(false); // second run = no change
    const cmds2 = JSON.parse(readFileSync(p, "utf8")).hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds2.filter((c: string) => c.includes("talktomebaby agent")).length).toBe(1); // no dup
  });

  it("preserves unrelated existing settings", async () => {
    const p = join(dir, "settings.json");
    await fs.writeFile(p, JSON.stringify({ model: "x", hooks: {} }));
    installClaudeHook(p);
    expect(JSON.parse(readFileSync(p, "utf8")).model).toBe("x");
  });
});

describe("installCodexHook", () => {
  it("creates hooks.json with a Stop hook and is idempotent", () => {
    const p = join(dir, "hooks.json");
    expect(installCodexHook(p).changed).toBe(true);
    expect(installCodexHook(p).changed).toBe(false);
    const cmds = JSON.parse(readFileSync(p, "utf8")).hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds.filter((c: string) => c.includes("talktomebaby agent")).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -w talktomebaby-cli -- hooks`. Expected: FAIL.

- [ ] **Step 3: Implement `packages/cli/src/hooks/claude.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const MARKER = "talktomebaby agent";

export function installClaudeHook(settingsPath: string): { changed: boolean } {
  let cfg: any = {};
  if (existsSync(settingsPath)) { try { cfg = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { cfg = {}; } }
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
  const present = cfg.hooks.Stop.some((g: any) => (g.hooks || []).some((h: any) => typeof h.command === "string" && h.command.includes(MARKER)));
  if (present) return { changed: false };
  cfg.hooks.Stop.push({ hooks: [{ type: "command", command: "talktomebaby agent --agent claude" }] });
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(cfg, null, 2));
  return { changed: true };
}
```

- [ ] **Step 4: Implement `packages/cli/src/hooks/codex.ts`** (same shape; command `talktomebaby agent --agent codex`)

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const MARKER = "talktomebaby agent";

export function installCodexHook(hooksPath: string): { changed: boolean } {
  let cfg: any = {};
  if (existsSync(hooksPath)) { try { cfg = JSON.parse(readFileSync(hooksPath, "utf8")); } catch { cfg = {}; } }
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
  const present = cfg.hooks.Stop.some((g: any) => (g.hooks || []).some((h: any) => typeof h.command === "string" && h.command.includes(MARKER)));
  if (present) return { changed: false };
  cfg.hooks.Stop.push({ hooks: [{ type: "command", command: "talktomebaby agent --agent codex" }] });
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(cfg, null, 2));
  return { changed: true };
}
```

- [ ] **Step 5: Run tests** — `npm test -w talktomebaby-cli`. Expected: hook tests pass.

- [ ] **Step 6: Report DONE** with test count.

---

### Task 6: CLI entry + integration gate

**Files:**
- Create: `packages/cli/src/cli.ts`
- Modify: root build/test already cover the workspace.

**Interfaces consumed:** all prior tasks.

- [ ] **Step 1: Implement `packages/cli/src/cli.ts`**

```ts
import { readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { appendFileSync } from "fs";
import { join } from "path";
import { loadConfig, saveConfig } from "./config";
import { detectHost, lastAssistantText } from "./transcripts/index";
import { speakText } from "./agent-voice";
import { installClaudeHook } from "./hooks/claude";
import { installCodexHook } from "./hooks/codex";

const LOG = join(tmpdir(), "talktomebaby.log");
function log(m: string) { try { appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch { /* never throw */ } }

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

async function runAgent(argv: string[]): Promise<void> {
  // NEVER throws to the host: every path resolves and the caller exits 0.
  try {
    const cfg = loadConfig();
    if (!cfg.enabled) return;
    const agentArg = argFor(argv, "--agent");
    const tpArg = argFor(argv, "--transcript");
    let host = (agentArg as "claude" | "codex" | "auto") || "auto";
    let jsonl = "";
    let transcriptPath = tpArg || "";
    if (!transcriptPath) {
      const stdin = readStdin();
      try { const hook = JSON.parse(stdin); transcriptPath = hook.transcript_path || ""; } catch { /* not hook json */ }
    }
    if (transcriptPath) jsonl = readFileSync(transcriptPath, "utf8");
    const resolvedHost = host === "auto" ? detectHost(transcriptPath) : host;
    if (resolvedHost === "unknown") return;
    const text = lastAssistantText(jsonl, resolvedHost);
    if (!text.trim()) return;
    await speakText(text, cfg);
  } catch (e) {
    log(`agent error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function argFor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "agent": await runAgent(rest); return 0; // ALWAYS 0
    case "on": { saveConfig({ ...loadConfig(), enabled: true }); console.log("talktomebaby voice ON"); return 0; }
    case "off": { saveConfig({ ...loadConfig(), enabled: false }); console.log("talktomebaby voice OFF"); return 0; }
    case "toggle": { const c = loadConfig(); saveConfig({ ...c, enabled: !c.enabled }); console.log(`talktomebaby voice ${!c.enabled ? "ON" : "OFF"}`); return 0; }
    case "status": { const c = loadConfig(); console.log(`talktomebaby voice ${c.enabled ? "ON" : "OFF"} (${c.provider}, ${c.scope})`); return 0; }
    case "config": { return doConfig(rest); }
    case "install": {
      const target = rest[0];
      if (target === "claude") { const p = join(homedir(), ".claude", "settings.json"); console.log(installClaudeHook(p).changed ? `Installed Claude hook at ${p}` : `Claude hook already present at ${p}`); return 0; }
      if (target === "codex") { const p = join(homedir(), ".codex", "hooks.json"); console.log(installCodexHook(p).changed ? `Installed Codex hook at ${p}` : `Codex hook already present at ${p}`); return 0; }
      console.error("usage: talktomebaby install <claude|codex>"); return 1;
    }
    default:
      console.log("talktomebaby <agent|install|on|off|toggle|status|config>");
      return cmd ? 1 : 0;
  }
}

function doConfig(rest: string[]): number {
  const c = loadConfig();
  if (rest.length === 0) { console.log(JSON.stringify(c, null, 2)); return 0; }
  const [key, value] = rest;
  if (key === "provider" && value) { saveConfig({ ...c, provider: value }); console.log(`provider = ${value}`); return 0; }
  if (key === "scope" && (value === "full" || value === "first-paragraph" || value === "summary")) { saveConfig({ ...c, scope: value }); console.log(`scope = ${value}`); return 0; }
  console.error("usage: talktomebaby config [provider <id> | scope <full|first-paragraph|summary>]"); return 1;
}

main().then((code) => process.exit(code)).catch((e) => { log(`fatal: ${e}`); process.exit(0); });
```

- [ ] **Step 2: Build the CLI** — `npm run build -w talktomebaby-cli`. Expected: `packages/cli/dist/cli.js` produced, exits 0.

- [ ] **Step 3: Smoke-test the bin** (no audio — exercises arg paths):

```bash
node packages/cli/dist/cli.js status
# Install into a temp HOME so the smoke test never mutates the real ~/.claude / ~/.codex:
HOME=$(mktemp -d) node packages/cli/dist/cli.js install claude
HOME=$(mktemp -d) node packages/cli/dist/cli.js install codex
echo '{}' | node packages/cli/dist/cli.js agent --agent auto    # disabled by default -> exits 0, no output
```
Expected: `status` prints OFF; `install` prints an "Installed ... hook" line; `agent` exits 0 silently (voice disabled by default). All exit 0.

- [ ] **Step 4: Full workspace gate** — from repo root: `npm run build` then `npm test`. Expected: all packages build; all tests pass (engine 69 + extension 18 + CLI tests).

- [ ] **Step 5: Report DONE** with the full test total and the smoke-test outputs.

---

## Self-Review

**Spec coverage (against the design spec's CLI section):**
- `agent` (hook + standalone, claude/codex/auto): Tasks 4 + 6. ✓
- `install <claude|codex>` idempotent onboarding: Tasks 5 + 6. ✓
- `on/off/toggle/status` + `config`: Task 6. ✓
- Edge default, keyless-by-default, env-first keys (independent of Mycroft/`~/labs/env`): Task 1. ✓
- Scope full/first-paragraph/summary (Gemini→OpenAI): Tasks 3 + 4. ✓
- Reuses the engine (parseDocument/buildChunks/providers/play): Tasks 3 + 4. ✓
- Never blocks the host (exit 0): Task 6 `runAgent` + `main().catch`. ✓
- `say` command: correctly omitted (cut from v1).

**Placeholder scan:** New code shown in full; ports name the exact source file and are pinned by full test code. All commands have expected output.

**Type consistency:** `CliConfig` (Task 1) flows through `speakText` (Task 4) and `cli.ts` (Task 6). `makeProvider` (Task 3) returns the engine `TtsProvider`; `speakText`'s default sink uses it + `play`. Transcript dispatch (`detectHost`/`lastAssistantText`, Task 2) matches `cli.ts` usage.
