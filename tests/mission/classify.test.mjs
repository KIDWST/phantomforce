import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTiles } from "../../mission/classify.js";

test("a valid profileId passes through unchanged", () => {
  const tiles = [{ profileId: "codex", name: "Codex 1" }];
  assert.deepEqual(validateTiles(tiles, ["pwsh", "codex", "claude"]), [{ profileId: "codex", name: "Codex 1" }]);
});

test("an unrecognized profileId is replaced with pwsh", () => {
  const tiles = [{ profileId: "made-up-cli", name: "Whatever" }];
  const result = validateTiles(tiles, ["pwsh", "codex", "claude"]);
  assert.equal(result[0].profileId, "pwsh");
  assert.equal(result[0].name, "Whatever");
});

test("an undefined/empty tiles array passes through as []", () => {
  assert.deepEqual(validateTiles(undefined, ["pwsh"]), []);
  assert.deepEqual(validateTiles([], ["pwsh"]), []);
});

test("startupCommand is preserved when present, omitted stays omitted", () => {
  const tiles = [{ profileId: "pwsh", name: "A", startupCommand: "echo hi" }, { profileId: "pwsh", name: "B" }];
  const result = validateTiles(tiles, ["pwsh"]);
  assert.equal(result[0].startupCommand, "echo hi");
  assert.equal(result[1].startupCommand, undefined);
});
