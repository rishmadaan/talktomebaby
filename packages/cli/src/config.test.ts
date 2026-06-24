import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "ttmb-cfg-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.OPENAI_API_KEY;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("config", () => {
  it("configPath honors XDG_CONFIG_HOME", async () => {
    const { configPath } = await import("./config");
    expect(configPath()).toBe(join(dir, "talktomebaby", "config.json"));
  });

  it("loadConfig returns defaults when no file exists (disabled, edge, full)", async () => {
    const { loadConfig } = await import("./config");
    const c = loadConfig();
    expect(c.enabled).toBe(false);
    expect(c.provider).toBe("edge");
    expect(c.scope).toBe("full");
  });

  it("saveConfig then loadConfig round-trips", async () => {
    const { loadConfig, saveConfig } = await import("./config");
    saveConfig({ ...loadConfig(), enabled: true, provider: "openai" });
    const c = loadConfig();
    expect(c.enabled).toBe(true);
    expect(c.provider).toBe("openai");
  });

  it("resolveKey prefers env var over config", async () => {
    const { resolveKey, saveConfig, loadConfig } = await import("./config");
    saveConfig({ ...loadConfig(), keys: { openai: "from-config" } } as any);
    process.env.OPENAI_API_KEY = "from-env";
    expect(resolveKey("openai")).toBe("from-env");
    delete process.env.OPENAI_API_KEY;
    expect(resolveKey("openai")).toBe("from-config");
  });
});
