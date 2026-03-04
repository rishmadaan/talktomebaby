# Contributing

Thanks for your interest in contributing to Read TTS!

## Getting Started

1. Fork and clone the repo
2. Run `npm install`
3. Open the project in VS Code
4. Press `F5` to launch the Extension Development Host
5. Make your changes and test in the dev host

## Before Submitting a PR

- Please open an issue first to discuss the change
- Keep PRs focused — one feature or fix per PR
- Run `npm run compile` to verify the build passes
- Update CHANGELOG.md if adding features or fixing bugs

## Adding a New TTS Provider

The architecture is provider-agnostic. To add a new provider:

1. Create `src/providers/your-provider.ts` implementing `ITtsProvider`
2. Add it to `src/managers/api-key-manager.ts` (secret key + quick pick option)
3. Update `package.json` with the new enum value in `read-tts.provider`

## Reporting Bugs

Use the GitHub issue template. Include:
- What you expected vs what happened
- Steps to reproduce
- VS Code version, OS, and extension version
