import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/vacation.js", import.meta.url), "utf8");

assert.match(source, /friendlyBackendError/u, "Away Mode must use the shared friendly backend error formatter.");
assert.match(
  source,
  /friendlyBackendError[\s\S]*Sign in with your owner account to use Away Mode[\s\S]*Away Mode request failed/u,
  "Away Mode must hide raw auth transport errors while preserving non-auth failures.",
);
assert.match(source, /error\.status = response\.status/u, "Away Mode must preserve status for auth-required UI branching.");
assert.match(source, /authRequired = error\?\.status === 401/u, "Away Mode must keep the signed-out state explicit.");
assert.doesNotMatch(
  source,
  /new Error\(data\.error \|\| data\.message \|\| `Away Mode request failed/u,
  "Away Mode must not pass raw backend errors directly to the UI.",
);

// Live work view: honest polling only — auto-refresh while visible, paused
// when the tab is hidden or Away Mode is off, with a LIVE pill and a real
// last-updated timestamp. No websockets.
assert.match(source, /const POLL_MS = 10_000/u, "Away Mode must poll on a ~10s interval.");
assert.match(source, /document\.hidden \|\| !pollingActive\(\) \|\| formBusy\(el\)/u, "Polling must pause when the tab is hidden, the mode is inactive, or the owner is typing.");
assert.match(source, />LIVE<\/span>/u, "The activity card must show a LIVE indicator while polling.");
assert.match(source, /updated \$\{esc\(updated\)\}/u, "The activity card must show a real last-updated timestamp.");
assert.doesNotMatch(source, /WebSocket|EventSource/u, "Away Mode must stay on honest polling, not sockets.");

// Pause without ending: hero button plus honest paused copy and digest.
assert.match(source, /data-vm-pause/u, "The status hero must offer a Pause/Resume coverage button.");
assert.match(source, /Coverage paused — nothing runs until you resume/u, "The paused state must be spelled out to the owner.");
assert.match(source, /paused, not covered/u, "The digest must not count paused time as covered.");
assert.match(source, /\/api\/vacation-mode\/resume/u, "The resume route must be wired.");
assert.match(source, /\/api\/vacation-mode\/pause/u, "The pause route must be wired.");

// Intervene: per-task take-over that marks the task owner-handled.
assert.match(source, /data-op-takeover/u, "Each operator task must offer a Take over action.");
assert.match(source, /\/take-over/u, "The take-over route must be wired.");
assert.match(source, /taken_over/u, "The taken-over task state must render honestly.");

console.log("Away Mode UI safety checks passed.");
