/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { parseDocument, buildChunks } from "@talktomebaby/engine/core";

const posted: { type: string }[] = [];

beforeAll(async () => {
  vi.useFakeTimers(); // main.ts starts a tick interval
  document.body.innerHTML = `<div id="content"></div><div id="player-bar"></div>`;
  (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({ postMessage: (m: { type: string }) => posted.push(m) });
  await import("./main");
});

function init(text: string) {
  const model = parseDocument(text, "t.md", 1);
  posted.length = 0;
  window.dispatchEvent(new MessageEvent("message", { data: {
    type: "init", model, chunks: buildChunks(model, undefined, undefined, 0),
    settings: { speed: 1, fontSize: 16, sentenceColor: "", wordColor: "" }, gen: 4, startAtWord: 0, autoplay: true,
  } }));
}

describe("webview init", () => {
  it.each([["blank", "   \n\n  \n"], ["code-only", "```\nconst x = 1;\n```\n"]])(
    "a %s document requests no audio and says there is nothing to read", (_, text) => {
      init(text);
      expect(posted.map((m) => m.type)).not.toContain("requestChunk");
      expect(document.getElementById("player-status")!.textContent).toBe("Nothing to read.");
    });

  it("a document with words starts reading from the top", () => {
    init("Hello there. Second sentence.");
    expect(posted).toContainEqual({ type: "requestChunk", chunkIndex: 0, priority: true, gen: 4 }); // echoes init's gen
    expect(document.getElementById("player-status")!.textContent).toBe("Loading…");
  });

  it("seeks while the audio is loading keep \"Loading…\"; the last one's sentence shows when loading ends", () => {
    init("One fish here. Two fish there. Red fish now.");
    const status = document.getElementById("player-status")!;
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }));
    send({ type: "seekToWord", wordIndex: 3 });   // "Two", sentence 2
    send({ type: "seekToWord", wordIndex: 6 });   // "Red", sentence 3
    expect(status.textContent).toBe("Loading…");
    send({ type: "control", action: "pause" });
    expect(status.textContent).toBe("Sentence 3 / 3");
  });

  it("a failed chunk's error stays when loading ends", () => {
    init("One fish here. Two fish there.");
    window.dispatchEvent(new MessageEvent("message", { data: { type: "chunkFailed", chunkIndex: 0, error: "boom" } }));
    expect(document.getElementById("player-status")!.textContent).toBe("⚠ Couldn't synthesize part 1: boom");
  });
});
