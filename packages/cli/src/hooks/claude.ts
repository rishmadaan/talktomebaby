import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const MARKER = "talktomebaby agent";

export function installClaudeHook(settingsPath: string): { changed: boolean } {
  let cfg: any = {};
  if (existsSync(settingsPath)) { try { cfg = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { cfg = {}; } }
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
  const present = cfg.hooks.Stop.some((g: any) => (g.hooks || []).some((h: any) => typeof h.command === "string" && h.command.includes(MARKER)));
  if (present) return { changed: false };
  cfg.hooks.Stop.push({ hooks: [{ type: "command", command: "talktomebaby agent --agent claude" }] });
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(cfg, null, 2));
  return { changed: true };
}
