// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderModel } from "./renderer";
import { parseDocument } from "@talktomebaby/engine/core";

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
