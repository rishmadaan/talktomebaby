/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { installStopHook } from "./install";

export function installClaudeHook(settingsPath: string, command = "talktomebaby agent --agent claude"): { changed: boolean } {
  return installStopHook(settingsPath, command);
}
