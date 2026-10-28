/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { buildSync } from "esbuild";

// Runs the real CLI as a child process with HOME, XDG_CONFIG_HOME and
// CODEX_HOME pointed at a throwaway folder, so the user's own ~/.claude,
// ~/.codex and config are never read or written.
const NOTICE = "Note: Edge TTS makes unofficial use of Microsoft's online voice service";
let bundle = "";
let bundleDir = "";
let home = "";

beforeAll(() => {
  // The folder name carries "talktomebaby" so the dev fallback hook command is recognised as ours.
  bundleDir = mkdtempSync(join(tmpdir(), "talktomebaby-cli-bundle-"));
  bundle = join(bundleDir, "cli.js");
  buildSync({ entryPoints: [join(__dirname, "cli.ts")], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
});

function dropHome() { if (home) rmSync(home, { recursive: true, force: true }); home = ""; }
afterEach(dropHome);
afterAll(() => rmSync(bundleDir, { recursive: true, force: true }));

function cli(args: string[]): string[] {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), CODEX_HOME: join(home, ".codex") };
  const r = spawnSync(process.execPath, [bundle, ...args], { env, encoding: "utf8", timeout: 20000 });
  return String(r.stdout).split("\n");
}

// Fresh throwaway home, then one CLI run in it.
function run(args: string[], config?: object): string[] {
  dropHome();
  home = mkdtempSync(join(tmpdir(), "ttmb-cli-home-"));
  const cfgDir = join(home, ".config", "talktomebaby");
  mkdirSync(cfgDir, { recursive: true });
  if (config) writeFileSync(join(cfgDir, "config.json"), JSON.stringify(config));
  // A plain file where the audio dir would go makes the install test line fail
  // before any provider is contacted: no network, no sound.
  writeFileSync(join(cfgDir, "audio"), "");
  return cli(args);
}

describe("Edge use-at-your-own-risk notice", () => {
  it("fresh install prints the notice before the test line is attempted", () => {
    const out = run(["install", "codex"], { enabled: true, provider: "edge" });
    const notice = out.findIndex((l) => l.startsWith(NOTICE));
    const installed = out.findIndex((l) => l.startsWith("Installed Codex hook"));
    expect(installed).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(installed);
  });

  it("install with the hook already present still prints the notice", () => {
    const first = run(["install", "codex"], { enabled: true, provider: "edge" });
    expect(first.some((l) => l.startsWith("Installed Codex hook"))).toBe(true);
    const out = cli(["install", "codex"]); // same home: the hook is present now
    expect(out.some((l) => l.startsWith("Codex hook already present"))).toBe(true);
    expect(out.some((l) => l.startsWith(NOTICE))).toBe(true);
  });

  it("existing hook with a non-Edge provider prints no notice", () => {
    expect(run(["install", "codex"], { enabled: true, provider: "openai" }).some((l) => l.startsWith(NOTICE))).toBe(false);
    const out = cli(["install", "codex"]);
    expect(out.some((l) => l.startsWith("Codex hook already present"))).toBe(true);
    expect(out.some((l) => l.startsWith(NOTICE))).toBe(false);
  });

  it("config provider edge prints the notice; another provider does not", () => {
    expect(run(["config", "provider", "edge"], { provider: "openai" }).some((l) => l.startsWith(NOTICE))).toBe(true);
    expect(run(["config", "provider", "openai"], { provider: "edge" }).some((l) => l.startsWith(NOTICE))).toBe(false);
  });

  it("help mentions Edge TTS is used at your own risk", () => {
    expect(run([]).some((l) => l.startsWith("Edge TTS (the default voice) makes unofficial use of a Microsoft service; use at your own risk."))).toBe(true);
  });

  it("on prints the notice for Edge; another provider does not", () => {
    expect(run(["on"], { enabled: false, provider: "edge" }).some((l) => l.startsWith(NOTICE))).toBe(true);
    expect(run(["on"], { enabled: false, provider: "openai" }).some((l) => l.startsWith(NOTICE))).toBe(false);
  });

  it("toggle prints the notice only when it turns Edge on", () => {
    expect(run(["toggle"], { enabled: false, provider: "edge" }).some((l) => l.startsWith(NOTICE))).toBe(true);
    const off = run(["toggle"], { enabled: true, provider: "edge" });
    expect(off).toContain("talktomebaby voice OFF");
    expect(off.some((l) => l.startsWith(NOTICE))).toBe(false);
  });

  it("status prints the notice when the provider is Edge", () => {
    expect(run(["status"], { enabled: true, provider: "edge" }).some((l) => l.startsWith(NOTICE))).toBe(true);
  });
});

// In-process: the real install code with speakText replaced by a marker, so the
// test sees the notice land before synthesis is even called, not just before
// the final "Installed" line.
const events = vi.hoisted(() => [] as string[]);
vi.mock("./agent-voice", () => ({ speakText: async () => { events.push("SPEAK"); return { ok: true }; } }));

describe("install ordering", () => {
  const keys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "CODEX_HOME"] as const;
  const saved: Record<string, string | undefined> = {};
  afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.restoreAllMocks(); });

  it("prints the Edge notice before speakText is called", async () => {
    home = mkdtempSync(join(tmpdir(), "ttmb-cli-home-")); // removed by afterEach(dropHome)
    for (const k of keys) saved[k] = process.env[k];
    Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), CODEX_HOME: join(home, ".codex") });
    mkdirSync(join(home, ".config", "talktomebaby"), { recursive: true });
    writeFileSync(join(home, ".config", "talktomebaby", "config.json"), JSON.stringify({ enabled: true, provider: "edge" }));
    events.length = 0;
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { events.push(String(m)); });
    vi.resetModules(); // STATE_DIR is computed at load, after the env above
    const { dispatch } = await import("./cli");
    expect(await dispatch("install", ["codex"])).toBe(0);
    const notice = events.findIndex((l) => l.startsWith(NOTICE));
    const speak = events.indexOf("SPEAK");
    expect(speak).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(speak);
  });
});
