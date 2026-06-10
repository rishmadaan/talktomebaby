import * as vscode from "vscode";

const KEY_NAMES: Record<string, string> = {
  elevenlabs: "speakittome.key.elevenlabs",
  sarvam: "speakittome.key.sarvam",
};

export class ApiKeyManager {
  constructor(private secrets: vscode.SecretStorage) {}

  async getKey(providerId: string): Promise<string | undefined> {
    const name = KEY_NAMES[providerId];
    return name ? this.secrets.get(name) : undefined;
  }

  async promptAndStore(providerId: string): Promise<string | undefined> {
    const name = KEY_NAMES[providerId];
    if (!name) return undefined;
    const value = await vscode.window.showInputBox({
      prompt: `Enter your ${providerId} API key`,
      password: true,
      ignoreFocusOut: true,
    });
    if (value) await this.secrets.store(name, value.trim());
    return value?.trim() || undefined;
  }
}
