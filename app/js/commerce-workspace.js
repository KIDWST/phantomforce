import { ctx, session, currentWs } from "./store.js?v=phantom-live-20260927-235";

const mounts = new WeakMap();
const API = "/api/business-workspaces/commerce";
const SECTIONS = ["overview", "orders", "products", "production", "inventory", "customers", "channels", "shipping", "marketing", "finance", "analytics"];
const CHANNELS = [
  { id: "tiktok-shop", name: "TikTok Shop", mark: "tk", description: "Shop orders, products, and fulfillment", note: "Seller authorization and an approved shop integration are required." },
  { id: "etsy", name: "Etsy", mark: "E", description: "Handmade listings and shop orders", note: "Shop authorization and the appropriate application access are required." },
  { id: "facebook-marketplace", name: "Facebook Marketplace", mark: "f", description: "Meta commerce opportunities", note: "Personal Marketplace listings are not connected. Eligible commerce accounts need separate capability verification." },
  { id: "ebay", name: "eBay", mark: "eb", description: "Marketplace inventory and fulfillment", note: "Seller authorization and eligible selling APIs are required." },
  { id: "shopify", name: "Shopify", mark: "S", description: "Your storefront, orders, and stock", note: "An authorized store app with the required permissions is needed." },
  { id: "woocommerce", name: "WooCommerce", mark: "W", description: "Your WordPress storefront", note: "A store integration and verified delivery of order events are required." },
  { id: "storefront", name: "Other storefront", mark: "↗", description: "Connect a store through an adapter", note: "Order, stock, and tracking support depends on the storefront’s API." },
];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const label = (value) => String(value || "").replace(/[-_]/g, " ").replace(/^./, (char) => char.toUpperCase());
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const count = (value, digits = 1) => num(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const money = (value) => num(value).toLocaleString(undefined, { style: "currency", currency: "USD" });
const unitMoney = (value) => num(value).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = (value) => { const parsed = new Date(/^\d{4}-\d{2}-\d{2}/.test(String(value)) ? `${String(value).slice(0, 10)}T12:00:00` : value); return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No deadline"; };
const channelName = (id) => CHANNELS.find((channel) => channel.id === id)?.name || label(id || "manual");
const emptyData = (tenantId) => ({ tenantId, revision: 0, products: [], materials: [], printers: [], orders: [], jobs: [], customers: [], channels: [], outbox: [] });
const badge = (status, text = label(status)) => `<span class="cw-badge cw-badge-${esc(status)}">${esc(text)}</span>`;

/** The mount owns one immutable tenant. All requests, commands, and responses must
 * still belong to that tenant; a business switch invalidates this entire surface. */
export function renderCommerceWorkspace(root, options = {}) {
  mounts.get(root)?.destroy();
  const businessId = String(options.businessId || options.workspace?.id || currentWs());
  const selected = String(options.initialSection || options.section || "overview").replace(/^business-/, "");
  const remote = Boolean(session.token?.() || ctx.session?.database || ctx.session?.localCustomer);
  const state = { data: emptyData(businessId), summary: {}, section: SECTIONS.includes(selected) ? selected : "overview", loading: remote, loaded: !remote, canManage: false, busy: false, error: "", notice: "", editor: null, search: "", filter: "all", disposed: false };
  const requests = new Set();
  const active = () => !state.disposed && mounts.get(root) === controller && String(options.getActiveBusinessId?.() || currentWs()) === businessId;
  const canEdit = () => active() && state.loaded && state.canManage && !state.loading && !state.busy;
  const controller = { refresh, destroy() { state.disposed = true; requests.forEach((request) => request.abort()); requests.clear(); }, dispose() { this.destroy(); } };
  mounts.set(root, controller);

  function validateResponse(response) {
    if (response.tenant_id !== businessId || response.state?.tenantId !== businessId) throw new Error("This response belongs to a different business. Refresh this workspace.");
    for (const key of ["products", "materials", "printers", "orders", "jobs", "customers", "channels", "outbox"]) {
      if (!Array.isArray(response.state[key]) || response.state[key].some((entry) => entry.tenantId !== businessId)) throw new Error("Business data could not be verified. Nothing from that response was loaded.");
    }
    return response;
  }

  async function request(path = "", body) {
    if (!active()) throw new Error("The business changed. Reopen this workspace to continue.");
    const abort = new AbortController(); requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const token = session.token?.();
      const response = await fetch(`${API}${path}`, { method: body ? "POST" : "GET", signal: abort.signal, headers: { "Content-Type": "application/json", "x-phantomforce-business": businessId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ctx.session?.sessionId ? { "x-phantomforce-session": ctx.session.sessionId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error.replace(/_/g, " ") : `The workroom could not be updated (${response.status}).`);
      return validateResponse(payload);
    } finally { clearTimeout(timeout); requests.delete(abort); }
  }

  function accept(payload) { state.data = payload.state; state.summary = payload.summary || {}; state.canManage = payload.canManage === true; state.loaded = true; }
  async function refresh() {
    if (!active() || !remote || state.busy) return;
    state.loading = true; state.error = ""; paint();
    try {
      const payload = await request();
      if (active()) {
        const hadEditor = Boolean(state.editor);
        accept(payload);
        // An editor was built from the previous snapshot. Never pair its stale
        // field values with the refreshed revision used for conflict checking.
        state.editor = null;
        if (hadEditor) state.notice = "Workroom refreshed. Reopen the record to edit the latest version.";
      }
    }
    catch (error) { if (active()) { state.error = error.name === "AbortError" ? "The workroom took too long to respond. Try refreshing." : error.message; state.loaded = false; state.data = emptyData(businessId); state.summary = {}; } }
    finally { if (active()) { state.loading = false; paint(); } }
  }

  async function command(type, payload, success) {
    if (!canEdit()) throw new Error("A business administrator must sign in to make changes.");
    state.busy = true; state.error = "";
    try {
      const result = await request("/commands", { type, payload, expectedRevision: state.data.revision });
      if (!active()) return;
      accept(result); state.editor = null; state.notice = success;
      options.notify?.("Occasionally Odd", success);
    } finally { state.busy = false; }
  }

  function button(text, attributes, primary = false, disabled = false) { return `<button type="button" class="cw-button ${primary ? "cw-button-primary" : ""}" ${attributes} ${disabled ? "disabled" : ""}>${text}</button>`; }
  function editButton(text, kind, id = "", primary = false) { return button(text, `data-cw-edit="${esc(kind)}" data-id="${esc(id)}"`, primary, kind === "order-detail" ? !state.loaded || state.busy : !canEdit()); }
  function sectionButton(text, section, primary = false) { return button(text, `data-cw-section="${esc(section)}"`, primary); }
  function heading(eyebrow, title, text = "", action = "") { return `<div class="cw-panel-heading"><div><p class="cw-eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${text ? `<p class="cw-muted">${esc(text)}</p>` : ""}</div>${action}</div>`; }
  function empty(title, text, action = "", mark = "◇") { return `<div class="cw-empty"><span class="cw-empty-mark" aria-hidden="true">${mark}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`; }
  function table(headers, rows, emptyTitle, emptyText, action = "", tableLabel = "") { return rows.length ? `<div class="cw-table-scroll" tabindex="0" role="region" aria-label="${esc(tableLabel || emptyTitle.replace(/^No /, ""))}"><table class="cw-table"><thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : empty(emptyTitle, emptyText, action); }
  function metric(name, value, detail) { return `<div class="cw-metric"><span>${esc(name)}</span><strong>${state.loading || !state.loaded ? "—" : esc(value)}</strong><small>${esc(detail)}</small></div>`; }
  function product(sku) { return state.data.products.find((item) => item.sku === sku); }
  function customer(order) { return state.data.customers.find((item) => item.id === order.customerId); }
  function statsFor(item) { return (state.summary.products || []).find((entry) => entry.id === item.id) || {}; }
  function orderTotal(order) { return num(order.total ?? order.totalAmount ?? order.value ?? (order.lines || []).reduce((sum, line) => sum + num(line.unitPrice ?? line.price ?? product(line.sku)?.price) * num(line.quantity), 0)); }
  function match(value) { return !state.search || String(value).toLowerCase().includes(state.search.toLowerCase()); }

  function warningView() {
    const warnings = state.summary.warnings || [];
    if (!warnings.length) return "";
    return `<section class="cw-warning-list" aria-label="Workroom needs attention">${warnings.slice(0, 6).map((warning) => `<div class="cw-warning"><span aria-hidden="true">!</span><p>${esc(warning.message)}</p>${warning.orderId ? sectionButton("View orders →", "orders") : ""}</div>`).join("")}</section>`;
  }

  function capacityView() {
    const capacity = state.summary.capacity || {};
    const queued = num(capacity.queuedHours), available = num(capacity.availableHours7Days);
    const scheduled = num(capacity.hoursPerDay) * 7;
    const ratio = scheduled ? Math.min(100, queued / scheduled * 100) : queued ? 100 : 0;
    const capacityCopy = queued
      ? capacity.daysToClear == null ? "Add available printer capacity to estimate the queue." : `Approximately ${count(capacity.daysToClear)} working days to clear this queue.`
      : scheduled > 0 ? `Your print queue is clear. ${count(available)} printer hours are available over the next 7 days.`
      : state.data.printers.length ? "Your printers have no available working hours. Review their status and schedules to open capacity."
      : "Add printers and working hours to calculate how much made-to-order work you can accept.";
    return `<section class="cw-panel cw-capacity">${heading("Made to order", "Capacity is inventory.")}<p class="cw-capacity-number">${count(queued)}<span>printer hours committed</span></p><div class="cw-progress" role="progressbar" aria-label="Committed printer hours against the next seven days" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio)}"><span style="width:${ratio}%"></span></div><div class="cw-capacity-detail"><span>${count(available)} h available / 7 days</span><span>${count(capacity.hoursPerDay)} h / day</span></div><p class="cw-muted">${esc(capacityCopy)}</p>${sectionButton("Manage the print room →", "production")}</section>`;
  }

  function overview() {
    const metrics = state.summary.metrics || {};
    const steps = [
      { done: state.data.materials.length > 0, title: "Stock the workroom", text: "Record filament, components, and packaging.", kind: "material", action: "Add material" },
      { done: state.data.products.length > 0, title: "Build your catalog", text: "Give each design a SKU, recipe, and price.", kind: "product", action: "Add product" },
      { done: state.data.printers.length > 0, title: "Set your capacity", text: "Add printers and realistic daily hours.", kind: "printer", action: "Add printer" },
      { done: state.data.orders.length > 0, title: "Take the first order", text: "Reserve stock and create its production work.", kind: "order", action: "Create order" },
    ];
    const complete = steps.filter((step) => step.done).length;
    return `<div class="cw-metrics">${metric("Open orders", count(metrics.openOrders, 0), "Across this business’s sales channels")}${metric("Open order value", money(metrics.orderValue), "Unshipped orders · not a payout balance")}${metric("Available finished units", count(metrics.availableUnits, 0), "One inventory pool across all channels")}${metric("Print hours queued", `${count(metrics.queuedHours)} h`, "Made-to-order work still in the queue")}</div>${warningView()}${complete < 4 ? `<section class="cw-panel cw-setup">${heading("A good place to begin", "Make room for the wonderfully odd.", "Set up the essentials once. Every order uses the same catalog, materials, and production flow.", `<span class="cw-setup-count">${complete} / 4 ready</span>`)}<div class="cw-setup-grid">${steps.map((step, index) => `<article class="cw-setup-step"><span class="cw-step-index ${step.done ? "is-done" : ""}" aria-label="${step.done ? "Complete" : `Step ${index + 1}`}">${step.done ? "✓" : `0${index + 1}`}</span><h3>${step.title}</h3><p>${step.text}</p>${step.done ? '<span class="cw-text-success">Ready to work</span>' : editButton(step.action + " →", step.kind)}</article>`).join("")}</div></section>` : ""}<div class="cw-overview-grid"><section class="cw-panel">${heading("From order to doorstep", "Work in motion", "Every handoff stays attached to its order.", sectionButton("All orders →", "orders"))}${flowView()}${ordersTable(state.data.orders.filter((order) => !["shipped", "cancelled"].includes(order.status)).slice(0, 5), true)}</section>${capacityView()}</div><section class="cw-connection-strip"><span class="cw-channel-mark" aria-hidden="true">↔</span><div><h3>A single workroom. Every sales channel.</h3><p>Orders, customers, shared stock, and tracking belong to Occasionally Odd. Channel connections require their own authorization.</p></div>${sectionButton("Set up channels →", "channels")}</section>`;
  }

  function flowView() {
    const stages = [["queued", "Queued"], ["printing", "Printing"], ["quality-check", "Quality check"], ["packing", "Packing"], ["ready", "Ready to ship"]];
    return `<div class="cw-flow" aria-label="Production job stages">${stages.map(([status, title]) => `<div><strong>${state.data.jobs.filter((job) => job.status === status).length}</strong><span>${title}</span></div>`).join("")}</div>`;
  }

  function ordersTable(orders, compact = false) {
    const hasHistory = state.data.orders.length > 0;
    const emptyTitle = hasHistory ? compact ? "No open orders" : "No matching orders" : "No orders yet";
    const emptyCopy = hasHistory
      ? compact ? "Every recorded order is shipped or canceled. Your order history is still available." : "Try another search or choose All stages to see your recorded orders."
      : "Create an order to reserve finished goods, allocate materials, and build its production queue.";
    const emptyAction = hasHistory && compact ? sectionButton("View order history →", "orders") : editButton("+ Create an order", "order", "", true);
    return table(compact ? ["Order / customer", "Ship by", "Stage"] : ["Order / customer", "Items", "Channel", "Ship by", "Value", "Stage", ""], orders.map((order) => `<tr><td><strong>${esc(order.externalId || order.number || order.id.slice(0, 12))}</strong><small>${esc(customer(order)?.name || order.customer?.name || "Customer")}</small></td>${!compact ? `<td>${(order.lines || []).map((line) => `<span class="cw-line-item">${esc(line.quantity)} × ${esc(line.sku)}</span>`).join("")}</td><td>${esc(channelName(order.channel))}</td>` : ""}<td>${esc(date(order.due))}</td>${!compact ? `<td>${money(orderTotal(order))}</td>` : ""}<td>${badge(order.status || "queued")}</td>${!compact ? `<td>${editButton("View order →", "order-detail", order.id)}</td>` : ""}</tr>`), emptyTitle, emptyCopy, emptyAction, "Orders");
  }

  function toolbar(placeholder, filters = []) {
    return `<div class="cw-toolbar"><label class="cw-search"><span class="cw-sr-only">${esc(placeholder)}</span><input type="search" data-cw-search value="${esc(state.search)}" placeholder="${esc(placeholder)}"></label>${filters.length ? `<label><span class="cw-sr-only">Filter by status</span><select data-cw-filter>${[["all", "All stages"], ...filters].map(([value, title]) => `<option value="${esc(value)}" ${state.filter === value ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>` : ""}</div>`;
  }

  function ordersView() {
    const orders = state.data.orders.filter((order) => match(`${order.externalId} ${order.id} ${customer(order)?.name} ${(order.lines || []).map((line) => line.sku).join(" ")}`) && (state.filter === "all" || order.status === state.filter));
    return `<section class="cw-panel">${heading("Your order book", "Orders", "One customer record and one fulfillment flow, whichever channel the order comes from.", editButton("+ Create order", "order", "", true))}${toolbar("Search order, customer, or SKU", [["open", "Open"], ["production", "In production"], ["ready", "Ready"], ["shipped", "Shipped"], ["cancelled", "Cancelled"]])}${ordersTable(orders)}</section>`;
  }

  function productsView() {
    const products = state.data.products.filter((item) => match(`${item.name} ${item.sku}`));
    return `<section class="cw-panel">${heading("Made here", "The product catalog", "A single SKU connects its recipe, channel orders, finished stock, and unit economics.", editButton("+ Add product", "product", "", true))}${toolbar("Search product or SKU")}${table(["Product / SKU", "Price", "Print time", "Available", "Contribution", "Per print hour", ""], products.map((item) => { const stats = statsFor(item); return `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.sku)}</small></td><td>${money(item.price)}</td><td>${count(item.printHours)} h</td><td>${count(stats.available, 0)}<small>${count(stats.reserved, 0)} reserved</small></td><td>${money(stats.unitContribution)}</td><td>${num(item.printHours) ? money(stats.profitPerPrinterHour) : "—"}</td><td>${editButton("Edit product", "product", item.id)}</td></tr>`; }), "Your next great oddity starts here", "Add a product with its materials, print time, costs, and selling price. Those details power stock reservations and production planning.", editButton("+ Add your first product", "product", "", true))}</section>`;
  }

  function jobCard(job) {
    const order = state.data.orders.find((item) => item.id === job.orderId);
    const printer = state.data.printers.find((item) => item.id === job.printerId);
    const item = product(job.sku);
    const next = job.status === "queued" ? (num(job.makeQuantity) ? "printing" : "quality-check") : ({ printing: "quality-check", "quality-check": "packing", packing: "ready" })[job.status];
    const action = ({ printing: "Assign printer", "quality-check": job.status === "queued" ? "Check stocked items" : "Print complete", packing: "Pass quality check", ready: "Packed & ready" })[next];
    return `<article class="cw-job"><div class="cw-job-meta"><span>${esc(order?.externalId || order?.id.slice(0, 10) || "Order")}</span><span>${esc(date(order?.due))}</span></div><h3>${esc(item?.name || job.sku)}</h3><p>${count(job.quantity, 0)} units · ${count(job.printHours)} print hours</p><small>${count(job.stockQuantity, 0)} from stock · ${count(job.makeQuantity, 0)} to make</small>${printer ? `<p class="cw-job-printer">◉ ${esc(printer.name)}</p>` : ""}${job.failures?.length ? `<small>${job.failures.length} failed attempt${job.failures.length === 1 ? "" : "s"} recorded</small>` : ""}${next ? button(esc(action) + " →", `data-cw-job="${esc(job.id)}" data-to="${esc(next)}"`, next === "printing", !canEdit()) : `<span class="cw-text-success">${job.status === "shipped" ? "Shipment recorded" : job.status === "cancelled" ? "Canceled" : "Awaiting fulfillment"}</span>`}${["printing", "quality-check"].includes(job.status) && num(job.makeQuantity) && job.materialsConsumed ? editButton("Record failed print", "failure", job.id) : ""}</article>`;
  }

  function printersView() {
    return `<section class="cw-panel">${heading("The print room", "Printers", "Recorded status · no live printer telemetry is connected.", editButton("+ Add printer", "printer"))}${state.data.printers.length ? `<div class="cw-printer-grid">${state.data.printers.map((printer) => `<article class="cw-printer"><div class="cw-printer-icon" aria-hidden="true">▥</div><div><h3>${esc(printer.name)}</h3><p>${count(printer.hoursPerDay)} scheduled hours / day</p>${badge(printer.status)}</div>${editButton("Manage", "printer", printer.id)}</article>`).join("")}</div>` : empty("Give every printer a place", "Set available hours and record maintenance so your queue reflects real working capacity.", editButton("+ Add printer", "printer"), "▥")}</section>`;
  }

  function productionView() {
    const live = state.data.jobs.filter((job) => !["shipped", "cancelled"].includes(job.status));
    return `${warningView()}<div class="cw-production-summary">${capacityView()}<section class="cw-panel">${heading("Small batches. Clear handoffs.", "The production queue", "Orders reserve finished goods first, then the materials needed to make the remaining units.")}${flowView()}<p class="cw-muted">Assign a printer, record completion, pass quality check, and confirm packing. Production consumes reserved materials once.</p></section></div>${live.length ? `<section class="cw-board" aria-label="Production board">${[["queued", "To make"], ["printing", "Printing"], ["quality-check", "Quality check"], ["packing", "Packing"], ["ready", "Ready"]].map(([status, title]) => { const jobs = live.filter((job) => job.status === status); return `<div class="cw-lane"><h3>${title}<span>${jobs.length}</span></h3>${jobs.length ? jobs.map(jobCard).join("") : '<p class="cw-lane-empty">Nothing at this stage</p>'}</div>`; }).join("")}</section>` : `<section class="cw-panel">${empty("A clear workbench", "Your production jobs appear here when you create an order. Each job carries its SKU, materials, deadline, and printer hours.", editButton("+ Create an order", "order", "", true), "▥")}</section>`}${printersView()}`;
  }

  function inventoryView() {
    return `${warningView()}<div class="cw-inventory-note"><span aria-hidden="true">↔</span><div><strong>One pool of stock. Every sales channel.</strong><p>Available = on hand − committed to open orders. A reservation belongs to its order across the entire Occasionally Odd workspace.</p></div></div><section class="cw-panel">${heading("Ready-made inventory", "Finished goods", "Made-to-order units are per-SKU estimates from shared materials and printer hours. These estimates cannot be added together.", editButton("+ Add product", "product"))}${table(["Product", "On hand", "Reserved", "Available", "Make-to-order capacity", ""], state.data.products.map((item) => { const stats = statsFor(item); return `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.sku)}</small></td><td>${count(stats.onHand, 0)}</td><td>${count(stats.reserved, 0)}</td><td><strong>${count(stats.available, 0)}</strong></td><td>${count(stats.makeToOrderCapacity, 0)} units<small>Materials & 7-day printer capacity</small></td><td>${editButton("Adjust stock", "stock-product", item.id)}</td></tr>`; }), "No finished goods yet", "Create your catalog, then record the pieces you have on the shelf.", editButton("+ Add product", "product"))}</section><section class="cw-panel">${heading("The ingredients", "Materials & components", "Filament, inserts, fasteners, packaging — measured in the unit you actually use.", editButton("+ Add material", "material", "", true))}${table(["Material", "On hand", "Reserved", "Available", "Unit cost", ""], state.data.materials.map((item) => { const stats = (state.summary.materials || []).find((entry) => entry.id === item.id) || {}; return `<tr><td><strong>${esc(item.name)}</strong><small>Measured in ${esc(item.unit)}</small></td><td>${count(stats.onHand ?? item.onHand)} ${esc(item.unit)}</td><td>${count(stats.reserved)} ${esc(item.unit)}</td><td>${count(stats.available)} ${esc(item.unit)}</td><td>${unitMoney(item.unitCost)} / ${esc(item.unit)}</td><td><div class="cw-row-actions">${editButton("Adjust", "stock-material", item.id)}${editButton("Edit", "material", item.id)}</div></td></tr>`; }), "Start with what’s on the shelf", "Add materials and components. Product recipes reserve the right quantity for each made-to-order unit.", editButton("+ Add first material", "material", "", true))}</section>`;
  }

  function customersView() {
    return `<section class="cw-panel">${heading("People behind the orders", "Customers", "Customer records are created from orders and stay inside Occasionally Odd.")}${toolbar("Search customer or email")}${table(["Customer", "Email", "Orders", "Recorded value", "Channels"], state.data.customers.filter((item) => match(`${item.name} ${item.email}`)).map((item) => { const orders = state.data.orders.filter((order) => order.customerId === item.id); return `<tr><td><strong>${esc(item.name)}</strong></td><td>${esc(item.email || "Not provided")}</td><td>${orders.length}</td><td>${money(orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + orderTotal(order), 0))}</td><td>${esc([...new Set(orders.map((order) => channelName(order.channel)))].join(", ") || "—")}</td></tr>`; }), "A home for every customer", "Your first order creates its customer record. Connected channels will use their customer identifiers to reduce duplicate entry.", editButton("+ Create an order", "order", "", true))}</section>`;
  }

  function channelsView() {
    return `<section class="cw-panel">${heading("Connect your shop", "Sell everywhere. Work from here.", "Prepare each channel for this organization. Setup preferences do not authorize an account or start synchronization.")}<div class="cw-sync-path"><span>Channel order</span><i>→</i><span>Customer & reservation</span><i>→</i><span>Production</span><i>→</i><span>Tracking return</span></div><div class="cw-channel-grid">${CHANNELS.map((channel) => { const config = state.data.channels.find((item) => item.channel === channel.id || item.id === channel.id); return `<article class="cw-channel"><div class="cw-channel-top"><span class="cw-channel-mark" aria-hidden="true">${esc(channel.mark)}</span>${badge("setup", "Setup required")}</div><h3>${channel.name}</h3><p>${channel.description}</p><small>${channel.note}</small><div class="cw-channel-capabilities"><span>Orders</span><span>Shared stock</span><span>Tracking</span></div><p class="cw-channel-disclaimer">${config?.enabled ? `Planning enabled${config.accountLabel ? ` · ${esc(config.accountLabel)}` : ""}. Authorization and adapter still required.` : "Capabilities must be verified before sync is enabled."}</p>${editButton(config ? "Edit setup →" : "Prepare connection →", "channel", channel.id)}</article>`; }).join("")}</div></section><section class="cw-panel">${heading("Sync operations", "Pending channel updates", "Inventory offers divide the shared finished-stock pool across enabled channels. Updates wait for authorized adapters; nothing is sent yet.")}${table(["Channel", "Update", "Stock offer", "State", "Detail"], state.data.outbox.slice(0, 30).map((item) => `<tr><td>${esc(channelName(item.channel))}</td><td>${esc(label(item.type || item.kind))}</td><td>${item.type === "inventory" ? `${count(item.available, 0)} units<small>of ${count(item.globalAvailable, 0)} globally available</small>` : "—"}</td><td>${badge(item.status || "blocked")}</td><td>${esc(item.reason || item.error || "An authorized channel adapter is required.")}</td></tr>`), "No channel updates queued", "After you prepare a channel, inventory and fulfillment changes can be held here for the authorized integration.")}</section>`;
  }

  function shippingView() {
    const orders = state.data.orders.filter((order) => order.status !== "cancelled");
    const ready = orders.filter((order) => order.status !== "shipped" && state.data.jobs.filter((job) => job.orderId === order.id).length && state.data.jobs.filter((job) => job.orderId === order.id).every((job) => job.status === "ready"));
    const shipped = orders.filter((order) => order.status === "shipped");
    return `<div class="cw-metrics cw-metrics-three">${metric("Ready to ship", ready.length, "Every production job packed and checked")}${metric("Shipped orders", shipped.length, "Recorded carrier and tracking")}${metric("Awaiting production", orders.length - ready.length - shipped.length, "Still moving through the workroom")}</div><section class="cw-panel">${heading("The final handoff", "Ready for a label", "Record a carrier and tracking number after arranging shipment. Label purchasing is not connected.")}${table(["Order", "Customer", "Ship by", "Items", ""], ready.map((order) => `<tr><td><strong>${esc(order.externalId || order.id.slice(0, 12))}</strong></td><td>${esc(customer(order)?.name || "Customer")}</td><td>${esc(date(order.due))}</td><td>${(order.lines || []).reduce((sum, line) => sum + num(line.quantity), 0)} units</td><td>${editButton("Record shipment →", "ship", order.id, true)}</td></tr>`), "Nothing waiting at the door", "Complete quality check and packing for every job on an order. It will appear here ready to ship.", sectionButton("Open production →", "production"), "↗")}</section><section class="cw-panel">${heading("Out in the world", "Shipment history")}${table(["Order", "Carrier", "Tracking", "Channel"], shipped.map((order) => `<tr><td><strong>${esc(order.externalId || order.id.slice(0, 12))}</strong></td><td>${esc(order.carrier || order.shipping?.carrier || order.fulfillment?.carrier || "—")}</td><td>${esc(order.trackingNumber || order.shipping?.trackingNumber || order.fulfillment?.trackingNumber || "—")}</td><td>${esc(channelName(order.channel))}</td></tr>`), "No shipments recorded", "Recorded shipments will include their carrier, tracking number, and originating channel.")}</section>`;
  }

  function marketingView() {
    return `<section class="cw-panel">${heading("Give your work a story", "Marketing, made for your shop", "Build product stories, prepare seasonal releases, and keep approved imagery inside Occasionally Odd.")}<div class="cw-marketing-grid">${[["01", "Campaigns & releases", "Plan a collection launch or a limited seasonal campaign with milestones and an approval trail.", "business-campaigns", "Open campaigns"], ["02", "Product imagery & files", "Keep design originals, product photos, and approved exports in this business’s library.", "content", "Open content library"], ["03", "Shop & landing pages", "Create the destination for your products and campaigns using this business’s storefront tools.", "sites", "Open sites"], ["04", "Automations", "Review business-scoped workflows and their connection requirements before enabling external actions.", "automation", "Open automations"]].map(([index, title, description, route, action]) => `<article class="cw-marketing-card"><span class="cw-step-index">${index}</span><h3>${title}</h3><p>${description}</p>${button(action + " →", `data-cw-route="${route}"`)}</article>`).join("")}</div></section>`;
  }

  function economicsView() {
    return `<section class="cw-panel">${heading("Know what each print earns", "SKU economics", "Estimated unit contribution after the recorded material, labor, overhead, and percentage fees. Shipping, tax, refunds, and unrecorded expenses are excluded.")}${table(["Product", "Selling price", "Material cost", "Labor + overhead", "Fees", "Contribution", "Profit / printer h"], state.data.products.map((item) => { const stats = statsFor(item); return `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.sku)}</small></td><td>${money(item.price)}</td><td>${money(stats.materialCost)}</td><td>${money(num(item.laborCost) + num(item.overheadCost))}</td><td>${money(num(item.price) * num(item.feePercent) / 100)}</td><td class="${num(stats.unitContribution) < 0 ? "cw-negative" : ""}"><strong>${money(stats.unitContribution)}</strong></td><td>${num(item.printHours) ? money(stats.profitPerPrinterHour) : "No print time"}</td></tr>`; }), "Give every SKU a clear margin", "Add a product’s selling price, recipe, labor, and print hours to see its unit economics.", editButton("+ Add product", "product", "", true))}</section>`;
  }

  function financeView() {
    const live = state.data.orders.filter((order) => order.status !== "cancelled");
    const shipped = live.filter((order) => order.status === "shipped");
    return `<div class="cw-metrics cw-metrics-three">${metric("Recorded order value", money(live.reduce((sum, order) => sum + orderTotal(order), 0)), "Excludes cancelled orders")}${metric("Shipped order value", money(shipped.reduce((sum, order) => sum + orderTotal(order), 0)), "Fulfillment value · not settled cash")}${metric("Products with costs", state.data.products.length, "Review each SKU’s inputs below")}</div>${economicsView()}<div class="cw-inline-note">Marketplace payouts and accounting balances are not connected. These figures are planning estimates from your recorded orders and product costs.</div>`;
  }

  function analyticsView() {
    const orders = state.data.orders.filter((order) => order.status !== "cancelled");
    const mix = [...new Set(orders.map((order) => order.channel || "manual"))].map((channel) => ({ channel, orders: orders.filter((order) => (order.channel || "manual") === channel) }));
    const max = Math.max(1, ...mix.map((entry) => entry.orders.length));
    return `${warningView()}<div class="cw-overview-grid"><section class="cw-panel">${heading("Where demand comes from", "Orders by sales channel", "Includes recorded, non-cancelled orders in this organization.")}${mix.length ? `<div class="cw-channel-bars">${mix.map((entry) => `<div class="cw-channel-bar"><div><strong>${esc(channelName(entry.channel))}</strong><span>${entry.orders.length} orders · ${money(entry.orders.reduce((sum, order) => sum + orderTotal(order), 0))}</span></div><div class="cw-progress"><span style="width:${entry.orders.length / max * 100}%"></span></div></div>`).join("")}</div>` : empty("Your story will take shape here", "Order mix appears as real orders are recorded. Connect channels when their authorization and adapters are ready.", sectionButton("Explore channels →", "channels"))}</section>${capacityView()}</div>${economicsView()}`;
  }

  function input(name, title, value = "", attributes = "", wide = false, hint = "") { return `<label class="cw-field ${wide ? "cw-field-wide" : ""}"><span>${esc(title)}</span><input name="${esc(name)}" value="${esc(value)}" ${attributes}>${hint ? `<small>${esc(hint)}</small>` : ""}</label>`; }
  function select(name, title, value, choices, hint = "") { return `<label class="cw-field"><span>${esc(title)}</span><select name="${esc(name)}">${choices.map(([key, title]) => `<option value="${esc(key)}" ${String(key) === String(value) ? "selected" : ""}>${esc(title)}</option>`).join("")}</select>${hint ? `<small>${esc(hint)}</small>` : ""}</label>`; }

  function editorView() {
    const editor = state.editor; if (!editor) return "";
    const item = editor.item || {};
    let title = "", copy = "", fields = "", submit = "Save changes";
    if (editor.kind === "product") {
      title = item.id ? `Edit ${item.name}` : "Add a product"; submit = item.id ? "Save product" : "Create product";
      copy = "Use one SKU everywhere. The recipe and print time are locked after creation to preserve existing production reservations.";
      fields = input("name", "Product name", item.name, 'required maxlength="180"') + input("sku", "SKU", item.sku, `required maxlength="80" ${item.id ? "readonly" : ""}`) + input("price", "Selling price ($)", item.price ?? "", 'type="number" required min="0" step="0.01"') + input("printHours", "Printer hours per unit", item.printHours ?? "", `type="number" required min="0" step="0.01" ${item.id ? "readonly" : ""}`) + input("materialCost", "Fallback material cost / unit ($)", item.materialCost ?? 0, 'type="number" min="0" step="0.01"', false, "Used only when no measured material recipe is recorded.") + input("laborCost", "Labor cost / unit ($)", item.laborCost ?? 0, 'type="number" min="0" step="0.01"') + input("overheadCost", "Overhead / unit ($)", item.overheadCost ?? 0, 'type="number" min="0" step="0.01"') + input("feePercent", "Sales channel fees (%)", item.feePercent ?? 0, 'type="number" min="0" max="100" step="0.01"') + (!item.id ? input("finishedStock", "Finished units on hand", 0, 'type="number" min="0" step="1"') : "") + select("rightsStatus", "Design rights", item.rightsStatus || "unconfirmed", [["unconfirmed", "Needs review"], ["original", "Original design"], ["authorized", "Written authorization held"]]) + input("rightsReference", "Authorization reference", item.rightsReference || "", 'maxlength="500"', true, "Required for authorized designs; use a reference, never a password or secret.") + `<fieldset class="cw-field-wide cw-recipe"><legend>Materials required per finished unit</legend><p>Use each material’s recorded unit. Components and packaging can be part of the same recipe.</p>${state.data.materials.length ? state.data.materials.map((material) => input(`bom:${material.id}`, `${material.name} (${material.unit})`, item.bom?.find((entry) => entry.materialId === material.id)?.quantity || 0, `type="number" min="0" step="0.001" ${item.id ? "readonly" : ""}`)).join("") : '<p>Add materials in Inventory first to include them in this product’s recipe.</p>'}</fieldset>`;
    } else if (editor.kind === "material") {
      title = item.id ? `Edit ${item.name}` : "Add a material or component"; submit = item.id ? "Save material" : "Add material";
      copy = "Choose the unit used in your recipes. Stock changes are recorded separately with a reason.";
      fields = input("name", "Material / component name", item.name, 'required maxlength="180"', true) + (item.id ? input("unit", "Unit", item.unit, "readonly") : select("unit", "Unit", "g", [["g", "Grams (g)"], ["kg", "Kilograms (kg)"], ["each", "Each"], ["ml", "Milliliters (ml)"], ["m", "Meters (m)"]])) + input("unitCost", "Cost per recorded unit ($)", item.unitCost ?? "", 'type="number" required min="0" step="0.0001"', false, "For example, cost per gram when your unit is g.") + (!item.id ? input("onHand", "Quantity on hand", "", 'type="number" required min="0" step="0.001"') : "");
    } else if (editor.kind === "printer") {
      title = item.id ? `Manage ${item.name}` : "Add a printer"; submit = item.id ? "Update printer" : "Add printer";
      copy = "Daily hours represent your available production schedule. Printer status is recorded here; it is not live telemetry.";
      fields = input("name", "Printer name", item.name, 'required maxlength="180"', true) + input("hoursPerDay", "Available printer hours / day", item.hoursPerDay ?? 8, 'type="number" required min="0" max="24" step="0.5"') + select("status", "Recorded status", item.status || "idle", item.status === "printing" ? [["printing", "Printing · active job"], ["offline", "Offline"], ["maintenance", "Maintenance"]] : [["idle", "Idle / available"], ["offline", "Offline"], ["maintenance", "Maintenance"]]);
    } else if (editor.kind === "order") {
      title = "Create an order"; submit = "Reserve stock & create order";
      copy = "Finished units are reserved first. Remaining quantities create production work and reserve their material recipes.";
      fields = input("externalId", "Order reference", "", 'required maxlength="160"', false, "Use the original channel order ID to prevent duplicates.") + select("channel", "Order channel", "manual", [["manual", "Direct / manual"], ...CHANNELS.map((channel) => [channel.id, channel.name]), ["other", "Other"]]) + input("customerName", "Customer name", "", 'required maxlength="180"') + input("customerEmail", "Customer email", "", 'type="email" maxlength="254"') + input("externalCustomerId", "Channel customer reference", "", 'maxlength="180"', false, "Optional provider customer ID for matching repeat orders.") + input("due", "Ship-by date", "", 'type="date" required', true) + `<fieldset class="cw-field-wide cw-order-lines"><legend>Order items</legend><div data-cw-lines>${orderLine(0)}</div>${button("+ Add another item", "data-cw-add-line")}</fieldset>`;
    } else if (editor.kind.startsWith("stock-")) {
      title = `Adjust ${item.name}`; submit = "Record stock adjustment";
      copy = "Use a positive quantity to receive stock or a negative quantity to remove it. Reserved stock stays protected.";
      fields = input("delta", `Quantity change (${editor.kind === "stock-product" ? "units" : item.unit})`, "", `type="number" required step="${editor.kind === "stock-product" ? "1" : "0.001"}"`) + input("reason", "Reason", "", 'required maxlength="500"', true, "For example: new spool received, physical count, or damaged stock.");
    } else if (editor.kind === "channel") {
      const channel = CHANNELS.find((entry) => entry.id === editor.id);
      title = `Prepare ${channel?.name || "channel"}`; submit = "Save setup preference";
      copy = "This saves a channel setup preference for Occasionally Odd. It does not connect an account or synchronize external data.";
      fields = input("accountLabel", "Shop / account label", item.accountLabel || "", 'maxlength="180"', true) + select("enabled", "Channel planning", item.enabled ? "true" : "false", [["false", "Not enabled"], ["true", "Enabled · awaiting integration"]], "Authorized provider adapters are required before queued updates can be delivered.") + `<p class="cw-field-wide cw-inline-note">${esc(channel?.note)}</p>`;
    } else if (editor.kind === "assign") {
      title = "Assign a printer"; submit = "Start printing";
      copy = "Starting the job commits its reserved materials and marks the selected printer as printing.";
      const printers = state.data.printers.filter((printer) => printer.status === "idle" && !printer.currentJobId && num(printer.hoursPerDay) > 0);
      fields = select("printerId", "Available printer", "", [["", "Choose a printer"], ...printers.map((printer) => [printer.id, `${printer.name} · ${count(printer.hoursPerDay)} h / day`])]) + `<p class="cw-field-wide cw-inline-note">${printers.length ? "Confirm the printer is ready before recording the start." : "No printer is currently available. Add a printer or finish the active job first."}</p>`;
    } else if (editor.kind === "failure") {
      title = "Record a failed print"; submit = "Record failure & requeue";
      copy = "This records the wasted attempt and releases the printer. Used materials remain consumed; the replacement print needs a new material reservation.";
      fields = input("reason", "What went wrong?", "", 'required maxlength="180"', true, "For example: first-layer adhesion failed or the part did not pass quality check.");
    } else if (editor.kind === "ship") {
      title = `Ship ${item.externalId || item.id.slice(0, 12)}`; submit = "Record shipment";
      copy = "Record the shipment you have arranged. Tracking updates remain queued until the originating channel has an authorized adapter.";
      fields = input("carrier", "Carrier", "", 'required maxlength="100"') + input("trackingNumber", "Tracking number", "", 'required maxlength="180"');
    } else if (editor.kind === "order-detail") {
      title = item.externalId || "Order details";
      copy = `${customer(item)?.name || "Customer"} · ${channelName(item.channel)} · ship by ${date(item.due)}`;
      const jobs = state.data.jobs.filter((job) => job.orderId === item.id);
      fields = `<div class="cw-field-wide">${badge(item.status || "queued")}<div class="cw-detail-jobs">${jobs.map(jobCard).join("")}</div><p class="cw-inline-note">Canceling releases unconsumed reservations. Materials already used in production are not returned to stock.</p>${button("Cancel this order", `data-cw-cancel-order="${esc(item.id)}"`, false, !canEdit() || ["shipped", "cancelled"].includes(item.status))}</div>`;
    }
    return `<section class="cw-panel cw-editor" aria-labelledby="cw-editor-title"><div class="cw-panel-heading"><div><p class="cw-eyebrow">Occasionally Odd · ${editor.item?.id ? "Update" : "New record"}</p><h2 id="cw-editor-title" tabindex="-1">${esc(title)}</h2><p class="cw-muted">${esc(copy)}</p></div>${button("Close", "data-cw-close")}</div><form data-cw-form><div class="cw-form-grid">${fields}</div><p class="cw-form-error" role="alert" data-cw-form-error></p>${editor.kind !== "order-detail" ? `<div class="cw-form-footer"><p>Saved only to Occasionally Odd.</p><button type="submit" class="cw-button cw-button-primary" ${!canEdit() ? "disabled" : ""}>${esc(submit)}</button></div>` : ""}</form></section>`;
  }

  function orderLine(index) {
    return `<div class="cw-order-line" data-cw-line>${select(`lineSku:${index}`, "Product", "", [["", "Choose a product"], ...state.data.products.map((item) => [item.sku, `${item.name} · ${item.sku}`])])}${input(`lineQty:${index}`, "Quantity", 1, 'type="number" required min="1" step="1"')}${button("Remove", 'data-cw-remove-line aria-label="Remove order item"')}</div>`;
  }

  function paint() {
    if (!active()) return;
    const views = { overview, orders: ordersView, products: productsView, production: productionView, inventory: inventoryView, customers: customersView, channels: channelsView, shipping: shippingView, marketing: marketingView, finance: financeView, analytics: analyticsView };
    root.innerHTML = `<div class="commerce-workspace" data-commerce-workspace="${esc(businessId)}" aria-busy="${state.loading}"><header class="cw-header"><div><p class="cw-eyebrow">Occasionally Odd / ${state.section === "overview" ? "The workroom" : label(state.section)}</p><h1>${state.section === "overview" ? "Good things. A little odd." : esc(label(state.section))}</h1><p>From a spark of an idea to a box at their door.</p></div><div class="cw-header-actions"><span class="cw-scope"><i></i>Occasionally Odd only</span>${button("↻ Refresh", "data-cw-refresh", false, !remote || state.loading || state.busy)}</div></header><nav class="cw-nav" aria-label="Occasionally Odd workroom">${SECTIONS.map((section) => `<button type="button" data-cw-section="${section}" ${section === state.section ? 'class="is-active" aria-current="page"' : ""}>${label(section)}</button>`).join("")}</nav>${!remote ? '<div class="cw-access-note">You’re viewing an empty workroom preview. Sign in to an authorized Occasionally Odd account to save products, orders, and inventory.</div>' : state.loaded && !state.canManage ? '<div class="cw-access-note">You have view-only access. An organization administrator can update this workroom.</div>' : ""}${state.error ? `<div class="cw-error" role="alert">${esc(state.error)}${button("Try again", "data-cw-refresh")}</div>` : ""}${state.notice ? `<div class="cw-notice" role="status">${esc(state.notice)}</div>` : ""}${state.loading ? '<div class="cw-loading" role="status"><span></span>Loading this business’s workroom…</div>' : state.loaded ? `${editorView()}${views[state.section]()}` : `<section class="cw-panel">${empty("The workroom couldn’t load", "Refresh to try again. No cached records from another business will be shown.", button("Refresh workroom", "data-cw-refresh", true))}</section>`}</div>`;
    bind();
  }

  function openEditor(kind, id = "") {
    if (kind === "order-detail" ? !active() || !state.loaded || state.busy : !canEdit()) return;
    const collection = ({ product: "products", material: "materials", printer: "printers", "stock-product": "products", "stock-material": "materials", ship: "orders", "order-detail": "orders", assign: "jobs", failure: "jobs" })[kind];
    const item = kind === "channel" ? state.data.channels.find((entry) => entry.channel === id || entry.id === id) : collection && state.data[collection].find((entry) => entry.id === id);
    if (id && collection && !item) return;
    state.editor = { kind, id, item }; state.error = ""; paint();
    root.querySelector("#cw-editor-title")?.focus();
    root.querySelector(".cw-editor")?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }

  async function runAction(type, payload, success) {
    try { await command(type, payload, success); }
    catch (error) { if (active()) state.error = error.name === "AbortError" ? "The request timed out. Refresh to confirm its status before retrying." : error.message; }
    if (active()) paint();
  }

  function bind() {
    root.querySelectorAll("[data-cw-section]").forEach((element) => element.addEventListener("click", () => {
      if (!active() || state.busy) return;
      if (options.onSectionChange) { options.onSectionChange(element.dataset.cwSection); return; }
      state.section = element.dataset.cwSection; state.editor = null; state.search = ""; state.filter = "all"; state.notice = ""; paint();
    }));
    root.querySelectorAll("[data-cw-route]").forEach((element) => element.addEventListener("click", () => { if (active()) options.navigate?.(element.dataset.cwRoute); }));
    root.querySelectorAll("[data-cw-edit]").forEach((element) => element.addEventListener("click", () => openEditor(element.dataset.cwEdit, element.dataset.id)));
    root.querySelectorAll("[data-cw-refresh]").forEach((element) => element.addEventListener("click", refresh));
    root.querySelector("[data-cw-close]")?.addEventListener("click", () => { if (!state.busy) { state.editor = null; paint(); } });
    root.querySelector("[data-cw-search]")?.addEventListener("input", (event) => { state.search = event.target.value; const cursor = event.target.selectionStart; paint(); const input = root.querySelector("[data-cw-search]"); input?.focus(); input?.setSelectionRange(cursor, cursor); });
    root.querySelector("[data-cw-filter]")?.addEventListener("change", (event) => { state.filter = event.target.value; paint(); });
    root.querySelectorAll("[data-cw-job]").forEach((element) => element.addEventListener("click", () => { if (!canEdit()) return; if (element.dataset.to === "printing") openEditor("assign", element.dataset.cwJob); else void runAction("advance-job", { jobId: element.dataset.cwJob, to: element.dataset.to }, "Production stage updated."); }));
    root.querySelector("[data-cw-cancel-order]")?.addEventListener("click", (event) => { if (!canEdit()) return; void runAction("cancel-order", { orderId: event.currentTarget.dataset.cwCancelOrder }, "Order canceled. Unconsumed reservations released."); });
    root.querySelector("[data-cw-add-line]")?.addEventListener("click", () => { const lines = root.querySelector("[data-cw-lines]"); const index = num(lines.dataset.nextIndex || 1); lines.insertAdjacentHTML("beforeend", orderLine(index)); lines.dataset.nextIndex = String(index + 1); bindLineRemoval(); });
    bindLineRemoval();
    root.querySelector("[data-cw-form]")?.addEventListener("submit", submitForm);
  }

  function bindLineRemoval() { root.querySelectorAll("[data-cw-remove-line]").forEach((element) => { element.onclick = () => { if (root.querySelectorAll("[data-cw-line]").length > 1) element.closest("[data-cw-line]").remove(); }; }); }

  async function submitForm(event) {
    event.preventDefault(); if (!canEdit() || !state.editor || event.currentTarget !== root.querySelector("[data-cw-form]")) return;
    const form = event.currentTarget, data = new FormData(form), editor = state.editor, item = editor.item || {};
    const value = (key) => String(data.get(key) || "").trim();
    const number = (key) => num(data.get(key));
    let type, payload, success;
    if (editor.kind === "product") {
      type = item.id ? "update-product" : "create-product";
      payload = { ...(item.id ? { productId: item.id } : { sku: value("sku"), printHours: number("printHours"), finishedStock: number("finishedStock"), bom: state.data.materials.map((material) => ({ materialId: material.id, quantity: number(`bom:${material.id}`) })).filter((entry) => entry.quantity > 0) }), name: value("name"), price: number("price"), materialCost: number("materialCost"), laborCost: number("laborCost"), overheadCost: number("overheadCost"), feePercent: number("feePercent"), rightsStatus: value("rightsStatus"), rightsReference: value("rightsReference") }; success = "Product saved to the Occasionally Odd catalog.";
    } else if (editor.kind === "material") {
      type = item.id ? "update-material" : "create-material"; payload = { ...(item.id ? { materialId: item.id } : { unit: value("unit"), onHand: number("onHand") }), name: value("name"), unitCost: number("unitCost") }; success = "Material saved to the workroom.";
    } else if (editor.kind === "printer") {
      type = item.id ? "update-printer" : "create-printer"; payload = { ...(item.id ? { printerId: item.id } : {}), name: value("name"), hoursPerDay: number("hoursPerDay"), status: value("status") }; success = "Printer schedule updated.";
    } else if (editor.kind === "order") {
      type = "create-order"; payload = { externalId: value("externalId"), channel: value("channel"), customer: { name: value("customerName"), ...(value("externalCustomerId") ? { externalCustomerId: value("externalCustomerId") } : {}), ...(value("customerEmail") ? { email: value("customerEmail") } : {}) }, due: value("due"), lines: [...data.keys()].filter((key) => key.startsWith("lineSku:")).map((key) => ({ sku: value(key), quantity: number(key.replace("lineSku:", "lineQty:")) })) }; success = "Order created. Inventory and production reservations updated.";
    } else if (editor.kind.startsWith("stock-")) {
      type = "adjust-stock"; payload = { kind: editor.kind === "stock-product" ? "product" : "material", id: item.id, delta: number("delta"), reason: value("reason") }; success = "Stock adjustment recorded.";
    } else if (editor.kind === "channel") {
      type = "configure-channel"; payload = { channel: editor.id, enabled: value("enabled") === "true", accountLabel: value("accountLabel") }; success = "Channel setup preference saved. Authorization and an adapter are still required.";
    } else if (editor.kind === "assign") {
      type = "advance-job"; payload = { jobId: item.id, to: "printing", printerId: value("printerId") }; success = "Print job started and reserved materials committed.";
    } else if (editor.kind === "failure") {
      type = "fail-job"; payload = { jobId: item.id, reason: value("reason") }; success = "Failed attempt recorded. Job requeued with a fresh material reservation.";
    } else if (editor.kind === "ship") {
      type = "ship-order"; payload = { orderId: item.id, carrier: value("carrier"), trackingNumber: value("trackingNumber") }; success = "Shipment recorded. Channel tracking updates require an authorized adapter.";
    }
    if (!type) return;
    const submit = form.querySelector('[type="submit"]'); const originalText = submit.textContent;
    submit.disabled = true; submit.textContent = "Saving…"; form.querySelector("[data-cw-form-error]").textContent = "";
    try { await command(type, payload, success); if (active()) paint(); }
    catch (error) { if (active()) form.querySelector("[data-cw-form-error]").textContent = error.name === "AbortError" ? "The save timed out. Refresh to check whether it completed before retrying." : error.message; }
    finally { if (submit.isConnected) { submit.disabled = false; submit.textContent = originalText; } }
  }

  paint(); if (remote) void refresh();
  return controller;
}
