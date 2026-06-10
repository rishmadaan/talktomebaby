# SpeakItToMe — Ground-Up Rebuild Design

**Date:** 2026-06-10
**Status:** Approved by user
**Replaces:** the original read-vscode-tts architecture (see PLAN.md for the v1 design)

## Goal

Rebuild read-vscode-tts as **SpeakItToMe**, a VS Code extension with polished read-aloud behavior:

1. Smooth, continuous spoken reading (no per-sentence gaps, natural prosody)
2. Word-level highlight that sweeps with the voice, inside a sentence band
3. Click any word/sentence to jump playback there
4. Instant 0.75x–2x speed with pitch preserved, never re-synthesizing

### Why a rebuild (v1 audit findings)

- v1 synthesizes per sentence and plays disconnected clips: 4 async hops per sentence boundary, prosody resets every sentence. Smoothness is architecturally capped.
- Playback state is split between extension host and webview, synced by messages with staleness guards. Race-prone by construction.
- Speed uses `AudioBufferSourceNode.playbackRate` (pitch-shifting resample) AND is baked into synthesis (`pace`) AND into the cache key. Wrong primitive, triple-entangled.
- No click-to-jump. No word-level timing. Memory-only cache re-bills API credits on every reload.

### What survives from v1

- `text-parser.ts` core: the cleaned-text-to-document-offset mapping (extended to emit word spans)
- `ApiKeyManager` (SecretStorage per provider)
- Provider interface concept, esbuild build setup, packaging config

Everything else is replaced.

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Name | `speakittome` / "SpeakItToMe" (renamed in place, git history kept). Chosen over the earlier "speechly" candidate, which collides with the Roblox-acquired Speechly trademark. |
| Default provider | Edge TTS (free, no key, real word timestamps) |
| Premium provider | ElevenLabs `/with-timestamps` |
| Offline provider | macOS `say` (estimated word timing); Sarvam carried over (estimated timing) |
| Primary surface | Custom **SpeakItToMe Reader** webview panel (rendered view, native click-to-jump) |
| Secondary surface | Source editor: decorations + Alt+click to jump |
| Highlight style | Sentence band + moving word emphasis (dual highlight) |
| File scope | Prose files: md, mdx, txt, rst, org, tex, adoc (code files excluded) |
| Speed UX | Preset buttons 0.75/1/1.25/1.5/1.75/2 + fine slider, persisted globally |
| Resume behavior | Restart the current sentence on resume |
| Auto-scroll | Follows playback; manual scroll suspends follow; "return to playback" pill re-engages |
| Audio engine | Approach A: dual `<audio>` elements with preloaded handoff (see below) |
| Cache | Disk cache in `globalStorageUri`, LRU, default 200 MB, configurable |

## Architecture

### Ownership split (the core fix over v1)

- **Webview (reader panel) owns ALL playback state**: position `(chunkIndex, timeInChunk)`, playing/paused, speed. There is exactly one state machine.
- **Extension host owns the document model and synthesis**: parsing, chunking, provider calls, caching, editor decorations, status bar.
- Extension never tracks "is it playing"; it consumes position/state events from the webview.

```
Extension host                              Reader webview (audio engine)
──────────────                              ─────────────────────────────
document-model: blocks → sentences          renders FROM the model
  → words, all with source offsets            (<span data-word-idx> per word)
synthesis-service: chunk queue,             dual <audio> handoff engine
  priority synthesis, timing alignment      audio.playbackRate (preservesPitch)
disk cache (audio + word timings)           sentence band + word sweep (CSS)
editor-sync: decorations, Alt+click         click word → jump
status-bar: play/pause, speed               auto-scroll + follow-suspend
        │                                           │
        └────── typed postMessage protocol ─────────┘
            (audio as Uint8Array, not base64)
```

### Document model (single source of truth)

The parser (evolved from v1 `text-parser.ts`) produces:

```typescript
interface DocumentModel {
  uri: string;
  version: number;            // TextDocument.version at parse time
  blocks: Block[];            // heading | paragraph | list-item | quote | code
}
interface Block {
  kind: BlockKind;
  level?: number;             // heading level, list depth
  sentences: Sentence[];      // empty for code blocks (rendered dimmed, not read)
  sourceRange: Range;
}
interface Sentence { text: string; words: Word[]; sourceRange: Range; }
interface Word { text: string; sourceRange: Range; }   // index = position in flat word list
```

**Critical invariant:** the reader renders from this model, never from an independent markdown render. Word identity (flat word index) is shared exactly across narration timing, reader DOM, and editor decorations. This is what makes highlight/click/sync correct by construction.

### Chunking and synthesis

- Chunker groups blocks into chunks of ~1,500–2,500 chars, splitting only at sentence boundaries, never inside a sentence. Chunk boundaries prefer paragraph breaks.
- `SynthesisService` maintains a priority queue: current chunk, then 2 ahead. A jump re-prioritizes the target chunk to the front immediately.
- Each synthesis returns `{ audio: Uint8Array (mp3), wordTimings: { wordIdx, startMs, endMs }[] }`.
- Timing alignment maps provider output to model word indices:
  - Edge TTS: WordBoundary events → match emitted words to chunk words in order
  - ElevenLabs: character-level alignment → accumulate into word spans
  - say/Sarvam: no timestamps → estimate by character-proportional allocation across the chunk's measured audio duration (sentence boundaries exact via per-sentence proportions, words approximate)
- Speed is NEVER sent to a provider and NEVER part of a cache key.

### Provider interface

```typescript
interface TtsProvider {
  readonly id: string;            // "edge" | "elevenlabs" | "say" | "sarvam"
  readonly requiresKey: boolean;
  readonly timingQuality: "exact" | "estimated";
  readonly maxCharsPerRequest: number;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(text: string, voice: string, signal: AbortSignal): Promise<ChunkAudio>;
}
```

- **Edge TTS** (default): via a maintained edge-tts Node package (`msedge-tts` / `edge-tts-universal` family). Free, no key, neural voices, word boundaries. Runs in the extension host (Node), where the websocket connection works (browser contexts are blocked, Node is not).
- **ElevenLabs**: `POST /v1/text-to-speech/{voice}/with-timestamps`, existing key management reused.
- **macOS say**: `say -o tmp.aiff --data-format=...`, convert/measure duration, estimated timings. Registered only on darwin.
- **Sarvam**: v1 implementation carried over minus `pace`, estimated timings.

### Playback engine (webview) — Approach A

Two `HTMLAudioElement`s, A and B. While A plays chunk N, B holds chunk N+1 fully preloaded (`preload="auto"`, blob URL). On `ended`, B starts immediately and A begins preloading chunk N+2. Rationale vs alternatives:

- vs **MediaSource single timeline**: MSE is truly gapless mid-paragraph but requires global-timeline bookkeeping (`timestampOffset`, buffered-range gaps) and makes jump-ahead to unsynthesized text awkward (no defined timeline position yet). Approach A's position is `(chunk, offset)`, so jumping anywhere only needs THAT chunk synthesized: one API call to jump to the end of a 50-page doc.
- vs **Web Audio + SoundTouch worklet**: we would own time-stretch quality; Chromium's native `preservesPitch` on media elements is better and free.
- Handoff gap of a few ms lands on paragraph boundaries where a pause is natural.

Engine behaviors:

- `playbackRate` (with `preservesPitch = true`) applied to both elements; speed changes are instant and survive handoffs.
- Pause stores position; **resume seeks back to the start of the current sentence** (per UX decision).
- A `timeupdate`-driven loop (~10 Hz) resolves current word index from `wordTimings` and (a) updates reader highlight classes locally, (b) posts `position` to the extension for editor sync.
- Word→time and time→word lookups are binary searches over the chunk's timing array.

### Reader panel (webview UI)

- `WebviewPanel` (editor area, `ViewColumn.Beside` by default), `retainContextWhenHidden`.
- Renders the document model as clean reading HTML: headings, paragraphs, lists, quotes; code blocks collapsed/dimmed with a "not read aloud" affordance. Every word is `<span data-word-idx>`. Theme-aware (VS Code CSS variables) with reading-optimized type (configurable font size).
- Dual highlight: `.sentence-active` band + `.word-active` emphasis, CSS transitions for the sweep.
- **Click any word** → `jumpTo(wordIdx)`.
- **Player bar** (sticky): play/pause, back/forward one sentence, speed presets 0.75–2x + fine slider, voice picker, provider picker, progress (sentence X of Y / % through doc).
- Auto-scroll keeps the sentence band comfortably in view. Any user scroll suspends following; a floating "↓ return to playback" pill re-engages.

### Editor surface (secondary)

- Two decoration types: sentence background, current-word border/stronger background. Applied only when the source editor is visible.
- **Alt+click** while a session is active jumps playback (via `onDidChangeTextEditorSelection`, `kind === Mouse` + Alt held → mapped through word source ranges). Plain clicks always behave normally in the editor. Documented in README.
- `revealRange` follow with the same suspend-on-manual-scroll rule (tracked via `onDidChangeTextEditorVisibleRanges`).
- Status bar item: play/pause icon, current speed, click opens the reader. Visible whenever a session exists.

### Message protocol (typed, versioned)

Extension → webview: `init(model, settings)`, `chunkAudio(chunkIdx, audio: Uint8Array, timings)`, `chunkFailed(chunkIdx, error)`, `settingsChanged`, `seekTo(wordIdx)` (from editor Alt+click), `pause`, `resume`, `stop`.
Webview → extension: `ready`, `position(wordIdx, sentenceIdx, chunkIdx)`, `state(playing|paused|ended)`, `requestChunk(chunkIdx, priority)`, `speedChanged(rate)`, `voiceSelected`, `providerSelected`, `error`.

Audio crosses the bridge as `Uint8Array` (VS Code postMessage supports it), not base64 JSON.

### Caching

- Disk cache at `context.globalStorageUri/audio-cache/`: `{hash}.mp3` + `{hash}.json` (timings), where `hash = sha256(text | providerId | voiceId)`.
- LRU by total bytes, default cap 200 MB (`speakittome.cacheSizeMB`), eviction on write, index file for access times.
- In-memory layer on top for the active session.
- Re-reading a document after reload costs zero API calls.

### Commands, settings, keybindings

Commands (all `speakittome.*`): `readDocument` (opens reader + plays), `readSelection`, `readFromCursor`, `pauseResume`, `stop`, `openReader`, `setApiKey`, `selectProvider`, `selectVoice`.
Menus: editor title icon + context menu entries on prose files (`md, mdx, txt, rst, org, tex, adoc`).
Keybindings: `cmd/ctrl+shift+r` pause/resume (carried over).
Settings: `speakittome.provider`, `speakittome.voice.{edge|elevenlabs|say|sarvam}`, `speakittome.speed` (persisted playback rate), `speakittome.editorClickToJump` (Alt+click toggle, default on), `speakittome.highlight.sentenceColor`, `speakittome.highlight.wordColor`, `speakittome.readerFontSize`, `speakittome.cacheSizeMB`.
Old `read-tts.*` settings are dropped (no migration; v1 had no meaningful installed base).

### Error handling

- Provider failure on a chunk: one automatic retry, then pause at the gap with the error in the player bar; position preserved; "retry" button.
- Rate limit (429): exponential backoff within the queue, player shows "catching up".
- Network loss: cached chunks keep playing; pause cleanly at the first unsynthesizable chunk.
- Document edited during playback: pause, re-parse, attempt to re-anchor by current sentence text match; offer "resume from here" toast in the reader. If the sentence is gone, resume from the nearest preceding sentence.
- Webview disposed mid-session: session ends, status bar clears.
- One session at a time: starting a read in another document tears down the previous session.

### Testing

- **Unit (the correctness core):** parser word/sentence/offset mapping, chunker boundary rules, timing alignment per provider (exact + estimated), LRU cache eviction. These are pure functions; test with vitest.
- **Engine logic:** webview engine as plain JS module with a mocked `Audio`; test handoff ordering, resume-restarts-sentence, jump re-prioritization, speed persistence.
- **Manual E2E checklist** (Extension Development Host, long real markdown doc): the four core requirements at 1x and 2x, click-to-jump in reader and Alt+click in editor, scroll-away/return, pause/resume, reload-and-replay from cache, each provider, doc-edit mid-playback.

### Rename and repo mechanics

- In-place rename, git history preserved. `package.json`: name `speakittome`, displayName "SpeakItToMe", publisher unchanged, version `0.2.0`, all contribution IDs `speakittome.*`.
- New `src/` layout:

```
src/
├── extension.ts               # activation, commands, session wiring
├── core/
│   ├── document-model.ts      # parser (evolved from v1 text-parser)
│   ├── chunker.ts
│   └── timing.ts              # alignment + estimation
├── synthesis/
│   ├── provider.ts            # TtsProvider interface
│   ├── edge.ts | elevenlabs.ts | say.ts | sarvam.ts
│   ├── synthesis-service.ts   # priority queue
│   └── disk-cache.ts
├── ui/
│   ├── reader-panel.ts        # WebviewPanel host
│   ├── editor-sync.ts         # decorations + Alt+click + follow
│   ├── status-bar.ts
│   └── api-key-manager.ts     # carried over
└── webview/
    ├── engine.ts              # dual-audio playback engine
    ├── renderer.ts            # model → DOM
    ├── highlight.ts           # classes + auto-scroll/follow
    └── player-bar.ts
```

- Webview sources bundled by esbuild (second entry point) into `media/` at build time; the v1 duplicate-media-dir problem goes away because `media/` becomes build output only.
- v1 files removed: `audio-manager.ts`, `playback.js`, old `webview-provider.ts`, per-sentence prefetch logic, `read-tts.*` config.
- Directory rename of the repo folder itself (`read-vscode-tts` → `speakittome`) deferred to the end of implementation so paths stay stable while working.

### Build phases (high level; implementation plan will detail)

1. **Core model**: parser with word spans, chunker, timing alignment + estimation. Unit tests.
2. **Edge provider + synthesis service + disk cache**: real audio with word timings, cached.
3. **Reader panel MVP**: model rendering, dual-audio engine, sentence+word highlight, click-to-jump, pause/resume semantics.
4. **Player bar + speed + scroll-follow**: presets, slider, persistence, follow-suspend + return pill.
5. **Editor surface**: decorations, Alt+click, status bar.
6. **Remaining providers**: ElevenLabs with-timestamps, macOS say, Sarvam port, voice pickers.
7. **Rename completion + polish + docs**: README (incl. Alt+click documentation), CHANGELOG, manual E2E pass, package as VSIX.

## Out of scope (v2 candidates)

- OpenAI/Azure/Kokoro-local providers
- Reading code files / docstrings
- Cross-document queue ("read my whole folder")
- Export to audio file
- Marketplace publishing (revisit the SpeakItToMe trademark question then)
