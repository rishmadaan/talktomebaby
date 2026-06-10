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
