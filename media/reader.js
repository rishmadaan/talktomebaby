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
      if (!this.playing || chunkIndex !== this.currentChunk)
        return;
      const lc = this.loaded.get(chunkIndex);
      if (!lc || lc.timingsMs === null)
        return;
      if (this.pendingJumpWord !== null) {
        const t = lc.timingsMs.find((w) => w.wordIndex === this.pendingJumpWord);
        lc.audio.currentTime = t ? t.start / 1e3 : 0;
        this.pendingJumpWord = null;
      }
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
        if (this.suppressScrollEvents > 0) {
          this.suppressScrollEvents--;
          return;
        }
        if (this.following) {
          this.following = false;
          this.pill.hidden = false;
        }
      }, { passive: true });
    }
    activeSentence = null;
    activeWord = null;
    following = true;
    suppressScrollEvents = 0;
    pill;
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
        this.suppressScrollEvents += 2;
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
  function initPlayerBar(opts) {
    return { setState() {
    }, setPosition() {
    }, showError(m) {
      console.error(m);
    } };
  }

  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  var engine = null;
  var highlight = null;
  var playerBar = null;
  var tickTimer = null;
  var FORMAT_MIME = { mp3: "audio/mpeg", wav: "audio/wav" };
  function init(model, chunks, settings) {
    const root = document.getElementById("content");
    document.documentElement.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
    if (settings.sentenceColor)
      document.documentElement.style.setProperty("--sentence-color", settings.sentenceColor);
    if (settings.wordColor)
      document.documentElement.style.setProperty("--word-color", settings.wordColor);
    renderModel(root, model);
    highlight = new HighlightController(root);
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
      onNextSentence: () => jumpSentence(1)
    });
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
      case "control":
        if (msg.action === "pause")
          engine?.pause();
        if (msg.action === "resume")
          engine?.resume();
        if (msg.action === "stop") {
          engine?.stop();
          highlight?.clear();
          if (tickTimer)
            clearInterval(tickTimer);
        }
        break;
    }
  });
  vscode.postMessage({ type: "ready" });
})();
//# sourceMappingURL=reader.js.map
