import { describe, it, expect } from "vitest";
import { availableProviders, isProviderAvailable, PROVIDER_CATALOG } from "./provider-catalog";

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
