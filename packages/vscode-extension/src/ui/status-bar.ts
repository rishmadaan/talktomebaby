import * as vscode from "vscode";

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "talktomebaby.pauseResume";
  }

  update(state: "playing" | "paused" | "ended", speed: number, sentence: number, total: number) {
    const icon = state === "playing" ? "$(debug-pause)" : "$(play)";
    this.item.text = `${icon} ${speed}x · ${sentence + 1}/${total}`;
    this.item.tooltip = "TalkToMeBaby: click to pause/resume";
    this.item.show();
  }

  hide() { this.item.hide(); }
  dispose() { this.item.dispose(); }
}
