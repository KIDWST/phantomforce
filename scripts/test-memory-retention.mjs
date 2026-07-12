import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const {
  isFailedMemoryInteraction,
  pruneMemory,
  rememberConversation,
  sanitizeMemoryText,
  shouldAiRemember,
  store,
} = await import("../app/js/store.js");

const technicalFailure = "Codex did not complete this Phantom chat request. Private Brain error: Command failed: powershell.exe -File C:\\Users\\jorda\\AppData\\Local\\Temp\\phantom-codex-chat\\run-codex.ps1 202";

assert.equal(shouldAiRemember("why do we have 0 active workers"), false);
assert.equal(shouldAiRemember("Remember that workers must report real activity"), true);
assert.equal(shouldAiRemember("Make sure the worker page looks better"), false);
assert.equal(shouldAiRemember("I don't like these title cards"), false);
assert.equal(shouldAiRemember("Fix the bokeh cursor because it is still broken"), false);
assert.equal(shouldAiRemember("From now on, never auto-create tasks from brainstorming"), true);
assert.equal(shouldAiRemember("My preference is direct human wording"), true);
assert.equal(shouldAiRemember("We use Resend for transactional email"), true);
assert.equal(isFailedMemoryInteraction("why do we have 0 active workers", technicalFailure), true);
assert.equal(sanitizeMemoryText(technicalFailure).includes("AppData\\Local\\Temp"), false);

const migrated = pruneMemory([{
  id: "bad-memory",
  source: "saved-conversation",
  title: "why do we have 0 active workers",
  summary: technicalFailure,
  text: `User: why do we have 0 active workers\nPhantom: ${technicalFailure}`,
  pinnedByAi: true,
  createdAt: new Date().toISOString(),
}]);
assert.equal(migrated.length, 0, "failed auto-memory should be removed during migration");

rememberConversation({ prompt: "why do we have 0 active workers", reply: technicalFailure });
assert.equal(store.state.memory.length, 0, "failed conversation must not become durable memory");
assert.equal(store.state.chatHistory.length, 1, "non-trivial question may remain in temporary history");
assert.equal(store.state.chatHistory[0].reply, "Request failed before a usable answer was produced.");

rememberConversation({ prompt: "Remember that workers must report real activity", reply: "Got it." });
assert.equal(store.state.memory.length, 1, "explicit durable instruction should become memory");
assert.equal(store.state.memory[0].pinnedByAi, true);
assert.equal(store.state.memory[0].text, "Remember that workers must report real activity", "saved memory should not include disposable assistant chatter");

rememberConversation({ prompt: "Make sure the mobile nav fits", reply: "I'll remember to keep it compact." });
assert.equal(store.state.memory.length, 1, "assistant wording must not promote a one-off request");
assert.ok(store.state.chatHistory.some((entry) => entry.prompt === "Make sure the mobile nav fits"), "one-off requests remain temporary context");

for (let index = 0; index < 130; index += 1) {
  rememberConversation({ prompt: `Explain temporary context item number ${index}`, reply: `Temporary answer ${index}` });
}
assert.equal(store.state.chatHistory.length, 120, "temporary history should stay within the context window cap");

console.log("memory retention tests passed");
