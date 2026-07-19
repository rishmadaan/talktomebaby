import { installStopHook } from "./install";

export function installClaudeHook(settingsPath: string, command = "talktomebaby agent --agent claude"): { changed: boolean } {
  return installStopHook(settingsPath, command);
}
