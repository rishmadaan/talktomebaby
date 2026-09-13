/*!
 * Copyright (c) 2026 Rish
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE and LICENSING.md for licensing and warranty information.
 */
export * from "./core/index";
export { SynthesisService } from "./synthesis/synthesis-service";
export { DiskCache } from "./synthesis/disk-cache";
export { EdgeProvider } from "./synthesis/edge";
export { ElevenLabsProvider } from "./synthesis/elevenlabs";
export { OpenAIProvider } from "./synthesis/openai";
export { SayProvider } from "./synthesis/say";
export { SarvamProvider } from "./synthesis/sarvam";
export { TtsProvider } from "./synthesis/provider";
export { availableProviders, resolveProviderId } from "./synthesis/provider-catalog";
export { VoiceCache } from "./synthesis/voice-cache";
export { withTimeout } from "./synthesis/with-timeout";
export { detectPlayer, play, playWith, hasBin, NoPlayerError, PlayerSpec, Runner } from "./playback/index";
