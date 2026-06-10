import * as vscode from "vscode";
import { DocumentModel } from "../core/document-model";
import { ChunkTimings } from "../core/timing";

export interface ReaderSettings { speed: number; fontSize: number; sentenceColor: string; wordColor: string }

/** Keys the settings panel may write directly to config (Global). */
export type SettingKey = "readerFontSize" | "highlight.sentenceColor" | "highlight.wordColor";

export interface SettingsData {
  providers: { id: string; label: string; description: string; requiresKey: boolean; active: boolean }[];
  voices: { id: string; label: string }[];
  activeVoice: string;
  fontSize: number;
  sentenceColor: string;
  wordColor: string;
}

export type ViewMsg =
  | { type: "ready" }
  | { type: "requestChunk"; chunkIndex: number; priority: boolean }
  | { type: "position"; wordIndex: number; sentenceIndex: number }
  | { type: "state"; state: "playing" | "paused" | "ended" }
  | { type: "speedChanged"; rate: number }
  | { type: "error"; message: string }
  | { type: "settingsRequest" }
  | { type: "setProvider"; id: string }
  | { type: "setVoice"; id: string }
  | { type: "setSetting"; key: SettingKey; value: string | number };

export class ReaderPanel {
  private panel: vscode.WebviewPanel;
  private ready = false;
  private pending: unknown[] = [];
  private _onMessage = new vscode.EventEmitter<ViewMsg>();
  readonly onMessage = this._onMessage.event;
  private _onDispose = new vscode.EventEmitter<void>();
  readonly onDispose = this._onDispose.event;

  constructor(extensionUri: vscode.Uri, title: string) {
    this.panel = vscode.window.createWebviewPanel(
      "speakittome.reader", `SpeakItToMe — ${title}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    const css = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "reader.css"));
    const js = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "reader.js"));
    const nonce = String(Math.random()).slice(2);
    this.panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}'; media-src blob:; img-src ${this.panel.webview.cspSource};">
<link rel="stylesheet" href="${css}"></head>
<body><div id="content"></div><div id="player-bar"></div>
<script nonce="${nonce}" src="${js}"></script></body></html>`;

    this.panel.webview.onDidReceiveMessage((msg: ViewMsg) => {
      if (msg.type === "ready") {
        this.ready = true;
        for (const m of this.pending.splice(0)) void this.panel.webview.postMessage(m);
      }
      this._onMessage.fire(msg);
    });
    this.panel.onDidDispose(() => this._onDispose.fire());
  }

  post(msg: unknown) {
    if (this.ready) void this.panel.webview.postMessage(msg);
    else this.pending.push(msg);
  }

  sendInit(model: DocumentModel, chunkCount: number, settings: ReaderSettings) {
    this.post({ type: "init", model, chunkCount, settings });
  }
  sendChunk(chunkIndex: number, audio: Uint8Array, format: string, timings: ChunkTimings) {
    this.post({ type: "chunkAudio", chunkIndex, audio, format, timings });
  }
  sendChunkFailed(chunkIndex: number, error: string) {
    this.post({ type: "chunkFailed", chunkIndex, error });
  }
  sendSettingsData(data: SettingsData) { this.post({ type: "settingsData", ...data }); }
  control(action: "pause" | "resume" | "stop") { this.post({ type: "control", action }); }
  seekToWord(wordIndex: number) { this.post({ type: "seekToWord", wordIndex }); }
  reveal() { this.panel.reveal(undefined, true); }
  dispose() { this.panel.dispose(); }
}
