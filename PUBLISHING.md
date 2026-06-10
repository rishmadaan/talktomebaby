# Publishing to VS Code Marketplace — Parked for Later

## Pre-Publish Checklist

Before publishing, verify each of these:

- [ ] **Name availability:** confirm "talktomebaby" is not already taken on the marketplace at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
- [ ] **Fragility review:** read [docs/provider-architecture.md](docs/provider-architecture.md) — the Edge TTS provider uses an **unofficial** Microsoft endpoint (`msedge-tts`). Microsoft offers no SLA; it has changed before. Decide how prominently to disclose this in the marketplace listing before publishing to a wide audience
- [ ] Extension icon (128x128 or 256x256 PNG) created and referenced as `"icon": "icon.png"` in `package.json`
- [ ] `publisher` field in `package.json` is `rish` (matches your marketplace publisher ID)
- [ ] `repository.url` in `package.json` points to your public GitHub repo (currently `https://github.com/rishmadaan/read-vscode-tts`)
- [ ] README.md has no broken image links (marketplace renders it directly)
- [ ] All images use HTTPS URLs (no SVGs except badges)
- [ ] CHANGELOG.md is up to date
- [ ] Run `npm run build` — build passes clean
- [ ] Test the packaged extension: `npm run package` produces `talktomebaby-0.3.0.vsix`; install it with `code --install-extension talktomebaby-0.3.0.vsix` and verify it works

## Prerequisites

1. **Microsoft/Azure DevOps account** — sign up at [dev.azure.com](https://dev.azure.com)
2. **Personal Access Token (PAT)**:
   - Azure DevOps > User Settings (gear icon) > Personal Access Tokens
   - Organization: "All accessible organizations"
   - Scope: **Marketplace > Manage**
   - Copy the token (shown only once)
3. **Publisher account** — either:
   - Web: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) > Create Publisher (`rish`)
   - CLI: `npx @vscode/vsce create-publisher rish`

## Publishing Commands

```bash
# Install the publishing tool (if not already)
npm install -g @vscode/vsce

# Login with your PAT
vsce login rish

# Package (creates talktomebaby-0.3.0.vsix)
vsce package

# Publish to marketplace
vsce publish

# Publish a specific version bump
vsce publish minor    # 0.3.0 → 0.4.0
vsce publish patch    # 0.3.0 → 0.3.1
```

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
