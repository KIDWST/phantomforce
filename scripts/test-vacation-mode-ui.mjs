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

console.log("Away Mode UI safety checks passed.");
