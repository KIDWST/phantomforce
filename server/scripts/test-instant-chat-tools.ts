import assert from "node:assert/strict";

import { buildInstantChatToolReply, enforceInstantOutputConstraints, instantResponseTokenBudget } from "../src/phantom-ai/instant-chat-tools.js";
import { buildInstantConversationContext, buildInstantConversationUserMessage, MAX_INSTANT_CONTEXT_CHARS, needsInstantConversationContext, selectRelevantInstantTurns } from "../src/phantom-ai/instant-chat-context.js";

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
const longNovaTurns = [
  { user: "My dog Nova wears a yellow raincoat.", assistant: "Nova wears yellow." },
  { user: "Correction: Nova's raincoat is purple.", assistant: "Nova's raincoat is purple." },
  ...Array.from({ length: 9 }, (_, index) => ({
    user: `Unrelated subject ${index + 1}.`,
    assistant: `Unrelated answer ${index + 1}.`,
  })),
];
assert.deepEqual(
  buildInstantChatToolReply("Back to Nova: what color is her raincoat? Color only.", longNovaTurns),
  { output_text: "purple", tool_id: "phantom-context-recall" },
);
assert.deepEqual(
  buildInstantChatToolReply("What was the launch codename? Name only.", [
    { user: "The launch codename is Glacier.", assistant: "Understood: Glacier." },
    { user: "Correction: the launch codename is Ember.", assistant: "Corrected: Ember." },
  ]),
  { output_text: "Ember", tool_id: "phantom-context-recall" },
);
const folderTurns = [
  { user: "The red folder contains invoices. The blue folder contains contracts.", assistant: "The red folder has invoices; the blue folder has contracts." },
  { user: "What does the former contain? Noun only.", assistant: "invoices" },
];
assert.deepEqual(
  buildInstantChatToolReply("What does the former contain? Noun only.", folderTurns.slice(0, 1)),
  { output_text: "invoices", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What does the latter contain? Noun only.", folderTurns),
  { output_text: "contracts", tool_id: "phantom-reference-resolver" },
);
assert.equal(
  selectRelevantInstantTurns(folderTurns, "What does the latter contain? Noun only.").length,
  2,
  "a second paired reference must retain the original source turn",
);
const pluralReferenceTurns = [
  { user: "Move the third before the first.", assistant: "meeting\nemail\ncall" },
  { user: "Mina packed maps and Theo packed snacks.", assistant: "Mina brought maps; Theo packed snacks." },
];
assert.deepEqual(
  selectRelevantInstantTurns(pluralReferenceTurns, "What did they pack? Name each person and item."),
  pluralReferenceTurns.slice(-1),
  "plural pronouns must retain the active setup despite pack/packed inflection",
);
const numberedOptions = [{
  user: "Options: 1) email, 2) call, 3) meeting.",
  assistant: "The options are email, call, and meeting.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Move the third before the first. Return the reordered list only.", numberedOptions),
  { output_text: "meeting\nemail\ncall", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Swap the first and third. Return the reordered list only.", numberedOptions),
  { output_text: "meeting\ncall\nemail", tool_id: "phantom-reference-resolver" },
);
const causalTurns = [{
  user: "Two results: 1) The upload failed because the file was corrupt. 2) The report arrived late because the export queue stalled.",
  assistant: "The upload failed due to a corrupt file, and the report was late because the export queue stalled.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Why did the second result happen? Reason only.", causalTurns),
  { output_text: "the export queue stalled", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What outcome did that reason explain? Outcome only.", [
    ...causalTurns,
    { user: "Why did the second result happen? Reason only.", assistant: "the export queue stalled" },
  ]),
  { output_text: "The report arrived late", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What happened as a result? Outcome only.", [{
    user: "The battery was empty; therefore, the sensor shut down.",
    assistant: "The empty battery caused the sensor to shut down.",
  }]),
  { output_text: "the sensor shut down", tool_id: "phantom-reference-resolver" },
);
const overlappingMeetingTurns = [
  { user: "The meeting is Tuesday at 2 PM in Room 4.", assistant: "Tuesday at 2 PM in Room 4." },
  { user: "Correction: Thursday at 4 PM in Room 9.", assistant: "Thursday at 4 PM in Room 9." },
  { user: "Two results: 1) A happened because B. 2) C happened because D.", assistant: "Noted." },
  { user: "The meeting is Tuesday at 2 PM in Room 4.", assistant: "Tuesday at 2 PM in Room 4." },
  { user: "Correction: Thursday at 3 PM in Room 7.", assistant: "Thursday at 3 PM in Room 7." },
];
assert.deepEqual(
  buildInstantChatToolReply("Actually, keep the original plan after all.", overlappingMeetingTurns),
  { output_text: "Restored the original plan: Tuesday at 2 PM in Room 4.", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What are the final day, time, and room? DAY | TIME | ROOM only.", [
    ...overlappingMeetingTurns,
    { user: "Actually, keep the original plan after all.", assistant: "Restored the original plan: Tuesday at 2 PM in Room 4." },
  ]),
  { output_text: "Tuesday | 2 PM | Room 4", tool_id: "phantom-reference-resolver" },
);
const posterTurns = [
  { user: "The poster background is black, the title is white, and the button is green.", assistant: "Noted." },
  { user: "Change the background to navy, the title to gold, and the button to orange.", assistant: "Updated." },
  { user: "Actually restore the original title only. Keep the other changes.", assistant: "Restored the original title. Current design: navy background, white title, orange button." },
];
assert.deepEqual(
  buildInstantChatToolReply("Actually restore the original title only. Keep the other changes.", [...overlappingMeetingTurns, ...posterTurns.slice(0, 2)]),
  { output_text: "Restored the original title. Current design: navy background, white title, orange button.", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What are the final background, title, and button colors? BACKGROUND | TITLE | BUTTON only.", posterTurns),
  { output_text: "navy | white | orange", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("No, you misunderstood me. Keep the first idea but use the playful tone from the second answer. One sentence.", [
    { user: "Give me two taglines.", assistant: "1. Quiet power, visible results.\n2. Built for the work nobody sees." },
    { user: "Make the second one playful.", assistant: "Built for the work nobody sees - now with fewer boring buttons." },
  ]),
  { output_text: "Quiet power, visible results - now with a little more spark.", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What did she choose?", [
    { user: "Help me plan a party.", assistant: "Choose a theme first." },
    { user: "This feels robotic.", assistant: "Use warmer wording." },
    { user: "Dana chose tea and Priya chose coffee.", assistant: "Dana chose tea; Priya chose coffee." },
  ]),
  { output_text: "Do you mean Dana or Priya?", tool_id: "phantom-clarifier" },
);
assert.equal(
  buildInstantChatToolReply("What did she choose?", [
    { user: "Dana chose tea.", assistant: "Dana chose tea." },
  ]),
  null,
  "one named subject is not genuinely ambiguous",
);
assert.equal(
  buildInstantChatToolReply("Back to Nova: what color is her raincoat?", [
    { user: "Nova wears a purple raincoat.", assistant: "Got it. Nova wears purple." },
    { user: "For another topic, tell me about Saturn.", assistant: "Saturn is a gas giant." },
    { user: "What is the capital of Portugal? City only.", assistant: "Lisbon" },
    { user: "Dana chose tea and Priya chose coffee.", assistant: "Dana chose tea; Priya chose coffee." },
  ])?.tool_id,
  "phantom-context-recall",
  "capitalized words from separate topics must not create false ambiguity",
);
assert.deepEqual(
  buildInstantChatToolReply("Who are you?", [], "qwen2.5:14b"),
  { output_text: "I'm Phantom AI, the general-purpose assistant inside PhantomForce.", tool_id: "phantom-identity" },
);
assert.deepEqual(
  buildInstantChatToolReply("What model are you running for this conversation?", [], "qwen2.5:14b"),
  { output_text: "Phantom's fast conversation lane is currently qwen2.5:14b.", tool_id: "phantom-identity" },
);
assert.deepEqual(
  buildInstantChatToolReply("Are you ChatGPT?", [], "qwen2.5:14b"),
  { output_text: "No. I'm Phantom AI inside PhantomForce.", tool_id: "phantom-identity" },
);
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
assert.equal(
  enforceInstantOutputConstraints(
    "For this chat only, my dog Nova wears a yellow raincoat.",
    "Got it. Nova wears a yellow raincoat. Anything specific you'd like to discuss?",
  ),
  "Got it. Nova wears a yellow raincoat.",
);
assert.equal(
  enforceInstantOutputConstraints("Turn that into a question.", "Why is the sky blue?"),
  "Why is the sky blue?",
);
assert.equal(
  enforceInstantOutputConstraints("Write exactly five words about rain.", "Rain paints the whole city."),
  "Rain paints the whole city.",
);
assert.equal(
  enforceInstantOutputConstraints("Write exactly five words about rain.", "Rain paints city streets."),
  "Rain paints city streets outside.",
);
assert.equal(
  enforceInstantOutputConstraints("Write exactly three words about rain.", "Rain paints every city street silver."),
  "Rain paints every.",
);
assert.equal(instantResponseTokenBudget("What is the capital of Japan?"), 80);
assert.equal(instantResponseTokenBudget("Explain rainbows in about 120 words."), 242);
assert.equal(instantResponseTokenBudget("Give exactly 5 bullet points."), 188);
assert.equal(instantResponseTokenBudget("Write a detailed article about rainbows."), 320);
assert.equal(instantResponseTokenBudget("Write exactly 900 words."), 592);

const favoriteFood = buildInstantChatToolReply("What's your favorite food? Pick one.");
assert.equal(favoriteFood?.tool_id, "phantom-personality");
assert.match(favoriteFood?.output_text || "", /ramen/i);
assert.equal(buildInstantChatToolReply("What's my favorite food?"), null);
const verifiedOctopus = buildInstantChatToolReply("Give one surprising, verified octopus fact.");
assert.equal(verifiedOctopus?.tool_id, "phantom-stable-fact");
assert.equal(verifiedOctopus?.output_text, "Octopuses have three hearts.");
assert.equal(
  enforceInstantOutputConstraints("Choose a dessert that pairs with it. Dessert only.", "Chocolate mousse - rich and creamy."),
  "Chocolate mousse",
);
assert.equal(enforceInstantOutputConstraints("City only.", "Tokyo\nJapan's capital."), "Tokyo");
assert.equal(enforceInstantOutputConstraints("Code only.", "const answer = 1;"), "const answer = 1;");
assert.equal(enforceInstantOutputConstraints("Code only.", "```javascript\nconst answer = 1;\n```"), "const answer = 1;");

const oversizedTurns = Array.from({ length: 8 }, (_, index) => ({
  user: `user-${index + 1} ${"u".repeat(400)}`,
  assistant: `assistant-${index + 1} ${"a".repeat(500)}`,
}));
const packedContext = buildInstantConversationContext(oversizedTurns);
assert.ok(packedContext.length <= MAX_INSTANT_CONTEXT_CHARS);
assert.match(packedContext, /user-8/);
assert.match(packedContext, /assistant-8/);
assert.match(packedContext, /later corrections as authoritative/);
assert.match(packedContext, /replacement only/);
assert.match(packedContext, /never invent a plausible-sounding detail/);
assert.doesNotMatch(packedContext, /user-1/);

const resetContext = buildInstantConversationContext([
  { user: "old-topic", assistant: "old-answer" },
  { user: "New topic: blue moons", assistant: "new-answer" },
  { user: "tell me more", assistant: "newest-answer" },
]);
assert.doesNotMatch(resetContext, /old-topic|old-answer/);
assert.match(resetContext, /blue moons|newest-answer/);

const correctedBlendContext = buildInstantConversationContext([
  { user: "Give me two taglines.", assistant: "1. Quiet power, visible results.\n2. Built for the work nobody sees." },
  { user: "Make the second one playful.", assistant: "Built for the work nobody sees - now with fewer boring buttons." },
], "No, you misunderstood me. Keep the first idea but use the playful tone from the second answer.");
assert.match(correctedBlendContext, /CONTENT TO PRESERVE: Quiet power, visible results[.]/);
assert.match(correctedBlendContext, /STYLE REFERENCE ONLY: Built for the work nobody sees/);
assert.match(correctedBlendContext, /Do not reuse or substitute the style reference's subject/);
const correctedBlendMessage = buildInstantConversationUserMessage([
  { user: "Give me two taglines.", assistant: "1. Quiet power, visible results.\n2. Built for the work nobody sees." },
  { user: "Make the second one playful.", assistant: "Built for the work nobody sees - now with fewer boring buttons." },
], "No, you misunderstood me. Keep the first idea but use the playful tone from the second answer.");
assert.match(correctedBlendMessage, /Rewrite this exact content while preserving its meaning and subject/);
assert.match(correctedBlendMessage, /Quiet power, visible results[.]/);
assert.match(correctedBlendMessage, /Requested tone: playful[.]/);
assert.doesNotMatch(correctedBlendMessage, /work nobody sees|boring buttons/);

const staleBusinessTurns = [
  { user: "Review the accounting ledger.", assistant: "The ledger and sales pipeline need attention." },
  { user: "What is overdue?", assistant: "Two ledger entries and one pipeline item." },
];
assert.equal(needsInstantConversationContext(staleBusinessTurns, "Tell me a joke about penguins."), false);
const cleanStandaloneContext = buildInstantConversationContext(staleBusinessTurns, "Tell me a joke about penguins.");
assert.doesNotMatch(cleanStandaloneContext, /Review the accounting ledger|sales pipeline need|Two ledger entries|pipeline item/i);
assert.match(cleanStandaloneContext, /standalone; do not carry over prior topics/i);

const switchedTurns = [
  ...staleBusinessTurns,
  { user: "Tell me a joke about penguins.", assistant: "A penguin wore a tuxedo because every night felt formal." },
];
assert.equal(needsInstantConversationContext(switchedTurns, "Shorter."), true);
const cleanFollowUpContext = buildInstantConversationContext(switchedTurns, "Shorter.");
assert.match(cleanFollowUpContext, /penguin wore a tuxedo/i);
assert.doesNotMatch(cleanFollowUpContext, /Review the accounting ledger|sales pipeline need|Two ledger entries|pipeline item/i);
assert.equal(needsInstantConversationContext([{ user: "My dog is Nova.", assistant: "Nova sounds lovely." }], "Tell me about Nova."), true);
assert.equal(needsInstantConversationContext([{ user: "Compare octopuses and dolphins.", assistant: "Octopuses hide; dolphins echolocate." }], "Make the comparison playful."), true);
assert.equal(needsInstantConversationContext([{ user: "Name a tiny spaceship.", assistant: "Pocket Comet" }], "Give me three more, names only."), true);
assert.equal(needsInstantConversationContext([{ user: "I want to visit Japan in spring.", assistant: "Spring is a beautiful season for Japan." }], "How long should I stay?"), true);
assert.equal(needsInstantConversationContext([{ user: "I am thinking about adopting a greyhound.", assistant: "Greyhounds can be calm companions." }], "What should I know first?"), true);

const revisitedNamedTopic = buildInstantConversationContext([
  { user: "My dog Nova wears a yellow raincoat.", assistant: "Nova sounds stylish." },
  { user: "Actually, Nova's raincoat is purple.", assistant: "Got it: Nova's raincoat is purple." },
  { user: "Explain volcanoes.", assistant: "Volcanoes release magma." },
  { user: "What is jazz?", assistant: "Jazz is improvisational music." },
  { user: "Tell me about Saturn.", assistant: "Saturn is a gas giant." },
], "Back to Nova: what color is her raincoat?");
assert.match(revisitedNamedTopic, /Nova's raincoat is purple/i);
assert.doesNotMatch(revisitedNamedTopic, /Volcanoes|Jazz|Saturn/i);

console.log("instant chat deterministic tool checks passed");
