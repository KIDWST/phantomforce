// The reporting protocol workers are asked (in their prompt) to follow:
// a line of the form `TERMINA_EVENT: {"type": "...", ...}`. Parsing is
// resilient — a worker that never emits a valid line just leaves status
// derived from the Phase A detector instead, and the user can correct it
// manually. We never invent events that weren't actually emitted.
export const EVENT_TYPES = [
  "STARTED",
  "DISCOVERY",
  "FILE_CLAIM",
  "BLOCKER",
  "QUESTION",
  "PROPOSED_CHANGE",
  "CHANGE_APPLIED",
  "TEST_RESULT",
  "HANDOFF",
  "COMPLETE",
  "FAILED",
  "BRANCHED",
];

const EVENT_LINE = /^TERMINA_EVENT:\s*(\{.*\})\s*$/;

// Parses every well-formed TERMINA_EVENT line out of a chunk of (already
// ANSI-stripped) text. Malformed JSON or an unrecognized type is skipped,
// not guessed at.
export function parseEvents(strippedText) {
  const events = [];
  for (const rawLine of strippedText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = EVENT_LINE.exec(line);
    if (!match) continue;
    let payload;
    try {
      payload = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object" || !EVENT_TYPES.includes(payload.type)) continue;
    events.push(payload);
  }
  return events;
}
