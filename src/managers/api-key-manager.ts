import * as vscode from "vscode";
import { SarvamProvider } from "../providers/sarvam-provider";
import { ElevenLabsProvider } from "../providers/elevenlabs-provider";
import { ITtsProvider, VoiceInfo } from "../providers/tts-provider";

const SECRET_KEY_SARVAM = "read-tts-sarvam-api-key";
const SECRET_KEY_ELEVENLABS = "read-tts-elevenlabs-api-key";

export class ApiKeyManager {
  private secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async getProvider(providerName?: string): Promise<ITtsProvider | undefined> {
    const config = vscode.workspace.getConfiguration("read-tts");
    const name = providerName || config.get<string>("provider") || "sarvam";

    const secretKey =
      name === "elevenlabs" ? SECRET_KEY_ELEVENLABS : SECRET_KEY_SARVAM;
    const apiKey = await this.secrets.get(secretKey);

    if (!apiKey) {
      return undefined;
    }

    return name === "elevenlabs"
      ? new ElevenLabsProvider(apiKey)
      : new SarvamProvider(apiKey);
  }

  async setApiKey(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("read-tts");
    const currentProvider =
      config.get<string>("provider") || "sarvam";

    const provider = await vscode.window.showQuickPick(
      [
        {
          label: "Sarvam AI",
          description: "Indian English TTS (free credits)",
          value: "sarvam",
        },
        {
          label: "ElevenLabs",
          description: "Premium TTS (requires paid plan)",
          value: "elevenlabs",
        },
      ],
      { placeHolder: "Select TTS provider" }
    );

    if (!provider) return false;

    const apiKey = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.label} API key`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "API key cannot be empty";
        }
        return null;
      },
    });

    if (!apiKey) return false;

    // Validate the key
    const valid = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Validating API key...",
        cancellable: false,
      },
      async () => {
        const tempProvider =
          provider.value === "elevenlabs"
            ? new ElevenLabsProvider(apiKey)
            : new SarvamProvider(apiKey);
        return tempProvider.validateKey(apiKey);
      }
    );

    if (!valid) {
      vscode.window.showErrorMessage(
        "Invalid API key. Please check and try again."
      );
      return false;
    }

    const secretKey =
      provider.value === "elevenlabs"
        ? SECRET_KEY_ELEVENLABS
        : SECRET_KEY_SARVAM;

    await this.secrets.store(secretKey, apiKey);
    await config.update(
      "provider",
      provider.value,
      vscode.ConfigurationTarget.Global
    );

    vscode.window.showInformationMessage(
      `${provider.label} API key saved and set as active provider.`
    );
    return true;
  }

  async hasApiKey(providerName: string): Promise<boolean> {
    const secretKey =
      providerName === "elevenlabs" ? SECRET_KEY_ELEVENLABS : SECRET_KEY_SARVAM;
    const key = await this.secrets.get(secretKey);
    return !!key;
  }

  async getProviderStatuses(): Promise<
    { name: string; label: string; hasKey: boolean }[]
  > {
    const providers = [
      { name: "sarvam", label: "Sarvam AI" },
      { name: "elevenlabs", label: "ElevenLabs" },
    ];
    return Promise.all(
      providers.map(async (p) => ({
        ...p,
        hasKey: await this.hasApiKey(p.name),
      }))
    );
  }

  async getVoicesForProvider(providerName?: string): Promise<VoiceInfo[]> {
    const provider = await this.getProvider(providerName);
    if (!provider) return [];
    if (provider.fetchVoices) {
      return provider.fetchVoices();
    }
    return provider.voices;
  }

  async selectProvider(): Promise<string | undefined> {
    const provider = await vscode.window.showQuickPick(
      [
        { label: "Sarvam AI", value: "sarvam" },
        { label: "ElevenLabs", value: "elevenlabs" },
      ],
      { placeHolder: "Select TTS provider" }
    );

    if (!provider) return undefined;

    // Check if key exists
    const secretKey =
      provider.value === "elevenlabs"
        ? SECRET_KEY_ELEVENLABS
        : SECRET_KEY_SARVAM;
    const hasKey = await this.secrets.get(secretKey);

    if (!hasKey) {
      const setKey = await vscode.window.showInformationMessage(
        `No API key found for ${provider.label}. Set one now?`,
        "Set API Key",
        "Cancel"
      );
      if (setKey === "Set API Key") {
        return (await this.setApiKey()) ? provider.value : undefined;
      }
      return undefined;
    }

    const config = vscode.workspace.getConfiguration("read-tts");
    await config.update(
      "provider",
      provider.value,
      vscode.ConfigurationTarget.Global
    );

    vscode.window.showInformationMessage(
      `Switched to ${provider.label}`
    );
    return provider.value;
  }
}
