import assert from "node:assert/strict";
import { test } from "node:test";

// decomposeObjective itself just forwards workerCount into a prompt string —
// the actual clamping (2..20) happens in server.js's request handler, which
// isn't unit-testable without an HTTP call. This test locks the *prompt*
// side of the contract: the guidance text must mention the new ceiling so a
// future reader (human or model) doesn't see stale "10" language.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const decomposeSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "mission", "decompose.js"),
  "utf-8"
);

test("decompose.js's worker-count guidance mentions the 20-worker ceiling, not the old 10", () => {
  assert.ok(!decomposeSrc.includes("(typically 2-6 —"), "old guidance text should have been replaced");
  assert.ok(decomposeSrc.includes("up to 20"), "prompt should mention the new ceiling");
});

const serverSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server.js"), "utf-8");

test("server.js clamps workerCount to a max of 20, not 10", () => {
  assert.ok(serverSrc.includes("Math.min(20, rawCount)"), "server.js should clamp to 20");
  assert.ok(!serverSrc.includes("Math.min(10, rawCount)"), "old 10-cap should be gone");
});
