import { PRINT_DEFAULTS, validatePrintCosts } from "./print-opportunity-core.js?v=phantom-live-20261027-247";
import { createPrintQuoteUiState, printQuoteWorkflowView, bindPrintQuoteWorkflow } from "./print-quote-ui.js?v=phantom-live-20261027-247";
import { printDecisionLabView } from "./print-decision-lab.js?v=phantom-live-20261027-247";

export const BAMBU_BUSINESS = "occasionally-odd";
const API = "/api/business-workspaces/print-runs";
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = (value, digits = 2) => Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const hours = seconds => positive(seconds) ? `${count(seconds / 3600)} h` : "Time unavailable";
const money = (value, currency = "USD") => finite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value) : "—";
const date = value => { const result = new Date(value); return Number.isFinite(result.getTime()) ? result.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not observed yet"; };
const defaultCosts = () => ({ ...PRINT_DEFAULTS, fee: 0, fixedFee: 0 });
const evidenceNames = { prepared: "Prepared in Studio", submitted: "Submission observed", printing: "Printing observed", completed: "Completion observed", failed: "Failure observed", unknown: "Outcome unknown" };

/** A full saved project / batch, never an inferred physical print or product yield.
 * Only production costs repeat on failure. Finishing and packing happen once.
 * Saved per-material amounts replace generic filament assumptions plate by plate. */
export function calculateBambuEconomics(plates, costs, { materialCosts = [], saleableUnits = null, completeProduct = false, extraCostPerBatch = 0 } = {}) {
  validatePrintCosts(costs);
  if (!finite(extraCostPerBatch)) throw new Error("Enter a valid additional-parts cost.");
  if (!Array.isArray(plates) || !plates.length || plates.some(plate => !positive(plate.grams) || !positive(plate.seconds))) return null;
  const c = Object.fromEntries(Object.entries(costs).map(([key, value]) => [key, Number(value)]));
  const grams = plates.reduce((sum, plate) => sum + plate.grams, 0), seconds = plates.reduce((sum, plate) => sum + plate.seconds, 0);
  const filament = plates.reduce((sum, plate) => {
    const recorded = materialCosts.find(row => String(row.index) === String(plate.index))?.materialCost?.amount;
    return sum + (finite(recorded) ? recorded : plate.grams / 1000 * c.filament);
  }, 0);
  const machine = seconds / 3600 * c.machine, failureAllowance = (filament + machine) * c.failure / (1 - c.failure);
  const labor = c.minutes / 60 * c.labor, packaging = c.packaging, fixedFee = c.fixedFee, additionalParts = extraCostPerBatch;
  const cost = filament + machine + failureAllowance + labor + packaging + fixedFee + additionalParts, expectedHours = seconds / 3600 / (1 - c.failure);
  const result = { grams, seconds, filament, machine, failureAllowance, labor, packaging, fixedFee, additionalParts, cost, expectedHours,
    breakEven: cost / (1 - c.fee), marginPrice: cost / (1 - c.fee - c.margin), hourlyPrice: (cost + c.hourly * expectedHours) / (1 - c.fee),
    contributionPerHour: (c.revenue * (1 - c.fee) - cost) / expectedHours };
  const units = completeProduct && Number.isInteger(saleableUnits) && saleableUnits > 0 ? saleableUnits : null;
  return { ...result, perUnit: units ? { units, cost: cost / units, breakEven: result.breakEven / units, marginPrice: result.marginPrice / units, hourlyPrice: result.hourlyPrice / units } : null };
}

/** Do not merge asking prices with sales, silently convert currencies or count
 * digital files / unreviewed products as physical comparables. */
export function summarizeBambuComparables(records = [], currency = "USD", now = Date.now()) {
  const usable = records.filter(row => {
    let url; try { url = new URL(row.url); } catch { return false; }
    const at = Date.parse(row.observedAt);
    return url.protocol === "https:" && row.comparable === true && row.currency === currency && finite(row.price) && finite(row.shipping)
      && Number.isInteger(row.quantity) && row.quantity > 0 && ["asking", "sold"].includes(row.kind) && Number.isFinite(at) && at <= now && now - at <= 30 * 86400000;
  }).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const group = kind => {
    const seen = new Set();
    const rows = usable.filter(row => row.kind === kind && !seen.has(row.url) && seen.add(row.url));
    const values = rows.map(row => (row.price + row.shipping) / row.quantity).sort((a, b) => a - b);
    return { count: rows.length, rows, low: values.length ? values[0] : null, high: values.length ? values.at(-1) : null,
      median: values.length >= 3 ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null };
  };
  return { asking: group("asking"), sold: group("sold"), excluded: records.length - usable.length };
}

export function buildBambuInsight(file, settings, economics) {
  const plates = file.metadata?.plates || [], mapping = file.mapping;
  if (!economics) return "This project needs saved slice time and mass before a trustworthy cost or capacity target can be calculated.";
  const actions = [], confirmations = [];
  if (!settings.costsConfirmed) confirmations.push("shop rates");
  if (!mapping?.completeProduct) confirmations.push("finished unit yield");
  if (!mapping || mapping.rightsStatus === "unconfirmed") confirmations.push("commercial rights");
  if (confirmations.length) actions.push(`Next: confirm ${confirmations.join(", ")} once${!settings.costsConfirmed ? "; prices remain illustrative" : ""}.`);
  const materials = new Set(plates.flatMap(plate => (plate.filaments || []).filter(f => positive(f.grams)).map(f => `${f.id}|${f.type}|${f.color}`)));
  if (materials.size > 1) actions.push(`${materials.size} filament selections: check spool costs and compare a simpler-color batch${plates.some(plate => plate.supportUsed) ? "; supports also need cleanup labor" : ""}.`);
  else if (plates.some(plate => plate.supportUsed)) actions.push("Supports need hands-on cleanup labor before you quote.");
  const target = Math.max(economics.marginPrice, economics.hourlyPrice), constraint = economics.hourlyPrice > economics.marginPrice ? "printer-hour return" : "contribution margin";
  if (economics.seconds >= 6 * 3600) actions.push(`${count(economics.seconds / 3600)} saved printer hours tie up capacity; the higher planning threshold is ${money(target, settings.currency)} for the whole project, driven by ${constraint}.`);
  else actions.push(`Use the higher of the margin and printer-hour targets: ${money(target, settings.currency)} for the whole project (${constraint}).`);
  return actions.join(" ");
}

export function createBambuFeedState() { return { snapshot: null, loading: false, busy: false, error: "", notice: "", open: ["pq-quote", "decision-lab"], limit: 8, dirty: false, initialRunOpened: false, quoteUi:createPrintQuoteUiState() }; }

export function renderBambuPrintFeed(root, options = {}) {
  if (options.businessId !== BAMBU_BUSINESS) { root.replaceChildren(); return { destroy() {} }; }
  const state = options.state || createBambuFeedState();
  state.quoteUi ||= createPrintQuoteUiState();
  state.legacyDrafts ||= {};
  state.quoteUi.open = state.open;
  let disposed = false, timer = null;
  const identity = options.getSessionIdentity?.();
  const requests = new Set(), active = () => !disposed && options.isActive?.() !== false && (!options.getSessionIdentity || options.getSessionIdentity() === identity);
  const manage = () => active() && state.snapshot?.canManage === true && !state.busy;
  if (!document.querySelector('link[data-bambu-feed-css]')) {
    const link = document.createElement("link"), cssUrl = new URL("../bambu-print-feed.css", import.meta.url); cssUrl.search = new URL(import.meta.url).search; link.rel = "stylesheet"; link.href = cssUrl.href; link.dataset.bambuFeedCss = ""; document.head.append(link);
  }
  function headers(json = true) { return { ...options.getHeaders?.(), "x-phantomforce-business": BAMBU_BUSINESS, ...(json ? { "Content-Type": "application/json" } : {}) }; }
  function validate(payload, full = false) {
    if (payload.tenant_id !== BAMBU_BUSINESS) throw new Error("Print history belongs to another business. Nothing was loaded.");
    if (full && (!Array.isArray(payload.runs) || !Array.isArray(payload.files) || payload.runs.some(row => row.tenantId !== BAMBU_BUSINESS) || payload.files.some(row => row.tenantId !== BAMBU_BUSINESS))) throw new Error("Print history could not be verified for Occasionally Odd.");
    return payload;
  }
  async function request(path = "", body) {
    if (!active()) throw new Error("This business changed. Reopen Occasionally Odd to continue.");
    const abort = new AbortController(); requests.add(abort); const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(`${API}${path}`, { method: body ? "POST" : "GET", headers: headers(), signal: abort.signal, cache: "no-store", ...(body ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) { const error=new Error(typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error.replace(/_/g, " ") : `Print connection could not respond (${response.status}).`); error.status=response.status; throw error; }
      return validate(payload, !path);
    } finally { clearTimeout(timeout); requests.delete(abort); }
  }
  async function refresh(quiet = false) {
    if (!active() || options.remote === false || state.busy || state.loading || (quiet && (state.dirty || document.hidden))) return;
    state.loading = true; if (!quiet) { state.error = ""; paint(); }
    try { const payload = await request(); if (active()) { state.snapshot = payload; state.error = ""; if (!state.initialRunOpened && payload.runs.length) { state.open.push(`run-${payload.runs[0].id}`); state.initialRunOpened = true; } } }
    catch (error) { if (active()) state.error = error.name === "AbortError" ? "Print history took too long to respond. Try refreshing." : error.message; }
    finally { if (active()) { state.loading = false; if (!state.dirty) paint(); } }
  }
  async function save(path, body, notice) {
    if (!manage()) return;
    state.busy = true; state.error = "";
    try { await request(path, body); if (!active()) return;
      for(const key of Object.keys(state.legacyDrafts)) if(path==='/settings'?key==='data-bpf-costs':path.startsWith('/models/') && key.endsWith(path.split('/').at(-1)))delete state.legacyDrafts[key];
      state.dirty=Object.keys(state.legacyDrafts).length>0 || Object.keys(state.quoteUi.drafts || {}).length>0; state.notice = notice; state.snapshot = await request(); }
    catch (error) { if (active()) state.error = error.name === "AbortError" ? "The save timed out. Refresh to confirm before trying again." : error.message; }
    finally { if (active()) { state.busy = false; paint(); } }
  }
  async function workflowCommand(type, payload, notice) {
    if (!manage()) throw new Error("Reopen Occasionally Odd with administrator access to save this change.");
    state.busy = true; state.error = "";
    const fingerprint=JSON.stringify({type,payload});
    if(state.pendingWorkflowCommand?.fingerprint!==fingerprint) state.pendingWorkflowCommand={fingerprint,commandId:crypto.randomUUID(),expectedRevision:state.snapshot.workflow?.revision};
    const {commandId,expectedRevision}=state.pendingWorkflowCommand; let saved=false;
    try {
      const response=await request("/workflow/commands", {commandId,expectedRevision,type,payload});
      if (!active()) return;
      if (response.workflow) state.snapshot.workflow=response.workflow;
      const result=response.result || {};
      const recipe=result.recipe || (type==='save-recipe' && result.id ? result : null);
      const quote=result.quote || (type==='create-quote' && result.id ? result : null);
      if (recipe) {state.quoteUi.recipeId=recipe.id;state.quoteUi.showRecipe=false;}
      if (quote) {state.quoteUi.activeQuoteId=quote.id;state.quoteUi.activeQuoteVersion=quote.version;}
      state.dirty=false; state.notice=notice;
      state.snapshot=await request(); saved=true; state.pendingWorkflowCommand=null;
    } catch(error) {
      if(error.status===409 && active()) {state.pendingWorkflowCommand=null;try { const latest=await request();if(active())state.snapshot=latest;}catch{} }
      if (active()) state.error=error.name==='AbortError'?"The save timed out. Refresh to confirm before retrying.":error.message;
      throw error;
    } finally {if(active()){state.busy=false;if(saved || !state.dirty)paint();}}
  }
  function button(text, attrs, primary = false, disabled = false) { return `<button type="button" class="cw-button ${primary ? "cw-button-primary" : ""}" ${attrs} ${disabled || state.busy ? "disabled" : ""}>${text}</button>`; }
  function field(name, label, value, attrs = "") { return `<label class="bpf-field"><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" ${attrs}></label>`; }
  function disclosure(key, title, content, className = "") { return `<details class="bpf-details ${className}" data-bpf-detail="${esc(key)}" ${state.open.includes(key) ? "open" : ""}><summary>${esc(title)}</summary>${content}</details>`; }
  function metric(label, value, detail) { return `<div class="bpf-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`; }
  function settingsView(snapshot) {
    const settings = snapshot.settings, c = settings.costs || defaultCosts();
    const fields = [["filament", "Filament · USD / kg"], ["machine", "Energy + wear · USD / printer hour"], ["labor", "Hands-on labor · USD / hour"], ["minutes", "Finishing minutes / whole project"], ["packaging", "Packing / whole project · USD"], ["hourly", "Target contribution / printer hour · USD"], ["revenue", "Test revenue / whole project · USD"]];
    return disclosure("shop", `${settings.costsConfirmed ? "Saved" : "Set once"} shop cost assumptions`, `<form data-bpf-costs><p class="bpf-copy">US / USD · local and custom orders. Actual matched inventory costs replace the generic filament rate automatically. Save once and reuse for every captured project.</p><div class="bpf-fields">${fields.map(([key, text]) => field(key, text, c[key], 'type="number" min="0" max="1000000" step="any" required')).join("")}${field("failure", "Full reprint allowance · %", Number((c.failure * 100).toFixed(4)), 'type="number" min="0" max="99" step="any" required')}${field("margin", "Target contribution margin · %", Number((c.margin * 100).toFixed(4)), 'type="number" min="0" max="99" step="any" required')}</div><details class="bpf-details"><summary>Payment fees and delivery assumptions</summary><p class="bpf-copy">Local pickup has no shipping in this model. Add your delivery cost to the project packing allowance when applicable. Percentage fees here apply to the whole test revenue; taxes, refunds and unspecified expenses remain excluded.</p><div class="bpf-fields">${field("fee", "Payment / sales fees · %", Number((c.fee * 100).toFixed(4)), 'type="number" min="0" max="99" step="any" required')}${field("fixedFee", "Fixed fee / whole project · USD", c.fixedFee, 'type="number" min="0" step="any" required')}</div></details><label class="bpf-check"><input type="checkbox" name="confirmed" ${settings.costsConfirmed ? "checked" : ""}>I checked these planning assumptions for my shop</label><div class="bpf-actions"><button class="cw-button cw-button-primary" ${!manage() ? "disabled" : ""}>Save shop assumptions</button><span>Saved to Occasionally Odd, across devices.</span></div></form>`);
  }
  function compView(file, currency) {
    const all = file.mapping?.comparables || [], groups = summarizeBambuComparables(all, currency);
    const line = (group, label) => group.count ? `<div class="bpf-evidence"><strong>${esc(label)} · ${group.count} ${group.count === 1 ? "observation" : "observations"}</strong><span>${money(group.low, currency)}${group.high !== group.low ? `–${money(group.high, currency)}` : ""} / unit incl. recorded delivery</span><small>${group.median === null ? "At least 3 fresh comparable observations are needed for a median." : `Median ${money(group.median, currency)}; comparable quality still needs review.`}</small></div>` : "";
    return `<p class="bpf-copy">${all.length ? "Saved observations, refreshed within 30 days and kept separate by evidence type." : "No verified market evidence yet. A cost target is not proof of a competitive price or demand."}</p>${line(groups.asking, "Asking prices")}${line(groups.sold, "Reported sales")}${groups.excluded ? `<p class="bpf-copy">${groups.excluded} stale, incomplete, unreviewed or other-currency observations excluded.</p>` : ""}${all.length ? `<ul class="bpf-links">${all.map(row => { let url; try { url = new URL(row.url); } catch { return ""; } return url.protocol === "https:" ? `<li><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(url.hostname)}</a> · ${esc(row.kind)} · ${date(row.observedAt)}${row.notes ? `<small>${esc(row.notes)}</small>` : ""}</li>` : ""; }).join("")}</ul>` : ""}`;
  }
  function modelForm(file) {
    const mapping = file.mapping || {}, hash = file.sha256;
    return `<form data-bpf-model="${esc(hash)}"><p class="bpf-copy">Confirm this once for this exact saved project. All included plates are counted once. Part count is never assumed to be saleable quantity. Changed 3MF content needs a fresh mapping.</p><div class="bpf-fields">${field("name", "Product / custom project name", mapping.name || file.metadata?.projectTitle || "", 'maxlength="180" required placeholder="Give this project a reusable name"')}${field("saleableUnits", "Saleable units from the complete project", mapping.saleableUnits || 1, 'type="number" min="1" max="100000" step="1" required')}<label class="bpf-field"><span>Commercial rights</span><select name="rightsStatus"><option value="unconfirmed" ${!mapping.rightsStatus || mapping.rightsStatus === "unconfirmed" ? "selected" : ""}>Not yet confirmed</option><option value="original" ${mapping.rightsStatus === "original" ? "selected" : ""}>My original design</option><option value="authorized" ${mapping.rightsStatus === "authorized" ? "selected" : ""}>License allows commercial use</option></select></label>${field("extraCostPerBatch", "Nonprinted parts / complete project · USD", mapping.extraCostPerBatch ?? 0, 'type="number" min="0" max="1000000" step="any" required')}${field("rightsReference", "License / rights reference, if applicable", mapping.rightsReference || "", 'maxlength="1000"')}</div><label class="bpf-check"><input type="checkbox" name="completeProduct" ${mapping.completeProduct ? "checked" : ""}>This project includes every plate and assembly part needed for these finished units</label><div class="bpf-actions"><button class="cw-button cw-button-primary" ${!manage() ? "disabled" : ""}>Save reusable product mapping</button></div></form>${disclosure(`market-${hash}`, "Optional local market evidence", `${compView(file, "USD")}<form data-bpf-comparable="${esc(hash)}"><p class="bpf-copy">Add a public physical-product observation when available. Unknown delivery, a digital STL, different size or an unreviewed match will not support a competitive claim.</p><div class="bpf-fields">${field("url", "Public source URL", "", 'type="url" required placeholder="https://…"')}${field("price", "Total item / pack price · USD", "", 'type="number" min="0" step="any" required')}${field("shipping", "Delivery · USD (0 for pickup)", "", 'type="number" min="0" step="any" required')}${field("quantity", "Units in that price", 1, 'type="number" min="1" max="100000" step="1" required')}<label class="bpf-field"><span>Evidence type</span><select name="kind"><option value="asking">Asking price</option><option value="sold">Reported completed sale</option></select></label>${field("observedAt", "Observed date", new Date().toISOString().slice(0, 10), 'type="date" required')}${field("notes", "Match / source notes", "", 'maxlength="1000"')}</div><label class="bpf-check"><input type="checkbox" name="comparable" required>I reviewed size, material, quantity and customization: this is a comparable physical product</label><div class="bpf-actions"><button class="cw-button" ${!manage() || !file.mapping ? "disabled" : ""}>Save observation</button><span>${file.mapping ? "Keep asking prices separate from actual sales." : "Save the product mapping first."}</span></div></form>${mapping.name ? `<p class="bpf-copy">Optional research opens a search you choose. Only the saved product name goes into that link; no model files are sent.</p><div class="bpf-actions"><a class="cw-button" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=${encodeURIComponent(`${mapping.name} custom 3d printed physical product USA local price`)}">Research local / custom offers ↗</a></div>` : ""}`)}`;
  }
  function runView(run, file, snapshot) {
    if (!file) return "";
    const metadata = file.metadata || {}, plates = metadata.plates || [], mapping = file.mapping;
    const settings = snapshot.settings, currency = settings.currency;
    let economics = null;
    try { economics = calculateBambuEconomics(plates, settings.costs, { materialCosts: file.analysis?.plates, saleableUnits: mapping?.saleableUnits, completeProduct: mapping?.completeProduct, extraCostPerBatch: mapping?.extraCostPerBatch ?? 0 }); } catch { /* Technical history stays useful with invalid or missing cost assumptions. */ }
    const name = mapping?.name || metadata.projectTitle || metadata.name || "Captured 3MF", confirmed = settings.costsConfirmed;
    const actual=snapshot.workflow?.actuals?.find(row=>row.runId===run.id);
    const outcomeLabel=actual?`${actual.outcome==='completed'?'Completed':'Failed'} - ${actual.source==='printer-telemetry'?'printer report':'operator report'}`:evidenceNames[run.evidence] || "Outcome unknown";
    const body = `<div class="bpf-run-body"><div class="bpf-insight"><strong>What matters for this project</strong><p>${esc(buildBambuInsight(file, settings, economics))}</p></div><div class="bpf-run-meta"><span>${esc(metadata.printer || "Printer profile unavailable")}</span><span>${plates.length} saved ${plates.length === 1 ? "plate" : "plates"}</span><span>${esc(metadata.nozzle || "Nozzle not recorded")}</span></div><div class="bpf-plate-list">${plates.length ? plates.map(plate => `<div class="bpf-plate"><strong>Plate ${esc(plate.index)}</strong><span>${finite(plate.grams) ? `${count(plate.grams)} g` : "Mass unavailable"} · ${hours(plate.seconds)}</span><small>${esc((plate.filaments || []).map(f => `${f.type || "Material"} ${f.color || ""}${finite(f.grams) ? ` · ${count(f.grams)} g` : ""}`).join(" / ") || "Filament not recorded")}</small>${plate.warnings?.length || plate.outsidePlate ? `<small class="bpf-warning">${esc(plate.outsidePlate ? "Check objects outside the plate." : plate.warnings.join(" "))}</small>` : ""}</div>`).join("") : '<p class="bpf-copy">No usable saved slice estimates. Re-slice and save this project in Bambu Studio.</p>'}</div>${economics ? `<div class="bpf-price-head"><strong>${confirmed ? "Saved planning estimate" : "Illustrative cost scenario"}</strong><span>Whole project · every saved plate once · ${currency}</span></div><div class="bpf-metrics">${metric("Project cost", money(economics.cost, currency), "Includes the cost assumptions below")}${metric("Break-even target", money(economics.breakEven, currency), "After the saved payment / sales fees")}${metric("Margin target", money(economics.marginPrice, currency), `${count(settings.costs.margin * 100)}% contribution margin`)}${metric("Printer-hour target", money(economics.hourlyPrice, currency), `${money(settings.costs.hourly, currency)} contribution / occupied hour`)}</div>${economics.perUnit ? `<div class="bpf-unit"><strong>${economics.perUnit.units} confirmed saleable units / complete project</strong><p>Per unit: cost ${money(economics.perUnit.cost, currency)} · break even ${money(economics.perUnit.breakEven, currency)} · margin target ${money(economics.perUnit.marginPrice, currency)} · printer-hour target ${money(economics.perUnit.hourlyPrice, currency)}</p></div>` : '<p class="bpf-callout">Unit pricing unlocks after you confirm the finished quantity and complete project once below.</p>'}${disclosure(`cost-${run.id}`, "Cost breakdown and capacity return", `<dl class="bpf-breakdown">${[["Filament", economics.filament], ["Energy + machine wear", economics.machine], ["Full reprint allowance", economics.failureAllowance], ["Hands-on finishing", economics.labor], ["Packing / delivery allowance", economics.packaging], ["Fixed payment / sales fee", economics.fixedFee], ["Additional nonprinted parts", economics.additionalParts]].map(([title, value]) => `<div><dt>${esc(title)}</dt><dd>${money(value, currency)}</dd></div>`).join("")}</dl><p class="bpf-copy">Filament basis: ${file.analysis?.plates?.every(p => p.materialCost) ? "exact saved inventory matches" : "generic saved rate where an exact inventory match is unavailable"}. ${confirmed ? "Shop assumptions confirmed" : "Example assumptions need your confirmation"}. No additional purge percentage is added to slicer totals.</p><p class="bpf-copy">At test project revenue ${money(settings.costs.revenue, currency)}: ${economics.contributionPerHour < 0 ? "−" : ""}${money(Math.abs(economics.contributionPerHour), currency)} contribution / expected occupied printer hour (${count(economics.expectedHours)} h including the full reprint allowance). Finishing and packing are charged once per complete project.</p>`)}` : ""}${disclosure(`model-${file.sha256}`, mapping ? "Product mapping and local price evidence" : "Confirm product yield once", modelForm(file))}<div class="bpf-actions">${button("Download archived 3MF", `data-bpf-download="${esc(run.id)}"`, false, !manage())}${snapshot.workflow ? button("Use in recipe / quote", `data-pq-from-run="${esc(file.sha256)}"`, false, !manage()) : ""}<span>Captured ${date(run.observedAt)} · ${esc(metadata.name || "3MF")}</span></div><p class="bpf-copy">${esc(actual ? `Outcome recorded from ${actual.source === "printer-telemetry" ? "paired printer status" : "your operator confirmation"}. Slice material and time remain estimates; measured actuals are kept separately.` : run.evidence === "prepared" ? "Prepared package observed. Submission, printer completion and actual consumption are not connected." : "Outcome label describes the recorded observation; slice material and time remain estimates.")} ${mapping?.rightsStatus === "unconfirmed" || !mapping ? "Commercial rights need confirmation before selling." : "Commercial rights recorded by you."} Unspecified taxes, refunds, marketing and overhead are excluded; contribution is not net profit.</p></div>`;
    return `<article class="bpf-run">${disclosure(`run-${run.id}`, name, body, "bpf-run-details").replace(`<summary>${esc(name)}</summary>`, `<summary><span class="bpf-run-title">${esc(name)}<small>${date(run.observedAt)} · ${esc(outcomeLabel)}</small></span><span class="bpf-run-fact">${economics ? `${count(economics.grams)} g · ${hours(economics.seconds)}` : "Slice estimates unavailable"}</span></summary>`)}</article>`;
  }
  function paint() {
    if (!active()) return;
    const snapshot = state.snapshot;
    const content = !snapshot ? `<div class="bpf-empty"><strong>${options.remote === false ? "Sign in to connect your print history" : state.loading ? "Checking Bambu Studio capture…" : "Print history is unavailable"}</strong><p>The saved feed belongs to Occasionally Odd. Captured projects stay here across devices.</p></div>` : (() => {
      const collector = snapshot.collector || {}, settings = snapshot.settings, summary = snapshot.summary || {};
      const outcomeIds=new Set([...(snapshot.runs || []).filter(run=>['completed','failed'].includes(run.evidence)).map(run=>run.id),...(snapshot.workflow?.actuals || []).map(row=>row.runId)]);
      const confirmedOutcomes=snapshot.workflow?outcomeIds.size:(summary.completed || 0)+(summary.failed || 0);
      const paused = settings.paused, watching = !paused && collector.connected && collector.state === "watching";
      const status = paused ? "Capture paused" : watching ? "Watching Bambu Studio" : collector.state === "missing-source" ? "Bambu source not found" : collector.state === "error" ? "Capture needs attention" : "Capture disconnected";
      return `<div class="bpf-connection"><div><span class="bpf-status ${watching ? "is-watching" : ""}"><i aria-hidden="true"></i>${esc(status)}</span><p>${esc(collector.coverage || "Prepared send packages; printer completion is not connected")}</p><small>Last scan ${date(collector.lastScanAt)} · Last capture ${date(collector.lastCaptureAt || collector.lastImportAt)}</small>${collector.unsupported > 0 ? `<p class="bpf-warning" role="status">${count(collector.unsupported, 0)} source package(s) could not be imported. Capture coverage is incomplete.</p>` : ""}${collector.scanLimited ? '<p class="bpf-warning" role="status">Discovery reached its scan limit; some source folders were not inspected.</p>' : ""}${collector.error || collector.lastErrorSafe ? `<p class="bpf-warning">${esc(collector.error || collector.lastErrorSafe)}</p>` : ""}</div><div class="bpf-actions">${button(paused ? "Resume capture" : "Pause capture", "data-bpf-toggle", false, !manage())}${button("↻ Refresh history", "data-bpf-refresh", false, state.loading)}</div></div><div class="bpf-metrics bpf-summary">${metric("Captured observations", count(summary.receipts ?? snapshot.runs.length, 0), "Prepared / submitted / outcome evidence")}${metric("Reusable 3MF files", count(summary.uniqueFiles ?? snapshot.files.length, 0), "Duplicate files share a model mapping")}${metric("Confirmed outcomes", count(confirmedOutcomes, 0), summary.knownOutcomeFailureRate == null ? "Completion is not inferred from a file" : `${count(summary.knownOutcomeFailureRate * 100)}% observed failures · sample only`)}</div><div class="bpf-basis">US / USD · local and custom orders <span>${settings.costsConfirmed ? "Saved cost assumptions" : "Cost examples are illustrative until confirmed"}</span></div>${settingsView(snapshot)}${printDecisionLabView(snapshot,{open:state.open.includes("decision-lab")})}${printQuoteWorkflowView(snapshot, state.quoteUi, manage())}${snapshot.runs.length ? `<div class="bpf-history"><div class="bpf-history-heading"><h3>Saved print projects</h3><span>Newest observations first</span></div>${snapshot.runs.slice(0, state.limit).map(run => runView(run, snapshot.files.find(file => file.sha256 === run.fileHash), snapshot)).join("")}${snapshot.runs.length > state.limit ? button(`Show ${Math.min(8, snapshot.runs.length - state.limit)} more`, "data-bpf-more") : ""}</div>` : '<div class="bpf-empty"><strong>Your next prepared Bambu job will appear here</strong><p>Use Bambu Studio normally. When it creates a supported send package, the local connection archives its 3MF and reads the saved slice estimates. Historical packages may appear during initial discovery.</p></div>'}<p class="bpf-footnote">No automatic listing, purchase or printer control. Market evidence remains unavailable until you record a legitimate comparable source. Every captured file and setting is scoped to Occasionally Odd.</p>`;
    })();
    root.innerHTML = `<section class="bpf-feed cw-panel" aria-label="Bambu Studio print intelligence" aria-busy="${state.loading || state.busy}"><div class="bpf-heading"><div><p class="cw-eyebrow">OCCASIONALLY ODD · PRINT INTELLIGENCE</p><h2>Bambu print feed</h2><p class="bpf-copy">Your captured 3MF projects, production costs and reusable pricing intelligence in one place.</p></div><span class="bpf-chip">BAMBU STUDIO</span></div>${state.error ? `<div class="bpf-error" role="alert">${esc(state.error)} ${button("Refresh history", "data-bpf-refresh")}</div>` : ""}${state.notice ? `<p class="bpf-notice" role="status">${esc(state.notice)}</p>` : ""}${content}</section>`;
    bind();
  }
  function bind() {
    bindPrintQuoteWorkflow(root, state.snapshot || {}, state.quoteUi, {canManage:manage, command:workflowCommand, repaint:paint, isDirty:()=>state.dirty, setDirty:value=>{state.dirty=value || Object.keys(state.legacyDrafts).length>0;}, onError:showFormError});
    root.querySelectorAll("[data-bpf-detail]").forEach(element => element.addEventListener("toggle", () => { const key = element.dataset.bpfDetail; state.open = state.open.filter(value => value !== key); if (element.open) state.open.push(key); state.quoteUi.open = state.open; }));
    root.querySelectorAll("form").forEach(form => {
      const attr=Array.from(form.attributes).find(attr=>/^data-bpf-(costs|model|comparable)$/.test(attr.name));
      const key=attr?attr.name+attr.value:null;
      if(key && state.legacyDrafts[key])for(const item of state.legacyDrafts[key]){const element=form.elements.namedItem(item.name);if(element){if(item.type==='checkbox')element.checked=item.checked;else element.value=item.value;}}
      form.addEventListener("input",()=>{state.dirty=true;if(key)state.legacyDrafts[key]=Array.from(form.elements).filter(element=>element.name).map(element=>({name:element.name,value:element.value,type:element.type,checked:element.checked}));});
    });
    root.querySelectorAll("[data-bpf-refresh]").forEach(button => button.addEventListener("click", () => { if (!state.dirty) void refresh(); else { state.notice = "Save your open form before refreshing; your edits are still here."; root.querySelector(".bpf-heading").insertAdjacentHTML("afterend", '<p class="bpf-notice" role="status">Save your open form before refreshing; your edits are still here.</p>'); } }));
    root.querySelector("[data-bpf-toggle]")?.addEventListener("click", () => { if (state.dirty) { showFormError(root.querySelector(".bpf-feed"), "Save your open form before changing capture; your edits are still here."); return; } void save("/settings", { paused: !state.snapshot.settings.paused }, state.snapshot.settings.paused ? "Bambu capture resumed." : "Bambu capture paused. Saved history stays available."); });
    root.querySelector("[data-bpf-more]")?.addEventListener("click", () => { if (!state.dirty) { state.limit += 8; paint(); } });
    root.querySelector("[data-bpf-costs]")?.addEventListener("submit", event => {
      event.preventDefault(); if (!manage()) return;
      const data = new FormData(event.currentTarget), costs = Object.fromEntries(Object.keys(PRINT_DEFAULTS).map(key => [key, Number(data.get(key)) / (["failure", "fee", "margin"].includes(key) ? 100 : 1)]));
      try { validatePrintCosts(costs); void save("/settings", { costs, currency: "USD", costsConfirmed: data.get("confirmed") === "on" }, "Shop assumptions saved. Future captured projects reuse them automatically."); }
      catch (error) { showFormError(event.currentTarget, error.message); }
    });
    root.querySelectorAll("[data-bpf-model]").forEach(form => form.addEventListener("submit", event => {
      event.preventDefault(); if (!manage()) return;
      const data = new FormData(form), file = state.snapshot.files.find(file => file.sha256 === form.dataset.bpfModel);
      const model = { name: String(data.get("name")).trim(), saleableUnits: Number(data.get("saleableUnits")), extraCostPerBatch: Number(data.get("extraCostPerBatch")), completeProduct: data.get("completeProduct") === "on", rightsStatus: data.get("rightsStatus"), rightsReference: String(data.get("rightsReference")).trim(), comparables: file?.mapping?.comparables || [] };
      if (model.rightsStatus === "authorized" && !model.rightsReference) { showFormError(form, "Record the commercial license reference."); return; }
      void save(`/models/${encodeURIComponent(form.dataset.bpfModel)}`, model, "Product mapping saved once for this exact 3MF. Future captures reuse it.");
    }));
    root.querySelectorAll("[data-bpf-comparable]").forEach(form => form.addEventListener("submit", event => {
      event.preventDefault(); if (!manage()) return;
      const file = state.snapshot.files.find(file => file.sha256 === form.dataset.bpfComparable); if (!file?.mapping) return;
      const data = new FormData(form); let at; try { at = new Date(`${data.get("observedAt")}T00:00:00Z`).toISOString(); } catch { showFormError(form, "Choose a valid observation date."); return; }
      if (Date.parse(at) > Date.now()) { showFormError(form, "The observation cannot be in the future."); return; }
      if (file.mapping.comparables?.length >= 20) { showFormError(form, "This project already has 20 observations. Review its evidence before adding more."); return; }
      const row = { url: String(data.get("url")).trim(), observedAt: at, currency: "USD", price: Number(data.get("price")), shipping: Number(data.get("shipping")), quantity: Number(data.get("quantity")), kind: data.get("kind"), comparable: data.get("comparable") === "on", notes: String(data.get("notes")).trim() };
      if (!/^https:\/\//i.test(row.url)) { showFormError(form, "Use a public HTTPS source URL."); return; }
      void save(`/models/${encodeURIComponent(file.sha256)}`, { ...file.mapping, comparables: [...(file.mapping.comparables || []), row] }, "Market observation saved with its source, date and evidence type.");
    }));
    root.querySelectorAll("[data-bpf-download]").forEach(button => button.addEventListener("click", () => void download(button.dataset.bpfDownload)));
  }
  function showFormError(form, message) { let error = form.querySelector("[data-bpf-form-error]"); if (!error) { error = document.createElement("p"); error.dataset.bpfFormError = ""; error.className = "bpf-error"; error.setAttribute("role", "alert"); form.append(error); } error.textContent = message; }
  async function download(id) {
    if (!manage()) return;
    const run = state.snapshot.runs.find(run => run.id === id), file = state.snapshot.files.find(file => file.sha256 === run?.fileHash); if (!run || !file) return;
    const abort = new AbortController(); requests.add(abort); const timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(`${API}/${encodeURIComponent(id)}/file`, { headers: headers(false), signal: abort.signal, cache: "no-store" });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || "The archived 3MF could not be downloaded."); }
      const blob = await response.blob(); if (!active()) return;
      if (blob.size > 128 * 1024 * 1024) throw new Error("The archive exceeds the supported 128 MB limit.");
      const bytes = await blob.arrayBuffer(), digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
      if (!active()) return;
      if (digest !== file.sha256) throw new Error("The archived model failed its integrity check. Nothing was downloaded.");
      const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = String(file.metadata.name || "print.3mf").replace(/[^a-zA-Z0-9_. -]/g, "_"); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      state.notice = "Archived 3MF verified and downloaded."; if (!state.dirty) paint();
    } catch (error) { if (active()) { state.error = error.name === "AbortError" ? "The model download timed out. Try again." : error.message; if (!state.dirty) paint(); } }
    finally { clearTimeout(timeout); requests.delete(abort); }
  }
  paint();
  if (options.remote !== false) { void refresh(Boolean(state.snapshot)); timer = setInterval(() => void refresh(true), 20000); }
  return { refresh, destroy() { disposed = true; if (timer) clearInterval(timer); requests.forEach(request => request.abort()); requests.clear(); state.loading = false; state.busy = false; } };
}
