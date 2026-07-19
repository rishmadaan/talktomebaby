import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import { detectPlayer, playWith, NoPlayerError, PlayerSpec } from "./index";

const all = () => true;
const none = () => false;
const only = (bin: string) => (b: string) => b === bin;

describe("detectPlayer", () => {
  it("uses afplay on macOS for both formats", () => {
    expect(detectPlayer("darwin", all, "mp3")).toMatchObject({ cmd: "afplay" });
    expect(detectPlayer("darwin", all, "wav")).toMatchObject({ cmd: "afplay" });
    expect(detectPlayer("darwin", all, "mp3")!.args("/x.mp3")).toEqual(["/x.mp3"]);
  });

  it("prefers ffplay on linux when present", () => {
    const spec = detectPlayer("linux", only("ffplay"), "mp3")!;
    expect(spec.cmd).toBe("ffplay");
    expect(spec.args("/a.mp3")).toContain("/a.mp3");
    expect(spec.args("/a.mp3")).toContain("-autoexit");
  });

  it("falls back to aplay for wav on linux without ffplay/mpv", () => {
    expect(detectPlayer("linux", only("aplay"), "wav")!.cmd).toBe("aplay");
  });

  it("returns null on linux for mp3 with no usable player", () => {
    expect(detectPlayer("linux", none, "mp3")).toBeNull();
  });

  it("uses powershell SoundPlayer for wav on win32 without ffplay", () => {
    expect(detectPlayer("win32", only("anything-else"), "wav")!.cmd).toBe("powershell");
  });
});

describe("playWith", () => {
  it("writes a temp file, passes it to the runner, and cleans it up", async () => {
    const spec: PlayerSpec = { cmd: "noop", args: (f) => [f] };
    let seenPath = "";
    let existedDuringRun = false;
    const runner = async (_cmd: string, args: string[]) => {
      seenPath = args[0];
      existedDuringRun = await fs.access(seenPath).then(() => true, () => false);
    };
    await playWith(new Uint8Array([9, 9, 9]), "mp3", spec, runner);
    expect(existedDuringRun).toBe(true);
    expect(seenPath.endsWith(".mp3")).toBe(true);
    expect(await fs.access(seenPath).then(() => true, () => false)).toBe(false); // cleaned up
  });
});

describe("NoPlayerError", () => {
  it("is thrown shape with platform + format", () => {
    const e = new NoPlayerError("linux", "mp3");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/linux/);
    expect(e.message).toMatch(/mp3/);
  });
});
