import { installStopHook } from "./install";

export function installCodexHook(hooksPath: string, command = "talktomebaby agent --agent codex"): { changed: boolean } {
  return installStopHook(hooksPath, command);
}
