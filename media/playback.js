// @ts-check

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const playPauseBtn = document.getElementById("play-pause");
  const stopBtn = document.getElementById("stop");
  const statusEl = document.getElementById("status");
  const sentenceEl = document.getElementById("sentence-text");
  const progressFill = document.getElementById("progress-fill");
  const providerOptionsEl = document.getElementById("provider-options");

  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {AudioBufferSourceNode | null} */
  let sourceNode = null;
  /** @type {AudioBuffer | null} */
  let currentBuffer = null;
  let isPlaying = false;
  let isPaused = false;
  let pausedAt = 0;
  let startedAt = 0;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.style.color = "";
  }

  function setError(text) {
    statusEl.textContent = "Error: " + text;
    statusEl.style.color = "var(--vscode-errorForeground, red)";
    vscode.postMessage({ command: "error", message: text });
  }

  function stopCurrentAudio() {
    if (sourceNode) {
      try {
        sourceNode.onended = null;
        sourceNode.stop();
      } catch (e) {
        // ignore if already stopped
      }
      sourceNode.disconnect();
      sourceNode = null;
    }
    isPlaying = false;
    isPaused = false;
    pausedAt = 0;
    startedAt = 0;
  }

  function playBuffer(buffer, offset) {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    stopCurrentAudio();
    currentBuffer = buffer;

    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(ctx.destination);

    sourceNode.onended = function () {
      if (isPlaying && !isPaused) {
        isPlaying = false;
        vscode.postMessage({ command: "audioEnded" });
      }
    };

    sourceNode.start(0, offset);
    startedAt = ctx.currentTime - offset;
    isPlaying = true;
    isPaused = false;
  }

  // Convert base64 to ArrayBuffer
  function base64ToArrayBuffer(base64) {
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    return byteArray.buffer;
  }

  // Receive messages from extension
  window.addEventListener("message", async (event) => {
    const msg = event.data;

    switch (msg.command) {
      case "playAudio":
        try {
          const ctx = getAudioContext();
          // Extract base64 from data URL
          const base64Data = msg.audioUrl.split(",")[1];
          const arrayBuffer = base64ToArrayBuffer(base64Data);
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

          setStatus(
            `Sentence ${msg.sentenceIndex + 1} of ${msg.totalSentences}`
          );
          sentenceEl.textContent = msg.sentenceText;
          sentenceEl.classList.remove("empty");
          playPauseBtn.textContent = "\u23F8";
          playPauseBtn.disabled = false;
          stopBtn.disabled = false;
          updateProgress(msg.sentenceIndex, msg.totalSentences);

          playBuffer(audioBuffer, 0);
        } catch (e) {
          setError("Failed to decode audio: " + e.message);
        }
        break;

      case "pause":
        if (isPlaying && !isPaused && sourceNode && audioCtx) {
          pausedAt = audioCtx.currentTime - startedAt;
          // Stop source node without clearing all state
          try {
            sourceNode.onended = null;
            sourceNode.stop();
          } catch (e) { /* ignore */ }
          sourceNode.disconnect();
          sourceNode = null;
          isPlaying = false;
          isPaused = true;
          playPauseBtn.textContent = "\u25B6";
          setStatus("Paused");
        }
        break;

      case "resume":
        if (isPaused && currentBuffer) {
          const ctx = getAudioContext();
          sourceNode = ctx.createBufferSource();
          sourceNode.buffer = currentBuffer;
          sourceNode.connect(ctx.destination);
          sourceNode.onended = function () {
            if (isPlaying && !isPaused) {
              isPlaying = false;
              vscode.postMessage({ command: "audioEnded" });
            }
          };
          sourceNode.start(0, pausedAt);
          startedAt = ctx.currentTime - pausedAt;
          isPlaying = true;
          isPaused = false;
          playPauseBtn.textContent = "\u23F8";
          setStatus("Playing...");
        }
        break;

      case "stop":
        stopCurrentAudio();
        currentBuffer = null;
        playPauseBtn.textContent = "\u25B6";
        playPauseBtn.disabled = true;
        stopBtn.disabled = true;
        setStatus("Stopped");
        sentenceEl.textContent =
          "Open a .md or .txt file and click the speaker icon to start reading.";
        sentenceEl.classList.add("empty");
        progressFill.style.width = "0%";
        break;

      case "updateProviderStatus":
        renderProviders(msg.providers, msg.activeProvider);
        break;

      case "cacheStats":
        const cacheEl = document.getElementById("cache-info");
        if (cacheEl) {
          cacheEl.textContent = `Cache: ${msg.entries} sentences, ${msg.memoryMB} MB`;
        }
        break;
    }
  });

  // Play/Pause button
  playPauseBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "togglePauseResume" });
  });

  // Stop button
  stopBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "stopPlayback" });
  });

  function updateProgress(current, total) {
    if (total > 0) {
      const pct = Math.round(((current + 1) / total) * 100);
      progressFill.style.width = pct + "%";
    }
  }

  // --- Provider picker ---

  function renderProviders(providers, activeProvider) {
    providerOptionsEl.innerHTML = "";
    providers.forEach(function (p) {
      const btn = document.createElement("button");
      btn.className =
        "provider-btn" +
        (p.name === activeProvider ? " active" : "") +
        (!p.hasKey ? " no-key" : "");
      btn.title = p.hasKey
        ? p.label + " (API key configured)"
        : p.label + " (no API key)";

      const label = document.createElement("span");
      label.className = "provider-btn-label";
      label.textContent = p.label;

      const badge = document.createElement("span");
      badge.className = "provider-badge " + (p.hasKey ? "configured" : "missing");
      badge.textContent = p.hasKey ? "Ready" : "No key";

      btn.appendChild(label);
      btn.appendChild(badge);

      btn.addEventListener("click", function () {
        if (!p.hasKey) {
          vscode.postMessage({ command: "setApiKeyFromWebview", provider: p.name });
        } else {
          vscode.postMessage({ command: "selectProviderFromWebview", provider: p.name });
        }
      });

      providerOptionsEl.appendChild(btn);
    });
  }

  // Signal to extension that the webview script is ready to receive messages
  vscode.postMessage({ command: "ready" });
})();
