# SpeakItToMe Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild read-vscode-tts as SpeakItToMe: a Speechify-parity VS Code extension with continuous TTS, word-level karaoke highlighting, click-to-jump, and pitch-preserved speed.

**Architecture:** Extension host owns the document model (blocks→sentences→words with source offsets), chunked synthesis with word timings, and a disk cache. A reader webview panel renders FROM the model and owns all playback state via a dual-`<audio>` handoff engine. Spec: `docs/superpowers/specs/2026-06-10-speakittome-rebuild-design.md`.

**Tech Stack:** TypeScript, esbuild (two bundles: Node extension + IIFE webview), vitest + happy-dom for tests, `msedge-tts` (default provider), ElevenLabs `/with-timestamps`, macOS `say`, Sarvam.

**Working directory for ALL commands:** `/Users/rish/labs/projects/read-vscode-tts`

---

## File Structure

```
package.json                      # MODIFY: rename to speakittome, new contributions, scripts
vitest.config.ts                  # CREATE
scripts/smoke-edge.ts             # CREATE: manual Edge TTS smoke test
src/
├── extension.ts                  # REWRITE: activation, commands, ReadingSession
├── core/
│   ├── document-model.ts         # CREATE: types + parser (vscode-free, offset-based)
│   ├── document-model.test.ts
│   ├── chunker.ts                # CREATE
│   ├── chunker.test.ts
│   ├── timing.ts                 # CREATE: edge/char alignment + estimation
│   └── timing.test.ts
├── synthesis/
│   ├── provider.ts               # CREATE: TtsProvider interface + shared types
│   ├── edge.ts                   # CREATE
│   ├── elevenlabs.ts             # CREATE
│   ├── say.ts                    # CREATE (darwin only) + wav-duration
│   ├── say.test.ts
│   ├── sarvam.ts                 # CREATE (port of v1)
│   ├── synthesis-service.ts      # CREATE: priority queue + in-flight dedupe
│   ├── synthesis-service.test.ts
│   ├── disk-cache.ts             # CREATE
│   └── disk-cache.test.ts
├── ui/
│   ├── reader-panel.ts           # CREATE: WebviewPanel host + message protocol
│   ├── editor-sync.ts            # CREATE: decorations, Alt+click, follow
│   ├── status-bar.ts             # CREATE
│   └── api-key-manager.ts        # CREATE: slim SecretStorage wrapper
└── webview/
    ├── main.ts                   # CREATE: entry, message wiring
    ├── engine.ts                 # CREATE: dual-audio engine (DOM-free, injectable)
    ├── engine.test.ts
    ├── renderer.ts               # CREATE: model → DOM
    ├── renderer.test.ts
    ├── highlight.ts              # CREATE: classes + auto-scroll/follow
    └── player-bar.ts             # CREATE
media/reader.css                  # CREATE (plain source, not built)
DELETE: src/managers/, src/providers/, src/utils/, src/webview/webview-provider.ts,
        src/webview/media/, media/playback.js, media/playback.css, read-vscode-tts-0.1.0.vsix
KEEP AS REFERENCE until Task 2 ports it: src/utils/text-parser.ts
```

**Type vocabulary (used consistently in every task):**

```typescript
// core/document-model.ts
interface Offsets { start: number; end: number }            // absolute char offsets in source text
type BlockKind = "heading" | "paragraph" | "list-item" | "quote" | "code";
interface Word { index: number; text: string; source: Offsets }       // index = flat, document-wide
interface Sentence { index: number; text: string; words: Word[]; source: Offsets }
interface Block { kind: BlockKind; level?: number; sentences: Sentence[]; source: Offsets; codeText?: string }
interface DocumentModel { uri: string; version: number; blocks: Block[]; sentences: Sentence[]; words: Word[] }

// core/chunker.ts
interface ChunkWordRef { wordIndex: number; charStart: number; charEnd: number }  // offsets into chunk.text
interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }

// core/timing.ts
interface WordTiming { wordIndex: number; start: number; end: number }
interface ChunkTimings { unit: "ms" | "fraction"; words: WordTiming[] }   // fraction = 0..1 of audio duration

// synthesis/provider.ts
interface VoiceInfo { id: string; label: string }
interface ChunkAudio { audio: Uint8Array; format: "mp3" | "wav"; timings: ChunkTimings }
interface TtsProvider {
  id: string; label: string; requiresKey: boolean;
  timingQuality: "exact" | "estimated"; maxCharsPerRequest: number; defaultVoice: string;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio>;
}
```

**Message protocol (extension ⇄ webview), defined once in `src/ui/reader-panel.ts` and imported by `src/webview/main.ts`:**

```typescript
// Extension → webview
type HostMsg =
  | { type: "init"; model: DocumentModel; chunkCount: number; settings: ReaderSettings }
  | { type: "chunkAudio"; chunkIndex: number; audio: Uint8Array; format: "mp3" | "wav"; timings: ChunkTimings }
  | { type: "chunkFailed"; chunkIndex: number; error: string }
  | { type: "control"; action: "pause" | "resume" | "stop" }
  | { type: "seekToWord"; wordIndex: number };
// Webview → extension
type ViewMsg =
  | { type: "ready" }
  | { type: "requestChunk"; chunkIndex: number; priority: boolean }
  | { type: "position"; wordIndex: number; sentenceIndex: number }
  | { type: "state"; state: "playing" | "paused" | "ended" }
  | { type: "speedChanged"; rate: number }
  | { type: "error"; message: string };
interface ReaderSettings { speed: number; fontSize: number; sentenceColor: string; wordColor: string }
```

---

### Task 1: Clean slate — rename, scaffolding, green build

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Rewrite: `src/extension.ts` (compiling stub)
- Delete: dead v1 files (listed below)

- [ ] **Step 1: Replace package.json**

Replace the entire file with:

```json
{
  "name": "speakittome",
  "displayName": "SpeakItToMe",
  "description": "Listen to your docs. Speechify-style reading for VS Code: word-level highlighting, click-to-jump, 2x speed without pitch shift.",
  "version": "0.2.0",
  "publisher": "rish",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/rishmadaan/read-vscode-tts" },
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "keywords": ["tts", "text-to-speech", "read-aloud", "speechify", "highlight"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "speakittome.readDocument", "title": "SpeakItToMe: Read Document", "icon": "$(unmute)" },
      { "command": "speakittome.readSelection", "title": "SpeakItToMe: Read Selection" },
      { "command": "speakittome.readFromCursor", "title": "SpeakItToMe: Read from Here" },
      { "command": "speakittome.pauseResume", "title": "SpeakItToMe: Pause/Resume" },
      { "command": "speakittome.stop", "title": "SpeakItToMe: Stop" },
      { "command": "speakittome.openReader", "title": "SpeakItToMe: Open Reader" },
      { "command": "speakittome.setApiKey", "title": "SpeakItToMe: Set API Key" },
      { "command": "speakittome.selectProvider", "title": "SpeakItToMe: Select TTS Provider" },
      { "command": "speakittome.selectVoice", "title": "SpeakItToMe: Select Voice" }
    ],
    "menus": {
      "editor/title": [
        { "command": "speakittome.readDocument", "when": "resourceExtname =~ /\\.(md|mdx|txt|rst|org|tex|adoc)$/", "group": "navigation" }
      ],
      "editor/context": [
        { "command": "speakittome.readFromCursor", "when": "resourceExtname =~ /\\.(md|mdx|txt|rst|org|tex|adoc)$/", "group": "navigation" },
        { "command": "speakittome.readSelection", "when": "editorHasSelection && resourceExtname =~ /\\.(md|mdx|txt|rst|org|tex|adoc)$/", "group": "navigation" }
      ]
    },
    "keybindings": [
      { "command": "speakittome.pauseResume", "key": "ctrl+shift+r", "mac": "cmd+shift+r" }
    ],
    "configuration": {
      "type": "object",
      "title": "SpeakItToMe",
      "properties": {
        "speakittome.provider": {
          "type": "string", "default": "edge",
          "enum": ["edge", "elevenlabs", "say", "sarvam"],
          "enumDescriptions": [
            "Edge TTS (free, no key, word-level timing)",
            "ElevenLabs (premium voices, word-level timing, requires key)",
            "macOS say (offline, estimated timing, macOS only)",
            "Sarvam AI (Indian English, estimated timing, requires key)"
          ],
          "description": "TTS provider"
        },
        "speakittome.voice.edge": { "type": "string", "default": "en-US-AriaNeural" },
        "speakittome.voice.elevenlabs": { "type": "string", "default": "21m00Tcm4TlvDq8ikWAM" },
        "speakittome.voice.say": { "type": "string", "default": "Samantha" },
        "speakittome.voice.sarvam": { "type": "string", "default": "shubh" },
        "speakittome.speed": { "type": "number", "default": 1.0, "minimum": 0.5, "maximum": 2.0, "description": "Playback speed (pitch preserved). Persisted from the player." },
        "speakittome.editorClickToJump": { "type": "boolean", "default": true, "description": "Alt+click in the source editor jumps playback there during a session." },
        "speakittome.readerFontSize": { "type": "number", "default": 16 },
        "speakittome.highlight.sentenceColor": { "type": "string", "default": "", "description": "Sentence band color. Empty = theme default." },
        "speakittome.highlight.wordColor": { "type": "string", "default": "", "description": "Current word color. Empty = theme default." },
        "speakittome.cacheSizeMB": { "type": "number", "default": 200 }
      }
    }
  },
  "scripts": {
    "compile": "npm run compile:ext && npm run compile:webview",
    "compile:ext": "esbuild src/extension.ts --bundle --outfile=out/extension.js --external:vscode --format=cjs --platform=node --sourcemap",
    "compile:webview": "esbuild src/webview/main.ts --bundle --outfile=media/reader.js --format=iife --sourcemap",
    "watch": "npm run compile:ext -- --watch & npm run compile:webview -- --watch",
    "build": "npm run compile:ext -- --minify && npm run compile:webview -- --minify",
    "test": "vitest run",
    "vscode:prepublish": "npm run build",
    "package": "npx @vscode/vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0",
    "vitest": "^3.0.0",
    "happy-dom": "^15.0.0",
    "tsx": "^4.0.0"
  },
  "dependencies": {
    "msedge-tts": "^1.3.0"
  }
}
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Delete dead v1 files, replace extension.ts with a compiling stub**

```bash
git rm -r src/managers src/providers src/webview/media src/webview/webview-provider.ts media/playback.js media/playback.css
git rm read-vscode-tts-0.1.0.vsix
```

Keep `src/utils/text-parser.ts` for now (Task 2 ports it, then deletes it).

Replace `src/extension.ts` entirely with:

```typescript
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("SpeakItToMe", { log: true });
  context.subscriptions.push(log);
  const todo = (name: string) => () =>
    vscode.window.showInformationMessage(`SpeakItToMe: ${name} not implemented yet`);
  for (const cmd of [
    "readDocument", "readSelection", "readFromCursor", "pauseResume",
    "stop", "openReader", "setApiKey", "selectProvider", "selectVoice",
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`speakittome.${cmd}`, todo(cmd))
    );
  }
  log.info("SpeakItToMe activated (scaffold)");
}

export function deactivate() {}
```

Create `src/webview/main.ts` as a stub so compile:webview succeeds:

```typescript
export {};
```

- [ ] **Step 4: Install and verify green build**

Run: `npm install && npm run compile && npm test`
Expected: install succeeds, both esbuild bundles build, vitest reports "No test files found" exit 0 (vitest run exits 0 with `--passWithNoTests`; if it exits 1, add `passWithNoTests: true` to vitest.config.ts test block).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: rename to speakittome, clean slate scaffold with green build"
```

(`git add -A` is acceptable here only because this repo is the extension itself, not the Foundry.)

---

### Task 2: Document model — types, cleaner port, blocks and sentences

The parser must be vscode-free (plain char offsets) so it runs under vitest. Port the cleaning logic from `src/utils/text-parser.ts`; replace `vscode.Range` with `Offsets`.

**Files:**
- Create: `src/core/document-model.ts`
- Test: `src/core/document-model.test.ts`
- Reference: `src/utils/text-parser.ts` (port, then `git rm` in Task 3)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { parseDocument } from "./document-model";

const md = [
  "---",
  "title: test",
  "---",
  "# Heading One",
  "",
  "First sentence here. Second sentence, with [a link](https://x.com) inside!",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "- item one is short.",
  "> quoted wisdom.",
].join("\n");

describe("parseDocument", () => {
  it("skips frontmatter and code blocks, classifies blocks", () => {
    const m = parseDocument(md, "test.md", 1);
    const kinds = m.blocks.map((b) => b.kind);
    expect(kinds).toEqual(["heading", "paragraph", "code", "list-item", "quote"]);
    expect(m.blocks[2].sentences).toHaveLength(0); // code not read
  });

  it("splits sentences and strips markdown from text", () => {
    const m = parseDocument(md, "test.md", 1);
    const para = m.blocks[1];
    expect(para.sentences.map((s) => s.text)).toEqual([
      "First sentence here.",
      "Second sentence, with a link inside!",
    ]);
  });

  it("maps sentence offsets back to source text", () => {
    const m = parseDocument(md, "test.md", 1);
    const s0 = m.blocks[1].sentences[0];
    expect(md.slice(s0.source.start, s0.source.end)).toBe("First sentence here.");
  });

  it("keeps abbreviations inside one sentence", () => {
    const m = parseDocument("Dr. Smith arrived. He left.", "t.txt", 1);
    expect(m.sentences.map((s) => s.text)).toEqual(["Dr. Smith arrived.", "He left."]);
  });

  it("builds global flat sentence list with indexes", () => {
    const m = parseDocument(md, "test.md", 1);
    expect(m.sentences.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run src/core/document-model.test.ts`
Expected: FAIL — cannot resolve `./document-model`.

- [ ] **Step 3: Implement document-model.ts**

Port from `src/utils/text-parser.ts` UNCHANGED (they are already vscode-free): `ABBREVIATION_PATTERN`, `DOT_PLACEHOLDER`, `splitIntoSentenceSpans`, `pushTrimmedSpan`, `cleanLineInto`, `getReadableLineStart`, `appendRange`, `appendChar`. Then add the new model layer:

```typescript
export interface Offsets { start: number; end: number }
export type BlockKind = "heading" | "paragraph" | "list-item" | "quote" | "code";
export interface Word { index: number; text: string; source: Offsets }
export interface Sentence { index: number; text: string; words: Word[]; source: Offsets }
export interface Block {
  kind: BlockKind; level?: number; sentences: Sentence[]; source: Offsets; codeText?: string;
}
export interface DocumentModel {
  uri: string; version: number; blocks: Block[]; sentences: Sentence[]; words: Word[];
}

// ... ported cleaning functions from text-parser.ts go here ...

interface CleanText { text: string; offsets: number[] }

function cleanBlockWithOffsets(raw: string, baseOffset: number): CleanText {
  const lines = raw.split("\n");
  const output: string[] = [];
  const offsets: number[] = [];
  let rel = 0;
  for (const line of lines) {
    cleanLineInto(line, baseOffset + rel, output, offsets);
    rel += line.length + 1;
    if (output.length > 0 && !/\s/.test(output[output.length - 1])) {
      output.push(" ");
      offsets.push(baseOffset + rel - 1);
    }
  }
  return { text: output.join(""), offsets };
}

function sentencesFromBlock(raw: string, baseOffset: number): Omit<Sentence, "index" | "words">[] {
  const clean = cleanBlockWithOffsets(raw, baseOffset);
  return splitIntoSentenceSpans(clean.text).flatMap((span) => {
    const start = clean.offsets[span.start];
    const end = clean.offsets[span.end - 1];
    if (start === undefined || end === undefined) return [];
    return [{ text: span.text, source: { start, end: end + 1 } }];
  });
}

interface RawBlock { kind: BlockKind; level?: number; startLine: number; lines: string[] }

function segmentBlocks(lines: string[], firstLine: number): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: RawBlock | undefined;
  const flush = () => { if (current && current.lines.length) blocks.push(current); current = undefined; };

  let inCode = false;
  for (let i = firstLine; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      if (inCode) { inCode = false; current?.lines.push(line); flush(); }
      else { flush(); inCode = true; current = { kind: "code", startLine: i, lines: [line] }; }
      continue;
    }
    if (inCode) { current!.lines.push(line); continue; }
    if (line.trim().length === 0 || /^[-*_]{3,}\s*$/.test(line)) { flush(); continue; }

    const heading = line.match(/^(#{1,6})\s+/);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, startLine: i, lines: [line] });
      continue;
    }
    const isList = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
    const isQuote = /^\s*>/.test(line);
    const kind: BlockKind = isList ? "list-item" : isQuote ? "quote" : "paragraph";
    if (isList) { flush(); current = { kind, startLine: i, lines: [line] }; continue; }
    if (!current || current.kind !== kind) { flush(); current = { kind, startLine: i, lines: [] }; }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

export function parseDocument(text: string, uri: string, version: number): DocumentModel {
  const lines = text.split("\n");
  const lineOffsets: number[] = [];
  let off = 0;
  for (const l of lines) { lineOffsets.push(off); off += l.length + 1; }

  let firstLine = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) firstLine = end + 1;
  }

  const blocks: Block[] = [];
  const sentences: Sentence[] = [];
  const words: Word[] = [];

  for (const raw of segmentBlocks(lines, firstLine)) {
    const base = lineOffsets[raw.startLine];
    const rawText = raw.lines.join("\n");
    const source: Offsets = { start: base, end: base + rawText.length };
    if (raw.kind === "code") {
      blocks.push({ kind: "code", sentences: [], source, codeText: rawText });
      continue;
    }
    const blockSentences: Sentence[] = sentencesFromBlock(rawText, base).map((s) => ({
      ...s, index: sentences.length + 0, words: [],
    }));
    // assign correct sequential indexes
    blockSentences.forEach((s, i) => (s.index = sentences.length + i));
    sentences.push(...blockSentences);
    blocks.push({ kind: raw.kind, level: raw.level, sentences: blockSentences, source });
  }

  return { uri, version, blocks, sentences, words };
}
```

Note: `words` stays empty until Task 3 fills it.

- [ ] **Step 4: Run tests until green**

Run: `npx vitest run src/core/document-model.test.ts`
Expected: PASS (5 tests). Debug offset math against the ported v1 functions if mapping tests fail; the v1 logic is known-good.

- [ ] **Step 5: Commit**

```bash
git add src/core/document-model.ts src/core/document-model.test.ts
git commit -m "feat: vscode-free document model with block/sentence parsing"
```

---

### Task 3: Word spans

**Files:**
- Modify: `src/core/document-model.ts`
- Test: `src/core/document-model.test.ts` (append)
- Delete: `src/utils/text-parser.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe("word spans", () => {
  it("extracts words with flat document-wide indexes", () => {
    const m = parseDocument("One two. Three!", "t.txt", 1);
    expect(m.words.map((w) => w.text)).toEqual(["One", "two.", "Three!"]);
    expect(m.words.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(m.sentences[1].words[0].index).toBe(2);
  });

  it("maps word offsets back to source, including through markdown", () => {
    const src = "Hello **bold** world.";
    const m = parseDocument(src, "t.md", 1);
    const bold = m.words[1];
    expect(bold.text).toBe("bold");
    expect(src.slice(bold.source.start, bold.source.end)).toBe("bold");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/core/document-model.test.ts`
Expected: FAIL — `m.words` is empty.

- [ ] **Step 3: Implement**

In `sentencesFromBlock`, words must come from the same clean-text + offsets arrays. Change it to return word spans too:

```typescript
interface SentenceDraft { text: string; source: Offsets; wordDrafts: { text: string; source: Offsets }[] }

function sentencesFromBlock(raw: string, baseOffset: number): SentenceDraft[] {
  const clean = cleanBlockWithOffsets(raw, baseOffset);
  return splitIntoSentenceSpans(clean.text).flatMap((span) => {
    const start = clean.offsets[span.start];
    const end = clean.offsets[span.end - 1];
    if (start === undefined || end === undefined) return [];
    const wordDrafts: SentenceDraft["wordDrafts"] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    const sentenceClean = clean.text.slice(span.start, span.end);
    while ((m = re.exec(sentenceClean)) !== null) {
      const ws = clean.offsets[span.start + m.index];
      const we = clean.offsets[span.start + m.index + m[0].length - 1];
      if (ws === undefined || we === undefined) continue;
      wordDrafts.push({ text: m[0], source: { start: ws, end: we + 1 } });
    }
    return [{ text: span.text, source: { start, end: end + 1 }, wordDrafts }];
  });
}
```

In `parseDocument`, build `Word` objects with running flat indexes:

```typescript
    const blockSentences: Sentence[] = [];
    for (const d of sentencesFromBlock(rawText, base)) {
      const s: Sentence = { index: sentences.length + blockSentences.length, text: d.text, source: d.source, words: [] };
      for (const wd of d.wordDrafts) {
        const w: Word = { index: words.length, text: wd.text, source: wd.source };
        words.push(w);
        s.words.push(w);
      }
      blockSentences.push(s);
    }
```

(Remove the earlier two-pass index assignment from Task 2; this single pass replaces it.)

- [ ] **Step 4: Run full test file, verify all green**

Run: `npx vitest run src/core/document-model.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Delete v1 parser and commit**

```bash
git rm src/utils/text-parser.ts
git add src/core/document-model.ts src/core/document-model.test.ts
git commit -m "feat: word-level spans with source offsets; retire v1 parser"
```

---

### Task 4: Chunker

**Files:**
- Create: `src/core/chunker.ts`
- Test: `src/core/chunker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { buildChunks } from "./chunker";
import { parseDocument } from "./document-model";

const para = (n: number) => Array(12).fill(`Sentence number ${n} fills space.`).join(" ");
const doc = parseDocument([para(1), "", para(2), "", para(3)].join("\n"), "t.txt", 1);

describe("buildChunks", () => {
  it("never splits a sentence across chunks", () => {
    const chunks = buildChunks(doc, 400, 200);
    const all = chunks.flatMap((c) => c.sentenceIndexes);
    expect(all).toEqual([...Array(doc.sentences.length).keys()]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("chunk text is sentences joined with single spaces", () => {
    const chunks = buildChunks(doc, 400, 200);
    const c = chunks[0];
    expect(c.text).toBe(c.sentenceIndexes.map((i) => doc.sentences[i].text).join(" "));
  });

  it("word refs carry correct char offsets into chunk text", () => {
    const chunks = buildChunks(doc, 400, 200);
    for (const c of chunks) {
      for (const ref of c.words) {
        const w = doc.words[ref.wordIndex];
        expect(c.text.slice(ref.charStart, ref.charEnd)).toBe(w.text);
      }
    }
  });

  it("respects maxChars except for single oversized sentences", () => {
    const chunks = buildChunks(doc, 400, 200);
    for (const c of chunks) {
      if (c.sentenceIndexes.length > 1) expect(c.text.length).toBeLessThanOrEqual(400);
    }
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/core/chunker.test.ts`
Expected: FAIL — cannot resolve `./chunker`.

- [ ] **Step 3: Implement chunker.ts**

```typescript
import { DocumentModel } from "./document-model";

export interface ChunkWordRef { wordIndex: number; charStart: number; charEnd: number }
export interface Chunk { index: number; text: string; sentenceIndexes: number[]; words: ChunkWordRef[] }

export function buildChunks(model: DocumentModel, maxChars = 2200, minChars = 1400): Chunk[] {
  // Map sentence index -> block index so we can prefer block boundaries
  const blockOf = new Map<number, number>();
  model.blocks.forEach((b, bi) => b.sentences.forEach((s) => blockOf.set(s.index, bi)));

  const chunks: Chunk[] = [];
  let cur: number[] = [];
  let curLen = 0;

  const flush = () => {
    if (!cur.length) return;
    const parts: string[] = [];
    const words: ChunkWordRef[] = [];
    let pos = 0;
    for (const si of cur) {
      const s = model.sentences[si];
      if (parts.length) { parts.push(" "); pos += 1; }
      // word offsets: locate each word's text within the sentence text sequentially
      let search = 0;
      for (const w of s.words) {
        const at = s.text.indexOf(w.text, search);
        if (at >= 0) {
          words.push({ wordIndex: w.index, charStart: pos + at, charEnd: pos + at + w.text.length });
          search = at + w.text.length;
        }
      }
      parts.push(s.text);
      pos += s.text.length;
    }
    chunks.push({ index: chunks.length, text: parts.join(""), sentenceIndexes: cur, words });
    cur = [];
    curLen = 0;
  };

  for (const s of model.sentences) {
    const addLen = s.text.length + (cur.length ? 1 : 0);
    if (cur.length && curLen + addLen > maxChars) flush();
    const prevBlock = cur.length ? blockOf.get(cur[cur.length - 1]) : undefined;
    if (cur.length && curLen >= minChars && blockOf.get(s.index) !== prevBlock) flush();
    cur.push(s.index);
    curLen += addLen;
  }
  flush();
  return chunks;
}
```

- [ ] **Step 4: Run, verify green**

Run: `npx vitest run src/core/chunker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/chunker.ts src/core/chunker.test.ts
git commit -m "feat: sentence-safe chunker with word char offsets"
```

---

### Task 5: Timing — Edge alignment, char alignment, estimation

**Files:**
- Create: `src/core/timing.ts`
- Test: `src/core/timing.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { timingsFromEdge, timingsFromCharAlignment, estimatedTimings, EdgeBoundary } from "./timing";
import { Chunk } from "./chunker";

const chunk: Chunk = {
  index: 0,
  text: "Hello brave world. Yes!",
  sentenceIndexes: [0, 1],
  words: [
    { wordIndex: 0, charStart: 0, charEnd: 5 },   // Hello
    { wordIndex: 1, charStart: 6, charEnd: 11 },  // brave
    { wordIndex: 2, charStart: 12, charEnd: 18 }, // world.
    { wordIndex: 3, charStart: 19, charEnd: 23 }, // Yes!
  ],
};

describe("timingsFromEdge", () => {
  it("matches boundary events to words in order (ticks → ms)", () => {
    const events: EdgeBoundary[] = [
      { text: "Hello", offsetTicks: 0, durationTicks: 4_000_000 },
      { text: "brave", offsetTicks: 5_000_000, durationTicks: 4_000_000 },
      { text: "world", offsetTicks: 10_000_000, durationTicks: 4_000_000 }, // no punctuation
      { text: "Yes", offsetTicks: 16_000_000, durationTicks: 3_000_000 },
    ];
    const t = timingsFromEdge(chunk, events);
    expect(t.unit).toBe("ms");
    expect(t.words).toEqual([
      { wordIndex: 0, start: 0, end: 400 },
      { wordIndex: 1, start: 500, end: 900 },
      { wordIndex: 2, start: 1000, end: 1400 },
      { wordIndex: 3, start: 1600, end: 1900 },
    ]);
  });

  it("skips unmatched boundary events without derailing", () => {
    const events: EdgeBoundary[] = [
      { text: "Hello", offsetTicks: 0, durationTicks: 4_000_000 },
      { text: "uhm", offsetTicks: 4_500_000, durationTicks: 100_000 }, // not in chunk
      { text: "brave", offsetTicks: 5_000_000, durationTicks: 4_000_000 },
    ];
    const t = timingsFromEdge(chunk, events);
    expect(t.words.map((w) => w.wordIndex)).toEqual([0, 1]);
  });
});

describe("timingsFromCharAlignment", () => {
  it("accumulates character times into word spans (seconds → ms)", () => {
    const chars = chunk.text.split("");
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.1);
    const t = timingsFromCharAlignment(chunk, chars, starts, ends);
    expect(t.unit).toBe("ms");
    expect(t.words[0]).toEqual({ wordIndex: 0, start: 0, end: 500 });
    expect(t.words[3].start).toBeCloseTo(1900, 0);
  });
});

describe("estimatedTimings", () => {
  it("allocates fractions proportional to char position", () => {
    const t = estimatedTimings(chunk);
    expect(t.unit).toBe("fraction");
    expect(t.words[0].start).toBe(0);
    const last = t.words[t.words.length - 1];
    expect(last.end).toBe(1);
    for (let i = 1; i < t.words.length; i++) {
      expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start);
    }
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/core/timing.test.ts`
Expected: FAIL — cannot resolve `./timing`.

- [ ] **Step 3: Implement timing.ts**

```typescript
import { Chunk } from "./chunker";

export interface WordTiming { wordIndex: number; start: number; end: number }
export interface ChunkTimings { unit: "ms" | "fraction"; words: WordTiming[] }
export interface EdgeBoundary { text: string; offsetTicks: number; durationTicks: number }

const TICKS_PER_MS = 10_000;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function timingsFromEdge(chunk: Chunk, events: EdgeBoundary[]): ChunkTimings {
  const words: WordTiming[] = [];
  let wi = 0;
  for (const ev of events) {
    const target = norm(ev.text);
    if (!target) continue;
    // look ahead a small window for the matching word
    for (let look = wi; look < Math.min(wi + 3, chunk.words.length); look++) {
      const ref = chunk.words[look];
      const wordText = chunk.text.slice(ref.charStart, ref.charEnd);
      if (norm(wordText) === target || norm(wordText).startsWith(target)) {
        words.push({
          wordIndex: ref.wordIndex,
          start: Math.round(ev.offsetTicks / TICKS_PER_MS),
          end: Math.round((ev.offsetTicks + ev.durationTicks) / TICKS_PER_MS),
        });
        wi = look + 1;
        break;
      }
    }
  }
  return { unit: "ms", words };
}

export function timingsFromCharAlignment(
  chunk: Chunk, chars: string[], startSeconds: number[], endSeconds: number[]
): ChunkTimings {
  const words: WordTiming[] = chunk.words.flatMap((ref) => {
    if (ref.charStart >= chars.length) return [];
    const endIdx = Math.min(ref.charEnd, chars.length) - 1;
    return [{
      wordIndex: ref.wordIndex,
      start: Math.round(startSeconds[ref.charStart] * 1000),
      end: Math.round(endSeconds[endIdx] * 1000),
    }];
  });
  return { unit: "ms", words };
}

export function estimatedTimings(chunk: Chunk): ChunkTimings {
  const total = chunk.text.length || 1;
  const words: WordTiming[] = chunk.words.map((ref, i) => ({
    wordIndex: ref.wordIndex,
    start: ref.charStart / total,
    end: i === chunk.words.length - 1 ? 1 : ref.charEnd / total,
  }));
  return { unit: "fraction", words };
}
```

- [ ] **Step 4: Run, verify green**

Run: `npx vitest run src/core/timing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/timing.ts src/core/timing.test.ts
git commit -m "feat: word timing alignment (edge ticks, char alignment, estimation)"
```

---

### Task 6: Provider interface + disk cache

**Files:**
- Create: `src/synthesis/provider.ts`
- Create: `src/synthesis/disk-cache.ts`
- Test: `src/synthesis/disk-cache.test.ts`

- [ ] **Step 1: Create provider.ts (types only, no test needed)**

```typescript
import { Chunk } from "../core/chunker";
import { ChunkTimings } from "../core/timing";

export interface VoiceInfo { id: string; label: string }
export interface ChunkAudio { audio: Uint8Array; format: "mp3" | "wav"; timings: ChunkTimings }

export interface TtsProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresKey: boolean;
  readonly timingQuality: "exact" | "estimated";
  readonly maxCharsPerRequest: number;
  readonly defaultVoice: string;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio>;
}
```

- [ ] **Step 2: Write failing disk-cache tests**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DiskCache } from "./disk-cache";
import { ChunkAudio } from "./provider";

const audio = (n: number, fill = 65): ChunkAudio => ({
  audio: new Uint8Array(n).fill(fill),
  format: "mp3",
  timings: { unit: "ms", words: [{ wordIndex: 0, start: 0, end: 100 }] },
});

describe("DiskCache", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "speakittome-cache-")); });

  it("round-trips audio and timings", async () => {
    const cache = new DiskCache(dir, 1024 * 1024);
    const key = DiskCache.makeKey("hello", "edge", "aria");
    await cache.set(key, audio(100));
    const got = await cache.get(key);
    expect(got?.format).toBe("mp3");
    expect(got?.audio.length).toBe(100);
    expect(got?.timings.words[0].end).toBe(100);
  });

  it("returns undefined on miss", async () => {
    const cache = new DiskCache(dir, 1024);
    expect(await cache.get("nope")).toBeUndefined();
  });

  it("evicts least-recently-used entries beyond the byte cap", async () => {
    const cache = new DiskCache(dir, 250);
    await cache.set("a", audio(100));
    await cache.set("b", audio(100));
    await cache.get("a");                 // a now more recent than b
    await cache.set("c", audio(100));     // exceeds 250 → evict b
    expect(await cache.get("a")).toBeDefined();
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBeDefined();
  });

  it("survives a new instance over the same dir (persistence)", async () => {
    const c1 = new DiskCache(dir, 1024 * 1024);
    await c1.set("k", audio(50));
    const c2 = new DiskCache(dir, 1024 * 1024);
    expect((await c2.get("k"))?.audio.length).toBe(50);
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `npx vitest run src/synthesis/disk-cache.test.ts`
Expected: FAIL — cannot resolve `./disk-cache`.

- [ ] **Step 4: Implement disk-cache.ts**

```typescript
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import { ChunkAudio } from "./provider";
import { ChunkTimings } from "../core/timing";

interface Meta { format: "mp3" | "wav"; timings: ChunkTimings; size: number; lastAccess: number }

export class DiskCache {
  private accessClock = 0;

  constructor(private dir: string, private maxBytes: number) {}

  static makeKey(text: string, providerId: string, voiceId: string): string {
    return createHash("sha256").update(`${text} ${providerId} ${voiceId}`).digest("hex").slice(0, 24);
  }

  private binPath(key: string) { return join(this.dir, `${key}.bin`); }
  private metaPath(key: string) { return join(this.dir, `${key}.json`); }

  async get(key: string): Promise<ChunkAudio | undefined> {
    try {
      const meta: Meta = JSON.parse(await fs.readFile(this.metaPath(key), "utf8"));
      const audio = new Uint8Array(await fs.readFile(this.binPath(key)));
      meta.lastAccess = Date.now() + ++this.accessClock;
      await fs.writeFile(this.metaPath(key), JSON.stringify(meta));
      return { audio, format: meta.format, timings: meta.timings };
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: ChunkAudio): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const meta: Meta = {
      format: value.format, timings: value.timings,
      size: value.audio.byteLength, lastAccess: Date.now() + ++this.accessClock,
    };
    await fs.writeFile(this.binPath(key), Buffer.from(value.audio));
    await fs.writeFile(this.metaPath(key), JSON.stringify(meta));
    await this.evictIfNeeded();
  }

  private async evictIfNeeded(): Promise<void> {
    let entries: { key: string; meta: Meta }[] = [];
    try {
      const files = await fs.readdir(this.dir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const key = f.slice(0, -5);
        try { entries.push({ key, meta: JSON.parse(await fs.readFile(this.metaPath(key), "utf8")) }); }
        catch { /* corrupt entry; remove below by treating as oldest */ entries.push({ key, meta: { format: "mp3", timings: { unit: "ms", words: [] }, size: 0, lastAccess: 0 } }); }
      }
    } catch { return; }
    let total = entries.reduce((n, e) => n + e.meta.size, 0);
    if (total <= this.maxBytes) return;
    entries.sort((a, b) => a.meta.lastAccess - b.meta.lastAccess);
    for (const e of entries) {
      if (total <= this.maxBytes) break;
      await fs.rm(this.binPath(e.key), { force: true });
      await fs.rm(this.metaPath(e.key), { force: true });
      total -= e.meta.size;
    }
  }
}
```

- [ ] **Step 5: Run, verify green, commit**

Run: `npx vitest run src/synthesis/disk-cache.test.ts`
Expected: PASS (4 tests).

```bash
git add src/synthesis/provider.ts src/synthesis/disk-cache.ts src/synthesis/disk-cache.test.ts
git commit -m "feat: TtsProvider interface and LRU disk cache"
```

---
### Task 7: Edge TTS provider (default)

Uses `msedge-tts` (installed in Task 1). API verified June 2026: `new MsEdgeTTS()`, `setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true })`, `toStream(text)` returns `{ audioStream, metadataStream }`; metadata events are JSON with `Metadata[].Type === "WordBoundary"` and `Data.Offset`/`Data.Duration` in 100-ns ticks, `Data.text.Text` the spoken word. If the installed version's README differs, adapt the event parsing here, nothing else.

**Files:**
- Create: `src/synthesis/edge.ts`
- Create: `scripts/smoke-edge.ts`

- [ ] **Step 1: Implement edge.ts**

```typescript
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { Chunk } from "../core/chunker";
import { EdgeBoundary, timingsFromEdge } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const FALLBACK_VOICES: VoiceInfo[] = [
  { id: "en-US-AriaNeural", label: "Aria (US)" },
  { id: "en-US-GuyNeural", label: "Guy (US)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK)" },
  { id: "en-IN-NeerjaNeural", label: "Neerja (IN)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (AU)" },
];

export class EdgeProvider implements TtsProvider {
  readonly id = "edge";
  readonly label = "Edge TTS (free)";
  readonly requiresKey = false;
  readonly timingQuality = "exact" as const;
  readonly maxCharsPerRequest = 6000;
  readonly defaultVoice = "en-US-AriaNeural";

  async listVoices(): Promise<VoiceInfo[]> {
    try {
      const tts = new MsEdgeTTS();
      const voices: { ShortName: string; FriendlyName?: string; Locale: string }[] =
        await tts.getVoices();
      return voices
        .filter((v) => v.Locale.startsWith("en-"))
        .map((v) => ({ id: v.ShortName, label: v.FriendlyName ?? v.ShortName }));
    } catch {
      return FALLBACK_VOICES;
    }
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: false,
    });
    const { audioStream, metadataStream } = tts.toStream(chunk.text);

    const audioParts: Buffer[] = [];
    const boundaries: EdgeBoundary[] = [];

    return new Promise<ChunkAudio>((resolve, reject) => {
      const fail = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));
      signal.addEventListener("abort", () => fail(new Error("aborted")), { once: true });

      audioStream.on("data", (d: Buffer) => audioParts.push(d));
      audioStream.on("error", fail);
      metadataStream?.on("data", (d: Buffer) => {
        try {
          const parsed = JSON.parse(d.toString("utf8"));
          for (const m of parsed.Metadata ?? []) {
            if (m.Type === "WordBoundary") {
              boundaries.push({
                text: m.Data?.text?.Text ?? "",
                offsetTicks: m.Data?.Offset ?? 0,
                durationTicks: m.Data?.Duration ?? 0,
              });
            }
          }
        } catch { /* ignore malformed metadata frames */ }
      });
      audioStream.on("close", () => {
        if (signal.aborted) return;
        const audio = new Uint8Array(Buffer.concat(audioParts));
        if (audio.byteLength === 0) return fail(new Error("Edge TTS returned no audio"));
        resolve({ audio, format: "mp3", timings: timingsFromEdge(chunk, boundaries) });
      });
    });
  }
}
```

- [ ] **Step 2: Create the smoke script**

```typescript
// scripts/smoke-edge.ts — manual verification against the real service
import { writeFileSync } from "fs";
import { EdgeProvider } from "../src/synthesis/edge";
import { parseDocument } from "../src/core/document-model";
import { buildChunks } from "../src/core/chunker";

const model = parseDocument(
  "SpeakItToMe is a reading companion. It highlights every word as it speaks. Try it now!",
  "smoke.txt", 1
);
const [chunk] = buildChunks(model);
const provider = new EdgeProvider();
const result = await provider.synthesize(chunk, provider.defaultVoice, new AbortController().signal);
writeFileSync("/tmp/speakittome-smoke.mp3", Buffer.from(result.audio));
console.log("audio bytes:", result.audio.byteLength);
console.log("timings:", JSON.stringify(result.timings, null, 2));
```

- [ ] **Step 3: Run the smoke test (network required)**

Run: `npx tsx scripts/smoke-edge.ts && open /tmp/speakittome-smoke.mp3`
Expected: prints a nonzero byte count, prints `unit: "ms"` timings covering most words (Edge omits some punctuation-only tokens, fine), and the mp3 plays the sentence. If `getVoices`/event shapes differ from the README of the installed version, fix the parsing in `edge.ts` now.

- [ ] **Step 4: Run full test suite, commit**

Run: `npm test`
Expected: all prior tests still PASS.

```bash
git add src/synthesis/edge.ts scripts/smoke-edge.ts
git commit -m "feat: Edge TTS provider with word-boundary timings"
```

---

### Task 8: SynthesisService — priority queue, dedupe, cache integration

**Files:**
- Create: `src/synthesis/synthesis-service.ts`
- Test: `src/synthesis/synthesis-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { SynthesisService } from "./synthesis-service";
import { ChunkAudio, TtsProvider } from "./provider";
import { Chunk } from "../core/chunker";

const mkChunk = (i: number): Chunk => ({ index: i, text: `chunk ${i}`, sentenceIndexes: [i], words: [] });
const mkAudio = (): ChunkAudio => ({ audio: new Uint8Array(4), format: "mp3", timings: { unit: "ms", words: [] } });

function mockProvider(log: number[], delayMs = 5): TtsProvider {
  return {
    id: "mock", label: "Mock", requiresKey: false, timingQuality: "exact",
    maxCharsPerRequest: 9999, defaultVoice: "v",
    listVoices: async () => [],
    synthesize: vi.fn(async (chunk: Chunk) => {
      log.push(chunk.index);
      await new Promise((r) => setTimeout(r, delayMs));
      return mkAudio();
    }),
  };
}

describe("SynthesisService", () => {
  it("dedupes concurrent requests for the same chunk", async () => {
    const log: number[] = [];
    const svc = new SynthesisService(mockProvider(log), "v");
    const [a, b] = await Promise.all([svc.request(mkChunk(0)), svc.request(mkChunk(0))]);
    expect(a).toBe(b);
    expect(log).toEqual([0]);
  });

  it("priority requests jump the queue", async () => {
    const log: number[] = [];
    const svc = new SynthesisService(mockProvider(log), "v");
    const p0 = svc.request(mkChunk(0));            // starts immediately
    const p1 = svc.request(mkChunk(1));
    const p2 = svc.request(mkChunk(2));
    const p9 = svc.request(mkChunk(9), true);      // priority — should run before 1 and 2
    await Promise.all([p0, p1, p2, p9]);
    expect(log[0]).toBe(0);
    expect(log[1]).toBe(9);
  });

  it("uses the cache when provided", async () => {
    const log: number[] = [];
    const stored = new Map<string, ChunkAudio>();
    const cache = {
      get: async (k: string) => stored.get(k),
      set: async (k: string, v: ChunkAudio) => void stored.set(k, v),
    };
    const svc = new SynthesisService(mockProvider(log), "v", cache);
    await svc.request(mkChunk(0));
    const svc2 = new SynthesisService(mockProvider(log), "v", cache);
    await svc2.request(mkChunk(0));
    expect(log).toEqual([0]); // second service hit the cache
  });

  it("abortAll rejects queued work", async () => {
    const log: number[] = [];
    const svc = new SynthesisService(mockProvider(log, 50), "v");
    const p0 = svc.request(mkChunk(0));
    const p1 = svc.request(mkChunk(1));
    svc.abortAll();
    await expect(p1).rejects.toThrow();
    await p0.catch(() => {}); // in-flight may reject too; either is fine
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/synthesis/synthesis-service.test.ts`
Expected: FAIL — cannot resolve `./synthesis-service`.

- [ ] **Step 3: Implement synthesis-service.ts**

```typescript
import { Chunk } from "../core/chunker";
import { ChunkAudio, TtsProvider } from "./provider";
import { DiskCache } from "./disk-cache";

interface CacheLike {
  get(key: string): Promise<ChunkAudio | undefined>;
  set(key: string, value: ChunkAudio): Promise<void>;
}

interface Job {
  chunk: Chunk;
  priority: boolean;
  seq: number;
  resolve: (a: ChunkAudio) => void;
  reject: (e: Error) => void;
}

export class SynthesisService {
  private inFlight = new Map<number, Promise<ChunkAudio>>();
  private queue: Job[] = [];
  private working = false;
  private seq = 0;
  private controller = new AbortController();

  constructor(
    private provider: TtsProvider,
    private voice: string,
    private cache?: CacheLike
  ) {}

  request(chunk: Chunk, priority = false): Promise<ChunkAudio> {
    const existing = this.inFlight.get(chunk.index);
    if (existing) {
      if (priority) this.bump(chunk.index);
      return existing;
    }
    const promise = new Promise<ChunkAudio>((resolve, reject) => {
      this.queue.push({ chunk, priority, seq: this.seq++, resolve, reject });
      this.queue.sort((a, b) =>
        a.priority !== b.priority ? (a.priority ? -1 : 1) : a.seq - b.seq
      );
    });
    this.inFlight.set(chunk.index, promise);
    promise.catch(() => {}).finally(() => this.inFlight.delete(chunk.index));
    void this.work();
    return promise;
  }

  private bump(chunkIndex: number) {
    const job = this.queue.find((j) => j.chunk.index === chunkIndex);
    if (job) {
      job.priority = true;
      this.queue.sort((a, b) =>
        a.priority !== b.priority ? (a.priority ? -1 : 1) : a.seq - b.seq
      );
    }
  }

  abortAll() {
    this.controller.abort();
    this.controller = new AbortController();
    for (const job of this.queue.splice(0)) job.reject(new Error("aborted"));
  }

  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        try {
          const key = DiskCache.makeKey(job.chunk.text, this.provider.id, this.voice);
          const cached = await this.cache?.get(key);
          if (cached) { job.resolve(cached); continue; }
          let result: ChunkAudio;
          try {
            result = await this.provider.synthesize(job.chunk, this.voice, this.controller.signal);
          } catch (first) {
            if (this.controller.signal.aborted) throw first;
            result = await this.provider.synthesize(job.chunk, this.voice, this.controller.signal);
          }
          await this.cache?.set(key, result);
          job.resolve(result);
        } catch (err) {
          job.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      this.working = false;
    }
  }
}
```

- [ ] **Step 4: Run, verify green, commit**

Run: `npx vitest run src/synthesis/synthesis-service.test.ts`
Expected: PASS (4 tests).

```bash
git add src/synthesis/synthesis-service.ts src/synthesis/synthesis-service.test.ts
git commit -m "feat: synthesis service with priority queue, dedupe, retry, cache"
```

---

### Task 9: Webview renderer — model to DOM

**Files:**
- Create: `src/webview/renderer.ts`
- Test: `src/webview/renderer.test.ts` (happy-dom)

- [ ] **Step 1: Write failing tests**

```typescript
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderModel } from "./renderer";
import { parseDocument } from "../core/document-model";

const md = ["# Title here", "", "One two. Three four!", "", "```js", "code();", "```"].join("\n");

describe("renderModel", () => {
  it("renders blocks with kind classes and every word as an indexed span", () => {
    const root = document.createElement("div");
    renderModel(root, parseDocument(md, "t.md", 1));
    expect(root.querySelector(".block-heading")).toBeTruthy();
    expect(root.querySelector(".block-paragraph")).toBeTruthy();
    const spans = [...root.querySelectorAll("span[data-w]")];
    // words: "Title here One two. Three four!" → 6 words
    expect(spans.map((s) => s.textContent)).toEqual(["Title", "here", "One", "two.", "Three", "four!"]);
    expect(spans.map((s) => s.getAttribute("data-w"))).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("renders code blocks dimmed without word spans", () => {
    const root = document.createElement("div");
    renderModel(root, parseDocument(md, "t.md", 1));
    const code = root.querySelector(".block-code");
    expect(code?.textContent).toContain("code();");
    expect(code?.querySelector("span[data-w]")).toBeNull();
  });

  it("wraps each sentence in a span with data-s index", () => {
    const root = document.createElement("div");
    renderModel(root, parseDocument(md, "t.md", 1));
    const sents = [...root.querySelectorAll("span[data-s]")];
    expect(sents.map((s) => s.getAttribute("data-s"))).toEqual(["0", "1", "2"]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/webview/renderer.test.ts`
Expected: FAIL — cannot resolve `./renderer`.

- [ ] **Step 3: Implement renderer.ts**

```typescript
import { Block, DocumentModel, Sentence } from "../core/document-model";

const TAG: Record<string, string> = {
  paragraph: "p", "list-item": "li", quote: "blockquote", code: "pre",
};

function renderSentence(s: Sentence): HTMLElement {
  const span = document.createElement("span");
  span.className = "sentence";
  span.setAttribute("data-s", String(s.index));
  s.words.forEach((w, i) => {
    if (i > 0) span.appendChild(document.createTextNode(" "));
    const ws = document.createElement("span");
    ws.setAttribute("data-w", String(w.index));
    ws.textContent = w.text;
    span.appendChild(ws);
  });
  return span;
}

function renderBlock(b: Block): HTMLElement {
  const tag = b.kind === "heading" ? `h${Math.min(b.level ?? 1, 6)}` : TAG[b.kind] ?? "p";
  const el = document.createElement(tag);
  el.className = `block block-${b.kind}`;
  if (b.kind === "code") {
    el.textContent = b.codeText ?? "";
    el.title = "Code block (not read aloud)";
    return el;
  }
  b.sentences.forEach((s, i) => {
    if (i > 0) el.appendChild(document.createTextNode(" "));
    el.appendChild(renderSentence(s));
  });
  return el;
}

export function renderModel(root: HTMLElement, model: DocumentModel): void {
  root.textContent = "";
  for (const block of model.blocks) root.appendChild(renderBlock(block));
}
```

- [ ] **Step 4: Run, verify green, commit**

Run: `npx vitest run src/webview/renderer.test.ts`
Expected: PASS (3 tests).

```bash
git add src/webview/renderer.ts src/webview/renderer.test.ts
git commit -m "feat: reader renderer — model to DOM with word/sentence spans"
```

---

### Task 10: Playback engine — dual audio handoff

The engine is DOM-free: it takes an audio-element factory so tests inject fakes. It owns position, speed, pause/resume (sentence restart), jump, and chunk request callbacks.

**Files:**
- Create: `src/webview/engine.ts`
- Test: `src/webview/engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Engine, AudioLike, EngineCallbacks } from "./engine";
import { DocumentModel } from "../core/document-model";
import { Chunk } from "../core/chunker";
import { ChunkTimings } from "../core/timing";

class FakeAudio implements AudioLike {
  currentTime = 0; duration = NaN; playbackRate = 1; preservesPitch = true;
  paused = true; src = "";
  onended: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  _loaded(durationSec: number) { this.duration = durationSec; this.onloadedmetadata?.(); }
  _ended() { this.onended?.(); }
}

// Minimal 2-chunk session: words 0-1 in chunk 0, words 2-3 in chunk 1; one sentence per chunk
const model = {
  uri: "t", version: 1, blocks: [],
  sentences: [
    { index: 0, text: "a b.", source: { start: 0, end: 4 }, words: [
      { index: 0, text: "a", source: { start: 0, end: 1 } },
      { index: 1, text: "b.", source: { start: 2, end: 4 } } ] },
    { index: 1, text: "c d.", source: { start: 5, end: 9 }, words: [
      { index: 2, text: "c", source: { start: 5, end: 6 } },
      { index: 3, text: "d.", source: { start: 7, end: 9 } } ] },
  ],
  words: [] as DocumentModel["words"],
} as DocumentModel;
model.words = model.sentences.flatMap((s) => s.words);

const chunks: Chunk[] = [
  { index: 0, text: "a b.", sentenceIndexes: [0], words: [
    { wordIndex: 0, charStart: 0, charEnd: 1 }, { wordIndex: 1, charStart: 2, charEnd: 4 } ] },
  { index: 1, text: "c d.", sentenceIndexes: [1], words: [
    { wordIndex: 2, charStart: 0, charEnd: 1 }, { wordIndex: 3, charStart: 2, charEnd: 4 } ] },
];
const msTimings: ChunkTimings = { unit: "ms", words: [
  { wordIndex: 0, start: 0, end: 400 }, { wordIndex: 1, start: 500, end: 900 } ] };
const msTimings2: ChunkTimings = { unit: "ms", words: [
  { wordIndex: 2, start: 0, end: 400 }, { wordIndex: 3, start: 500, end: 900 } ] };

function setup() {
  const audios: FakeAudio[] = [];
  const cb: EngineCallbacks = {
    requestChunk: vi.fn(), onPosition: vi.fn(), onState: vi.fn(),
    createAudio: () => { const a = new FakeAudio(); audios.push(a); return a; },
    makeUrl: () => "blob:x", revokeUrl: vi.fn(),
  };
  const engine = new Engine(model, chunks, cb);
  return { engine, audios, cb };
}

describe("Engine", () => {
  it("requests the first chunk and the next ones ahead on start", () => {
    const { engine, cb } = setup();
    engine.start(0);
    expect(cb.requestChunk).toHaveBeenCalledWith(0, true);
    expect(cb.requestChunk).toHaveBeenCalledWith(1, false);
  });

  it("plays when audio arrives, hands off to preloaded next chunk on ended", () => {
    const { engine, audios, cb } = setup();
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: msTimings });
    audios[0]._loaded(1.0);
    expect(audios[0].paused).toBe(false);
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    audios[0]._ended();
    const second = audios.find((a) => a !== audios[0] && !a.paused);
    expect(second).toBeTruthy();
    expect(cb.onState).toHaveBeenLastCalledWith("playing");
  });

  it("resume restarts the current sentence", () => {
    const { engine, audios } = setup();
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: msTimings });
    audios[0]._loaded(1.0);
    audios[0].currentTime = 0.7;   // inside word 1, sentence 0 starts at 0ms
    engine.tick();                  // updates current word from time
    engine.pause();
    engine.resume();
    expect(audios[0].currentTime).toBe(0); // sentence start
    expect(audios[0].paused).toBe(false);
  });

  it("jumpToWord in an unloaded chunk requests it with priority and plays on arrival", () => {
    const { engine, audios, cb } = setup();
    engine.start(0);
    engine.jumpToWord(2);
    expect(cb.requestChunk).toHaveBeenCalledWith(1, true);
    engine.receiveChunk(1, { audio: new Uint8Array(1), format: "mp3", timings: msTimings2 });
    const a = audios[audios.length - 1];
    a._loaded(1.0);
    expect(a.paused).toBe(false);
    expect(a.currentTime).toBe(0); // word 2 starts at 0ms in chunk 1
  });

  it("setSpeed applies to current and future audio", () => {
    const { engine, audios } = setup();
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: msTimings });
    audios[0]._loaded(1.0);
    engine.setSpeed(1.75);
    expect(audios[0].playbackRate).toBe(1.75);
  });

  it("resolves fraction timings to ms once duration is known", () => {
    const { engine, audios, cb } = setup();
    const frac: ChunkTimings = { unit: "fraction", words: [
      { wordIndex: 0, start: 0, end: 0.4 }, { wordIndex: 1, start: 0.5, end: 1 } ] };
    engine.start(0);
    engine.receiveChunk(0, { audio: new Uint8Array(1), format: "mp3", timings: frac });
    audios[0]._loaded(2.0); // 2s → word 1 starts at 1000ms
    audios[0].currentTime = 1.2;
    engine.tick();
    expect(cb.onPosition).toHaveBeenLastCalledWith(1, 0);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/webview/engine.test.ts`
Expected: FAIL — cannot resolve `./engine`.

- [ ] **Step 3: Implement engine.ts**

```typescript
import { DocumentModel } from "../core/document-model";
import { Chunk } from "../core/chunker";
import { ChunkTimings } from "../core/timing";

export interface AudioLike {
  currentTime: number; duration: number; playbackRate: number; preservesPitch: boolean;
  paused: boolean; src: string;
  onended: (() => void) | null;
  onloadedmetadata: (() => void) | null;
  play(): Promise<void>; pause(): void;
}

export interface EngineCallbacks {
  requestChunk(chunkIndex: number, priority: boolean): void;
  onPosition(wordIndex: number, sentenceIndex: number): void;
  onState(state: "playing" | "paused" | "ended"): void;
  createAudio(): AudioLike;
  makeUrl(audio: Uint8Array, format: string): string;
  revokeUrl(url: string): void;
}

interface LoadedChunk {
  audio: AudioLike; url: string;
  timingsMs: { wordIndex: number; start: number; end: number }[] | null; // null until duration known (fraction unit)
  rawTimings: ChunkTimings;
}

const PREFETCH = 2;

export class Engine {
  private loaded = new Map<number, LoadedChunk>();
  private currentChunk = 0;
  private currentWord = -1;
  private speed = 1;
  private playing = false;
  private pendingJumpWord: number | null = null;
  private wordToSentence = new Map<number, number>();
  private wordToChunk = new Map<number, number>();
  private sentenceFirstWord = new Map<number, number>();

  constructor(
    private model: DocumentModel,
    private chunks: Chunk[],
    private cb: EngineCallbacks
  ) {
    for (const s of model.sentences) {
      if (s.words.length) this.sentenceFirstWord.set(s.index, s.words[0].index);
      for (const w of s.words) this.wordToSentence.set(w.index, s.index);
    }
    for (const c of chunks) for (const ref of c.words) this.wordToChunk.set(ref.wordIndex, c.index);
  }

  start(chunkIndex: number) {
    this.currentChunk = chunkIndex;
    this.playing = true;
    this.cb.requestChunk(chunkIndex, true);
    this.prefetch(chunkIndex + 1);
  }

  private prefetch(from: number) {
    for (let i = from; i < Math.min(from + PREFETCH, this.chunks.length); i++) {
      if (!this.loaded.has(i)) this.cb.requestChunk(i, false);
    }
  }

  receiveChunk(chunkIndex: number, data: { audio: Uint8Array; format: string; timings: ChunkTimings }) {
    if (this.loaded.has(chunkIndex)) return;
    const url = this.cb.makeUrl(data.audio, data.format);
    const audio = this.cb.createAudio();
    audio.preservesPitch = true;
    audio.playbackRate = this.speed;
    audio.src = url;
    const lc: LoadedChunk = {
      audio, url, rawTimings: data.timings,
      timingsMs: data.timings.unit === "ms" ? data.timings.words : null,
    };
    audio.onloadedmetadata = () => {
      if (lc.timingsMs === null) {
        const durMs = audio.duration * 1000;
        lc.timingsMs = data.timings.words.map((w) => ({
          wordIndex: w.wordIndex, start: w.start * durMs, end: w.end * durMs,
        }));
      }
      this.maybeStartChunk(chunkIndex);
    };
    audio.onended = () => this.handoff(chunkIndex);
    this.loaded.set(chunkIndex, lc);
    // happy path for fakes/tests where metadata may already be known
    if (!Number.isNaN(audio.duration)) audio.onloadedmetadata?.();
  }

  private maybeStartChunk(chunkIndex: number) {
    if (!this.playing || chunkIndex !== this.currentChunk) return;
    const lc = this.loaded.get(chunkIndex);
    if (!lc || lc.timingsMs === null) return;
    if (this.pendingJumpWord !== null) {
      const t = lc.timingsMs.find((w) => w.wordIndex === this.pendingJumpWord);
      lc.audio.currentTime = t ? t.start / 1000 : 0;
      this.pendingJumpWord = null;
    }
    void lc.audio.play();
    this.cb.onState("playing");
  }

  private handoff(endedChunk: number) {
    if (endedChunk !== this.currentChunk) return;
    const next = this.currentChunk + 1;
    if (next >= this.chunks.length) {
      this.playing = false;
      this.cb.onState("ended");
      return;
    }
    this.currentChunk = next;
    this.prefetch(next + 1);
    const lc = this.loaded.get(next);
    if (lc && lc.timingsMs !== null) {
      lc.audio.currentTime = 0;
      void lc.audio.play();
      this.cb.onState("playing");
    } else {
      this.cb.requestChunk(next, true);
    }
  }

  pause() {
    const lc = this.loaded.get(this.currentChunk);
    lc?.audio.pause();
    this.playing = false;
    this.cb.onState("paused");
  }

  resume() {
    this.playing = true;
    const sentence = this.wordToSentence.get(Math.max(this.currentWord, 0)) ?? 0;
    const firstWord = this.sentenceFirstWord.get(sentence);
    if (firstWord !== undefined) this.jumpToWord(firstWord);
    else this.maybeStartChunk(this.currentChunk);
  }

  jumpToWord(wordIndex: number) {
    const chunkIndex = this.wordToChunk.get(wordIndex);
    if (chunkIndex === undefined) return;
    const prev = this.loaded.get(this.currentChunk);
    prev?.audio.pause();
    this.currentChunk = chunkIndex;
    this.currentWord = wordIndex;
    this.playing = true;
    const lc = this.loaded.get(chunkIndex);
    if (lc && lc.timingsMs !== null) {
      const t = lc.timingsMs.find((w) => w.wordIndex === wordIndex);
      lc.audio.currentTime = t ? t.start / 1000 : 0;
      void lc.audio.play();
      this.cb.onState("playing");
      this.prefetch(chunkIndex + 1);
    } else {
      this.pendingJumpWord = wordIndex;
      this.cb.requestChunk(chunkIndex, true);
      this.prefetch(chunkIndex + 1);
    }
  }

  setSpeed(rate: number) {
    this.speed = rate;
    for (const lc of this.loaded.values()) lc.audio.playbackRate = rate;
  }

  stop() {
    for (const lc of this.loaded.values()) {
      lc.audio.pause();
      this.cb.revokeUrl(lc.url);
    }
    this.loaded.clear();
    this.playing = false;
  }

  // Called on a ~100ms interval by main.ts; resolves current word from audio time.
  tick() {
    const lc = this.loaded.get(this.currentChunk);
    if (!lc || lc.timingsMs === null) return;
    const ms = lc.audio.currentTime * 1000;
    let word = -1;
    for (const w of lc.timingsMs) {
      if (ms >= w.start) word = w.wordIndex;
      else break;
    }
    if (word >= 0 && word !== this.currentWord) {
      this.currentWord = word;
      this.cb.onPosition(word, this.wordToSentence.get(word) ?? 0);
    }
  }

  get isPlaying() { return this.playing; }
  get currentSentence() { return this.wordToSentence.get(Math.max(this.currentWord, 0)) ?? 0; }
}
```

- [ ] **Step 4: Run, verify green**

Run: `npx vitest run src/webview/engine.test.ts`
Expected: PASS (6 tests). The trickiest is the resume test: `tick()` must set `currentWord` from `currentTime` before pause for sentence-restart to find the right sentence.

- [ ] **Step 5: Commit**

```bash
git add src/webview/engine.ts src/webview/engine.test.ts
git commit -m "feat: dual-audio playback engine with handoff, jump, sentence-restart resume"
```

---

### Task 11: Highlight controller + webview main wiring + CSS

**Files:**
- Create: `src/webview/highlight.ts`
- Rewrite: `src/webview/main.ts`
- Create: `media/reader.css`

No unit tests here (DOM scroll behavior); verified in the Task 13 smoke checkpoint.

- [ ] **Step 1: Implement highlight.ts**

```typescript
export class HighlightController {
  private activeSentence: HTMLElement | null = null;
  private activeWord: HTMLElement | null = null;
  private following = true;
  private suppressScrollEvents = 0;
  private pill: HTMLElement;

  constructor(private root: HTMLElement, private onReturn?: () => void) {
    this.pill = document.createElement("button");
    this.pill.id = "return-pill";
    this.pill.textContent = "↓ Return to playback";
    this.pill.hidden = true;
    document.body.appendChild(this.pill);
    this.pill.addEventListener("click", () => this.engageFollow());

    window.addEventListener("scroll", () => {
      if (this.suppressScrollEvents > 0) { this.suppressScrollEvents--; return; }
      if (this.following) { this.following = false; this.pill.hidden = false; }
    }, { passive: true });
  }

  engageFollow() {
    this.following = true;
    this.pill.hidden = true;
    this.scrollToActive();
    this.onReturn?.();
  }

  setActive(wordIndex: number, sentenceIndex: number) {
    const word = this.root.querySelector<HTMLElement>(`span[data-w="${wordIndex}"]`);
    const sentence = this.root.querySelector<HTMLElement>(`span[data-s="${sentenceIndex}"]`);
    if (this.activeWord) this.activeWord.classList.remove("word-active");
    if (this.activeSentence && this.activeSentence !== sentence)
      this.activeSentence.classList.remove("sentence-active");
    word?.classList.add("word-active");
    sentence?.classList.add("sentence-active");
    this.activeWord = word;
    this.activeSentence = sentence;
    if (this.following) this.scrollToActive();
  }

  clear() {
    this.activeWord?.classList.remove("word-active");
    this.activeSentence?.classList.remove("sentence-active");
    this.activeWord = this.activeSentence = null;
  }

  private scrollToActive() {
    if (!this.activeSentence) return;
    const rect = this.activeSentence.getBoundingClientRect();
    const margin = window.innerHeight * 0.25;
    if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
      this.suppressScrollEvents += 2; // our own scroll fires events; don't treat as manual
      this.activeSentence.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}
```

- [ ] **Step 2: Implement main.ts**

```typescript
import { Engine, AudioLike } from "./engine";
import { renderModel } from "./renderer";
import { HighlightController } from "./highlight";
import { buildChunks, Chunk } from "../core/chunker";
import { DocumentModel } from "../core/document-model";
import { ChunkTimings } from "../core/timing";
import { initPlayerBar, PlayerBar } from "./player-bar";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

let engine: Engine | null = null;
let highlight: HighlightController | null = null;
let playerBar: PlayerBar | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

const FORMAT_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav" };

function init(model: DocumentModel, chunks: Chunk[], settings: { speed: number; fontSize: number; sentenceColor: string; wordColor: string }) {
  const root = document.getElementById("content")!;
  document.documentElement.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
  if (settings.sentenceColor) document.documentElement.style.setProperty("--sentence-color", settings.sentenceColor);
  if (settings.wordColor) document.documentElement.style.setProperty("--word-color", settings.wordColor);

  renderModel(root, model);
  highlight = new HighlightController(root);

  engine = new Engine(model, chunks, {
    requestChunk: (chunkIndex, priority) => vscode.postMessage({ type: "requestChunk", chunkIndex, priority }),
    onPosition: (wordIndex, sentenceIndex) => {
      highlight?.setActive(wordIndex, sentenceIndex);
      playerBar?.setPosition(sentenceIndex, model.sentences.length);
      vscode.postMessage({ type: "position", wordIndex, sentenceIndex });
    },
    onState: (state) => {
      playerBar?.setState(state);
      vscode.postMessage({ type: "state", state });
    },
    createAudio: () => new Audio() as unknown as AudioLike,
    makeUrl: (audio, format) =>
      URL.createObjectURL(new Blob([audio], { type: FORMAT_MIME[format] ?? "audio/mpeg" })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  });

  engine.setSpeed(settings.speed);
  playerBar = initPlayerBar({
    initialSpeed: settings.speed,
    onPlayPause: () => { engine!.isPlaying ? engine!.pause() : engine!.resume(); },
    onSpeed: (rate) => { engine!.setSpeed(rate); vscode.postMessage({ type: "speedChanged", rate }); },
    onPrevSentence: () => jumpSentence(-1),
    onNextSentence: () => jumpSentence(+1),
  });

  // click any word to jump
  root.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("span[data-w]");
    if (!target || !engine) return;
    engine.jumpToWord(Number(target.getAttribute("data-w")));
    highlight?.engageFollow();
  });

  function jumpSentence(delta: number) {
    if (!engine) return;
    const next = Math.max(0, Math.min(model.sentences.length - 1, engine.currentSentence + delta));
    const firstWord = model.sentences[next].words[0];
    if (firstWord) engine.jumpToWord(firstWord.index);
  }

  tickTimer = setInterval(() => engine?.tick(), 100);
  engine.start(0);
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      const chunks = buildChunks(msg.model);
      init(msg.model, chunks, msg.settings);
      break;
    }
    case "chunkAudio":
      engine?.receiveChunk(msg.chunkIndex, {
        audio: msg.audio instanceof Uint8Array ? msg.audio : new Uint8Array(msg.audio.data ?? msg.audio),
        format: msg.format, timings: msg.timings as ChunkTimings,
      });
      break;
    case "chunkFailed":
      playerBar?.showError(`Couldn't synthesize part ${msg.chunkIndex + 1}: ${msg.error}`);
      engine?.pause();
      break;
    case "seekToWord":
      engine?.jumpToWord(msg.wordIndex);
      highlight?.engageFollow();
      break;
    case "control":
      if (msg.action === "pause") engine?.pause();
      if (msg.action === "resume") engine?.resume();
      if (msg.action === "stop") { engine?.stop(); highlight?.clear(); if (tickTimer) clearInterval(tickTimer); }
      break;
  }
});

vscode.postMessage({ type: "ready" });
```

Note: `buildChunks` runs on BOTH sides with identical inputs (deterministic), so the extension and webview agree on chunk indexes without shipping chunk arrays across the bridge. The extension sends only the model; both derive chunks.

- [ ] **Step 3: Create media/reader.css**

```css
:root { --reader-font-size: 16px;
  --sentence-color: color-mix(in srgb, var(--vscode-editor-selectionBackground) 55%, transparent);
  --word-color: var(--vscode-editor-findMatchBackground); }
body { font-family: var(--vscode-editor-font-family, system-ui); font-size: var(--reader-font-size);
  line-height: 1.7; max-width: 72ch; margin: 0 auto; padding: 1rem 1.5rem 6rem;
  color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
.block { margin: 0.6em 0; }
.block-code { opacity: 0.45; font-size: 0.85em; white-space: pre-wrap;
  border-left: 3px solid var(--vscode-panel-border); padding-left: 0.8em; }
span[data-w] { border-radius: 3px; cursor: pointer; }
span[data-w]:hover { outline: 1px solid var(--vscode-focusBorder); }
.sentence-active { background: var(--sentence-color); border-radius: 4px;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.word-active { background: var(--word-color); transition: background 80ms linear; }
#return-pill { position: fixed; bottom: 4.5rem; left: 50%; transform: translateX(-50%);
  padding: 0.4em 1em; border-radius: 999px; border: 1px solid var(--vscode-focusBorder);
  background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
#player-bar { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 0.5rem;
  align-items: center; padding: 0.5rem 1rem; flex-wrap: wrap;
  background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-panel-border); }
#player-bar button { background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px;
  padding: 0.3em 0.7em; cursor: pointer; }
#player-bar button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
#player-bar input[type="range"] { width: 90px; }
#player-status { margin-left: auto; opacity: 0.8; font-size: 0.85em; }
```

- [ ] **Step 4: Stub player-bar.ts so main.ts compiles (full version in Task 14)**

```typescript
// src/webview/player-bar.ts
export interface PlayerBarOptions {
  initialSpeed: number;
  onPlayPause(): void;
  onSpeed(rate: number): void;
  onPrevSentence(): void;
  onNextSentence(): void;
}
export interface PlayerBar {
  setState(state: "playing" | "paused" | "ended"): void;
  setPosition(sentenceIndex: number, totalSentences: number): void;
  showError(message: string): void;
}
export function initPlayerBar(opts: PlayerBarOptions): PlayerBar {
  return { setState() {}, setPosition() {}, showError(m) { console.error(m); } };
}
```

- [ ] **Step 5: Compile, run all tests, commit**

Run: `npm run compile && npm test`
Expected: both bundles build; all tests PASS.

```bash
git add src/webview/highlight.ts src/webview/main.ts src/webview/player-bar.ts media/reader.css
git commit -m "feat: webview wiring — highlight controller, click-to-jump, message handling"
```

---
### Task 12: Reader panel host

**Files:**
- Create: `src/ui/reader-panel.ts`

No unit tests (thin vscode wrapper); verified in Task 13 checkpoint.

- [ ] **Step 1: Implement reader-panel.ts**

```typescript
import * as vscode from "vscode";
import { DocumentModel } from "../core/document-model";
import { ChunkTimings } from "../core/timing";

export interface ReaderSettings { speed: number; fontSize: number; sentenceColor: string; wordColor: string }

export type ViewMsg =
  | { type: "ready" }
  | { type: "requestChunk"; chunkIndex: number; priority: boolean }
  | { type: "position"; wordIndex: number; sentenceIndex: number }
  | { type: "state"; state: "playing" | "paused" | "ended" }
  | { type: "speedChanged"; rate: number }
  | { type: "error"; message: string };

export class ReaderPanel {
  private panel: vscode.WebviewPanel;
  private ready = false;
  private pending: unknown[] = [];
  private _onMessage = new vscode.EventEmitter<ViewMsg>();
  readonly onMessage = this._onMessage.event;
  private _onDispose = new vscode.EventEmitter<void>();
  readonly onDispose = this._onDispose.event;

  constructor(extensionUri: vscode.Uri, title: string) {
    this.panel = vscode.window.createWebviewPanel(
      "speakittome.reader", `SpeakItToMe — ${title}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    const css = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "reader.css"));
    const js = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "reader.js"));
    const nonce = String(Math.random()).slice(2);
    this.panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}'; media-src blob:; img-src ${this.panel.webview.cspSource};">
<link rel="stylesheet" href="${css}"></head>
<body><div id="content"></div><div id="player-bar"></div>
<script nonce="${nonce}" src="${js}"></script></body></html>`;

    this.panel.webview.onDidReceiveMessage((msg: ViewMsg) => {
      if (msg.type === "ready") {
        this.ready = true;
        for (const m of this.pending.splice(0)) void this.panel.webview.postMessage(m);
      }
      this._onMessage.fire(msg);
    });
    this.panel.onDidDispose(() => this._onDispose.fire());
  }

  post(msg: unknown) {
    if (this.ready) void this.panel.webview.postMessage(msg);
    else this.pending.push(msg);
  }

  sendInit(model: DocumentModel, chunkCount: number, settings: ReaderSettings) {
    this.post({ type: "init", model, chunkCount, settings });
  }
  sendChunk(chunkIndex: number, audio: Uint8Array, format: string, timings: ChunkTimings) {
    this.post({ type: "chunkAudio", chunkIndex, audio, format, timings });
  }
  sendChunkFailed(chunkIndex: number, error: string) {
    this.post({ type: "chunkFailed", chunkIndex, error });
  }
  control(action: "pause" | "resume" | "stop") { this.post({ type: "control", action }); }
  seekToWord(wordIndex: number) { this.post({ type: "seekToWord", wordIndex }); }
  reveal() { this.panel.reveal(undefined, true); }
  dispose() { this.panel.dispose(); }
}
```

- [ ] **Step 2: Compile and commit**

Run: `npm run compile`
Expected: clean build.

```bash
git add src/ui/reader-panel.ts
git commit -m "feat: reader webview panel host with typed message protocol"
```

---

### Task 13: ReadingSession + extension wiring + SMOKE CHECKPOINT

**Files:**
- Rewrite: `src/extension.ts`

- [ ] **Step 1: Implement extension.ts**

```typescript
import * as vscode from "vscode";
import { parseDocument, DocumentModel } from "./core/document-model";
import { buildChunks, Chunk } from "./core/chunker";
import { SynthesisService } from "./synthesis/synthesis-service";
import { DiskCache } from "./synthesis/disk-cache";
import { EdgeProvider } from "./synthesis/edge";
import { TtsProvider } from "./synthesis/provider";
import { ReaderPanel, ReaderSettings } from "./ui/reader-panel";

let log: vscode.LogOutputChannel;

class ReadingSession {
  readonly model: DocumentModel;
  readonly chunks: Chunk[];
  readonly panel: ReaderPanel;
  private synthesis: SynthesisService;
  state: "playing" | "paused" | "ended" = "paused";
  position = { wordIndex: -1, sentenceIndex: -1 };

  constructor(
    readonly docUri: vscode.Uri,
    text: string,
    version: number,
    provider: TtsProvider,
    voice: string,
    cache: DiskCache,
    extensionUri: vscode.Uri,
    private onEvent: (s: ReadingSession) => void
  ) {
    this.model = parseDocument(text, docUri.toString(), version);
    this.chunks = buildChunks(this.model);
    this.synthesis = new SynthesisService(provider, voice, cache);
    this.panel = new ReaderPanel(extensionUri, vscode.workspace.asRelativePath(docUri));

    this.panel.onMessage(async (msg) => {
      switch (msg.type) {
        case "ready": {
          const cfg = vscode.workspace.getConfiguration("speakittome");
          const settings: ReaderSettings = {
            speed: cfg.get("speed", 1.0),
            fontSize: cfg.get("readerFontSize", 16),
            sentenceColor: cfg.get("highlight.sentenceColor", ""),
            wordColor: cfg.get("highlight.wordColor", ""),
          };
          this.panel.sendInit(this.model, this.chunks.length, settings);
          break;
        }
        case "requestChunk": {
          const chunk = this.chunks[msg.chunkIndex];
          if (!chunk) break;
          try {
            const a = await this.synthesis.request(chunk, msg.priority);
            this.panel.sendChunk(msg.chunkIndex, a.audio, a.format, a.timings);
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            log.error(`chunk ${msg.chunkIndex} failed: ${m}`);
            this.panel.sendChunkFailed(msg.chunkIndex, m);
          }
          break;
        }
        case "position":
          this.position = { wordIndex: msg.wordIndex, sentenceIndex: msg.sentenceIndex };
          this.onEvent(this);
          break;
        case "state":
          this.state = msg.state;
          this.onEvent(this);
          break;
        case "speedChanged":
          await vscode.workspace.getConfiguration("speakittome")
            .update("speed", msg.rate, vscode.ConfigurationTarget.Global);
          break;
        case "error":
          log.error(`webview: ${msg.message}`);
          break;
      }
    });
  }

  pauseResume() { this.panel.control(this.state === "playing" ? "pause" : "resume"); }
  jumpToWord(wordIndex: number) { this.panel.seekToWord(wordIndex); }
  dispose() { this.synthesis.abortAll(); this.panel.dispose(); }
}

let session: ReadingSession | undefined;

function makeProvider(): TtsProvider {
  // Task 21 expands this to elevenlabs/say/sarvam with key management
  return new EdgeProvider();
}

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("SpeakItToMe", { log: true });
  context.subscriptions.push(log);
  const cfg = () => vscode.workspace.getConfiguration("speakittome");

  async function startSession(editor: vscode.TextEditor) {
    session?.dispose();
    const provider = makeProvider();
    const voice = cfg().get<string>(`voice.${provider.id}`) || provider.defaultVoice;
    const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, "audio-cache").fsPath;
    const cache = new DiskCache(cacheDir, cfg().get<number>("cacheSizeMB", 200) * 1024 * 1024);
    session = new ReadingSession(
      editor.document.uri, editor.document.getText(), editor.document.version,
      provider, voice, cache, context.extensionUri, () => { /* Task 16/17 hook */ }
    );
    session.panel.onDispose(() => { session = undefined; });
  }

  const needEditor = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) void vscode.window.showWarningMessage("SpeakItToMe: no active editor");
    return editor;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("speakittome.readDocument", async () => {
      const editor = needEditor();
      if (editor) await startSession(editor);
    }),
    vscode.commands.registerCommand("speakittome.readFromCursor", async () => {
      const editor = needEditor();
      if (!editor) return;
      await startSession(editor);
      const offset = editor.document.offsetAt(editor.selection.active);
      const word = session!.model.words.find((w) => w.source.end > offset) ?? session!.model.words[0];
      if (word) session!.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("speakittome.readSelection", async () => {
      const editor = needEditor();
      if (!editor || editor.selection.isEmpty) return;
      await startSession(editor); // v1 parity: selection = start at selection, read on
      const offset = editor.document.offsetAt(editor.selection.start);
      const word = session!.model.words.find((w) => w.source.end > offset);
      if (word) session!.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("speakittome.pauseResume", () => session?.pauseResume()),
    vscode.commands.registerCommand("speakittome.stop", () => { session?.dispose(); session = undefined; }),
    vscode.commands.registerCommand("speakittome.openReader", () => session?.panel.reveal()),
    vscode.commands.registerCommand("speakittome.setApiKey", () =>
      vscode.window.showInformationMessage("SpeakItToMe: key management arrives with premium providers (Task 18+)")),
    vscode.commands.registerCommand("speakittome.selectProvider", () =>
      vscode.window.showInformationMessage("SpeakItToMe: provider picker arrives in Task 21")),
    vscode.commands.registerCommand("speakittome.selectVoice", () =>
      vscode.window.showInformationMessage("SpeakItToMe: voice picker arrives in Task 21")),
    { dispose() { session?.dispose(); } }
  );
  log.info("SpeakItToMe activated");
}

export function deactivate() {}
```

- [ ] **Step 2: Compile and run all tests**

Run: `npm run compile && npm test`
Expected: clean build, all tests PASS.

- [ ] **Step 3: SMOKE CHECKPOINT (manual, F5 Extension Development Host)**

Open the repo in VS Code, press F5, then in the dev host open a long markdown file and run "SpeakItToMe: Read Document". Verify ALL of:

1. Reader panel opens beside the editor with rendered prose (headings, paragraphs, dimmed code)
2. Audio starts within ~2s and reads continuously across paragraph boundaries
3. Sentence band + word sweep track the voice
4. Clicking a word later in the doc jumps there (first click into an unsynthesized region takes a beat, then plays)
5. `cmd+shift+r` pauses; resuming restarts the current sentence
6. Second run of the same document starts instantly (disk cache)

Fix anything broken before committing. This checkpoint validates the entire core loop; do not proceed past it red.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: reading session wiring — end-to-end core loop works"
```

---

### Task 14: Player bar (full version)

**Files:**
- Rewrite: `src/webview/player-bar.ts` (replace Task 11 stub; keep the exported interface IDENTICAL)

- [ ] **Step 1: Implement**

```typescript
export interface PlayerBarOptions {
  initialSpeed: number;
  onPlayPause(): void;
  onSpeed(rate: number): void;
  onPrevSentence(): void;
  onNextSentence(): void;
}
export interface PlayerBar {
  setState(state: "playing" | "paused" | "ended"): void;
  setPosition(sentenceIndex: number, totalSentences: number): void;
  showError(message: string): void;
}

const PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function initPlayerBar(opts: PlayerBarOptions): PlayerBar {
  const bar = document.getElementById("player-bar")!;
  bar.textContent = "";

  const btn = (label: string, onClick: () => void, title?: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    bar.appendChild(b);
    return b;
  };

  const prev = btn("⏮", opts.onPrevSentence, "Previous sentence");
  const playPause = btn("▶", opts.onPlayPause, "Play/Pause");
  const next = btn("⏭", opts.onNextSentence, "Next sentence");

  const speedButtons = new Map<number, HTMLButtonElement>();
  const slider = document.createElement("input");

  const setSpeedUI = (rate: number) => {
    for (const [r, b] of speedButtons) b.classList.toggle("active", Math.abs(r - rate) < 0.01);
    slider.value = String(rate);
  };
  const applySpeed = (rate: number) => { setSpeedUI(rate); opts.onSpeed(rate); };

  for (const r of PRESETS) speedButtons.set(r, btn(`${r}x`, () => applySpeed(r)));
  slider.type = "range"; slider.min = "0.5"; slider.max = "2"; slider.step = "0.05";
  slider.title = "Fine speed";
  slider.addEventListener("input", () => applySpeed(Number(slider.value)));
  bar.appendChild(slider);

  const status = document.createElement("span");
  status.id = "player-status";
  bar.appendChild(status);

  setSpeedUI(opts.initialSpeed);

  return {
    setState(state) {
      playPause.textContent = state === "playing" ? "⏸" : "▶";
      if (state === "ended") status.textContent = "Finished";
      prev.disabled = next.disabled = state === "ended";
    },
    setPosition(sentenceIndex, totalSentences) {
      status.textContent = `Sentence ${sentenceIndex + 1} / ${totalSentences}`;
    },
    showError(message) {
      status.textContent = `⚠ ${message}`;
    },
  };
}
```

- [ ] **Step 2: Compile, manual check, commit**

Run: `npm run compile`, then F5: presets and slider change speed instantly with pitch preserved (verify by ear at 2x), speed persists across VS Code restart (stored via `speakittome.speed`), prev/next sentence buttons jump.

```bash
git add src/webview/player-bar.ts
git commit -m "feat: player bar — transport, speed presets + fine slider, status"
```

---

### Task 15: Editor surface — decorations, Alt+click, follow

**Files:**
- Create: `src/ui/editor-sync.ts`
- Modify: `src/extension.ts` (wire into ReadingSession onEvent)

- [ ] **Step 1: Implement editor-sync.ts**

```typescript
import * as vscode from "vscode";
import { DocumentModel } from "../core/document-model";

export class EditorSync {
  private sentenceDeco: vscode.TextEditorDecorationType;
  private wordDeco: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private docUri: vscode.Uri,
    private model: DocumentModel,
    onAltClick: (wordIndex: number) => void
  ) {
    const cfg = vscode.workspace.getConfiguration("speakittome");
    const sentenceColor = cfg.get<string>("highlight.sentenceColor") || undefined;
    const wordColor = cfg.get<string>("highlight.wordColor") || undefined;
    this.sentenceDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: sentenceColor ?? new vscode.ThemeColor("editor.selectionHighlightBackground"),
      isWholeLine: false,
    });
    this.wordDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: wordColor ?? new vscode.ThemeColor("editor.findMatchBackground"),
      borderRadius: "3px",
    });

    const mode = cfg.get<string>("editorClickToJump", "alt-j");
    if (mode === "plain-click") {
      this.disposables.push(
        vscode.window.onDidChangeTextEditorSelection((e) => {
          if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
          if (e.textEditor.document.uri.toString() !== this.docUri.toString()) return;
          if (!e.selections[0]?.isEmpty) return;
          const idx = this.wordAtPosition(e.textEditor.document, e.selections[0].active);
          if (idx !== undefined) onAltClick(idx);
        })
      );
    }
  }

  // Called by the readFromWordAtCursor command (bound to alt+click via editor action)
  wordAtPosition(doc: vscode.TextDocument, pos: vscode.Position): number | undefined {
    const offset = doc.offsetAt(pos);
    const word = this.model.words.find((w) => w.source.end > offset && w.source.start <= offset)
      ?? this.model.words.find((w) => w.source.start >= offset);
    return word?.index;
  }

  highlight(sentenceIndex: number, wordIndex: number, follow: boolean) {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.docUri.toString()
    );
    if (!editor) return;
    const doc = editor.document;
    const s = this.model.sentences[sentenceIndex];
    const w = this.model.words[wordIndex];
    if (!s || !w) return;
    const toRange = (o: { start: number; end: number }) =>
      new vscode.Range(doc.positionAt(o.start), doc.positionAt(o.end));
    editor.setDecorations(this.sentenceDeco, [toRange(s.source)]);
    editor.setDecorations(this.wordDeco, [toRange(w.source)]);
    if (follow) editor.revealRange(toRange(s.source), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose() {
    this.sentenceDeco.dispose();
    this.wordDeco.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
```

**Alt+click mechanism (the reliable way):** VS Code selection events don't expose modifier keys, and Alt+click is multi-cursor by default. The dependable approach is a command + keybinding on mouse position: register `speakittome.jumpToCursor` and document `alt+cmd+j` (configurable) as the "jump playback to cursor" gesture, PLUS treat any plain mouse click as a jump only when the setting `speakittome.editorClickToJump` is set to `"plain-click"` mode. Implement:

In `package.json` keybindings, add:

```json
{ "command": "speakittome.jumpToCursor", "key": "alt+j", "mac": "alt+j", "when": "editorTextFocus" }
```

Change the `speakittome.editorClickToJump` setting to:

```json
"speakittome.editorClickToJump": {
  "type": "string", "default": "alt-j",
  "enum": ["off", "alt-j", "plain-click"],
  "description": "How to jump playback from the source editor: keyboard gesture on cursor (alt-j), any plain click while a session plays (plain-click), or off."
}
```

In `extension.ts` register:

```typescript
    vscode.commands.registerCommand("speakittome.jumpToCursor", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !session) return;
      const idx = session.editorSync?.wordAtPosition(editor.document, editor.selection.active);
      if (idx !== undefined) session.jumpToWord(idx);
    }),
```

(The plain-click selection listener is already in the constructor code above, gated on `mode === "plain-click"`.)

- [ ] **Step 2: Wire into ReadingSession**

In `extension.ts`: add `editorSync` to ReadingSession; construct it in the constructor; in the `position` message case call `this.editorSync.highlight(msg.sentenceIndex, msg.wordIndex, true)`; dispose it in `dispose()`. The onAltClick callback is `(idx) => this.jumpToWord(idx)`.

Document edit handling (spec: pause + re-anchor): in ReadingSession constructor add

```typescript
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== docUri.toString() || e.contentChanges.length === 0) return;
        this.panel.control("pause");
        void vscode.window
          .showInformationMessage("SpeakItToMe: document changed — restart from current position?", "Restart here", "Stop")
          .then((choice) => {
            if (choice === "Restart here") {
              void vscode.commands.executeCommand("speakittome.readFromCursor");
            } else if (choice === "Stop") {
              void vscode.commands.executeCommand("speakittome.stop");
            }
          });
      })
    );
```

(ReadingSession gains a `private disposables: vscode.Disposable[] = []`, disposed in `dispose()`.)

- [ ] **Step 3: Compile, manual check, commit**

Run: `npm run compile`, F5: editor shows sentence+word decorations in sync with the reader; alt+j on a paragraph jumps playback; editing the doc pauses with the restart prompt.

```bash
git add src/ui/editor-sync.ts src/extension.ts package.json
git commit -m "feat: editor sync — decorations, jump-to-cursor, edit handling"
```

---

### Task 16: Status bar

**Files:**
- Create: `src/ui/status-bar.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Implement status-bar.ts**

```typescript
import * as vscode from "vscode";

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "speakittome.pauseResume";
  }

  update(state: "playing" | "paused" | "ended", speed: number, sentence: number, total: number) {
    const icon = state === "playing" ? "$(debug-pause)" : "$(play)";
    this.item.text = `${icon} ${speed}x · ${sentence + 1}/${total}`;
    this.item.tooltip = "SpeakItToMe: click to pause/resume";
    this.item.show();
  }

  hide() { this.item.hide(); }
  dispose() { this.item.dispose(); }
}
```

- [ ] **Step 2: Wire into extension.ts**

Create one `StatusBar` in `activate` (push to subscriptions). In the session `onEvent` callback (constructor argument used in `position`/`state` cases), call:

```typescript
    statusBar.update(s.state, vscode.workspace.getConfiguration("speakittome").get("speed", 1), s.position.sentenceIndex, s.model.sentences.length);
```

On session dispose / stop: `statusBar.hide()`.

- [ ] **Step 3: Compile, manual check, commit**

Run: `npm run compile`, F5: status bar shows play state, speed, and sentence progress; clicking it toggles pause.

```bash
git add src/ui/status-bar.ts src/extension.ts
git commit -m "feat: status bar playback indicator"
```

---
### Task 17: API key manager (slim)

**Files:**
- Create: `src/ui/api-key-manager.ts`

- [ ] **Step 1: Implement**

```typescript
import * as vscode from "vscode";

const KEY_NAMES: Record<string, string> = {
  elevenlabs: "speakittome.key.elevenlabs",
  sarvam: "speakittome.key.sarvam",
};

export class ApiKeyManager {
  constructor(private secrets: vscode.SecretStorage) {}

  async getKey(providerId: string): Promise<string | undefined> {
    const name = KEY_NAMES[providerId];
    return name ? this.secrets.get(name) : undefined;
  }

  async promptAndStore(providerId: string): Promise<string | undefined> {
    const name = KEY_NAMES[providerId];
    if (!name) return undefined;
    const value = await vscode.window.showInputBox({
      prompt: `Enter your ${providerId} API key`,
      password: true,
      ignoreFocusOut: true,
    });
    if (value) await this.secrets.store(name, value.trim());
    return value?.trim() || undefined;
  }
}
```

- [ ] **Step 2: Compile, commit**

Run: `npm run compile`

```bash
git add src/ui/api-key-manager.ts
git commit -m "feat: slim SecretStorage api key manager"
```

---

### Task 18: ElevenLabs provider (with-timestamps)

**Files:**
- Create: `src/synthesis/elevenlabs.ts`

- [ ] **Step 1: Implement**

```typescript
import { Chunk } from "../core/chunker";
import { timingsFromCharAlignment } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsProvider implements TtsProvider {
  readonly id = "elevenlabs";
  readonly label = "ElevenLabs";
  readonly requiresKey = true;
  readonly timingQuality = "exact" as const;
  readonly maxCharsPerRequest = 5000;
  readonly defaultVoice = "21m00Tcm4TlvDq8ikWAM"; // Rachel

  constructor(private apiKey: string) {}

  async listVoices(): Promise<VoiceInfo[]> {
    try {
      const res = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": this.apiKey } });
      if (!res.ok) return [{ id: this.defaultVoice, label: "Rachel" }];
      const data = (await res.json()) as { voices: { voice_id: string; name: string }[] };
      return data.voices.map((v) => ({ id: v.voice_id, label: v.name }));
    } catch {
      return [{ id: this.defaultVoice, label: "Rachel" }];
    }
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const res = await fetch(`${BASE}/text-to-speech/${voice}/with-timestamps`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "xi-api-key": this.apiKey },
      body: JSON.stringify({ text: chunk.text, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      audio_base64: string;
      alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
    };
    const audio = new Uint8Array(Buffer.from(data.audio_base64, "base64"));
    const timings = timingsFromCharAlignment(
      chunk, data.alignment.characters,
      data.alignment.character_start_times_seconds, data.alignment.character_end_times_seconds
    );
    return { audio, format: "mp3", timings };
  }
}
```

- [ ] **Step 2: Compile, run tests, commit**

Run: `npm run compile && npm test`

```bash
git add src/synthesis/elevenlabs.ts
git commit -m "feat: ElevenLabs provider via with-timestamps endpoint"
```

---

### Task 19: macOS say provider + WAV duration

**Files:**
- Create: `src/synthesis/say.ts`
- Test: `src/synthesis/say.test.ts` (the pure WAV parser only)

- [ ] **Step 1: Write failing test for wavDurationMs**

```typescript
import { describe, it, expect } from "vitest";
import { wavDurationMs } from "./say";

function makeWav(dataBytes: number, byteRate: number): Uint8Array {
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(22050, 24); buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buf);
}

describe("wavDurationMs", () => {
  it("computes duration from data size and byte rate", () => {
    expect(wavDurationMs(makeWav(44100, 44100))).toBe(1000);
    expect(wavDurationMs(makeWav(22050, 44100))).toBe(500);
  });
  it("returns undefined for non-wav bytes", () => {
    expect(wavDurationMs(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/synthesis/say.test.ts`
Expected: FAIL — cannot resolve `./say`.

- [ ] **Step 3: Implement say.ts**

```typescript
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Chunk } from "../core/chunker";
import { estimatedTimings } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const run = promisify(execFile);

export function wavDurationMs(bytes: Uint8Array): number | undefined {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return undefined;
  const byteRate = buf.readUInt32LE(28);
  // find the data chunk (it isn't always at offset 36)
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return byteRate > 0 ? Math.round((size / byteRate) * 1000) : undefined;
    off += 8 + size + (size % 2);
  }
  return undefined;
}

export class SayProvider implements TtsProvider {
  readonly id = "say";
  readonly label = "macOS say (offline)";
  readonly requiresKey = false;
  readonly timingQuality = "estimated" as const;
  readonly maxCharsPerRequest = 20000;
  readonly defaultVoice = "Samantha";

  async listVoices(): Promise<VoiceInfo[]> {
    try {
      const { stdout } = await run("say", ["-v", "?"]);
      return stdout.split("\n").flatMap((line) => {
        const m = line.match(/^([\w ()-]+?)\s{2,}([a-z]{2}[-_]\w+)/);
        return m && m[2].startsWith("en") ? [{ id: m[1].trim(), label: m[1].trim() }] : [];
      });
    } catch {
      return [{ id: "Samantha", label: "Samantha" }];
    }
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const out = join(tmpdir(), `speakittome-say-${Date.now()}-${chunk.index}.wav`);
    try {
      await run(
        "say",
        ["-v", voice, "-o", out, "--file-format=WAVE", "--data-format=LEI16@22050", chunk.text],
        { signal }
      );
      const audio = new Uint8Array(await fs.readFile(out));
      return { audio, format: "wav", timings: estimatedTimings(chunk) };
    } finally {
      await fs.rm(out, { force: true });
    }
  }
}
```

- [ ] **Step 4: Run, verify green (wav tests), manual smoke on a Mac**

Run: `npx vitest run src/synthesis/say.test.ts`
Expected: PASS (2 tests).
Manual (macOS): temporarily set provider to say in Task 21's picker once built, or run a one-off tsx script mirroring `scripts/smoke-edge.ts` with `SayProvider`.

- [ ] **Step 5: Commit**

```bash
git add src/synthesis/say.ts src/synthesis/say.test.ts
git commit -m "feat: macOS say provider with estimated timings + wav duration parser"
```

---

### Task 20: Sarvam provider (port)

**Files:**
- Create: `src/synthesis/sarvam.ts`

- [ ] **Step 1: Implement (port of v1, minus pace, estimated timings)**

```typescript
import { Chunk } from "../core/chunker";
import { estimatedTimings } from "../core/timing";
import { ChunkAudio, TtsProvider, VoiceInfo } from "./provider";

const URL = "https://api.sarvam.ai/text-to-speech";
const VOICES = ["shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja",
  "rohan", "simran", "kavya", "amit", "dev", "ishita", "shreya"];

export class SarvamProvider implements TtsProvider {
  readonly id = "sarvam";
  readonly label = "Sarvam AI";
  readonly requiresKey = true;
  readonly timingQuality = "estimated" as const;
  readonly maxCharsPerRequest = 2500;
  readonly defaultVoice = "shubh";

  constructor(private apiKey: string) {}

  async listVoices(): Promise<VoiceInfo[]> {
    return VOICES.map((v) => ({ id: v, label: v[0].toUpperCase() + v.slice(1) }));
  }

  async synthesize(chunk: Chunk, voice: string, signal: AbortSignal): Promise<ChunkAudio> {
    const res = await fetch(URL, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "api-subscription-key": this.apiKey },
      body: JSON.stringify({
        text: chunk.text.slice(0, this.maxCharsPerRequest),
        target_language_code: "en-IN", model: "bulbul:v3", speaker: voice,
        output_audio_codec: "mp3", speech_sample_rate: 24000,
      }),
    });
    if (!res.ok) throw new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { audios: string[] };
    if (!data.audios?.length) throw new Error("Sarvam returned no audio");
    return {
      audio: new Uint8Array(Buffer.from(data.audios[0], "base64")),
      format: "mp3",
      timings: estimatedTimings(chunk),
    };
  }
}
```

Note: Sarvam's 2500-char cap is below the default chunk max (2200) — fine. The `.slice` guard stays for oversized single sentences.

- [ ] **Step 2: Compile, commit**

Run: `npm run compile && npm test`

```bash
git add src/synthesis/sarvam.ts
git commit -m "feat: Sarvam provider port with estimated timings"
```

---

### Task 21: Provider/voice pickers + full provider wiring

**Files:**
- Modify: `src/extension.ts` (replace `makeProvider` and the three stub commands)

- [ ] **Step 1: Implement provider factory with key management**

```typescript
import { ElevenLabsProvider } from "./synthesis/elevenlabs";
import { SayProvider } from "./synthesis/say";
import { SarvamProvider } from "./synthesis/sarvam";
import { ApiKeyManager } from "./ui/api-key-manager";

async function makeProvider(keys: ApiKeyManager): Promise<TtsProvider | undefined> {
  const id = vscode.workspace.getConfiguration("speakittome").get<string>("provider", "edge");
  switch (id) {
    case "edge": return new EdgeProvider();
    case "say":
      if (process.platform !== "darwin") {
        void vscode.window.showWarningMessage("SpeakItToMe: macOS say is only available on macOS");
        return undefined;
      }
      return new SayProvider();
    case "elevenlabs": {
      const key = (await keys.getKey("elevenlabs")) ?? (await keys.promptAndStore("elevenlabs"));
      return key ? new ElevenLabsProvider(key) : undefined;
    }
    case "sarvam": {
      const key = (await keys.getKey("sarvam")) ?? (await keys.promptAndStore("sarvam"));
      return key ? new SarvamProvider(key) : undefined;
    }
    default: return new EdgeProvider();
  }
}
```

In `activate`: `const keys = new ApiKeyManager(context.secrets);` and `startSession` becomes:

```typescript
    const provider = await makeProvider(keys);
    if (!provider) return;
```

- [ ] **Step 2: Implement the three commands**

```typescript
    vscode.commands.registerCommand("speakittome.selectProvider", async () => {
      const items = [
        { id: "edge", label: "Edge TTS", description: "free · word-level timing" },
        { id: "elevenlabs", label: "ElevenLabs", description: "premium · word-level timing · key required" },
        ...(process.platform === "darwin"
          ? [{ id: "say", label: "macOS say", description: "offline · estimated timing" }] : []),
        { id: "sarvam", label: "Sarvam AI", description: "Indian English · estimated timing · key required" },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: "SpeakItToMe TTS provider" });
      if (pick) await cfg().update("provider", pick.id, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("speakittome.selectVoice", async () => {
      const provider = await makeProvider(keys);
      if (!provider) return;
      const voices = await provider.listVoices();
      const pick = await vscode.window.showQuickPick(
        voices.map((v) => ({ label: v.label, description: v.id })),
        { placeHolder: `Voice for ${provider.label}` }
      );
      if (pick) await cfg().update(`voice.${provider.id}`, pick.description, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("speakittome.setApiKey", async () => {
      const pick = await vscode.window.showQuickPick(["elevenlabs", "sarvam"], { placeHolder: "Provider" });
      if (pick) await keys.promptAndStore(pick);
    }),
```

- [ ] **Step 3: Compile, manual check, commit**

Run: `npm run compile`, F5: switch provider to each available one and read a short doc. Edge and ElevenLabs show tight word sync; say/sarvam show approximate word sweep with exact sentence bands.

```bash
git add src/extension.ts
git commit -m "feat: provider/voice pickers, key prompts, full provider wiring"
```

---

### Task 22: Docs, E2E pass, package

**Files:**
- Rewrite: `README.md`
- Modify: `CHANGELOG.md`
- Delete: `PLAN.md` (superseded by spec + this plan)

- [ ] **Step 1: Rewrite README.md**

Cover, in this order: what SpeakItToMe is (one paragraph + the four core features), install (VSIX for now), quick start (open a markdown file → "SpeakItToMe: Read Document"), the reader panel (click any word to jump, scroll freely + return pill), speed (presets + slider, pitch preserved), providers table (edge/elevenlabs/say/sarvam with timing quality and key requirements), editor surface (`alt+j` jump-to-cursor, `speakittome.editorClickToJump` modes), all settings with defaults, keybindings (`cmd+shift+r`, `alt+j`), and a troubleshooting section (Edge TTS needs network; say is macOS-only; ElevenLabs free tier may 401 on TTS).

- [ ] **Step 2: Update CHANGELOG.md**

```markdown
## 0.2.0 — SpeakItToMe

Ground-up rebuild. Renamed read-vscode-tts → SpeakItToMe.

- Reader panel: rendered reading view with word-level karaoke highlighting
- Click any word to jump playback (alt+j from the source editor)
- Continuous chunked audio (no more per-sentence gaps)
- Speed 0.5–2x, pitch preserved, instant, persisted
- Resume restarts the current sentence
- Providers: Edge TTS (default, free), ElevenLabs, macOS say, Sarvam
- Persistent disk cache (default 200 MB) — re-reads cost no API credits
- Editor decorations stay in sync; auto-scroll with return-to-playback pill
```

```bash
git rm PLAN.md
```

- [ ] **Step 3: Full E2E manual pass (Extension Development Host)**

Run every line; all must pass:

1. Read Document on a 2000+ word markdown file: continuous audio, no gaps at paragraph bounds
2. Word sweep tracks voice at 1x and 2x (2x: no chipmunk pitch)
3. Click word far ahead → jumps within ~3s (synthesis) or instantly (cached)
4. `alt+j` in editor jumps; decorations track in editor; reader + editor agree
5. Pause (`cmd+shift+r`, status bar, player) → resume restarts sentence
6. Scroll up mid-read → playback continues, pill appears → click pill → view returns
7. Speed buttons + slider: instant, persisted after reload
8. Reload window, re-read same doc → instant start (disk cache)
9. Switch to each provider and read a paragraph
10. Edit the doc mid-read → pauses with restart prompt; both choices work
11. Read Selection and Read from Cursor start at the right place
12. Code blocks: dimmed in reader, skipped by narration, editor decorations never enter them

- [ ] **Step 4: Run full test suite + package**

Run: `npm test && npm run package`
Expected: all tests pass; `speakittome-0.2.0.vsix` produced. Install it (`code --install-extension speakittome-0.2.0.vsix`) and spot-check items 1–3 in regular VS Code (catches CSP/packaging issues the dev host hides).

- [ ] **Step 5: Final commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: SpeakItToMe 0.2.0 README + changelog; E2E pass; package VSIX"
```

---

## Deferred (explicitly out of scope, matches spec)

- Repo folder rename `read-vscode-tts` → `speakittome` (do after the plan completes, it breaks paths mid-work)
- Marketplace publish (trademark check first)
- OpenAI/Azure/Kokoro providers, cross-document queue, audio export
- Full exponential backoff on 429s (the spec mentions it; Task 8 implements retry-once, which is enough for Edge/say and typical ElevenLabs use — add backoff only if rate limits bite in practice)

