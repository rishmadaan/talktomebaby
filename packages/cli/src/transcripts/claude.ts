interface ClaudeBlock {
  type?: string;
  text?: string;
}

interface ClaudeMessage {
  role?: string;
  content?: string | ClaudeBlock[];
}

interface ClaudeEntry {
  type?: string;
  message?: ClaudeMessage;
}

export function isHumanPrompt(entry: ClaudeEntry): boolean {
  if (!entry || entry.type !== "user" || !entry.message) return false;
  const content = entry.message.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((b) => b && b.type && b.type !== "tool_result");
  }
  return false;
}

export function assistantTextBlocks(entry: ClaudeEntry): string[] {
  if (!entry || entry.type !== "assistant" || !entry.message) return [];
  const content = entry.message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
}

// Parse JSONL text -> array of entries (skips blank/unparseable lines).
export function parseEntries(jsonl: string): ClaudeEntry[] {
  const entries: ClaudeEntry[] = [];
  for (const line of String(jsonl).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // tolerate partial/corrupt lines
    }
  }
  return entries;
}

// Return the concatenated text of the final assistant turn, or "" if none.
export function lastAssistantTextClaude(jsonl: string): string {
  const entries = parseEntries(jsonl);

  // Find the index just after the last genuine human prompt.
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isHumanPrompt(entries[i])) {
      start = i + 1;
      break;
    }
  }

  const texts: string[] = [];
  for (let i = start; i < entries.length; i++) {
    texts.push(...assistantTextBlocks(entries[i]));
  }
  return texts.join("\n\n").trim();
}
