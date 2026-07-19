import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { discoverLatestTranscript } from "./index";

describe("discoverLatestTranscript", () => {
  let home: string;
  beforeEach(async () => { home = await fs.mkdtemp(join(tmpdir(), "ttmb-home-")); });
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

  it("returns the newest .jsonl for the host, and '' when none exist", async () => {
    expect(discoverLatestTranscript("claude", home)).toBe("");
    const proj = join(home, ".claude", "projects", "p1");
    await fs.mkdir(proj, { recursive: true });
    await fs.writeFile(join(proj, "old.jsonl"), "{}");
    await fs.writeFile(join(proj, "new.jsonl"), "{}");
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(join(proj, "old.jsonl"), past, past);
    expect(discoverLatestTranscript("claude", home)).toBe(join(proj, "new.jsonl"));
    expect(discoverLatestTranscript("auto", home)).toBe(join(proj, "new.jsonl"));
  });
});
import { lastAssistantTextClaude, lastAssistantTextCodex, detectHost, lastAssistantText } from "./index";

const claudeJsonl = [
  JSON.stringify({ type: "user", message: { role: "user", content: "old q" } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "old answer" }] } }),
  JSON.stringify({ type: "user", message: { role: "user", content: "new q" } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "Hello" }] } }),
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x" }] } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "world" }] } }),
].join("\n");

const codexJsonl = [
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "new q" }] } }),
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex answer" }] } }),
].join("\n");

describe("transcript readers", () => {
  it("claude reader returns only the final turn's text blocks", () => {
    expect(lastAssistantTextClaude(claudeJsonl)).toBe("Hello\n\nworld");
  });
  it("codex reader returns the assistant output after the last user prompt", () => {
    expect(lastAssistantTextCodex(codexJsonl)).toBe("Codex answer");
  });
  it("detectHost infers from path", () => {
    expect(detectHost("/home/u/.codex/sessions/2026/rollout-x.jsonl")).toBe("codex");
    expect(detectHost("/home/u/.claude/projects/p/abc.jsonl")).toBe("claude");
  });
  it("lastAssistantText dispatches by host", () => {
    expect(lastAssistantText(codexJsonl, "codex")).toBe("Codex answer");
  });
});
