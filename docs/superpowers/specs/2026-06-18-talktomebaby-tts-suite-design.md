# TalkToMeBaby TTS Suite - Design

Date: 2026-06-18
Status: Approved (brainstorming), pending implementation plan

## Summary

Turn TalkToMeBaby from a single VS Code read-aloud extension into a small TTS
**suite** for AI builders, built around one shared engine:

- **VS Code reader** (exists, v0.3.2) - read prose aloud with karaoke highlighting.
- **Terminal "agent voice" CLI** (new) - reads your AI coding agent's responses
  aloud (Claude Code / Codex / any agent), via a Stop hook or standalone. This is
  the novel, differentiating member: "your coding agent talks back."

Both surfaces sit on a shared `@talktomebaby/engine` (providers, voices, caching,
timing). The CLI is extracted from, and generalizes, the voice stack that already
lives in the private Mycroft repo (`tools/speak.js`, `tts.js`, `summarize.js`,
`clean-text.js`, `audio-queue.js`, `voice.js`, transcript reading).

Quality bar: a real, public-grade OSS tool. Distribution: VS Code Marketplace
(extension) + npm (CLI). No broad marketing push for v1 - soft-launch to the
AI-builder community.

### Why now

The two codebases have already drifted, which is the tell that the shared engine
is the real product: Mycroft's voice has an **OpenAI** provider but no Edge TTS;
TalkToMeBaby has **Edge TTS** but no OpenAI. Kept separate, they keep diverging.
One engine means a provider or fix lands once and both surfaces get it.

## Audience and non-goals

- **Audience:** AI builders / developers using Claude Code, Codex, Cursor, VS
  Code. VS Code + terminal are their native surfaces.
- **Non-goals (v1):** a creator-facing surface (desktop/browser reader); broad
  marketing; a general-purpose Speechify competitor. A creator surface may come
  later and is a reason to keep the engine surface-agnostic, not to build it now.

## Architecture

npm workspaces monorepo:

```
talktomebaby/
  packages/
    engine/             @talktomebaby/engine  (TS lib; no vscode, no CLI deps)
      core/             chunker, document-model, timing      <- moved from src/core
      synthesis/        provider iface, edge/elevenlabs/sarvam/say + OpenAI(new),
                        provider-catalog, synthesis-service, disk-cache,
                        voice-cache, with-timeout            <- moved from src/synthesis
      playback/         NEW: cross-platform Node audio player
      index.ts          public API surface
    vscode-extension/   current extension moved here; imports @talktomebaby/engine
      src/ui, src/webview, extension.ts, package.json (contributes...)
    cli/                talktomebaby CLI (npm bin)
      src/
        cli.ts          arg parsing + command dispatch
        agent-voice.ts  orchestration: read last turn -> clean -> (summarize?) -> synth -> play
        transcripts/    readers: claude.ts, codex.ts, stdin.ts (host detection)
        clean-text.ts   markdown -> speech (ported from Mycroft)
        summarize.ts    Smart scope: Gemini -> OpenAI (ported from Mycroft)
        hooks/          installers: claude.ts, codex.ts (idempotent)
        config.ts       settings + key resolution (env / XDG)
      package.json (bin: talktomebaby)
  package.json          workspaces root
```

The engine subtree already exists inside the extension (`src/core` +
`src/synthesis`) and has no `vscode` imports, so extraction is mostly a **move**,
not a rewrite. See `docs/provider-architecture.md` for the current provider model.

## Components

### `@talktomebaby/engine`

Public API (stable surface both consumers use):

- `synthesize(text, opts) -> { audio, timings }` where `opts` includes provider,
  voice, speed, and provider keys (passed in, never read from disk by the engine).
- Provider catalog + voice listing (existing `provider-catalog.ts`).
- Disk cache keyed by text+provider+voice (existing `disk-cache.ts`).

Additions:

1. **OpenAI provider** (`synthesis/openai.ts`) implementing the existing
   `provider.ts` interface. Ported from Mycroft `tts.js: prepareOpenAI`
   (`POST https://api.openai.com/v1/audio/speech`). Estimated word timing like
   the other non-timed providers.
2. **Playback submodule** (`playback/`) for Node consumers (the CLI). Detects
   platform and plays a synthesized audio buffer/file:
   - macOS: `afplay` (Mycroft's current path)
   - Linux: first available of `ffplay` / `paplay` / `aplay` / `mpv`
   - Windows: PowerShell `System.Media.SoundPlayer`
   - No player found: return a clear, non-fatal error.
   VS Code does NOT use this (it plays in the webview); the engine keeps playback
   optional so the extension bundle stays lean.

Engine stays free of `vscode` and free of CLI/agent concerns.

### `talktomebaby` CLI

Commands:

- **`agent`** (headline): read the agent's latest turn and speak it.
  - Stop-hook mode: reads hook JSON on stdin (`transcript_path`, etc.), as Claude
    Code and Codex provide.
  - Standalone mode: `--transcript <path>` or auto-discovery.
  - `--agent claude|codex|auto`: selects the transcript reader. `auto` infers from
    the transcript path (`/.codex/` vs `/.claude/`), mirroring Mycroft's
    `save-conversation.js: detectHost`.
  - **Hard rule (ported):** never block the host. Every path exits 0; errors go to
    a log file (`$XDG_STATE_HOME` or temp), never to a failing exit code.
- **`install <claude|codex>`** (onboarding): idempotently write/merge the Stop
  hook into the host's config (`.claude/settings.json` Stop hook; Codex
  `.codex/hooks.json`), verify a working provider (Edge needs no key), and speak a
  test line. One command from install to hearing the agent.
- **`on | off | toggle | status`**: global enable switch (ported from
  `voice.js`). State in the XDG config.
- **`config`**: provider / voice / scope / max length.
- ~~`say "text"` / stdin~~: ad-hoc read-aloud. **Cut from v1** (YAGNI). The
  headline is agent-voice; ad-hoc read-aloud is already served by `edge-tts-cli`
  and the macOS `say` binary, and prose reading is the VS Code member's job. Easy
  to add post-v1 if users ask. Note: the macOS `say` *provider* is unaffected and
  stays in the engine - this only drops the CLI *command*.

Scope (ported): `full`, `first-paragraph`, `summary` (Smart - summarizer Gemini
then OpenAI, falls back to first-paragraph with no key).

Default provider: **Edge TTS** (free, cross-platform, no key, word-level timing).
This is the cross-platform default that removes Mycroft's macOS-only fragility.

### Config and keys (independence)

The CLI must not depend on Mycroft or on `~/labs/env` (Rishabh-private). Key
resolution order:

1. Environment variables: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
   `SARVAM_API_KEY`, `GEMINI_API_KEY`.
2. `~/.config/talktomebaby/config.json` (XDG; `XDG_CONFIG_HOME` respected).

Edge TTS and macOS `say` need no key, so the default experience is keyless. The
engine receives keys as parameters and never reads disk. VS Code keeps its
existing `api-key-manager` (VS Code SecretStorage); the CLI uses env/XDG. The two
key stores are intentionally separate.

## Data flow (agent voice)

```
host Stop hook fires
  -> talktomebaby agent  (stdin: { transcript_path, ... })
     -> transcripts/<host>.ts: read last assistant turn
     -> clean-text.ts: strip markdown to speech-friendly prose
     -> (scope=summary?) summarize.ts: Gemini -> OpenAI -> 1-2 sentences
     -> capLength
     -> engine.synthesize(text, { provider, voice, key })
     -> playback/: play on this platform
  -> exit 0 (always)
```

## Distribution

- **Extension** -> VS Code Marketplace (`rishmadaan.talktomebaby`, already live).
  Republish from `packages/vscode-extension`, version-bumped. Non-destructive: do
  not break v0.3.2 installs.
- **CLI** -> npm: `npm i -g talktomebaby`, or zero-install `npx talktomebaby ...`.
- Repo stays public on GitHub (LICENSE/CONTRIBUTING/SECURITY already present).
  README documents the suite (engine + two surfaces).
- v1 = publish + share with the community directly; no marketing campaign.

## Mycroft as first consumer (the payoff)

After the CLI reaches parity with Mycroft's voice behavior:

1. Replace Mycroft's `tools/speak.js` Stop hook with a shell-out to
   `talktomebaby agent --agent claude`. Mycroft stays **dependency-free** - it
   calls the globally installed binary, it does not import it.
2. Delete the now-duplicated Mycroft voice modules (`tts.js`, `voices.js`,
   `audio-queue.js`, `summarize.js`, `clean-text.js`, `voice.js`, transcript
   bits) in ONE commit, only after parity is verified (~900 lines removed).
3. Bonus: on the Linux persistent box (separate Mycroft thread), Mycroft voice now
   works via Edge TTS, closing the macOS-only degradation noted in that audit.

This step is tracked but is downstream of shipping the CLI; it is not part of the
suite's own v1 scope beyond being the validation target.

## Migration (non-destructive, ordered)

The extension is shipped; protect it.

1. Introduce npm workspaces at the repo root; create `packages/`.
2. **Engine first:** move `src/core` + `src/synthesis` to `packages/engine`;
   point the extension at `@talktomebaby/engine`. All existing vitest tests green.
   This is the one risky refactor - do it behind passing tests before any CLI work.
3. Move the extension into `packages/vscode-extension`; verify `npm run build`,
   tests, and `vsce package` still produce a working VSIX; version-bump; publish.
4. Add the OpenAI provider + playback submodule to the engine (with tests).
5. Build the CLI package against the engine.
6. Only then: wire Mycroft to consume the CLI and remove its voice modules.

## Testing

- **Engine:** existing vitest suite moves with `core`/`synthesis`. Add tests for
  the OpenAI provider (mock fetch) and playback (mock the player process /
  platform detection).
- **CLI:** fixture-based tests with sample Claude and Codex transcript JSONL for
  the readers + host detection; clean-text; the idempotent hook installer
  (writes then re-writes -> no duplication, host config preserved); agent
  orchestration with a mocked engine. Explicitly assert the never-block / exit-0
  guarantee.

## Open questions / decisions deferred to the plan

- Exact npm package names (`@talktomebaby/engine` scope availability; CLI bin name
  `talktomebaby` vs adding `ttmb` alias).
- Linux player preference order and whether to document an install hint when none
  is found.

## Decisions

- **`say` command: cut from v1** (2026-06-18, YAGNI). The macOS `say` *provider*
  stays in the engine; only the ad-hoc read-aloud CLI command is dropped.
