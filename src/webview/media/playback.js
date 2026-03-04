// @ts-check

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const playPauseBtn = document.getElementById("play-pause");
  const stopBtn = document.getElementById("stop");
  const statusEl = document.getElementById("status");
  const sentenceEl = document.getElementById("sentence-text");
  const progressFill = document.getElementById("progress-fill");

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
        if (isPlaying && !isPaused && audioCtx) {
          pausedAt = audioCtx.currentTime - startedAt;
          stopCurrentAudio();
          isPaused = true;
          playPauseBtn.textContent = "\u25B6";
          setStatus("Paused");
        }
        break;

      case "resume":
        if (isPaused && currentBuffer) {
          playBuffer(currentBuffer, pausedAt);
          playPauseBtn.textContent = "\u23F8";
          setStatus("Resuming...");
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
})();
