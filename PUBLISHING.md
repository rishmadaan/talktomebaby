# Publishing to VS Code Marketplace

## Pre-Publish Checklist

Before publishing, verify each of these:

- [x] **Name availability:** "talktomebaby" is published on the marketplace as `rishmadaan.talktomebaby`
- [ ] **Fragility review:** read [docs/provider-architecture.md](docs/provider-architecture.md) — the Edge TTS provider uses an **unofficial** Microsoft endpoint (`msedge-tts`). Microsoft offers no SLA; it has changed before. Decide how prominently to disclose this in the marketplace listing before publishing to a wide audience
- [x] Extension icon (128x128 or 256x256 PNG) created and referenced as `"icon": "icon.png"` in `package.json`
- [x] `publisher` field in `package.json` is `rishmadaan` (matches your marketplace publisher ID)
- [x] `repository.url` in `package.json` points to your public GitHub repo (`https://github.com/rishmadaan/talktomebaby`)
- [x] README.md has no broken image links (marketplace renders it directly)
- [x] All images use HTTPS URLs (no SVGs except badges)
- [x] CHANGELOG.md is up to date
- [x] Run `npm run build` — build passes clean
- [x] Test the packaged extension: `npm run package` produces `talktomebaby-0.3.0.vsix`; install it with `code --install-extension talktomebaby-0.3.0.vsix` and verify it works

Built VSIX files are release artifacts. Upload them to Marketplace or attach them to GitHub Releases; do not commit them to the repository.

## Prerequisites

1. **Microsoft/Azure DevOps account** — sign up at [dev.azure.com](https://dev.azure.com)
2. **Personal Access Token (PAT)**:
   - Azure DevOps > User Settings (gear icon) > Personal Access Tokens
   - Organization: "All accessible organizations"
   - Scope: **Marketplace > Manage**
   - Copy the token (shown only once)
3. **Publisher account** — either:
   - Web: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) > Create Publisher (`rishmadaan`)
   - CLI: `npx @vscode/vsce create-publisher rishmadaan`

## Publishing Commands

Recommended pre-release path:

```bash
# Install the publishing tool (if not already)
npm install -g @vscode/vsce

# Login with your PAT
vsce login rishmadaan

# Package (creates talktomebaby-0.3.0.vsix)
vsce package

# Publish to marketplace
vsce publish --pre-release

# Publish a specific version bump
vsce publish minor    # 0.3.0 → 0.4.0
vsce publish patch    # 0.3.0 → 0.3.1
```

Manual web upload path:

1. Run `npm run package`.
2. Open [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
3. Select publisher `rishmadaan`.
4. Choose **New extension > Visual Studio Code**.
5. Upload `talktomebaby-0.3.0.vsix`.

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
