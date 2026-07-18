import assert from "node:assert/strict";

import { filterConversationModules, isSafeInstantConversationRequest, needsBusinessContext } from "../src/phantom-ai/conversation-policy.js";
import { buildInstantChatFallbackReply } from "../src/phantom-ai/instant-chat-fallback.js";

const forbidden = /\b(?:ledger|pipeline|cashflow|cash flow|approval|invoice|workspace status)\b/i;
const turns: Array<{ user: string; assistant: string }> = [];

function ask(prompt: string) {
  const answer = buildInstantChatFallbackReply(prompt, "PhantomForce", turns).output_text;
  assert.ok(answer.length > 12, `expected a useful answer for: ${prompt}`);
  assert.doesNotMatch(answer, forbidden, `business context leaked into: ${prompt}`);
  turns.push({ user: prompt, assistant: answer });
  return answer;
}

assert.match(ask("what's your favorite food?"), /tacos/i);
assert.match(ask("why?"), /because tacos/i);
assert.match(ask("tell me more"), /modular|tortilla/i);
assert.match(ask("give me an example"), /bean taco|fish taco/i);
assert.match(ask("make it funny"), /five-star review/i);
assert.ok(ask("shorter").length < turns.at(-2)!.assistant.length);

turns.length = 0;
assert.match(ask("explain photosynthesis"), /sunlight/i);
assert.match(ask("say that simpler"), /plants use sunlight/i);
assert.match(ask("give me an example"), /leaf/i);
assert.match(ask("tell me more"), /sugar|oxygen/i);
assert.match(ask("do you agree?"), /broadly, yes/i);

const directPrompts = [
  ["what is 12 times 7?", /84/],
  ["what is 20 divided by 4?", /5/],
  ["why do people procrastinate?", /vague|unpleasant|risky/i],
  ["what makes a joke funny?", /expectation/i],
  ["give me a good spaceship name", /Quiet Thunder/i],
  ["is 100 bigger than 99?", /greater than 99 by 1/i],
] as const;
for (const [prompt, expected] of directPrompts) {
  const answer = buildInstantChatFallbackReply(prompt).output_text;
  assert.match(answer, expected);
  assert.doesNotMatch(answer, forbidden);
}

const modules = [
  { module: "recent_conversation", summary: "temporary", items: [] },
  { module: "money", summary: "ledger empty", items: [] },
  { module: "today_plan", summary: "five tasks", items: [] },
  { module: "active_business", summary: "workspace", items: [] },
];
assert.equal(needsBusinessContext("why are tacos good?", "question"), false);
assert.deepEqual(filterConversationModules(modules, "why are tacos good?", "question").map((item) => item.module), ["recent_conversation"]);
assert.deepEqual(filterConversationModules(modules, "what is in my accounting ledger?", "question").map((item) => item.module), ["recent_conversation", "money", "active_business"]);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "make it funny" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "create_website", user_request: "make a website" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "show my accounting ledger" }), false);

console.log(`instant chat fallback checks passed (${turns.length + directPrompts.length} adversarial turns)`);
