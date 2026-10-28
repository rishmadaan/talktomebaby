# Changelog

## [Unreleased]

- Faster start: Read from Here, Read Selection, resume after reload and a voice switch begin with the starting sentence on its own, then slightly longer pieces, so the first audio arrives quickly instead of waiting behind the top of the document. After those first pieces the parts match a read from the top, so audio already cached for the rest of the document still plays free.
- The player bar shows "Loading…" while it waits for audio, and "Nothing to read." for a blank or code-only document.
- Fix: the chosen speed holds when the next part of the audio loads (it used to drop back to 1x).
- Fix: sentences ending in words like "first." or "last." are no longer joined to the next one (they were read as the abbreviation "St.").
- Fix: after an edit above the reading position, cached audio highlights the right words again.
- Fix: a request cancelled by a voice switch or stop is no longer synthesized a second time.
- Fix: switching voice while paused prepares only the current part; nothing further is synthesized until Play. A switch while the first audio is still loading keeps the requested position.
- Fix: a word the voice gave no timing for starts playback just before it, not at the start of that part.
- Note: audio cached by earlier versions is not reused and is made once more on first play; paid providers (ElevenLabs, OpenAI, Sarvam) bill that once.
- Engine: `buildChunks` takes an optional fourth argument, `startWordIndex`; without it the plan is unchanged.

- Docs: Microsoft Edge voices "use at your own risk" disclaimer added to DISCLAIMER.md, README, PRIVACY.md, every docs-site page footer, the provider setting descriptions, the Reader's provider picker, and the CLI install message. The engine and CLI npm packages now ship DISCLAIMER.md.

## [0.4.1] - 2026-10-28

- Fix: Edge TTS (Microsoft voices) works again. Microsoft now refuses the old access token with a 403; msedge-tts 2.1.1 sends the new v2 token. The engine and CLI versions are 0.2.1.

## [0.4.0] - 2026-09-13

- Licensing: migrate the suite to GNU GPL v3 or later, starting with extension 0.4.0, engine 0.2.0, and CLI 0.2.0. Earlier MIT releases retain their existing permissions.
- Packaging: include complete license notices and matching source archives in the VSIX and both npm packages.
- Packaging: reject untracked source and missing license notices; cache and revalidate upstream source archives for offline reuse.
- Added a License and Source command that works in packaged extensions and the Extension Development Host.
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
