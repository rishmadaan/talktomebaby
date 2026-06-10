import { VoiceInfo } from "./provider";

/**
 * In-memory cache of a provider's voice list, keyed by provider id, living for the
 * extension-host lifetime. Voices don't change mid-session, so there's no TTL —
 * a miss simply means "not fetched yet" and the caller should fetch + store.
 *
 * Extracted as a tiny injectable unit so the slow-open fix (send settings data
 * immediately, fill voices when they resolve) is independently testable.
 */
export class VoiceCache {
  private store = new Map<string, VoiceInfo[]>();

  /** Cached voices for a provider, or undefined on a miss. */
  get(providerId: string): VoiceInfo[] | undefined {
    return this.store.get(providerId);
  }

  /** True when voices for this provider are already cached. */
  has(providerId: string): boolean {
    return this.store.has(providerId);
  }

  /** Store a fetched voice list. */
  set(providerId: string, voices: VoiceInfo[]): void {
    this.store.set(providerId, voices);
  }

  /**
   * Return cached voices, or fetch via `fetcher`, cache, and return them.
   * Fetch failures are NOT cached (so a transient network error can be retried),
   * and propagate to the caller.
   */
  async resolve(providerId: string, fetcher: () => Promise<VoiceInfo[]>): Promise<VoiceInfo[]> {
    const cached = this.store.get(providerId);
    if (cached) return cached;
    const voices = await fetcher();
    this.store.set(providerId, voices);
    return voices;
  }

  /**
   * Remove a provider's cached voice list, forcing the next resolve() to
   * re-fetch from the provider. Use when a provider's API key changes —
   * the new key may surface different voices (e.g. a different plan tier).
   */
  invalidate(providerId: string): void {
    this.store.delete(providerId);
  }
}
