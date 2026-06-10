// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initSettingsPanel } from "./settings-panel";
import { SettingsData } from "../ui/reader-panel";

function harness() {
  document.body.innerHTML = `<div id="content"></div><div id="player-bar"></div>`;
  // The real gear is created by player-bar; stub one with the id toggle() looks for.
  const gear = document.createElement("button");
  gear.id = "settings-toggle";
  document.getElementById("player-bar")!.appendChild(gear);

  const opts = {
    onProvider: vi.fn(), onVoice: vi.fn(), onSetting: vi.fn(), requestData: vi.fn(),
  };
  const panel = initSettingsPanel(opts);
  const panelEl = document.getElementById("settings-panel")! as HTMLDivElement;
  return { panel, panelEl, gear, opts };
}

const data: SettingsData = {
  providers: [
    { id: "edge", label: "Edge", description: "Free", requiresKey: false, active: true },
    { id: "elevenlabs", label: "ElevenLabs", description: "Premium", requiresKey: true, active: false },
  ],
  voices: [{ id: "v1", label: "Voice 1" }, { id: "v2", label: "Voice 2" }],
  activeVoice: "v1", fontSize: 16, sentenceColor: "", wordColor: "",
};

describe("settings panel", () => {
  beforeEach(() => { document.documentElement.removeAttribute("style"); });

  it("starts hidden; first toggle opens and requests data, second toggle closes", () => {
    const { panel, panelEl, gear, opts } = harness();
    expect(panelEl.hidden).toBe(true);

    panel.toggle();
    expect(panelEl.hidden).toBe(false);
    expect(opts.requestData).toHaveBeenCalledTimes(1);
    expect(gear.classList.contains("active")).toBe(true);
    expect(gear.getAttribute("aria-expanded")).toBe("true");

    panel.toggle(); // the reported bug: this must CLOSE it
    expect(panelEl.hidden).toBe(true);
    expect(gear.classList.contains("active")).toBe(false);
    expect(gear.getAttribute("aria-expanded")).toBe("false");
  });

  it("close() hides an open panel and is a no-op when already closed", () => {
    const { panel, panelEl } = harness();
    panel.toggle();
    expect(panelEl.hidden).toBe(false);
    panel.close();
    expect(panelEl.hidden).toBe(true);
    panel.close(); // no throw, still closed
    expect(panelEl.hidden).toBe(true);
  });

  it("renders provider rows, key-required badge, and active check", () => {
    const { panel } = harness();
    panel.showData(data);
    const rows = [...document.querySelectorAll(".settings-provider")];
    expect(rows.length).toBe(2);
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(rows[0].querySelector(".settings-check")).toBeTruthy();
    expect(rows[1].querySelector(".settings-badge")?.textContent).toBe("key required");
  });

  it("shows a disabled loading option when voices are null, then fills them in", () => {
    const { panel } = harness();
    panel.showData({ ...data, voices: null });
    const select = document.getElementById("settings-voice") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options.length).toBe(1);
    expect(select.options[0].textContent).toBe("Loading voices…");
    expect(select.options[0].disabled).toBe(true);

    panel.showData(data); // voices arrive
    expect(select.disabled).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual(["v1", "v2"]);
    expect(select.value).toBe("v1");
  });

  it("clicking the active provider row does not emit onProvider; an inactive one does", () => {
    const { panel, opts } = harness();
    panel.showData(data);
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".settings-provider")];
    rows[0].click(); // active edge
    expect(opts.onProvider).not.toHaveBeenCalled();
    rows[1].click(); // inactive elevenlabs
    expect(opts.onProvider).toHaveBeenCalledWith("elevenlabs");
  });

  it("syncToggleState restores the gear active class from panel state", () => {
    const { panel, gear } = harness();
    panel.toggle(); // open
    gear.classList.remove("active"); // simulate player-bar rebuild wiping it
    panel.syncToggleState();
    expect(gear.classList.contains("active")).toBe(true);
  });
});
