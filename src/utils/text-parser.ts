import * as vscode from "vscode";

export interface SentenceInfo {
  text: string; // Clean text for TTS (markdown stripped)
  range: vscode.Range; // Original range in the document (for highlighting)
}

/**
 * Strip markdown formatting from text, keeping the readable content.
 */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove frontmatter
      .replace(/^---[\s\S]*?---\n*/m, "")
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "")
      // Remove headings markers (keep text)
      .replace(/^#{1,6}\s+/gm, "")
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Remove links (keep text)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Remove bold/italic markers
      .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, "$2")
      // Remove strikethrough
      .replace(/~~(.+?)~~/g, "$1")
      // Remove blockquote markers
      .replace(/^>\s+/gm, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Remove HTML tags
      .replace(/<[^>]+>/g, "")
      // Collapse multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Split text into sentences. Returns sentence boundaries respecting
 * common abbreviations and edge cases.
 */
function splitIntoSentences(text: string): string[] {
  // Common abbreviations to not split on
  const abbrevPattern =
    /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|i\.e|e\.g|a\.m|p\.m)\./gi;

  // Temporarily replace abbreviation dots
  const placeholder = "\u0000";
  let processed = text.replace(abbrevPattern, (match) =>
    match.replace(/\./g, placeholder)
  );

  // Split on sentence-ending punctuation followed by whitespace or end
  const sentences = processed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(new RegExp(placeholder, "g"), ".").trim())
    .filter((s) => s.length > 0);

  return sentences;
}

/**
 * Parse a VS Code document into sentence infos with both clean text
 * and original document ranges for highlighting.
 */
export function parseDocument(
  document: vscode.TextDocument
): SentenceInfo[] {
  const fullText = document.getText();
  const results: SentenceInfo[] = [];

  // Work line-by-line to build paragraph blocks, then split into sentences
  const lines = fullText.split("\n");
  let blockStart = -1;
  let blockLines: string[] = [];
  let inCodeBlock = false;

  function flushBlock(endLine: number) {
    if (blockLines.length === 0) return;

    const rawBlock = blockLines.join("\n");
    const cleanBlock = stripMarkdown(rawBlock);
    if (cleanBlock.trim().length === 0) {
      blockLines = [];
      blockStart = -1;
      return;
    }

    const sentences = splitIntoSentences(cleanBlock);

    // Map sentences back to document ranges
    // Use the entire block range for simple mapping
    const startPos = new vscode.Position(blockStart, 0);
    const endPos = new vscode.Position(
      endLine,
      lines[endLine]?.length ?? 0
    );

    if (sentences.length === 1) {
      results.push({
        text: sentences[0],
        range: new vscode.Range(startPos, endPos),
      });
    } else {
      // For multi-sentence blocks, try to find each sentence in the original text
      let searchOffset = document.offsetAt(startPos);
      for (const sentence of sentences) {
        // Find the first few words of the sentence in the original text
        const searchWords = sentence.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(searchWords.split(/\s+/).slice(0, 5).join("\\s+"), "i");
        const remaining = fullText.slice(searchOffset);
        const match = remaining.match(pattern);

        if (match && match.index !== undefined) {
          const sentenceStart = searchOffset + match.index;
          // Estimate end by sentence length (approximate)
          const sentenceEnd = Math.min(
            sentenceStart + sentence.length + 20,
            fullText.length
          );

          const sRange = new vscode.Range(
            document.positionAt(sentenceStart),
            document.positionAt(sentenceEnd)
          );
          results.push({ text: sentence, range: sRange });
          searchOffset = sentenceStart + match[0].length;
        } else {
          // Fallback: use entire block range
          results.push({ text: sentence, range: new vscode.Range(startPos, endPos) });
        }
      }
    }

    blockLines = [];
    blockStart = -1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks to skip them
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        inCodeBlock = false;
      } else {
        flushBlock(Math.max(0, i - 1));
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) continue;

    // Skip horizontal rules
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushBlock(Math.max(0, i - 1));
      continue;
    }

    // Empty line = paragraph boundary
    if (line.trim().length === 0) {
      flushBlock(Math.max(0, i - 1));
      continue;
    }

    // Headings are their own block
    if (/^#{1,6}\s+/.test(line)) {
      flushBlock(Math.max(0, i - 1));
      blockStart = i;
      blockLines = [line];
      flushBlock(i);
      continue;
    }

    // Accumulate lines into current block
    if (blockStart === -1) blockStart = i;
    blockLines.push(line);
  }

  // Flush any remaining block
  flushBlock(lines.length - 1);

  return results;
}

/**
 * Parse a text selection into sentence infos.
 */
export function parseSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection
): SentenceInfo[] {
  const text = document.getText(selection);
  const clean = stripMarkdown(text);
  const sentences = splitIntoSentences(clean);

  // For selections, map all sentences to the selection range
  // (simpler than full document mapping)
  return sentences.map((s) => ({
    text: s,
    range: new vscode.Range(selection.start, selection.end),
  }));
}
