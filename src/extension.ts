import * as vscode from "vscode";
import { AudioManager } from "./managers/audio-manager";
import { HighlightManager } from "./managers/highlight-manager";
import { ApiKeyManager } from "./managers/api-key-manager";
import { PlaybackWebviewProvider } from "./webview/webview-provider";
import { parseDocument, parseSelection } from "./utils/text-parser";

const log = vscode.window.createOutputChannel("Read TTS", { log: true });

let audioManager: AudioManager;
let highlightManager: HighlightManager;
let apiKeyManager: ApiKeyManager;
let webviewProvider: PlaybackWebviewProvider;
let activeEditor: vscode.TextEditor | undefined;

export function activate(context: vscode.ExtensionContext) {
  log.info("Read TTS extension activating...");

  // Initialize managers
  audioManager = new AudioManager();
  highlightManager = new HighlightManager();
  apiKeyManager = new ApiKeyManager(context);

  // Initialize webview
  webviewProvider = new PlaybackWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PlaybackWebviewProvider.viewType,
      webviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Connect audio manager to webview
  audioManager.setWebviewProvider(webviewProvider);

  // Set up webview → extension message handler
  webviewProvider.setMessageHandler(async (msg) => {
    log.info(`Webview message: ${msg.command}`);
    switch (msg.command) {
      case "ready":
        await sendProviderStatus();
        break;
      case "audioEnded":
        audioManager.onAudioEnded(
          msg.sentenceIndex as number | undefined,
          msg.playbackId as number | undefined
        );
        break;
      case "togglePauseResume":
        audioManager.pauseResume();
        break;
      case "stopPlayback":
        audioManager.stop();
        highlightManager.clear();
        break;
      case "selectProviderFromWebview": {
        const name = msg.provider as string;
        const config = vscode.workspace.getConfiguration("read-tts");
        await config.update("provider", name, vscode.ConfigurationTarget.Global);
        const provider = await apiKeyManager.getProvider(name);
        if (provider) {
          audioManager.setProvider(provider);
          audioManager.clearCache();
        }
        await config.update("voice", "", vscode.ConfigurationTarget.Global);
        await sendProviderStatus();
        break;
      }
      case "setApiKeyFromWebview": {
        const success = await apiKeyManager.setApiKey(msg.provider as string | undefined);
        if (success) {
          const provider = await apiKeyManager.getProvider();
          if (provider) {
            audioManager.setProvider(provider);
          }
        }
        await sendProviderStatus();
        break;
      }
      case "selectVoiceFromWebview": {
        const voiceId = msg.voice as string;
        const voiceConfig = vscode.workspace.getConfiguration("read-tts");
        await voiceConfig.update("voice", voiceId, vscode.ConfigurationTarget.Global);
        audioManager.clearCache();
        break;
      }
      case "seekPrevious":
        audioManager.seekPrevious();
        break;
      case "error":
        log.error(`Webview error: ${msg.message}`);
        break;
    }
  });

  // Listen for sentence changes to update highlights
  context.subscriptions.push(
    audioManager.onEvent((event) => {
      if (
        event.type === "sentenceChange" &&
        event.sentenceIndex !== undefined
      ) {
        const sentences = audioManager.getSentences();
        if (activeEditor && sentences[event.sentenceIndex]) {
          highlightManager.highlightSentence(
            activeEditor,
            sentences[event.sentenceIndex]
          );
        }
      } else if (event.type === "stateChange") {
        if (event.state === "idle") {
          highlightManager.clear();
        }
        const stats = audioManager.getCacheStats();
        webviewProvider.postMessage({
          command: "cacheStats",
          ...stats,
        });
      }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("read-tts.speakDocument", () =>
      handleSpeakDocument()
    ),
    vscode.commands.registerCommand("read-tts.speakSelection", () =>
      handleSpeakSelection()
    ),
    vscode.commands.registerCommand("read-tts.startFromCursor", () =>
      handleStartFromCursor()
    ),
    vscode.commands.registerCommand("read-tts.pauseResume", () =>
      audioManager.pauseResume()
    ),
    vscode.commands.registerCommand("read-tts.stop", () => {
      audioManager.stop();
      highlightManager.clear();
    }),
    vscode.commands.registerCommand("read-tts.setApiKey", () =>
      handleSetApiKey()
    ),
    vscode.commands.registerCommand("read-tts.selectProvider", () =>
      handleSelectProvider()
    )
  );

  // Refresh highlight color and provider status when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("read-tts.highlightColor")) {
        highlightManager.refreshDecorationType();
      }
      if (e.affectsConfiguration("read-tts.provider")) {
        await sendProviderStatus();
      }
    })
  );

  // Cleanup
  context.subscriptions.push(log, {
    dispose() {
      audioManager.dispose();
      highlightManager.dispose();
      webviewProvider.dispose();
    },
  });

  log.info("Read TTS extension activated");
}

async function sendProviderStatus() {
  const config = vscode.workspace.getConfiguration("read-tts");
  const activeProvider = config.get<string>("provider") || "sarvam";
  const providers = await apiKeyManager.getProviderStatuses();
  webviewProvider.postMessage({
    command: "updateProviderStatus",
    providers,
    activeProvider,
  });
  // Also send voice list for the active provider
  const voices = await apiKeyManager.getVoicesForProvider(activeProvider);
  const activeVoice = config.get<string>("voice") || "";
  webviewProvider.postMessage({
    command: "updateVoices",
    voices,
    activeVoice,
  });
}

async function ensureProvider(): Promise<boolean> {
  const provider = await apiKeyManager.getProvider();
  if (!provider) {
    const action = await vscode.window.showInformationMessage(
      "No TTS API key configured. Set one now?",
      "Set API Key",
      "Cancel"
    );
    if (action === "Set API Key") {
      const success = await apiKeyManager.setApiKey();
      if (success) {
        const newProvider = await apiKeyManager.getProvider();
        if (newProvider) {
          audioManager.setProvider(newProvider);
          return true;
        }
      }
    }
    return false;
  }
  audioManager.setProvider(provider);
  return true;
}

async function handleSpeakDocument() {
  log.info("handleSpeakDocument called");
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    log.warn("No active editor");
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  log.info(`Active editor: ${editor.document.fileName}`);

  // Capture the editor reference before reveal() steals focus
  activeEditor = editor;

  log.info("Calling ensureProvider...");
  if (!(await ensureProvider())) {
    log.warn("ensureProvider returned false — no provider");
    return;
  }
  log.info("Provider ready");

  const sentences = parseDocument(editor.document);
  log.info(`Parsed ${sentences.length} sentences from document`);

  if (sentences.length === 0) {
    vscode.window.showInformationMessage(
      "No readable text found in document"
    );
    return;
  }

  // Open the sidebar player panel
  log.info("Revealing webview...");
  await webviewProvider.reveal();
  log.info(`Webview revealed. Ready: ${webviewProvider.isReady()}`);

  // Start playback — withProgress closes when first sentence is sent
  log.info("Starting playback...");
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Read TTS: Generating audio...",
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => {
        audioManager.stop();
      });
      try {
        await audioManager.startPlayback(sentences);
        log.info("startPlayback resolved");
      } catch (err) {
        log.error(`startPlayback error: ${err}`);
      }
    }
  );
}

async function handleSpeakSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("No text selected");
    return;
  }

  activeEditor = editor;

  if (!(await ensureProvider())) return;

  const sentences = parseSelection(editor.document, editor.selection);
  log.info(`Parsed ${sentences.length} sentences from selection`);

  if (sentences.length === 0) {
    vscode.window.showInformationMessage(
      "No readable text in selection"
    );
    return;
  }

  await webviewProvider.reveal();
  await audioManager.startPlayback(sentences);
}

async function handleStartFromCursor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  activeEditor = editor;

  if (!(await ensureProvider())) return;

  const sentences = parseDocument(editor.document);
  if (sentences.length === 0) {
    vscode.window.showInformationMessage("No readable text found");
    return;
  }

  // Find the sentence containing the cursor
  const cursorOffset = editor.document.offsetAt(editor.selection.active);
  let startIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentenceStart = editor.document.offsetAt(
      sentences[i].range.start
    );
    const sentenceEnd = editor.document.offsetAt(
      sentences[i].range.end
    );
    if (cursorOffset >= sentenceStart && cursorOffset <= sentenceEnd) {
      startIndex = i;
      break;
    }
    if (sentenceStart > cursorOffset) {
      startIndex = i;
      break;
    }
    startIndex = i;
  }

  log.info(`Starting from sentence ${startIndex} of ${sentences.length}`);
  await webviewProvider.reveal();
  await audioManager.startPlayback(sentences, startIndex);
}

async function handleSetApiKey() {
  const success = await apiKeyManager.setApiKey();
  if (success) {
    const provider = await apiKeyManager.getProvider();
    if (provider) {
      audioManager.setProvider(provider);
    }
  }
  await sendProviderStatus();
}

async function handleSelectProvider() {
  const providerName = await apiKeyManager.selectProvider();
  if (providerName) {
    const provider = await apiKeyManager.getProvider(providerName);
    if (provider) {
      audioManager.setProvider(provider);
      audioManager.clearCache();
    }
  }
  await sendProviderStatus();
}

export function deactivate() {}
