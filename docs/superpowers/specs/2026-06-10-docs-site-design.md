# TalkToMeBaby Docs Site + Repo Documentation Sweep — Design

**Date:** 2026-06-10
**Status:** Approved
**Decisions made with user:** hand-authored static HTML (no build step) · users + contributors scope · playful/bold visual direction · all repo fixes in scope (README, CHANGELOG/vsix hygiene, extension icon, SECURITY.md + CODE_OF_CONDUCT.md)

## Goal

A static documentation website deployable to Netlify as a plain folder of HTML files, covering both user-facing docs and contributor/architecture docs, plus a sweep of repo documentation gaps surfaced while building it.

## 1. Site architecture

```
site/                      # new top-level folder, Netlify publish dir
  index.html               # landing page
  getting-started.html     # install (VSIX + build from source), quick start
  reader.html              # reader panel guide: playback, click-to-jump, speed,
                           #   auto-scroll, settings panel, editor sync
  providers.html           # comparison table, per-provider setup incl. API keys,
                           #   honest fragility notes (Edge TTS unofficial endpoint)
  reference.html           # settings, commands, keybindings tables
  troubleshooting.html
  privacy.html             # SecretStorage / API key story per-OS
  architecture.html        # source layout, key invariants, adding a provider
  roadmap.html             # Piper / offline OS-agnostic engine story
  changelog.html
  404.html
  assets/
    style.css              # single shared stylesheet
    icon.svg               # logo mark (also favicon)
    og.png                 # social card
netlify.toml               # repo root: publish = "site", security headers,
                           # pretty-url redirects (/getting-started -> .html)
```

Constraints:

- **Zero build step, zero frameworks.** Plain HTML + one shared CSS file. A small
  vanilla `site/assets/site.js` is permitted ONLY for a mobile nav toggle; nothing else.
- Header nav + footer are duplicated into every page (acceptable at 11 files; the
  trade-off of no build step). **Nav changes require touching all pages** — note this
  in a comment at the top of each HTML file.
- No external requests except Google Fonts. No analytics, no trackers.
- Deploy story: user drags `site/` into Netlify or wires the repo with `netlify.toml`.
  No Netlify account work is in scope.

## 2. Visual direction (playful/bold)

The product's signature visual is karaoke word highlighting; the site uses it as its identity:

- **Self-demoing hero:** the landing headline animates a pure-CSS word-sweep — words
  highlight one by one as if read aloud. The product demo IS the hero; no screenshot
  required for launch.
- Bold display type (a chunky Google Fonts variable font), vivid accent — hot
  coral/amber highlight band on near-black, echoing a highlighter pen on text.
- Playful microcopy that owns the name ("Talk to me, baby.") in the chrome —
  headers, footer, 404. Docs body content stays information-dense and scannable.
- Dark base palette so the site feels native next to VS Code.
- Accessible: respects `prefers-reduced-motion` (hero animation disabled), WCAG AA
  contrast for body text, semantic HTML, keyboard-navigable nav.

## 3. Content sourcing rule

Every page is written FROM the existing verified docs — `README.md`,
`docs/provider-architecture.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `PUBLISHING.md`,
`CLAUDE.md` (source layout/invariants) — never invented. Specifically:

- The providers page preserves the honest fragility framing (Edge TTS uses an
  unofficial Microsoft endpoint; no SLA; has broken before).
- The privacy page reflects the SecretStorage table (Keychain / Credential Manager /
  libsecret) accurately.
- The reference page tables must match `package.json` `contributes` exactly
  (commands, settings keys, defaults, keybindings).
- Version references say 0.3.0 and install instructions match the README's
  post-fix state (no stale branch checkout).

## 4. Repo fixes (separate commits from the site)

1. **README.md** — remove stale `git checkout speakittome-rebuild` from build-from-source;
   add docs-site link near the top; link SECURITY.md / CODE_OF_CONDUCT.md.
2. **CHANGELOG.md** — date the 0.3.0 entry `2026-06-10` (per git history).
3. **vsix hygiene** — add `*.vsix` to `.gitignore`; `git rm --cached talktomebaby-0.3.0.vsix`;
   add a note in PUBLISHING.md that built VSIXs ship as GitHub Release assets, not commits.
4. **Extension icon** — design an SVG mark (speech-bubble/highlighter motif consistent
   with the site identity), rasterize to 256×256 `icon.png` at repo root, add
   `"icon": "icon.png"` to `package.json`, ensure `.vscodeignore` does not exclude it.
   The same mark is the site logo and favicon.
5. **SECURITY.md** — report via GitHub private security advisories; scope notes on
   API-key handling (SecretStorage) and the unofficial Edge endpoint.
6. **CODE_OF_CONDUCT.md** — Contributor Covenant 2.1, contact = repo owner via GitHub.

LICENSE stays as-is (MIT, 2026).

## 5. Execution model

Planning and final review by the lead session; writing delegated to subagents:

1. One agent builds the **design system + landing page** (establishes `style.css`
   and the shared page template).
2. Parallel agents write the **content pages** using the approved template +
   source material excerpts.
3. Separate agents handle the **repo fixes** and the **icon**.
4. Lead verifies: every page's claims checked against source docs, all internal
   links resolve, HTML validity spot-check, local preview (`python3 -m http.server`)
   screenshot review, `prefers-reduced-motion` honored.

## Acceptance criteria

- `site/` deploys to Netlify as-is and every nav link resolves on the deployed
  pretty URLs and locally on `.html` URLs.
- No factual claim on the site lacks a source in the repo docs/package.json.
- README has no stale instructions; CHANGELOG dated; no `.vsix` tracked;
  `package.json` has a valid icon; SECURITY.md and CODE_OF_CONDUCT.md exist.
- `npm test` and `npm run compile` still pass (icon/package.json change is inert).
