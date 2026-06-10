# TalkToMeBaby

TalkToMeBaby is a Speechify-inspired read-aloud extension for VS Code. It reads your prose files aloud with a dedicated Reader panel, word-level karaoke highlighting, and click-to-jump navigation. On macOS it defaults to the built-in `say` command (official, fully offline, no data leaves the machine); on Windows and Linux it defaults to the free unofficial Edge TTS provider. Any provider can be chosen explicitly. Supported providers: Edge TTS, ElevenLabs, macOS say, and Sarvam AI.

TalkToMeBaby is independent and is not affiliated with, endorsed by, or sponsored by Speechify.

Use of TalkToMeBaby is at your own risk. You are responsible for choosing a provider, complying with provider terms, ensuring you have rights to send or synthesize the text you read, and protecting confidential or regulated content. See [DISCLAIMER.md](DISCLAIMER.md) and [PRIVACY.md](PRIVACY.md).

Core features:
- **Reader panel** - rendered reading view with dual-layer highlighting: sentence band + moving word sweep
- **Click any word** to jump playback there instantly; `alt+j` jumps from the source editor to the cursor
- **Speed 0.5-2x** with pitch preserved, no re-synthesis; presets + fine slider, persisted across sessions
- **Disk cache** (default 200 MB) so re-reads cost no API credits

Supported file types: `.md`, `.mdx`, `.txt`, `.rst`, `.org`, `.tex`, `.adoc`

---

## Install

### From the VS Code Marketplace

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rishmadaan.talktomebaby), or from VS Code:

1. Open the Extensions view
2. Search for **TalkToMeBaby**
3. Click **Install**

You can also install it from the command line:

```bash
code --install-extension rishmadaan.talktomebaby
```

### From VSIX

```bash
code --install-extension talktomebaby-0.3.2.vsix
```

Or via the UI: `Cmd+Shift+P` > **Extensions: Install from VSIX...** > select the file.

### Build from source

```bash
git clone https://github.com/rishmadaan/talktomebaby.git
cd talktomebaby
npm install
npm run package   # produces talktomebaby-0.3.2.vsix
code --install-extension talktomebaby-0.3.2.vsix
```

---

## Quick start

1. Open any `.md`, `.txt`, or other supported prose file
2. `Cmd+Shift+P` > **TalkToMeBaby: Read Document**
3. The Reader panel opens; reading starts from the beginning

To start from a specific point: place your cursor, then use **TalkToMeBaby: Read from Here** (right-click menu or command palette).

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
| macOS say | Basic | Estimated | No | **Default on macOS.** Offline, official Apple CLI. Novelty voices (Zarvox, Boing, ...) are filtered out of the voice list. macOS only. |
| Edge TTS | Good | Word-level | No | **Default on Windows/Linux.** Free, unofficial, best effort. Requires internet. Many voices. |
| ElevenLabs | Premium | Word-level | Yes | High-quality voices. Free tier may 401 on TTS calls; paid plan recommended. |
| Sarvam AI | Good | Estimated | Yes | Indian English focus. |

Network providers synthesize audio by sending the text being read to the selected provider. Edge, ElevenLabs, and Sarvam require internet access; macOS `say` runs locally and does not send text to a network TTS provider. See [PRIVACY.md](PRIVACY.md) for the full data-flow summary.

### Switching provider and voice

**The settings panel inside the Reader is the primary way to change everything.** Click the gear (⚙) in the player bar to open it; click the gear again, press **Esc**, or hit the **✕** to close it. The gear shows a pressed state while the panel is open. The panel slides in above the player bar with two sections:

- **Provider** — one row per available provider, each with a short description, a "key required" badge where relevant, and a check (✓) on the active one. Click a row to switch. (macOS say only appears on macOS.)
- **Voice** — a dropdown of the active provider's voices, with the current one selected.
- **Appearance**
  - **Font size** — a +/- stepper (12-28px) that applies instantly and persists.
  - **Highlight colors** — sentence-band and current-word color pickers that apply instantly, plus **Reset to theme** to clear both back to the theme default.

(Speed lives in the player bar, not the settings panel.)

**Instant open:** the panel opens immediately. Voices are cached per provider for the session and prefetched when a read starts, so the first open is usually instant; if a provider's voices are still loading you'll briefly see a disabled "Loading voices…" option, then the list fills in.

**Switching keeps your place and never auto-plays:** changing provider or voice reconfigures the reader **in place** — the Reader is not torn down and rebuilt. The session re-primes **paused at your current sentence** with the new voice; press play when you're ready. No surprise audio. The settings panel stays open across the switch.

If a key-required provider has no stored key, switching to it prompts for the key first; cancel and the selection snaps back to the current provider.

**Command palette (alternative, mirrors the gear panel):**

- Switch provider: `Cmd+Shift+P` > **TalkToMeBaby: Select TTS Provider** — marks the active provider with ✓ / "(current)", and reconfigures in place on change.
- Select voice: `Cmd+Shift+P` > **TalkToMeBaby: Select Voice** — same active marker; reconfigures in place.
- Set API key: `Cmd+Shift+P` > **TalkToMeBaby: Set API Key**

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
| `talktomebaby.provider` | `auto` | TTS provider: `auto` (macOS say on macOS, Edge elsewhere), `edge`, `elevenlabs`, `say`, `sarvam` |
| `talktomebaby.voice.edge` | `en-US-AriaNeural` | Voice for Edge TTS |
| `talktomebaby.voice.elevenlabs` | `21m00Tcm4TlvDq8ikWAM` | Voice ID for ElevenLabs |
| `talktomebaby.voice.say` | `Samantha` | Voice for macOS say |
| `talktomebaby.voice.sarvam` | `shubh` | Voice for Sarvam AI |
| `talktomebaby.speed` | `1.0` | Playback speed (0.5-2.0). Updated automatically when changed in the player. |
| `talktomebaby.editorClickToJump` | `alt-j` | Jump trigger in the source editor: `off`, `alt-j` (keyboard shortcut only), `plain-click` (any click during a session) |
| `talktomebaby.readerFontSize` | `16` | Reader panel font size in px |
| `talktomebaby.highlight.sentenceColor` | `""` | Sentence band highlight color. Empty uses the theme default. |
| `talktomebaby.highlight.wordColor` | `""` | Current word highlight color. Empty uses the theme default. |
| `talktomebaby.cacheSizeMB` | `200` | Disk cache size limit in MB. Audio is cached under `globalStorageUri/audio-cache`. |

---

## Privacy and API keys

TalkToMeBaby does not include analytics or telemetry. When you use a network TTS provider, the text being read is sent to that provider to generate audio. Provider keys (ElevenLabs, Sarvam) are stored via the VS Code SecretStorage API, which means your OS's encrypted credential store: Keychain on macOS, Credential Manager on Windows, libsecret on Linux. Keys are never written to settings.json, never synced, and never logged. See [PRIVACY.md](PRIVACY.md), [DISCLAIMER.md](DISCLAIMER.md), and the [provider architecture notes](https://github.com/rishmadaan/talktomebaby/blob/main/docs/provider-architecture.md) for the full picture, including honest fragility notes per provider and the roadmap for a fully offline, OS-agnostic voice engine.

## Keybindings

| Key | Command |
|---|---|
| `cmd+shift+r` / `ctrl+shift+r` | Pause / Resume |
| `alt+j` (editor focus) | Jump playback to cursor |

---

## Commands

| Command | Description |
|---|---|
| TalkToMeBaby: Read Document | Open Reader and read the active file from the beginning |
| TalkToMeBaby: Read from Here | Open Reader and read from the cursor position |
| TalkToMeBaby: Read Selection | Open Reader and read from the start of the current selection |
| TalkToMeBaby: Open Reader | Reveal the Reader panel if already open |
| TalkToMeBaby: Pause/Resume | Toggle playback |
| TalkToMeBaby: Stop | Stop playback and close the session |
| TalkToMeBaby: Jump Playback to Cursor | Jump to the word at cursor in the source editor |
| TalkToMeBaby: Select TTS Provider | Pick a provider from a quick-pick list |
| TalkToMeBaby: Select Voice | Pick a voice for the active provider |
| TalkToMeBaby: Set API Key | Store an API key for ElevenLabs or Sarvam |

---

## Troubleshooting

**Edge TTS produces no audio / connection error**
Edge TTS requires an internet connection to Microsoft's speech service and is an unofficial, best-effort provider. If you are offline, switch to macOS say (`talktomebaby.provider: say`) or a cached document.

**macOS say not available**
The `say` provider only works on macOS. On other platforms it is hidden from the provider picker.

**ElevenLabs returns 401**
ElevenLabs free accounts may be blocked from the TTS API. A paid plan (Starter tier or higher) is recommended for API access.

**First read of a long document is slow**
Audio is synthesized in chunks as you read - subsequent sentences are prefetched in the background. Once a chunk is cached to disk, replaying it is instant and costs no API credits.

**Playback highlight is off after editing**
If you edit the document while reading, the session model becomes stale. Use the prompt that appears to restart from your current position.

**Playback stopped after a VS Code reload**
Reloading the VS Code window or restarting the extension host always ends the active session — audio is not preserved across reloads. If TalkToMeBaby saved your position (within the last 3 seconds of playback), you will be offered a "Resume?" toast on the next activation.

---

## Reliability

**Resume after reload:** If VS Code reloads (window reload, extension host restart, OS sleep/wake), TalkToMeBaby saves your position automatically (every ~3 seconds while playing). When the extension reactivates, it offers a "Resume?" toast if a session was saved within the last 12 hours. Choosing Resume re-opens the document and jumps straight to your last sentence. Dismissing clears the saved position. The position is also cleared when you press Stop or when a document finishes naturally.

Note: a reload kills the active audio session — there is no way to resume mid-sentence. Resume starts from the beginning of the sentence you were on.

---

## Contributing and security

Contributions are welcome; see [CONTRIBUTING.md](https://github.com/rishmadaan/talktomebaby/blob/main/CONTRIBUTING.md) for local setup, test commands, and architectural invariants to preserve. Please follow the [Code of Conduct](https://github.com/rishmadaan/talktomebaby/blob/main/CODE_OF_CONDUCT.md).

For vulnerability reports or sensitive security issues, see [SECURITY.md](https://github.com/rishmadaan/talktomebaby/blob/main/SECURITY.md). Do not open public issues that contain API keys, tokens, or private document contents.

---

## License

[MIT](LICENSE). Additional disclaimers are in [DISCLAIMER.md](DISCLAIMER.md). Third-party runtime dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
