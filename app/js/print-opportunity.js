import { PRINT_DEFAULTS, PRINT_LIMITS, inspectPrintFile, printEconomics, validatePrintCosts } from "./print-opportunity-core.js?v=phantom-live-20261027-247";
import { analyzePrintOpportunities, selectPrintFiles } from "./print-opportunity-intelligence.js?v=phantom-live-20261027-247";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = value => value == null ? "—" : value.toLocaleString(undefined, { style: "currency", currency: "USD" });
const hours = value => value == null ? "Missing" : `${(value / 3600).toFixed(2)} h`;
const plateName = row => `${row.file.name} · plate ${row.plate.index}`;
const fields = [
  ["filament", "Filament · $/kg"], ["machine", "Machine allowance · $/hour"], ["labor", "Hands-on labor · $/hour"],
  ["minutes", "Hands-on minutes / plate"], ["packaging", "Packaging · $/plate"], ["fixedFee", "Fixed fee · $/plate"],
  ["failure", "Full-attempt failure rate · %", true], ["fee", "Sales fees · %", true], ["margin", "Target margin · %", true],
  ["hourly", "Target contribution · $/printer-hour"], ["revenue", "Comparison revenue · $/plate"],
];

export function createPrintOpportunityState(businessId) {
  return { businessId, costs: { ...PRINT_DEFAULTS }, costsSource: "example", costsChanged: false, costDraft: null, costDraftChanged: false, files: [], busy: false, message: "", error: "", generation: 0 };
}

/** Local analysis state belongs to one mounted organization and is never uploaded. */
export function renderPrintOpportunities(root, { businessId, businessContext = null, isActive = () => true, state = createPrintOpportunityState(businessId) } = {}) {
  if (state.businessId !== businessId) throw new Error("Print analysis belongs to a different business.");
  let disposed = false, rendered = false, context = businessContext;
  const active = () => !disposed && isActive();
  const storageKey = `phantomforce:print-costs:v1:${businessId}`;
  const analysis = () => analyzePrintOpportunities(state.files, { businessId, businessContext: context, costs: state.costs, costsSource: state.costsSource });
  const scenarioLabel = () => state.costsSource === "saved" ? "Saved shop assumptions · USD" : state.costsSource === "custom" ? "Your planning assumptions · USD" : "Optional example assumptions · USD";
  const displayedCost = (key, percent) => percent ? String(Number((state.costs[key] * 100).toFixed(8))) : String(state.costs[key]);
  const hasCurrentWork = () => state.busy || state.files.length || state.costsChanged || state.costDraftChanged;

  function captureCostDraft() {
    if (!rendered) return;
    const form = root.querySelector("[data-po-costs]");
    if (!form?.elements?.namedItem) return;
    const draft = Object.fromEntries(fields.map(([key, , percent]) => [key, String(form.elements.namedItem(key)?.value ?? displayedCost(key, percent))]));
    state.costDraftChanged = fields.some(([key, , percent]) => draft[key] !== displayedCost(key, percent));
    state.costDraft = state.costDraftChanged ? draft : null;
  }

  function syncCostDraft() {
    if (!active()) return;
    captureCostDraft();
    root.querySelector(".po-panel")?.toggleAttribute("data-preserve-workspace", Boolean(hasCurrentWork()));
    const notice = root.querySelector("[data-po-cost-draft]");
    if (notice) notice.textContent = state.costDraftChanged ? "Unapplied edits are preserved. Automatic findings still use the last applied scenario." : "";
  }

  function evidence(result) {
    const duplicateByFile = new Map(result.duplicates.map(item => [item.file, item.original]));
    return `<details class="po-details"><summary>Source evidence and file issues</summary>${state.files.map(file => {
      const duplicate = duplicateByFile.get(file);
      const issues = [file.error, duplicate ? `Identical to ${duplicate}; counted once.` : file.issue, ...(file.issues || [])];
      if (file.presetCosts?.length) issues.push(`Imported filament-price values: ${file.presetCosts.join(", ")}. Currency and purchase costs are unverified; these values are excluded from calculations.`);
      for (const plate of file.plates || []) if (plate.warnings?.length) issues.push(`Plate ${plate.index}: ${plate.warnings.join(", ")}. Review in your current slicer.`);
      return `<details class="po-file"><summary>${esc(file.name)}${duplicate ? " · duplicate" : file.error ? " · could not read" : !file.plates?.length ? " · needs slicing" : ` · ${file.plates.length} saved plate(s)`}</summary><p>Saved printer: ${esc(file.printer || "Not recorded")}${file.nozzle ? ` · ${esc(file.nozzle)} mm nozzle` : ""}</p>${file.sliceProfile ? `<p>Slice profile: ${esc(file.sliceProfile)}</p>` : ""}${(file.filamentProfiles || []).length ? `<p>Material profiles: ${esc(file.filamentProfiles.map(item => item.profile || [item.vendor, item.type, item.color].filter(Boolean).join(" ")).join("; "))}</p>` : ""}${issues.filter(Boolean).map(issue => `<p>${esc(issue)}</p>`).join("")}${file.sha256 ? `<small>SHA-256: ${esc(file.sha256)}</small>` : ""}</details>`;
    }).join("")}</details>`;
  }

  function results() {
    if (!state.files.length) return '<div class="po-empty"><strong>Choose projects or a folder. The analysis starts automatically.</strong><p>Get the fastest saved slices, material requirements, duplicate detection, slicing warnings and a useful next step. No cost form is required.</p></div>';
    const result = analysis(), c = result.counts;
    const insight = row => `<strong>${esc(plateName(row))}</strong><p>${hours(row.plate.seconds)} · ${row.plate.grams.toFixed(2)} g · ${row.plate.objectCount} part(s), saleable quantity unverified</p>`;
    const sameWinner = result.fastest && result.fastest === result.lightest;
    const hasMaterialCosts = result.rows.some(row => row.materialCost);
    return `<section class="po-brief" aria-label="Automatic print brief"><h3>Here’s what your files reveal</h3><span class="cw-badge">Source: saved 3MF metadata</span><div class="cw-metrics po-metrics"><div class="cw-metric"><span>Usable saved estimates</span><strong>${c.ready}</strong><small>Whole plates, not product quantities</small></div><div class="cw-metric"><span>Needs slicing</span><strong>${c.needsSlice}</strong><small>${c.unreadable} unreadable file(s)</small></div><div class="cw-metric"><span>Duplicates excluded</span><strong>${c.duplicates}</strong><small>Identical file hashes count once</small></div></div>
      <div class="po-insights">${result.fastest ? `<article class="po-insight"><h4>${sameWinner ? "Fastest and lightest saved plate" : "Fastest saved plate"}</h4>${insight(result.fastest)}</article>` : ""}${result.lightest && !sameWinner ? `<article class="po-insight"><h4>Least material in a saved plate</h4>${insight(result.lightest)}</article>` : ""}</div>
      <div class="cw-inline-note po-next-action"><strong>Next useful step</strong><p>${esc(result.nextAction)}</p></div>
      ${result.printerTargets.length ? `<p class="cw-muted">Saved printer targets: ${esc(result.printerTargets.join(" · "))}. Current printer compatibility is unconfirmed.</p>` : ""}
      ${result.rows.length ? `<p class="cw-muted">Sorted by saved print time. Historical slicer estimates describe production effort; they do not establish sales demand or a profitable selling price.</p><div class="cw-table-scroll" role="region" tabindex="0" aria-label="Automatic print comparison"><table class="cw-table"><thead><tr>${["Project / plate", "Saved print time", "Filament", "Material requirements", ...(hasMaterialCosts ? ["Recorded filament cost"] : []), "Next check"].map(title => `<th scope="col">${title}</th>`).join("")}</tr></thead><tbody>${result.rows.map(row => `<tr><td><strong>${esc(row.file.name)}</strong><small>Plate ${esc(row.plate.index)} · ${row.plate.objectCount} part(s), product quantity unverified</small></td><td>${hours(row.plate.seconds)}</td><td>${row.plate.grams == null ? "Missing" : `${row.plate.grams.toFixed(2)} g`}</td><td>${esc(row.requirements.join("; ") || "Not recorded")}</td>${hasMaterialCosts ? `<td>${row.materialCost ? money(row.materialCost.amount) : "No exact saved-material match"}<small>Source: saved business inventory · material only</small></td>` : ""}<td>${!row.ready ? "Re-slice and save estimates" : row.plate.outsidePlate ? "Check objects outside plate" : row.plate.warnings?.length ? "Review saved slicer warning" : row.printerMatch ? `Saved printer matched: ${esc(row.printerMatch)}` : "Confirm intended printer"}</td></tr>`).join("")}</tbody></table></div>` : '<div class="po-empty">No usable saved slice metadata was found. Re-slice for your intended printer and save the project; geometry alone cannot supply trustworthy time or material estimates.</div>'}
      ${!hasMaterialCosts ? '<p class="cw-muted">Actual material cost is not established. Imported preset prices have unknown currency. Saved device assumptions, if present, are reused in the optional scenario below.</p>' : '<p class="cw-muted">Recorded filament costs use exact material names/profiles and recorded g/kg unit costs from this business only. They are partial cost estimates, not complete quotes.</p>'}
      </section>${evidence(result)}`;
  }

  function scenarioResults() {
    const result = analysis();
    if (!result.rows.length) return "";
    return `<p class="cw-muted">${esc(scenarioLabel())}. Comparison revenue is ${money(state.costs.revenue)} for each whole plate. ${state.costsSource === "example" ? "These example amounts are not your actual costs and are not a recommended quote." : "Saved or entered assumptions are planning inputs, not verified purchases or settled profit."}</p><div class="cw-table-scroll" role="region" tabindex="0" aria-label="Optional print pricing scenario"><table class="cw-table"><thead><tr>${["File / plate", "Break-even", "Margin target", "Hourly target", "Contribution / hour"].map(title => `<th scope="col">${title}</th>`).join("")}</tr></thead><tbody>${result.rows.map(row => `<tr><td>${esc(plateName(row))}</td><td>${money(row.estimate?.breakEven)}</td><td>${money(row.estimate?.marginPrice)}</td><td>${money(row.estimate?.hourlyPrice)}</td><td>${money(row.estimate?.contributionPerHour)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function paintResults() {
    if (!active()) return;
    const result = root.querySelector("[data-po-results]"); if (result) result.innerHTML = results();
    const scenario = root.querySelector("[data-po-scenario-results]"); if (scenario) scenario.innerHTML = scenarioResults();
  }

  function paint(preserveDraft = true) {
    if (!active()) return;
    if (preserveDraft) captureCostDraft();
    else { state.costDraft = null; state.costDraftChanged = false; }
    const oldDetails = root.querySelector("[data-po-cost-details]"); if (oldDetails) state.costDetailsOpen = oldDetails.open;
    root.innerHTML = `<section class="cw-panel po-panel" ${hasCurrentWork() ? "data-preserve-workspace" : ""} aria-label="Print opportunities"><div class="cw-panel-heading"><div><h2>Print opportunities</h2><p class="cw-muted">Drop your slicer projects. Get an automatic production brief before entering any costs.</p></div><span class="cw-badge">On-device analysis</span></div>
      <label class="po-drop"><strong>${state.busy ? "Reading your projects…" : "Choose or drop 3MF projects"}</strong><span>Files stay in this browser. Up to 20 projects, 128 MB each.</span><input type="file" accept=".3mf" multiple aria-label="Choose 3MF projects" data-po-files ${state.busy ? "disabled" : ""}></label>
      <div class="po-actions"><label class="cw-button po-folder">Choose a folder<input type="file" webkitdirectory directory multiple data-po-folder aria-label="Choose a local folder of 3MF projects" ${state.busy ? "disabled" : ""}></label><span class="cw-muted">Folder scan reads 3MF files only; nothing is uploaded.</span></div>
      <div role="alert" class="cw-error" data-po-error ${state.error ? "" : "hidden"}>${esc(state.error)}</div><p role="status" class="cw-muted" data-po-status>${esc(state.message)}</p>
      <div data-po-results>${results()}</div>
      <details class="po-details" data-po-cost-details ${state.costDetailsOpen ? "open" : ""}><summary>${esc(scenarioLabel())} · optional</summary><p class="cw-muted">Automatic analysis works without these fields. ${state.costsSource === "saved" ? "Your saved business assumptions were loaded automatically." : "Example values are only a what-if scenario; replace them only when you want a more specific quote."} All amounts apply to an entire plate.</p><form data-po-costs><div class="po-fields">${fields.map(([key, title, percent]) => `<label class="cw-field"><span>${title}</span><input name="${key}" type="number" min="0" ${percent ? 'max="99.99"' : ""} step="any" required value="${esc(state.costDraft?.[key] ?? displayedCost(key, percent))}"></label>`).join("")}</div><p class="cw-muted" data-po-cost-draft>${state.costDraftChanged ? "Unapplied edits are preserved. Automatic findings still use the last applied scenario." : ""}</p><div class="po-actions"><button class="cw-button cw-button-primary" type="submit" ${state.busy ? "disabled" : ""}>Apply optional scenario</button><button class="cw-button" type="button" data-po-save ${state.busy ? "disabled" : ""}>Remember these shop assumptions</button></div></form><div data-po-scenario-results>${scenarioResults()}</div></details>
      <div class="po-actions"><button class="cw-button" type="button" data-po-export ${state.files.length && !state.busy ? "" : "disabled"}>Download analysis</button><button class="cw-button" type="button" data-po-clear ${state.files.length && !state.busy ? "" : "disabled"}>Clear selected files</button></div>
      <details class="po-details"><summary>Evidence and calculation boundaries</summary><p>Selected files and analysis clear when you leave this workspace. Export anything you want to keep. Saved cost assumptions belong only to this business on this device. A part count is not a saleable product count; every required plate and assembly step must be included for a complete product.</p><p>Break-even covers the listed scenario costs after fees. Margin and hourly targets are separate planning thresholds. Failed attempts are modeled as full reprints; finishing labor and packing are charged once after success. Imported preset prices are excluded. Shipping, tax, marketing, licensing and other unlisted overhead remain outside the scenario. Contribution is not net business profit.</p><p>File possession does not establish commercial rights. Historical estimates may target a different printer. No slicing, printing, listing, sending or purchasing is performed.</p></details></section>`;
    rendered = true;
    bind();
  }

  function readCosts() {
    syncCostDraft();
    const form = root.querySelector("[data-po-costs]"), data = new FormData(form), costs = {};
    for (const [key, , percent] of fields) {
      const raw = data.get(key);
      costs[key] = raw === null || String(raw).trim() === "" ? null : Number(raw) / (percent ? 100 : 1);
    }
    validatePrintCosts(costs);
    state.costsChanged ||= Object.keys(costs).some(key => costs[key] !== state.costs[key]);
    state.costs = costs; state.costsSource = "custom";
  }

  function showError(error) {
    state.error = error.message || "This analysis could not complete.";
    const el = root.querySelector("[data-po-error]"); if (el) { el.textContent = state.error; el.hidden = false; }
  }

  async function selectFiles(list) {
    if (!active() || state.busy) return;
    const selection = selectPrintFiles(list, PRINT_LIMITS.files);
    if (!selection.files.length) { showError(new Error("No 3MF projects were selected. Choose projects or a folder containing .3mf files.")); return; }
    const generation = ++state.generation;
    state.busy = true; state.error = ""; state.files = []; state.message = "Reading files locally and building your brief…"; paint();
    const inspected = [];
    for (const file of selection.files) {
      try { inspected.push(await inspectPrintFile(file)); }
      catch (error) { inspected.push({ name: file.name, plates: [], error: error.message }); }
      if (!active() || generation !== state.generation) return;
    }
    state.files = inspected; state.busy = false;
    state.message = `Read ${selection.files.length} 3MF project(s) locally.${selection.truncated ? ` Analyzed the first ${PRINT_LIMITS.files} of ${selection.totalProjects} projects; ${selection.truncated} were not read. Choose a smaller folder to include them.` : ""}${selection.ignored ? ` Ignored ${selection.ignored} other file(s).` : ""} No data was uploaded or added to orders.`;
    paint();
  }

  function bind() {
    const input = root.querySelector("[data-po-files]");
    input?.addEventListener("change", () => { void selectFiles(input.files); });
    const folder = root.querySelector("[data-po-folder]");
    folder?.addEventListener("change", () => { void selectFiles(folder.files); });
    const drop = root.querySelector(".po-drop");
    drop?.addEventListener("dragover", event => { event.preventDefault(); });
    drop?.addEventListener("drop", event => { event.preventDefault(); void selectFiles(event.dataTransfer?.files || []); });
    root.querySelector("[data-po-costs]")?.addEventListener("input", syncCostDraft);
    root.querySelector("[data-po-costs]")?.addEventListener("change", syncCostDraft);
    root.querySelector("[data-po-costs]")?.addEventListener("submit", event => {
      event.preventDefault(); if (!active() || state.busy) return;
      try { readCosts(); state.error = ""; state.message = "Optional scenario updated. Automatic file findings are unchanged."; paint(false); } catch (error) { showError(error); }
    });
    root.querySelector("[data-po-save]")?.addEventListener("click", () => {
      if (!active() || state.busy) return;
      try { readCosts(); localStorage.setItem(storageKey, JSON.stringify(state.costs)); state.costsChanged = false; state.costsSource = "saved"; state.error = ""; state.message = "Shop assumptions saved for this business on this device."; paint(false); } catch (error) { showError(error); }
    });
    root.querySelector("[data-po-clear]")?.addEventListener("click", () => { if (active() && !state.busy) { state.files = []; state.error = ""; state.message = "Selected files cleared from this workspace."; paint(); } });
    root.querySelector("[data-po-export]")?.addEventListener("click", () => {
      if (!active() || state.busy || !state.files.length) return;
      try {
        const blob = new Blob([JSON.stringify({ version: 2, businessId, createdAt: new Date().toISOString(), scope: "Saved slice evidence and whole-plate planning scenario; commercial rights, actual purchases and demand unverified", costsSource: state.costsSource, costs: state.costs, files: state.files, analysis: analysis() }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = "print-opportunity-analysis.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { showError(error); }
    });
  }

  if (!state.initialized) {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "null"); if (saved) { validatePrintCosts(saved); state.costs = Object.fromEntries(Object.keys(PRINT_DEFAULTS).map(key => [key, Number(saved[key])])); state.costsSource = "saved"; } } catch { /* Invalid optional preferences do not block automatic analysis. */ }
    state.initialized = true;
  }
  paint();
  return {
    updateBusinessContext(next) {
      if (!active() || (next?.state?.tenantId || next?.tenantId) !== businessId) return false;
      context = next; paintResults(); return true;
    },
    destroy() { disposed = true; state.generation++; state.busy = false; },
  };
}
