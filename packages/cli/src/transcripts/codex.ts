interface CodexBlock { type?: string; text?: string }
interface CodexMsg { type?: string; role?: string; content?: CodexBlock[] }
interface CodexLine { type?: string; payload?: CodexMsg }

function parse(jsonl: string): CodexLine[] {
  const out: CodexLine[] = [];
  for (const line of String(jsonl).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* tolerate */ }
  }
  return out;
}

function msg(l: CodexLine): CodexMsg | null {
  return l && l.type === "response_item" && l.payload && l.payload.type === "message" ? l.payload : null;
}
function blockText(m: CodexMsg, kind: string): string {
  return (m.content || []).filter((b) => b && b.type === kind && typeof b.text === "string").map((b) => b.text as string).join("");
}

export function lastAssistantTextCodex(jsonl: string): string {
  const lines = parse(jsonl);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = msg(lines[i]);
    if (m && m.role === "user" && blockText(m, "input_text").trim()) { start = i + 1; break; }
  }
  const texts: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const m = msg(lines[i]);
    if (m && m.role === "assistant") {
      const t = blockText(m, "output_text") || blockText(m, "text");
      if (t) texts.push(t);
    }
  }
  return texts.join("\n\n").trim();
}
