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
const respectivelyTurns = [{
  user: "Mina, Theo, and Priya chose tea, coffee, and juice, respectively.",
  assistant: "Mina chose tea, Theo chose coffee, and Priya chose juice.",
}];
assert.deepEqual(
  buildInstantChatToolReply("What did Theo choose? Drink only.", respectivelyTurns),
  { output_text: "coffee", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who chose juice? Name only.", respectivelyTurns),
  { output_text: "Priya", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What did the second person choose? Drink only.", respectivelyTurns),
  { output_text: "coffee", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What did Theo choose?", [{
    user: "Mina and Theo chose tea, coffee, and juice, respectively.",
    assistant: "I need clarification because the lists do not pair evenly.",
  }]),
  { output_text: "I have 2 people and 3 choices. Which choice belongs to Theo?", tool_id: "phantom-clarifier" },
);
assert.equal(
  buildInstantChatToolReply("What did they pack? Name each person and item.", [
    { user: "Mina and Theo chose tea, coffee, and juice, respectively.", assistant: "The lists do not pair evenly." },
    { user: "Mina packed maps and Theo packed snacks.", assistant: "Mina packed maps; Theo packed snacks." },
  ]),
  null,
  "an older unequal mapping must not hijack an unrelated plural follow-up",
);
assert.equal(
  buildInstantChatToolReply("How many more laps did Theo log than Mina? Number and unit only.", [
    { user: "Mina and Theo chose tea, coffee, and juice, respectively.", assistant: "The lists do not pair evenly." },
    { user: "Mina logged 12 laps, Theo logged 18 laps, and Priya logged 15 laps.", assistant: "Values noted." },
  ])?.output_text,
  "6 laps",
  "an older unequal mapping must not hijack a later named quantity comparison",
);
const namedRevisionTurns = [
  { user: "Mina's badge is red and Theo's badge is blue.", assistant: "Mina's badge is red; Theo's badge is blue." },
  { user: "Change Mina's badge to gold and Theo's to green.", assistant: "Mina's badge is gold; Theo's badge is green." },
  { user: "Undo Mina's change but keep Theo's.", assistant: "Mina's badge is red; Theo's badge remains green." },
];
assert.deepEqual(
  buildInstantChatToolReply("Undo Mina's change but keep Theo's.", namedRevisionTurns.slice(0, 2)),
  { output_text: "Restored Mina's badge to red. Theo's badge remains green.", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What are Mina's and Theo's final badge colors? MINA | THEO only.", namedRevisionTurns),
  { output_text: "red | green", tool_id: "phantom-reference-resolver" },
);
const quantityTurns = [{
  user: "Mina logged 12 laps, Theo logged 18 laps, and Priya logged 15 laps.",
  assistant: "Mina logged 12 laps, Theo logged 18 laps, and Priya logged 15 laps.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Who logged the most? Name only.", quantityTurns),
  { output_text: "Theo", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many more laps did Theo log than Mina? Number and unit only.", quantityTurns),
  { output_text: "6 laps", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply("Rank them from most to least. Names only, separated by >.", quantityTurns),
  { output_text: "Theo > Priya > Mina", tool_id: "phantom-reference-resolver" },
);
const correctedQuantityTurns = [
  ...quantityTurns,
  { user: "Correction: Mina logged 20 laps.", assistant: "Mina now has 20 laps." },
];
assert.deepEqual(
  buildInstantChatToolReply("Who logged the most now? Name only.", correctedQuantityTurns),
  { output_text: "Mina", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many more laps did Mina log than Theo? Number and unit only.", correctedQuantityTurns),
  { output_text: "2 laps", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who has more?", [{ user: "Mina has 4 points and Theo has 4 points.", assistant: "Both have 4 points." }]),
  { output_text: "Mina and Theo are tied at 4 points.", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who did more?", [{ user: "Mina walked 5 miles and Theo worked 6 hours.", assistant: "Noted." }]),
  { output_text: "Those values use different units (miles and hours). What should I compare?", tool_id: "phantom-clarifier" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many more laps did Mina log than Theo?", [{ user: "Mina logged 12 laps.", assistant: "Mina logged 12 laps." }]),
  { output_text: "I have Mina's value, but not Theo's. What is Theo's value?", tool_id: "phantom-clarifier" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many more laps did Mina log than Theo?", [
    { user: "Mina walked 5 miles and Theo worked 6 hours.", assistant: "Noted." },
    { user: "Mina logged 12 laps.", assistant: "Mina logged 12 laps." },
  ]),
  { output_text: "I have Mina's value, but not Theo's. What is Theo's value?", tool_id: "phantom-clarifier" },
  "the newest explicit quantity topic must beat an older complete comparison",
);
const eventTurns = [{
  user: "Sequence: 1) Mina opened the gate. 2) Theo rang the bell. 3) Priya crossed the bridge. 4) Theo rang the bell again. 5) Mina closed the gate.",
  assistant: "Sequence noted.",
}];
assert.deepEqual(
  buildInstantChatToolReply("What happened immediately before Priya crossed the bridge? Event only.", eventTurns),
  { output_text: "Theo rang the bell", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What happened immediately after Priya crossed the bridge? Event only.", eventTurns),
  { output_text: "Theo rang the bell again", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("What happened before Theo rang the bell?", eventTurns),
  { output_text: "Do you mean the first or second time Theo rang the bell?", tool_id: "phantom-clarifier" },
);
const namedPredicateTurns = [{
  user: "For this chat only: my cats are Comet and Luna. Comet sleeps on the keyboard; Luna steals socks.",
  assistant: "Comet sleeps on the keyboard, and Luna steals socks.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Which one steals socks? Name only.", namedPredicateTurns),
  { output_text: "Luna", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Now which one steals socks? Name only.", [
    ...namedPredicateTurns,
    { user: "Actually, switch those habits: Comet steals socks and Luna sleeps on the keyboard.", assistant: "Switched." },
  ]),
  { output_text: "Comet", tool_id: "phantom-reference-resolver" },
);
const exceptionMembershipTurns = [{
  user: "The launch team is Mina, Theo, Priya, and Omar. Everyone except Theo confirmed.",
  assistant: "Mina, Priya, and Omar confirmed; Theo did not.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Who confirmed? Names only.", exceptionMembershipTurns),
  { output_text: "Mina, Priya, Omar", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who did not confirm? Name only.", exceptionMembershipTurns),
  { output_text: "Theo", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many confirmed? Number only.", exceptionMembershipTurns),
  { output_text: "3", tool_id: "phantom-calculator" },
);
assert.deepEqual(
  buildInstantChatToolReply("Did Theo confirm? Yes or no only.", exceptionMembershipTurns),
  { output_text: "No", tool_id: "phantom-reference-resolver" },
);

const correctedMembershipTurns = [
  ...exceptionMembershipTurns,
  { user: "Correction: Theo confirmed after all.", assistant: "Theo is now confirmed." },
  { user: "Actually, Priya did not confirm.", assistant: "Priya is now not confirmed." },
];
assert.deepEqual(
  buildInstantChatToolReply("Who confirmed now? Names only.", correctedMembershipTurns),
  { output_text: "Mina, Theo, Omar", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who did not confirm now? Name only.", correctedMembershipTurns),
  { output_text: "Priya", tool_id: "phantom-reference-resolver" },
);

const onlyMembershipTurns = [{
  user: "The reviewers are Mina, Theo, Priya, and Omar. Only Mina and Priya confirmed.",
  assistant: "Mina and Priya confirmed.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Who did not confirm? Names only.", onlyMembershipTurns),
  { output_text: "Theo, Omar", tool_id: "phantom-reference-resolver" },
);

const neitherMembershipTurns = [{
  user: "The reviewers are Mina, Theo, Priya, and Omar. Neither Mina nor Theo confirmed.",
  assistant: "Mina and Theo did not confirm.",
}];
assert.deepEqual(
  buildInstantChatToolReply("Who did not confirm? Names only.", neitherMembershipTurns),
  { output_text: "Mina, Theo", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many confirmed? Number only.", neitherMembershipTurns),
  { output_text: "I know Mina and Theo did not confirm, but confirmation is unknown for Priya and Omar. Did they confirm?", tool_id: "phantom-clarifier" },
);

const doubleNegativeMembershipTurns = [
  ...exceptionMembershipTurns,
  { user: "It is not true that Theo did not confirm.", assistant: "Theo confirmed." },
];
assert.deepEqual(
  buildInstantChatToolReply("Did Theo confirm? Yes or no only.", doubleNegativeMembershipTurns),
  { output_text: "Yes", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Did Zara confirm? Yes or no only.", exceptionMembershipTurns),
  { output_text: "Zara is not in the stated launch team. Who should Zara replace or join?", tool_id: "phantom-clarifier" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who confirmed? Names only.", [{ user: "Everyone except Theo confirmed.", assistant: "Noted." }]),
  { output_text: "I know Theo was excluded, but I do not know who 'everyone' includes. Who is in the group?", tool_id: "phantom-clarifier" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who confirmed? Names only.", [
    { user: "Participants: Mina, Theo, Priya, and Omar.", assistant: "Four participants." },
    { user: "Everyone except Omar confirmed.", assistant: "Omar is the exception." },
  ]),
  { output_text: "Mina, Theo, Priya", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who confirmed now? Names only.", [
    ...exceptionMembershipTurns,
    { user: "Add Theo to the confirmed group and remove Omar from the confirmed group.", assistant: "Updated." },
  ]),
  { output_text: "Mina, Theo, Priya", tool_id: "phantom-reference-resolver" },
);
assert.deepEqual(
  buildInstantChatToolReply("Did Theo confirm? Yes or no only.", [{
    user: "The launch team is Mina, Theo, and Priya. Everyone except Theo confirmed, but Theo also confirmed.",
    assistant: "That conflicts.",
  }]),
  { output_text: "I have conflicting confirmation updates for Theo. Did Theo confirm?", tool_id: "phantom-clarifier" },
);
const longMembershipContext = [
  ...exceptionMembershipTurns,
  { user: "Who confirmed?", assistant: "Mina, Priya, Omar" },
  { user: "Who did not confirm?", assistant: "Theo" },
  { user: "How many confirmed?", assistant: "3" },
  { user: "Did Theo confirm?", assistant: "No" },
  { user: "Correction: Theo confirmed after all.", assistant: "Updated." },
  { user: "Actually, Priya did not confirm.", assistant: "Updated." },
  { user: "Who confirmed now?", assistant: "Mina, Theo, Omar" },
];
assert.equal(
  selectRelevantInstantTurns(longMembershipContext, "Who did not confirm now? Names only.")[0].user,
  exceptionMembershipTurns[0].user,
  "membership follow-ups must retain their governing roster/base instead of only earlier questions",
);
const splitRosterContext = [
  { user: "Participants: Mina, Theo, Priya, and Omar.", assistant: "Four participants." },
  { user: "Everyone except Omar confirmed.", assistant: "Omar is the exception." },
];
assert.equal(
  selectRelevantInstantTurns(splitRosterContext, "Who confirmed? Names only.")[0].user,
  splitRosterContext[0].user,
  "an everyone-except statement must remain attached to its immediately prior roster",
);
assert.deepEqual(
  buildInstantChatToolReply("Who did not confirm? Names only.", [{ user: "Only Mina and Priya confirmed.", assistant: "Noted." }]),
  { output_text: "I know only Mina and Priya confirmed, but I do not know who else is in the group. Who is in the group?", tool_id: "phantom-clarifier" },
);
assert.deepEqual(
  buildInstantChatToolReply("How many confirmed? Number only.", [{ user: "Neither Mina nor Theo confirmed.", assistant: "Noted." }]),
  { output_text: "I know Mina and Theo did not confirm, but I do not know who else is in the group. Who is in the group?", tool_id: "phantom-clarifier" },
);
assert.deepEqual(
  buildInstantChatToolReply("Who confirmed now? Names only.", [
    ...exceptionMembershipTurns,
    { user: "Correction: Zara confirmed after all.", assistant: "Updated." },
  ]),
  { output_text: "Zara is not in the stated launch team. Should Zara join the group?", tool_id: "phantom-clarifier" },
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
