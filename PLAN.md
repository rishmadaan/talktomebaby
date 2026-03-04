# read-vscode-tts — Implementation Plan

## Context

VS Code extension for text-to-speech with synchronized text highlighting. Built because the ElevenLabs TTS extension (`lekman.tts-code`) doesn't work on ElevenLabs free tier (401 on TTS API calls — a known free-tier restriction). Provider-agnostic architecture supporting both Sarvam AI and ElevenLabs.

**Project location:** `~/labs/01-Active-Projects/read-vscode-tts`
**File types:** `.md` and `.txt`
**Language:** English only (for now)

## Core Features

1. **Highlight while reading** — sentence-level highlighting in the editor via Decorations API
2. **Play/pause** — toggle playback without losing position
3. **Resume from section** — right-click a sentence to start reading from there (not from the top)
4. **Session caching** — in-memory cache (Map) keyed by text hash + provider, cleared on VS Code reload

## Architecture

```
src/
├── extension.ts                 # Entry point, command registration
├── providers/
│   ├── tts-provider.ts          # ITtsProvider interface
│   ├── sarvam-provider.ts       # Sarvam AI implementation
│   └── elevenlabs-provider.ts   # ElevenLabs implementation
├── managers/
│   ├── audio-manager.ts         # Chunking, caching, playback orchestration
│   ├── highlight-manager.ts     # Editor decorations for current sentence
│   └── api-key-manager.ts       # SecretStorage for API keys
├── utils/
│   ├── text-parser.ts           # Split text into sentences, strip markdown
│   └── cache.ts                 # In-memory audio cache with hash keys
└── webview/
    ├── webview-provider.ts      # WebviewViewProvider for sidebar panel
    └── media/
        ├── playback.js          # Audio element + controls in webview
        └── playback.css         # Minimal styling
```

## Provider Interface

```typescript
interface ITtsProvider {
  readonly name: string;
  readonly maxCharsPerRequest: number;
  synthesize(text: string, options: TtsOptions): Promise<AudioResult>;
  validateKey(apiKey: string): Promise<boolean>;
}

interface AudioResult {
  audioBuffer: Buffer;      // Raw audio bytes (mp3)
  format: 'mp3' | 'wav';
}

interface TtsOptions {
  voice?: string;
  speed?: number;
}
```

## Provider API Details

### Sarvam AI
- **Endpoint:** `POST https://api.sarvam.ai/text-to-speech`
- **Auth header:** `api-subscription-key: <key>`
- **Request body:**
  ```json
  {
    "text": "...",
    "target_language_code": "en-IN",
    "model": "bulbul:v3",
    "speaker": "Shubh",
    "pace": 1.0,
    "output_audio_codec": "mp3",
    "speech_sample_rate": 24000
  }
  ```
- **Response:** `{ "request_id": "...", "audios": ["<base64-encoded-mp3>"] }`
- **Max chars/request:** 2500 (v3)
- **Free credits:** Rs.1000 one-time (never expires)
- **Available voices (v3):** Shubh (default), Aditya, Ritu, Priya, Neha, Rahul, Pooja, Rohan, Simran, Kavya, Amit, Dev, Ishita, Shreya, + 20 more

### ElevenLabs
- **Endpoint:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
- **Auth header:** `xi-api-key: <key>`
- **Request body:**
  ```json
  {
    "text": "...",
    "model_id": "eleven_multilingual_v2"
  }
  ```
- **Response:** Raw binary audio (mp3) — direct buffer
- **Max chars/request:** 2500 (free), 5000 (paid)
- **Default voice:** `21m00Tcm4TlvDq8ikWAM` (Rachel)
- **Note:** Free tier returns 401 on TTS calls as of March 2026. Requires paid plan ($5/mo starter).

## Playback Flow

```
User triggers "Read: Speak Document" or right-clicks "Start from Here"
    │
    ▼
text-parser.ts splits document into sentences
    │
    ▼
audio-manager.ts iterates sentences:
    ├── Check cache (hash of sentence text + provider)
    │     ├── HIT → use cached Buffer
    │     └── MISS → call provider.synthesize() → cache result
    │
    ▼
For each sentence:
    1. highlight-manager highlights current sentence in editor (yellow bg)
    2. audio-manager sends audio to webview via postMessage (base64 data URL)
    3. webview plays audio via <audio> element
    4. webview fires 'ended' event → extension advances to next sentence
    │
    ▼
On pause: webview pauses <audio>, extension keeps currentIndex
On resume: webview resumes <audio> from where it left off
On "Start from Here": extension sets currentIndex to cursor sentence, starts there
```

## Caching Strategy

- **Key:** `sha256(sentenceText + providerName + voiceName)` (first 12 chars)
- **Value:** `{ buffer: Buffer, format: 'mp3' }`
- **Storage:** In-memory `Map<string, AudioResult>` — no disk persistence
- **Lifetime:** Until VS Code window reloads (session-only)
- **Max size:** 100MB cap, evict oldest entries (LRU)
- **Why sentence-level:** Re-reading a document reuses most cached sentences

## Package.json Commands & Contributions

```
Commands:
  read-tts.speakDocument    — "Read: Speak Document"
  read-tts.speakSelection   — "Read: Speak Selection"
  read-tts.startFromCursor  — "Read: Start from Here"
  read-tts.pauseResume      — "Read: Pause/Resume"
  read-tts.stop             — "Read: Stop"
  read-tts.setApiKey        — "Read: Set API Key"
  read-tts.selectProvider   — "Read: Select TTS Provider"

Menus:
  editor/title → speakDocument (when .md or .txt, icon in title bar)
  editor/context → startFromCursor (right-click menu)

Keybindings:
  Ctrl+Shift+R → pauseResume

Sidebar:
  viewsContainers.activitybar → "Read TTS" with play icon
  views → webview for playback controls

Configuration:
  read-tts.provider       — "sarvam" | "elevenlabs" (default: "sarvam")
  read-tts.voice          — voice name/ID (default depends on provider)
  read-tts.speed          — 0.5–2.0 (default: 1.0)
  read-tts.highlightColor — background color for current sentence
```

## Implementation Steps

### Step 1: Scaffold the project
- Create directory structure under `~/labs/01-Active-Projects/read-vscode-tts/`
- Initialize with `npm init`, TypeScript, esbuild
- Set up `package.json` with extension metadata, commands, contributions
- Set up `tsconfig.json`, `.vscodeignore`, `.vscode/launch.json`
- Install deps: `@types/vscode`, `typescript`, `esbuild`

### Step 2: Provider interface + both implementations
- Define `ITtsProvider` interface in `src/providers/tts-provider.ts`
- Implement `SarvamProvider` — HTTP fetch, decode base64 response
- Implement `ElevenLabsProvider` — HTTP fetch, receive binary audio
- Validation method for each (hit a lightweight endpoint)

### Step 3: Text parser
- Sentence splitter: split on `.!?` followed by whitespace, respecting abbreviations
- Markdown stripper: remove `#`, `*`, `_`, `[links](url)`, code blocks, frontmatter
- Map each sentence back to its document Range (start/end positions in editor)
- Handle: numbered lists, bullet points, code blocks (skip)

### Step 4: Audio manager + cache
- Orchestrate: take sentences array, synthesize sequentially
- In-memory cache with hash keys
- Track `currentIndex`, expose play/pause/stop/seekTo(index)
- Fire events: `onSentenceChange`, `onPlaybackStateChange`

### Step 5: Highlight manager
- Create decoration type with configurable highlight color
- Subscribe to `onSentenceChange` from audio manager
- Apply decoration to current sentence's Range
- Auto-scroll to keep current sentence visible (`editor.revealRange()`)

### Step 6: Webview + playback controls
- Sidebar WebviewViewProvider with play/pause/stop buttons
- `<audio>` element receives base64 data URLs via postMessage
- Fires `ended` event back to extension to advance
- Shows current sentence text and time

### Step 7: Commands + context menu + keybindings
- Wire commands to audio manager
- "Start from Here" — find sentence at cursor position
- Title bar icon for quick speak

### Step 8: Settings + API key management
- SecretStorage for API keys (per provider)
- Configuration for provider, voice, speed
- Quick pick for provider switching

### Step 9: Test + polish
- Test with real Sarvam API calls on `.md` files
- Verify caching (second playback should be instant)
- Test pause/resume/start-from-here
- Error handling (API failures, no key, empty docs)
- Package and install locally

## Verification Checklist

1. Open `.md` file → title bar icon → TTS with sentence highlighting
2. Pause → highlight stays → resume → continues from same spot
3. Right-click sentence → "Start from Here" → reads from that sentence
4. Replay same document → instant (cached)
5. Switch provider in settings → next playback uses new provider
6. Reload VS Code → cache cleared (session-only)
