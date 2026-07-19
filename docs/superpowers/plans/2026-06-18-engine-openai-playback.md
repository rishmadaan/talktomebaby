# Engine Additions: OpenAI Provider + Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenAI TTS provider and a cross-platform Node audio-playback module to `@talktomebaby/engine`, so the upcoming terminal CLI (next plan) has the union of providers and can play synthesized audio on macOS/Linux/Windows.

**Architecture:** Add `synthesis/openai.ts` implementing the existing `TtsProvider` interface (ported from Mycroft's `prepareOpenAI`), register it in the provider catalog and barrel. Add a new `playback/` submodule with a pure `detectPlayer` chooser and a `play`/`playWith` runner. VS Code is unaffected (it plays in the webview); playback is for Node consumers only.

**Tech Stack:** TypeScript (CommonJS, ES2022), vitest. Builds on branch `feat/monorepo-engine-extraction`.

## Global Constraints

- Build on the existing branch `feat/monorepo-engine-extraction`. Do not create new branches.
- Engine must stay free of `vscode` imports. `core` stays Node-free; `synthesis` and the new `playback/` may use Node APIs.
- Follow the existing `TtsProvider` interface exactly (do not change it): `synthesize(chunk, voice, signal) => { audio: Uint8Array; format: "mp3" | "wav"; timings: ChunkTimings }`.
- TypeScript strict mode stays on. No em dashes in any prose or generated content.
- The engine's existing 58 tests must stay green; new code is TDD (test first).
- Do NOT run `git add`/`git commit` (the orchestrator commits). Use the engine build (`npm run build -w @talktomebaby/engine`) and tests (`npm test -w @talktomebaby/engine`) to verify.

## Reference types (already in the engine)

```ts
// core/chunker.ts
export interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }
// core/timing.ts
export interface ChunkTimings { unit: "ms" | "fraction"; words: WordTiming[] }
export function estimatedTimings(chunk: Chunk): ChunkTimings;
// synthesis/provider.ts
export interface ChunkAudio { audio: Uint8Array; format: "mp3" | "wav"; timings: ChunkTimings }
export interface TtsProvider { readonly id; readonly label; readonly requiresKey; readonly timingQuality; readonly maxCharsPerRequest; readonly defaultVoice; listVoices(): Promise<VoiceInfo[]>; synthesize(chunk, voice, signal): Promise<ChunkAudio> }
```

## Target File Structure

```
packages/engine/src/
  synthesis/
    openai.ts          NEW: OpenAIProvider
    openai.test.ts     NEW
    provider-catalog.ts   MODIFY: add openai entry
  playback/
    index.ts           NEW: detectPlayer, play, playWith, NoPlayerError, PlayerSpec
    playback.test.ts   NEW
  index.ts             MODIFY: export OpenAIProvider + playback
```

---

### Task 1: OpenAI provider

**Files:**
- Create: `packages/engine/src/synthesis/openai.ts`
- Create: `packages/engine/src/synthesis/openai.test.ts`
- Modify: `packages/engine/src/synthesis/provider-catalog.ts` (add the `openai` entry)
- Modify: `packages/engine/src/index.ts` (export `OpenAIProvider`)

**Interfaces:**
- Consumes: `Chunk` (core/chunker), `estimatedTimings` (core/timing), `ChunkAudio`, `TtsProvider`, `VoiceInfo` (synthesis/provider).
- Produces: `export class OpenAIProvider implements TtsProvider` with `constructor(private apiKey: string)`; catalog entry `{ id: "openai", label: "OpenAI", description: "Premium · estimated timing", requiresKey: true }`.

- [ ] **Step 1: Write the failing test `packages/engine/src/synthesis/openai.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "./openai";
import { Chunk } from "../core/chunker";

const chunk: Chunk = { index: 0, text: "Hello world.", sentenceIndexes: [0], words: [] };

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIProvider", () => {
  it("has the expected static descriptor", () => {
    const p = new OpenAIProvider("k");
    expect(p.id).toBe("openai");
    expect(p.requiresKey).toBe(true);
    expect(p.timingQuality).toBe("estimated");
    expect(p.defaultVoice).toBe("alloy");
  });

  it("lists known OpenAI voices including alloy", async () => {
    const ids = (await new OpenAIProvider("k").listVoices()).map((v) => v.id);
    expect(ids).toContain("alloy");
    expect(ids).toContain("nova");
  });

  it("POSTs to the speech endpoint and returns mp3 audio with estimated timings", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await new OpenAIProvider("secret").synthesize(chunk, "nova", new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.headers.authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-4o-mini-tts", input: "Hello world.", voice: "nova", response_format: "mp3" });
    expect(out.format).toBe("mp3");
    expect(Array.from(out.audio)).toEqual([1, 2, 3, 4]);
    expect(out.timings.words).toBeDefined();
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key" })));
    await expect(new OpenAIProvider("k").synthesize(chunk, "alloy", new AbortController().signal)).rejects.toThrow(/OpenAI 401/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @talktomebaby/engine -- openai`
Expected: FAIL (`OpenAIProvider` not found).

- [ ] **Step 3: Implement `packages/engine/src/synthesis/openai.ts`**

```ts
import { Chunk } from "../core/chunker";
import { estimatedTimings } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"];

export class OpenAIProvider implements TtsProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly requiresKey = true;
  readonly timingQuality = "estimated" as const;
  readonly maxCharsPerRequest = 4096;
  readonly defaultVoice = "alloy";

  constructor(private apiKey: string) {}

  async listVoices(): Promise<VoiceInfo[]> {
    return VOICES.map((v) => ({ id: v, label: v[0].toUpperCase() + v.slice(1) }));
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", input: chunk.text, voice, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, format: "mp3", timings: estimatedTimings(chunk) };
  }
}
```

- [ ] **Step 4: Register in the catalog** — add this entry to the `PROVIDER_CATALOG` array in `packages/engine/src/synthesis/provider-catalog.ts`, after the `elevenlabs` entry:

```ts
  { id: "openai", label: "OpenAI", description: "Premium · estimated timing", requiresKey: true },
```

- [ ] **Step 5: Export from the barrel** — add to `packages/engine/src/index.ts`:

```ts
export { OpenAIProvider } from "./synthesis/openai";
```

- [ ] **Step 6: Run tests + build to verify pass**

Run: `npm test -w @talktomebaby/engine` then `npm run build -w @talktomebaby/engine`
Expected: all tests pass (58 prior + the new OpenAI tests); build exits 0.

- [ ] **Step 7: Report DONE** with test count and build status. (Orchestrator commits.)

---

### Task 2: Cross-platform playback module

**Files:**
- Create: `packages/engine/src/playback/index.ts`
- Create: `packages/engine/src/playback/playback.test.ts`
- Modify: `packages/engine/src/index.ts` (export the playback API)

**Interfaces:**
- Produces:
  - `export interface PlayerSpec { cmd: string; args: (file: string) => string[] }`
  - `export function detectPlayer(platform: NodeJS.Platform, has: (bin: string) => boolean, format: "mp3" | "wav"): PlayerSpec | null`
  - `export class NoPlayerError extends Error`
  - `export type Runner = (cmd: string, args: string[], opts: { signal?: AbortSignal }) => Promise<unknown>`
  - `export function playWith(audio: Uint8Array, format: "mp3" | "wav", spec: PlayerSpec, runner: Runner, signal?: AbortSignal): Promise<void>`
  - `export function play(audio: Uint8Array, format: "mp3" | "wav", signal?: AbortSignal): Promise<void>`

- [ ] **Step 1: Write the failing test `packages/engine/src/playback/playback.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import { detectPlayer, playWith, NoPlayerError, PlayerSpec } from "./index";

const all = () => true;
const none = () => false;
const only = (bin: string) => (b: string) => b === bin;

describe("detectPlayer", () => {
  it("uses afplay on macOS for both formats", () => {
    expect(detectPlayer("darwin", all, "mp3")).toMatchObject({ cmd: "afplay" });
    expect(detectPlayer("darwin", all, "wav")).toMatchObject({ cmd: "afplay" });
    expect(detectPlayer("darwin", all, "mp3")!.args("/x.mp3")).toEqual(["/x.mp3"]);
  });

  it("prefers ffplay on linux when present", () => {
    const spec = detectPlayer("linux", only("ffplay"), "mp3")!;
    expect(spec.cmd).toBe("ffplay");
    expect(spec.args("/a.mp3")).toContain("/a.mp3");
    expect(spec.args("/a.mp3")).toContain("-autoexit");
  });

  it("falls back to aplay for wav on linux without ffplay/mpv", () => {
    expect(detectPlayer("linux", only("aplay"), "wav")!.cmd).toBe("aplay");
  });

  it("returns null on linux for mp3 with no usable player", () => {
    expect(detectPlayer("linux", none, "mp3")).toBeNull();
  });

  it("uses powershell SoundPlayer for wav on win32 without ffplay", () => {
    expect(detectPlayer("win32", only("anything-else"), "wav")!.cmd).toBe("powershell");
  });
});

describe("playWith", () => {
  it("writes a temp file, passes it to the runner, and cleans it up", async () => {
    const spec: PlayerSpec = { cmd: "noop", args: (f) => [f] };
    let seenPath = "";
    let existedDuringRun = false;
    const runner = async (_cmd: string, args: string[]) => {
      seenPath = args[0];
      existedDuringRun = await fs.access(seenPath).then(() => true, () => false);
    };
    await playWith(new Uint8Array([9, 9, 9]), "mp3", spec, runner);
    expect(existedDuringRun).toBe(true);
    expect(seenPath.endsWith(".mp3")).toBe(true);
    expect(await fs.access(seenPath).then(() => true, () => false)).toBe(false); // cleaned up
  });
});

describe("NoPlayerError", () => {
  it("is thrown shape with platform + format", () => {
    const e = new NoPlayerError("linux", "mp3");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/linux/);
    expect(e.message).toMatch(/mp3/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @talktomebaby/engine -- playback`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/engine/src/playback/index.ts`**

```ts
import { execFile } from "child_process";
import { existsSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import { promisify } from "util";

const run = promisify(execFile);

export interface PlayerSpec { cmd: string; args: (file: string) => string[] }
export type Runner = (cmd: string, args: string[], opts: { signal?: AbortSignal }) => Promise<unknown>;

export class NoPlayerError extends Error {
  constructor(platform: string, format: string) {
    super(`No audio player found for ${format} on ${platform}. Install ffmpeg (ffplay) or mpv.`);
    this.name = "NoPlayerError";
  }
}

/** Pure: choose a player from platform + a binary-presence predicate + audio format. */
export function detectPlayer(
  platform: NodeJS.Platform,
  has: (bin: string) => boolean,
  format: "mp3" | "wav"
): PlayerSpec | null {
  if (platform === "darwin") return { cmd: "afplay", args: (f) => [f] };

  const ffplay: PlayerSpec = { cmd: "ffplay", args: (f) => ["-nodisp", "-autoexit", "-loglevel", "quiet", f] };
  const mpv: PlayerSpec = { cmd: "mpv", args: (f) => ["--no-video", "--really-quiet", f] };

  if (has("ffplay")) return ffplay;
  if (has("mpv")) return mpv;

  if (platform === "win32") {
    if (format === "wav") return { cmd: "powershell", args: (f) => ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${f}').PlaySync()`] };
    return null;
  }

  if (format === "mp3" && has("mpg123")) return { cmd: "mpg123", args: (f) => ["-q", f] };
  if (format === "wav" && has("paplay")) return { cmd: "paplay", args: (f) => [f] };
  if (format === "wav" && has("aplay")) return { cmd: "aplay", args: (f) => ["-q", f] };
  return null;
}

/** Real PATH lookup for a binary (checks `bin` and `bin.exe`). */
export function hasBin(bin: string): boolean {
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  return dirs.some((d) => existsSync(join(d, bin)) || existsSync(join(d, `${bin}.exe`)));
}

/** Write audio to a temp file, run the given player spec, always clean up. */
export async function playWith(
  audio: Uint8Array,
  format: "mp3" | "wav",
  spec: PlayerSpec,
  runner: Runner,
  signal?: AbortSignal
): Promise<void> {
  const file = join(tmpdir(), `talktomebaby-play-${process.pid}-${Date.now()}.${format}`);
  await fs.writeFile(file, Buffer.from(audio));
  try {
    await runner(spec.cmd, spec.args(file), { signal });
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Play synthesized audio on this host. Throws NoPlayerError if no player is available. */
export async function play(audio: Uint8Array, format: "mp3" | "wav", signal?: AbortSignal): Promise<void> {
  const spec = detectPlayer(process.platform, hasBin, format);
  if (!spec) throw new NoPlayerError(process.platform, format);
  await playWith(audio, format, spec, run as Runner, signal);
}
```

- [ ] **Step 4: Export from the barrel** — add to `packages/engine/src/index.ts`:

```ts
export { detectPlayer, play, playWith, hasBin, NoPlayerError, PlayerSpec, Runner } from "./playback/index";
```

- [ ] **Step 5: Run tests + build**

Run: `npm test -w @talktomebaby/engine` then `npm run build -w @talktomebaby/engine`
Expected: all tests pass; build exits 0.

- [ ] **Step 6: Report DONE** with test count + build status.

---

### Task 3: Engine integration gate

**Files:** none (verification only).

- [ ] **Step 1: Full engine test + build**

Run: `npm test -w @talktomebaby/engine` then `npm run build -w @talktomebaby/engine`
Expected: all engine tests pass; build exits 0.

- [ ] **Step 2: Confirm the new exports resolve from the built barrel**

Run:
```bash
node -e "const e=require('./packages/engine/dist/index.js'); console.log('OpenAIProvider:', typeof e.OpenAIProvider, '| play:', typeof e.play, '| detectPlayer:', typeof e.detectPlayer, '| NoPlayerError:', typeof e.NoPlayerError)"
```
Expected: `OpenAIProvider: function | play: function | detectPlayer: function | NoPlayerError: function`

- [ ] **Step 3: Confirm the extension still builds + tests green (engine change is additive)**

Run: `npm run build -w talktomebaby` then `npm test -w talktomebaby`
Expected: build exits 0; 18 extension tests pass.

- [ ] **Step 4: Report DONE** with all results.

---

## Self-Review

**Spec coverage (against the design spec's "Shared engine" additions):**
- OpenAI provider implementing the existing interface (ported from Mycroft): Task 1. ✓
- Cross-platform playback (afplay / ffplay|mpv|aplay|paplay|mpg123 / powershell), graceful no-player error: Task 2. ✓
- Engine stays vscode-free and additive; extension unaffected: Task 3 Step 3 verifies. ✓
- Out of scope (correctly deferred): exposing OpenAI in the VS Code settings UI (the CLI in the next plan is the primary consumer); the CLI itself; Mycroft rewire.

**Placeholder scan:** All provider + playback code and tests are shown in full; all commands have expected output.

**Type consistency:** `OpenAIProvider` implements the unchanged `TtsProvider`; `synthesize` returns `ChunkAudio` ({ audio, format, timings }). Playback exports (`detectPlayer`, `play`, `playWith`, `hasBin`, `NoPlayerError`, `PlayerSpec`, `Runner`) match between `index.ts` (Task 2 Step 3), the barrel (Step 4), and the tests (Step 1).
