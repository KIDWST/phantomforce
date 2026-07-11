import assert from "node:assert/strict";
import { test } from "node:test";

import { createDetector } from "../../detect/index.js";
import { loadFixtures } from "./fixtures.mjs";

test("claude pack classifies representative output", () => {
  for (const fixture of loadFixtures("claude.jsonl")) {
    const detector = createDetector({ detector: "claude" });
    detector.feed(fixture.raw);
    const result = detector.evaluate();
    assert.equal(
      result.state,
      fixture.expect,
      `${fixture.name}: expected "${fixture.expect}", got "${result.state}" (rule ${result.ruleId})`,
    );
  }
});
