import assert from "node:assert/strict";
import { test } from "node:test";

import { createDetector } from "../../detect/index.js";
import { loadFixtures } from "./fixtures.mjs";

test("openrouter pack classifies representative output", () => {
  for (const fixture of loadFixtures("openrouter.jsonl")) {
    const detector = createDetector({ detector: "openrouter" });
    detector.feed(fixture.raw);
    const result = detector.evaluate();
    assert.equal(
      result.state,
      fixture.expect,
      `${fixture.name}: expected "${fixture.expect}", got "${result.state}" (rule ${result.ruleId})`,
    );
  }
});
