// @ts-check

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const playPauseBtn = document.getElementById("play-pause");
  const stopBtn = document.getElementById("stop");
  const seekBackBtn = document.getElementById("seek-back");
  const seekForwardBtn = document.getElementById("seek-forward");
  const statusEl = document.getElementById("status");
  const sentenceEl = document.getElementById("sentence-text");
  const progressFill = document.getElementById("progress-fill");
  const providerOptionsEl = document.getElementById("provider-options");
  const voiceSelectEl = document.getElementById("voice-select");
  const speedControlsEl = document.getElementById("speed-controls");

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
  let currentSpeed = 1.0;
  let currentPlaybackId = 0;
  let currentSentenceIndex = -1;
  let playRequestId = 0;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  // AudioContext must be resumed from a user gesture within the webview.
  // Eagerly resume on any click so it's ready when playAudio arrives.
  document.addEventListener("click", function () {
    var ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }
  }, true);

  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.style.color = "";
  }

  function setError(text) {
    statusEl.textContent = "Error: " + text;
    statusEl.style.color = "var(--vscode-errorForeground, red)";
    vscode.postMessage({ command: "error", message: text });
  }

  // Returns current playback position in seconds within the audio buffer
  function getCurrentPosition() {
    if (isPaused) return pausedAt;
    if (isPlaying && audioCtx) {
      return (audioCtx.currentTime - startedAt) * currentSpeed;
    }
    return 0;
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

  async function playBuffer(buffer, offset, requestId) {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (requestId !== undefined && requestId !== playRequestId) {
      return;
    }

    stopCurrentAudio();
    currentBuffer = buffer;
    const safeOffset = Math.max(0, Math.min(offset, buffer.duration));

    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.playbackRate.value = currentSpeed;
    sourceNode.connect(ctx.destination);

    sourceNode.onended = function () {
      if (isPlaying && !isPaused) {
        isPlaying = false;
        vscode.postMessage({
          command: "audioEnded",
          playbackId: currentPlaybackId,
          sentenceIndex: currentSentenceIndex,
        });
      }
    };

    sourceNode.start(0, safeOffset);
    startedAt = ctx.currentTime - safeOffset / currentSpeed;
    isPlaying = true;
    isPaused = false;
  }

  function seekBy(seconds) {
    if (!currentBuffer) return;
    var pos = getCurrentPosition();
    var newPos = pos + seconds;

    if (newPos < 0) {
      vscode.postMessage({ command: "seekPrevious" });
      return;
    }
    if (newPos >= currentBuffer.duration) {
      stopCurrentAudio();
      isPlaying = false;
      vscode.postMessage({
        command: "audioEnded",
        playbackId: currentPlaybackId,
        sentenceIndex: currentSentenceIndex,
      });
      return;
    }

    if (isPaused) {
      pausedAt = newPos;
    } else {
      playBuffer(currentBuffer, newPos);
      playPauseBtn.textContent = "\u23F8";
    }
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
          const requestId = ++playRequestId;
          const ctx = getAudioContext();
          // Extract base64 from data URL
          const base64Data = msg.audioBase64 || msg.audioUrl.split(",")[1];
          const arrayBuffer = base64ToArrayBuffer(base64Data);
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          if (requestId !== playRequestId) {
            return;
          }

          currentPlaybackId = msg.playbackId || 0;
          currentSentenceIndex = msg.sentenceIndex;

          setStatus(
            `Sentence ${msg.sentenceIndex + 1} of ${msg.totalSentences}`
          );
          sentenceEl.textContent = msg.sentenceText;
          sentenceEl.classList.remove("empty");
          playPauseBtn.textContent = "\u23F8";
          playPauseBtn.disabled = false;
          stopBtn.disabled = false;
          seekBackBtn.disabled = false;
          seekForwardBtn.disabled = false;
          updateProgress(msg.sentenceIndex, msg.totalSentences);

          await playBuffer(audioBuffer, 0, requestId);
        } catch (e) {
          setError("Failed to decode audio: " + e.message);
        }
        break;

      case "pause":
        if (isPlaying && !isPaused && sourceNode && audioCtx) {
          pausedAt = (audioCtx.currentTime - startedAt) * currentSpeed;
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
          sourceNode.playbackRate.value = currentSpeed;
          sourceNode.connect(ctx.destination);
          sourceNode.onended = function () {
            if (isPlaying && !isPaused) {
              isPlaying = false;
              vscode.postMessage({
                command: "audioEnded",
                playbackId: currentPlaybackId,
                sentenceIndex: currentSentenceIndex,
              });
            }
          };
          sourceNode.start(0, pausedAt);
          startedAt = ctx.currentTime - pausedAt / currentSpeed;
          isPlaying = true;
          isPaused = false;
          playPauseBtn.textContent = "\u23F8";
          setStatus("Playing...");
        }
        break;

      case "stop":
        playRequestId++;
        stopCurrentAudio();
        currentBuffer = null;
        currentPlaybackId = 0;
        currentSentenceIndex = -1;
        playPauseBtn.textContent = "\u25B6";
        playPauseBtn.disabled = true;
        stopBtn.disabled = true;
        seekBackBtn.disabled = true;
        seekForwardBtn.disabled = true;
        setStatus("Stopped");
        sentenceEl.textContent =
          "Open a .md or .txt file and click the speaker icon to start reading.";
        sentenceEl.classList.add("empty");
        progressFill.style.width = "0%";
        break;

      case "updateProviderStatus":
        renderProviders(msg.providers, msg.activeProvider);
        break;

      case "updateVoices":
        renderVoices(msg.voices, msg.activeVoice);
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

  // Seek buttons
  seekBackBtn.addEventListener("click", () => {
    seekBy(-10);
  });

  seekForwardBtn.addEventListener("click", () => {
    seekBy(10);
  });

  // Speed buttons
  speedControlsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".speed-btn");
    if (!btn) return;
    const newSpeed = parseFloat(btn.dataset.speed);

    // Update active button
    speedControlsEl.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Apply to current playback — get position before changing speed
    if (sourceNode && isPlaying && audioCtx) {
      var pos = (audioCtx.currentTime - startedAt) * currentSpeed;
      currentSpeed = newSpeed;
      sourceNode.playbackRate.value = newSpeed;
      startedAt = audioCtx.currentTime - pos / newSpeed;
    } else {
      currentSpeed = newSpeed;
    }
  });

  // Voice select
  voiceSelectEl.addEventListener("change", () => {
    vscode.postMessage({ command: "selectVoiceFromWebview", voice: voiceSelectEl.value });
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

  // --- Voice picker ---

  function renderVoices(voices, activeVoice) {
    voiceSelectEl.innerHTML = "";
    var defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Default";
    voiceSelectEl.appendChild(defaultOpt);

    voices.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.label;
      if (v.id === activeVoice) {
        opt.selected = true;
      }
      voiceSelectEl.appendChild(opt);
    });
  }

  // Signal to extension that the webview script is ready to receive messages
  vscode.postMessage({ command: "ready" });
})();
