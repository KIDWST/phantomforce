import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function installMemoryStorage(name) {
  const storage = new Map();
  globalThis[name] = {
    getItem: (key) => storage.has(String(key)) ? storage.get(String(key)) : null,
    setItem: (key, value) => { storage.set(String(key), String(value)); },
    removeItem: (key) => { storage.delete(String(key)); },
    clear: () => storage.clear(),
  };
}

installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");

const commandSrc = readFileSync(new URL("../app/js/command.js", import.meta.url), "utf8");
const mainSrc = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const phantomCss = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
const serverSrc = readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8");
const buildId = commandSrc.match(/store\.js\?v=([^"']+)/)?.[1] || "";
const q = buildId ? `?v=${buildId}` : "";
const { classifyPhantomIntent } = await import(`../app/js/intent-router.js${q}`);
const { handleSmartCommand } = await import(`../app/js/command.js${q}`);
const { ctx, store, rememberConversation, recentChatTurns } = await import(`../app/js/store.js${q}`);

ctx.session = { role: "admin", name: "Jordan", ws: "phantomforce" };
store.state.chatHistory = [];
store.state.memory = [];
store.state.approvals = [];
store.state.leads = [];
store.state.tasks = [];
store.state.media = [];
store.state.proposals = [];

const casualPrompts = [
  "what's your favorite food?",
  "why tacos?",
  "tell me a joke",
  "how are you?",
  "what is 12 times 7?",
  "explain photosynthesis simply",
  "would you rather fly or teleport?",
  "what color do you like?",
  "do you like music?",
  "what is a good spaceship name?",
  "why do people procrastinate?",
  "can you keep a secret?",
  "who are you?",
  "what can you do?",
  "are you creative?",
  "what does that mean?",
  "tell me something interesting",
  "should I drink coffee?",
  "what makes a joke funny?",
  "is 100 bigger than 99?",
  "what are you thinking?",
  "say something funny",
  "make it funny",
  "write one funny sentence about her",
  "draft a friendly birthday message",
  "create a silly name for my sandwich",
  "fix the grammar in this sentence",
  "what should I cook today?",
  "plan a three-day vacation",
  "A shirt costs 80 dollars and is 25 percent off. What's the sale price?",
  "Remember for this chat only: my dog's name is Pixel.",
  "what is a website?",
  "why do images look blurry?",
  "how does a bank work?",
  "what is an invoice?",
  "explain what a contract is",
  "what is a blog post?",
  "how does uploading work?",
  "what does electrical current mean?",
  "how do I make chicken stock?",
  "why do stock photos look fake?",
  "what is your current favorite food?",
  "do you approve of pineapple on pizza?",
  "what queue data structure should I use?",
  "give me a summary of Hamlet",
  "report on the history of jazz",
  "I remember my first bike",
  "remind me how photosynthesis works",
  "what do monitor lizards eat?",
  "tell me when dinosaurs lived",
  "watch this movie and tell me what you think",
  "write a poem about automation",
  "create a story about a workflow",
  "automation changed factory work",
  "make this sentence better: me go store",
  "this story needs better pacing",
];

const forbiddenStatus = /\b(?:ledger|pipeline|cashflow|cash flow|approvals? waiting|today's plan|right now:)\b/i;
const capturedBodies = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, init) => {
  assert.match(String(url), /\/phantom-ai\/chat$/, "casual prompts should use the chat backend");
  const body = JSON.parse(init.body);
  capturedBodies.push(body);
  const followUp = /^why tacos/i.test(body.message);
  return {
    ok: true,
    json: async () => ({
      ok: true,
      message: {
        role: "assistant",
        content: followUp
          ? "Because tacos are flexible, balanced, and difficult not to enjoy."
          : `Direct answer ${capturedBodies.length}: ${body.message}`,
      },
      fallback: { used: true, all_failed: true, local_response: true },
      hermes: { route_tier: body.route_tier, context_used: Array.isArray(body.conversation_history) && body.conversation_history.length > 0 },
    }),
  };
};

for (const prompt of casualPrompts) {
  const intent = classifyPhantomIntent(prompt);
  assert.ok(["question", "chat", "identity", "capability"].includes(intent.primaryIntent), `${prompt} must remain casual chat`);
  const result = await handleSmartCommand(prompt);
  assert.equal(result.hermes?.route_tier, "instant", `${prompt} must use the instant lane`);
  assert.doesNotMatch(result.say, forbiddenStatus, `${prompt} must not receive an unsolicited business-status dump`);
  rememberConversation({ prompt, reply: result.say, mode: "ask" });
}

assert.equal(capturedBodies.length, casualPrompts.length, "all casual prompts must exercise the backend route");
for (const body of capturedBodies) {
  assert.equal(body.route_tier, "instant");
  assert.equal(body.requested_model, "qwen2.5:14b");
  assert.equal(body.admin_model, "local_ollama");
  assert.deepEqual(body.allowed_providers, ["local_ollama"]);
  assert.equal(body.allow_provider_fallback, false);
  assert.ok(body.max_provider_ms <= 4500, "instant provider time must stay tightly bounded");
  assert.ok(Array.isArray(body.conversation_history));
  assert.ok(body.conversation_history.length <= 8, "only a bounded recent-turn window may leave the browser");
  assert.doesNotMatch(body.business_summary, /accounting|bookings|offer desk|approval gates/i);
  assert.deepEqual(
    body.module_data.map((entry) => entry.module),
    body.conversation_history.length ? ["recent_conversation"] : [],
    "casual chat must not send business, money, plan, or memory modules",
  );
}

const followUpBody = capturedBodies[1];
assert.equal(followUpBody.message, "why tacos?");
assert.equal(followUpBody.conversation_history.at(-1)?.user, "what's your favorite food?");
assert.match(followUpBody.conversation_history.at(-1)?.assistant || "", /favorite food/i);
assert.ok(recentChatTurns(8).length <= 8);
assert.equal(store.state.memory.length, 0, "casual questions must not become durable memory");
const chatOnlyMemoryBody = capturedBodies.find((body) => /Remember for this chat only/i.test(body.message));
assert.equal(chatOnlyMemoryBody?.task_type, "chat", "chat-only facts must remain temporary conversation, not durable memory");

const adminSession = ctx.session;
ctx.session = { role: "client", name: "Customer One", ws: "customer-one" };
const customerRequestCount = capturedBodies.length;
const customerChat = await handleSmartCommand("tell me a joke about breakfast");
assert.match(customerChat.say, /Direct answer/);
assert.equal(capturedBodies.length, customerRequestCount + 1, "authenticated customers must reach the instant brain from the browser");
assert.equal(capturedBodies.at(-1).route_tier, "instant");
assert.deepEqual(capturedBodies.at(-1).allowed_providers, ["local_ollama"]);

const customerReasoningPrompts = [
  "Compare electric cars and hybrids for a city commuter.",
  "Critique this idea: a neighborhood tool library.",
  "Think through the pros and cons of moving closer to work.",
  "Compare a ledger and a journal in accounting.",
  "What strategy makes chess beginners improve faster?",
];
for (const prompt of customerReasoningPrompts) {
  const result = await handleSmartCommand(prompt);
  const body = capturedBodies.at(-1);
  assert.equal(result.hermes?.route_tier, "reasoning", `${prompt} must reach the reasoning model lane`);
  assert.equal(body.route_tier, "reasoning");
  assert.equal(body.requested_model, "qwen2.5:14b");
  assert.equal(body.admin_model, "local_ollama");
  assert.deepEqual(body.allowed_providers, ["local_ollama"]);
  assert.equal(body.allow_provider_fallback, false);
  assert.equal(body.max_provider_ms, 12000);
  assert.doesNotMatch(body.business_summary, /Business Manager workspace/i);
  assert.ok(body.module_data.every((entry) => entry.module === "recent_conversation"));
  assert.deepEqual(result.cards || [], []);
  assert.equal(result.open || null, null);
}

const customerCreativePrompts = [
  "Maybe we should start a neighborhood book club.",
  "What if I learn guitar for twenty minutes a day?",
  "I hate how confusing airline boarding is.",
  "This explanation feels too robotic.",
  "Give me a plan to learn conversational Spanish.",
  "Help me plan a low-cost birthday party.",
];
for (const prompt of customerCreativePrompts) {
  const result = await handleSmartCommand(prompt);
  const body = capturedBodies.at(-1);
  assert.equal(result.hermes?.route_tier, "reasoning", `${prompt} must use a real model instead of canned intent copy`);
  assert.equal(body.route_tier, "reasoning");
  assert.equal(body.requested_model, "qwen2.5:14b");
  assert.deepEqual(body.allowed_providers, ["local_ollama"]);
  assert.equal(body.allow_provider_fallback, false);
  assert.doesNotMatch(body.business_summary, /Business Manager workspace/i);
  assert.ok(body.module_data.every((entry) => entry.module === "recent_conversation"));
  assert.deepEqual(result.cards || [], []);
  assert.equal(result.open || null, null);
}

const customerAdvisoryPrompts = [
  "We should redesign my website.",
  "I hate my sales pipeline.",
  "Give me a plan for my business.",
  "Help me plan our content calendar.",
];
for (const prompt of customerAdvisoryPrompts) {
  const result = await handleSmartCommand(prompt);
  const body = capturedBodies.at(-1);
  assert.equal(result.hermes?.route_tier, "advisory", `${prompt} must use scoped business advice`);
  assert.equal(body.route_tier, "advisory");
  assert.equal(body.requested_model, "qwen2.5:14b");
  assert.deepEqual(body.allowed_providers, ["local_ollama"]);
  assert.equal(body.allow_provider_fallback, false);
  assert.match(body.business_summary, /Business Manager workspace/i);
  assert.deepEqual(body.module_data.map((entry) => entry.module), ["active_business"]);
  assert.deepEqual(result.cards || [], []);
  assert.equal(result.open || null, null);
}
ctx.session = adminSession;

await handleSmartCommand("what is in my accounting ledger?");
const accountingBody = capturedBodies.at(-1);
assert.equal(accountingBody.route_tier, "standard");
assert.match(accountingBody.business_summary, /Business Manager workspace/i);
assert.deepEqual(accountingBody.module_data.map((entry) => entry.module), ["active_business", "recent_conversation", "money"]);

await handleSmartCommand("write a client proposal");
const proposalBody = capturedBodies.at(-1);
assert.equal(proposalBody.route_tier, "standard", "business artifacts must not use the casual instant lane");
assert.notDeepEqual(proposalBody.allowed_providers, ["local_ollama"]);

store.state.chatHistory = [];
rememberConversation({
  prompt: "what's your favorite food?",
  reply: "Spicy ramen - bold, comforting, and impossible to make boring.",
  mode: "ask",
});
globalThis.fetch = async () => { throw new Error("offline regression"); };
const degradedFollowUp = await handleSmartCommand("why?");
assert.match(degradedFollowUp.say, /comforting and intense/i, "offline follow-ups must answer the active topic instead of narrating a timeout");
assert.doesNotMatch(degradedFollowUp.say, forbiddenStatus);

const offlineGeneralQuestions = [
  ["what is a business proposal?", /document|offer|scope/i],
  ["what is a sales lead?", /person|organization|qualification/i],
  ["what is an invoice?", /request for payment/i],
  ["what is an approval workflow?", /reviewer|consequential/i],
  ["how does accounting work?", /records|financial activity/i],
  ["how does a bank work?", /deposits|lends|payment/i],
  ["why is continuity useful?", /context|active thread/i],
  ["tell me about bank robberies in movies", /active thread/i],
];
for (const [prompt] of offlineGeneralQuestions.slice(0, 7)) {
  assert.equal(classifyPhantomIntent(prompt).primaryIntent, "question", `${prompt} must classify as information, not a workspace command`);
}
assert.equal(classifyPhantomIntent("how does an approval workflow help my school project?").primaryIntent, "question");
assert.notEqual(classifyPhantomIntent("what is in my approval queue?").reasonCode, "informational_concept_question");
const forbiddenOfflineStatus = /\b(?:ledger|pipeline|cashflow|open proposals?|leads? loaded|approval queue|media items? loaded|today'?s (?:plan|board)|workspace status)\b/i;
for (const [prompt, expected] of offlineGeneralQuestions) {
  const response = await handleSmartCommand(prompt);
  assert.match(response.say, expected, `${prompt} should remain a general conversation answer while offline`);
  assert.doesNotMatch(response.say, forbiddenOfflineStatus, `${prompt} must not become workspace status while offline`);
  assert.deepEqual(response.cards || [], [], `${prompt} must not attach a workspace card while offline`);
  assert.equal(response.open || null, null, `${prompt} must not navigate away from chat while offline`);
}

const degradedFood = await handleSmartCommand("what's your favorite food?");
assert.match(degradedFood.say, /spicy ramen/i);
assert.doesNotMatch(degradedFood.say, /tacos/i);

const explicitWorkspaceQuestion = await handleSmartCommand("show my open proposals");
assert.match(explicitWorkspaceQuestion.say, /proposal/i, "explicit workspace-state questions must still reach the business command surface");
for (const [prompt, expectedIntent] of [
  ["what's in my approval queue?", "approval_request"],
  ["show my sales pipeline", "status_check"],
  ["give me my weekly report", "status_check"],
  ["remind me tomorrow at 9 to call Sam", "reminder"],
  ["remember for later that my brand color is green", "memory_update"],
  ["create an automation to scan my site weekly", "create_automation"],
  ["create a task to update my website", "create_task"],
  ["monitor my site daily", "reminder"],
]) {
  assert.equal(classifyPhantomIntent(prompt).primaryIntent, expectedIntent, prompt + " must retain its explicit operational lane");
}
globalThis.fetch = originalFetch;

assert.doesNotMatch(commandSrc, /Right now:.*ledger empty/i, "the rejected generic ledger fallback must stay deleted");
assert.doesNotMatch(commandSrc, /"ledger empty"/i, "dead readiness copy must not reintroduce ledger language into chat");
assert.doesNotMatch(commandSrc, /The connected brain didn't return a clean expansion in time/i);
assert.match(commandSrc, /conversation_history:\s*recentConversation/);
assert.match(serverSrc, /!actionFreeConversation && businessContextRelevant\) try/, "action-free questions must skip workspace pulse work");
assert.match(serverSrc, /module_data: \[\.\.\.normalized\.module_data, \.\.\.businessBrainModules\]/, "general questions must not receive the business brain module");
assert.match(serverSrc, /local_response:\s*Boolean\(localFallback\)/);
assert.match(indexSrc, /data-dashboard-brief-metrics/);
assert.match(indexSrc, /data-nav-bottom/);
assert.doesNotMatch(indexSrc, /class="quick-card"/, "duplicate dashboard quick actions must stay removed");
assert.doesNotMatch(indexSrc, /class="chatbox-tools"/, "duplicate chat utility row must stay removed");
assert.match(mainSrc, /const bottomItems = items\.filter\(\(n\) => n\.navZone === "bottom"\)/);
assert.match(mainSrc, /options\.instant/);
assert.match(
  phantomCss,
  /@media \(min-width: 1201px\)[\s\S]*?\.app-main:has\(> \.console:not\(\.console-workspace\)\) \.console \{[\s\S]*?grid-auto-rows: minmax\(0, 1fr\);[\s\S]*?align-items: stretch;[\s\S]*?\.console:not\(\.console-workspace\) \.console-center \{[\s\S]*?overflow: hidden;/,
  "desktop chat must stay inside the viewport grid so only its message log scrolls",
);

console.log(`dashboard chat quality checks passed (${casualPrompts.length} prompts)`);
