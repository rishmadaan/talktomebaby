import * as vscode from "vscode";
import { parseDocument, DocumentModel } from "./core/document-model";
import { buildChunks, Chunk } from "./core/chunker";
import { SynthesisService } from "./synthesis/synthesis-service";
import { DiskCache } from "./synthesis/disk-cache";
import { EdgeProvider } from "./synthesis/edge";
import { ElevenLabsProvider } from "./synthesis/elevenlabs";
import { SayProvider } from "./synthesis/say";
import { SarvamProvider } from "./synthesis/sarvam";
import { TtsProvider } from "./synthesis/provider";
import { availableProviders } from "./synthesis/provider-catalog";
import { ReaderPanel, ReaderSettings, SettingsData, SettingKey, ViewMsg } from "./ui/reader-panel";
import { EditorSync } from "./ui/editor-sync";
import { StatusBar } from "./ui/status-bar";
import { ApiKeyManager } from "./ui/api-key-manager";

let log: vscode.LogOutputChannel;

const PROSE_EXTS = /\.(md|mdx|txt|rst|org|tex|adoc)$/i;

async function resolveActiveDocument(): Promise<vscode.TextDocument | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor) return editor.document;
  // Active tab may be a custom editor (e.g. a markdown WYSIWYG webview) — pull its URI.
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri =
    input instanceof vscode.TabInputCustom ? input.uri :
    input instanceof vscode.TabInputText ? input.uri : undefined;
  if (uri && PROSE_EXTS.test(uri.path)) {
    return vscode.workspace.openTextDocument(uri);
  }
  return undefined;
}

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
    readonly provider: TtsProvider,
    readonly voice: string,
    cache: DiskCache,
    extensionUri: vscode.Uri,
    private onEvent: (s: ReadingSession) => void,
    private onSettingsMessage: (msg: ViewMsg, session: ReadingSession) => Promise<void>
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
        case "settingsRequest":
        case "setProvider":
        case "setVoice":
        case "setSetting":
          await this.onSettingsMessage(msg, this);
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
let restarting = false;

async function makeProvider(keys: ApiKeyManager): Promise<TtsProvider | undefined> {
  const id = vscode.workspace.getConfiguration("speakittome").get<string>("provider", "edge");
  switch (id) {
    case "edge": return new EdgeProvider();
    case "say":
      if (process.platform !== "darwin") {
        void vscode.window.showWarningMessage("SpeakItToMe: macOS say is only available on macOS");
        return undefined;
      }
      return new SayProvider();
    case "elevenlabs": {
      const key = (await keys.getKey("elevenlabs")) ?? (await keys.promptAndStore("elevenlabs"));
      return key ? new ElevenLabsProvider(key) : undefined;
    }
    case "sarvam": {
      const key = (await keys.getKey("sarvam")) ?? (await keys.promptAndStore("sarvam"));
      return key ? new SarvamProvider(key) : undefined;
    }
    default: return new EdgeProvider();
  }
}

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("SpeakItToMe", { log: true });
  context.subscriptions.push(log);
  const cfg = () => vscode.workspace.getConfiguration("speakittome");

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const keys = new ApiKeyManager(context.secrets);

  async function startSession(doc: vscode.TextDocument): Promise<boolean> {
    const provider = await makeProvider(keys);
    if (!provider) return false;
    session?.dispose();
    const voice = cfg().get<string>(`voice.${provider.id}`) || provider.defaultVoice;
    const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, "audio-cache").fsPath;
    const cache = new DiskCache(cacheDir, cfg().get<number>("cacheSizeMB", 200)! * 1024 * 1024);
    session = new ReadingSession(
      doc.uri, doc.getText(), doc.version,
      provider, voice, cache, context.extensionUri,
      (s) => {
        statusBar.update(s.state, vscode.workspace.getConfiguration("speakittome").get("speed", 1), Math.max(0, s.position.sentenceIndex), s.model.sentences.length);
      },
      handleSettingsMessage
    );
    session.panel.onDispose(() => { statusBar.hide(); session = undefined; });
    return true;
  }

  /** Build the settings snapshot the panel renders. Reuses the active session's
   *  provider instance (which holds any prompted key) to list voices. */
  async function buildSettingsData(active: ReadingSession): Promise<SettingsData> {
    const activeId = active.provider.id;
    const providers = availableProviders(process.platform).map((p) => ({
      id: p.id, label: p.label, description: p.description,
      requiresKey: p.requiresKey, active: p.id === activeId,
    }));
    let voices: { id: string; label: string }[] = [];
    try {
      voices = await active.provider.listVoices();
    } catch (err) {
      log.error(`listVoices failed: ${err instanceof Error ? err.message : String(err)}`);
      voices = [{ id: active.voice, label: active.voice }];
    }
    return {
      providers, voices, activeVoice: active.voice,
      fontSize: cfg().get<number>("readerFontSize", 16),
      sentenceColor: cfg().get<string>("highlight.sentenceColor", ""),
      wordColor: cfg().get<string>("highlight.wordColor", ""),
    };
  }

  /** Restart the active session on the same document, resuming at the start of
   *  the sentence that was playing. Used after a live provider/voice change. */
  async function restartSessionAtCurrentPosition(): Promise<void> {
    if (restarting) return;
    restarting = true;
    try {
      if (!session) return;
      const uri = session.docUri;
      const sentenceCount = session.model.sentences.length;
      const idx = Math.max(0, Math.min(sentenceCount - 1, session.position.sentenceIndex));
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showWarningMessage("SpeakItToMe: couldn't restart playback — " + message);
        return;
      }
      if (!(await startSession(doc)) || !session) return;
      const sentence = session.model.sentences[idx];
      const firstWord = sentence?.words[0];
      if (firstWord) session.jumpToWord(firstWord.index);
    } finally {
      restarting = false;
    }
  }

  /** Handle settings-panel messages. Only fires while a session exists. */
  async function handleSettingsMessage(msg: ViewMsg, current: ReadingSession): Promise<void> {
    if (session !== current) return; // stale panel from a disposed session
    switch (msg.type) {
      case "settingsRequest":
        current.panel.sendSettingsData(await buildSettingsData(current));
        break;
      case "setProvider": {
        if (msg.id === current.provider.id) break;
        const desc = availableProviders(process.platform).find((p) => p.id === msg.id);
        if (!desc) break;
        // Ensure a key exists for key-required providers before committing.
        if (desc.requiresKey && !(await keys.getKey(msg.id))) {
          const stored = await keys.promptAndStore(msg.id);
          if (!stored) {
            // Cancelled — snap the UI back to reality.
            current.panel.sendSettingsData(await buildSettingsData(current));
            break;
          }
        }
        await cfg().update("provider", msg.id, vscode.ConfigurationTarget.Global);
        await restartSessionAtCurrentPosition();
        break;
      }
      case "setVoice": {
        if (msg.id === current.voice) break;
        await cfg().update(`voice.${current.provider.id}`, msg.id, vscode.ConfigurationTarget.Global);
        await restartSessionAtCurrentPosition();
        break;
      }
      case "setSetting":
        // The webview already applied font/color optimistically and the value
        // it sent IS the new truth, so no settingsData echo is needed here —
        // avoids re-listing voices (a network/exec call) on every stepper click.
        await applySetting(msg.key, msg.value);
        break;
    }
  }

  async function applySetting(key: SettingKey, value: string | number): Promise<void> {
    await cfg().update(key, value, vscode.ConfigurationTarget.Global);
  }

  const needEditor = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) void vscode.window.showWarningMessage("SpeakItToMe: this command needs the text editor. Right-click the tab → Reopen Editor With → Text Editor.");
    return editor;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("speakittome.readDocument", async () => {
      const doc = await resolveActiveDocument();
      if (!doc) {
        void vscode.window.showWarningMessage("SpeakItToMe: open a prose file (md, txt, ...) first");
        return;
      }
      await startSession(doc);
    }),
    vscode.commands.registerCommand("speakittome.readFromCursor", async () => {
      const editor = needEditor();
      if (!editor) return;
      if (!(await startSession(editor.document)) || !session) return;
      const offset = editor.document.offsetAt(editor.selection.active);
      const word = session.model.words.find((w) => w.source.end > offset) ?? session.model.words[0];
      if (word) session.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("speakittome.readSelection", async () => {
      const editor = needEditor();
      if (!editor || editor.selection.isEmpty) return;
      if (!(await startSession(editor.document)) || !session) return; // selection = start at selection, read on
      const offset = editor.document.offsetAt(editor.selection.start);
      const word = session.model.words.find((w) => w.source.end > offset);
      if (word) session.jumpToWord(word.index);
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
    vscode.commands.registerCommand("speakittome.selectProvider", async () => {
      const activeId = cfg().get<string>("provider", "edge");
      const items = availableProviders(process.platform).map((p) => {
        const isActive = p.id === activeId;
        const keyNote = p.requiresKey ? " · key required" : "";
        return {
          id: p.id,
          label: `${isActive ? "$(check) " : ""}${p.label}`,
          description: `${p.description}${keyNote}${isActive ? " (current)" : ""}`,
        };
      });
      const pick = await vscode.window.showQuickPick(items, { placeHolder: "SpeakItToMe TTS provider" });
      if (!pick || pick.id === activeId) return;
      const desc = availableProviders(process.platform).find((p) => p.id === pick.id)!;
      if (desc.requiresKey && !(await keys.getKey(pick.id))) {
        if (!(await keys.promptAndStore(pick.id))) return; // cancelled — no change
      }
      await cfg().update("provider", pick.id, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`SpeakItToMe: Provider set to ${desc.label}.`);
      await restartSessionAtCurrentPosition();
    }),
    vscode.commands.registerCommand("speakittome.selectVoice", async () => {
      const provider = session?.provider ?? (await makeProvider(keys));
      if (!provider) return;
      const activeVoice = session?.voice
        ?? cfg().get<string>(`voice.${provider.id}`) ?? provider.defaultVoice;
      const voices = await provider.listVoices();
      const pick = await vscode.window.showQuickPick(
        voices.map((v) => ({
          label: `${v.id === activeVoice ? "$(check) " : ""}${v.label}`,
          description: v.id === activeVoice ? `${v.id} (current)` : v.id,
          id: v.id,
          voiceLabel: v.label,
        })),
        { placeHolder: `Voice for ${provider.label}` }
      );
      if (!pick || pick.id === activeVoice) return;
      await cfg().update(`voice.${provider.id}`, pick.id, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`SpeakItToMe: Voice set to ${pick.voiceLabel}.`);
      await restartSessionAtCurrentPosition();
    }),
    vscode.commands.registerCommand("speakittome.setApiKey", async () => {
      const pick = await vscode.window.showQuickPick(["elevenlabs", "sarvam"], { placeHolder: "Provider" });
      if (pick) await keys.promptAndStore(pick);
    }),
    { dispose() { session?.dispose(); } }
  );
  log.info("SpeakItToMe activated");
}

export function deactivate() {}
