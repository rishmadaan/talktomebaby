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
  webviewProvider.setMessageHandler((msg) => {
    log.info(`Webview message: ${msg.command}`);
    switch (msg.command) {
      case "audioEnded":
        audioManager.onAudioEnded();
        break;
      case "togglePauseResume":
        audioManager.pauseResume();
        break;
      case "stopPlayback":
        audioManager.stop();
        highlightManager.clear();
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
        const editor = vscode.window.activeTextEditor;
        const sentences = audioManager.getSentences();
        if (editor && sentences[event.sentenceIndex]) {
          highlightManager.highlightSentence(
            editor,
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

  // Refresh highlight color when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("read-tts.highlightColor")) {
        highlightManager.refreshDecorationType();
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
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  if (!(await ensureProvider())) return;

  const sentences = parseDocument(editor.document);
  log.info(`Parsed ${sentences.length} sentences from document`);

  if (sentences.length === 0) {
    vscode.window.showInformationMessage(
      "No readable text found in document"
    );
    return;
  }

  // Open the sidebar player panel
  await webviewProvider.reveal();

  // Show progress while generating first sentence
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
      await audioManager.startPlayback(sentences);
    }
  );
}

async function handleSpeakSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("No text selected");
    return;
  }

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
}

export function deactivate() {}
