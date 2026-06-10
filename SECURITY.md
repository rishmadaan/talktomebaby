# Security Policy

## Reporting a Vulnerability

Please report security issues privately through GitHub's security advisory flow for this repository:

<https://github.com/rishmadaan/talktomebaby/security/advisories/new>

Do not open a public issue for vulnerabilities, API keys, tokens, or private document contents. If GitHub private advisories are unavailable, contact the repository owner through GitHub and share only the minimum detail needed to establish a private channel.

## API Keys

TalkToMeBaby stores provider API keys with VS Code SecretStorage. Keys are not written to `settings.json`, synced through VS Code Settings Sync, logged, or committed by the extension.

If you suspect a provider key was exposed outside TalkToMeBaby, revoke it with the provider immediately and create a replacement key.

## Network Providers

The default Edge TTS provider uses an unofficial Microsoft endpoint through the `msedge-tts` package. This is a reliability and upstream-change risk, not a secret-handling mechanism. ElevenLabs and Sarvam use their official APIs and require user-provided keys.
