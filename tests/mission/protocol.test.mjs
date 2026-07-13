import assert from "node:assert/strict";
import { test } from "node:test";

import { EVENT_TYPES, parseEvents } from "../../mission/protocol.js";

test("parses a single well-formed event line", () => {
  const events = parseEvents('TERMINA_EVENT: {"type":"STARTED","detail":"beginning audit"}\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "STARTED");
  assert.equal(events[0].detail, "beginning audit");
});

test("parses multiple events across a chunk, ignoring surrounding prose", () => {
  const text = [
    "I'm going to start by reading the repo.",
    'TERMINA_EVENT: {"type":"DISCOVERY","detail":"found 3 config files"}',
    "Now claiming a file before editing it.",
    'TERMINA_EVENT: {"type":"FILE_CLAIM","detail":"server.js"}',
  ].join("\n");
  const events = parseEvents(text);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.type), ["DISCOVERY", "FILE_CLAIM"]);
});

test("ignores malformed JSON rather than throwing", () => {
  const events = parseEvents('TERMINA_EVENT: {not valid json}\n');
  assert.deepEqual(events, []);
});

test("ignores an unrecognized event type", () => {
  const events = parseEvents('TERMINA_EVENT: {"type":"MADE_UP_TYPE","detail":"x"}\n');
  assert.deepEqual(events, []);
});

test("ignores lines that merely mention the marker in passing", () => {
  const events = parseEvents("I will use TERMINA_EVENT lines to report progress.\n");
  assert.deepEqual(events, []);
});

test("returns an empty array for plain output with no protocol lines", () => {
  assert.deepEqual(parseEvents("just some normal terminal output\nwith multiple lines\n"), []);
});

test("BRANCHED is a recognized event type, for Mission DVR branch records", () => {
  assert.ok(EVENT_TYPES.includes("BRANCHED"));
});
