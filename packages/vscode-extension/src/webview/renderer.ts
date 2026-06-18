import { Block, DocumentModel, Sentence } from "@talktomebaby/engine/core";

const TAG: Record<string, string> = {
  paragraph: "p", "list-item": "li", quote: "blockquote", code: "pre",
};

function renderSentence(s: Sentence): HTMLElement {
  const span = document.createElement("span");
  span.className = "sentence";
  span.setAttribute("data-s", String(s.index));
  s.words.forEach((w, i) => {
    if (i > 0) span.appendChild(document.createTextNode(" "));
    const ws = document.createElement("span");
    ws.setAttribute("data-w", String(w.index));
    ws.textContent = w.text;
    span.appendChild(ws);
  });
  return span;
}

function renderBlock(b: Block): HTMLElement {
  const tag = b.kind === "heading" ? `h${Math.min(b.level ?? 1, 6)}` : TAG[b.kind] ?? "p";
  const el = document.createElement(tag);
  el.className = `block block-${b.kind}`;
  if (b.kind === "code") {
    el.textContent = b.codeText ?? "";
    el.title = "Code block (not read aloud)";
    return el;
  }
  b.sentences.forEach((s, i) => {
    if (i > 0) el.appendChild(document.createTextNode(" "));
    el.appendChild(renderSentence(s));
  });
  return el;
}

export function renderModel(root: HTMLElement, model: DocumentModel): void {
  root.textContent = "";
  for (const block of model.blocks) root.appendChild(renderBlock(block));
}
