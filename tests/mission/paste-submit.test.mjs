import assert from "node:assert/strict";
import { test } from "node:test";

import { ENTER, bracketedPaste, submitBracketedPaste } from "../../mission/paste.js";

test("submitBracketedPaste pastes once and sends spaced submit retries", async () => {
  const writes = [];
  const waits = [];
  const proc = { write: (chunk) => writes.push(chunk) };

  const result = await submitBracketedPaste(proc, "run five workers", {
    submitDelayMs: 10,
    retryDelayMs: 5,
    retries: 3,
    sleep: async (ms) => { waits.push(ms); },
  });

  assert.deepEqual(result, { pasteWrites: 1, submitWrites: 3 });
  assert.equal(writes[0], bracketedPaste("run five workers"));
  assert.deepEqual(writes.slice(1), [ENTER, ENTER, ENTER]);
  assert.deepEqual(waits, [10, 5, 5]);
});

test("submitBracketedPaste always submits at least once", async () => {
  const writes = [];
  const proc = { write: (chunk) => writes.push(chunk) };

  const result = await submitBracketedPaste(proc, "single worker", {
    submitDelayMs: 0,
    retryDelayMs: 0,
    retries: 0,
    sleep: async () => {},
  });

  assert.equal(result.submitWrites, 1);
  assert.deepEqual(writes.slice(1), [ENTER]);
});
