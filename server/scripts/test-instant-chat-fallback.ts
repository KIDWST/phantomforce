import assert from "node:assert/strict";

import { buildInstantChatFallbackReply } from "../src/phantom-ai/instant-chat-fallback.js";

const favorite = buildInstantChatFallbackReply("what's your favorite food?");
assert.match(favorite.output_text, /tacos/i);
assert.doesNotMatch(favorite.output_text, /ledger|pipeline|cashflow/i);

const followUp = buildInstantChatFallbackReply("why tacos?", "PhantomForce", [
  { user: "what's your favorite food?", assistant: "I'd pick tacos." },
]);
assert.match(followUp.output_text, /because tacos/i);
assert.doesNotMatch(followUp.output_text, /ledger|pipeline|cashflow/i);

const arithmetic = buildInstantChatFallbackReply("what is 12 times 7?");
assert.match(arithmetic.output_text, /84/);

const unknown = buildInstantChatFallbackReply("what is the airspeed of an unladen swallow?");
assert.match(unknown.output_text, /question is still the active thread/i);
assert.doesNotMatch(unknown.output_text, /ledger|pipeline|cashflow|approval/i);

console.log("instant chat fallback checks passed");
