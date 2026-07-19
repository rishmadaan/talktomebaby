import { execFile } from "child_process";
import { existsSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import { promisify } from "util";

const run = promisify(execFile);

export interface PlayerSpec { cmd: string; args: (file: string) => string[] }
export type Runner = (cmd: string, args: string[], opts: { signal?: AbortSignal }) => Promise<unknown>;

export class NoPlayerError extends Error {
  constructor(platform: string, format: string) {
    super(`No audio player found for ${format} on ${platform}. Install ffmpeg (ffplay) or mpv.`);
    this.name = "NoPlayerError";
  }
}

/** Pure: choose a player from platform + a binary-presence predicate + audio format. */
export function detectPlayer(
  platform: NodeJS.Platform,
  has: (bin: string) => boolean,
  format: "mp3" | "wav"
): PlayerSpec | null {
  if (platform === "darwin") return { cmd: "afplay", args: (f) => [f] };

  const ffplay: PlayerSpec = { cmd: "ffplay", args: (f) => ["-nodisp", "-autoexit", "-loglevel", "quiet", f] };
  const mpv: PlayerSpec = { cmd: "mpv", args: (f) => ["--no-video", "--really-quiet", f] };

  if (has("ffplay")) return ffplay;
  if (has("mpv")) return mpv;

  if (platform === "win32") {
    // PS single-quoted literal: apostrophes in the path (C:\Users\O'Connor)
    // are escaped by doubling them.
    const esc = (f: string) => f.replace(/'/g, "''");
    if (format === "wav") return { cmd: "powershell", args: (f) => ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${esc(f)}').PlaySync()`] };
    // MP3 (the default Edge provider's output): WPF MediaPlayer plays it with
    // no external binary. Poll until the clip ends, with a deadline so a file
    // that never opens cannot hang the player process forever.
    return { cmd: "powershell", args: (f) => ["-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]::new('${esc(f)}')); $p.Play(); $deadline = (Get-Date).AddMinutes(30); while ((-not $p.NaturalDuration.HasTimeSpan -or $p.Position -lt $p.NaturalDuration.TimeSpan) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }; $p.Close()`] };
  }

  if (format === "mp3" && has("mpg123")) return { cmd: "mpg123", args: (f) => ["-q", f] };
  if (format === "wav" && has("paplay")) return { cmd: "paplay", args: (f) => [f] };
  if (format === "wav" && has("aplay")) return { cmd: "aplay", args: (f) => ["-q", f] };
  return null;
}

/** Real PATH lookup for a binary (checks `bin` and `bin.exe`). */
export function hasBin(bin: string): boolean {
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  return dirs.some((d) => existsSync(join(d, bin)) || existsSync(join(d, `${bin}.exe`)));
}

/** Write audio to a temp file, run the given player spec, always clean up. */
export async function playWith(
  audio: Uint8Array,
  format: "mp3" | "wav",
  spec: PlayerSpec,
  runner: Runner,
  signal?: AbortSignal
): Promise<void> {
  const file = join(tmpdir(), `talktomebaby-play-${process.pid}-${Date.now()}.${format}`);
  await fs.writeFile(file, Buffer.from(audio));
  try {
    await runner(spec.cmd, spec.args(file), { signal });
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Play synthesized audio on this host. Throws NoPlayerError if no player is available. */
export async function play(audio: Uint8Array, format: "mp3" | "wav", signal?: AbortSignal): Promise<void> {
  const spec = detectPlayer(process.platform, hasBin, format);
  if (!spec) throw new NoPlayerError(process.platform, format);
  await playWith(audio, format, spec, run as Runner, signal);
}
