# Changelog

## 0.3.0 — TalkToMeBaby

Renamed SpeakItToMe → TalkToMeBaby.

- In-reader settings panel (primary settings surface): provider, voice, font size, highlight colors — all accessible from the gear icon in the player bar
- Instant voice loading with session cache: voices are prefetched on read start so the first gear-open is usually instant
- No-auto-play-on-switch policy: changing provider or voice re-primes the session paused at the current sentence; press play when ready
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
