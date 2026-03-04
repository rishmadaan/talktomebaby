# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run compile    # Build with esbuild (dev, with sourcemaps)
npm run watch      # Auto-rebuild on file changes
npm run build      # Production build (minified)
npm run package    # Create .vsix package (runs build first via prepublish)
```

No test runner or linter is configured. Verify changes compile cleanly with `npm run compile`.

## Development Workflow

Press F5 in VS Code to launch the Extension Development Host (runs `npm run watch` as pre-launch task). Reload the dev host window to pick up changes.

## Architecture

VS Code extension providing text-to-speech with synchronized sentence highlighting. Entry point is [extension.ts](src/extension.ts) which wires together four subsystems:

### Managers (`src/managers/`)
- **AudioManager** — Playback state machine (idle → loading → playing ↔ paused → idle). Orchestrates TTS API calls, caching, and webview communication. Emits `sentenceChange`, `stateChange`, and `error` events.
- **HighlightManager** — Applies editor decorations to the current sentence and auto-scrolls to keep it visible.
- **ApiKeyManager** — Stores API keys in VS Code SecretStorage, manages provider selection and key validation.

### Providers (`src/providers/`)
Provider-agnostic TTS via the `ITtsProvider` interface defined in [tts-provider.ts](src/providers/tts-provider.ts). Each provider implements `synthesize()` and `validateKey()`.

- **SarvamProvider** — Sarvam AI API, 2500 char limit, returns base64 MP3
- **ElevenLabsProvider** — ElevenLabs API, 5000 char limit, returns raw MP3 buffer

### Adding a new TTS provider
1. Create `src/providers/your-provider.ts` implementing `ITtsProvider`
2. Add secret key + quick pick option in [api-key-manager.ts](src/managers/api-key-manager.ts)
3. Add new enum value to `read-tts.provider` in [package.json](package.json)

### Webview (`src/webview/`)
Sidebar panel with playback controls. [webview-provider.ts](src/webview/webview-provider.ts) manages the webview lifecycle and message routing. [playback.js](src/webview/media/playback.js) handles audio via Web Audio API (AudioContext + BufferSource).

**Extension ↔ Webview messages:** `playAudio` (base64 data URL), `pause`, `resume`, `stop`, `audioEnded`, `togglePauseResume`, `stopPlayback`, `ready`.

### Utils (`src/utils/`)
- **text-parser.ts** — Strips markdown, splits into sentences (respecting abbreviations like Mr./Dr./e.g.), maps sentences back to editor Ranges for highlighting.
- **cache.ts** — LRU in-memory audio cache, 100MB cap, keyed by SHA256 of (text + provider + voice).

## Key Design Decisions

- **esbuild** bundles everything into a single `out/extension.js`. The `vscode` module is external (provided by runtime). No webpack.
- **No runtime dependencies** — only devDependencies for types and build tooling.
- **Session-only cache** — audio is cached in memory, cleared on VS Code reload. No disk persistence.
- Webview uses **Web Audio API** (not `<audio>` element) for playback control and pause/resume with offset tracking.
- Supports only `.md` and `.txt` files. File type filtering is done via `when` clauses on menu contributions in package.json.
