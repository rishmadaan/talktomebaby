import { describe, it, expect } from "vitest";
import { availableProviders, isProviderAvailable, resolveProviderId, PROVIDER_CATALOG } from "./provider-catalog";

describe("availableProviders", () => {
  it("includes macOS say only on darwin", () => {
    expect(availableProviders("darwin").map((p) => p.id)).toContain("say");
    expect(availableProviders("linux").map((p) => p.id)).not.toContain("say");
    expect(availableProviders("win32").map((p) => p.id)).not.toContain("say");
  });

  it("always includes the cross-platform providers", () => {
    for (const platform of ["darwin", "linux", "win32"] as NodeJS.Platform[]) {
      const ids = availableProviders(platform).map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(["edge", "elevenlabs", "sarvam"]));
    }
  });

  it("preserves catalog display order", () => {
    expect(availableProviders("darwin").map((p) => p.id)).toEqual(
      PROVIDER_CATALOG.map((p) => p.id)
    );
  });
});

describe("isProviderAvailable", () => {
  it("rejects say off darwin, accepts elsewhere", () => {
    expect(isProviderAvailable("say", "darwin")).toBe(true);
    expect(isProviderAvailable("say", "linux")).toBe(false);
    expect(isProviderAvailable("edge", "linux")).toBe(true);
    expect(isProviderAvailable("nope", "darwin")).toBe(false);
  });
});

describe("resolveProviderId", () => {
  it("auto on darwin → say", () => {
    expect(resolveProviderId("auto", "darwin")).toBe("say");
  });

  it("auto on linux → edge", () => {
    expect(resolveProviderId("auto", "linux")).toBe("edge");
  });

  it("auto on win32 → edge", () => {
    expect(resolveProviderId("auto", "win32")).toBe("edge");
  });

  it("undefined → platform default (say on darwin, edge elsewhere)", () => {
    expect(resolveProviderId(undefined, "darwin")).toBe("say");
    expect(resolveProviderId(undefined, "linux")).toBe("edge");
    expect(resolveProviderId(undefined, "win32")).toBe("edge");
  });

  it("empty string → platform default", () => {
    expect(resolveProviderId("", "darwin")).toBe("say");
    expect(resolveProviderId("", "linux")).toBe("edge");
  });

  it("unknown id → platform default", () => {
    expect(resolveProviderId("piper", "darwin")).toBe("say");
    expect(resolveProviderId("piper", "linux")).toBe("edge");
  });

  it("explicit edge on darwin → edge (stays edge, user choice respected)", () => {
    expect(resolveProviderId("edge", "darwin")).toBe("edge");
  });

  it("explicit say on darwin → say", () => {
    expect(resolveProviderId("say", "darwin")).toBe("say");
  });

  it("explicit say on win32 → edge (say unavailable on win32, falls back to platform default)", () => {
    expect(resolveProviderId("say", "win32")).toBe("edge");
  });

  it("explicit say on linux → edge (say unavailable on linux, falls back to platform default)", () => {
    expect(resolveProviderId("say", "linux")).toBe("edge");
  });

  it("explicit elevenlabs on any platform → elevenlabs", () => {
    expect(resolveProviderId("elevenlabs", "darwin")).toBe("elevenlabs");
    expect(resolveProviderId("elevenlabs", "linux")).toBe("elevenlabs");
    expect(resolveProviderId("elevenlabs", "win32")).toBe("elevenlabs");
  });

  it("explicit sarvam on any platform → sarvam", () => {
    expect(resolveProviderId("sarvam", "darwin")).toBe("sarvam");
    expect(resolveProviderId("sarvam", "win32")).toBe("sarvam");
  });

  // Resolution depends on "auto" never being a catalog entry — if it were,
  // resolveProviderId("auto") would return "auto" to makeProviderById.
  it('"auto" is never a selectable catalog provider', () => {
    expect(isProviderAvailable("auto", "darwin")).toBe(false);
    expect(isProviderAvailable("auto", "win32")).toBe(false);
  });
});
