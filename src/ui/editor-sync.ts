import * as vscode from "vscode";
import { DocumentModel } from "../core/document-model";

export class EditorSync {
  private sentenceDeco: vscode.TextEditorDecorationType;
  private wordDeco: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private docUri: vscode.Uri,
    private model: DocumentModel,
    onAltClick: (wordIndex: number) => void
  ) {
    const cfg = vscode.workspace.getConfiguration("speakittome");
    const sentenceColor = cfg.get<string>("highlight.sentenceColor") || undefined;
    const wordColor = cfg.get<string>("highlight.wordColor") || undefined;
    this.sentenceDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: sentenceColor ?? new vscode.ThemeColor("editor.selectionHighlightBackground"),
      isWholeLine: false,
    });
    this.wordDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: wordColor ?? new vscode.ThemeColor("editor.findMatchBackground"),
      borderRadius: "3px",
    });

    const mode = cfg.get<string>("editorClickToJump", "alt-j");
    if (mode === "plain-click") {
      this.disposables.push(
        vscode.window.onDidChangeTextEditorSelection((e) => {
          if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
          if (e.textEditor.document.uri.toString() !== this.docUri.toString()) return;
          if (!e.selections[0]?.isEmpty) return;
          const idx = this.wordAtPosition(e.textEditor.document, e.selections[0].active);
          if (idx !== undefined) onAltClick(idx);
        })
      );
    }
  }

  // Called by the jumpToCursor command and the plain-click listener
  wordAtPosition(doc: vscode.TextDocument, pos: vscode.Position): number | undefined {
    const offset = doc.offsetAt(pos);
    const word = this.model.words.find((w) => w.source.end > offset && w.source.start <= offset)
      ?? this.model.words.find((w) => w.source.start >= offset);
    return word?.index;
  }

  highlight(sentenceIndex: number, wordIndex: number, follow: boolean) {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.docUri.toString()
    );
    if (!editor) return;
    const doc = editor.document;
    const s = this.model.sentences[sentenceIndex];
    const w = this.model.words[wordIndex];
    if (!s || !w) return;
    const toRange = (o: { start: number; end: number }) =>
      new vscode.Range(doc.positionAt(o.start), doc.positionAt(o.end));
    editor.setDecorations(this.sentenceDeco, [toRange(s.source)]);
    editor.setDecorations(this.wordDeco, [toRange(w.source)]);
    if (follow) editor.revealRange(toRange(s.source), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose() {
    this.sentenceDeco.dispose();
    this.wordDeco.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
