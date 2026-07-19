import { readFileSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { appendFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { availableProviders } from "@talktomebaby/engine";
import { loadConfig, saveConfig } from "./config";
import { detectHost, discoverLatestTranscript, lastAssistantText } from "./transcripts/index";
import { speakText } from "./agent-voice";
import { installClaudeHook } from "./hooks/claude";
import { installCodexHook } from "./hooks/codex";

const LOG = join(tmpdir(), "talktomebaby.log");
function log(m: string) { try { appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch { /* never throw */ } }

function readStdin(): string {
  // Only read stdin when it is piped: readFileSync(0) on an interactive TTY
  // blocks until EOF, which would hang a bare `talktomebaby agent`.
  if (process.stdin.isTTY) return "";
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

const PIDFILE = join(tmpdir(), "talktomebaby-agent.pid");

// Newest reply wins: a new turn hushes any speech still playing from the
// previous one instead of talking over it. The detached child is a process
// group leader (spawned detached), so kill(-pid) takes its audio player with
// it; kill(pid) is the fallback for a directly-run --foreground process. On
// Windows there are no process groups, so taskkill /T fells the player tree.
// ponytail: pidfile, no locking; a recycled pid could be mis-killed in theory.
function hushPrevious(): void {
  try {
    const pid = Number(readFileSync(PIDFILE, "utf8").trim());
    if (!(pid > 0) || pid === process.pid) return;
    if (process.platform === "win32") {
      try { spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).unref(); } catch { /* already gone */ }
      return;
    }
    try { process.kill(-pid); } catch { try { process.kill(pid); } catch { /* already gone */ } }
  } catch { /* no previous job */ }
}

async function runAgent(argv: string[]): Promise<void> {
  // NEVER throws to the host: every path resolves and the caller exits 0.
  try {
    const cfg = loadConfig();
    if (!cfg.enabled) return;
    hushPrevious();
    try { writeFileSync(PIDFILE, String(process.pid)); } catch { /* best effort */ }
    const agentArg = argFor(argv, "--agent");
    const tpArg = argFor(argv, "--transcript");
    let host = (agentArg as "claude" | "codex" | "auto") || "auto";
    let jsonl = "";
    let transcriptPath = tpArg || "";
    if (!transcriptPath) {
      const stdin = readStdin();
      try { const hook = JSON.parse(stdin); transcriptPath = hook.transcript_path || ""; } catch { /* not hook json */ }
    }
    if (transcriptPath) jsonl = readFileSync(transcriptPath, "utf8");
    const resolvedHost = host === "auto" ? detectHost(transcriptPath) : host;
    if (resolvedHost === "unknown") return;
    const text = lastAssistantText(jsonl, resolvedHost);
    if (!text.trim()) return;
    const res = await speakText(text, cfg);
    if (!res.ok && res.error) log(`speak failed: ${res.error}`);
  } catch (e) {
    log(`agent error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function argFor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    return await dispatch(cmd, rest);
  } catch (e) {
    // A strict config load refusing to clobber a malformed file lands here.
    console.error(e instanceof Error ? e.message : String(e));
    return cmd === "agent" ? 0 : 1; // agent NEVER fails the host
  }
}

async function dispatch(cmd: string | undefined, rest: string[]): Promise<number> {
  switch (cmd) {
    case "agent": {
      // The host's Stop hook waits for this command, so it must return
      // immediately: read the hook JSON here (the stdin pipe dies with this
      // process), then hand off to a detached child that does the slow
      // summarize/synthesize/play work. --foreground is that child.
      if (rest.includes("--foreground")) { await runAgent(rest); return 0; } // ALWAYS 0
      if (!loadConfig().enabled) return 0;
      const agentPick = (argFor(rest, "--agent") as "claude" | "codex" | "auto") || "auto";
      let transcriptPath = argFor(rest, "--transcript") || "";
      if (!transcriptPath) {
        try { transcriptPath = JSON.parse(readStdin()).transcript_path || ""; } catch { /* not hook json */ }
      }
      // Standalone with no hook JSON: speak the newest transcript for the host.
      if (!transcriptPath) transcriptPath = discoverLatestTranscript(agentPick);
      if (!transcriptPath) return 0;
      const args = [process.argv[1], "agent", "--foreground", "--transcript", transcriptPath, "--agent", agentPick];
      spawn(process.execPath, args, { detached: true, stdio: "ignore" }).unref();
      return 0; // ALWAYS 0
    }
    case "on": { saveConfig({ ...loadConfig({ strict: true }), enabled: true }); console.log("talktomebaby voice ON"); return 0; }
    case "off": { saveConfig({ ...loadConfig({ strict: true }), enabled: false }); console.log("talktomebaby voice OFF"); return 0; }
    case "toggle": { const c = loadConfig({ strict: true }); saveConfig({ ...c, enabled: !c.enabled }); console.log(`talktomebaby voice ${!c.enabled ? "ON" : "OFF"}`); return 0; }
    case "status": { const c = loadConfig(); console.log(`talktomebaby voice ${c.enabled ? "ON" : "OFF"} (${c.provider}, ${c.scope})`); return 0; }
    case "config": { return doConfig(rest); }
    case "install": {
      const target = rest[0];
      const installers: Record<string, { path: string; fn: (p: string) => { changed: boolean }; name: string }> = {
        claude: { path: join(homedir(), ".claude", "settings.json"), fn: installClaudeHook, name: "Claude" },
        codex: { path: join(homedir(), ".codex", "hooks.json"), fn: installCodexHook, name: "Codex" },
      };
      const inst = target ? installers[target] : undefined;
      if (!inst) { console.error("usage: talktomebaby install <claude|codex>"); return 1; }
      try {
        // Validate the config BEFORE touching the host's settings: if the
        // config is malformed, failing after the hook is written would leave a
        // half-state a retry can't finish (hook "already present", never enabled).
        const cfg = loadConfig({ strict: true });
        if (inst.fn(inst.path).changed) {
          // A fresh install is an explicit opt-in to agent voice: enable it so
          // the advertised onboarding command works end to end. A re-run of
          // install leaves the user's on/off choice alone.
          const enabled = { ...cfg, enabled: true };
          if (!cfg.enabled) saveConfig(enabled);
          // Spec promise: one command from install to HEARING the agent. The
          // test line is the dry-run that proves provider + player actually
          // work; a silent success here would hide a broken setup.
          const test = await speakText(`TalkToMeBaby is ready. I will read ${inst.name}'s replies aloud.`, enabled);
          if (test.ok) {
            console.log(`Installed ${inst.name} hook at ${inst.path}; voice ON (test line spoken)`);
          } else {
            console.log(`Installed ${inst.name} hook at ${inst.path}; voice ON, but the test line FAILED${test.error ? `: ${test.error}` : ""}. Check your provider/key with: talktomebaby config`);
          }
        } else {
          console.log(`${inst.name} hook already present at ${inst.path}`);
        }
        return 0;
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        return 1;
      }
    }
    default:
      console.log("talktomebaby <agent|install|on|off|toggle|status|config>");
      return cmd ? 1 : 0;
  }
}

function doConfig(rest: string[]): number {
  const c = loadConfig({ strict: true });
  if (rest.length === 0) {
    // Never print stored key values; show which providers have one.
    const shown = { ...c, keys: c.keys ? Object.fromEntries(Object.keys(c.keys).map((k) => [k, "<set>"])) : undefined };
    console.log(JSON.stringify(shown, null, 2));
    return 0;
  }
  const [key, value] = rest;
  if (key === "provider" && value) {
    // The engine catalog is the single source of provider truth; filtering by
    // platform keeps "say" out on non-macOS, where it cannot run.
    const valid = availableProviders(process.platform).map((p) => p.id);
    if (!valid.includes(value)) { console.error(`unknown or unavailable provider "${value}" (valid here: ${valid.join(", ")})`); return 1; }
    saveConfig({ ...c, provider: value }); console.log(`provider = ${value}`); return 0;
  }
  if (key === "scope" && (value === "full" || value === "first-paragraph" || value === "summary")) { saveConfig({ ...c, scope: value }); console.log(`scope = ${value}`); return 0; }
  if (key === "voice" && value && rest[2]) {
    const known = availableProviders(process.platform).map((p) => p.id);
    if (!known.includes(value)) { console.error(`unknown or unavailable provider "${value}" (valid here: ${known.join(", ")})`); return 1; }
    saveConfig({ ...c, voice: { ...c.voice, [value]: rest[2] } }); console.log(`voice.${value} = ${rest[2]}`); return 0;
  }
  if (key === "max-chars" && value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) { console.error(`max-chars must be a positive integer, got "${value}"`); return 1; }
    saveConfig({ ...c, maxChars: n }); console.log(`maxChars = ${n}`); return 0;
  }
  console.error("usage: talktomebaby config [provider <id> | scope <full|first-paragraph|summary> | voice <provider> <voice-id> | max-chars <n>]"); return 1;
}

main().then((code) => process.exit(code)).catch((e) => { log(`fatal: ${e}`); process.exit(0); });
