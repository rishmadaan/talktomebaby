import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface CliConfig {
  enabled: boolean;
  provider: string;
  voice: Record<string, string>;
  scope: "full" | "first-paragraph" | "summary";
  maxChars: number;
  keys?: Record<string, string>;
}

export const DEFAULT_CONFIG: CliConfig = {
  enabled: false,
  provider: "edge",
  voice: { edge: "en-US-AriaNeural", say: "Samantha", openai: "alloy", elevenlabs: "21m00Tcm4TlvDq8ikWAM", sarvam: "shubh" },
  scope: "full",
  maxChars: 4000,
};

const ENV_KEY: Record<string, string> = {
  openai: "OPENAI_API_KEY", elevenlabs: "ELEVENLABS_API_KEY", sarvam: "SARVAM_API_KEY", gemini: "GEMINI_API_KEY",
};

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "talktomebaby", "config.json");
}

export function loadConfig(): CliConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    return { ...DEFAULT_CONFIG, ...raw, voice: { ...DEFAULT_CONFIG.voice, ...(raw.voice || {}) } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(c: CliConfig): CliConfig {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(c, null, 2));
  return c;
}

export function resolveKey(provider: string): string | undefined {
  const env = ENV_KEY[provider] && process.env[ENV_KEY[provider]];
  if (env) return env;
  return loadConfig().keys?.[provider];
}
