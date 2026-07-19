import { installStopHook } from "./install";

export function installCodexHook(hooksPath: string): { changed: boolean } {
  return installStopHook(hooksPath, "talktomebaby agent --agent codex");
}
