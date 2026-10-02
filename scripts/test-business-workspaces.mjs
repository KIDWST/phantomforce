import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// This suite uses only in-memory browser storage and mocked network responses.
// It cannot contact a production API, database, provider, or credential vault.
const storage = new Map();
const temporary = new Map();
const adapter = (entries) => ({
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, String(value)),
  removeItem: (key) => entries.delete(key),
  clear: () => entries.clear(),
});
globalThis.localStorage = adapter(storage);
globalThis.sessionStorage = adapter(temporary);
globalThis.location = { hostname: "127.0.0.1", search: "", origin: "http://127.0.0.1", href: "http://127.0.0.1/app/index.html" };
globalThis.window = { location, dispatchEvent() {}, addEventListener() {} };
globalThis.CustomEvent = class CustomEvent {};
globalThis.fetch = async () => { throw new Error("Unexpected network call in isolated business test"); };

// Share the exact store module identity with the connection client even after a
// build-id bump; otherwise the async test would exercise a second context.
const connectionSource = readFileSync(new URL("../app/js/connection-center.js", import.meta.url), "utf8");
const storeImport = connectionSource.match(/from\s+"(\.\/store\.js[^"]*)"/u)?.[1];
assert.ok(storeImport, "Connection center must import the common business store");
const core = await import(new URL(`../app/js/${storeImport.slice(2)}`, import.meta.url));
const {
  store, ctx, session, currentWs, currentTenantId, setWorkspace, visible,
  workspaceStorageKey, workspaceStorageGetItem, workspaceStorageSetItem,
  workspaceStorageRemoveItem, resolveSession, addMemory, forgetMemory,
  toggleMemoryRemember, forgetChatHistory, rememberConversation, recentChatTurns,
  resolveApproval, moneyView, pushActivity, pushToolPulse, savePhantomLaneConfig,
  loadPhantomLaneConfig, savePhantomLoop, loadPhantomLoop,
  pruneMemory, pruneChatHistory,
} = core;
const businesses = ["phantomforce", "client-chicagoshots", "occasionally-odd"];
const baseline = structuredClone(store.state);
const owner = (ws = "phantomforce") => ({ role: "admin", name: "Jordan", ws, sessionId: "owner-admin", canManageAccess: true });
const use = (ws) => { ctx.session = owner(ws); session.set(ctx.session); };
const now = () => new Date().toISOString();
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("all three businesses exist without fabricated customer records", () => {
  assert.ok(businesses.every((id) => store.state.workspaces.some((item) => item.id === id)));
  for (const key of ["leads", "bookings", "products", "media", "approvals"]) assert.equal(store.state[key].length, 0, key);
});

test("PhantomForce owner sees only PhantomForce records", () => {
  const records = businesses.map((ws) => ({ id: "same-id", ws, privateValue: ws }));
  records.push({ id: "legacy-unassigned", privateValue: "unassigned" });
  for (const ws of businesses) {
    use(ws);
    assert.deepEqual(visible(records).map((item) => item.privateValue), [ws]);
  }
});

test("invalid business switches fail without changing the current selection", () => {
  use("client-chicagoshots");
  assert.equal(setWorkspace("not-authorized"), false);
  assert.equal(currentWs(), "client-chicagoshots");
  assert.equal(currentTenantId(), "client-chicagoshots");
});

test("employee and database sessions cannot bypass server switching", () => {
  ctx.session = { role: "employee", ws: "phantomforce" };
  assert.equal(setWorkspace("occasionally-odd"), false);
  ctx.session = { role: "admin", database: true, orgId: "org-a", memberships: [{ orgId: "org-a", role: "owner" }], ws: "phantomforce" };
  assert.equal(setWorkspace("occasionally-odd"), false);
  assert.equal(currentWs(), "org-a");
  assert.equal(currentTenantId(), "org-a");
});

test("customer organization IDs stay their actual data scope", () => {
  ctx.session = { role: "admin", database: true, orgId: "customer-a", ws: "occasionally-odd", memberships: [{ orgId: "customer-a", orgName: "Occasionally Odd", role: "owner" }] };
  assert.equal(currentWs(), "customer-a");
  assert.equal(currentTenantId(), "customer-a");
  assert.notEqual(workspaceStorageKey("draft"), "draft::workspace::occasionally-odd");
  assert.deepEqual(visible([{ ws: "customer-a", id: "private" }, { ws: "occasionally-odd", id: "wrong" }]).map((item) => item.id), ["private"]);
});

test("a database account with no active organization gets no default company data", () => {
  ctx.session = { role: "admin", database: true, orgId: null, ws: "phantomforce", memberships: [] };
  assert.notEqual(currentTenantId(), "phantomforce");
  assert.deepEqual(visible([{ ws: "phantomforce", id: "private" }]), []);
  const keys = ["customer/a", "customer-a", "customer:a"].map((id) => workspaceStorageKey("draft", id));
  assert.equal(new Set(keys).size, keys.length, "Storage keys may not normalize different organizations to the same key");
});

test("database organization IDs matching legacy business aliases never collapse ownership", () => {
  const records = ["chicagoshots", "client-chicagoshots", "occasionallyodd", "occasionally-odd"].map((ws) => ({ id: "same-record", ws, serverBacked: true }));
  for (const { ws } of records) {
    ctx.session = { role: "admin", database: true, orgId: ws, memberships: [{ orgId: ws, role: "owner" }] };
    assert.deepEqual(visible(records).map((item) => item.ws), [ws]);
  }
});

test("server refusal preserves the current organization and accepted changes refresh permissions", async () => {
  const { switchOrg } = await import("../app/js/orgs.js");
  ctx.session = { ...owner(), database: true, orgId: "org-a", orgRole: "owner", memberships: [{ orgId: "org-a", role: "owner" }] };
  session.set(ctx.session);
  const before = structuredClone(ctx.session);
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: "TENANT_MEMBERSHIP_REQUIRED" }) });
  assert.equal((await switchOrg("org-b")).ok, false);
  assert.deepEqual(ctx.session, before);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ session: { orgId: "org-b", orgRole: "member", workspaceProfile: "creator", businessProfile: "client-chicagoshots", canManageAccess: false, isSuperAdmin: false, memberships: [{ orgId: "org-a", role: "owner" }, { orgId: "org-b", role: "member" }] } }) });
  assert.equal((await switchOrg("org-b")).ok, true);
  assert.equal(currentTenantId(), "org-b");
  assert.equal(ctx.session.role, "employee");
  assert.equal(ctx.session.orgRole, "member");
  assert.equal(ctx.session.canManageAccess, false);
  assert.equal(ctx.session.workspaceProfile, "creator");
});

test("business drafts remain isolated and survive switching and reload", async () => {
  for (const ws of businesses) { use(ws); workspaceStorageSetItem("test.draft", `draft for ${ws}`); }
  for (const ws of businesses) { use(ws); assert.equal(workspaceStorageGetItem("test.draft"), `draft for ${ws}`); }
  use("occasionally-odd");
  assert.equal(setWorkspace("client-chicagoshots"), true);
  const reloaded = await import(`../app/js/store.js?business-reload=${Date.now()}`);
  reloaded.ctx.session = reloaded.resolveSession();
  assert.equal(reloaded.currentWs(), "client-chicagoshots");
  assert.equal(reloaded.workspaceStorageGetItem("test.draft"), "draft for client-chicagoshots");
  workspaceStorageRemoveItem("test.draft");
  use("occasionally-odd");
  assert.equal(workspaceStorageGetItem("test.draft"), "draft for occasionally-odd");
});

test("unscoped legacy data is never claimed by the first non-PhantomForce business", () => {
  storage.set("legacy.private-draft", "legacy PhantomForce content");
  use("occasionally-odd");
  assert.equal(workspaceStorageGetItem("legacy.private-draft"), null);
  use("phantomforce");
  assert.equal(workspaceStorageGetItem("legacy.private-draft"), "legacy PhantomForce content");
  use("client-chicagoshots");
  assert.equal(workspaceStorageGetItem("legacy.private-draft"), null);
});

test("record migration preserves legacy aliases, unknown businesses and unassigned records", async () => {
  const legacy = structuredClone(baseline);
  legacy.workspaces.push({ id: "future-studio", name: "Future Studio" }, { id: "chicagoshots", name: "ChicagoShots" });
  legacy.leads = [{ id: "legacy-cs", ws: "chicagoshots", name: "Existing team" }, { id: "future", ws: "future-studio", name: "Future client" }, { id: "unassigned", name: "Needs ownership review" }];
  legacy.memory = [{ id: "unassigned-memory", text: "Customer preference with no recorded company", createdAt: now(), pinnedByUser: true }];
  storage.set("pf.phantom.v4", JSON.stringify(legacy));
  const migrated = await import(`../app/js/store.js?business-migration=${Date.now()}`);
  assert.equal(migrated.store.state.leads.length, 3);
  assert.equal(migrated.store.state.leads.find((item) => item.id === "legacy-cs").ws, "client-chicagoshots");
  assert.ok(migrated.store.state.workspaces.some((item) => item.id === "future-studio"));
  assert.equal(migrated.store.state.memory[0].ws, "__unassigned__");
  for (const ws of businesses) {
    migrated.ctx.session = owner(ws);
    assert.ok(!migrated.visible(migrated.store.state.leads).some((item) => ["unassigned", "future"].includes(item.id)));
  }
  migrated.ctx.session = owner("future-studio");
  assert.deepEqual(migrated.visible(migrated.store.state.leads).map((item) => item.id), ["future"]);
});

test("migration and finance normalization preserve server organization IDs exactly", async () => {
  const legacy = structuredClone(baseline);
  legacy.workspaces.push({ id: "chicagoshots", name: "ChicagoShots" });
  legacy.leads = [{ id: "server", ws: "chicagoshots", serverBacked: true }, { id: "ambiguous", ws: "occasionallyodd" }];
  legacy.finance.transactions = [{ id: "tx", ws: "chicagoshots", serverAuthoritative: true, amount: 10 }];
  legacy.finance.connectors = [{ id: "bank", ws: "chicagoshots", serverBacked: true, status: "connected" }];
  storage.set("pf.phantom.v4", JSON.stringify(legacy));
  const migrated = await import(`../app/js/store.js?server-business-migration=${Date.now()}`);
  assert.equal(migrated.store.state.leads.find((item) => item.id === "server").ws, "chicagoshots");
  assert.equal(migrated.store.state.leads.find((item) => item.id === "ambiguous").ws, "occasionallyodd");
  migrated.ctx.session = { role: "admin", database: true, orgId: "chicagoshots", memberships: [{ orgId: "chicagoshots", role: "owner" }] };
  assert.equal(migrated.moneyView().transactions[0]?.ws, "chicagoshots");
  assert.equal(migrated.moneyView().connectors.find((item) => item.id === "bank").status, "connected");
  migrated.ctx.session.orgId = "client-chicagoshots";
  assert.equal(migrated.moneyView().transactions.length, 0);
  assert.equal(migrated.moneyView().connectors.find((item) => item.id === "bank").status, "disconnected");
});

test("AI memories with identical text belong to separate businesses", () => {
  const text = "Our delivery promise is confirmed with the customer before production.";
  for (const ws of businesses) { use(ws); assert.equal(addMemory({ text, pinnedByUser: true })?.ws, ws); }
  assert.equal(store.state.memory.length, 3);
  use("occasionally-odd");
  assert.equal(addMemory({ text: "foreign write", ws: "phantomforce" }), null);
  assert.equal(store.state.memory.length, 3);
});

test("memory pin and delete actions resist IDs reused in another business", () => {
  store.state.memory = businesses.map((ws) => ({ id: "collision", ws, text: `Private ${ws}`, createdAt: now(), pinnedByUser: false }));
  use("occasionally-odd");
  toggleMemoryRemember("collision");
  assert.equal(store.state.memory.find((item) => item.ws === "phantomforce").pinnedByUser, false);
  assert.equal(store.state.memory.find((item) => item.ws === "occasionally-odd").pinnedByUser, true);
  forgetMemory("collision");
  assert.deepEqual(store.state.memory.map((item) => item.ws).sort(), ["client-chicagoshots", "phantomforce"]);
});

test("chat history and deletion preserve business identity", () => {
  for (const ws of businesses) { use(ws); rememberConversation({ prompt: `Please explain the ${ws} production queue`, reply: `Private answer for ${ws}` }); }
  for (const ws of businesses) { use(ws); assert.equal(recentChatTurns().length, 1); assert.match(recentChatTurns()[0].user, new RegExp(ws)); }
  store.state.chatHistory = businesses.map((ws) => ({ id: "collision", ws, prompt: "Please inspect my queue", reply: ws, createdAt: now() }));
  use("client-chicagoshots");
  forgetChatHistory("collision");
  assert.deepEqual(store.state.chatHistory.map((item) => item.ws).sort(), ["occasionally-odd", "phantomforce"]);
});

test("one business cannot evict another business's memory or history quota", () => {
  const other = { id: "other", ws: "occasionally-odd", text: "Customer preference for the workshop", prompt: "Please inspect the workshop queue", createdAt: new Date(Date.now() - 1000).toISOString(), pinnedByUser: true };
  const flood = Array.from({ length: 320 }, (_, i) => ({ id: `flood-${i}`, ws: "phantomforce", text: `Operations record ${i}`, prompt: `Please inspect project number ${i}`, createdAt: now(), pinnedByUser: true }));
  assert.ok(pruneMemory([...flood, other]).some((item) => item.id === "other"));
  assert.ok(pruneChatHistory([...flood, other]).some((item) => item.id === "other"));
  assert.equal(pruneMemory([{ ...other, ws: undefined }])[0].ws, "__unassigned__");
  assert.equal(pruneChatHistory([{ ...other, ws: undefined }])[0].ws, "__unassigned__");
  store.state.activity = [{ id: "other", ws: "occasionally-odd", text: "Workshop evidence" }];
  use("phantomforce");
  for (let i = 0; i < 85; i++) pushActivity("Operations", `Run ${i}`);
  assert.ok(store.state.activity.some((item) => item.id === "other"));
});

test("approval decisions and linked records cannot cross a reused ID", () => {
  use("occasionally-odd");
  store.state.approvals = businesses.map((ws) => ({ id: "decision", ws, status: "pending", type: "send-message", ref: "message", title: `${ws} message` }));
  store.state.communications = businesses.map((ws) => ({ id: "message", ws, status: "draft", leadId: "lead" }));
  store.state.leads = businesses.map((ws) => ({ id: "lead", ws, status: "new" }));
  resolveApproval("decision", true);
  for (const ws of businesses) {
    assert.equal(store.state.approvals.find((item) => item.ws === ws).status, ws === "occasionally-odd" ? "approved" : "pending");
    assert.equal(store.state.communications.find((item) => item.ws === ws).status, ws === "occasionally-odd" ? "send-ready" : "draft");
    assert.equal(store.state.leads.find((item) => item.ws === ws).status, ws === "occasionally-odd" ? "follow-up" : "new");
  }
});

test("all approval side effects resolve references inside their business", () => {
  use("client-chicagoshots");
  const types = [["publish-review", "reviews", "published-ready"], ["publish-page", "sites", "approved-to-publish"], ["media-generation", "media", "generation-approved"], ["booking", "bookings", "approved"], ["automation", "agents", "active"]];
  for (const [type, key, next] of types) {
    store.state[key] = businesses.map((ws) => ({ id: "target", ws, status: "draft" }));
    store.state.approvals = [{ id: type, ws: "client-chicagoshots", type, ref: "target", status: "pending", title: type }];
    resolveApproval(type, true);
    for (const item of store.state[key]) assert.equal(item.status, item.ws === "client-chicagoshots" ? next : "draft", type);
  }
});

test("notifications and automation evidence remain business scoped", () => {
  store.state.notificationReads = businesses.map((ws) => ({ id: "approval:same-id", ws }));
  store.state.riskAcknowledgements = businesses.map((ws) => ({ id: "risk:same-id", ws }));
  for (const ws of businesses) { use(ws); pushActivity("Automation", `Private evidence ${ws}`); pushToolPulse(store.state.toolSpine[0]?.id); }
  for (const ws of businesses) {
    use(ws);
    assert.deepEqual(visible(store.state.notificationReads).map((item) => item.ws), [ws]);
    assert.deepEqual(visible(store.state.riskAcknowledgements).map((item) => item.ws), [ws]);
    assert.ok(visible(store.state.activity).length >= 1);
    assert.ok(visible(store.state.activity).every((item) => item.ws === ws));
  }
});

test("finance connections and transactions do not bleed across businesses", () => {
  store.state.finance.transactions = businesses.map((ws, i) => ({ id: "txn", ws, date: "2026-09-24", description: ws, amount: i + 10, category: "Sales income", account: "local", source: "manual" }));
  store.state.finance.connectors = [{ id: "bank", ws: "phantomforce", status: "connected" }];
  for (const ws of businesses) {
    use(ws);
    const view = moneyView();
    assert.deepEqual(view.transactions.map((item) => item.description), [ws]);
    assert.equal(view.connectors.find((item) => item.id === "bank").status, ws === "phantomforce" ? "connected" : "disconnected");
  }
});

test("AI routing preferences are saved separately for each business", () => {
  use("phantomforce");
  savePhantomLaneConfig({ lanes: { local: { target: "local_ollama", model: "pf-specific-model" } } });
  savePhantomLoop({ enabled: true, targetModel: "pf-specific-loop" });
  use("occasionally-odd");
  assert.notEqual(loadPhantomLaneConfig().lanes.local.model, "pf-specific-model");
  assert.notEqual(loadPhantomLoop().targetModel, "pf-specific-loop");
  savePhantomLoop({ enabled: false, targetModel: "odd-specific-loop" });
  use("phantomforce");
  assert.equal(loadPhantomLaneConfig().lanes.local.model, "pf-specific-model");
  assert.equal(loadPhantomLoop().targetModel, "pf-specific-loop");
});

test("authentication tokens never enter persisted session or business data", () => {
  const fake = "unit-test-token-not-a-real-credential";
  session.set({ ...owner("occasionally-odd"), token: fake });
  assert.equal(session.token(), fake);
  assert.ok([...storage.values()].every((value) => !value.includes(fake)));
  session.clear();
  assert.equal(session.token(), "");
  assert.equal(session.get(), null);
});

test("old connection responses cannot replace the new business channel status", async () => {
  const { getEmailConnectionSnapshot } = await import("../app/js/connection-center.js");
  const pending = [];
  globalThis.fetch = (url) => new Promise((resolve) => pending.push({ url: String(url), resolve }));
  const response = (name) => ({ ok: true, status: 200, json: async () => ({ connectors: [{ group: "Email", state: "connected", name }], email_execution: { sendReady: true, trackingReady: true, replySyncReady: true } }) });
  use("phantomforce");
  const prior = getEmailConnectionSnapshot({ force: true });
  use("occasionally-odd");
  const active = getEmailConnectionSnapshot({ force: true });
  assert.equal(pending.length, 2);
  assert.match(pending[0].url, /tenant_id=phantomforce/u);
  assert.match(pending[1].url, /tenant_id=occasionally-odd/u);
  pending[1].resolve(response("Occasionally Odd inbox"));
  assert.equal((await active).provider, "Occasionally Odd inbox");
  pending[0].resolve(response("PhantomForce private inbox"));
  assert.equal((await prior).sendReady, false);
  assert.equal((await getEmailConnectionSnapshot()).provider, "Occasionally Odd inbox");
});

test("request boundary sends business selection and invalidates stale requests during switching", async () => {
  const { installBusinessRequestBoundary } = await import("../app/js/business-boundary.js");
  const events = new Map();
  const calls = [];
  const host = {
    location,
    addEventListener: (name, handler) => events.set(name, handler),
    fetch: (url, options) => new Promise((resolve) => calls.push({ url, options, resolve })),
  };
  installBusinessRequestBoundary(host);
  use("phantomforce");
  const request = host.fetch("/api/connections/status", { headers: { Authorization: "Bearer test-token" } });
  assert.equal(calls[0].options.headers.get("x-phantomforce-business"), "phantomforce");
  assert.equal(calls[0].options.headers.get("Authorization"), "Bearer test-token");
  events.get("pf:business-switch-start")();
  assert.equal(calls[0].options.signal.aborted, true);
  use("occasionally-odd");
  calls[0].resolve({ ok: true });
  await assert.rejects(request, { name: "AbortError" });
  await assert.rejects(host.fetch("/api/connections/status"), { name: "AbortError" });
  events.get("pf:business-switch-failed")();
  const fresh = host.fetch("/api/connections/status");
  assert.equal(calls[1].options.headers.get("x-phantomforce-business"), "occasionally-odd");
  calls[1].resolve({ ok: true });
  assert.equal((await fresh).ok, true);
});

let failed = 0;
for (const { name, run } of tests) {
  storage.clear(); temporary.clear();
  store.state = structuredClone(baseline);
  use("phantomforce");
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(JSON.stringify({ suite: "business-workspaces", tests: tests.length, passed: tests.length - failed, failed, network: "mocked only" }));
if (failed) process.exitCode = 1;
