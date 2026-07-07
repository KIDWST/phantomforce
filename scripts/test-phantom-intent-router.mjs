import assert from "node:assert/strict";
import { classifyPhantomIntent } from "../app/js/intent-router.js";
import { handleCommand, handleSmartCommand } from "../app/js/command.js?v=phantom-live-20260707-44";
import { ctx, store } from "../app/js/store.js?v=phantom-live-20260707-44";

ctx.session = { role: "admin", name: "Jordan", ws: "phantomforce" };

const cases = {
  conversation: [
    ["hello", "greeting"],
    ["hi", "greeting"],
    ["thanks", "gratitude"],
    ["who are you?", "identity"],
    ["what can you do?", "capability"],
  ],
  noTask: [
    "what do you think about making the website better?",
    "i hate this dashboard",
    "we should improve the chat box",
    "maybe add a profile picture",
    "why is this broken?",
    "help me plan this",
    "this needs to feel more premium",
    "the bot is annoying",
    "I want Phantom to feel alive",
    "can users build stuff with this?",
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
    "build me a landing page",
    "create a campaign",
    "make an intake form",
    "start Phantom Loop for my website",
    "start loopus for my website",
    "turn this into a build plan",
  ],
  automation: [
    "remind me tomorrow",
    "check this every morning",
    "monitor my site daily",
    "tell me when this breaks",
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

store.state.tasks = [];
store.state.sites = [];
store.state.media = [];
store.state.agents = [];
store.state.approvals = [];
store.state.looperPlans = [];

const question = handleCommand("what do you think about making the website better?");
assert.equal(question.intent.primaryIntent, "question");
assert.equal(store.state.tasks.length, 0, "questions should not create tasks");
assert.equal(store.state.sites.length, 0, "questions should not create sites");
assert.equal(store.state.media.length, 0, "questions should not create media");

const greeting = handleCommand("hello");
assert.equal(greeting.intent.primaryIntent, "greeting");
assert.match(greeting.say, /Ready/i);
assert.equal(store.state.tasks.length, 0, "greetings should not create tasks");

const smartGreeting = await handleSmartCommand("hello");
assert.equal(smartGreeting.intent.primaryIntent, "greeting");
assert.equal(smartGreeting.hermes || null, null, "greetings should stay local readiness pings");
assert.equal(store.state.tasks.length, 0, "smart greetings should not create tasks");

const candidate = handleCommand("the chat box needs better spacing");
assert.equal(candidate.intent.primaryIntent, "task_candidate");
assert.equal(store.state.tasks.length, 0, "task candidates should wait for explicit confirmation");

const task = handleCommand("create a task to fix the chat box spacing");
assert.equal(task.intent.primaryIntent, "create_task");
assert.equal(store.state.tasks.length, 1, "explicit task requests should create one task");

const phantomLoop = handleCommand("build me a landing page");
assert.equal(phantomLoop.intent.primaryIntent, "looper_build");
assert.equal(store.state.tasks.length, 1, "Phantom Loop requests should not create generic tasks");
assert.equal(store.state.sites.length, 0, "Phantom Loop planning should not create site artifacts directly");
assert.equal(store.state.looperPlans.length, 1, "Phantom Loop requests should create a guarded build packet");

ctx.session = { role: "employee", name: "Employee", ws: "phantomforce" };
const blockedLoop = handleCommand("start Phantom Loop for a booking page");
assert.equal(blockedLoop.intent.primaryIntent, "looper_build");
assert.equal(store.state.looperPlans.length, 1, "non-admin Phantom Loop requests should be gated");

console.log("phantom intent router tests passed");
