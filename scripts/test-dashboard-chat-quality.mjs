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
      hermes: { route_tier: "instant", context_used: Array.isArray(body.conversation_history) && body.conversation_history.length > 0 },
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

assert.equal(capturedBodies.length, casualPrompts.length, "all 22 casual prompts must exercise the backend route");
for (const body of capturedBodies) {
  assert.equal(body.route_tier, "instant");
  assert.equal(body.requested_model, "gpt-5.5-instant");
  assert.deepEqual(body.allowed_providers, ["codex_cli"]);
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

await handleSmartCommand("what is in my accounting ledger?");
const accountingBody = capturedBodies.at(-1);
assert.equal(accountingBody.route_tier, "standard");
assert.match(accountingBody.business_summary, /Business Manager workspace/i);
assert.deepEqual(accountingBody.module_data.map((entry) => entry.module), ["active_business", "recent_conversation", "money"]);

store.state.chatHistory = [];
rememberConversation({
  prompt: "what's your favorite food?",
  reply: "If I had taste buds, I'd pick tacos: fast, flexible, and somehow always the correct answer.",
  mode: "ask",
});
globalThis.fetch = async () => { throw new Error("offline regression"); };
const degradedFollowUp = await handleSmartCommand("why tacos?");
assert.match(degradedFollowUp.say, /crunchy-to-soft ratio/i, "offline follow-ups must answer the active topic instead of narrating a timeout");
assert.doesNotMatch(degradedFollowUp.say, forbiddenStatus);
globalThis.fetch = originalFetch;

assert.doesNotMatch(commandSrc, /Right now:.*ledger empty/i, "the rejected generic ledger fallback must stay deleted");
assert.doesNotMatch(commandSrc, /The connected brain didn't return a clean expansion in time/i);
assert.match(commandSrc, /conversation_history:\s*recentConversation/);
assert.match(serverSrc, /adminRouteTier !== "instant" && businessContextRelevant\) try/, "general questions must skip workspace pulse work");
assert.match(serverSrc, /module_data: \[\.\.\.normalized\.module_data, \.\.\.businessBrainModules\]/, "general questions must not receive the business brain module");
assert.match(serverSrc, /local_response:\s*Boolean\(localFallback\)/);
assert.match(indexSrc, /data-dashboard-brief-metrics/);
assert.match(indexSrc, /data-nav-bottom/);
assert.doesNotMatch(indexSrc, /class="quick-card"/, "duplicate dashboard quick actions must stay removed");
assert.doesNotMatch(indexSrc, /class="chatbox-tools"/, "duplicate chat utility row must stay removed");
assert.match(mainSrc, /const bottomItems = items\.filter\(\(n\) => n\.navZone === "bottom"\)/);
assert.match(mainSrc, /options\.instant/);

console.log(`dashboard chat quality checks passed (${casualPrompts.length} prompts)`);
