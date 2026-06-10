import { SettingsData, SettingKey } from "../ui/reader-panel";

export interface SettingsPanelOptions {
  onProvider(id: string): void;
  onVoice(id: string): void;
  onSetting(key: SettingKey, value: string | number): void;
  /** Ask the extension to send fresh settingsData (sent when the panel opens). */
  requestData(): void;
}

export interface SettingsPanel {
  /** Render the latest extension-provided state (single source of truth). */
  showData(data: SettingsData): void;
  /** Toggle visibility; requests fresh data when opening. */
  toggle(): void;
  /** Close the panel (no-op if already closed). Used by Esc. */
  close(): void;
  /** Re-apply the gear's active styling after the player bar is rebuilt. */
  syncToggleState(): void;
}

const FONT_MIN = 12;
const FONT_MAX = 28;

/**
 * Builds the settings section that lives above the player bar. The extension is
 * the single source of truth: this module sends intents (onProvider/onVoice/
 * onSetting) and re-renders whatever settingsData comes back. Local controls are
 * only updated optimistically for font size / colors (instant CSS feedback);
 * provider/voice always wait for the round trip.
 */
export function initSettingsPanel(opts: SettingsPanelOptions): SettingsPanel {
  const panel = document.createElement("div");
  panel.id = "settings-panel";
  // IMPORTANT: visibility is controlled exclusively via panel.hidden (the HTML
  // `hidden` attribute). reader.css sets display:flex on #settings-panel, which
  // would normally override the UA [hidden] rule — so reader.css MUST also
  // include `#settings-panel[hidden] { display: none; }` to make this work.
  panel.hidden = true;
  // Insert before the player bar so it stacks directly above it.
  const playerBar = document.getElementById("player-bar")!;
  playerBar.parentElement!.insertBefore(panel, playerBar);

  // Header with title + a close (×) button so the panel reads as intentional.
  const header = document.createElement("div");
  header.className = "settings-header";
  const headerTitle = document.createElement("div");
  headerTitle.className = "settings-title";
  headerTitle.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.className = "settings-close";
  closeBtn.setAttribute("aria-label", "Close settings");
  closeBtn.title = "Close (Esc)";
  closeBtn.textContent = "✕";
  header.append(headerTitle, closeBtn);
  panel.appendChild(header);

  const section = (title: string): HTMLDivElement => {
    const wrap = document.createElement("div");
    wrap.className = "settings-section";
    const h = document.createElement("div");
    h.className = "settings-heading";
    h.textContent = title;
    wrap.appendChild(h);
    panel.appendChild(wrap);
    return wrap;
  };

  // ── Provider section (engine choice) ──────────────────────────────────────
  const providerSection = section("Provider");
  const providerList = document.createElement("div");
  providerList.id = "settings-providers";
  providerSection.appendChild(providerList);

  // ── Voice section (the active provider's voices) ──────────────────────────
  const voiceSection = section("Voice");
  const voiceSelect = document.createElement("select");
  voiceSelect.id = "settings-voice";
  voiceSelect.setAttribute("aria-label", "Voice");
  voiceSelect.addEventListener("change", () => { if (voiceSelect.value) opts.onVoice(voiceSelect.value); });
  voiceSection.append(voiceSelect);

  // ── Appearance section (font size + highlight colors + reset) ─────────────
  const appearanceSection = section("Appearance");

  const fontFieldLabel = document.createElement("div");
  fontFieldLabel.className = "settings-field-label";
  fontFieldLabel.textContent = "Font size";
  appearanceSection.appendChild(fontFieldLabel);

  const fontRow = document.createElement("div");
  fontRow.className = "settings-stepper";
  const dec = document.createElement("button");
  dec.textContent = "−";
  dec.title = "Smaller";
  const fontValue = document.createElement("span");
  fontValue.id = "settings-font-value";
  const inc = document.createElement("button");
  inc.textContent = "+";
  inc.title = "Larger";
  fontRow.append(dec, fontValue, inc);
  appearanceSection.appendChild(fontRow);

  let fontSize = 16;
  const clampFont = (n: number) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
  const applyFont = (n: number) => {
    fontSize = clampFont(n);
    fontValue.textContent = `${fontSize}px`;
    document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
    dec.disabled = fontSize <= FONT_MIN;
    inc.disabled = fontSize >= FONT_MAX;
    opts.onSetting("readerFontSize", fontSize);
  };
  dec.addEventListener("click", () => applyFont(fontSize - 1));
  inc.addEventListener("click", () => applyFont(fontSize + 1));

  // ── Highlight colors (within Appearance) ──────────────────────────────────
  const colorFieldLabel = document.createElement("div");
  colorFieldLabel.className = "settings-field-label";
  colorFieldLabel.textContent = "Highlight colors";
  appearanceSection.appendChild(colorFieldLabel);

  const colorRow = document.createElement("div");
  colorRow.className = "settings-colors";

  const colorField = (label: string, onPick: (value: string) => void) => {
    const wrap = document.createElement("label");
    wrap.className = "settings-color-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "color";
    input.addEventListener("input", () => onPick(input.value));
    wrap.append(span, input);
    colorRow.appendChild(wrap);
    return input;
  };

  const sentenceInput = colorField("Sentence", (value) => {
    document.documentElement.style.setProperty("--sentence-color", value);
    opts.onSetting("highlight.sentenceColor", value);
  });
  const wordInput = colorField("Word", (value) => {
    document.documentElement.style.setProperty("--word-color", value);
    opts.onSetting("highlight.wordColor", value);
  });

  const resetColors = document.createElement("button");
  resetColors.textContent = "Reset to theme";
  resetColors.className = "settings-reset";
  resetColors.addEventListener("click", () => {
    document.documentElement.style.removeProperty("--sentence-color");
    document.documentElement.style.removeProperty("--word-color");
    opts.onSetting("highlight.sentenceColor", "");
    opts.onSetting("highlight.wordColor", "");
  });
  appearanceSection.append(colorRow, resetColors);

  // A color <input> can't show "empty" — fall back to a neutral swatch so the
  // control is usable, while the persisted value stays "" until the user picks.
  const swatch = (value: string, fallback: string) => (value && /^#/.test(value) ? value : fallback);

  function showData(data: SettingsData) {
    // Providers: rebuild the radio-like rows.
    providerList.textContent = "";
    for (const p of data.providers) {
      const row = document.createElement("button");
      row.className = "settings-provider" + (p.active ? " active" : "");
      row.dataset.id = p.id;

      const main = document.createElement("div");
      main.className = "settings-provider-main";
      const name = document.createElement("span");
      name.className = "settings-provider-label";
      name.textContent = p.label;
      main.appendChild(name);
      if (p.requiresKey) {
        const badge = document.createElement("span");
        badge.className = "settings-badge";
        badge.textContent = "key required";
        main.appendChild(badge);
      }
      if (p.active) {
        const check = document.createElement("span");
        check.className = "settings-check";
        check.textContent = "✓";
        main.appendChild(check);
      }

      const desc = document.createElement("div");
      desc.className = "settings-provider-desc";
      desc.textContent = p.description;

      row.append(main, desc);
      row.addEventListener("click", () => { if (!p.active) opts.onProvider(p.id); });
      providerList.appendChild(row);
    }

    // Voices. null = still loading (network fetch in flight): show a single
    // disabled "Loading voices…" option until a follow-up settingsData arrives.
    voiceSelect.textContent = "";
    if (data.voices === null) {
      const loading = document.createElement("option");
      loading.textContent = "Loading voices…";
      loading.value = "";
      loading.disabled = true;
      loading.selected = true;
      voiceSelect.appendChild(loading);
      voiceSelect.disabled = true;
    } else {
      voiceSelect.disabled = false;
      for (const v of data.voices) {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.label;
        if (v.id === data.activeVoice) opt.selected = true;
        voiceSelect.appendChild(opt);
      }
      voiceSelect.value = data.activeVoice;
    }

    // Font size (reflect persisted truth; do not re-emit onSetting).
    fontSize = clampFont(data.fontSize);
    fontValue.textContent = `${fontSize}px`;
    document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
    dec.disabled = fontSize <= FONT_MIN;
    inc.disabled = fontSize >= FONT_MAX;

    // Colors.
    sentenceInput.value = swatch(data.sentenceColor, "#3a6ea5");
    wordInput.value = swatch(data.wordColor, "#d7a900");
    if (data.sentenceColor) {
      document.documentElement.style.setProperty("--sentence-color", data.sentenceColor);
    } else {
      document.documentElement.style.removeProperty("--sentence-color");
    }
    if (data.wordColor) {
      document.documentElement.style.setProperty("--word-color", data.wordColor);
    } else {
      document.documentElement.style.removeProperty("--word-color");
    }
  }

  const syncGear = () => {
    const gear = document.getElementById("settings-toggle");
    gear?.classList.toggle("active", !panel.hidden);
    gear?.setAttribute("aria-expanded", String(!panel.hidden));
  };

  const open = () => {
    if (!panel.hidden) return;
    panel.hidden = false;
    syncGear();
    opts.requestData();
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    syncGear();
  };

  closeBtn.addEventListener("click", close);

  return {
    showData,
    toggle() { panel.hidden ? open() : close(); },
    close,
    syncToggleState: syncGear,
  };
}
