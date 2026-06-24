import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installClaudeHook } from "./claude";
import { installCodexHook } from "./codex";

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), "ttmb-hook-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("installClaudeHook", () => {
  it("creates settings with a Stop hook and is idempotent", () => {
    const p = join(dir, "settings.json");
    expect(installClaudeHook(p).changed).toBe(true);
    const after = JSON.parse(readFileSync(p, "utf8"));
    const cmds = after.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds.some((c: string) => c.includes("talktomebaby agent"))).toBe(true);
    expect(installClaudeHook(p).changed).toBe(false); // second run = no change
    const cmds2 = JSON.parse(readFileSync(p, "utf8")).hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds2.filter((c: string) => c.includes("talktomebaby agent")).length).toBe(1); // no dup
  });

  it("preserves unrelated existing settings", async () => {
    const p = join(dir, "settings.json");
    await fs.writeFile(p, JSON.stringify({ model: "x", hooks: {} }));
    installClaudeHook(p);
    expect(JSON.parse(readFileSync(p, "utf8")).model).toBe("x");
  });
});

describe("installCodexHook", () => {
  it("creates hooks.json with a Stop hook and is idempotent", () => {
    const p = join(dir, "hooks.json");
    expect(installCodexHook(p).changed).toBe(true);
    expect(installCodexHook(p).changed).toBe(false);
    const cmds = JSON.parse(readFileSync(p, "utf8")).hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds.filter((c: string) => c.includes("talktomebaby agent")).length).toBe(1);
  });
});
