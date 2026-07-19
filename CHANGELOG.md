# Changelog

## Unreleased

- Internal: extension now consumes the shared `@talktomebaby/engine` package in an npm workspaces monorepo (no user-facing change).

## [0.3.2] - 2026-06-10

- New `auto` provider default: macOS now defaults to the built-in `say` voice (official, fully offline); Windows/Linux keep Edge TTS. Explicit provider choices are unchanged and always respected.

## [0.3.1] - 2026-06-10

- Added explicit privacy/data-flow disclosure for network TTS providers
- Added expanded user-responsibility, warranty, provider, content-rights, and liability disclaimers
- Added third-party runtime dependency notices for packaged builds
- Restored Speechify-inspired positioning with an independence/no-affiliation disclaimer

## [0.3.0] - 2026-06-10 — TalkToMeBaby

Renamed SpeakItToMe → TalkToMeBaby.

- Published to the VS Code Marketplace as `rishmadaan.talktomebaby`
- Added Marketplace icon and public package metadata
- In-reader settings panel (primary settings surface): Provider and Voice sections split into separate areas; font size, highlight colors — all accessible from the gear icon in the player bar
- Instant voice loading with session cache: voices are prefetched on read start so the first gear-open is usually instant; fallback voice lists are never cached (ensures the next fetch retries the real list)
- No-auto-play-on-switch policy: changing provider or voice re-primes the session paused at the current sentence; press play when ready
- Resume after reload: position is persisted to workspaceState (throttled ~3s); on activation a "Resume?" toast is offered if a session was saved within 12 hours
- Playback failures surfaced: chunk synthesis errors are sent to the webview and reported in the Output channel rather than silently dropped
- Provider architecture docs: see docs/provider-architecture.md for full provider design, fragility notes, and roadmap
- Reader panel: rendered reading view with word-level karaoke highlighting
- Click any word to jump playback (alt+j from the source editor)
- Continuous chunked audio (no more per-sentence gaps)
- Speed 0.5-2x, pitch preserved, instant, persisted
- Resume restarts the current sentence
- Providers: Edge TTS (default, free), ElevenLabs, macOS say, Sarvam
- Persistent disk cache (default 200 MB), re-reads cost no API credits
- Editor decorations stay in sync; auto-scroll with return-to-playback pill

## [0.1.0] - 2026-03-04

### Added
- Sentence-level text highlighting while reading aloud
- Play/pause/stop playback controls in sidebar panel
- "Start from Here" — right-click any sentence to begin reading from that point
- In-memory session caching to save API credits on re-reads
- Sarvam AI TTS provider (Indian English, 45+ voices)
- ElevenLabs TTS provider (multilingual, requires paid plan)
- Provider-agnostic architecture — switch providers via settings
- Keyboard shortcut: `Cmd+Shift+R` / `Ctrl+Shift+R` for pause/resume
- Configurable highlight color, voice, and speech speed
