import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("SpeakItToMe", { log: true });
  context.subscriptions.push(log);
  const todo = (name: string) => () =>
    vscode.window.showInformationMessage(`SpeakItToMe: ${name} not implemented yet`);
  for (const cmd of [
    "readDocument", "readSelection", "readFromCursor", "pauseResume",
    "stop", "openReader", "setApiKey", "selectProvider", "selectVoice",
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`speakittome.${cmd}`, todo(cmd))
    );
  }
  log.info("SpeakItToMe activated (scaffold)");
}

export function deactivate() {}
