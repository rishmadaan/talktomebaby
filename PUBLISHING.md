# Publishing to VS Code Marketplace — Parked for Later

## Prerequisites

1. **Microsoft/Azure DevOps account** — sign up at [dev.azure.com](https://dev.azure.com)
2. **Personal Access Token (PAT)**:
   - Azure DevOps > User Settings (gear icon) > Personal Access Tokens
   - Organization: "All accessible organizations"
   - Scope: **Marketplace > Manage**
   - Copy the token (shown only once)
3. **Publisher account** — either:
   - Web: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) > Create Publisher
   - CLI: `npx @vscode/vsce create-publisher YOUR_PUBLISHER_ID`
4. **Extension icon** — 128x128 or 256x256 PNG, add `"icon": "icon.png"` to package.json

## Before Publishing Checklist

- [ ] Extension icon (PNG) created and referenced in package.json
- [ ] `publisher` field in package.json matches your marketplace publisher ID
- [ ] `repository.url` in package.json points to your public GitHub repo
- [ ] README.md has no broken image links (marketplace renders it directly)
- [ ] All images use HTTPS URLs (no SVGs except badges)
- [ ] CHANGELOG.md is up to date
- [ ] Run `npm run build` — build passes clean
- [ ] Test the packaged extension: `npx @vscode/vsce package` then install the .vsix

## Publishing Commands

```bash
# Install the publishing tool (if not already)
npm install -g @vscode/vsce

# Login with your PAT
vsce login YOUR_PUBLISHER_ID

# Package (creates a .vsix file)
vsce package

# Publish to marketplace
vsce publish

# Publish a specific version bump
vsce publish minor    # 0.1.0 → 0.2.0
vsce publish patch    # 0.1.0 → 0.1.1
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
