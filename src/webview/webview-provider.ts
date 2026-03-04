import * as vscode from "vscode";

export class PlaybackWebviewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "read-tts.playback";

  private view: vscode.WebviewView | undefined;
  private pendingMessages: unknown[] = [];
  private webviewReady = false;
  private messageHandler:
    | ((message: { command: string; [key: string]: unknown }) => void)
    | undefined;
  private messageDisposable: vscode.Disposable | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.webviewReady = false;

    // Listen for "ready" signal from webview script before flushing messages
    const readyDisposable = webviewView.webview.onDidReceiveMessage(
      (msg: { command: string }) => {
        if (msg.command === "ready") {
          this.webviewReady = true;
          // Flush any messages that were queued before the webview script loaded
          for (const pendingMsg of this.pendingMessages) {
            webviewView.webview.postMessage(pendingMsg);
          }
          this.pendingMessages = [];
          readyDisposable.dispose();
        }
      }
    );

    // Re-register message handler if one was set before the view was resolved
    if (this.messageHandler) {
      this.messageDisposable?.dispose();
      this.messageDisposable = webviewView.webview.onDidReceiveMessage(
        this.messageHandler
      );
    }

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      this.messageDisposable?.dispose();
      readyDisposable.dispose();
      this.view = undefined;
      this.webviewReady = false;
    });
  }

  postMessage(message: unknown) {
    if (this.view && this.webviewReady) {
      this.view.webview.postMessage(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  setMessageHandler(
    handler: (message: { command: string; [key: string]: unknown }) => void
  ) {
    this.messageHandler = handler;
    if (this.view) {
      this.messageDisposable?.dispose();
      this.messageDisposable =
        this.view.webview.onDidReceiveMessage(handler);
    }
  }

  isReady(): boolean {
    return this.view !== undefined;
  }

  async reveal() {
    // Focus the sidebar view to make it visible
    await vscode.commands.executeCommand("read-tts.playback.focus");
  }

  dispose() {
    this.messageDisposable?.dispose();
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "playback.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "playback.js")
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource};
             script-src 'nonce-${nonce}';
             media-src data: blob:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Read TTS</title>
</head>
<body>
  <audio id="audio-player" preload="auto"></audio>

  <div class="provider-section">
    <label class="provider-label">Provider</label>
    <div class="provider-options" id="provider-options"></div>
  </div>

  <div class="controls">
    <button id="play-pause" disabled title="Play/Pause">&#9654;</button>
    <button id="stop" disabled title="Stop">&#9632;</button>
  </div>

  <div class="progress-bar">
    <div id="progress-fill" class="progress-fill"></div>
  </div>

  <div id="status" class="status">Ready</div>

  <div id="sentence-text" class="sentence-text empty">
    Open a .md or .txt file and click the speaker icon to start reading.
  </div>

  <div id="cache-info" class="cache-info"></div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
