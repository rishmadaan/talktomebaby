import * as vscode from "vscode";
import { parseDocument, DocumentModel } from "@talktomebaby/engine/core";
import { buildChunks, Chunk } from "@talktomebaby/engine/core";
import {
  SynthesisService, DiskCache, EdgeProvider, ElevenLabsProvider,
  SayProvider, SarvamProvider, TtsProvider, availableProviders,
  resolveProviderId, VoiceCache, withTimeout,
} from "@talktomebaby/engine";
import { ReaderPanel, ReaderSettings, SettingsData, SettingKey, ViewMsg } from "./ui/reader-panel";
import { EditorSync } from "./ui/editor-sync";
import { StatusBar } from "./ui/status-bar";
import { ApiKeyManager } from "./ui/api-key-manager";

let log: vscode.LogOutputChannel;

const PROSE_EXTS = /\.(md|mdx|txt|rst|org|tex|adoc)$/i;

const LAST_SESSION_KEY = "talktomebaby.lastSession";
interface LastSession { uri: string; sentenceIndex: number; savedAt: number }
let lastSaved = 0;

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
  // provider/voice are mutable so an in-place reconfigure can swap them without
  // tearing down the webview. Read via the getters below.
  private _provider: TtsProvider;
  private _voice: string;

  get provider(): TtsProvider { return this._provider; }
  get voice(): string { return this._voice; }

  constructor(
    readonly docUri: vscode.Uri,
    text: string,
    version: number,
    provider: TtsProvider,
    voice: string,
    private readonly cache: DiskCache,
    extensionUri: vscode.Uri,
    private onEvent: (s: ReadingSession) => void,
    private onSettingsMessage: (msg: ViewMsg, session: ReadingSession) => Promise<void>
  ) {
    this._provider = provider;
    this._voice = voice;
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
    const cfg = vscode.workspace.getConfiguration("talktomebaby");
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
          const synthAtRequest = this.synthesis;
          try {
            const a = await this.synthesis.request(chunk, msg.priority);
            // Guard: if a reconfigure replaced the synthesis pipeline while the
            // request was in flight, discard the stale audio — it came from the
            // old provider and the webview has already re-initialised.
            if (this.synthesis !== synthAtRequest) break;
            this.panel.sendChunk(msg.chunkIndex, a.audio, a.format, a.timings);
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            if (this.synthesis !== synthAtRequest || m === "aborted") break; // stale generation — old synthesis aborted by reconfigure
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
          await vscode.workspace.getConfiguration("talktomebaby")
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
          .showInformationMessage("TalkToMeBaby: document changed — restart from current position?", "Restart here", "Stop")
          .then((choice) => {
            this.editPrompted = false;
            if (choice === "Restart here") {
              void vscode.commands.executeCommand("talktomebaby.readFromCursor");
            } else if (choice === "Stop") {
              void vscode.commands.executeCommand("talktomebaby.stop");
            }
          });
      })
    );
  }

  pauseResume() { this.panel.control(this.state === "playing" ? "pause" : "resume"); }
  jumpToWord(wordIndex: number) { this.panel.seekToWord(wordIndex); }

  /**
   * Swap the TTS provider/voice in place WITHOUT tearing down the webview. Aborts
   * the old synthesis pipeline, builds a fresh one, and re-inits the SAME webview
   * at the current sentence — preserving play state (autoplay only if we were
   * playing) and the open settings panel. Used for live provider/voice changes on
   * the same document; document/new-document reads still go through startSession.
   */
  async reconfigure(provider: TtsProvider, voice: string): Promise<void> {
    // Capture position BEFORE we change anything. Policy: a provider/voice
    // switch NEVER auto-starts audio — the session re-primes paused at the
    // current sentence and the user presses play when ready. Predictable
    // beats clever here (user feedback: surprise audio on switch is jarring).
    const sentenceCount = this.model.sentences.length;
    const idx = Math.max(0, Math.min(sentenceCount - 1, this.position.sentenceIndex));
    const firstWord = this.model.sentences[idx]?.words[0];
    const startAtWord = firstWord ? firstWord.index : 0;

    // Tear down only the audio pipeline; reuse the same DiskCache instance.
    this.synthesis.abortAll();
    this._provider = provider;
    this._voice = voice;
    this.synthesis = new SynthesisService(provider, voice, this.cache);

    const cfg = vscode.workspace.getConfiguration("talktomebaby");
    const settings: ReaderSettings = {
      speed: cfg.get("speed", 1.0),
      fontSize: cfg.get("readerFontSize", 16),
      sentenceColor: cfg.get("highlight.sentenceColor", ""),
      wordColor: cfg.get("highlight.wordColor", ""),
    };
    // Re-init the SAME webview. main.ts init() tears down its prior engine and
    // (because the settings panel lives outside #content) keeps the panel open.
    this.panel.sendInit(this.model, this.chunks.length, settings, startAtWord, false);
  }

  dispose() {
    this.synthesis.abortAll();
    this.editorSync.dispose();
    for (const d of this.disposables) d.dispose();
    this.panel.dispose();
  }
}

let session: ReadingSession | undefined;
let restarting = false;

/** Build a provider instance for a given id, prompting for a key if required. */
async function makeProviderById(id: string, keys: ApiKeyManager): Promise<TtsProvider | undefined> {
  switch (id) {
    case "edge": return new EdgeProvider();
    case "say":
      if (process.platform !== "darwin") {
        void vscode.window.showWarningMessage("TalkToMeBaby: macOS say is only available on macOS");
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

async function makeProvider(keys: ApiKeyManager): Promise<TtsProvider | undefined> {
  const raw = vscode.workspace.getConfiguration("talktomebaby").get<string>("provider");
  const id = resolveProviderId(raw, process.platform);
  return makeProviderById(id, keys);
}

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("TalkToMeBaby", { log: true });
  context.subscriptions.push(log);
  const cfg = () => vscode.workspace.getConfiguration("talktomebaby");

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const keys = new ApiKeyManager(context.secrets);
  // Voices don't change mid-session, so cache per provider for the host lifetime.
  const voiceCache = new VoiceCache();

  /** Fetch a provider's voices with a 4-second answer guarantee.
   *  - Real voice lists are cached for the host lifetime.
   *  - The fallback (just the default voice) is NEVER cached — caching it once
   *    pinned Edge to a single voice for the whole session. On timeout we return
   *    the fallback for now, and when the real list eventually lands we cache it
   *    and invoke `onLate` so the open panel can be refreshed. */
  async function fetchVoices(
    provider: TtsProvider,
    onLate?: (voices: { id: string; label: string }[]) => void
  ): Promise<{ id: string; label: string }[]> {
    const hit = voiceCache.get(provider.id);
    if (hit) return hit;

    const fallback = [{ id: provider.defaultVoice, label: provider.defaultVoice }];
    let timedOut = false;
    const real = provider.listVoices()
      .then((v) => {
        if (v && v.length > 1) {
          voiceCache.set(provider.id, v); // cache ONLY real lists
          if (timedOut) onLate?.(v);      // landed after we already showed the fallback
          return v;
        }
        return v && v.length ? v : fallback;
      })
      .catch((err) => {
        log.error(`listVoices(${provider.id}) failed: ${err instanceof Error ? err.message : String(err)}`);
        return fallback;
      });
    const result = await withTimeout(real, 4000, fallback);
    if (result === fallback) timedOut = true;
    return result;
  }

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
        statusBar.update(s.state, vscode.workspace.getConfiguration("talktomebaby").get("speed", 1), Math.max(0, s.position.sentenceIndex), s.model.sentences.length);
        // Persist position (throttled to once per ~3s) so a reload can resume.
        if (s.position.sentenceIndex >= 0) {
          const now = Date.now();
          if (now - lastSaved >= 3000) {
            lastSaved = now;
            void context.workspaceState.update(LAST_SESSION_KEY, {
              uri: s.docUri.toString(),
              sentenceIndex: s.position.sentenceIndex,
              savedAt: now,
            } satisfies LastSession);
          }
        }
        // Clear persisted position when reading completes naturally.
        if (s.state === "ended") {
          void context.workspaceState.update(LAST_SESSION_KEY, undefined);
        }
      },
      handleSettingsMessage
    );
    session.panel.onDispose(() => { statusBar.hide(); session = undefined; });
    // Prefetch the active provider's voices so the first gear-open is instant.
    // fetchVoices() always resolves — no .catch() needed.
    void fetchVoices(provider);
    return true;
  }

  /** Static + current-settings snapshot, with voices from cache or `null` (loading).
   *  Sent IMMEDIATELY on a settingsRequest — no network on the open path. */
  function settingsSnapshot(active: ReadingSession): SettingsData {
    const activeId = active.provider.id;
    const providers = availableProviders(process.platform).map((p) => ({
      id: p.id, label: p.label, description: p.description,
      requiresKey: p.requiresKey, active: p.id === activeId,
    }));
    return {
      providers,
      voices: voiceCache.get(activeId) ?? null, // null = still loading
      activeVoice: active.voice,
      fontSize: cfg().get<number>("readerFontSize", 16),
      sentenceColor: cfg().get<string>("highlight.sentenceColor", ""),
      wordColor: cfg().get<string>("highlight.wordColor", ""),
    };
  }

  /** Send settings data immediately (cache or loading), then — if voices weren't
   *  cached — fetch them and push a follow-up settingsData with them filled in.
   *  fetchVoices() always resolves within ~4s (never throws); if the real list
   *  arrives after the timeout, the onLate callback pushes a second refresh. */
  async function pushSettingsData(active: ReadingSession): Promise<void> {
    active.panel.sendSettingsData(settingsSnapshot(active));
    if (voiceCache.has(active.provider.id)) return;
    const provider = active.provider;
    const pushIfCurrent = (voices: { id: string; label: string }[]) => {
      if (session === active && active.provider === provider) {
        active.panel.sendSettingsData({ ...settingsSnapshot(active), voices });
      }
    };
    const voices = await fetchVoices(provider, pushIfCurrent);
    pushIfCurrent(voices);
  }

  /** Reconfigure the active session in place (same webview), preserving position
   *  and play state. Replaces the old dispose-and-recreate restart. */
  async function reconfigureActive(provider: TtsProvider, voice: string): Promise<void> {
    if (restarting) return;
    restarting = true;
    try {
      if (!session) return;
      const active = session;
      try {
        await active.reconfigure(provider, voice);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showWarningMessage("TalkToMeBaby: couldn't apply the change — " + message);
        return;
      }
      // Push fresh settings data so the open panel reflects the new provider/voice.
      await pushSettingsData(active);
    } finally {
      restarting = false;
    }
  }

  /** Handle settings-panel messages. Only fires while a session exists. */
  async function handleSettingsMessage(msg: ViewMsg, current: ReadingSession): Promise<void> {
    if (session !== current) return; // stale panel from a disposed session
    switch (msg.type) {
      case "settingsRequest":
        await pushSettingsData(current);
        break;
      case "setProvider": {
        if (msg.id === current.provider.id) break;
        const desc = availableProviders(process.platform).find((p) => p.id === msg.id);
        if (!desc) break;
        // If this provider requires a key, check whether one already exists.
        // If not, makeProviderById will prompt — a newly stored key may expose
        // different voices, so we invalidate the cache after a successful prompt.
        const hadKey = desc.requiresKey ? !!(await keys.getKey(msg.id)) : true;
        const provider = await makeProviderById(msg.id, keys);
        if (!provider) {
          // Cancelled key prompt or unavailable — snap the UI back to reality.
          await pushSettingsData(current);
          break;
        }
        if (!hadKey) voiceCache.invalidate(msg.id); // new key stored — evict stale voice list
        const voice = cfg().get<string>(`voice.${provider.id}`) || provider.defaultVoice;
        await cfg().update("provider", msg.id, vscode.ConfigurationTarget.Global);
        await reconfigureActive(provider, voice);
        break;
      }
      case "setVoice": {
        if (msg.id === current.voice) break;
        await cfg().update(`voice.${current.provider.id}`, msg.id, vscode.ConfigurationTarget.Global);
        // Reuse the same provider instance (holds any prompted key); just swap voice.
        await reconfigureActive(current.provider, msg.id);
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
    if (!editor) void vscode.window.showWarningMessage("TalkToMeBaby: this command needs the text editor. Right-click the tab → Reopen Editor With → Text Editor.");
    return editor;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("talktomebaby.readDocument", async () => {
      const doc = await resolveActiveDocument();
      if (!doc) {
        void vscode.window.showWarningMessage("TalkToMeBaby: open a prose file (md, txt, ...) first");
        return;
      }
      await startSession(doc);
    }),
    vscode.commands.registerCommand("talktomebaby.readFromCursor", async () => {
      const editor = needEditor();
      if (!editor) return;
      if (!(await startSession(editor.document)) || !session) return;
      const offset = editor.document.offsetAt(editor.selection.active);
      const word = session.model.words.find((w) => w.source.end > offset) ?? session.model.words[0];
      if (word) session.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("talktomebaby.readSelection", async () => {
      const editor = needEditor();
      if (!editor || editor.selection.isEmpty) return;
      if (!(await startSession(editor.document)) || !session) return; // selection = start at selection, read on
      const offset = editor.document.offsetAt(editor.selection.start);
      const word = session.model.words.find((w) => w.source.end > offset);
      if (word) session.jumpToWord(word.index);
    }),
    vscode.commands.registerCommand("talktomebaby.jumpToCursor", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !session) return;
      if (cfg().get<string>("editorClickToJump", "alt-j") === "off") return;
      const idx = session.editorSync.wordAtPosition(editor.document, editor.selection.active);
      if (idx !== undefined) session.jumpToWord(idx);
    }),
    vscode.commands.registerCommand("talktomebaby.pauseResume", () => session?.pauseResume()),
    vscode.commands.registerCommand("talktomebaby.stop", () => {
      void context.workspaceState.update(LAST_SESSION_KEY, undefined);
      session?.dispose(); session = undefined; statusBar.hide();
    }),
    vscode.commands.registerCommand("talktomebaby.openReader", () => session?.panel.reveal()),
    vscode.commands.registerCommand("talktomebaby.selectProvider", async () => {
      const activeId = resolveProviderId(cfg().get<string>("provider"), process.platform);
      const items = availableProviders(process.platform).map((p) => {
        const isActive = p.id === activeId;
        const keyNote = p.requiresKey ? " · key required" : "";
        return {
          id: p.id,
          label: `${isActive ? "$(check) " : ""}${p.label}`,
          description: `${p.description}${keyNote}${isActive ? " (current)" : ""}`,
        };
      });
      const pick = await vscode.window.showQuickPick(items, { placeHolder: "TalkToMeBaby TTS provider" });
      if (!pick || pick.id === activeId) return;
      const desc = availableProviders(process.platform).find((p) => p.id === pick.id)!;
      // Check for an existing key before calling makeProviderById so we can
      // detect when a NEW key is prompted and invalidate the voice cache.
      const hadKey = desc.requiresKey ? !!(await keys.getKey(pick.id)) : true;
      const provider = await makeProviderById(pick.id, keys);
      if (!provider) return; // cancelled key prompt — no change
      if (!hadKey) voiceCache.invalidate(pick.id); // new key stored — evict stale voice list
      await cfg().update("provider", pick.id, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`TalkToMeBaby: Provider set to ${desc.label}.`);
      if (session) {
        const voice = cfg().get<string>(`voice.${provider.id}`) || provider.defaultVoice;
        await reconfigureActive(provider, voice);
      }
    }),
    vscode.commands.registerCommand("talktomebaby.selectVoice", async () => {
      const provider = session?.provider ?? (await makeProvider(keys));
      if (!provider) return;
      const activeVoice = session?.voice
        ?? cfg().get<string>(`voice.${provider.id}`) ?? provider.defaultVoice;
      const voices = await fetchVoices(provider);
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
      void vscode.window.showInformationMessage(`TalkToMeBaby: Voice set to ${pick.voiceLabel}.`);
      if (session) await reconfigureActive(session.provider, pick.id);
    }),
    vscode.commands.registerCommand("talktomebaby.setApiKey", async () => {
      const pick = await vscode.window.showQuickPick(["elevenlabs", "sarvam"], { placeHolder: "Provider" });
      if (!pick) return;
      const stored = await keys.promptAndStore(pick);
      // A new key may expose different voices (different plan tier), so evict
      // the cached voice list so the next fetch reflects the new credentials.
      if (stored) voiceCache.invalidate(pick);
    }),
    { dispose() { session?.dispose(); } }
  );

  // Offer to resume a session that was interrupted by a window reload.
  const last = context.workspaceState.get<LastSession>(LAST_SESSION_KEY);
  if (last && Date.now() - last.savedAt < 12 * 60 * 60 * 1000) {
    const name = vscode.workspace.asRelativePath(vscode.Uri.parse(last.uri));
    void vscode.window
      .showInformationMessage(
        `TalkToMeBaby: you were reading ${name} (sentence ${last.sentenceIndex + 1}). Resume?`,
        "Resume",
        "Dismiss"
      )
      .then(async (choice) => {
        if (choice !== "Resume") {
          await context.workspaceState.update(LAST_SESSION_KEY, undefined);
          return;
        }
        let doc: vscode.TextDocument;
        try {
          doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(last.uri));
        } catch {
          void vscode.window.showWarningMessage(`TalkToMeBaby: couldn't reopen ${name} to resume.`);
          await context.workspaceState.update(LAST_SESSION_KEY, undefined);
          return;
        }
        await vscode.window.showTextDocument(doc, { preserveFocus: false });
        if (!(await startSession(doc)) || !session) return;
        const model = session.model;
        const clampedIdx = Math.max(0, Math.min(model.sentences.length - 1, last.sentenceIndex));
        const firstWord = model.sentences[clampedIdx]?.words[0];
        if (firstWord) session.jumpToWord(firstWord.index);
      });
  }

  log.info("TalkToMeBaby activated");
}

export function deactivate() {}
