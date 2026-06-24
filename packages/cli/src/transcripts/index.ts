import { lastAssistantTextClaude } from "./claude";
import { lastAssistantTextCodex } from "./codex";

export { lastAssistantTextClaude, lastAssistantTextCodex };

export function detectHost(transcriptPath: string): "claude" | "codex" | "unknown" {
  const p = transcriptPath || "";
  if (p.includes("/.codex/") || /rollout-.*\.jsonl$/.test(p)) return "codex";
  if (p.includes("/.claude/")) return "claude";
  return "unknown";
}

export function lastAssistantText(jsonl: string, host: "claude" | "codex"): string {
  return host === "codex" ? lastAssistantTextCodex(jsonl) : lastAssistantTextClaude(jsonl);
}
