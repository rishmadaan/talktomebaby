import { Engine, AudioLike } from "./engine";
import { renderModel } from "./renderer";
import { HighlightController } from "./highlight";
import { buildChunks, Chunk } from "../core/chunker";
import { DocumentModel } from "../core/document-model";
import { ChunkTimings } from "../core/timing";
import { initPlayerBar, PlayerBar } from "./player-bar";
import { initSettingsPanel, SettingsPanel } from "./settings-panel";
import { SettingsData } from "../ui/reader-panel";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

let engine: Engine | null = null;
let highlight: HighlightController | null = null;
let playerBar: PlayerBar | null = null;
let settingsPanel: SettingsPanel | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

const FORMAT_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav" };

function init(model: DocumentModel, chunks: Chunk[], settings: { speed: number; fontSize: number; sentenceColor: string; wordColor: string }) {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  engine?.stop();
  highlight?.destroy();
  highlight = null;

  const root = document.getElementById("content")!;
  document.documentElement.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
  if (settings.sentenceColor) document.documentElement.style.setProperty("--sentence-color", settings.sentenceColor);
  if (settings.wordColor) document.documentElement.style.setProperty("--word-color", settings.wordColor);

  renderModel(root, model);
  highlight = new HighlightController(root);

  settingsPanel = initSettingsPanel({
    onProvider: (id) => vscode.postMessage({ type: "setProvider", id }),
    onVoice: (id) => vscode.postMessage({ type: "setVoice", id }),
    onSetting: (key, value) => vscode.postMessage({ type: "setSetting", key, value }),
    requestData: () => vscode.postMessage({ type: "settingsRequest" }),
  });

  playerBar = initPlayerBar({
    initialSpeed: settings.speed,
    onPlayPause: () => { engine!.isPlaying ? engine!.pause() : engine!.resume(); },
    onSpeed: (rate) => { engine!.setSpeed(rate); vscode.postMessage({ type: "speedChanged", rate }); },
    onPrevSentence: () => jumpSentence(-1),
    onNextSentence: () => jumpSentence(+1),
    onSettings: () => settingsPanel?.toggle(),
  });

  engine = new Engine(model, chunks, {
    requestChunk: (chunkIndex, priority) => vscode.postMessage({ type: "requestChunk", chunkIndex, priority }),
    onPosition: (wordIndex, sentenceIndex) => {
      highlight?.setActive(wordIndex, sentenceIndex);
      playerBar?.setPosition(sentenceIndex, model.sentences.length);
      vscode.postMessage({ type: "position", wordIndex, sentenceIndex });
    },
    onState: (state) => {
      playerBar?.setState(state);
      vscode.postMessage({ type: "state", state });
    },
    createAudio: () => new Audio() as unknown as AudioLike,
    // Uint8Array -> BlobPart cast: TS 5.9's typed-array generic widens the backing
    // buffer to ArrayBufferLike (incl. SharedArrayBuffer), which isn't a BlobPart.
    // The runtime value is always a plain ArrayBuffer-backed Uint8Array.
    makeUrl: (audio, format) =>
      URL.createObjectURL(new Blob([audio as BlobPart], { type: FORMAT_MIME[format] ?? "audio/mpeg" })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  });

  engine.setSpeed(settings.speed);

  // click any word to jump
  root.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("span[data-w]");
    if (!target || !engine) return;
    engine.jumpToWord(Number(target.getAttribute("data-w")));
    highlight?.engageFollow();
  });

  function jumpSentence(delta: number) {
    if (!engine) return;
    const next = Math.max(0, Math.min(model.sentences.length - 1, engine.currentSentence + delta));
    const firstWord = model.sentences[next].words[0];
    if (firstWord) engine.jumpToWord(firstWord.index);
  }

  tickTimer = setInterval(() => engine?.tick(), 100);
  engine.start(0);
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      const chunks = buildChunks(msg.model);
      init(msg.model, chunks, msg.settings);
      break;
    }
    case "chunkAudio":
      engine?.receiveChunk(msg.chunkIndex, {
        audio: msg.audio instanceof Uint8Array ? msg.audio : new Uint8Array(msg.audio.data ?? msg.audio),
        format: msg.format, timings: msg.timings as ChunkTimings,
      });
      break;
    case "chunkFailed":
      playerBar?.showError(`Couldn't synthesize part ${msg.chunkIndex + 1}: ${msg.error}`);
      engine?.pause();
      break;
    case "seekToWord":
      engine?.jumpToWord(msg.wordIndex);
      highlight?.engageFollow();
      break;
    case "settingsData":
      settingsPanel?.showData(msg as SettingsData);
      break;
    case "control":
      if (msg.action === "pause") engine?.pause();
      if (msg.action === "resume") engine?.resume();
      if (msg.action === "stop") { engine?.stop(); highlight?.clear(); if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
      break;
  }
});

vscode.postMessage({ type: "ready" });
