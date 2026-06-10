export interface PlayerBarOptions {
  initialSpeed: number;
  onPlayPause(): void;
  onSpeed(rate: number): void;
  onPrevSentence(): void;
  onNextSentence(): void;
}
export interface PlayerBar {
  setState(state: "playing" | "paused" | "ended"): void;
  setPosition(sentenceIndex: number, totalSentences: number): void;
  showError(message: string): void;
}
export function initPlayerBar(opts: PlayerBarOptions): PlayerBar {
  return { setState() {}, setPosition() {}, showError(m) { console.error(m); } };
}
