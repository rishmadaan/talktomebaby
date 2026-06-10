# Provider Architecture — API Keys, Platform Coverage, and the OS-Agnostic Roadmap

**Last updated:** 2026-06-10

## How API keys are stored (and why it's safe)

When a provider needs a key (ElevenLabs, Sarvam), the extension prompts with a masked
input box and stores the value via the **VS Code SecretStorage API**. What that means
per platform:

| OS | Actual backing store |
|---|---|
| macOS | Keychain (the same encrypted store Safari uses for passwords) |
| Windows | Windows Credential Manager |
| Linux | libsecret (GNOME Keyring / KWallet) |

Properties of this design:

- The key is **never** written to `settings.json`, never synced by Settings Sync,
  never committed to git, and never logged.
- Other extensions cannot read it — SecretStorage is namespaced per extension.
- Deleting the extension removes access; the OS store can also be inspected/cleared
  by the user directly (e.g. Keychain Access on macOS).
- The key lives in memory only while a provider instance exists (a reading session
  or a voice-list fetch).

This is the standard, recommended pattern for VS Code extensions. The thing to be
wary of in other extensions is keys requested as plain settings values — we don't
do that.

## Provider landscape and honest fragility notes

| Provider | Quality | Word timing | Key | Offline | Fragility |
|---|---|---|---|---|---|
| Edge TTS | Neural, very good | Exact (word boundaries) | No | No | **Unofficial.** Uses the same endpoint Edge's "Read Aloud" uses, via the `msedge-tts` package. Microsoft offers no contract; it has changed before (we already had to move from package v1 to v2) and could break or get gated at any time. That is the price of free. |
| ElevenLabs | Best-in-class | Exact (char alignment) | Yes | No | Official API, stable. Paid. |
| macOS `say` | Decent (Enhanced voices) | Estimated | No | **Yes** | Official Apple CLI, stable. **macOS only.** |
| Sarvam AI | Good (Indian English) | Estimated | Yes | No | Official API. |

Two structural gaps follow from this table:

1. **The default provider is unofficial.** If Edge TTS breaks upstream, zero-config
   users lose audio until we ship a fix or they configure a key. Mitigation today:
   three alternative providers. Real mitigation: gap 2.
2. **Offline reading only exists on macOS.** Windows and Linux users have no
   offline/no-key option besides Edge (which needs network anyway).

## The OS-agnostic solve (roadmap)

The naive path is per-OS system voices: Windows SAPI (`System.Speech` via
PowerShell) and Linux `espeak-ng`/`speech-dispatcher` next to macOS `say`. Three
integrations, three quality levels (espeak in particular sounds robotic), three
maintenance surfaces, and still only estimated word timing.

The better path is **one bundled local neural TTS engine**, identical on every OS:

- **Piper** — small (~50-100 MB per voice), fast on CPU, MIT-licensed, good
  quality, runs via onnxruntime. The strongest candidate.
- **Kokoro** — higher quality, ~82M params, also ONNX-runnable; heavier.

What this buys: a true offline default that works the same on macOS, Windows, and
Linux, no API keys, no unofficial endpoints, and phoneme timestamps from the engine
itself (better-than-estimated word highlighting). What it costs: shipping or
downloading a model (likely a one-time "download voice (60 MB)" flow, since bundling
it in the VSIX would bloat the install), plus onnxruntime-node as a native
dependency.

**Recommendation:** keep Edge TTS as the zero-config default for now; build the
Piper provider as the next major feature. When Piper lands, it becomes the offline
default and `say` becomes a legacy/extra option. This removes both structural gaps
in one move.
