import { installStopHook } from "./install";

export function installClaudeHook(settingsPath: string): { changed: boolean } {
  return installStopHook(settingsPath, "talktomebaby agent --agent claude");
}
