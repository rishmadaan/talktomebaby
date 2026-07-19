import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { lastAssistantTextClaude } from "./claude";
import { lastAssistantTextCodex } from "./codex";

export { lastAssistantTextClaude, lastAssistantTextCodex };

// Standalone mode auto-discovery (per the suite design spec): the most
// recently modified transcript for the requested host, or "" if none.
export function discoverLatestTranscript(host: "claude" | "codex" | "auto", home: string = homedir()): string {
  const codexHome = process.env.CODEX_HOME || join(home, ".codex");
  const roots =
    host === "claude" ? [join(home, ".claude", "projects")]
    : host === "codex" ? [join(codexHome, "sessions")]
    : [join(home, ".claude", "projects"), join(codexHome, "sessions")];
  let best = "";
  let bestMtime = 0;
  for (const root of roots) {
    let names: string[];
    try { names = readdirSync(root, { recursive: true }) as string[]; } catch { continue; }
    for (const name of names) {
      const rel = String(name).replace(/\\/g, "/");
      if (!rel.endsWith(".jsonl")) continue;
      // Subagent transcripts are worker output, not the conversation.
      if (rel.includes("/subagents/") || rel.startsWith("subagents/")) continue;
      const full = join(root, String(name));
      try {
        const m = statSync(full).mtimeMs;
        if (m > bestMtime) { bestMtime = m; best = full; }
      } catch { /* raced away */ }
    }
  }
  return best;
}

export function detectHost(transcriptPath: string): "claude" | "codex" | "unknown" {
  // Normalize separators so Windows paths (C:\Users\me\.claude\...) match.
  const p = (transcriptPath || "").replace(/\\/g, "/");
  if (p.includes("/.codex/") || /rollout-.*\.jsonl$/.test(p)) return "codex";
  if (p.includes("/.claude/")) return "claude";
  return "unknown";
}

export function lastAssistantText(jsonl: string, host: "claude" | "codex"): string {
  return host === "codex" ? lastAssistantTextCodex(jsonl) : lastAssistantTextClaude(jsonl);
}
