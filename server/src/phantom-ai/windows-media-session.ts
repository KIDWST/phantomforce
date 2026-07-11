import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../../scripts/windows-media-session.ps1", import.meta.url));

export const WINDOWS_MEDIA_COMMANDS = ["play-pause", "previous", "next"] as const;
export type WindowsMediaCommand = (typeof WINDOWS_MEDIA_COMMANDS)[number];

export type WindowsMediaSession = {
  id: string;
  session_id: string;
  app: string;
  title: string;
  artist: string;
  album: string;
  playback_status: string;
  playing: boolean;
  controls: {
    play_pause: boolean;
    previous: boolean;
    next: boolean;
  };
};

export type WindowsMediaStatus = {
  ok: boolean;
  source: "windows_media_session";
  active?: WindowsMediaSession | null;
  sessions?: WindowsMediaSession[];
  collected_at?: string;
  reason?: string;
  message?: string;
  command?: WindowsMediaCommand;
  session_id?: string;
};

export function isWindowsMediaCommand(value: unknown): value is WindowsMediaCommand {
  return typeof value === "string" && WINDOWS_MEDIA_COMMANDS.includes(value as WindowsMediaCommand);
}

export function parseWindowsMediaOutput(stdout: string): WindowsMediaStatus {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) {
    return { ok: false, source: "windows_media_session", reason: "empty_helper_response" };
  }

  try {
    const parsed = JSON.parse(line) as Partial<WindowsMediaStatus>;
    return {
      ...parsed,
      ok: parsed.ok === true,
      source: "windows_media_session",
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : parsed.sessions ? [parsed.sessions] : undefined,
    };
  } catch {
    return { ok: false, source: "windows_media_session", reason: "invalid_helper_response" };
  }
}

async function runWindowsMediaHelper(args: string[]): Promise<WindowsMediaStatus> {
  if (process.platform !== "win32") {
    return { ok: false, source: "windows_media_session", reason: "windows_only" };
  }

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { timeout: 5_000, windowsHide: true, maxBuffer: 256 * 1024 },
    );
    return parseWindowsMediaOutput(stdout);
  } catch {
    return { ok: false, source: "windows_media_session", reason: "helper_failed" };
  }
}

export function getWindowsMediaStatus() {
  return runWindowsMediaHelper(["-Action", "status"]);
}

export function controlWindowsMedia(sessionId: string, command: WindowsMediaCommand) {
  return runWindowsMediaHelper([
    "-Action", "control",
    "-SessionId", String(sessionId || "").slice(0, 300),
    "-Command", command,
  ]);
}
