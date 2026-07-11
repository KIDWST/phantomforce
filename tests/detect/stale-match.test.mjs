import assert from "node:assert/strict";
import { test } from "node:test";

import { createDetector } from "../../detect/index.js";

// Regression for a real bug: a dismissed trust/approval prompt's "confirm"
// wording lingered in the rolling window long after being resolved, and
// (being higher-confidence than the idle-box rule) permanently reported
// needs_approval even once the session returned to idle with nothing
// actually pending.
test("a stale confirm-prompt match does not outlast a later idle prompt", () => {
  const detector = createDetector({ detector: "claude" });

  detector.feed("Is this a project you created or one you trust? Enter to confirm · Esc to cancel\n");
  detector.evaluate(); // simulates the trust prompt being seen/handled

  // A short task completes and Claude returns to its idle prompt — total
  // new output is small, well under the old 4KB window, so the earlier
  // "confirm" text is still technically present in the rolling window.
  detector.feed("Bonjour\nHola\n❯ \n");
  const result = detector.evaluate();

  assert.equal(result.state, "waiting");
});

test("a genuinely current confirm prompt is still detected as needs_approval", () => {
  const detector = createDetector({ detector: "claude" });
  detector.feed("Overwrite existing file? (y/n) ");
  const result = detector.evaluate();
  assert.equal(result.state, "needs_approval");
});

// Regression for a second real bug found live: the "esc to interrupt" hint
// bar shown WHILE Claude is actively working reuses the same "❯" glyph as
// the idle prompt, and — because these TUIs redraw via absolute cursor
// positioning, not newlines — a naive text-only representation can't tell
// that the later idle prompt is on a genuinely different screen row than
// the earlier interrupt hint. Real cursor-position codes here (not plain
// text) are what exercise the row-tracking fix in detect/line-aware-strip.js.
test("an interrupt-hint match while working does not outlast a later, different-row idle prompt", () => {
  const detector = createDetector({ detector: "claude" });

  // Row 10: the active-work hint bar (contains the idle glyph too).
  detector.feed("\x1b[10;2H✢  ❯   · esc to interrupt · ← for agents");
  const midTask = detector.evaluate();
  assert.equal(midTask.state, "running");

  // Row 25: the real idle prompt reappears once the task finishes.
  detector.feed("\x1b[25;2H❯ Try \"fix typecheck errors\"");
  const afterTask = detector.evaluate();
  assert.equal(afterTask.state, "waiting");
});
