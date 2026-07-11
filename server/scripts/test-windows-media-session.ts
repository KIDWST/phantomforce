import {
  WINDOWS_MEDIA_COMMANDS,
  getWindowsMediaStatus,
  isWindowsMediaCommand,
  parseWindowsMediaOutput,
} from "../src/phantom-ai/windows-media-session.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

assert(isWindowsMediaCommand("play-pause"), "play-pause should be allowed.");
assert(isWindowsMediaCommand("previous"), "previous should be allowed.");
assert(isWindowsMediaCommand("next"), "next should be allowed.");
assert(!isWindowsMediaCommand("stop"), "unsupported commands must be rejected.");
assert(!isWindowsMediaCommand("launch"), "process-launch commands must be rejected.");
assert(WINDOWS_MEDIA_COMMANDS.length === 3, "Only the three compact player commands should exist.");

const parsed = parseWindowsMediaOutput('{"ok":true,"source":"windows_media_session","sessions":[]}');
assert(parsed.ok, "Valid helper JSON should parse.");
assert(Array.isArray(parsed.sessions), "Sessions should be normalized to an array.");
assert(!parseWindowsMediaOutput("not-json").ok, "Invalid helper output should fail closed.");

const liveStatus = await getWindowsMediaStatus();
assert(liveStatus.source === "windows_media_session", "Status must identify the Windows media source.");
assert(typeof liveStatus.ok === "boolean", "Live status should return a structured result.");

console.log(JSON.stringify({
  ok: true,
  allowed_commands: WINDOWS_MEDIA_COMMANDS,
  helper_reachable: liveStatus.ok,
  active_app: liveStatus.active?.app ?? null,
  session_count: liveStatus.sessions?.length ?? 0,
  reason: liveStatus.reason ?? null,
}, null, 2));
