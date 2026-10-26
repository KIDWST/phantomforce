import { PRINT_DEFAULTS, PRINT_LIMITS, inspectPrintFile, printEconomics, validatePrintCosts } from "./print-opportunity-core.js?v=phantom-live-20261026-239";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = value => value == null ? "—" : value.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fields = [
  ["filament", "Filament · $/kg"], ["machine", "Machine allowance · $/hour"], ["labor", "Hands-on labor · $/hour"],
  ["minutes", "Hands-on minutes / plate"], ["packaging", "Packaging · $/plate"], ["fixedFee", "Fixed fee · $/plate"],
  ["failure", "Full-attempt failure rate · %", true], ["fee", "Sales fees · %", true], ["margin", "Target margin · %", true],
  ["hourly", "Target contribution · $/printer-hour"], ["revenue", "Comparison revenue · $/plate"],
];

export function createPrintOpportunityState(businessId) {
  return { businessId, costs: { ...PRINT_DEFAULTS }, files: [], busy: false, message: "", error: "", generation: 0 };
}

/** Local analysis state belongs to one mounted organization and is never uploaded. */
export function renderPrintOpportunities(root, { businessId, isActive = () => true, state = createPrintOpportunityState(businessId) } = {}) {
  if (state.businessId !== businessId) throw new Error("Print analysis belongs to a different business.");
  let disposed = false;
  const active = () => !disposed && isActive();
  const storageKey = `phantomforce:print-costs:v1:${businessId}`;

  function rows() {
    const seen = new Set(), result = [];
    for (const file of state.files) {
      if (!file.sha256 || seen.has(file.sha256)) continue;
      seen.add(file.sha256);
      for (const plate of file.plates || []) result.push({ file, plate, estimate: printEconomics(plate.grams, plate.seconds, state.costs) });
    }
    return result.sort((a, b) => (b.estimate?.contributionPerHour ?? -Infinity) - (a.estimate?.contributionPerHour ?? -Infinity));
  }

  function results() {
    if (!state.files.length) return '<div class="po-empty">Choose saved 3MF projects to compare whole-plate revenue thresholds. No demo products or sales are added.</div>';
    const result = rows(), seen = new Map();
    const notices = state.files.map(file => {
      const duplicate = file.sha256 && seen.get(file.sha256);
      if (file.sha256 && !duplicate) seen.set(file.sha256, file.name);
      const issues = [file.error, duplicate ? `Identical to ${duplicate}; counted once.` : file.issue];
      if (file.presetCosts?.length) issues.push(`Stored filament-cost values: ${file.presetCosts.join(", ")}. Currency is unverified; these values are excluded from calculations.`);
      for (const plate of file.plates || []) if (plate.warnings.length) issues.push(`Plate ${plate.index}: ${plate.warnings.join(", ")}. Recheck in your current slicer.`);
      return `<details class="po-file"><summary>${esc(file.name)}${duplicate ? " · duplicate" : file.error ? " · could not read" : !file.plates?.length ? " · needs slicing" : ` · ${file.plates.length} plate(s)`}</summary><p>Printer preset: ${esc(file.printer || "Not recorded")}</p>${issues.filter(Boolean).map(issue => `<p>${esc(issue)}</p>`).join("")}${file.sha256 ? `<small>SHA-256: ${esc(file.sha256)}</small>` : ""}</details>`;
    }).join("");
    return `<p class="cw-muted">${result.length} unique saved plate estimate(s). Comparison revenue is ${money(state.costs.revenue)} for each whole plate; this is a scenario, not a sales forecast.</p>${result.length ? `<div class="cw-table-scroll" role="region" tabindex="0" aria-label="Print opportunity results"><table class="cw-table"><thead><tr>${["File / plate", "Material", "Print time", "Break-even", "Margin target", "Hourly target", "Contribution / hour"].map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${result.map(({ file, plate, estimate: e }) => `<tr><td><strong>${esc(file.name)}</strong><small>Plate ${esc(plate.index)} · ${plate.objectCount} part(s), product quantity unverified</small></td><td>${plate.grams == null ? "Missing" : `${plate.grams.toFixed(2)} g`}</td><td>${plate.seconds == null ? "Missing" : `${(plate.seconds / 3600).toFixed(2)} h`}</td><td>${money(e?.breakEven)}</td><td>${money(e?.marginPrice)}</td><td>${money(e?.hourlyPrice)}</td><td>${money(e?.contributionPerHour)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="po-empty">These projects do not contain saved slice estimates. Save a freshly sliced project from your intended printer to calculate thresholds.</div>'}<details class="po-details"><summary>File evidence and slicing issues</summary>${notices}</details>`;
  }

  function paint() {
    if (!active()) return;
    root.innerHTML = `<section class="cw-panel po-panel" aria-label="Print opportunities"><div class="cw-panel-heading"><div><h2>Print opportunities</h2><p class="cw-muted">Turn saved slicer estimates into better quotes and printer-hour decisions.</p></div><span class="cw-badge">Local file analysis</span></div>
      <label class="po-drop"><strong>${state.busy ? "Reading your projects…" : "Choose or drop 3MF projects"}</strong><span>Files stay in this browser. Up to 20 files, 128 MB each.</span><input type="file" accept=".3mf" multiple aria-label="Choose 3MF projects" data-po-files ${state.busy ? "disabled" : ""}></label>
      <details class="po-details" open><summary>Cost assumptions · USD scenario</summary><p class="cw-muted">Example values are prefilled. Replace them with your costs before quoting. All amounts apply to an entire plate.</p><form data-po-costs><div class="po-fields">${fields.map(([key, label, percent]) => `<label class="cw-field"><span>${label}</span><input name="${key}" type="number" min="0" ${percent ? 'max="99.99"' : ""} step="any" required value="${esc(percent ? Number((state.costs[key] * 100).toFixed(8)) : state.costs[key])}"></label>`).join("")}</div><div class="po-actions"><button class="cw-button cw-button-primary" type="submit" ${state.busy ? "disabled" : ""}>Recalculate</button><button class="cw-button" type="button" data-po-save ${state.busy ? "disabled" : ""}>Save cost assumptions on this device</button></div></form></details>
      <div role="alert" class="cw-error" data-po-error ${state.error ? "" : "hidden"}>${esc(state.error)}</div><p role="status" class="cw-muted" data-po-status>${esc(state.message)}</p>
      <div data-po-results>${results()}</div><div class="po-actions"><button class="cw-button" type="button" data-po-export ${state.files.length && !state.busy ? "" : "disabled"}>Download analysis</button><button class="cw-button" type="button" data-po-clear ${state.files.length && !state.busy ? "" : "disabled"}>Clear selected files</button></div>
      <details class="po-details"><summary>How to use these numbers</summary><p>Break-even covers the listed costs after sales fees. Margin target also reserves your selected share of revenue. Hourly target reserves your chosen contribution per expected occupied printer-hour. Rows rank by contribution per hour at the comparison revenue.</p><p>Failed attempts are modeled as full reprints. Hands-on labor and packing are charged once after success. A part count is not a saleable product count; include every required plate and assembly step for a complete product.</p><p>Imported filament prices are never treated as your purchase costs. Historical slices may target a different printer. File possession does not establish commercial rights. Shipping, tax, marketing, licensing and other unlisted overhead remain outside this scenario. Contribution is not net business profit.</p><p>Selected files and analysis clear when you leave this workspace. Export anything you want to keep. Saved cost assumptions belong only to this business on this device.</p></details></section>`;
    bind();
  }

  function readCosts() {
    const form = root.querySelector("[data-po-costs]"), data = new FormData(form), costs = {};
    for (const [key, , percent] of fields) {
      const raw = data.get(key);
      costs[key] = raw === null || String(raw).trim() === "" ? null : Number(raw) / (percent ? 100 : 1);
    }
    validatePrintCosts(costs);
    state.costs = costs;
  }

  function showError(error) {
    state.error = error.message || "This analysis could not complete.";
    const el = root.querySelector("[data-po-error]"); if (el) { el.textContent = state.error; el.hidden = false; }
  }

  async function selectFiles(list) {
    if (!active() || state.busy) return;
    const files = [...list];
    if (!files.length) return;
    if (files.length > PRINT_LIMITS.files) { showError(new Error("Choose at most 20 files at a time.")); return; }
    try { readCosts(); } catch (error) { showError(error); return; }
    const generation = ++state.generation;
    state.busy = true; state.error = ""; state.files = []; state.message = "Reading files locally…"; paint();
    const inspected = [];
    for (const file of files) {
      try { inspected.push(await inspectPrintFile(file)); }
      catch (error) { inspected.push({ name: file.name, plates: [], error: error.message }); }
      if (!active() || generation !== state.generation) return;
    }
    state.files = inspected; state.busy = false; state.message = `Read ${files.length} file(s). No data was uploaded or added to orders.`; paint();
  }

  function bind() {
    const input = root.querySelector("[data-po-files]");
    input?.addEventListener("change", () => { void selectFiles(input.files); });
    const drop = root.querySelector(".po-drop");
    drop?.addEventListener("dragover", event => { event.preventDefault(); });
    drop?.addEventListener("drop", event => { event.preventDefault(); void selectFiles(event.dataTransfer?.files || []); });
    root.querySelector("[data-po-costs]")?.addEventListener("submit", event => {
      event.preventDefault(); if (!active() || state.busy) return;
      try { readCosts(); state.error = ""; state.message = "Recalculated from your current assumptions."; paint(); } catch (error) { showError(error); }
    });
    root.querySelector("[data-po-save]")?.addEventListener("click", () => {
      if (!active() || state.busy) return;
      try { readCosts(); localStorage.setItem(storageKey, JSON.stringify(state.costs)); state.error = ""; state.message = "Cost assumptions saved for this business on this device."; paint(); } catch (error) { showError(error); }
    });
    root.querySelector("[data-po-clear]")?.addEventListener("click", () => { if (active() && !state.busy) { state.files = []; state.error = ""; state.message = "Selected files cleared from this workspace."; paint(); } });
    root.querySelector("[data-po-export]")?.addEventListener("click", () => {
      if (!active() || state.busy || !state.files.length) return;
      try {
        readCosts();
        const blob = new Blob([JSON.stringify({ version: 1, businessId, createdAt: new Date().toISOString(), scope: "Whole-plate scenario; commercial rights and actual costs unverified", costs: state.costs, files: state.files, rows: rows() }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = "print-opportunity-analysis.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { showError(error); }
    });
  }

  if (!state.initialized) {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "null"); if (saved) { validatePrintCosts(saved); state.costs = Object.fromEntries(Object.keys(PRINT_DEFAULTS).map(k => [k, Number(saved[k])])); } } catch { /* Invalid optional preferences do not block the scanner. */ }
    state.initialized = true;
  }
  paint();
  return { destroy() { disposed = true; state.generation++; state.busy = false; } };
}
