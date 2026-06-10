/** Static, presentation-facing metadata for each selectable TTS provider. */
export interface ProviderDescriptor {
  id: string;
  label: string;
  description: string;
  requiresKey: boolean;
  /** true = only offer this provider when the extension host runs on macOS */
  darwinOnly?: boolean;
}

/** The full catalog, in display order. macOS-only entries are tagged, not filtered. */
export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  { id: "edge", label: "Edge TTS", description: "Free · word-level timing", requiresKey: false },
  { id: "elevenlabs", label: "ElevenLabs", description: "Premium · word-level timing", requiresKey: true },
  { id: "say", label: "macOS say", description: "Offline · estimated timing", requiresKey: false, darwinOnly: true },
  { id: "sarvam", label: "Sarvam AI", description: "Indian English · estimated timing", requiresKey: true },
];

/**
 * Providers available on the current platform, in display order.
 * @param platform a `process.platform` value (e.g. "darwin", "linux", "win32")
 */
export function availableProviders(platform: NodeJS.Platform): ProviderDescriptor[] {
  return PROVIDER_CATALOG.filter((p) => !p.darwinOnly || platform === "darwin");
}

/** A provider id is selectable on this platform. */
export function isProviderAvailable(id: string, platform: NodeJS.Platform): boolean {
  return availableProviders(platform).some((p) => p.id === id);
}
