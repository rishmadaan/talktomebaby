# Publishing to VS Code Marketplace

## Pre-Publish Checklist

Before publishing, verify each of these:

- [x] **Name availability:** "talktomebaby" is published on the marketplace as `rishmadaan.talktomebaby`
- [x] **Fragility review:** README and [docs/provider-architecture.md](docs/provider-architecture.md) disclose that the Edge TTS provider uses an **unofficial** Microsoft endpoint (`msedge-tts`). Microsoft offers no SLA; it has changed before and could break or become gated
- [x] **Privacy disclosure:** README links to [PRIVACY.md](PRIVACY.md), which states that network TTS providers receive the text being read
- [x] **Third-party notices:** [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) is present and packaged with the VSIX
- [x] Extension icon (128x128 or 256x256 PNG) created and referenced as `"icon": "icon.png"` in `packages/vscode-extension/package.json`
- [x] `publisher` field in `packages/vscode-extension/package.json` is `rishmadaan` (matches your marketplace publisher ID)
- [x] `repository.url` in `packages/vscode-extension/package.json` points to your public GitHub repo (`https://github.com/rishmadaan/talktomebaby`)
- [x] README.md has no broken image links (marketplace renders it directly)
- [x] All images use HTTPS URLs (no SVGs except badges)
- [x] `CHANGELOG.md` is up to date
- [x] Run `npm run build` — build passes clean
- [x] Test the packaged extension: from `packages/vscode-extension`, `npm run package` produces `talktomebaby.vsix`; install it with `code --install-extension talktomebaby.vsix` and verify it works

Built VSIX files are release artifacts. Upload them to Marketplace or attach them to GitHub Releases; do not commit them to the repository.

## Prerequisites

1. **Microsoft/Azure DevOps account** — sign up at [dev.azure.com](https://dev.azure.com)
2. **Publisher account** — either:
   - Web: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) > Create Publisher (`rishmadaan`)
   - CLI: `npx @vscode/vsce create-publisher rishmadaan`
3. **Publishing authentication**:
   - For manual/local publishing today, `vsce login rishmadaan` can still use an Azure DevOps token with **Marketplace > Manage** scope.
   - For automated publishing, prefer Microsoft Entra ID / workload identity federation. Microsoft documents global Azure DevOps PAT retirement on **December 1, 2026**, so do not build new long-lived automation around PATs.

## Publishing Commands

Recommended pre-release path:

```bash
# Install the publishing tool (if not already)
npm install -g @vscode/vsce

# Login for manual publishing
vsce login rishmadaan

cd packages/vscode-extension

# Package (creates talktomebaby.vsix)
npm run package

# Publish to marketplace
vsce publish --pre-release

# Publish a specific version bump
vsce publish minor    # 0.3.1 → 0.4.0
vsce publish patch    # 0.3.1 → 0.3.2
```

Manual web upload path:

1. From `packages/vscode-extension`, run `npm run package`.
2. Open [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
3. Select publisher `rishmadaan`.
4. Choose **New extension > Visual Studio Code**.
5. Upload `packages/vscode-extension/talktomebaby.vsix`.

## Updating an Existing Extension

```bash
# Bump version and publish
vsce publish patch -m "Fix: description of fix"

# Or manually update version in package.json, then:
vsce publish
```

## Alternative: Open VSX Registry

If you want to publish to the vendor-neutral registry (used by VSCodium, Gitpod, Theia):

1. Get a token from [open-vsx.org](https://open-vsx.org/) (GitHub login)
2. `npx ovsx publish -p YOUR_TOKEN`

This is separate from the Microsoft marketplace — you can publish to both.

## Useful Links

- [Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Marketplace Management](https://marketplace.visualstudio.com/manage)
- [Open VSX](https://open-vsx.org/)
