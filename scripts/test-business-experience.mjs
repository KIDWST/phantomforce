import strictAssert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
const assert = new Proxy(strictAssert, { get(target, property) {
  const value = Reflect.get(target, property);
  return typeof value === "function" ? (...args) => { checks += 1; return Reflect.apply(value, target, args); } : value;
} });

// Browser globals are isolated to this process. No real session or record is read.
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
};
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {};
globalThis.location = { hostname: "localhost" };

const hubUrl = new URL("../app/js/business-hub.js", import.meta.url);
const hubSource = readFileSync(hubUrl, "utf8");
const importDependency = (filename) => {
  const specifier = [...hubSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).find((value) => value.split("?")[0] === `./${filename}`);
  assert.ok(specifier, `Hub imports ${filename}.`);
  return import(new URL(specifier, hubUrl).href);
};
const { BUSINESS_PROFILES, getBusinessProfile, businessNavigation, businessCanOpenRoute, businessAssistantContext } = await importDependency("business-profiles.js");
const { renderBusinessHub, validateBusinessWorkItem, businessRecordPatch, canManageLocalBusiness } = await import(hubUrl.href);
const { ctx, session, store } = await importDependency("store.js");

assert.deepEqual(Object.keys(BUSINESS_PROFILES), ["phantomforce", "client-chicagoshots", "occasionally-odd"]);
for (const profile of Object.values(BUSINESS_PROFILES)) {
  assert.ok(Object.isFrozen(profile), "Built-in profile data cannot mutate across businesses.");
  assert.ok(profile.templates.length && profile.workflows.length);
  assert.ok(businessAssistantContext(profile).includes(profile.name));
  const routes = businessNavigation(profile, [{ id: "settings", label: "Settings", ownerOnly: true }]);
  assert.equal(routes.find((route) => route.id === "settings").ownerOnly, true, "Navigation keeps permission flags.");
  for (const route of profile.navigation) assert.equal(businessCanOpenRoute(profile, route.id), true);
  for (const template of profile.templates) assert.ok(profile.workflows.some((flow) => flow.kind === template.kind));
}
assert.equal(businessCanOpenRoute("phantomforce", "chicagoshots"), false);
assert.equal(businessCanOpenRoute("occasionally-odd", "chicagoshots"), false);
assert.equal(businessCanOpenRoute("client-chicagoshots", "business-licensing"), false);
assert.equal(businessCanOpenRoute("occasionally-odd", "business-bookings"), false);
assert.equal(getBusinessProfile("occasionallyodd").supportEmail, "occasionallyoddsupport@gmail.com");
assert.equal(getBusinessProfile("chicagoshots").id, "client-chicagoshots");
assert.equal(getBusinessProfile({ id: "org-future", name: "A future business" }).name, "A future business");
assert.equal(getBusinessProfile("org-future").templates.length, 0, "Unconfigured businesses cannot inherit another company's templates.");

const order = { kind: "order", title: "Autumn order", status: "draft", metadata: { rightsStatus: "pending" } };
assert.equal(validateBusinessWorkItem("occasionally-odd", order), "");
assert.match(validateBusinessWorkItem("occasionally-odd", order, "production"), /authorization/i);
assert.match(validateBusinessWorkItem("occasionally-odd", { ...order, metadata: {} }), /original or requires permission/i);
assert.match(validateBusinessWorkItem("occasionally-odd", { ...order, metadata: { rightsStatus: "authorized" } }, "production"), /reference/i);
assert.equal(validateBusinessWorkItem("occasionally-odd", { ...order, metadata: { rightsStatus: "authorized", rightsReference: "License 2030-A" } }, "production"), "");
assert.equal(validateBusinessWorkItem("occasionally-odd", { ...order, metadata: { rightsStatus: "original" } }, "production"), "");
assert.match(validateBusinessWorkItem("client-chicagoshots", order), /belonging to this business/i);
assert.match(validateBusinessWorkItem("phantomforce", { kind: "project", title: "Launch" }, "published"), /stage/i);
const patch = businessRecordPatch({ kind: "order", title: "Revised brief", status: "quoted" }, { version: 4 });
assert.equal(patch.expectedVersion, 4, "Edits include the version that was read.");
assert.equal("kind" in patch, false, "A patch cannot change the workflow kind.");
assert.throws(() => businessRecordPatch({ kind: "order" }, {}), /Refresh/);
assert.equal(canManageLocalBusiness(null), false);
assert.equal(canManageLocalBusiness({ role: "employee" }), false);
assert.equal(canManageLocalBusiness({ role: "member" }), false);
assert.equal(canManageLocalBusiness({ role: "viewer" }), false);
assert.equal(canManageLocalBusiness({ role: "admin" }), true);
assert.equal(canManageLocalBusiness({ role: "member", orgRole: "owner" }), true);

// The renderer's state boundary can be exercised without a browser layout engine.
// Browser tests separately cover interaction, forms, and responsive layout.
class RenderRoot {
  innerHTML = "";
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const root = new RenderRoot();
// Every records page goes straight to one task heading. Workspace navigation and
// identity are owned by the global shell, never repeated inside the record view.
for (const profile of Object.values(BUSINESS_PROFILES)) {
  ctx.session = { role: "admin", ws: profile.id };
  store.state.businessWorkItems = [];
  for (const section of profile.sections) {
    renderBusinessHub(root, { section: section.id });
    assert.equal((root.innerHTML.match(/<h1\b/g) || []).length, 1, `${profile.id}/${section.id} has one page heading.`);
    assert.doesNotMatch(root.innerHTML, /<nav\b|business-hero|business-brand-art|business-section-nav/, "Record screens do not duplicate the global navigation or brand hero.");
    assert.ok(!root.innerHTML.includes(profile.tagline), "Business slogans do not occupy work screens.");
  }
}
ctx.session = { role: "admin", ws: "client-chicagoshots" };
renderBusinessHub(root, { section: "deliverables" });
assert.match(root.innerHTML, /<h1>Deliverables<\/h1>/);
assert.match(root.innerHTML, /No deliverables yet/);
assert.equal((root.innerHTML.match(/data-new-business-work/g) || []).length, 1, "Empty screens keep one clear create action.");
store.state.businessWorkItems = [
  { id: "review", ws: "client-chicagoshots", kind: "edit", title: "Review first", status: "review", due: "2099-01-01" },
  { id: "dated", ws: "client-chicagoshots", kind: "shoot", title: "Overdue shoot", status: "scheduled", due: "2000-01-01" },
  { id: "done", ws: "client-chicagoshots", kind: "project", title: "Completed project", status: "complete" },
  { id: "gear", ws: "client-chicagoshots", kind: "gear", title: "Available camera", status: "available" },
];
renderBusinessHub(root);
assert.match(root.innerHTML, /<h1>Overview<\/h1>/);
assert.match(root.innerHTML, /<span>Overdue<\/span><strong>1<\/strong>/);
assert.ok(root.innerHTML.indexOf('data-business-record="dated"') < root.innerHTML.indexOf('data-business-record="review"'), "Overdue work appears before upcoming reviews.");
assert.doesNotMatch(root.innerHTML, /Completed project|Available camera|business-template-grid|business-assistant/, "Overview keeps active work and removes completed items and promotional extras.");
store.state.businessWorkItems = [
  { ...order, id: "odd-own", ws: "occasionally-odd", businessId: "occasionally-odd", title: "ODD_ONLY_RECORD" },
  { id: "pf-own", ws: "phantomforce", businessId: "phantomforce", kind: "project", title: "PHANTOM_ONLY_RECORD", status: "draft" },
];
ctx.session = { role: "admin", ws: "occasionally-odd" };
renderBusinessHub(root);
assert.match(root.innerHTML, /ODD_ONLY_RECORD/);
assert.doesNotMatch(root.innerHTML, /PHANTOM_ONLY_RECORD/);
ctx.session = { role: "member", ws: "occasionally-odd" };
renderBusinessHub(root);
assert.match(root.innerHTML, /View-only access/);
assert.match(root.innerHTML, /data-new-business-work disabled/);

// Authenticated server errors must never substitute a locally cached customer record.
ctx.session = { role: "admin", database: true, orgId: "occasionally-odd" };
let calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return { ok: false, status: 503, json: async () => ({ error: "service_unavailable" }) };
};
renderBusinessHub(root);
await settle();
assert.equal(calls.length, 1);
assert.equal(calls[0].options.headers["x-phantomforce-business"], "occasionally-odd");
assert.match(root.innerHTML, /Records are unavailable/);
assert.doesNotMatch(root.innerHTML, /ODD_ONLY_RECORD|PHANTOM_ONLY_RECORD/);

// A server's mismatched record is rejected, even when its envelope matches.
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, tenant_id: "occasionally-odd", canManage: true, records: [store.state.businessWorkItems[1]] }) });
renderBusinessHub(root);
await settle();
assert.match(root.innerHTML, /did not match this business/);
assert.doesNotMatch(root.innerHTML, /PHANTOM_ONLY_RECORD/);

// An old in-flight response cannot repaint a newly selected business.
let completeOld;
globalThis.fetch = () => new Promise((resolve) => { completeOld = resolve; });
renderBusinessHub(root);
ctx.session = { role: "admin", ws: "phantomforce" };
session.clear();
renderBusinessHub(root);
const newBusinessHtml = root.innerHTML;
completeOld({ ok: true, json: async () => ({ ok: true, tenant_id: "occasionally-odd", canManage: true, records: [store.state.businessWorkItems[0]] }) });
await settle();
assert.equal(root.innerHTML, newBusinessHtml);
assert.match(root.innerHTML, /PHANTOM_ONLY_RECORD/);
assert.doesNotMatch(root.innerHTML, /ODD_ONLY_RECORD/);

console.log(`Business experience: ${checks} checks passed (profiles, navigation, rights gates, edit versions, permissions, record separation, server failure, and stale responses).`);
