import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const MARKER = "talktomebaby agent";

// Shared Stop-hook installer for both hosts. Idempotent by MARKER. Refuses to
// touch a file it cannot parse: overwriting a malformed settings file would
// destroy the user's existing configuration.
export function installStopHook(settingsPath: string, command: string): { changed: boolean } {
  let cfg: any = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf8");
    if (raw.trim()) {
      try {
        cfg = JSON.parse(raw);
      } catch {
        throw new Error(`refusing to modify ${settingsPath}: existing file is not valid JSON; fix or remove it and re-run`);
      }
    }
  }
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
  const present = cfg.hooks.Stop.some((g: any) => (g.hooks || []).some((h: any) => typeof h.command === "string" && h.command.includes(MARKER)));
  if (present) return { changed: false };
  cfg.hooks.Stop.push({ hooks: [{ type: "command", command }] });
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(cfg, null, 2));
  return { changed: true };
}
