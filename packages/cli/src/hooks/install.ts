import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

// A hook is ours if it invokes talktomebaby's agent mode in ANY persisted
// form: bare `talktomebaby agent ...` or the absolute dev/local fallback
// `"node" ".../talktomebaby*/.../cli.js" agent ...` — a contiguous-substring
// marker missed the latter and re-appended the hook on every dev install.
function isOurCommand(command: string): boolean {
  return command.includes("talktomebaby") && /\bagent\b/.test(command);
}

// Shared Stop-hook installer for both hosts. Idempotent by MARKER. Refuses to
// touch a file it cannot parse: overwriting a malformed settings file would
// destroy the user's existing configuration.

function readSettings(settingsPath: string): any {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`refusing to modify ${settingsPath}: existing file is not valid JSON; fix or remove it and re-run`);
  }
}

function containsHook(cfg: any): boolean {
  const stop = cfg?.hooks?.Stop;
  if (!Array.isArray(stop)) return false;
  return stop.some((g: any) => (g.hooks || []).some((h: any) => typeof h.command === "string" && isOurCommand(h.command)));
}

// Presence probe: lets the installer sequence its config write BEFORE the hook
// write, so a failure between the two is retryable.
export function hasStopHook(settingsPath: string): boolean {
  return containsHook(readSettings(settingsPath));
}

export function installStopHook(settingsPath: string, command: string): { changed: boolean } {
  const cfg = readSettings(settingsPath);
  if (containsHook(cfg)) return { changed: false };
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
  cfg.hooks.Stop.push({ hooks: [{ type: "command", command }] });
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(cfg, null, 2));
  return { changed: true };
}
