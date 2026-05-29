import * as vscode from "vscode";

export interface SentenceInfo {
  text: string;
  range: vscode.Range;
}

interface CleanText {
  text: string;
  offsets: number[];
}

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

const ABBREVIATION_PATTERN =
  /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|i\.e|e\.g|a\.m|p\.m)\./gi;
const DOT_PLACEHOLDER = "\u0000";

function splitIntoSentenceSpans(text: string): SentenceSpan[] {
  const processed = text.replace(ABBREVIATION_PATTERN, (match) =>
    match.replace(/\./g, DOT_PLACEHOLDER)
  );
  const spans: SentenceSpan[] = [];
  let start = 0;

  for (let i = 0; i < processed.length; i++) {
    if (!/[.!?]/.test(processed[i])) continue;

    let end = i + 1;
    while (end < processed.length && /["')\]]/.test(processed[end])) {
      end++;
    }

    if (end < processed.length && !/\s/.test(processed[end])) {
      continue;
    }

    pushTrimmedSpan(text, spans, start, end);
    while (end < processed.length && /\s/.test(processed[end])) {
      end++;
    }
    start = end;
    i = end - 1;
  }

  pushTrimmedSpan(text, spans, start, text.length);
  return spans;
}

function pushTrimmedSpan(
  source: string,
  spans: SentenceSpan[],
  start: number,
  end: number
) {
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;

  if (start < end) {
    spans.push({
      text: source.slice(start, end),
      start,
      end,
    });
  }
}

function cleanTextWithOffsets(rawText: string, baseOffset: number): CleanText {
  const lines = rawText.split("\n");
  const output: string[] = [];
  const offsets: number[] = [];
  let relativeOffset = 0;

  for (const line of lines) {
    cleanLineInto(line, baseOffset + relativeOffset, output, offsets);
    relativeOffset += line.length + 1;

    if (output.length > 0 && !/\s/.test(output[output.length - 1])) {
      output.push("\n");
      offsets.push(baseOffset + relativeOffset - 1);
    }
  }

  return { text: output.join(""), offsets };
}

function cleanLineInto(
  line: string,
  lineOffset: number,
  output: string[],
  offsets: number[]
) {
  let i = getReadableLineStart(line);

  while (i < line.length) {
    if (line.startsWith("![", i)) {
      const closeBracket = line.indexOf("]", i + 2);
      const openParen = closeBracket >= 0 ? line.indexOf("(", closeBracket) : -1;
      const closeParen = openParen >= 0 ? line.indexOf(")", openParen) : -1;
      if (closeBracket >= 0 && openParen === closeBracket + 1 && closeParen >= 0) {
        appendRange(line, lineOffset, i + 2, closeBracket, output, offsets);
        i = closeParen + 1;
        continue;
      }
    }

    if (line[i] === "[") {
      const closeBracket = line.indexOf("]", i + 1);
      const openParen = closeBracket >= 0 ? line.indexOf("(", closeBracket) : -1;
      const closeParen = openParen >= 0 ? line.indexOf(")", openParen) : -1;
      if (closeBracket >= 0 && openParen === closeBracket + 1 && closeParen >= 0) {
        appendRange(line, lineOffset, i + 1, closeBracket, output, offsets);
        i = closeParen + 1;
        continue;
      }
    }

    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end >= 0) {
        i = end + 1;
        continue;
      }
    }

    if (line[i] === "<") {
      const end = line.indexOf(">", i + 1);
      if (end >= 0) {
        i = end + 1;
        continue;
      }
    }

    if (line[i] === "\\" && i + 1 < line.length) {
      i++;
      appendChar(line[i], lineOffset + i, output, offsets);
      i++;
      continue;
    }

    if (/[*_~]/.test(line[i])) {
      i++;
      continue;
    }

    appendChar(line[i], lineOffset + i, output, offsets);
    i++;
  }
}

function getReadableLineStart(line: string): number {
  const markerMatch = line.match(
    /^\s*(?:(?:#{1,6}|>)\s+|(?:[-*+]|\d+[.)])\s+)/
  );
  return markerMatch ? markerMatch[0].length : 0;
}

function appendRange(
  source: string,
  baseOffset: number,
  start: number,
  end: number,
  output: string[],
  offsets: number[]
) {
  for (let i = start; i < end; i++) {
    appendChar(source[i], baseOffset + i, output, offsets);
  }
}

function appendChar(
  char: string,
  offset: number,
  output: string[],
  offsets: number[]
) {
  if (/\s/.test(char)) {
    if (output.length > 0 && !/\s/.test(output[output.length - 1])) {
      output.push(" ");
      offsets.push(offset);
    }
    return;
  }

  output.push(char);
  offsets.push(offset);
}

function makeRange(
  document: vscode.TextDocument,
  clean: CleanText,
  span: SentenceSpan
): vscode.Range | undefined {
  const startOffset = clean.offsets[span.start];
  const endOffset = clean.offsets[span.end - 1];
  if (startOffset === undefined || endOffset === undefined) {
    return undefined;
  }

  return new vscode.Range(
    document.positionAt(startOffset),
    document.positionAt(endOffset + 1)
  );
}

function parseReadableText(
  document: vscode.TextDocument,
  rawText: string,
  baseOffset: number
): SentenceInfo[] {
  const clean = cleanTextWithOffsets(rawText, baseOffset);
  const spans = splitIntoSentenceSpans(clean.text);

  return spans.flatMap((span) => {
    const range = makeRange(document, clean, span);
    return range ? [{ text: span.text, range }] : [];
  });
}

export function parseDocument(
  document: vscode.TextDocument
): SentenceInfo[] {
  const fullText = document.getText();
  const lines = fullText.split("\n");
  const lineOffsets: number[] = [];
  const results: SentenceInfo[] = [];
  let offset = 0;
  let blockStart = -1;
  let blockLines: string[] = [];
  let inCodeBlock = false;
  let firstReadableLine = 0;

  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(offset);
    offset += lines[i].length + 1;
  }

  if (lines[0]?.trim() === "---") {
    const endFrontmatter = lines.findIndex(
      (line, index) => index > 0 && line.trim() === "---"
    );
    if (endFrontmatter > 0) {
      firstReadableLine = endFrontmatter + 1;
    }
  }

  function flushBlock(endLine: number) {
    if (blockLines.length === 0 || blockStart < 0) return;

    const rawBlock = blockLines.join("\n");
    const sentences = parseReadableText(
      document,
      rawBlock,
      lineOffsets[blockStart]
    );
    results.push(...sentences);

    blockLines = [];
    blockStart = -1;
  }

  for (let i = firstReadableLine; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        inCodeBlock = false;
      } else {
        flushBlock(Math.max(firstReadableLine, i - 1));
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) continue;

    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushBlock(Math.max(firstReadableLine, i - 1));
      continue;
    }

    if (line.trim().length === 0) {
      flushBlock(Math.max(firstReadableLine, i - 1));
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      flushBlock(Math.max(firstReadableLine, i - 1));
      blockStart = i;
      blockLines = [line];
      flushBlock(i);
      continue;
    }

    if (blockStart === -1) blockStart = i;
    blockLines.push(line);
  }

  flushBlock(lines.length - 1);
  return results;
}

export function parseSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection
): SentenceInfo[] {
  return parseReadableText(
    document,
    document.getText(selection),
    document.offsetAt(selection.start)
  );
}
