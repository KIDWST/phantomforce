import strictAssert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
const assert = new Proxy(strictAssert, { get(target, key) {
  const value = Reflect.get(target, key);
  return typeof value === "function" ? (...args) => { checks++; return Reflect.apply(value, target, args); } : value;
} });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
};
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {};
globalThis.location = { hostname: "localhost" };

const rendererUrl = new URL("../app/js/commerce-workspace.js", import.meta.url);
const source = readFileSync(rendererUrl, "utf8");
const storeSpecifier = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).find((value) => value.split("?")[0] === "./store.js");
assert.ok(storeSpecifier, "Use the renderer's exact store module, including its cache version.");
const { ctx, session, store } = await import(new URL(storeSpecifier, rendererUrl).href);
const { renderCommerceWorkspace } = await import(rendererUrl.href);

// A minimal DOM boundary captures listeners from the actual renderer. It does
// not reimplement rendering, state transitions, authorization or network code.
// Browser QA separately verifies layout, native forms, focus and navigation.
const decode = (value) => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
class Element {
  constructor(root, tagName, attributes) {
    this.root = root; this.tagName = tagName; this.attributes = attributes;
    this.dataset = Object.fromEntries(Object.entries(attributes).filter(([name]) => name.startsWith("data-")).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), decode(value)]));
    this.disabled = Object.hasOwn(attributes, "disabled"); this.isConnected = true;
    this.value = decode(attributes.value || ""); this.textContent = ""; this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  async trigger(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) await listener({ preventDefault() {}, currentTarget: this, target: this, ...event });
  }
  querySelector(selector) { return this.root.querySelector(selector); }
  querySelectorAll(selector) { return this.root.querySelectorAll(selector); }
  focus() {}
  scrollIntoView() {}
  setSelectionRange() {}
}
class RenderRoot {
  nodes = []; html = "";
  set innerHTML(value) {
    this.nodes.forEach((node) => { node.isConnected = false; });
    this.html = value; this.nodes = [];
    for (const match of value.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      const attributes = {};
      for (const attribute of match[2].matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)) attributes[attribute[1]] = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      this.nodes.push(new Element(this, match[1], attributes));
    }
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) {
    return this.nodes.filter((node) => {
      if (selector.startsWith("#")) return node.attributes.id === selector.slice(1);
      if (selector.startsWith(".")) return String(node.attributes.class || "").split(/\s+/).includes(selector.slice(1));
      const attribute = /^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);
      return attribute ? Object.hasOwn(node.attributes, attribute[1]) && (attribute[2] === undefined || decode(node.attributes[attribute[1]]) === attribute[2]) : node.tagName === selector;
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const originalFormData = globalThis.FormData;
globalThis.FormData = class FixtureFormData {
  constructor(form) { this.values = new Map(Object.entries(form.fixtureValues || {})); }
  get(key) { return this.values.get(key) ?? null; }
  keys() { return this.values.keys(); }
};

const tenant = "occasionally-odd", foreign = "other-commerce-org";
let selectedTenant = tenant, calls = [], handleFetch;
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return handleFetch(url, options); };
const reply = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(payload) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const entity = (id, extra = {}, scope = tenant) => ({ id, tenantId: scope, ...extra });
const snapshot = (scope = tenant, canManage = true) => ({
  ok: true, tenant_id: scope, canManage,
  state: { tenantId: scope, revision: 7,
    products: [entity("product-1", { sku: "ODD-001", name: "OWN_PRODUCT", price: 24, printHours: 2, materialCost: 1, laborCost: 2, overheadCost: 1, feePercent: 5, finishedStock: 1, bom: [], rightsStatus: "original" }, scope)],
    materials: [entity("material-1", { name: "OWN_MATERIAL", unit: "g", onHand: 500, unitCost: 0.02 }, scope)],
    printers: [entity("printer-1", { name: "OWN_PRINTER", hoursPerDay: 8, status: "idle", currentJobId: null }, scope)],
    orders: [entity("order-1", { externalId: "OWN_ORDER", channel: "etsy", customerId: "customer-1", customer: { name: "OWN_CUSTOMER" }, due: "2035-10-20", lines: [{ sku: "ODD-001", quantity: 2, unitPrice: 24 }], total: 48, status: "open" }, scope)],
    jobs: [entity("job-1", { orderId: "order-1", sku: "ODD-001", quantity: 2, makeQuantity: 1, stockQuantity: 1, status: "queued", printHours: 2, printerId: null, materials: [], materialsConsumed: false, attempts: 0, failures: [] }, scope)],
    customers: [entity("customer-1", { name: "OWN_CUSTOMER", email: "fixture@example.invalid", channel: "etsy" }, scope)],
    channels: [entity("channel-1", { channel: "etsy", enabled: true, accountLabel: "OWN_SHOP", status: "blocked", adapterReady: false }, scope)],
    outbox: [entity("outbox-1", { channel: "etsy", type: "inventory", status: "blocked", reason: "Authorization required" }, scope)],
  },
  summary: { metrics: { openOrders: 1, orderValue: 48, availableUnits: 0, queuedHours: 28 },
    capacity: { hoursPerDay: 8, queuedHours: 28, availableHours7Days: 28, daysToClear: 3.5 },
    products: [{ id: "product-1", sku: "ODD-001", onHand: 1, reserved: 1, available: 0, makeToOrderCapacity: 5, materialCost: 1, unitContribution: 18.8, profitPerPrinterHour: 9.4 }],
    materials: [{ id: "material-1", onHand: 500, reserved: 100, available: 400 }], warnings: [],
  },
});
const root = new RenderRoot();
let controller;
function mount(section = "overview", options = {}) {
  controller = renderCommerceWorkspace(root, { businessId: selectedTenant, getActiveBusinessId: () => selectedTenant, initialSection: section, ...options });
  return controller;
}
async function load(section = "overview", response = snapshot()) {
  handleFetch = async () => reply(response); mount(section); await settle();
  assert.doesNotMatch(root.innerHTML, /The workroom couldn’t load/, `Section ${section} renders its scoped response.`);
}

try {
  store.state.businessWorkItems = [{ id: "cached-foreign", businessId: foreign, ws: foreign, title: "FOREIGN_CACHE_SENTINEL" }];
  ctx.session = { role: "admin", ws: tenant };
  session.clear(); calls = [];
  handleFetch = async () => { throw new Error("Preview must not request data"); };
  mount();
  assert.equal(calls.length, 0);
  assert.match(root.innerHTML, /empty workroom preview/);
  assert.doesNotMatch(root.innerHTML, /FOREIGN_CACHE_SENTINEL/);
  assert.ok(root.querySelectorAll("[data-cw-edit]").every((button) => button.disabled), "A local preview cannot save fictional business data.");

  ctx.session = { role: "admin", database: true, orgId: tenant };
  session.set({ role: "admin", token: "synthetic-renderer-token" });
  calls = []; handleFetch = async () => reply({ error: "fixture_service_unavailable" }, 503);
  mount(); await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["x-phantomforce-business"], tenant);
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-renderer-token");
  assert.match(root.innerHTML, /The workroom couldn’t load/);
  assert.doesNotMatch(root.innerHTML, /FOREIGN_CACHE_SENTINEL|OWN_PRODUCT/);
  assert.equal(root.querySelectorAll("[data-cw-edit]").length, 0, "A remote failure exposes no editable fallback records.");

  // An envelope, state namespace, or any foreign entity makes the whole reply
  // unusable. Test all collections, including channels and the pending outbox.
  const wrongEnvelope = snapshot(); wrongEnvelope.tenant_id = foreign;
  const wrongState = snapshot(); wrongState.state.tenantId = foreign;
  const mismatches = [wrongEnvelope, wrongState, ...["products", "materials", "printers", "orders", "jobs", "customers", "channels", "outbox"].map((key) => {
    const response = snapshot(); response.state[key][0].tenantId = foreign; return response;
  })];
  for (const response of mismatches) {
    handleFetch = async () => reply(response); mount(); await settle();
    assert.match(root.innerHTML, /different business|could not be verified/);
    assert.doesNotMatch(root.innerHTML, /OWN_PRODUCT|OWN_CUSTOMER|OWN_ORDER|OWN_SHOP/);
  }

  const sectionTitles = { overview: "Good things. A little odd.", orders: "Orders", products: "The product catalog", production: "The production queue", inventory: "Materials &amp; components", customers: "Customers", channels: "Pending channel updates", shipping: "Shipment history", marketing: "Marketing, made for your shop", finance: "SKU economics", analytics: "Orders by sales channel" };
  for (const [section, title] of Object.entries(sectionTitles)) {
    await load(section);
    assert.ok(root.innerHTML.includes(title), `The ${section} workspace has its actual view.`);
  }
  assert.deepEqual(root.querySelectorAll("[data-cw-section]").slice(0, 11).map((button) => button.dataset.cwSection), Object.keys(sectionTitles), "All eleven workroom views are available in the persistent navigation.");
  await load("overview");
  assert.match(root.innerHTML, /aria-valuenow="50"/, "28 committed hours out of 56 scheduled hours is half capacity, not all remaining capacity.");
  await load("channels");
  assert.match(root.innerHTML, /Personal Marketplace listings are not connected/);
  assert.match(root.innerHTML, /Updates wait for authorized adapters; nothing is sent yet/);

  const untrusted = snapshot();
  untrusted.state.products[0].name = '<img src=x onerror="escapeSentinel()">';
  untrusted.state.customers[0].name = '<script>escapeSentinel()</script>';
  untrusted.state.orders[0].externalId = 'order"><svg onload=escapeSentinel()>';
  untrusted.summary.warnings = [{ message: '<iframe src="javascript:escapeSentinel()">', severity: "critical" }];
  for (const section of ["products", "customers", "orders", "overview"]) {
    await load(section, untrusted);
    assert.doesNotMatch(root.innerHTML, /<img src=x|<script>escapeSentinel|<svg onload=escapeSentinel|<iframe src=/);
    assert.match(root.innerHTML, /&lt;(?:img|script|svg|iframe)/, `Untrusted ${section} content is escaped.`);
  }
  handleFetch = async () => reply({ error: '<img src=x onerror="escapeSentinel()">' }, 400);
  mount(); await settle();
  assert.match(root.innerHTML, /&lt;img/);
  assert.doesNotMatch(root.innerHTML, /<img src=x/);

  await load("production", snapshot(tenant, false));
  assert.match(root.innerHTML, /view-only access/);
  const beforeViewer = calls.length;
  for (const button of root.querySelectorAll("[data-cw-edit]")) { assert.equal(button.disabled, true); await button.trigger("click"); }
  for (const button of root.querySelectorAll("[data-cw-job]")) { assert.equal(button.disabled, true); await button.trigger("click"); }
  await settle();
  assert.equal(calls.length, beforeViewer, "Even forcibly invoking a disabled member action cannot issue a mutation.");
  assert.equal(root.querySelector("[data-cw-form]"), null);

  // Exercise a real editor submission: only the immutable active organization
  // and the last loaded revision are sent, never a form-supplied tenant.
  await load("inventory");
  await root.querySelectorAll("[data-cw-edit]").find((button) => button.dataset.cwEdit === "material" && !button.dataset.id).trigger("click");
  const form = root.querySelector("[data-cw-form]");
  assert.ok(form);
  form.fixtureValues = { name: "New test material", unit: "g", onHand: "250", unitCost: "0.02", tenantId: foreign };
  const saved = snapshot(); saved.state.revision = 8;
  handleFetch = async () => reply(saved);
  const beforeSave = calls.length;
  await form.trigger("submit");
  assert.equal(calls.length, beforeSave + 1);
  const savedCall = calls.at(-1);
  assert.equal(savedCall.url, "/api/business-workspaces/commerce/commands");
  assert.equal(savedCall.options.method, "POST");
  assert.equal(savedCall.options.headers["x-phantomforce-business"], tenant);
  assert.deepEqual(JSON.parse(savedCall.options.body), { type: "create-material", payload: { unit: "g", onHand: 250, name: "New test material", unitCost: 0.02 }, expectedRevision: 7 });
  assert.match(root.innerHTML, /Material saved to the workroom/);

  // Refreshing while an editor is open must not attach a new revision to old
  // field values and thereby bypass optimistic concurrency protection.
  await load("products");
  const editProduct = () => root.querySelectorAll("[data-cw-edit]").find((button) => button.dataset.cwEdit === "product" && button.dataset.id === "product-1").trigger("click");
  await editProduct();
  const staleProductForm = root.querySelector("[data-cw-form]");
  assert.equal(root.querySelector('[name="price"]').value, "24");
  staleProductForm.fixtureValues = { name: "OWN_PRODUCT", sku: "ODD-001", price: "24", printHours: "2", materialCost: "1", laborCost: "2", overheadCost: "1", feePercent: "5", rightsStatus: "original", rightsReference: "" };
  const revised = snapshot(); revised.state.revision = 12;
  revised.state.products[0].name = "UPDATED_BY_ANOTHER_ADMIN"; revised.state.products[0].price = 37;
  handleFetch = async () => reply(revised);
  await controller.refresh();
  assert.equal(root.querySelector("[data-cw-form]"), null, "Successful refresh discards the editor's obsolete snapshot.");
  assert.match(root.innerHTML, /Reopen the record to edit the latest version/);
  const beforeStaleSubmit = calls.length;
  await staleProductForm.trigger("submit");
  assert.equal(calls.length, beforeStaleSubmit, "An old form cannot save immediately after refresh.");
  await editProduct();
  const revisedProductForm = root.querySelector("[data-cw-form]");
  assert.equal(root.querySelector('[name="name"]').value, "UPDATED_BY_ANOTHER_ADMIN");
  assert.equal(root.querySelector('[name="price"]').value, "37");
  await staleProductForm.trigger("submit");
  assert.equal(calls.length, beforeStaleSubmit, "A detached old form cannot submit through a newly opened editor.");
  revisedProductForm.fixtureValues = { ...staleProductForm.fixtureValues, name: "UPDATED_BY_ANOTHER_ADMIN", price: "37" };
  const currentSaved = structuredClone(revised); currentSaved.state.revision = 13;
  handleFetch = async () => reply(currentSaved);
  await revisedProductForm.trigger("submit");
  const revisedCommand = JSON.parse(calls.at(-1).options.body);
  assert.equal(revisedCommand.expectedRevision, 12);
  assert.equal(revisedCommand.payload.price, 37);
  assert.equal(revisedCommand.payload.name, "UPDATED_BY_ANOTHER_ADMIN");

  // A pending old request is aborted on remount and cannot paint even if a
  // transport ignores the abort and eventually returns a successful reply.
  let finishOld;
  handleFetch = () => new Promise((resolve) => { finishOld = resolve; });
  const oldController = mount("products");
  const oldRequest = calls.at(-1);
  selectedTenant = foreign;
  handleFetch = async () => { const next = snapshot(foreign); next.state.products[0].name = "NEW_ORGANIZATION_PRODUCT"; return reply(next); };
  mount("products"); await settle();
  assert.equal(oldRequest.options.signal.aborted, true);
  const currentMarkup = root.innerHTML;
  finishOld(reply(snapshot())); await settle();
  assert.equal(root.innerHTML, currentMarkup);
  assert.match(root.innerHTML, /NEW_ORGANIZATION_PRODUCT/);
  assert.doesNotMatch(root.innerHTML, /OWN_PRODUCT/);
  const beforeOldRefresh = calls.length;
  await oldController.refresh();
  assert.equal(calls.length, beforeOldRefresh, "Disposed controllers cannot request old organization data.");

  // The same protection applies when a successful save arrives after switch;
  // it must not repaint the new organization or fire a misleading success toast.
  selectedTenant = tenant; let notifications = 0;
  handleFetch = async () => reply(snapshot());
  mount("inventory", { notify() { notifications++; } }); await settle();
  await root.querySelectorAll("[data-cw-edit]").find((button) => button.dataset.cwEdit === "material" && !button.dataset.id).trigger("click");
  const oldForm = root.querySelector("[data-cw-form]");
  oldForm.fixtureValues = { name: "Late save", unit: "g", onHand: "1", unitCost: "1" };
  let finishSave;
  handleFetch = () => new Promise((resolve) => { finishSave = resolve; });
  const pendingSubmit = oldForm.trigger("submit");
  selectedTenant = foreign;
  handleFetch = async () => reply(snapshot(foreign));
  mount("channels"); await settle();
  const afterSwitch = root.innerHTML;
  finishSave(reply(saved)); await pendingSubmit; await settle();
  assert.equal(root.innerHTML, afterSwitch);
  assert.equal(notifications, 0);

  console.log(`Commerce experience: ${checks} checks passed (all workroom sections, escaping, view-only actions, scoped/versioned commands, rejected tenant data, server failure, stale reads and saves).`);
} finally {
  controller?.destroy();
  session.clear();
  globalThis.FormData = originalFormData;
}
