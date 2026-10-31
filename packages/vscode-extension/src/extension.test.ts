/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { describe, it, expect, vi } from "vitest";
import type { DiskCache, TtsProvider } from "@talktomebaby/engine";
import type { Chunk } from "@talktomebaby/engine/core";

// A stand-in for the VS Code API: one webview panel whose incoming messages the
// test sends and whose outgoing posts it records.
const view = vi.hoisted(() => ({ send: (_m: unknown) => {}, posted: [] as { type: string; [k: string]: unknown }[] }));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  class EventEmitter<T> {
    private fns: ((e: T) => void)[] = [];
    event = (fn: (e: T) => void) => { this.fns.push(fn); return disposable; };
    fire(e: T) { for (const fn of this.fns) fn(e); }
  }
  return {
    EventEmitter, ThemeColor: class {}, ViewColumn: { Beside: 2 }, Uri: { joinPath: () => ({}) },
    workspace: {
      getConfiguration: () => ({ get: (_k: string, d?: unknown) => d }),
      asRelativePath: () => "doc.md", onDidChangeTextDocument: () => disposable,
    },
    window: {
      visibleTextEditors: [], createTextEditorDecorationType: () => disposable,
      createWebviewPanel: () => ({
        webview: {
          cspSource: "", html: "", asWebviewUri: () => "",
          postMessage: async (m: { type: string }) => { view.posted.push(m); return true; },
          onDidReceiveMessage: (fn: (m: unknown) => void) => { view.send = fn; return disposable; },
        },
        onDidDispose: () => disposable, reveal() {}, dispose() {},
      }),
    },
  };
});

import { ReadingSession } from "./extension";

function provider(id: string) {
  const texts: string[] = [];
  const p: TtsProvider = {
    id, label: id, requiresKey: false, timingQuality: "exact", maxCharsPerRequest: 5000, defaultVoice: "v",
    listVoices: async () => [],
    synthesize: async (chunk: Chunk) => {
      texts.push(chunk.text);
      return { audio: new Uint8Array(1), format: "mp3", timings: { unit: "ms", words: [] } };
    },
  };
  return { p, texts };
}

const noCache = { get: async () => undefined, set: async () => {} } as unknown as DiskCache;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("ReadingSession", () => {
  it("after a voice switch, the old webview's late prefetch synthesizes nothing with the new voice", async () => {
    const oldVoice = provider("old"), newVoice = provider("new");
    const session = new ReadingSession(
      { toString: () => "file:///doc.md" } as never,
      "One fish here. Two fish there. Red fish now. Blue fish last.", 1,
      oldVoice.p, "v", noCache, {} as never, () => {}, async () => {},
      () => 3 // Read from Here at "Two"
    );
    view.send({ type: "ready" });
    expect(view.posted[0]).toMatchObject({ type: "init", gen: 0, startAtWord: 3 });

    view.send({ type: "requestChunk", chunkIndex: 1, priority: true, gen: 0 });
    await settle();
    expect(oldVoice.texts).toEqual(["Two fish there."]);

    await session.reconfigure(newVoice.p, "v2");   // paused switch: primes chunk 1 only
    expect(view.posted.at(-1)).toMatchObject({ type: "init", gen: 1, startAtWord: 3, autoplay: false });
    const postedBefore = view.posted.length;

    // The old webview's prefetch and a tick, sent before it received the new init, arrive late.
    view.send({ type: "requestChunk", chunkIndex: 2, priority: false, gen: 0 });
    view.send({ type: "position", wordIndex: 8, sentenceIndex: 2, gen: 0 });
    view.send({ type: "requestChunk", chunkIndex: 1, priority: true, gen: 1 }); // the new webview's prime
    await settle();

    expect(newVoice.texts).toEqual(["Two fish there."]);
    expect(oldVoice.texts).toEqual(["Two fish there."]);
    expect(view.posted.slice(postedBefore).map((m) => [m.type, m.chunkIndex])).toEqual([["chunkAudio", 1]]);
    expect(session.position).toEqual({ wordIndex: 3, sentenceIndex: 1 });
  });
});
