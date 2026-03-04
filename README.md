# Read — Text to Speech for VS Code

A VS Code extension that reads your documents aloud while highlighting each sentence in the editor as it's spoken. Think audiobook mode for your Markdown and text files.

You bring your own TTS API key (Sarvam AI or ElevenLabs), and the extension handles the rest — sentence parsing, audio playback, caching, and synchronized highlighting that follows along in the editor.

## Why

Reading your own writing aloud is one of the best ways to catch awkward phrasing, run-on sentences, and flow issues. But switching between an editor and a separate TTS tool breaks concentration. This extension keeps everything in one place — you hear your text and see exactly which sentence is playing, right in VS Code.

## Features

- **Sentence highlighting** — the current sentence is highlighted in the editor and auto-scrolls to stay visible
- **Full playback controls** — play, pause, resume, stop — in the sidebar panel and via `Cmd+Shift+R`
- **Start from anywhere** — right-click to start reading from any point in the document
- **Smart caching** — audio is cached per-sentence in memory, so re-reading costs zero API calls
- **Multiple providers** — switch between Sarvam AI and ElevenLabs from the sidebar, or add your own
- **Markdown-aware** — strips formatting before speaking, so you hear clean prose, not syntax

## Installation

### Install from VSIX (Recommended)

1. Download the latest `.vsix` file from [Releases](https://github.com/rishmadaan/read-vscode-tts/releases)
2. In VS Code, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **"Extensions: Install from VSIX..."**
4. Select the downloaded `.vsix` file

Or install from the terminal:

```bash
code --install-extension read-tts-0.1.0.vsix
```

### Build from Source

```bash
git clone https://github.com/rishmadaan/read-vscode-tts.git
cd read-vscode-tts
npm install
npm run compile
```

**To package and install locally:**

```bash
npx @vscode/vsce package         # Creates read-tts-0.1.0.vsix
```

Then install the `.vsix` using either method above.

**To run in development mode:**

Open the project in VS Code and press `F5` to launch the Extension Development Host.

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
