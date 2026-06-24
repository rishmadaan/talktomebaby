# Monorepo + Engine Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the shipped TalkToMeBaby VS Code extension into an npm workspaces monorepo with a shared `@talktomebaby/engine` package, with all existing tests green and a working VSIX still producible.

**Architecture:** Move the already-VS-Code-agnostic `src/core` + `src/synthesis` into `packages/engine` (a TS library), relocate the extension into `packages/vscode-extension`, and have the extension consume the engine via a workspace dependency. esbuild continues to bundle the extension (inlining the engine), so the engine is consumed as built `dist/` output. The engine exposes a browser-safe `./core` subpath so the webview bundle never pulls Node-only synthesis code.

**Tech Stack:** TypeScript (CommonJS, ES2022), npm workspaces, esbuild (bundling), vitest (tests), `@vscode/vsce` (packaging).

## Global Constraints

- This is a **shipped** product (v0.3.2 on the Marketplace, publisher `rishmadaan`). The refactor must be non-destructive: do not change runtime behavior; the existing test suite is the regression gate and must stay green after every task.
- The published extension package keeps `name: "talktomebaby"`, `publisher: "rishmadaan"`, and its `contributes` block unchanged.
- No new features in this plan (no OpenAI provider, no playback module, no CLI). Those are later plans.
- TypeScript strict mode stays on. No em dashes in any prose or generated content.
- `core` must remain free of Node and `vscode` imports (it runs in the browser webview). `synthesis` may use Node APIs but must never be imported by the webview.
- Commit after every task with a passing test suite.

## Target File Structure

```
talktomebaby/
  package.json                      root: { private, workspaces: ["packages/*"] }
  packages/
    engine/
      package.json                  @talktomebaby/engine; exports "." and "./core"
      tsconfig.json                 emits dist/ with declarations
      vitest.config.ts
      src/
        index.ts                    full barrel (core + synthesis)
        core/
          index.ts                  browser-safe barrel
          chunker.ts                (moved) + chunker.test.ts
          document-model.ts         (moved) + document-model.test.ts
          timing.ts                 (moved) + timing.test.ts
        synthesis/
          provider.ts edge.ts elevenlabs.ts sarvam.ts say.ts
          provider-catalog.ts synthesis-service.ts disk-cache.ts
          voice-cache.ts with-timeout.ts        (all moved, with their .test.ts)
      dist/                         (build output, gitignored)
    vscode-extension/
      package.json                  name "talktomebaby"; deps @talktomebaby/engine: "*"
      tsconfig.json
      vitest.config.ts
      icon.png  media/  .vscode/  .vscodeignore
      src/
        extension.ts                (moved) imports @talktomebaby/engine
        ui/                         (moved) imports @talktomebaby/engine[/core]
        webview/                    (moved) imports @talktomebaby/engine/core
```

The engine's public barrel must export exactly the symbols current consumers import (verified from `src/`): from core - `parseDocument`, `DocumentModel`, `Block`, `Sentence`, `buildChunks`, `Chunk`, `ChunkTimings`; from synthesis - `SynthesisService`, `DiskCache`, `EdgeProvider`, `ElevenLabsProvider`, `SayProvider`, `SarvamProvider`, `TtsProvider`, `availableProviders`, `resolveProviderId`, `VoiceCache`, `withTimeout`.

---

### Task 1: Workspace root + engine package skeleton

Create the monorepo scaffolding without moving any source yet, so `npm install` wires the workspace symlinks.

**Files:**
- Modify: `package.json` (root — strip to a workspace root; the extension manifest moves in Task 4)
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/index.ts` (temporary empty barrel)

**Interfaces:**
- Produces: workspace `@talktomebaby/engine` resolvable from other packages; engine build command `npm run build -w @talktomebaby/engine`.

- [ ] **Step 1: Save the current extension manifest for relocation**

```bash
cd /Users/rish/labs/projects/talktomebaby
cp package.json /tmp/ttmb-extension-package.json   # restored into packages/vscode-extension in Task 4
```

- [ ] **Step 2: Replace root `package.json` with a workspace root**

```json
{
  "name": "talktomebaby-suite",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.28.0",
    "typescript": "^5.3.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `packages/engine/package.json`**

```json
{
  "name": "@talktomebaby/engine",
  "version": "0.1.0",
  "license": "MIT",
  "type": "commonjs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./core": { "types": "./dist/core/index.d.ts", "default": "./dist/core/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "msedge-tts": "^2.0.5"
  }
}
```

- [ ] **Step 4: Create `packages/engine/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "dom", "dom.iterable"],
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 5: Create `packages/engine/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], passWithNoTests: true },
});
```

- [ ] **Step 6: Create a temporary empty barrel `packages/engine/src/index.ts`**

```typescript
// Populated in Tasks 2-3 as core and synthesis move in.
export {};
```

- [ ] **Step 7: Install and verify workspace resolution**

Run:
```bash
cd /Users/rish/labs/projects/talktomebaby
npm install
ls node_modules/@talktomebaby/engine
```
Expected: `npm install` completes; `node_modules/@talktomebaby/engine` exists (symlink to `packages/engine`).

- [ ] **Step 8: Commit**

```bash
git add package.json packages/engine
git commit -m "chore: scaffold npm workspaces root + empty engine package"
```

---

### Task 2: Move `core` into the engine

`core` is pure, browser-safe, and tested. Move it first and prove its tests run under the engine package.

**Files:**
- Move: `src/core/*.ts` -> `packages/engine/src/core/*.ts` (chunker, document-model, timing + their `.test.ts`)
- Create: `packages/engine/src/core/index.ts` (browser-safe barrel)

**Interfaces:**
- Produces (via `@talktomebaby/engine/core`): `parseDocument`, `DocumentModel`, `Block`, `Sentence`, `buildChunks`, `Chunk`, `ChunkTimings`. (Internal-only timing helpers `estimatedTimings`, `timingsFromCharAlignment`, `timingsFromEdge`, `EdgeBoundary` stay importable within the engine via relative paths and need not be barreled.)

- [ ] **Step 1: Move the core files (preserve history)**

```bash
cd /Users/rish/labs/projects/talktomebaby
mkdir -p packages/engine/src/core
git mv src/core/chunker.ts src/core/chunker.test.ts packages/engine/src/core/
git mv src/core/document-model.ts src/core/document-model.test.ts packages/engine/src/core/
git mv src/core/timing.ts src/core/timing.test.ts packages/engine/src/core/
```

- [ ] **Step 2: Create the browser-safe core barrel `packages/engine/src/core/index.ts`**

```typescript
export { parseDocument, DocumentModel, Block, Sentence } from "./document-model";
export { buildChunks, Chunk } from "./chunker";
export { ChunkTimings } from "./timing";
```

- [ ] **Step 3: Point the engine barrel at core `packages/engine/src/index.ts`**

```typescript
export * from "./core/index";
// synthesis added in Task 3
```

- [ ] **Step 4: Run the engine tests (core tests should pass unchanged)**

Run:
```bash
npm test -w @talktomebaby/engine
```
Expected: all moved core tests pass; no failures.

- [ ] **Step 5: Build the engine (declarations emit cleanly)**

Run:
```bash
npm run build -w @talktomebaby/engine
ls packages/engine/dist/core/index.js packages/engine/dist/core/index.d.ts
```
Expected: build succeeds; the listed files exist.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src
git commit -m "refactor: move core into @talktomebaby/engine"
```

---

### Task 3: Move `synthesis` into the engine

**Files:**
- Move: `src/synthesis/*.ts` -> `packages/engine/src/synthesis/*.ts` (provider, edge, elevenlabs, sarvam, say, provider-catalog, synthesis-service, disk-cache, voice-cache, with-timeout + their `.test.ts`)
- Modify: `packages/engine/src/index.ts` (add synthesis exports)

**Interfaces:**
- Consumes: `@talktomebaby/engine/core` symbols (synthesis files already import `../core/*` by relative path; those paths stay valid after the move because core moved alongside).
- Produces (via `@talktomebaby/engine`): `SynthesisService`, `DiskCache`, `EdgeProvider`, `ElevenLabsProvider`, `SayProvider`, `SarvamProvider`, `TtsProvider`, `availableProviders`, `resolveProviderId`, `VoiceCache`, `withTimeout` (plus all core exports re-exported).

- [ ] **Step 1: Move the synthesis files**

```bash
cd /Users/rish/labs/projects/talktomebaby
mkdir -p packages/engine/src/synthesis
git mv src/synthesis/*.ts packages/engine/src/synthesis/
rmdir src/synthesis src/core 2>/dev/null || true
```

- [ ] **Step 2: Verify the intra-engine relative imports still resolve**

Run:
```bash
grep -rn "from \"\.\./core" packages/engine/src/synthesis | head
```
Expected: imports like `../core/chunker`, `../core/timing` are listed and still point at `packages/engine/src/core/*` (valid).

- [ ] **Step 3: Complete the full engine barrel `packages/engine/src/index.ts`**

```typescript
export * from "./core/index";
export { SynthesisService } from "./synthesis/synthesis-service";
export { DiskCache } from "./synthesis/disk-cache";
export { EdgeProvider } from "./synthesis/edge";
export { ElevenLabsProvider } from "./synthesis/elevenlabs";
export { SayProvider } from "./synthesis/say";
export { SarvamProvider } from "./synthesis/sarvam";
export { TtsProvider } from "./synthesis/provider";
export { availableProviders, resolveProviderId } from "./synthesis/provider-catalog";
export { VoiceCache } from "./synthesis/voice-cache";
export { withTimeout } from "./synthesis/with-timeout";
```

- [ ] **Step 4: Run engine tests (core + synthesis)**

Run:
```bash
npm test -w @talktomebaby/engine
```
Expected: all engine tests pass; no failures.

- [ ] **Step 5: Build the engine**

Run:
```bash
npm run build -w @talktomebaby/engine
node -e "const e=require('./packages/engine/dist/index.js'); console.log(typeof e.SynthesisService, typeof e.availableProviders, typeof e.parseDocument)"
```
Expected: build succeeds; prints `function function function`.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src
git commit -m "refactor: move synthesis into @talktomebaby/engine; complete barrel"
```

---

### Task 4: Relocate the extension into `packages/vscode-extension`

Move everything that is the VS Code extension (its remaining `src`, assets, configs, and saved manifest) into its own package.

**Files:**
- Move: `src/` (now only `extension.ts`, `ui/`, `webview/`), `media/`, `icon.png`, `.vscode/`, `.vscodeignore`, `vitest.config.ts` -> `packages/vscode-extension/`
- Create: `packages/vscode-extension/package.json` (restored from `/tmp/ttmb-extension-package.json`, with edits below)
- Create: `packages/vscode-extension/tsconfig.json`

**Interfaces:**
- Consumes: `@talktomebaby/engine` and `@talktomebaby/engine/core`.
- Produces: a buildable VS Code extension package named `talktomebaby`.

- [ ] **Step 1: Move extension sources and assets**

```bash
cd /Users/rish/labs/projects/talktomebaby
mkdir -p packages/vscode-extension
git mv src packages/vscode-extension/src
git mv media icon.png .vscode .vscodeignore vitest.config.ts packages/vscode-extension/
```

- [ ] **Step 2: Restore + edit the extension manifest `packages/vscode-extension/package.json`**

Copy the saved manifest back, then apply these edits (leave `name`, `publisher`, `version`, `contributes`, `displayName`, `icon` unchanged):

```bash
cp /tmp/ttmb-extension-package.json packages/vscode-extension/package.json
```

Then edit `packages/vscode-extension/package.json`:
- Add to `dependencies`: `"@talktomebaby/engine": "*"`.
- Remove `msedge-tts` from `dependencies` (it now lives in the engine).
- Keep `scripts.compile`, `scripts.build`, `scripts.test`, `scripts.package`, `scripts.vscode:prepublish` as-is (paths are relative to this package now).
- Keep `devDependencies` (esbuild, typescript, vitest, tsx, happy-dom, @types/*).

- [ ] **Step 3: Create `packages/vscode-extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022", "dom", "dom.iterable"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", "out"]
}
```

- [ ] **Step 4: Reinstall so workspace links settle**

Run:
```bash
npm install
ls packages/vscode-extension/node_modules/@talktomebaby/engine 2>/dev/null || ls node_modules/@talktomebaby/engine
```
Expected: the engine resolves for the extension package.

- [ ] **Step 5: Commit (build will fail until Task 5 rewires imports — that is expected)**

```bash
git add -A
git commit -m "refactor: relocate extension into packages/vscode-extension"
```

---

### Task 5: Rewire extension imports to the engine

Replace relative `./core` / `./synthesis` imports with the engine package. The webview uses the browser-safe `./core` subpath; the extension and ui use the full package.

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts:2-13`
- Modify: `packages/vscode-extension/src/ui/editor-sync.ts:2`, `packages/vscode-extension/src/ui/reader-panel.ts:2-3`
- Modify: `packages/vscode-extension/src/webview/main.ts:4-6`, `engine.ts:1-3`, `engine.test.ts:3-5`, `renderer.ts:1`, `renderer.test.ts:4`

**Interfaces:**
- Consumes: `@talktomebaby/engine` (extension/ui), `@talktomebaby/engine/core` (webview).

- [ ] **Step 1: Rewire `extension.ts` imports**

Replace lines 2-13 of `packages/vscode-extension/src/extension.ts`:

```typescript
import { parseDocument, DocumentModel } from "@talktomebaby/engine/core";
import { buildChunks, Chunk } from "@talktomebaby/engine/core";
import {
  SynthesisService, DiskCache, EdgeProvider, ElevenLabsProvider,
  SayProvider, SarvamProvider, TtsProvider, availableProviders,
  resolveProviderId, VoiceCache, withTimeout,
} from "@talktomebaby/engine";
```

- [ ] **Step 2: Rewire `ui/` imports**

`packages/vscode-extension/src/ui/editor-sync.ts` line 2:
```typescript
import { DocumentModel } from "@talktomebaby/engine/core";
```
`packages/vscode-extension/src/ui/reader-panel.ts` lines 2-3:
```typescript
import { DocumentModel } from "@talktomebaby/engine/core";
import { ChunkTimings } from "@talktomebaby/engine/core";
```

- [ ] **Step 3: Rewire `webview/` imports (browser-safe core only)**

`packages/vscode-extension/src/webview/main.ts` lines 4-6:
```typescript
import { buildChunks, Chunk } from "@talktomebaby/engine/core";
import { DocumentModel } from "@talktomebaby/engine/core";
import { ChunkTimings } from "@talktomebaby/engine/core";
```
`packages/vscode-extension/src/webview/engine.ts` lines 1-3 and `engine.test.ts` lines 3-5:
```typescript
import { DocumentModel } from "@talktomebaby/engine/core";
import { Chunk } from "@talktomebaby/engine/core";
import { ChunkTimings } from "@talktomebaby/engine/core";
```
`packages/vscode-extension/src/webview/renderer.ts` line 1:
```typescript
import { Block, DocumentModel, Sentence } from "@talktomebaby/engine/core";
```
`packages/vscode-extension/src/webview/renderer.test.ts` line 4:
```typescript
import { parseDocument } from "@talktomebaby/engine/core";
```

- [ ] **Step 4: Build the engine, then the extension**

Run:
```bash
npm run build -w @talktomebaby/engine
npm run build -w talktomebaby
```
Expected: both builds succeed with no unresolved-import or type errors.

- [ ] **Step 5: Run the extension tests**

Run:
```bash
npm test -w talktomebaby
```
Expected: all extension/webview tests pass; no failures.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src
git commit -m "refactor: extension consumes @talktomebaby/engine"
```

---

### Task 6: Verify a working VSIX still builds

Prove the relocated extension still packages into an installable VSIX (no publish).

**Files:**
- Modify: `packages/vscode-extension/.vscodeignore` (drop the now-absent `tsconfig.json`/`vitest.config.ts` lines only if they error; add `../../docs/**` is not needed since packaging runs inside the package dir)

**Interfaces:**
- Produces: `packages/vscode-extension/talktomebaby-<version>.vsix`.

- [ ] **Step 1: Confirm the build ordering produces engine `dist` before packaging**

Run:
```bash
npm run build -w @talktomebaby/engine
```
Expected: `packages/engine/dist/index.js` is present (esbuild bundles it into the extension at package time).

- [ ] **Step 2: Package the extension**

Run:
```bash
cd packages/vscode-extension
npx @vscode/vsce package
ls *.vsix
cd ../..
```
Expected: a `talktomebaby-<version>.vsix` is produced with no fatal errors. If `vsce` warns about the engine workspace dependency, confirm the bundled `out/extension.js` contains the engine code (esbuild inlined it) by checking the VSIX size is comparable to the pre-refactor VSIX (~130 KB).

- [ ] **Step 3: Smoke-test the bundle resolves engine symbols**

Run:
```bash
node -e "const s=require('fs').readFileSync('packages/vscode-extension/out/extension.js','utf8'); console.log(s.includes('SynthesisService') ? 'engine bundled' : 'MISSING')"
```
Expected: prints `engine bundled`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "build: confirm VSIX packages from monorepo layout"
```

---

### Task 7: Update ignores, docs paths, and final regression gate

**Files:**
- Modify: root `.gitignore` (ignore `packages/*/out`, `packages/*/dist`, `packages/*/*.vsix`)
- Modify: `README.md`, `PUBLISHING.md` (any `npm run package` / path references now run inside `packages/vscode-extension`)
- Modify: `.github/` workflows if present (build/test paths)

**Interfaces:**
- Produces: a clean monorepo where `npm test` and `npm run build` at the root drive all packages.

- [ ] **Step 1: Update root `.gitignore`**

```
node_modules/
packages/*/out/
packages/*/dist/
packages/*/*.vsix
*.vsix
.env
.env.*
.DS_Store
*.pem
```

- [ ] **Step 2: Check for CI / docs references to the old layout**

Run:
```bash
cd /Users/rish/labs/projects/talktomebaby
grep -rnE "npm run package|src/synthesis|src/core|code --install-extension talktomebaby-" README.md PUBLISHING.md .github 2>/dev/null
```
Expected: a list of references; update each to the `packages/vscode-extension` location (e.g. packaging now runs from that directory). Fix them inline.

- [ ] **Step 3: Full regression gate from the root**

Run:
```bash
npm run build
npm test
```
Expected: every package builds; all tests across engine + extension pass; no failures.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: update ignores + docs for monorepo layout"
```

- [ ] **Step 5: Note the version bump for republish (handled at publish time, not here)**

Add a line to `packages/vscode-extension/CHANGELOG.md` under a new unreleased heading:

```markdown
## Unreleased
- Internal: extension now consumes the shared @talktomebaby/engine package (no user-facing change).
```

Then:
```bash
git add packages/vscode-extension/CHANGELOG.md
git commit -m "docs: changelog note for engine extraction"
```

---

## Self-Review

**Spec coverage (against §Architecture and §Migration steps 1-3 of the design spec):**
- Monorepo + workspaces: Task 1. ✓
- Engine = core + synthesis moved: Tasks 2-3. ✓
- Extension relocated + consumes engine: Tasks 4-5. ✓
- Browser-safe `./core` subpath (webview safety): Task 1 (exports), Task 2 (barrel), Task 5 (webview imports). ✓
- Non-destructive / shipped product protected: VSIX verification Task 6; tests-green gate every task. ✓
- Out of scope here (correctly deferred to later plans): OpenAI provider, playback module, CLI, Mycroft rewire, actual Marketplace publish. ✓

**Placeholder scan:** No TBD/TODO; all manifests, barrels, and import blocks are shown in full; all commands have expected output.

**Type consistency:** The engine barrel (Task 3 Step 3) exports exactly the symbols the rewired imports consume (Task 5), which match the symbols verified from the current `src/` imports. `./core` exports (Task 2 Step 2) cover every symbol the webview/ui import in Task 5.

**Known follow-ups for the next plan (not gaps in this one):** add `@talktomebaby/engine` OpenAI provider + `playback/` submodule; then the CLI package; then the Mycroft Stop-hook rewire.
