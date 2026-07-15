import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/settings.js", import.meta.url), "utf8");

assert.match(source, /friendlyBackendError/u, "Settings must use the shared friendly backend error formatter.");
assert.match(
  source,
  /friendlyBackendError[\s\S]*Sign in to manage provider connections[\s\S]*Connection request failed/u,
  "Provider connections must hide raw auth transport errors while preserving non-auth connection failures.",
);
assert.match(source, /Do not paste raw API keys here/u, "Provider connection settings must keep raw secrets out of the UI.");
assert.match(source, /Provider and subscription references/u, "Provider connection settings must store references, not credentials.");
assert.doesNotMatch(
  source,
  /throw new Error\(payload\?\.error \|\| `Connection request failed/u,
  "Provider connection settings must not pass raw backend errors directly to the UI.",
);

console.log("Settings provider connection safety checks passed.");
