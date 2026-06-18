// clean-text.ts - turn assistant markdown into something pleasant to hear.
//
// Speaking raw markdown aloud is unbearable: code blocks, URLs, table pipes and
// heading hashes all get read out. This module strips markdown down to plain
// prose, then applies a scope (full vs first-paragraph) and a hard length cap.
//
// Pure and dependency-free so it can be unit-tested in isolation.

export const CODE_PLACEHOLDER = " (code block omitted) ";

// Strip markdown to speakable prose. Order matters: remove fenced code first
// (before any inline handling), then links, then line-level and inline markers.
export function stripMarkdown(text: unknown): string {
  let out = String(text == null ? "" : text);

  // Fenced code blocks ``` ... ``` (and ~~~ fences) -> placeholder.
  out = out.replace(/```[\s\S]*?```/g, CODE_PLACEHOLDER);
  out = out.replace(/~~~[\s\S]*?~~~/g, CODE_PLACEHOLDER);

  // Images ![alt](url) -> alt (do before links so the ! is consumed).
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links [text](url) -> text.
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Inline code `x` -> x (keep the words).
  out = out.replace(/`([^`]*)`/g, "$1");

  // Line-level markers at the start of a line.
  out = out
    .split("\n")
    .map((line) => {
      let l = line;
      l = l.replace(/^\s*#{1,6}\s+/, ""); // headings
      l = l.replace(/^\s*>\s?/, ""); // blockquotes
      l = l.replace(/^\s*[-*+]\s+/, ""); // bullet lists
      l = l.replace(/^\s*\d+[.)]\s+/, ""); // numbered lists
      l = l.replace(/^\s*\|/, "").replace(/\|\s*$/, ""); // table edge pipes
      return l;
    })
    .join("\n");

  // Table separator rows like |---|---| or ---|--- -> drop.
  out = out.replace(/^[\s|:-]+$/gm, "");

  // Remaining table pipes -> comma so columns are spoken with a pause.
  out = out.replace(/\s*\|\s*/g, ", ");

  // Emphasis / strikethrough markers (leave the words).
  out = out.replace(/(\*\*|\*|__|_|~~)(\S[\s\S]*?\S|\S)\1/g, "$2");

  // Horizontal rules.
  out = out.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");

  // Collapse 3+ newlines to a paragraph break, then collapse whitespace.
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out
    .split("\n\n")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");

  return out.trim();
}

// Keep only the first paragraph (text up to the first blank-line break).
export function firstParagraph(text: unknown): string {
  const parts = String(text).split(/\n\n+/);
  return (parts[0] || "").trim();
}

// Truncate at a word boundary, appending an ellipsis when cut.
export function capLength(text: unknown, maxChars?: number): string {
  const s = String(text);
  if (!maxChars || s.length <= maxChars) return s;
  const slice = s.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + " …";
}

export interface CleanForSpeechOptions {
  scope?: "full" | "first-paragraph";
  maxChars?: number;
}

// Full pipeline: strip -> scope -> cap. scope is "full" | "first-paragraph".
export function cleanForSpeech(text: unknown, { scope = "full", maxChars = 4000 }: CleanForSpeechOptions = {}): string {
  let out = stripMarkdown(text);
  if (scope === "first-paragraph") out = firstParagraph(out);
  out = capLength(out, maxChars);
  return out;
}
