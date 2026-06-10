export class HighlightController {
  private activeSentence: HTMLElement | null = null;
  private activeWord: HTMLElement | null = null;
  private following = true;
  private suppressScrollEvents = 0;
  private pill: HTMLElement;

  constructor(private root: HTMLElement, private onReturn?: () => void) {
    this.pill = document.createElement("button");
    this.pill.id = "return-pill";
    this.pill.textContent = "↓ Return to playback";
    this.pill.hidden = true;
    document.body.appendChild(this.pill);
    this.pill.addEventListener("click", () => this.engageFollow());

    window.addEventListener("scroll", () => {
      if (this.suppressScrollEvents > 0) { this.suppressScrollEvents--; return; }
      if (this.following) { this.following = false; this.pill.hidden = false; }
    }, { passive: true });
  }

  engageFollow() {
    this.following = true;
    this.pill.hidden = true;
    this.scrollToActive();
    this.onReturn?.();
  }

  setActive(wordIndex: number, sentenceIndex: number) {
    const word = this.root.querySelector<HTMLElement>(`span[data-w="${wordIndex}"]`);
    const sentence = this.root.querySelector<HTMLElement>(`span[data-s="${sentenceIndex}"]`);
    if (this.activeWord) this.activeWord.classList.remove("word-active");
    if (this.activeSentence && this.activeSentence !== sentence)
      this.activeSentence.classList.remove("sentence-active");
    word?.classList.add("word-active");
    sentence?.classList.add("sentence-active");
    this.activeWord = word;
    this.activeSentence = sentence;
    if (this.following) this.scrollToActive();
  }

  clear() {
    this.activeWord?.classList.remove("word-active");
    this.activeSentence?.classList.remove("sentence-active");
    this.activeWord = this.activeSentence = null;
  }

  private scrollToActive() {
    if (!this.activeSentence) return;
    const rect = this.activeSentence.getBoundingClientRect();
    const margin = window.innerHeight * 0.25;
    if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
      this.suppressScrollEvents += 2; // our own scroll fires events; don't treat as manual
      this.activeSentence.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}
