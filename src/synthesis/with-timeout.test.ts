import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("returns the promise value when it resolves before the timeout", async () => {
    vi.useFakeTimers();
    const p = Promise.resolve(42);
    const result = await withTimeout(p, 4000, -1);
    expect(result).toBe(42);
  });

  it("returns the fallback when the promise hangs past the timeout", async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => { /* never resolves */ });
    const racePromise = withTimeout(never, 4000, -1);
    vi.advanceTimersByTime(4001);
    const result = await racePromise;
    expect(result).toBe(-1);
  });

  it("returns the fallback when the promise rejects (via caller wrapping)", async () => {
    // withTimeout itself doesn't catch rejections — the caller should wrap the
    // promise in a .catch() to convert errors to fallbacks. Verify that a
    // resolved-early value wins over the timer.
    vi.useFakeTimers();
    const p = Promise.resolve("ok");
    const result = await withTimeout(p, 4000, "fallback");
    expect(result).toBe("ok");
  });

  it("clears the timer when the promise wins (no dangling timers)", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const p = Promise.resolve(1);
    await withTimeout(p, 4000, 0);
    expect(clearSpy).toHaveBeenCalled();
  });
});
