import assert from "node:assert/strict";

import { buildInstantChatToolReply, enforceInstantOutputConstraints } from "../src/phantom-ai/instant-chat-tools.js";

const ticketTurns = [
  { user: "A ticket is 45 dollars. Apply a 20 percent discount.", assistant: "The discounted price is $36." },
  { user: "I need three tickets, then add 8 percent tax.", assistant: "3 tickets with tax total $116.64." },
];

assert.deepEqual(
  buildInstantChatToolReply(ticketTurns[0].user, []),
  { output_text: "The discounted price is $36.", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply(ticketTurns[1].user, ticketTurns.slice(0, 1)),
  { output_text: "3 tickets with 8% tax total $116.64.", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply("Double-check it step by step.", ticketTurns),
  { output_text: "$45 x 0.80 = $36 each; $36 x 3 = $108; $108 x 1.08 = $116.64.", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply("Now give me only the final number.", ticketTurns),
  { output_text: "116.64", tool_id: "phantom-calculator" },
);

const listTurns = [{
  user: "Give me three names.",
  assistant: "Nano Rocket\nPebble Pod\nMini Quasar",
}];
assert.deepEqual(
  buildInstantChatToolReply("Pick the second one.", listTurns),
  { output_text: "Pebble Pod", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Choose the third one.", [{ user: "Names only.", assistant: "Micro Rocket, Nano Voyager, Pico Cruiser" }]),
  { output_text: "Pico Cruiser", tool_id: "phantom-reference-resolver" },
);
assert.equal(buildInstantChatToolReply("Tell me a joke.", listTurns), null);
assert.deepEqual(
  buildInstantChatToolReply("What is 12 times 7?", []),
  { output_text: "12 times 7 = 84.", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply("What is 15 percent of 240?", []),
  { output_text: "15% of 240 = 36.", tool_id: "phantom-calculator" },
);
assert.equal(
  enforceInstantOutputConstraints(
    "End with one surprising fact, no introduction.",
    "Octopuses are smart. Did you know that each arm can process information independently?",
  ),
  "Each arm can process information independently.",
);
assert.equal(
  enforceInstantOutputConstraints("One fact, no intro.", "octopuses have three hearts"),
  "Octopuses have three hearts.",
);
assert.equal(
  enforceInstantOutputConstraints(
    "One fact, no introduction.",
    "Yes, both are intelligent; did you know that octopuses can open jars from the outside.",
  ),
  "Octopuses can open jars from the outside.",
);
assert.equal(
  enforceInstantOutputConstraints(
    "One fact, no introduction.",
    "Both are smart; both are unusual, but did you know octopuses have three hearts.",
  ),
  "Octopuses have three hearts.",
);

console.log("instant chat deterministic tool checks passed");
