import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Actual panel controller with mocked asynchronous HTTP and a small render root.
// No production data, account stores, provider calls or commands are involved.
const saved = new Map(), tab = new Map();
const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
globalThis.localStorage = storage(saved); globalThis.sessionStorage = storage(tab);
globalThis.location = { hostname: "app.phantomforce.online", search: "", origin: "https://app.phantomforce.online", href: "https://app.phantomforce.online/app/index.html" };
globalThis.window = { location, dispatchEvent() {}, addEventListener() {} }; globalThis.CustomEvent = class {};
globalThis.FormData = class { constructor(form) { this.form = form; } get(key) { return this.form.data?.[key] ?? null; } };
const source = readFileSync(new URL("../app/js/production-core.js", import.meta.url), "utf8");
const storePath = source.match(/from "(\.\/store\.js[^\"]*)"/)[1];
const { ctx, session } = await import(new URL(`../app/js/${storePath.slice(2)}`, import.meta.url));
const { mountProductionCorePanel } = await import("../app/js/production-core.js");
let checks = 0;
const check = run => { run(); checks++; };
class Control {
  listeners = new Map(); data = {};
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  fire(name) { return this.listeners.get(name)?.({ preventDefault() {}, currentTarget: this }); }
}
class Root {
  isConnected = true; history = []; controls = new Map(); html = "";
  set innerHTML(value) {
    this.html = value; this.history.push(value); this.controls.clear();
    for (const key of ["refresh", "diagnose"]) if (value.includes(`data-production-core-${key}`)) this.controls.set(`[data-production-core-${key}]`, new Control());
  }
  get innerHTML() { return this.html; }
  querySelector(selector) { return this.controls.get(selector) ?? null; }
}
const pending = [], requests = [];
globalThis.fetch = (url, options = {}) => new Promise(resolve => {
  const request = { url, options, resolve, settled: false }; pending.push(request); requests.push(request);
});
const take = count => { assert.equal(pending.length, count); return pending.splice(0); };
function scope(tenant, token = `${tenant}-fixture-token`) {
  ctx.session = { role: "admin", database: true, isSuperAdmin: true, canManageAccess: true, orgId: tenant, orgRole: "owner", memberships: [] };
  session.set({ ...ctx.session, token });
}
const graph = tenant => ({ ok: true, tenantId: tenant, counts: { leads: 1 }, recentIncidents: [{ status: "active", kind: `PRIVATE-${tenant}`, remediation: `REMEDIATION-${tenant}` }] });
const truth = tenant => ({ ok: true, tenant_id: tenant, persistence: { state: "real", documentVersion: 3 }, providerAdapter: { state: "unavailable" } });
const trace = (tenant, correlation) => ({ ok: true, tenantId: tenant, correlationId: correlation, timeline: [{}], actionableFailures: [{ errorCode: "blocked", remediation: `TRACE-${tenant}-${correlation}` }] });
function reply(request, payload, status = 200) { request.settled = true; request.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload }); }
function replyRead(batch, tenant) { for (const request of batch) reply(request, request.url.includes("/truth?") ? truth(tenant) : graph(tenant)); }
function submit(root, correlation) { const form = root.querySelector("[data-production-core-diagnose]"); assert.ok(form); form.data.correlation = correlation; return form.fire("submit"); }
const root = new Root();

scope("business-A");
const first = mountProductionCorePanel(root); const firstRead = take(2);
check(() => assert.match(root.innerHTML, /aria-busy="true"/));
for (const request of firstRead) check(() => {
  assert.equal(new URL(request.url, location.origin).searchParams.get("tenant_id"), "business-A");
  assert.equal(request.options.headers["x-phantomforce-business"], "business-A");
  assert.equal(request.options.headers.Authorization, "Bearer business-A-fixture-token");
  assert.ok(request.options.signal instanceof AbortSignal);
});
replyRead(firstRead, "business-A"); await first;
check(() => assert.match(root.innerHTML, /PRIVATE-business-A/));
check(() => assert.match(root.innerHTML, /1 leads/));

// A new business must synchronously remove the former graph, before HTTP resolves.
scope("business-B");
const switching = mountProductionCorePanel(root); const secondRead = take(2);
check(() => { assert.match(root.innerHTML, /aria-busy="true"/); assert.doesNotMatch(root.innerHTML, /PRIVATE-business-A/); });
replyRead(secondRead, "business-B"); await switching;
check(() => { assert.match(root.innerHTML, /PRIVATE-business-B/); assert.doesNotMatch(root.innerHTML, /PRIVATE-business-A/); });

// Requests that ignore an abort still cannot replace a newer business's state.
scope("business-A"); const late = mountProductionCorePanel(root); const lateRead = take(2);
scope("business-B"); const current = mountProductionCorePanel(root); const currentRead = take(2);
check(() => assert.ok(lateRead.every(request => request.options.signal.aborted)));
replyRead(currentRead, "business-B"); await current;
const currentMarkup = root.innerHTML;
replyRead(lateRead, "business-A"); await late;
check(() => assert.equal(root.innerHTML, currentMarkup));

// Token replacement is an independent invalidation even within the same business.
const oldTokenRead = mountProductionCorePanel(root, { force: true }); const oldTokenBatch = take(2);
scope("business-B", "replacement-fixture-token");
const newTokenRead = mountProductionCorePanel(root); const newTokenBatch = take(2);
check(() => { assert.ok(oldTokenBatch.every(request => request.options.signal.aborted)); assert.doesNotMatch(root.innerHTML, /PRIVATE-business-B/); });
for (const request of newTokenBatch) check(() => assert.equal(request.options.headers.Authorization, "Bearer replacement-fixture-token"));
replyRead(newTokenBatch, "business-B"); await newTokenRead;
replyRead(oldTokenBatch, "business-B"); await oldTokenRead;
check(() => assert.match(root.innerHTML, /PRIVATE-business-B/));

// Account-object replacement or lost authentication while a body is pending fails closed.
const changedAccount = mountProductionCorePanel(root, { force: true }); const accountBatch = take(2);
ctx.session = { ...ctx.session };
replyRead(accountBatch, "business-B"); await changedAccount;
check(() => { assert.doesNotMatch(root.innerHTML, /PRIVATE-business-B/); assert.match(root.innerHTML, /Account or workspace changed/); });
const reload = mountProductionCorePanel(root); const reloadBatch = take(2); replyRead(reloadBatch, "business-B"); await reload;
session.clear(); await mountProductionCorePanel(root);
check(() => { assert.doesNotMatch(root.innerHTML, /PRIVATE-business-B/); assert.match(root.innerHTML, /authenticated owner session/); assert.equal(pending.length, 0); });

// Response scope is checked independently of request headers and current context.
scope("business-A"); const wrongGraph = mountProductionCorePanel(root); const wrongGraphBatch = take(2);
replyRead(wrongGraphBatch, "business-B"); await wrongGraph;
check(() => { assert.doesNotMatch(root.innerHTML, /PRIVATE-business-B/); assert.match(root.innerHTML, /different business scope/); });
const wrongTruth = mountProductionCorePanel(root, { force: true }); const wrongTruthBatch = take(2);
for (const request of wrongTruthBatch) reply(request, request.url.includes("/truth?") ? truth("business-B") : graph("business-A"));
await wrongTruth;
check(() => assert.doesNotMatch(root.innerHTML, /PRIVATE-business-A|PRIVATE-business-B/));
const good = mountProductionCorePanel(root, { force: true }); const goodBatch = take(2); replyRead(goodBatch, "business-A"); await good;

// Diagnosis belongs to the tenant, token, graph revision and requested correlation.
const diagnosis = submit(root, "cor-A-one"); const [diagnosisRequest] = take(1);
check(() => {
  assert.equal(new URL(diagnosisRequest.url, location.origin).searchParams.get("tenant_id"), "business-A");
  assert.equal(new URL(diagnosisRequest.url, location.origin).searchParams.get("correlation_id"), "cor-A-one");
  assert.match(root.innerHTML, /Tracing…/);
});
reply(diagnosisRequest, trace("business-A", "cor-A-one")); await diagnosis;
check(() => assert.match(root.innerHTML, /TRACE-business-A-cor-A-one/));
const staleTrace = submit(root, "cor-A-two"); const [staleTraceRequest] = take(1);
scope("business-B"); const nextBusiness = mountProductionCorePanel(root); const nextBusinessBatch = take(2);
check(() => assert.ok(staleTraceRequest.options.signal.aborted));
replyRead(nextBusinessBatch, "business-B"); await nextBusiness;
reply(staleTraceRequest, trace("business-A", "cor-A-two")); await staleTrace;
check(() => { assert.doesNotMatch(root.innerHTML, /TRACE-business-A|PRIVATE-business-A/); assert.match(root.innerHTML, /PRIVATE-business-B/); });

const olderTrace = submit(root, "cor-B-old"); const [olderRequest] = take(1);
const newerTrace = submit(root, "cor-B-new"); const [newerRequest] = take(1);
check(() => assert.ok(olderRequest.options.signal.aborted));
reply(newerRequest, trace("business-B", "cor-B-new")); await newerTrace;
reply(olderRequest, trace("business-B", "cor-B-old")); await olderTrace;
check(() => { assert.match(root.innerHTML, /TRACE-business-B-cor-B-new/); assert.doesNotMatch(root.innerHTML, /TRACE-business-B-cor-B-old/); });
const invalidTrace = submit(root, "cor-B-expected"); const [invalidRequest] = take(1);
reply(invalidRequest, trace("business-B", "cor-B-other")); await invalidTrace;
check(() => { assert.doesNotMatch(root.innerHTML, /TRACE-business-B-cor-B-other/); assert.match(root.innerHTML, /trace did not match/); assert.match(root.innerHTML, /PRIVATE-business-B/); });

// A detached previous view cannot be repainted by a later response.
const detached = new Root(); const detachedRead = mountProductionCorePanel(detached); const detachedBatch = take(2);
detached.isConnected = false; const writes = detached.history.length;
replyRead(detachedBatch, "business-B"); await detachedRead;
check(() => assert.equal(detached.history.length, writes));

// A failed refresh removes the stale graph rather than pretending it remains verified.
const failedRead = mountProductionCorePanel(root, { force: true }); const failedBatch = take(2);
check(() => assert.doesNotMatch(root.innerHTML, /PRIVATE-business-B|TRACE-business-B/));
for (const request of failedBatch) reply(request, { error: true, message: "PRIVATE_BACKEND_DETAIL" }, 503);
await failedRead;
check(() => { assert.doesNotMatch(root.innerHTML, /PRIVATE-business-B|PRIVATE_BACKEND_DETAIL/); assert.match(root.innerHTML, /unavailable/); });
check(() => assert.ok(requests.every(request => !request.options.method || request.options.method === "GET"), "Panel verification must never invoke commands or writes."));
check(() => assert.equal(pending.length, 0));
session.clear(); ctx.session = null;
console.log(`Production Core panel: ${checks} checks passed (tenant/token/account changes, delayed reads, trace supersession, response scope, lost auth and detached roots; mocked reads only).`);
