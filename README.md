# SpeakItToMe

SpeakItToMe reads your prose files aloud inside VS Code with a dedicated Reader panel, word-level karaoke highlighting, and click-to-jump navigation. It works out of the box with Edge TTS (free, no key needed) and supports ElevenLabs, macOS say, and Sarvam AI.

Core features:
- **Reader panel** - rendered reading view with dual-layer highlighting: sentence band + moving word sweep
- **Click any word** to jump playback there instantly; `alt+j` jumps from the source editor to the cursor
- **Speed 0.5-2x** with pitch preserved, no re-synthesis; presets + fine slider, persisted across sessions
- **Disk cache** (default 200 MB) so re-reads cost no API credits

Supported file types: `.md`, `.mdx`, `.txt`, `.rst`, `.org`, `.tex`, `.adoc`

---

## Install

### From VSIX (current)

```bash
code --install-extension speakittome-0.2.0.vsix
```

Or via the UI: `Cmd+Shift+P` > **Extensions: Install from VSIX...** > select the file.

### Build from source

```bash
git clone https://github.com/rishmadaan/read-vscode-tts.git
cd read-vscode-tts
git checkout speakittome-rebuild
npm install
npm run package   # produces speakittome-0.2.0.vsix
code --install-extension speakittome-0.2.0.vsix
```

---

## Quick start

1. Open any `.md`, `.txt`, or other supported prose file
2. `Cmd+Shift+P` > **SpeakItToMe: Read Document**
3. The Reader panel opens; reading starts from the beginning

To start from a specific point: place your cursor, then use **SpeakItToMe: Read from Here** (right-click menu or command palette).

---

## Reader panel

The Reader panel renders your document as a clean reading view. Each word is individually clickable.

- **Click any word** to jump playback there and resume from that word
- **Scroll freely** - auto-scroll follows playback while you don't interact; scroll away and a **Return to playback** pill appears in the corner; click it to snap back and re-engage auto-scroll
- The **player bar** at the bottom has speed presets, a fine slider, pause/resume, and stop
- The **gear (⚙)** at the right end of the player bar opens an in-reader settings panel for provider, voice, font size, and highlight colors (see [Switching provider and voice](#switching-provider-and-voice))

---

## Speed

Speed is set via the player bar in the Reader panel. Presets: 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0x. The fine slider covers the full 0.5-2.0 range. Pitch is preserved at all speeds using `preservesPitch`. The chosen speed is persisted globally and restored on the next read.

---

## Providers

| Provider | Quality | Word timing | Key required | Notes |
|---|---|---|---|---|
| Edge TTS (default) | Good | Word-level | No | Free. Requires internet. Many voices. |
| ElevenLabs | Premium | Word-level | Yes | High-quality voices. Free tier may 401 on TTS calls; paid plan recommended. |
| macOS say | Basic | Estimated | No | Offline. macOS only. Novelty voices (Zarvox, Boing, ...) are filtered out of the voice list. |
| Sarvam AI | Good | Estimated | Yes | Indian English focus. |

### Switching provider and voice

The primary way to change provider, voice, and reader appearance is the **settings panel inside the Reader**: click the gear (⚙) at the right end of the player bar. It opens a panel above the player bar with:

- **Provider** — one row per available provider, showing a short description, a "key required" badge where relevant, and a check (✓) on the active one. Click a row to switch. (macOS say only appears on macOS.)
- **Voice** — a dropdown of the active provider's voices, with the current one selected.
- **Font size** — a +/- stepper (12-28px) that applies instantly and persists.
- **Highlight colors** — sentence-band and current-word color pickers that apply instantly, plus **Reset to theme** to clear both back to the theme default.

(Speed lives in the player bar, not the settings panel.)

**Live restart:** if you change the provider or voice while a session is playing, the session restarts automatically from the **current sentence** with the new provider/voice. Opening or closing the settings panel does not pause playback.

If a key-required provider has no stored key, switching to it prompts for the key first; cancel and the selection snaps back to the current provider.

**Command palette (alternative):**

- Switch provider: `Cmd+Shift+P` > **SpeakItToMe: Select TTS Provider** — marks the active provider with ✓ / "(current)", and live-restarts on change.
- Select voice: `Cmd+Shift+P` > **SpeakItToMe: Select Voice** — same active marker and live-restart.
- Set API key: `Cmd+Shift+P` > **SpeakItToMe: Set API Key**

---

## Editor surface

While a session is active, the source editor stays in sync with the reader:

- **Sentence decoration** - the sentence currently being spoken is highlighted in the source editor
- **alt+j** (in the source editor) - jumps playback to the word at cursor; always starts playback even if paused
- **editorClickToJump setting** - controls whether a plain click in the editor also triggers a jump (see settings table below)
- **Document edits** - if you edit the file mid-read, playback pauses and a prompt offers to restart from the current position or stop

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `speakittome.provider` | `edge` | TTS provider: `edge`, `elevenlabs`, `say`, `sarvam` |
| `speakittome.voice.edge` | `en-US-AriaNeural` | Voice for Edge TTS |
| `speakittome.voice.elevenlabs` | `21m00Tcm4TlvDq8ikWAM` | Voice ID for ElevenLabs |
| `speakittome.voice.say` | `Samantha` | Voice for macOS say |
| `speakittome.voice.sarvam` | `shubh` | Voice for Sarvam AI |
| `speakittome.speed` | `1.0` | Playback speed (0.5-2.0). Updated automatically when changed in the player. |
| `speakittome.editorClickToJump` | `alt-j` | Jump trigger in the source editor: `off`, `alt-j` (keyboard shortcut only), `plain-click` (any click during a session) |
| `speakittome.readerFontSize` | `16` | Reader panel font size in px |
| `speakittome.highlight.sentenceColor` | `""` | Sentence band highlight color. Empty uses the theme default. |
| `speakittome.highlight.wordColor` | `""` | Current word highlight color. Empty uses the theme default. |
| `speakittome.cacheSizeMB` | `200` | Disk cache size limit in MB. Audio is cached under `globalStorageUri/audio-cache`. |

---

## Keybindings

| Key | Command |
|---|---|
| `cmd+shift+r` / `ctrl+shift+r` | Pause / Resume |
| `alt+j` (editor focus) | Jump playback to cursor |

---

## Commands

| Command | Description |
|---|---|
| SpeakItToMe: Read Document | Open Reader and read the active file from the beginning |
| SpeakItToMe: Read from Here | Open Reader and read from the cursor position |
| SpeakItToMe: Read Selection | Open Reader and read from the start of the current selection |
| SpeakItToMe: Open Reader | Reveal the Reader panel if already open |
| SpeakItToMe: Pause/Resume | Toggle playback |
| SpeakItToMe: Stop | Stop playback and close the session |
| SpeakItToMe: Jump Playback to Cursor | Jump to the word at cursor in the source editor |
| SpeakItToMe: Select TTS Provider | Pick a provider from a quick-pick list |
| SpeakItToMe: Select Voice | Pick a voice for the active provider |
| SpeakItToMe: Set API Key | Store an API key for ElevenLabs or Sarvam |

---

## Troubleshooting

**Edge TTS produces no audio / connection error**
Edge TTS requires an internet connection to Microsoft's speech service. If you are offline, switch to macOS say (`speakittome.provider: say`) or a cached document.

**macOS say not available**
The `say` provider only works on macOS. On other platforms it is hidden from the provider picker.

**ElevenLabs returns 401**
ElevenLabs free accounts may be blocked from the TTS API. A paid plan (Starter tier or higher) is recommended for API access.

**First read of a long document is slow**
Audio is synthesized in chunks as you read - subsequent sentences are prefetched in the background. Once a chunk is cached to disk, replaying it is instant and costs no API credits.

**Playback highlight is off after editing**
If you edit the document while reading, the session model becomes stale. Use the prompt that appears to restart from your current position.

---

## License

[MIT](LICENSE)
