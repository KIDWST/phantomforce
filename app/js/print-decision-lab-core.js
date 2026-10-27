// Deterministic decisions from the already authorized business snapshot.
// No file access, inference provider, network, printer commands or persistence.
const LIMITS = Object.freeze({ files: 200, groups: 8, variants: 6, recipes: 100 });
const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = value => valid(value) && value > 0;
const number = value => valid(value) ? value : null;
const text = value => typeof value === "string" ? value.slice(0, 500) : "";
const title = value => text(value).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/(?:\.gcode)?\.3mf$/i, "");
const model = value => text(value).toUpperCase().match(/\b(P2S|P1S|P1P|X1C|X1 CARBON|A1 MINI|A1)\b/)?.[0] || null;
const total = (rows, key, requirePositive = false) => rows.length && rows.every(row => (requirePositive ? positive : valid)(row?.[key])) ? rows.reduce((sum, row) => sum + row[key], 0) : null;
const subtract = (after, before) => valid(after) && valid(before) ? after - before : null;
const near = (left, right) => Math.abs(left - right) < 1e-8;

function ratesFrom(settings) {
  const c = settings?.costs || {};
  return { filament: number(c.filament), machine: number(c.machine), labor: number(c.labor),
    failure: valid(c.failure) && c.failure < 1 ? c.failure : null, hourly: number(c.hourly) };
}

function variant(file, rates, currency) {
  const metadata = file.metadata || {}, plates = Array.isArray(metadata.plates) ? metadata.plates : [];
  const grams = total(plates, "grams", true), seconds = total(plates, "seconds", true);
  const parts = plates.length && plates.every(plate => plate && Number.isInteger(plate.objectCount) && plate.objectCount >= 0) ? total(plates, "objectCount") : null;
  const materialRows = Array.isArray(file.analysis?.plates) ? file.analysis.plates : [];
  let material = 0;
  for (const plate of plates) {
    if (!plate) { material = null; break; }
    const matches = plate.index !== undefined && plate.index !== null && String(plate.index).trim() ? materialRows.filter(row => row && row.index !== undefined && row.index !== null && String(row.index) === String(plate.index)) : [];
    const saved = matches.length === 1 ? matches[0].materialCost : null;
    if (saved && saved.currency === currency && valid(saved.amount)) material += saved.amount;
    else if (positive(plate.grams) && rates.filament !== null) material += plate.grams / 1000 * rates.filament;
    else { material = null; break; }
  }
  if (!plates.length || grams === null) material = null;
  const machine = seconds !== null && rates.machine !== null ? seconds / 3600 * rates.machine : null;
  const productionCost = material !== null && machine !== null && rates.failure !== null ? (material + machine) / (1 - rates.failure) : null;
  return { hash: file.sha256, label: text(metadata.projectTitle || metadata.name) || "Unnamed capture", filename: text(metadata.name), capturedAt: text(file.capturedAt),
    printer: text(metadata.printer || metadata.printerProfile) || "Printer unknown", printerModel: model(metadata.printer),
    nozzle: text(metadata.nozzle), sliceProfile: text(metadata.sliceProfile), parts, plateCount: plates.length, grams, seconds, materialCost: material, productionCost,
    support: plates.length && plates.every(plate => plate && typeof plate.supportUsed === "boolean") ? plates.some(plate => plate.supportUsed) : null };
}

function compare(before, after, equivalent, rates) {
  const warnings = [];
  if (!equivalent) warnings.push("Same title is only a possible relation. Link equivalent finished output in a complete-product recipe before ranking versions.");
  if (before.parts === null || after.parts === null) warnings.push("Part count is unknown; verify the complete printed output.");
  else if (before.parts !== after.parts) warnings.push(`Part counts differ (${before.parts} vs ${after.parts}); verify selected parts and finished yield.`);
  if (before.plateCount !== after.plateCount) warnings.push("Plate counts differ; assembly coverage needs review.");
  if (!before.printerModel || !after.printerModel) warnings.push("Printer identity is unknown; compatibility is unverified.");
  else if (before.printerModel !== after.printerModel) warnings.push("Printer models differ. Instructions are not interchangeable; compare compatible reslices.");
  if (before.nozzle && after.nozzle && before.nozzle !== after.nozzle) warnings.push("Nozzle settings differ; verify strength and finish.");
  if (before.support !== after.support) warnings.push("Support use differs; finishing work may change.");
  if (before.sliceProfile && after.sliceProfile && before.sliceProfile !== after.sliceProfile) warnings.push("Slice profiles differ; material/time alone cannot establish equal strength or appearance.");
  const gramsDelta = subtract(after.grams, before.grams), secondsDelta = subtract(after.seconds, before.seconds);
  const productionCostDelta = subtract(after.productionCost, before.productionCost), materialCostDelta = subtract(after.materialCost, before.materialCost);
  const canRank = equivalent && !warnings.length && gramsDelta !== null && secondsDelta !== null && productionCostDelta !== null;
  let decision = "Review output equivalence before choosing a version.";
  if (gramsDelta === null || secondsDelta === null) decision = "Slice mass or runtime is incomplete; no resource ranking is available.";
  else if (canRank) {
    if (gramsDelta <= 0 && secondsDelta <= 0 && productionCostDelta <= 0 && (gramsDelta < 0 || secondsDelta < 0 || productionCostDelta < 0)) decision = "Newer version is a lower-resource candidate; verify quality before adopting it.";
    else if (gramsDelta >= 0 && secondsDelta >= 0 && productionCostDelta >= 0 && (gramsDelta > 0 || secondsDelta > 0 || productionCostDelta > 0)) decision = "Earlier version uses no more time, material or print cost; keep it as the resource baseline.";
    else if (near(gramsDelta, 0) && near(secondsDelta, 0) && near(productionCostDelta, 0)) decision = "No estimated production-resource change.";
    else decision = "This is a resource tradeoff; compare the cost of saved time with the work you can actually use it for.";
  }
  // This ratio is a conditional planning premium, never a claim of realized income.
  const freedExpectedHours = secondsDelta !== null && secondsDelta < 0 && rates.failure !== null ? -secondsDelta / 3600 / (1 - rates.failure) : null;
  const conditionalCostPerHourSaved = freedExpectedHours && productionCostDelta !== null && productionCostDelta > 0 ? productionCostDelta / freedExpectedHours : null;
  return { fromHash: before.hash, toHash: after.hash, gramsDelta, secondsDelta, productionCostDelta, materialCostDelta,
    conditionalCostPerHourSaved, decision, warnings };
}

function planningCapacity(planning) {
  const seen = new Set();
  const printers = (Array.isArray(planning.printers) ? planning.printers : []).filter(printer => {
    if (!printer || !text(printer.id) || seen.has(printer.id) || !valid(printer.hoursPerDay) || printer.hoursPerDay > 24) return false;
    seen.add(printer.id); return true;
  });
  const printerHoursPerDay = printers.length ? printers.reduce((sum, printer) => sum + printer.hoursPerDay, 0) : null;
  const finishingMinutesPerDay = valid(planning.finishingHoursPerDay) && planning.finishingHoursPerDay <= 24 ? planning.finishingHoursPerDay * 60 : null;
  return { printers, printerHoursPerDay, finishingMinutesPerDay,
    finishingMinutesPerPrinterHour: positive(printerHoursPerDay) && finishingMinutesPerDay !== null ? finishingMinutesPerDay / printerHoursPerDay : null,
    configuredPrinters: printers.length };
}

function recipeCapacity(recipe, files, rates, capacity) {
  const file = files.find(row => row.sha256 === recipe.fileHash), metadata = file?.metadata || {};
  const plates = Array.isArray(metadata.plates) ? metadata.plates : [];
  const seconds = total(plates, "seconds", true), printerModel = model(metadata.printer);
  const declaredIds = Array.isArray(recipe.compatiblePrinterIds) ? recipe.compatiblePrinterIds : [];
  // A declaration never makes P2S instructions runnable on a P1S. Count only
  // this slice's actual machine family, even when other recipe reslices exist.
  const compatible = capacity.printers.filter(printer => printerModel && model(printer.model) === printerModel && (!declaredIds.length || declaredIds.includes(printer.id)));
  const printerHoursPerDay = compatible.length ? compatible.reduce((sum, printer) => sum + printer.hoursPerDay, 0) : null;
  const printerHoursPerBatch = seconds !== null && rates.failure !== null ? seconds / 3600 / (1 - rates.failure) : null;
  const finishingMinutesPerBatch = number(recipe.finishingMinutesPerBatch);
  const unitsPerBatch = recipe.completeProduct === true && Number.isInteger(recipe.unitsPerBatch) && recipe.unitsPerBatch > 0 ? recipe.unitsPerBatch : null;
  const unknownReasons = [];
  if (!unitsPerBatch) unknownReasons.push("Confirm complete-product yield in the reusable recipe.");
  if (printerHoursPerDay === null) unknownReasons.push("A configured printer matching this slice is needed.");
  if (printerHoursPerBatch === null) unknownReasons.push("Saved runtime and reprint allowance are needed.");
  if (finishingMinutesPerBatch === null || (finishingMinutesPerBatch > 0 && capacity.finishingMinutesPerDay === null)) unknownReasons.push("Finishing time and daily hands-on capacity are needed.");
  let nominalUnitsPerDay = null, bottleneck = "unknown";
  if (!unknownReasons.length) {
    const printBatches = printerHoursPerDay / printerHoursPerBatch;
    const finishBatches = finishingMinutesPerBatch === 0 ? Infinity : capacity.finishingMinutesPerDay / finishingMinutesPerBatch;
    nominalUnitsPerDay = Math.min(printBatches, finishBatches) * unitsPerBatch;
    bottleneck = near(printBatches, finishBatches) ? "balanced" : printBatches < finishBatches ? "printer" : "finishing";
  }
  return { id: text(recipe.id), name: text(recipe.name), compatiblePrinters: compatible.map(printer => text(printer.label || printer.model)),
    printerHoursPerDay, printerHoursPerBatch, finishingMinutesPerBatch, unitsPerBatch, nominalUnitsPerDay, bottleneck, unknownReasons };
}

export function buildPrintDecisionLab(snapshot) {
  const authorized = snapshot?.tenant_id === "occasionally-odd";
  const settings = authorized ? snapshot.settings || {} : {}, rates = ratesFrom(settings);
  const currency = /^[A-Z]{3}$/.test(settings.currency) ? settings.currency : "USD";
  const sourceFiles = authorized && Array.isArray(snapshot.files) ? snapshot.files : [];
  const seen = new Set();
  const files = sourceFiles.filter(file => {
    if (!file || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) || seen.has(file.sha256) || (file.tenantId && file.tenantId !== "occasionally-odd")) return false;
    seen.add(file.sha256); return true;
  }).slice(0, LIMITS.files).sort((a, b) => (Date.parse(a.capturedAt) || 0) - (Date.parse(b.capturedAt) || 0) || a.sha256.localeCompare(b.sha256));
  const workflow = authorized ? snapshot.workflow || {} : {}, planning = workflow.planning || {};
  const recipes = (Array.isArray(workflow.recipes) ? workflow.recipes : []).filter(recipe => recipe && typeof recipe === "object").slice(0, LIMITS.recipes);
  const capacity = planningCapacity(planning), definitions = [], linked = new Set();
  for (const recipe of recipes) {
    const hashes = new Set([recipe.fileHash, ...(Array.isArray(recipe.linkedFileHashes) ? recipe.linkedFileHashes : [])]);
    const rows = files.filter(file => hashes.has(file.sha256));
    if (rows.length < 2) continue;
    rows.forEach(file => linked.add(file.sha256));
    definitions.push({ id: "recipe-" + text(recipe.id), name: text(recipe.name) || "Linked product versions", relation: "recipe", relationLabel: "Explicitly linked recipe versions",
      equivalent: recipe.completeProduct === true && Number.isInteger(recipe.unitsPerBatch) && recipe.unitsPerBatch > 0, files: rows });
  }
  const byTitle = new Map();
  for (const file of files.filter(file => !linked.has(file.sha256))) {
    const key = title(file.metadata?.projectTitle || file.metadata?.name);
    if (!key || ["untitled", "unnamed", "project", "plate", "model"].includes(key)) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(file);
  }
  for (const [key, rows] of byTitle) if (rows.length > 1) definitions.push({ id: "title-" + key, name: text(rows[0].metadata?.projectTitle || rows[0].metadata?.name), relation: "title-candidate", relationLabel: "Possible related versions · same title only", equivalent: false, files: rows });
  const groups = definitions.slice(0, LIMITS.groups).map(group => {
    const selected = group.files.length > LIMITS.variants ? [group.files[0], ...group.files.slice(-(LIMITS.variants - 1))] : group.files;
    const variants = selected.map(file => variant(file, rates, currency));
    const comparisons = variants.slice(1).map(after => compare(variants[0], after, group.equivalent, rates));
    const warnings = [...new Set(comparisons.flatMap(row => row.warnings))];
    return { id: group.id, name: group.name, relation: group.relation, relationLabel: group.relationLabel, equivalenceConfirmed: group.equivalent,
      variants, comparisons, warnings, recommendation: group.equivalent && !warnings.length ? "Resource comparisons use your linked finished yield. Check strength, appearance and assembly before changing a production recipe." : null,
      totalVariants: group.files.length, truncated: selected.length < group.files.length };
  });
  return { fileCount: files.length, currency, groups, assumptionsConfirmed: settings.costsConfirmed === true,
    leverage: { filamentUsdPerKg: rates.filament, machineUsdPerHour: rates.machine, laborUsdPerHour: rates.labor, failureFraction: rates.failure,
      cashExtraGramsPerPrinterHour: positive(rates.filament) && rates.machine !== null ? rates.machine / rates.filament * 1000 : null,
      extraGramsPerFinishingMinute: positive(rates.filament) && rates.labor !== null && rates.failure !== null ? rates.labor / 60 * (1 - rates.failure) / rates.filament * 1000 : null,
      targetExtraGramsPerPrinterHour: positive(rates.filament) && rates.machine !== null && rates.hourly !== null ? (rates.machine + rates.hourly) / rates.filament * 1000 : null,
      capacity: { printerHoursPerDay: capacity.printerHoursPerDay, finishingMinutesPerDay: capacity.finishingMinutesPerDay,
        finishingMinutesPerPrinterHour: capacity.finishingMinutesPerPrinterHour, configuredPrinters: capacity.configuredPrinters } },
    recipeCapacity: recipes.map(recipe => recipeCapacity(recipe, files, rates, capacity)),
    limits: { files: LIMITS.files, groups: LIMITS.groups, variants: LIMITS.variants, recipes: LIMITS.recipes,
      truncated: sourceFiles.length > files.length || definitions.length > groups.length || (workflow.recipes?.length || 0) > recipes.length },
    scopeNote: "Whole captured projects, not inferred saleable units. Print costs include filament, machine time and full-reprint allowance; finishing, hardware and packing are separate. Daily throughput is a theoretical long-run ceiling for this slice, before queues, downtime and scheduling; it is not a delivery promise or demand forecast." };
}
