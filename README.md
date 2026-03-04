# Read — Text to Speech for VS Code

Read your Markdown and text files aloud with **sentence-level text highlighting**. The current sentence is highlighted in your editor as the audio plays — like a reading guide that follows along.

Supports **Sarvam AI** and **ElevenLabs** as TTS providers, with an architecture that makes adding new providers straightforward.

## Features

- **Highlight while reading** — the current sentence is highlighted in your editor and auto-scrolls to stay visible
- **Play / Pause / Resume** — full playback controls in the sidebar, plus `Cmd+Shift+R` keyboard shortcut
- **Start from anywhere** — right-click any sentence and choose "Read: Start from Here"
- **Session caching** — sentences are cached in memory so re-reading a document costs zero API credits
- **Provider-agnostic** — switch between Sarvam AI and ElevenLabs (or add your own provider)

## Installation

### From Source (Development)

```bash
git clone https://github.com/YOUR_USERNAME/read-vscode-tts.git
cd read-vscode-tts
npm install
npm run compile
```

Then open the project in VS Code and press `F5` to launch the Extension Development Host.

### As a Packaged Extension

```bash
npm run build
npx @vscode/vsce package
code --install-extension read-vscode-tts-0.1.0.vsix
```

## Setup

1. Open the Command Palette (`Cmd+Shift+P`)
2. Run **"Read: Set API Key"**
3. Select your TTS provider and paste your API key
4. Open any `.md` or `.txt` file
5. Click the speaker icon in the editor title bar

### Getting API Keys

**Sarvam AI** (recommended for getting started):
- Sign up at [sarvam.ai](https://www.sarvam.ai/) — you get Rs.1000 in free credits
- Go to Dashboard > API Keys > Create
- Supports Indian English with 45+ natural voices

**ElevenLabs**:
- Sign up at [elevenlabs.io](https://elevenlabs.io/)
- Go to Settings > API Keys > Create
- Note: requires a paid plan ($5/mo starter) for API access

## Usage

| Action | How |
|--------|-----|
| Read entire document | Click speaker icon in title bar, or `Cmd+Shift+P` > "Read: Speak Document" |
| Read selected text | Select text, right-click > "Read: Speak Selection" |
| Start from a sentence | Place cursor, right-click > "Read: Start from Here" |
| Pause / Resume | `Cmd+Shift+R` or click pause in sidebar |
| Stop | Click stop in sidebar, or `Cmd+Shift+P` > "Read: Stop" |
| Switch provider | `Cmd+Shift+P` > "Read: Select TTS Provider" |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `read-tts.provider` | `sarvam` | TTS provider (`sarvam` or `elevenlabs`) |
| `read-tts.voice` | _(provider default)_ | Voice name/ID. Sarvam: `shubh`, `priya`, `ritu`, etc. ElevenLabs: voice ID |
| `read-tts.speed` | `1.0` | Speech speed (0.5 to 2.0) |
| `read-tts.highlightColor` | _(theme-aware yellow)_ | Custom highlight color, e.g. `#FFFF0033` |

## How It Works

1. Your document is parsed into sentences (markdown formatting is stripped)
2. Each sentence is sent to the TTS API and the audio is cached in memory
3. As each sentence plays, it's highlighted in the editor with auto-scroll
4. Cached sentences replay instantly — no API call needed on re-reads
5. Cache is session-only (cleared when VS Code reloads)

## Architecture

```
src/
├── providers/          # TTS provider interface + implementations
│   ├── tts-provider.ts       # ITtsProvider interface
│   ├── sarvam-provider.ts    # Sarvam AI
│   └── elevenlabs-provider.ts
├── managers/           # Core logic
│   ├── audio-manager.ts      # Playback orchestration + caching
│   ├── highlight-manager.ts  # Editor text decorations
│   └── api-key-manager.ts    # Secure key storage
├── utils/
│   ├── text-parser.ts        # Sentence splitting + markdown stripping
│   └── cache.ts              # LRU in-memory cache (100MB cap)
├── webview/            # Sidebar playback panel
│   ├── webview-provider.ts
│   └── media/
│       ├── playback.js       # Web Audio API playback
│       └── playback.css
└── extension.ts        # Entry point
```

### Adding a New TTS Provider

Implement the `ITtsProvider` interface:

```typescript
interface ITtsProvider {
  readonly name: string;
  readonly maxCharsPerRequest: number;
  readonly defaultVoice: string;
  synthesize(text: string, options: TtsOptions): Promise<AudioResult>;
  validateKey(apiKey: string): Promise<boolean>;
}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Known Limitations

- Highlighting is sentence-level, not word-level (TTS APIs don't return word timestamps in their REST endpoints)
- Supported file types: `.md` and `.txt` only
- ElevenLabs free tier does not support API access — a paid plan is required
- Audio is cached in memory only (cleared on VS Code reload)

## License

[MIT](LICENSE)
