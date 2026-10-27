import { buildPrintDecisionLab } from "./print-decision-lab-core.js?v=phantom-live-20261027-247";

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const finite = value => typeof value === "number" && Number.isFinite(value);
const number = (value, digits = 2) => finite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "Unknown";
const money = (value, currency) => {
  if (!finite(value)) return "Unknown";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); }
  catch { return `${number(value)} ${String(currency || "USD")}`; }
};
const duration = value => {
  if (!finite(value) || value < 0) return "Unknown";
  const seconds = Math.round(value), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", remainder || !seconds ? `${remainder}s` : ""].filter(Boolean).join(" ");
};
const date = value => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Capture time unavailable";
};
const warnings = values => Array.isArray(values) && values.length ? `<ul class="pdl-warnings">${values.slice(0, 8).map(value => `<li>${esc(value)}</li>`).join("")}</ul>` : "";
const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
const sign = value => value < 0 ? "−" : "+";

function leverageView(lab) {
  const leverage = lab.leverage || {}, capacity = leverage.capacity || {};
  const tile = (label, value, explanation) => `<div class="pdl-leverage-item"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(explanation)}</p></div>`;
  const printing = finite(leverage.cashExtraGramsPerPrinterHour) ? `${number(leverage.cashExtraGramsPerPrinterHour)} g extra PLA` : "Needs saved rates";
  const finishing = finite(leverage.extraGramsPerFinishingMinute) ? `${number(leverage.extraGramsPerFinishingMinute)} g extra PLA` : "Needs saved rates";
  const balance = finite(capacity.finishingMinutesPerPrinterHour) ? `${number(capacity.finishingMinutesPerPrinterHour)} min / printer-hour` : "Capacity incomplete";
  const balanceCopy = finite(capacity.printerHoursPerDay) && finite(capacity.finishingMinutesPerDay)
    ? `${number(capacity.printerHoursPerDay)} configured printer-hours and ${number(capacity.finishingMinutesPerDay)} hands-on minutes per day. A higher finishing ratio can make your time the limit; compatible machines are checked per recipe.`
    : "Saved printer and hands-on capacity reveal whether your time or the printers will limit a product.";
  const target = finite(leverage.targetExtraGramsPerPrinterHour) ? `<p class="pdl-note">Including your printer-hour return target, one saved printer-hour allows ${esc(number(leverage.targetExtraGramsPerPrinterHour))} g extra PLA in that pricing scenario. Released capacity earns more only when paid work uses it.</p>` : "";
  return `<section class="pdl-leverage" aria-label="The value of your time"><div class="pdl-section-heading"><h3>Where your time has leverage</h3><span>${lab.assumptionsConfirmed ? "Saved planning assumptions" : "Illustrative assumptions"}</span></div><div class="pdl-leverage-grid">${tile("Save 1 finishing minute", finishing, "Extra material that uses the same allowance as the hands-on time saved.")}${tile("Save 1 printer-hour", printing, "Extra material covered by the machine-hour cost allowance alone.")}${tile("Your daily balance", balance, balanceCopy)}</div><p class="pdl-note">${esc(money(leverage.filamentUsdPerKg, lab.currency))}/kg PLA · ${esc(money(leverage.machineUsdPerHour, lab.currency))}/printer-hour · ${esc(money(leverage.laborUsdPerHour, lab.currency))}/hands-on hour${finite(leverage.failureFraction) ? ` · ${esc(number(leverage.failureFraction * 100))}% failed-print allowance` : ""}. These tradeoffs change one resource at a time at the saved generic rates; other costs, output and failure risk stay equal. Extra material includes the reprint allowance, while finishing happens once. Check quality and actual usage before adopting a change.</p>${target}</section>`;
}

function variantView(variant, index, currency) {
  const parts = finite(variant.parts) ? `${number(variant.parts, 0)} parts · ${number(variant.plateCount, 0)} ${variant.plateCount === 1 ? "plate" : "plates"}` : `${number(variant.plateCount, 0)} plates · parts unknown`;
  return `<article class="pdl-variant"><header><span class="pdl-version">Version ${index + 1}</span><strong>${esc(variant.label || "Saved 3MF")}</strong><p>${esc(variant.printer || "Printer profile unavailable")}</p></header><dl class="pdl-facts">${fact("Filament", finite(variant.grams) ? `${number(variant.grams)} g` : "Unknown")}${fact("Saved print time", duration(variant.seconds))}${fact("Composition", parts)}${fact("Print cost", money(variant.productionCost, currency))}</dl><p class="pdl-source">${variant.filename ? `${esc(variant.filename)}<br>` : ""}${esc(date(variant.capturedAt))} · source ${esc(String(variant.hash || "").slice(0, 8) || "unavailable")}</p></article>`;
}

function comparisonView(comparison, group, currency) {
  const source = group.variants.findIndex(variant => variant.hash === comparison.fromHash), target = group.variants.findIndex(variant => variant.hash === comparison.toHash);
  const deltas = [];
  if (finite(comparison.gramsDelta)) deltas.push(comparison.gramsDelta === 0 ? "Same filament mass" : `${sign(comparison.gramsDelta)}${number(Math.abs(comparison.gramsDelta))} g filament`);
  if (finite(comparison.secondsDelta)) deltas.push(comparison.secondsDelta === 0 ? "Same saved print time" : `${sign(comparison.secondsDelta)}${duration(Math.abs(comparison.secondsDelta))} printing`);
  if (finite(comparison.productionCostDelta)) deltas.push(comparison.productionCostDelta === 0 ? "Same print cost" : `${sign(comparison.productionCostDelta)}${money(Math.abs(comparison.productionCostDelta), currency)} print cost`);
  const threshold = finite(comparison.conditionalCostPerHourSaved) ? `<p class="pdl-note">${group.equivalenceConfirmed && !comparison.warnings?.length ? "Extra print cost per printer-hour freed" : "If the finished output is equivalent, extra print cost per printer-hour freed"}: <strong>${esc(money(comparison.conditionalCostPerHourSaved, currency))}</strong>.</p>` : "";
  const groupWarnings = new Set(group.warnings || []), specificWarnings = (comparison.warnings || []).filter(warning => !groupWarnings.has(warning));
  return `<article class="pdl-comparison"><h4>Version ${source >= 0 ? source + 1 : "?"} → Version ${target >= 0 ? target + 1 : "?"}</h4>${deltas.length ? `<ul class="pdl-deltas" aria-label="Changes in the later version">${deltas.map(delta => `<li>${esc(delta)}</li>`).join("")}</ul>` : '<p class="pdl-note">Saved estimates are incomplete; a cost or time change cannot be calculated yet.</p>'}<p class="pdl-decision">${esc(comparison.decision || "Review the saved differences before changing production.")}</p>${threshold}${warnings(specificWarnings)}</article>`;
}

function groupView(group, currency) {
  const variants = Array.isArray(group.variants) ? group.variants : [], start = Math.max(0, variants.length - 6), visible = variants.slice(start), shown = new Set(visible.map(variant => variant.hash));
  const comparisons = (group.comparisons || []).filter(comparison => shown.has(comparison.fromHash) && shown.has(comparison.toHash)).slice(-5);
  return `<section class="pdl-group" data-pdl-group="${esc(group.id)}"><div class="pdl-section-heading"><h3>${esc(group.name || "Related saved versions")}</h3><span class="pdl-relation ${group.equivalenceConfirmed ? "is-confirmed" : "is-candidate"}">${esc(group.relationLabel || (group.relation === "recipe" ? "Linked recipe" : "Possible title match"))}</span></div>${group.relation === "title-candidate" ? '<p class="pdl-note">A shared title suggests a comparison. Finished output, scale and quality still need to match before one version can replace another.</p>' : ""}${warnings(group.warnings)}<div class="pdl-variants">${visible.map((variant, index) => variantView(variant, index + start, currency)).join("")}</div>${comparisons.length ? `<div class="pdl-comparisons">${comparisons.map(comparison => comparisonView(comparison, group, currency)).join("")}</div>` : ""}${group.recommendation ? `<p class="pdl-readout">${esc(group.recommendation)}</p>` : ""}${group.truncated || (group.totalVariants || variants.length) > visible.length ? `<p class="pdl-note">Showing ${visible.length} representative saved versions from ${esc(number(group.totalVariants || variants.length, 0))}. Every original stays in print history.</p>` : ""}</section>`;
}

function capacityView(rows) {
  if (!rows.length) return '<p class="pdl-note">Reusable product recipes will add product-level capacity limits here automatically.</p>';
  const labels = { printer: "Printing", finishing: "Your finishing time", balanced: "Both, about evenly", unknown: "Needs more evidence" };
  return `<section class="pdl-capacity"><div class="pdl-section-heading"><h3>What limits each product</h3><span>Theoretical daily ceilings</span></div><div class="pdl-capacity-list">${rows.slice(0, 8).map(row => `<article class="pdl-capacity-row"><div><strong>${esc(row.name || "Product recipe")}</strong><p>${esc((row.compatiblePrinters || []).join(" · ") || "Compatible printer not established")}</p></div><dl class="pdl-facts">${fact("One full batch", finite(row.printerHoursPerBatch) ? `${number(row.printerHoursPerBatch)} printer-hours` : "Unknown")}${fact("Finishing / batch", finite(row.finishingMinutesPerBatch) ? `${number(row.finishingMinutesPerBatch)} min` : "Unknown")}${fact("Daily unit ceiling", finite(row.nominalUnitsPerDay) ? `${number(row.nominalUnitsPerDay)} units` : "Unknown")}${fact("Limiting resource", labels[row.bottleneck] || labels.unknown)}</dl>${warnings(row.unknownReasons)}</article>`).join("")}</div><p class="pdl-note">Uses compatible-machine capacity and hands-on time. Whole batches stay on one machine. These ceilings describe a planning scenario; current queues, device availability and delivery dates remain separate.</p></section>`;
}

/** Read-only decisions from existing captured evidence and saved shop assumptions. */
export function printDecisionLabView(snapshot, { open = true } = {}) {
  if (snapshot?.tenant_id !== "occasionally-odd") return "";
  const lab = buildPrintDecisionLab(snapshot), groups = Array.isArray(lab.groups) ? lab.groups : [];
  return `<details class="bpf-details pdl-lab" data-bpf-detail="decision-lab"${open ? " open" : ""}><summary><span>Print lab</span><span class="pdl-summary">${esc(number(lab.fileCount, 0))} saved ${lab.fileCount === 1 ? "file" : "files"} · ${esc(number(groups.length, 0))} ${groups.length === 1 ? "comparison" : "comparisons"}</span></summary><div class="pdl-body"><p class="pdl-intro">See what a changed slice buys you—and when saving your own time matters more.</p>${leverageView(lab)}${groups.length ? `<div class="pdl-groups">${groups.slice(0, 8).map(group => groupView(group, lab.currency)).join("")}</div>` : '<p class="pdl-note pdl-empty">Related versions will be compared automatically as your captured history grows. A shared title proposes a match; a linked product recipe establishes the relationship.</p>'}${groups.length > 8 || lab.limits?.truncated ? '<p class="pdl-note">This focused view has a comparison limit. The complete saved history remains available below.</p>' : ""}${capacityView(Array.isArray(lab.recipeCapacity) ? lab.recipeCapacity : [])}<p class="pdl-scope">${esc(lab.scopeNote || "Saved slice estimates and planning assumptions support these decisions. Product equivalence, physical quality and realized savings require evidence.")}</p></div></details>`;
}
