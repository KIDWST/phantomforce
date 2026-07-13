import assert from "node:assert/strict";
import { test } from "node:test";

import { createPasteParser } from "../../openrouter-agent/paste.mjs";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

test("a plain single-line submission (no bracketed paste) submits on Enter", () => {
  const parser = createPasteParser();
  assert.deepEqual(parser.feed("hello"), { type: "buffering" });
  assert.deepEqual(parser.feed("\r"), { type: "submitted", text: "hello" });
});

test("a bracketed-paste block with embedded newlines does not submit early", () => {
  const parser = createPasteParser();
  assert.deepEqual(parser.feed(`${PASTE_START}line one\nline two\nline three`), { type: "buffering" });
  // A raw \n arriving as its own chunk (PTY data can fragment mid-paste) is
  // still paste content, not a submit trigger — it must survive into the
  // final submitted text, not be silently dropped or treated as Enter.
  assert.deepEqual(parser.feed("\n"), { type: "buffering" });
  assert.deepEqual(parser.feed(PASTE_END), { type: "buffering" }); // paste closed, not yet submitted
  assert.deepEqual(parser.feed("\r"), { type: "submitted", text: "line one\nline two\nline three\n" });
});

test("after one submission, the parser resets and accepts the next input", () => {
  const parser = createPasteParser();
  parser.feed("first");
  parser.feed("\r");
  assert.deepEqual(parser.feed("second"), { type: "buffering" });
  assert.deepEqual(parser.feed("\r"), { type: "submitted", text: "second" });
});
