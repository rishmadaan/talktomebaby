# Privacy

TalkToMeBaby is a local VS Code extension for reading prose files aloud. It does not include analytics, telemetry, tracking pixels, or a remote service operated by this project.

## Text Sent to TTS Providers

When you start reading, TalkToMeBaby turns the current document or selection into text chunks and asks the active text-to-speech provider to synthesize audio.

| Provider | Text leaves your machine? | Notes |
|---|---:|---|
| Edge TTS | Yes | Uses the unofficial `msedge-tts` package against the same general service family used by Microsoft Edge Read Aloud. This is best effort and may change or stop working. |
| ElevenLabs | Yes | Uses ElevenLabs' official API with your API key. |
| Sarvam AI | Yes | Uses Sarvam AI's official API with your API key. |
| macOS `say` | No | Runs locally through Apple's `say` command and does not send text to a network TTS provider. macOS only. |

Only the text needed for the requested audio chunk is sent. TalkToMeBaby does not intentionally send file paths, repository names, workspace names, API keys, or editor metadata to TTS providers.

## API Keys

ElevenLabs and Sarvam API keys are stored through VS Code SecretStorage, backed by the operating system credential store where available:

| OS | Backing store |
|---|---|
| macOS | Keychain |
| Windows | Windows Credential Manager |
| Linux | libsecret / desktop keyring |

Keys are not written to `settings.json`, not synced by VS Code Settings Sync, not logged, and not committed by the extension.

## Local Storage

TalkToMeBaby stores generated audio chunks in VS Code global extension storage under `globalStorageUri/audio-cache`. The cache is local to your machine and is limited by `talktomebaby.cacheSizeMB` (default 200 MB). Cached audio may contain spoken versions of text you asked the extension to read.

The extension also stores the last reading position in VS Code workspace state so it can offer resume-after-reload.

## Telemetry

TalkToMeBaby does not collect or send analytics events. If telemetry is added in the future, it should respect VS Code's telemetry controls and be documented here before release.

## User Responsibility

Do not use a network TTS provider for documents that you are not allowed to send to that provider. This includes confidential work files, private client data, regulated data, or third-party copyrighted content where transmission to a cloud service is not permitted.

For broader warranty, liability, provider, content-rights, and acceptable-use disclaimers, see [DISCLAIMER.md](DISCLAIMER.md).
