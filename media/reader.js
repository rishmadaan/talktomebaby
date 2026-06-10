"use strict";
(() => {
  // src/webview/engine.ts
  var PREFETCH = 2;
  var Engine = class {
    constructor(model, chunks, cb) {
      this.model = model;
      this.chunks = chunks;
      this.cb = cb;
      for (const s of model.sentences) {
        if (s.words.length)
          this.sentenceFirstWord.set(s.index, s.words[0].index);
        for (const w of s.words)
          this.wordToSentence.set(w.index, s.index);
      }
      for (const c of chunks)
        for (const ref of c.words)
          this.wordToChunk.set(ref.wordIndex, c.index);
    }
    loaded = /* @__PURE__ */ new Map();
    currentChunk = 0;
    currentWord = -1;
    speed = 1;
    playing = false;
    pendingJumpWord = null;
    wordToSentence = /* @__PURE__ */ new Map();
    wordToChunk = /* @__PURE__ */ new Map();
    sentenceFirstWord = /* @__PURE__ */ new Map();
    start(chunkIndex) {
      this.currentChunk = chunkIndex;
      this.playing = true;
      this.cb.requestChunk(chunkIndex, true);
      this.prefetch(chunkIndex + 1);
    }
    /**
     * Load (and seek to) a word without playing. Used after a reconfigure when the
     * session was paused: we want the new voice primed at the same spot so a later
     * resume/play picks up exactly where the listener left off, but we must NOT
     * auto-play. Sets currentWord so resume() and currentSentence resolve correctly,
     * and reports "paused" so the UI shows a play (not pause) affordance.
     */
    primeAt(wordIndex) {
      const chunkIndex = this.wordToChunk.get(wordIndex);
      if (chunkIndex === void 0)
        return;
      this.currentChunk = chunkIndex;
      this.currentWord = wordIndex;
      this.playing = false;
      const lc = this.loaded.get(chunkIndex);
      if (lc && lc.timingsMs !== null) {
        const t = lc.timingsMs.find((w) => w.wordIndex === wordIndex);
        lc.audio.currentTime = t ? t.start / 1e3 : 0;
      } else {
        this.pendingJumpWord = wordIndex;
        this.cb.requestChunk(chunkIndex, true);
      }
      this.prefetch(chunkIndex + 1);
      this.cb.onState("paused");
    }
    prefetch(from) {
      for (let i = from; i < Math.min(from + PREFETCH, this.chunks.length); i++) {
        if (!this.loaded.has(i))
          this.cb.requestChunk(i, false);
      }
    }
    receiveChunk(chunkIndex, data) {
      if (this.loaded.has(chunkIndex))
        return;
      const url = this.cb.makeUrl(data.audio, data.format);
      const audio = this.cb.createAudio();
      audio.preservesPitch = true;
      audio.playbackRate = this.speed;
      audio.src = url;
      const lc = {
        audio,
        url,
        rawTimings: data.timings,
        timingsMs: data.timings.unit === "ms" ? data.timings.words : null
      };
      audio.onloadedmetadata = () => {
        if (lc.timingsMs === null) {
          const durMs = audio.duration * 1e3;
          lc.timingsMs = data.timings.words.map((w) => ({
            wordIndex: w.wordIndex,
            start: w.start * durMs,
            end: w.end * durMs
          }));
        }
        this.maybeStartChunk(chunkIndex);
      };
      audio.onended = () => this.handoff(chunkIndex);
      this.loaded.set(chunkIndex, lc);
      if (!Number.isNaN(audio.duration))
        audio.onloadedmetadata?.();
    }
    maybeStartChunk(chunkIndex) {
      if (chunkIndex !== this.currentChunk)
        return;
      const lc = this.loaded.get(chunkIndex);
      if (!lc || lc.timingsMs === null)
        return;
      if (this.pendingJumpWord !== null) {
        const t = lc.timingsMs.find((w) => w.wordIndex === this.pendingJumpWord);
        lc.audio.currentTime = t ? t.start / 1e3 : 0;
        this.pendingJumpWord = null;
      }
      if (!this.playing)
        return;
      void lc.audio.play();
      this.cb.onState("playing");
    }
    handoff(endedChunk) {
      if (endedChunk !== this.currentChunk)
        return;
      const next = this.currentChunk + 1;
      if (next >= this.chunks.length) {
        this.playing = false;
        this.cb.onState("ended");
        return;
      }
      this.currentChunk = next;
      this.prefetch(next + 1);
      const lc = this.loaded.get(next);
      if (lc && lc.timingsMs !== null) {
        lc.audio.currentTime = 0;
        void lc.audio.play();
        this.cb.onState("playing");
      } else {
        this.cb.requestChunk(next, true);
      }
    }
    pause() {
      const lc = this.loaded.get(this.currentChunk);
      lc?.audio.pause();
      this.playing = false;
      this.cb.onState("paused");
    }
    resume() {
      this.playing = true;
      const sentence = this.wordToSentence.get(Math.max(this.currentWord, 0)) ?? 0;
      const firstWord = this.sentenceFirstWord.get(sentence);
      if (firstWord !== void 0)
        this.jumpToWord(firstWord);
      else
        this.maybeStartChunk(this.currentChunk);
    }
    jumpToWord(wordIndex) {
      const chunkIndex = this.wordToChunk.get(wordIndex);
      if (chunkIndex === void 0)
        return;
      const prev = this.loaded.get(this.currentChunk);
      prev?.audio.pause();
      this.currentChunk = chunkIndex;
      this.currentWord = wordIndex;
      this.playing = true;
      const lc = this.loaded.get(chunkIndex);
      if (lc && lc.timingsMs !== null) {
        const t = lc.timingsMs.find((w) => w.wordIndex === wordIndex);
        lc.audio.currentTime = t ? t.start / 1e3 : 0;
        void lc.audio.play();
        this.cb.onState("playing");
        this.prefetch(chunkIndex + 1);
      } else {
        this.pendingJumpWord = wordIndex;
        this.cb.requestChunk(chunkIndex, true);
        this.prefetch(chunkIndex + 1);
      }
    }
    setSpeed(rate) {
      this.speed = rate;
      for (const lc of this.loaded.values())
        lc.audio.playbackRate = rate;
    }
    stop() {
      for (const lc of this.loaded.values()) {
        lc.audio.pause();
        this.cb.revokeUrl(lc.url);
      }
      this.loaded.clear();
      this.playing = false;
    }
    // Called on a ~100ms interval by main.ts; resolves current word from audio time.
    tick() {
      const lc = this.loaded.get(this.currentChunk);
      if (!lc || lc.timingsMs === null)
        return;
      const ms = lc.audio.currentTime * 1e3;
      let word = -1;
      for (const w of lc.timingsMs) {
        if (ms >= w.start)
          word = w.wordIndex;
        else
          break;
      }
      if (word >= 0 && word !== this.currentWord) {
        this.currentWord = word;
        this.cb.onPosition(word, this.wordToSentence.get(word) ?? 0);
      }
    }
    get isPlaying() {
      return this.playing;
    }
    get currentSentence() {
      return this.wordToSentence.get(Math.max(this.currentWord, 0)) ?? 0;
    }
  };

  // src/webview/renderer.ts
  var TAG = {
    paragraph: "p",
    "list-item": "li",
    quote: "blockquote",
    code: "pre"
  };
  function renderSentence(s) {
    const span = document.createElement("span");
    span.className = "sentence";
    span.setAttribute("data-s", String(s.index));
    s.words.forEach((w, i) => {
      if (i > 0)
        span.appendChild(document.createTextNode(" "));
      const ws = document.createElement("span");
      ws.setAttribute("data-w", String(w.index));
      ws.textContent = w.text;
      span.appendChild(ws);
    });
    return span;
  }
  function renderBlock(b) {
    const tag = b.kind === "heading" ? `h${Math.min(b.level ?? 1, 6)}` : TAG[b.kind] ?? "p";
    const el = document.createElement(tag);
    el.className = `block block-${b.kind}`;
    if (b.kind === "code") {
      el.textContent = b.codeText ?? "";
      el.title = "Code block (not read aloud)";
      return el;
    }
    b.sentences.forEach((s, i) => {
      if (i > 0)
        el.appendChild(document.createTextNode(" "));
      el.appendChild(renderSentence(s));
    });
    return el;
  }
  function renderModel(root, model) {
    root.textContent = "";
    for (const block of model.blocks)
      root.appendChild(renderBlock(block));
  }

  // src/webview/highlight.ts
  var HighlightController = class {
    constructor(root, onReturn) {
      this.root = root;
      this.onReturn = onReturn;
      this.pill = document.createElement("button");
      this.pill.id = "return-pill";
      this.pill.textContent = "\u2193 Return to playback";
      this.pill.hidden = true;
      document.body.appendChild(this.pill);
      this.pill.addEventListener("click", () => this.engageFollow());
      window.addEventListener("scroll", () => {
        if (this.scrolling)
          return;
        if (this.following) {
          this.following = false;
          this.pill.hidden = false;
        }
      }, { passive: true, signal: this.aborter.signal });
      window.addEventListener("scrollend", () => {
        this.scrolling = false;
      }, { passive: true, signal: this.aborter.signal });
    }
    activeSentence = null;
    activeWord = null;
    following = true;
    scrolling = false;
    pill;
    aborter = new AbortController();
    destroy() {
      this.aborter.abort();
      this.pill.remove();
      this.clear();
    }
    engageFollow() {
      this.following = true;
      this.pill.hidden = true;
      this.scrollToActive();
      this.onReturn?.();
    }
    setActive(wordIndex, sentenceIndex) {
      const word = this.root.querySelector(`span[data-w="${wordIndex}"]`);
      const sentence = this.root.querySelector(`span[data-s="${sentenceIndex}"]`);
      if (this.activeWord)
        this.activeWord.classList.remove("word-active");
      if (this.activeSentence && this.activeSentence !== sentence)
        this.activeSentence.classList.remove("sentence-active");
      word?.classList.add("word-active");
      sentence?.classList.add("sentence-active");
      this.activeWord = word;
      this.activeSentence = sentence;
      if (this.following)
        this.scrollToActive();
    }
    clear() {
      this.activeWord?.classList.remove("word-active");
      this.activeSentence?.classList.remove("sentence-active");
      this.activeWord = this.activeSentence = null;
    }
    scrollToActive() {
      if (!this.activeSentence)
        return;
      const rect = this.activeSentence.getBoundingClientRect();
      const margin = window.innerHeight * 0.25;
      if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
        this.scrolling = true;
        this.activeSentence.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  };

  // src/core/chunker.ts
  function buildChunks(model, maxChars = 2200, minChars = 1400) {
    const blockOf = /* @__PURE__ */ new Map();
    model.blocks.forEach((b, bi) => b.sentences.forEach((s) => blockOf.set(s.index, bi)));
    const chunks = [];
    let cur = [];
    let curLen = 0;
    const flush = () => {
      if (!cur.length)
        return;
      const parts = [];
      const words = [];
      let pos = 0;
      for (const si of cur) {
        const s = model.sentences[si];
        if (parts.length) {
          parts.push(" ");
          pos += 1;
        }
        let search = 0;
        for (const w of s.words) {
          const at = s.text.indexOf(w.text, search);
          if (at >= 0) {
            words.push({ wordIndex: w.index, charStart: pos + at, charEnd: pos + at + w.text.length });
            search = at + w.text.length;
          }
        }
        parts.push(s.text);
        pos += s.text.length;
      }
      chunks.push({ index: chunks.length, text: parts.join(""), sentenceIndexes: cur, words });
      cur = [];
      curLen = 0;
    };
    for (const s of model.sentences) {
      const addLen = s.text.length + (cur.length ? 1 : 0);
      if (cur.length && curLen + addLen > maxChars)
        flush();
      const prevBlock = cur.length ? blockOf.get(cur[cur.length - 1]) : void 0;
      if (cur.length && curLen >= minChars && blockOf.get(s.index) !== prevBlock)
        flush();
      cur.push(s.index);
      curLen += addLen;
    }
    flush();
    return chunks;
  }

  // src/webview/player-bar.ts
  var PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  function initPlayerBar(opts) {
    const bar = document.getElementById("player-bar");
    bar.textContent = "";
    const btn = (label, onClick, title) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (title)
        b.title = title;
      b.addEventListener("click", onClick);
      bar.appendChild(b);
      return b;
    };
    const prev = btn("\u23EE", opts.onPrevSentence, "Previous sentence");
    const playPause = btn("\u25B6", opts.onPlayPause, "Play/Pause");
    const next = btn("\u23ED", opts.onNextSentence, "Next sentence");
    const speedButtons = /* @__PURE__ */ new Map();
    const slider = document.createElement("input");
    const setSpeedUI = (rate) => {
      for (const [r, b] of speedButtons)
        b.classList.toggle("active", Math.abs(r - rate) < 0.01);
      slider.value = String(rate);
    };
    const applySpeed = (rate) => {
      setSpeedUI(rate);
      opts.onSpeed(rate);
    };
    for (const r of PRESETS)
      speedButtons.set(r, btn(`${r}x`, () => applySpeed(r)));
    slider.type = "range";
    slider.min = "0.5";
    slider.max = "2";
    slider.step = "0.05";
    slider.title = "Fine speed";
    slider.addEventListener("input", () => applySpeed(Number(slider.value)));
    bar.appendChild(slider);
    const status = document.createElement("span");
    status.id = "player-status";
    bar.appendChild(status);
    const gear = btn("\u2699", opts.onSettings, "Settings");
    gear.id = "settings-toggle";
    gear.setAttribute("aria-label", "Settings");
    gear.setAttribute("aria-expanded", "false");
    setSpeedUI(opts.initialSpeed);
    return {
      setState(state) {
        playPause.textContent = state === "playing" ? "\u23F8" : "\u25B6";
        if (state === "ended")
          status.textContent = "Finished";
        prev.disabled = next.disabled = state === "ended";
      },
      setPosition(sentenceIndex, totalSentences) {
        status.textContent = `Sentence ${sentenceIndex + 1} / ${totalSentences}`;
      },
      showError(message) {
        status.textContent = `\u26A0 ${message}`;
      }
    };
  }

  // src/webview/settings-panel.ts
  var FONT_MIN = 12;
  var FONT_MAX = 28;
  function initSettingsPanel(opts) {
    const panel = document.createElement("div");
    panel.id = "settings-panel";
    panel.hidden = true;
    const playerBar2 = document.getElementById("player-bar");
    playerBar2.parentElement.insertBefore(panel, playerBar2);
    const header = document.createElement("div");
    header.className = "settings-header";
    const headerTitle = document.createElement("div");
    headerTitle.className = "settings-title";
    headerTitle.textContent = "Settings";
    const closeBtn = document.createElement("button");
    closeBtn.className = "settings-close";
    closeBtn.setAttribute("aria-label", "Close settings");
    closeBtn.title = "Close (Esc)";
    closeBtn.textContent = "\u2715";
    header.append(headerTitle, closeBtn);
    panel.appendChild(header);
    const section = (title) => {
      const wrap = document.createElement("div");
      wrap.className = "settings-section";
      const h = document.createElement("div");
      h.className = "settings-heading";
      h.textContent = title;
      wrap.appendChild(h);
      panel.appendChild(wrap);
      return wrap;
    };
    const providerSection = section("Provider");
    const providerList = document.createElement("div");
    providerList.id = "settings-providers";
    providerSection.appendChild(providerList);
    const voiceSection = section("Voice");
    const voiceSelect = document.createElement("select");
    voiceSelect.id = "settings-voice";
    voiceSelect.setAttribute("aria-label", "Voice");
    voiceSelect.addEventListener("change", () => {
      if (voiceSelect.value)
        opts.onVoice(voiceSelect.value);
    });
    voiceSection.append(voiceSelect);
    const appearanceSection = section("Appearance");
    const fontFieldLabel = document.createElement("div");
    fontFieldLabel.className = "settings-field-label";
    fontFieldLabel.textContent = "Font size";
    appearanceSection.appendChild(fontFieldLabel);
    const fontRow = document.createElement("div");
    fontRow.className = "settings-stepper";
    const dec = document.createElement("button");
    dec.textContent = "\u2212";
    dec.title = "Smaller";
    const fontValue = document.createElement("span");
    fontValue.id = "settings-font-value";
    const inc = document.createElement("button");
    inc.textContent = "+";
    inc.title = "Larger";
    fontRow.append(dec, fontValue, inc);
    appearanceSection.appendChild(fontRow);
    let fontSize = 16;
    const clampFont = (n) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
    const applyFont = (n) => {
      fontSize = clampFont(n);
      fontValue.textContent = `${fontSize}px`;
      document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
      dec.disabled = fontSize <= FONT_MIN;
      inc.disabled = fontSize >= FONT_MAX;
      opts.onSetting("readerFontSize", fontSize);
    };
    dec.addEventListener("click", () => applyFont(fontSize - 1));
    inc.addEventListener("click", () => applyFont(fontSize + 1));
    const colorFieldLabel = document.createElement("div");
    colorFieldLabel.className = "settings-field-label";
    colorFieldLabel.textContent = "Highlight colors";
    appearanceSection.appendChild(colorFieldLabel);
    const colorRow = document.createElement("div");
    colorRow.className = "settings-colors";
    const colorField = (label, onPick) => {
      const wrap = document.createElement("label");
      wrap.className = "settings-color-field";
      const span = document.createElement("span");
      span.textContent = label;
      const input = document.createElement("input");
      input.type = "color";
      input.addEventListener("input", () => onPick(input.value));
      wrap.append(span, input);
      colorRow.appendChild(wrap);
      return input;
    };
    const sentenceInput = colorField("Sentence", (value) => {
      document.documentElement.style.setProperty("--sentence-color", value);
      opts.onSetting("highlight.sentenceColor", value);
    });
    const wordInput = colorField("Word", (value) => {
      document.documentElement.style.setProperty("--word-color", value);
      opts.onSetting("highlight.wordColor", value);
    });
    const resetColors = document.createElement("button");
    resetColors.textContent = "Reset to theme";
    resetColors.className = "settings-reset";
    resetColors.addEventListener("click", () => {
      document.documentElement.style.removeProperty("--sentence-color");
      document.documentElement.style.removeProperty("--word-color");
      opts.onSetting("highlight.sentenceColor", "");
      opts.onSetting("highlight.wordColor", "");
    });
    appearanceSection.append(colorRow, resetColors);
    const swatch = (value, fallback) => value && /^#/.test(value) ? value : fallback;
    function showData(data) {
      providerList.textContent = "";
      for (const p of data.providers) {
        const row = document.createElement("button");
        row.className = "settings-provider" + (p.active ? " active" : "");
        row.dataset.id = p.id;
        const main = document.createElement("div");
        main.className = "settings-provider-main";
        const name = document.createElement("span");
        name.className = "settings-provider-label";
        name.textContent = p.label;
        main.appendChild(name);
        if (p.requiresKey) {
          const badge = document.createElement("span");
          badge.className = "settings-badge";
          badge.textContent = "key required";
          main.appendChild(badge);
        }
        if (p.active) {
          const check = document.createElement("span");
          check.className = "settings-check";
          check.textContent = "\u2713";
          main.appendChild(check);
        }
        const desc = document.createElement("div");
        desc.className = "settings-provider-desc";
        desc.textContent = p.description;
        row.append(main, desc);
        row.addEventListener("click", () => {
          if (!p.active)
            opts.onProvider(p.id);
        });
        providerList.appendChild(row);
      }
      voiceSelect.textContent = "";
      if (data.voices === null) {
        const loading = document.createElement("option");
        loading.textContent = "Loading voices\u2026";
        loading.value = "";
        loading.disabled = true;
        loading.selected = true;
        voiceSelect.appendChild(loading);
        voiceSelect.disabled = true;
      } else {
        voiceSelect.disabled = false;
        for (const v of data.voices) {
          const opt = document.createElement("option");
          opt.value = v.id;
          opt.textContent = v.label;
          if (v.id === data.activeVoice)
            opt.selected = true;
          voiceSelect.appendChild(opt);
        }
        voiceSelect.value = data.activeVoice;
      }
      fontSize = clampFont(data.fontSize);
      fontValue.textContent = `${fontSize}px`;
      document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
      dec.disabled = fontSize <= FONT_MIN;
      inc.disabled = fontSize >= FONT_MAX;
      sentenceInput.value = swatch(data.sentenceColor, "#3a6ea5");
      wordInput.value = swatch(data.wordColor, "#d7a900");
      if (data.sentenceColor) {
        document.documentElement.style.setProperty("--sentence-color", data.sentenceColor);
      } else {
        document.documentElement.style.removeProperty("--sentence-color");
      }
      if (data.wordColor) {
        document.documentElement.style.setProperty("--word-color", data.wordColor);
      } else {
        document.documentElement.style.removeProperty("--word-color");
      }
    }
    const syncGear = () => {
      const gear = document.getElementById("settings-toggle");
      gear?.classList.toggle("active", !panel.hidden);
      gear?.setAttribute("aria-expanded", String(!panel.hidden));
    };
    const open = () => {
      if (!panel.hidden)
        return;
      panel.hidden = false;
      syncGear();
      opts.requestData();
    };
    const close = () => {
      if (panel.hidden)
        return;
      panel.hidden = true;
      syncGear();
    };
    closeBtn.addEventListener("click", close);
    return {
      showData,
      toggle() {
        panel.hidden ? open() : close();
      },
      close,
      syncToggleState: syncGear
    };
  }

  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  var engine = null;
  var highlight = null;
  var playerBar = null;
  var settingsPanel = null;
  var tickTimer = null;
  var FORMAT_MIME = { mp3: "audio/mpeg", wav: "audio/wav" };
  function init(model, chunks, settings, startAtWord = 0, autoplay = true) {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    engine?.stop();
    highlight?.destroy();
    highlight = null;
    const root = document.getElementById("content");
    document.documentElement.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
    if (settings.sentenceColor)
      document.documentElement.style.setProperty("--sentence-color", settings.sentenceColor);
    if (settings.wordColor)
      document.documentElement.style.setProperty("--word-color", settings.wordColor);
    renderModel(root, model);
    highlight = new HighlightController(root);
    if (!settingsPanel) {
      settingsPanel = initSettingsPanel({
        onProvider: (id) => vscode.postMessage({ type: "setProvider", id }),
        onVoice: (id) => vscode.postMessage({ type: "setVoice", id }),
        onSetting: (key, value) => vscode.postMessage({ type: "setSetting", key, value }),
        requestData: () => vscode.postMessage({ type: "settingsRequest" })
      });
    }
    playerBar = initPlayerBar({
      initialSpeed: settings.speed,
      onPlayPause: () => {
        engine.isPlaying ? engine.pause() : engine.resume();
      },
      onSpeed: (rate) => {
        engine.setSpeed(rate);
        vscode.postMessage({ type: "speedChanged", rate });
      },
      onPrevSentence: () => jumpSentence(-1),
      onNextSentence: () => jumpSentence(1),
      onSettings: () => settingsPanel?.toggle()
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
      createAudio: () => new Audio(),
      // Uint8Array -> BlobPart cast: TS 5.9's typed-array generic widens the backing
      // buffer to ArrayBufferLike (incl. SharedArrayBuffer), which isn't a BlobPart.
      // The runtime value is always a plain ArrayBuffer-backed Uint8Array.
      makeUrl: (audio, format) => URL.createObjectURL(new Blob([audio], { type: FORMAT_MIME[format] ?? "audio/mpeg" })),
      revokeUrl: (url) => URL.revokeObjectURL(url)
    });
    engine.setSpeed(settings.speed);
    root.addEventListener("click", (e) => {
      const target = e.target.closest("span[data-w]");
      if (!target || !engine)
        return;
      engine.jumpToWord(Number(target.getAttribute("data-w")));
      highlight?.engageFollow();
    });
    function jumpSentence(delta) {
      if (!engine)
        return;
      const next = Math.max(0, Math.min(model.sentences.length - 1, engine.currentSentence + delta));
      const firstWord = model.sentences[next].words[0];
      if (firstWord)
        engine.jumpToWord(firstWord.index);
    }
    tickTimer = setInterval(() => engine?.tick(), 100);
    const clamped = Math.max(0, Math.min(model.words.length - 1, startAtWord));
    const startWord = model.words[clamped];
    if (!autoplay && startWord) {
      engine.primeAt(startWord.index);
    } else if (startWord && clamped > 0) {
      engine.jumpToWord(startWord.index);
    } else {
      engine.start(0);
    }
    settingsPanel.syncToggleState();
  }
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init": {
        const chunks = buildChunks(msg.model);
        init(msg.model, chunks, msg.settings, msg.startAtWord ?? 0, msg.autoplay ?? true);
        break;
      }
      case "chunkAudio":
        engine?.receiveChunk(msg.chunkIndex, {
          audio: msg.audio instanceof Uint8Array ? msg.audio : new Uint8Array(msg.audio.data ?? msg.audio),
          format: msg.format,
          timings: msg.timings
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
        settingsPanel?.showData(msg);
        break;
      case "control":
        if (msg.action === "pause")
          engine?.pause();
        if (msg.action === "resume")
          engine?.resume();
        if (msg.action === "stop") {
          engine?.stop();
          highlight?.clear();
          if (tickTimer) {
            clearInterval(tickTimer);
            tickTimer = null;
          }
        }
        break;
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      settingsPanel?.close();
  });
  vscode.postMessage({ type: "ready" });
})();
//# sourceMappingURL=reader.js.map
