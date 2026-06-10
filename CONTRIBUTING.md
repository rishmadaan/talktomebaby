# Contributing

Thanks for your interest in contributing to TalkToMeBaby!

## Getting Started

1. Fork and clone the repo
2. Run `npm install`
3. Open the project in VS Code
4. Press `F5` to launch the Extension Development Host
5. Make changes and test in the dev host

See [CLAUDE.md](CLAUDE.md) for the full source layout and key invariants — read it before making structural changes.

## Build & Test

```bash
npm run compile   # dev build
npm test          # vitest — 63 tests, no VS Code runtime needed
```

## Before Submitting a PR

- Open an issue first to discuss non-trivial changes
- Keep PRs focused — one feature or fix per PR
- Add `*.test.ts` tests for any new core or synthesis logic (the test suite runs without a VS Code runtime)
- No API keys in code — keys go through VS Code SecretStorage via `ApiKeyManager`
- Run `npm run compile` and `npm test` — both must pass
- Update `CHANGELOG.md` if adding features or fixing bugs

## Adding a New TTS Provider

The architecture is provider-agnostic. See the "Adding a New TTS Provider" section in [CLAUDE.md](CLAUDE.md) for the step-by-step.

## Reporting Bugs

Use the GitHub issue template. Include:
- What you expected vs what happened
- Steps to reproduce
- VS Code version, OS, and extension version
- Check Output panel > "TalkToMeBaby" for error logs
