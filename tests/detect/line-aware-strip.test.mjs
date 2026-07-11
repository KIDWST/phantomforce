import assert from "node:assert/strict";
import { test } from "node:test";

import { createLineAwareStripper } from "../../detect/line-aware-strip.js";

test("a cursor move to a different row becomes a newline", () => {
  const feed = createLineAwareStripper();
  const out = feed("\x1b[3;2HAccessing\x1b[1Cworkspace:\x1b[5;2HQuick\x1b[1Csafety");
  assert.equal(out, " Accessing workspace:\nQuick safety");
});

test("a cursor move within the same row stays a space, not a newline", () => {
  const feed = createLineAwareStripper();
  const out = feed("\x1b[3;2Hone\x1b[3;20Htwo");
  assert.ok(!out.includes("\n"));
  assert.ok(out.includes("one"));
  assert.ok(out.includes("two"));
});

test("row tracking persists across separate feed() calls (stateful per session)", () => {
  const feed = createLineAwareStripper();
  feed("\x1b[3;2Hfirst chunk");
  const out = feed("\x1b[9;2Hsecond chunk");
  assert.ok(out.startsWith("\n"));
});

test("a full-screen clear resets row tracking so the next position starts fresh", () => {
  const feed = createLineAwareStripper();
  feed("\x1b[3;2Hbefore clear");
  const out = feed("\x1b[2J\x1b[3;2Hafter clear on the same row number");
  // Same row number (3) as before, but a clear happened in between, so this
  // must not be silently treated as "still on row 3, no newline needed".
  assert.ok(!out.includes("\n"));
});
