import * as vscode from "vscode";
import { parseDocument, DocumentModel } from "./core/document-model";
import { buildChunks, Chunk } from "./core/chunker";
import { SynthesisService } from "./synthesis/synthesis-service";
import { DiskCache } from "./synthesis/disk-cache";
import { EdgeProvider } from "./synthesis/edge";
import { TtsProvider } from "./synthesis/provider";
import { ReaderPanel, ReaderSettings } from "./ui/reader-panel";
import { EditorSync } from "./ui/editor-sync";
import { StatusBar } from "./ui/status-bar";

let log: vscode.LogOutputChannel;

class ReadingSession {
  readonly model: DocumentModel;
  readonly chunks: Chunk[];
  readonly panel: ReaderPanel;
  readonly editorSync: EditorSync;
  private synthesis: SynthesisService;
  private disposables: vscode.Disposable[] = [];
  private editPrompted = false;
  state: "playing" | "paused" | "ended" = "paused";
  position = { wordIndex: -1, sentenceIndex: -1 };

  constructor(
    readonly docUri: vscode.Uri,
    text: string,
    version: number,
    provider: TtsProvider,
    voice: string,
    cache: DiskCache,
    extensionUri: vscode.Uri,
    private onEvent: (s: ReadingSession) => void
  ) {
    this.model = parseDocument(text, docUri.toString(), version);
    this.chunks = buildChunks(this.model);
    this.synthesis = new SynthesisService(provider, voice, cache);
    this.panel = new ReaderPanel(extensionUri, vscode.workspace.asRelativePath(docUri));
    this.editorSync = new EditorSync(docUri, this.model, (idx) => this.jumpToWord(idx));

    // Send init eagerly so it is queued ahead of any jumpToWord that a command
    // issues immediately after construction (readFromCursor / readSelection).
    // post() buffers until the webview reports "ready", flushing in FIFO order;
    // queuing init first guarantees the webview builds its engine before any
    // seekToWord arrives. Waiting for the "ready" message instead would flush
    // the already-queued seekToWord BEFORE init ran — losing the jump.
    const cfg = vscode.workspace.getConfiguration("speakittome");
    const settings: ReaderSettings = {
      speed: cfg.get("speed", 1.0),
      fontSize: cfg.get("readerFontSize", 16),
      sentenceColor: cfg.get("highlight.sentenceColor", ""),
      wordColor: cfg.get("highlight.wordColor", ""),
    };
    this.panel.sendInit(this.model, this.chunks.length, settings);

    this.panel.onMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          // init was already queued in the constructor and flushes first.
          break;
        case "requestChunk": {
          const chunk = this.chunks[msg.chunkIndex];
          if (!chunk) break;
          try {
            const a = await this.synthesis.request(chunk, msg.priority);
            this.panel.sendChunk(msg.chunkIndex, a.audio, a.format, a.timings);
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            log.error(`chunk ${msg.chunkIndex} failed: ${m}`);
            this.panel.sendChunkFailed(msg.chunkIndex, m);
          }
          break;
        }
        case "position":
          this.position = { wordIndex: msg.wordIndex, sentenceIndex: msg.sentenceIndex };
          this.editorSync.highlight(msg.sentenceIndex, msg.wordIndex, true);
          this.onEvent(this);
          break;
        case "state":
          this.state = msg.state;
          this.onEvent(this);
          break;
        case "speedChanged":
          await vscode.workspace.getConfiguration("speakittome")
            .update("speed", msg.rate, vscode.ConfigurationTarget.Global);
          break;
        case "error":
          log.error(`webview: ${msg.message}`);
          break;
      }
    });

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== docUri.toString() || e.contentChanges.length === 0) return;
        if (this.editPrompted) return;
        this.editPrompted = true;
        this.panel.control("pause");
        void vscode.window
          .showInformationMessage("SpeakItToMe: document changed — restart from current position?", "Restart here", "Stop")
          .then((choice) => {
            this.editPrompted = false;
            if (choice === "Restart here") {
              void vscode.commands.executeCommand("speakittome.readFromCursor");
            } else if (choice === "Stop") {
              void vscode.commands.executeCommand("speakittome.stop");
            }
          });
      })
    );
  }

  pauseResume() { this.panel.control(this.state === "playing" ? "pause" : "resume"); }
  jumpToWord(wordIndex: number) { this.panel.seekToWord(wordIndex); }
  dispose() {
    this.synthesis.abortAll();
    this.editorSync.dispose();
    for (const d of this.disposables) d.dispose();
    this.panel.dispose();
  }
}

let session: ReadingSession | undefined;

function makeProvider(): TtsProvider {
  // Task 21 expands this to elevenlabs/say/sarvam with key management
  return new EdgeProvider();
}

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("SpeakItToMe", { log: true });
  context.subscriptions.push(log);
  const cfg = () => vscode.workspace.getConfiguration("speakittome");

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  async function startSession(editor: vscode.TextEditor) {
    session?.dispose();
    const provider = makeProvider();
    const voice = cfg().get<string>(`voice.${provider.id}`) || provider.defaultVoice;
    const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, "audio-cache").fsPath;
    const cache = new DiskCache(cacheDir, cfg().get<number>("cacheSizeMB", 200)! * 1024 * 1024);
    session = new ReadingSession(
      editor.document.uri, editor.document.getText(), editor.document.version,
      provider, voice, cache, context.extensionUri,
      (s) => {
        statusBar.update(s.state, vscode.workspace.getConfiguration("speakittome").get("speed", 1), Math.max(0, s.position.sentenceIndex), s.model.sentences.length);
      }
    );
    session.panel.onDispose(() => { statusBar.hide(); session = undefined; });
  }

  const needEditor = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) void vscode.window.showWarningMessage("SpeakItToMe: no active editor");
    return editor;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("speakittome.readDocument", async () => {
      const editor = needEditor();
      if (editor) await startSession(editor);
    }),
    vscode.commands.registerCommand("speakittome.readFromCursor", async () => {
      const editor = needEditor();
      if (!editor) return;
      await startSession(editor);
      const offset = editor.document.offsetAt(editor.selection.active);
      const word = session!.model.words.find((w) => w.source.end > offset) ?? session!.model.words[0];
      if (word) session!.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("speakittome.readSelection", async () => {
      const editor = needEditor();
      if (!editor || editor.selection.isEmpty) return;
      await startSession(editor); // selection = start at selection, read on
      const offset = editor.document.offsetAt(editor.selection.start);
      const word = session!.model.words.find((w) => w.source.end > offset);
      if (word) session!.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("speakittome.jumpToCursor", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !session) return;
      if (cfg().get<string>("editorClickToJump", "alt-j") === "off") return;
      const idx = session.editorSync.wordAtPosition(editor.document, editor.selection.active);
      if (idx !== undefined) session.jumpToWord(idx);
    }),
    vscode.commands.registerCommand("speakittome.pauseResume", () => session?.pauseResume()),
    vscode.commands.registerCommand("speakittome.stop", () => { session?.dispose(); session = undefined; statusBar.hide(); }),
    vscode.commands.registerCommand("speakittome.openReader", () => session?.panel.reveal()),
    vscode.commands.registerCommand("speakittome.setApiKey", () =>
      vscode.window.showInformationMessage("SpeakItToMe: key management arrives with premium providers (Task 18+)")),
    vscode.commands.registerCommand("speakittome.selectProvider", () =>
      vscode.window.showInformationMessage("SpeakItToMe: provider picker arrives in Task 21")),
    vscode.commands.registerCommand("speakittome.selectVoice", () =>
      vscode.window.showInformationMessage("SpeakItToMe: voice picker arrives in Task 21")),
    { dispose() { session?.dispose(); } }
  );
  log.info("SpeakItToMe activated");
}

export function deactivate() {}
