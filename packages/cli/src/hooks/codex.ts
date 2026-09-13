/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { installStopHook } from "./install";

export function installCodexHook(hooksPath: string, command = "talktomebaby agent --agent codex"): { changed: boolean } {
  return installStopHook(hooksPath, command);
}
