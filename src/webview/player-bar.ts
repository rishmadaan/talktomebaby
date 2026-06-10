export interface PlayerBarOptions {
  initialSpeed: number;
  onPlayPause(): void;
  onSpeed(rate: number): void;
  onPrevSentence(): void;
  onNextSentence(): void;
  onSettings(): void;
}
export interface PlayerBar {
  setState(state: "playing" | "paused" | "ended"): void;
  setPosition(sentenceIndex: number, totalSentences: number): void;
  showError(message: string): void;
}

const PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function initPlayerBar(opts: PlayerBarOptions): PlayerBar {
  const bar = document.getElementById("player-bar")!;
  bar.textContent = "";

  const btn = (label: string, onClick: () => void, title?: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    bar.appendChild(b);
    return b;
  };

  const prev = btn("⏮", opts.onPrevSentence, "Previous sentence");
  const playPause = btn("▶", opts.onPlayPause, "Play/Pause");
  const next = btn("⏭", opts.onNextSentence, "Next sentence");

  const speedButtons = new Map<number, HTMLButtonElement>();
  const slider = document.createElement("input");

  const setSpeedUI = (rate: number) => {
    for (const [r, b] of speedButtons) b.classList.toggle("active", Math.abs(r - rate) < 0.01);
    slider.value = String(rate);
  };
  const applySpeed = (rate: number) => { setSpeedUI(rate); opts.onSpeed(rate); };

  for (const r of PRESETS) speedButtons.set(r, btn(`${r}x`, () => applySpeed(r)));
  slider.type = "range"; slider.min = "0.5"; slider.max = "2"; slider.step = "0.05";
  slider.title = "Fine speed";
  slider.addEventListener("input", () => applySpeed(Number(slider.value)));
  bar.appendChild(slider);

  const status = document.createElement("span");
  status.id = "player-status";
  bar.appendChild(status);

  const gear = btn("⚙", opts.onSettings, "Settings");
  gear.id = "settings-toggle";

  setSpeedUI(opts.initialSpeed);

  return {
    setState(state) {
      playPause.textContent = state === "playing" ? "⏸" : "▶";
      if (state === "ended") status.textContent = "Finished";
      prev.disabled = next.disabled = state === "ended";
    },
    setPosition(sentenceIndex, totalSentences) {
      status.textContent = `Sentence ${sentenceIndex + 1} / ${totalSentences}`;
    },
    showError(message) {
      status.textContent = `⚠ ${message}`;
    },
  };
}
