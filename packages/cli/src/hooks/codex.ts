import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const MARKER = "talktomebaby agent";

export function installCodexHook(hooksPath: string): { changed: boolean } {
  let cfg: any = {};
  if (existsSync(hooksPath)) { try { cfg = JSON.parse(readFileSync(hooksPath, "utf8")); } catch { cfg = {}; } }
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
  const present = cfg.hooks.Stop.some((g: any) => (g.hooks || []).some((h: any) => typeof h.command === "string" && h.command.includes(MARKER)));
  if (present) return { changed: false };
  cfg.hooks.Stop.push({ hooks: [{ type: "command", command: "talktomebaby agent --agent codex" }] });
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(cfg, null, 2));
  return { changed: true };
}
