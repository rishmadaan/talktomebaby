import { describe, it, expect } from "vitest";
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
