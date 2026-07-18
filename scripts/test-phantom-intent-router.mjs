import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function installMemoryStorage(name) {
  if (globalThis[name]) return;
  const storage = new Map();
  globalThis[name] = {
    getItem: (key) => storage.has(String(key)) ? storage.get(String(key)) : null,
    setItem: (key, value) => { storage.set(String(key), String(value)); },
    removeItem: (key) => { storage.delete(String(key)); },
    clear: () => { storage.clear(); },
  };
}
installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");

/* Import command.js/store.js with the SAME build query command.js uses
   internally — a hardcoded ?v here drifts on every build bump and silently
   splits the store into two module instances, making assertions test nothing. */
const commandSrc = readFileSync(new URL("../app/js/command.js", import.meta.url), "utf8");
const mainSrc = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const buildId = commandSrc.match(/store\.js\?v=([^"']+)/)?.[1] || "";
const q = buildId ? `?v=${buildId}` : "";
const { classifyPhantomIntent } = await import(`../app/js/intent-router.js${q}`);
const { handleCommand, handleSmartCommand } = await import(`../app/js/command.js${q}`);
const { ctx, store, VACATION_POLICY } = await import(`../app/js/store.js${q}`);

ctx.session = { role: "admin", name: "Jordan", ws: "phantomforce" };

const cases = {
  conversation: [
    ["hello", "greeting"],
    ["hi", "greeting"],
    ["hey phantom", "greeting"],
    ["thanks", "gratitude"],
    ["who are you?", "identity"],
    ["what can you do?", "capability"],
  ],
  noTask: [
    "what do you think about making the website better?",
    "i hate this dashboard",
    "we should improve the chat box",
    "maybe add a profile picture",
    "why is this happening?",
    "why is this broken?",
    "help me plan this",
    "help me think through this",
    "this needs to feel more premium",
    "the bot is annoying",
    "I want Phantom to feel alive",
    "can users build stuff with this?",
    "what if we had vacation mode?",
    "higgsfield creates but phantomforce operates",
    "this could be huge",
  ],
  status: [
    "what's my pipeline?",
    "catch me up",
    "what is next today?",
  ],
  createTask: [
    "create a task to fix the chat box spacing",
    "add a task: update the profile card",
    "make this a todo",
    "turn this into a task",
    "assign Codex a task to inspect the navbar",
    "track this as high priority",
    "put this on my task list",
  ],
  confirm: [
    "we need to fix the navbar",
    "the chat box needs better spacing",
    "someone should update billing",
    "make the profile card better",
  ],
  phantomLoop: [
    "build me a dashboard",
    "create a campaign",
    "make an intake form",
    "turn this into a build plan",
  ],
  automation: [
    "remind me tomorrow",
    "schedule this for friday",
    "check this every morning",
    "monitor my site daily",
    "tell me when this breaks",
  ],
  termina: [
    "open this in Termina",
    "split this across workers",
    "run planner builder reviewer on this",
    "create parallel workers for this",
  ],
  vacation: [
    "start vacation mode",
    "keep working while I'm gone",
    "run this while I'm away",
    "let the agents keep working",
  ],
  risky: [
    "publish it",
    "send it",
    "deploy it now",
    "send the email",
    "spend the credits",
    "render the final video",
    "connect my account",
    "delete this",
  ],
};

for (const [text, intentName] of cases.conversation) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, intentName, `${text} should be ${intentName}`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create task`);
  assert.equal(r.shouldCreateAutomation, false, `${text} should not create automation`);
}

for (const text of cases.noTask) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.shouldCreateTask, false, `${text} should not create task`);
  assert.equal(r.shouldCreateAutomation, false, `${text} should not create automation`);
  assert.equal(r.shouldStartLooper, false, `${text} should not start Looper`);
  assert.equal(r.shouldOpenTermina, false, `${text} should not open Termina`);
  assert.equal(r.shouldStartVacationMode, false, `${text} should not start Vacation Mode`);
}

for (const text of cases.status) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "status_check", `${text} should be status_check`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create task`);
}

for (const text of cases.createTask) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "create_task", `${text} should be create_task`);
  assert.equal(r.shouldCreateTask, true, `${text} should create task`);
}

for (const text of cases.confirm) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "task_candidate", `${text} should be task_candidate`);
  assert.equal(r.requiresUserConfirmation, true, `${text} should require confirmation`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create task yet`);
}

for (const text of cases.phantomLoop) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "looper_build", `${text} should be looper_build`);
  assert.equal(r.shouldStartLooper, true, `${text} should start Phantom Loop`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create generic task`);
}

for (const text of cases.automation) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "reminder", `${text} should be reminder`);
  assert.equal(r.shouldCreateAutomation, true, `${text} should route automation/reminder`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create generic task`);
}

for (const text of cases.termina) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "termina_parallel", `${text} should route to Termina`);
  assert.equal(r.shouldOpenTermina, true, `${text} should flag Termina`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create task`);
}

for (const text of cases.vacation) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "vacation_mode", `${text} should route to Vacation Mode`);
  assert.equal(r.shouldStartVacationMode, false, `${text} must NOT arm autonomy before confirmation`);
  assert.equal(r.requiresUserConfirmation, true, `${text} should require confirmation`);
}

const vacationConfirm = classifyPhantomIntent("confirm vacation mode");
assert.equal(vacationConfirm.primaryIntent, "vacation_mode");
assert.equal(vacationConfirm.shouldStartVacationMode, true, "explicit confirmation arms vacation mode");
assert.equal(vacationConfirm.requiresAdminApproval, true, "armed vacation mode is still approval-gated");

for (const text of cases.risky) {
  const r = classifyPhantomIntent(text);
  assert.equal(r.primaryIntent, "approval_request", `${text} should demand approval`);
  assert.equal(r.requiresAdminApproval, true, `${text} should be approval-gated`);
  assert.equal(r.shouldCreateTask, false, `${text} should not create task`);
}

// a task ABOUT a risky action is still just a task; a reminder likewise
assert.equal(classifyPhantomIntent("create a task to send the invoice").primaryIntent, "create_task");
assert.equal(classifyPhantomIntent("remind me to send it tomorrow").primaryIntent, "reminder");

/* ---------------- behavior through the full command brain ---------------- */
store.state.tasks = [];
store.state.sites = [];
store.state.media = [];
store.state.leads = [];
store.state.agents = [];
store.state.approvals = [];
store.state.looperPlans = [];
store.state.automations = [];

const question = handleCommand("what do you think about making the website better?");
assert.equal(question.intent.primaryIntent, "question");
assert.equal(store.state.tasks.length, 0, "questions should not create tasks");
assert.equal(store.state.sites.length, 0, "questions should not create sites");
assert.equal(store.state.media.length, 0, "questions should not create media");

const greeting = handleCommand("hello");
assert.equal(greeting.intent.primaryIntent, "greeting");
assert.match(greeting.say, /what are we working on/i, "greeting should be human, not a status dump");
assert.doesNotMatch(greeting.say, /pipeline|approvals|board/i, "greeting should not vomit status");
assert.equal(store.state.tasks.length, 0, "greetings should not create tasks");

const smartGreeting = await handleSmartCommand("hello");
assert.equal(smartGreeting.intent.primaryIntent, "greeting");
assert.equal(smartGreeting.hermes || null, null, "greetings should stay local");
assert.equal(store.state.tasks.length, 0, "smart greetings should not create tasks");

const originalFetch = globalThis.fetch;
let capturedChatBody = null;
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /\/phantom-ai\/chat$/, "instant questions should use the chat backend");
  capturedChatBody = JSON.parse(init.body);
  return {
    ok: true,
    json: async () => ({
      ok: true,
      message: { role: "assistant", content: "I'd pick tacos." },
      fallback: { all_failed: false },
      hermes: { route_tier: "instant" },
    }),
  };
};
const instantQuestion = await handleSmartCommand("what's your favorite food?");
assert.equal(instantQuestion.say, "I'd pick tacos.");
assert.equal(capturedChatBody.route_tier, "instant");
assert.equal(capturedChatBody.requested_model, "gpt-5.5-instant");
assert.deepEqual(capturedChatBody.allowed_providers, ["codex_cli", "local_ollama"]);
assert.equal(capturedChatBody.allow_provider_fallback, true);
assert.ok(capturedChatBody.max_provider_ms <= 3200, "instant questions should cap provider time tightly");
globalThis.fetch = originalFetch;

let broadChatBody = null;
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /\/phantom-ai\/chat$/, "broad thinking requests should use the chat backend");
  broadChatBody = JSON.parse(init.body);
  return {
    ok: true,
    json: async () => ({
      ok: true,
      message: { role: "assistant", content: "Model-backed answer with a useful plan." },
      fallback: { all_failed: false },
      hermes: { route_tier: "deep" },
    }),
  };
};
const broadThought = await handleSmartCommand("help me think through a school growth strategy for PhantomPlay");
globalThis.fetch = originalFetch;
assert.equal(broadThought.say, "Model-backed answer with a useful plan.");
assert.equal(broadChatBody.route_tier, "deep", "broad strategy should get the deeper model lane");
assert.equal(broadChatBody.allow_provider_fallback, true, "broad strategy should allow provider fallback");
assert.ok(broadChatBody.allowed_providers.includes("claude_cli"), "broad strategy should include Claude in the provider chain");

globalThis.fetch = async (url, init) => {
  assert.match(String(url), /\/phantom-ai\/chat$/, "provider failures should still prove the backend was attempted");
  broadChatBody = JSON.parse(init.body);
  return {
    ok: true,
    json: async () => ({
      ok: true,
      message: { role: "assistant", content: "I couldn't complete that just now. Your request is still here — try again in a moment." },
      fallback: { all_failed: true },
      hermes: { route_tier: "standard" },
    }),
  };
};
const degradedThought = await handleSmartCommand("why is Phantom not thinking properly?");
globalThis.fetch = originalFetch;
assert.doesNotMatch(degradedThought.say, /couldn't complete that just now/i, "provider all-failed must not surface as the final chat answer");
assert.ok(degradedThought.say.trim().length > 20, "provider all-failed should still return a useful local answer");
assert.doesNotMatch(degradedThought.say, /ledger|pipeline|cashflow|approvals? waiting|today's plan/i, "provider all-failed must not become an unrelated status dump");

store.state.leads = [];
store.state.tasks = [];
let crmFetchCalled = false;
globalThis.fetch = async () => {
  crmFetchCalled = true;
  throw new Error("CRM prospect buildout should not call the backend");
};
const crmBuildout = await handleSmartCommand("update our clients crm with clients who you think would be interested in phantomforce. your phantom workforce.. creators, businesses, schools, everyone. Just add to our CRM/clients tab");
globalThis.fetch = originalFetch;
assert.equal(crmFetchCalled, false, "CRM prospect buildout should stay on the deterministic local path");
assert.equal(crmBuildout.open, "leads", "CRM prospect buildout should open the Leads pipeline");
assert.ok(store.state.leads.length >= 4, "CRM prospect buildout should create multiple prospect lanes");
assert.ok(store.state.leads.some((lead) => /creator/i.test(`${lead.name} ${lead.notes}`)), "creator prospects should be represented");
assert.ok(store.state.leads.some((lead) => /school|education/i.test(`${lead.name} ${lead.notes}`)), "school prospects should be represented");
assert.ok(store.state.tasks.some((task) => /Qualify PhantomForce CRM prospect map/i.test(task.title)), "CRM prospect buildout should create a qualification task");
assert.match(crmBuildout.say, /did not invent contact details|message anyone/i, "CRM proof should state no fake contacts or outreach");
store.state.leads = [];
store.state.tasks = [];

crmFetchCalled = false;
globalThis.fetch = async () => {
  crmFetchCalled = true;
  throw new Error("Find-and-add CRM requests should not call the backend");
};
const crmFindAndAdd = await handleSmartCommand("find and add clients who could use PhantomForce: gyms, schools, creators, service companies, and warm prospects");
globalThis.fetch = originalFetch;
assert.equal(crmFetchCalled, false, "Find-and-add CRM requests should stay on the deterministic local path");
assert.equal(crmFindAndAdd.open, "leads", "Find-and-add CRM requests should open the Leads pipeline");
assert.ok(store.state.leads.length >= 4, "Find-and-add CRM request should create multiple prospect lanes");
assert.ok(store.state.leads.some((lead) => /creator/i.test(`${lead.name} ${lead.notes}`)), "find/add request should represent creator prospects");
assert.ok(store.state.leads.some((lead) => /school|education/i.test(`${lead.name} ${lead.notes}`)), "find/add request should represent school prospects");
assert.ok(store.state.leads.some((lead) => /local service|gym|service/i.test(`${lead.name} ${lead.notes}`)), "find/add request should represent service/gym prospects");
assert.ok(store.state.leads.some((lead) => /warm|referral/i.test(`${lead.name} ${lead.notes}`)), "find/add request should represent warm prospects");
store.state.leads = [];
store.state.tasks = [];

const complaint = handleCommand("i hate this dashboard, it feels annoying");
assert.equal(store.state.tasks.length, 0, "complaints should not create tasks");
assert.match(complaint.say, /task|talk/i, "feedback should offer, not act");

const weather = handleCommand("what's the weather?");
assert.equal(weather.intent.primaryIntent, "question");
assert.equal(store.state.tasks.length, 0, "live-info questions should not create tasks");

const candidate = handleCommand("the chat box needs better spacing");
assert.equal(candidate.intent.primaryIntent, "task_candidate");
assert.equal(store.state.tasks.length, 0, "task candidates should wait for explicit confirmation");
assert.match(candidate.say, /task|plan|talk/i, "candidate should offer choices");

const task = handleCommand("create a task to fix the chat box spacing");
assert.equal(task.intent.primaryIntent, "create_task");
assert.equal(store.state.tasks.length, 1, "explicit task requests should create one task");
assert.match(task.say, /Done — created task/i, "task creation should show compact proof");
assert.match(task.say, /No external actions/i, "task proof should state safety");

const phantomLoop = handleCommand("build me a dashboard");
assert.equal(phantomLoop.intent.primaryIntent, "looper_build");
assert.equal(store.state.tasks.length, 1, "Phantom Loop requests should not create generic tasks");
assert.equal(store.state.looperPlans.length, 1, "Phantom Loop requests should create a guarded build packet");
assert.match(phantomLoop.say, /No render, publish, or send/i, "Looper proof should state nothing fired");

const loopHelloIntent = classifyPhantomIntent("start phantom loop for hello");
assert.notEqual(loopHelloIntent.primaryIntent, "looper_build", "Loop should ignore greeting-only targets");
const loopHelloPlansBefore = store.state.looperPlans.length;
const loopHello = handleCommand("start phantom loop for hello");
assert.doesNotMatch(loopHello.say, /Looper draft|build packet/i, "Loop hello should stay normal chat");
assert.equal(store.state.looperPlans.length, loopHelloPlansBefore, "Loop hello should not create a build packet");

const termina = handleCommand("open this in Termina");
assert.equal(termina.intent.primaryIntent, "termina_parallel");
assert.equal(store.state.tasks.length, 1, "Termina routing should not create tasks");
assert.match(termina.say, /nothing launched/i, "Termina should be honest that no agents launched");

const vacationAsk = handleCommand("start vacation mode");
assert.equal(vacationAsk.intent.primaryIntent, "vacation_mode");
assert.match(vacationAsk.say, /confirm vacation mode/i, "vacation mode must ask for explicit confirmation");
assert.match(vacationAsk.say, /blocked|approval/i, "vacation scope must show blocked actions");
const agentsBefore = store.state.agents.length;
const approvalsBefore = store.state.approvals.length;

const vacationGo = handleCommand("confirm vacation mode");
assert.equal(vacationGo.intent.primaryIntent, "vacation_mode");
assert.match(vacationGo.say, /armed|approval/i, "confirmed vacation mode shows an approval-gated run");
assert.ok(store.state.agents.length > agentsBefore, "confirmed vacation mode creates a run record");
assert.ok(store.state.approvals.length > approvalsBefore, "the vacation run is approval-gated in the queue");

const risky = handleCommand("publish it");
assert.equal(risky.intent.primaryIntent, "approval_request");
assert.match(risky.say, /Approval Queue|approval/i, "risky actions route to approvals");
assert.match(risky.say, /nothing has been executed/i, "risky actions must state nothing executed");

ctx.session = { role: "employee", name: "Employee", ws: "phantomforce" };
const blockedLoop = handleCommand("build me a dashboard");
assert.equal(blockedLoop.intent.primaryIntent, "looper_build");
assert.equal(store.state.looperPlans.length, 1, "non-admin Phantom Loop requests should be gated");

/* ---------------- Vacation Mode policy: the hard autonomy boundary ---------------- */
assert.equal(VACATION_POLICY.allowRendering, false, "vacation policy must not allow renders (credits)");
assert.equal(VACATION_POLICY.allowPublishing, false, "vacation policy must not allow publishing");
assert.equal(VACATION_POLICY.allowSending, false, "vacation policy must not allow sending");
assert.equal(VACATION_POLICY.allowDeploying, false, "vacation policy must not allow deploys");
assert.equal(VACATION_POLICY.allowDeleting, false, "vacation policy must not allow deletes");
assert.equal(VACATION_POLICY.requireApprovalForCredits, true, "credits always require approval");
assert.equal(VACATION_POLICY.requireApprovalForExternalActions, true, "external actions always require approval");
assert.ok(VACATION_POLICY.allowDrafting && VACATION_POLICY.allowTaskCreation && VACATION_POLICY.allowMediaBriefs, "safe drafting work is allowed");
assert.ok(VACATION_POLICY.maxRunMinutes <= 480, "runs are time-bounded");
assert.ok(Array.isArray(store.state.vacationRuns), "vacationRuns state exists");

assert.match(mainSrc, /Tell Phantom to create a task/i, "mission map should include the task creation keeper copy");
assert.match(mainSrc, /data-map-prompt/i, "mission map should load task prompts into chat");
assert.match(indexSrc, /data-map-open type="button">Open operations map/i, "right rail operations map button should open the map overlay");
assert.doesNotMatch(indexSrc, /data-open-ws="dashboard">View business map/i, "right rail mission map button should not navigate to an empty dashboard route");

console.log("phantom intent router tests passed");
