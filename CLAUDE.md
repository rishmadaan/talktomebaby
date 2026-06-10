# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Build & Test

```bash
npm run compile        # dev build: esbuild ext (→ out/extension.js) + webview (→ media/reader.js)
npm run watch          # incremental rebuild on save
npm run build          # production build (minified, no sourcemaps)
npm run package        # npx @vscode/vsce package — runs build first via vscode:prepublish
npm test               # vitest run — 63 tests across 12 files (no vscode runtime needed)
```

Press F5 in VS Code to launch the Extension Development Host (runs `npm: watch` as the default build task). Reload the dev host window to pick up changes.

**Accepted tsc quirk:** two `rootDir` errors from `tsconfig.json` — one for `src/webview/` files that esbuild bundles separately, one for test files. Both are tolerated by the build; `npm run compile` still succeeds.

**Tracked build output:** `media/reader.js` is the compiled webview bundle. It is checked into git (the webview is loaded via `vscode-resource:` URI and must be present in the packaged extension). Do not gitignore it.

## Source Layout

```
src/
  extension.ts          # Entry point — wires all subsystems; handles commands + resume-after-reload
  core/
    document-model.ts   # Parses raw text → DocumentModel (sentences → words with source bounding boxes)
    chunker.ts          # Groups sentences into audio chunks; deterministic on both host and webview
    timing.ts           # Merges word-boundary timings from providers into chunk-level offsets
  synthesis/
    provider.ts         # TtsProvider interface
    provider-catalog.ts # availableProviders(platform) — filters say on non-darwin
    edge.ts             # Edge TTS (msedge-tts, unofficial endpoint, exact word timing)
    elevenlabs.ts       # ElevenLabs API (exact char-alignment timing)
    say.ts              # macOS say (estimated timing)
    sarvam.ts           # Sarvam AI (estimated timing)
    synthesis-service.ts# Priority queue + dual-audio handoff; calls provider, applies cache
    disk-cache.ts       # LRU disk cache (globalStorageUri/audio-cache, default 200 MB)
    voice-cache.ts      # In-memory session cache for voice lists (never caches fallback lists)
    api-key-manager.ts  # SecretStorage read/write for ElevenLabs + Sarvam keys
    with-timeout.ts     # Race a promise against a timeout, return fallback value
  ui/
    reader-panel.ts     # ReaderPanel — webview lifecycle, message routing, post() buffer
    editor-sync.ts      # Editor decorations (sentence band) + click-to-jump listeners
    status-bar.ts       # Status bar item (sentence N/total, speed)
  webview/
    main.ts             # Webview entry — Engine, PlayerBar, SettingsPanel, Renderer
    engine.ts           # Playback engine: chunk queue, dual AudioBuffer handoff, word sweep
    renderer.ts         # DOM renderer — builds word spans from DocumentModel
    player-bar.ts       # Speed presets, slider, pause/resume, stop, gear button
    settings-panel.ts   # Settings slide-in: Provider / Voice / Appearance sections
```

Tests live alongside the files they test (`*.test.ts` co-located in `src/`). Vitest runs them in a happy-dom environment — no VS Code runtime needed.

## Key Invariants

- **Document model is the single source of truth.** `DocumentModel` is built once from raw text and never mutated. All offsets (word positions, sentence ranges) are bounding boxes into the original text. The chunker derives chunks deterministically from the model, so host and webview always agree on chunk boundaries.
- **Webview owns playback state.** The webview engine drives `position` and `state` messages; the extension host updates the status bar and persists position in response. The host never assumes playback state — it reads it from messages.
- **Provider/voice switches reconfigure in place, never auto-play.** `ReadingSession.reconfigure()` aborts the old synthesis pipeline, builds a new one, and re-inits the same webview paused at the current sentence. The user presses play when ready. No surprise audio.
- **Never cache fallback voice lists.** `VoiceCache` stores only real provider lists (length > 1). If `listVoices()` times out, the fallback (just the default voice) is returned for display but not stored — so the next fetch retries the real list. Caching the fallback would pin the provider to a single voice for the whole session.
- **Disk cache uses globalStorageUri.** `DiskCache` writes to `context.globalStorageUri/audio-cache`. The size limit is `talktomebaby.cacheSizeMB` (default 200). LRU eviction by bytes on write.

## Adding a New TTS Provider

1. Create `src/synthesis/your-provider.ts` implementing `TtsProvider` (see `provider.ts`)
2. Add it to `src/synthesis/provider-catalog.ts` (id, label, description, requiresKey, defaultVoice)
3. Register it in `extension.ts` `makeProviderById()` switch
4. Add the config key `talktomebaby.voice.your-provider` to `package.json`
5. If it needs a key: add handling in `src/ui/api-key-manager.ts`
