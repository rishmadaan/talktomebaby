import * as vscode from "vscode";
import { SentenceInfo } from "../utils/text-parser";

export class HighlightManager {
  private decorationType: vscode.TextEditorDecorationType;
  private currentEditor: vscode.TextEditor | undefined;

  constructor() {
    this.decorationType = this.createDecorationType();
  }

  private createDecorationType(): vscode.TextEditorDecorationType {
    const config = vscode.workspace.getConfiguration("read-tts");
    const customColor = config.get<string>("highlightColor");

    return vscode.window.createTextEditorDecorationType({
      backgroundColor: customColor || undefined,
      light: {
        backgroundColor: customColor || "rgba(255, 235, 59, 0.3)",
      },
      dark: {
        backgroundColor: customColor || "rgba(255, 235, 59, 0.15)",
      },
      isWholeLine: false,
      overviewRulerColor: "rgba(255, 235, 59, 0.6)",
      overviewRulerLane: vscode.OverviewRulerLane.Center,
    });
  }

  highlightSentence(
    editor: vscode.TextEditor,
    sentence: SentenceInfo
  ) {
    this.currentEditor = editor;
    editor.setDecorations(this.decorationType, [
      { range: sentence.range },
    ]);

    // Scroll to keep current sentence visible
    editor.revealRange(
      sentence.range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  }

  clear() {
    if (this.currentEditor) {
      this.currentEditor.setDecorations(this.decorationType, []);
    }
  }

  refreshDecorationType() {
    this.clear();
    this.decorationType.dispose();
    this.decorationType = this.createDecorationType();
  }

  dispose() {
    this.clear();
    this.decorationType.dispose();
  }
}
