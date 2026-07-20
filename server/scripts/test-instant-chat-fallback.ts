import assert from "node:assert/strict";

import {
  filterConversationModules,
  isSafeAdvisoryConversationRequest,
  isSafeInstantConversationRequest,
  isSafeReasoningConversationRequest,
  needsBusinessContext,
} from "../src/phantom-ai/conversation-policy.js";
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

assert.match(ask("what's your favorite food?"), /spicy ramen/i);
assert.match(ask("why?"), /comforting and intense/i);
assert.match(ask("tell me more"), /broth|toppings/i);
assert.match(ask("give me an example"), /last answer|spicy ramen/i);
assert.match(ask("make it funny"), /spicy ramen|ideas need a costume change/i);
assert.ok(ask("shorter").length < turns.at(-2)!.assistant.length);

turns.length = 0;
turns.push({ user: "Show my accounting ledger.", assistant: "Your ledger has three entries and one invoice." });
const standaloneAfterBusiness = ask("Explain photosynthesis.");
assert.match(standaloneAfterBusiness, /sunlight/i);
assert.doesNotMatch(standaloneAfterBusiness, /three entries/i);

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
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "draft a friendly birthday message" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "create a silly name for my sandwich" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "fix the grammar in this sentence" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "what should I cook today?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "A shirt costs 80 dollars and is 25 percent off. What's the sale price?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "create_website", user_request: "make a website" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "show my accounting ledger" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "write a client proposal" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "create an invoice" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is the price of bitcoin?" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is a website?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "why do images look blurry?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "how does a bank work?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is an invoice?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "explain what a contract is" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is a blog post?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "how does uploading work?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what does electrical current mean?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "how do I make chicken stock?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "why do stock photos look fake?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is your current favorite food?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "write a four-line poem about automation" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "create a story about a workflow" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what do monitor lizards eat?" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "make this sentence grammatical: me go store" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "generate an image of a city" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "build a website for my company" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "show my invoice" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is my company name?" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "show my bank account" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "send this email" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "please delete that file" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "help me think through a growth strategy" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "compare them in one sentence" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "compare CRM platforms for a growing agency" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what is the current Bitcoin price?" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what's the weather in Chicago?" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "show me the latest headlines" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "question", user_request: "what was the Bulls score last night?" }), false);
assert.equal(isSafeReasoningConversationRequest({ task_type: "chat", user_request: "Compare electric cars and hybrids for a city commuter." }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "chat", user_request: "Critique this idea: a neighborhood tool library." }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "chat", user_request: "Think through the pros and cons of moving closer to work." }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "question", user_request: "What strategy makes chess beginners improve faster?" }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "brainstorm", user_request: "Maybe we should start a neighborhood book club." }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "feedback", user_request: "This explanation feels too robotic." }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "plan", user_request: "Help me plan a low-cost birthday party." }), true);
assert.equal(isSafeReasoningConversationRequest({ task_type: "question", user_request: "show my accounting ledger" }), false);
assert.equal(isSafeReasoningConversationRequest({ task_type: "chat", user_request: "create a strategy for my business" }), false);
assert.equal(isSafeReasoningConversationRequest({ task_type: "question", user_request: "what is the current Bitcoin price?" }), false);
assert.equal(isSafeAdvisoryConversationRequest({ task_type: "plan", user_request: "Give me a plan for my business." }), true);
assert.equal(isSafeAdvisoryConversationRequest({ task_type: "feedback", user_request: "I hate my sales pipeline." }), true);
assert.equal(isSafeAdvisoryConversationRequest({ task_type: "brainstorm", user_request: "We should redesign my website." }), true);
assert.equal(isSafeAdvisoryConversationRequest({ task_type: "plan", user_request: "Help me plan our content calendar." }), true);
assert.equal(isSafeAdvisoryConversationRequest({ task_type: "create_task", user_request: "Create a task for my business." }), false);
assert.equal(isSafeAdvisoryConversationRequest({ task_type: "brainstorm", user_request: "Send this email for my business." }), false);

/* Owner-reported regression (2026-07-19): "capture 5 clients and put them
   into our crm" was treated as casual chat, glued to a stale unrelated
   thread, and answered with the old thread's content. Guard both layers:
   the lane gate must block CRM/work intents (verbs like capture/add/
   import/put, counted and plural objects, crm/pipeline nouns), and the
   fallback must never parrot an unrelated thread at a business ask. */
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "capture 5 clients and put them into our crm" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "capture five new leads for me" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "add 3 leads to the crm" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "import contacts into our pipeline" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "put them into our crm" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "track 12 prospects" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "book 2 clients for friday" }), false);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "add some humor to that" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "put that another way" }), true);
assert.equal(isSafeInstantConversationRequest({ task_type: "chat", user_request: "track and field is fun right" }), true);

const staleUnrelatedThread = [{ user: "how do I run a matrix terminal on my pc", assistant: "You can use desktop chat software that supports the Matrix protocol." }];
const businessInQuickLane = buildInstantChatFallbackReply("capture 5 clients and put them into our crm", "PhantomForce", staleUnrelatedThread).output_text;
assert.doesNotMatch(businessInQuickLane, /matrix|still with this thread/i, "stale thread must not be parroted at a business ask");
assert.match(businessInQuickLane, /business work|operational brain/i, "business ask in the quick lane must get an honest lane refusal");
assert.doesNotMatch(businessInQuickLane, /\b(?:captured|created|added|imported|done)\b/i, "the refusal must not imply the work happened");

const tacoThreadForMismatch = [{ user: "best taco filling?", assistant: "Grilled fish with a crunchy slaw is hard to beat." }];
const offTopicTimeout = buildInstantChatFallbackReply("keep going about skiing", "PhantomForce", tacoThreadForMismatch).output_text;
assert.doesNotMatch(offTopicTimeout, /taco|grilled fish|still with this thread/i, "off-topic timeout must not echo the previous thread");

console.log(`instant chat fallback checks passed (${turns.length + directPrompts.length} adversarial turns)`);
