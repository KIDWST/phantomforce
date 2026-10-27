import assert from "node:assert/strict";
import { buildPrintDecisionLab } from "../app/js/print-decision-lab-core.js";

let checks = 0;
const check = fn => { fn(); checks++; };
const close = (actual, expected, message) => assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, got ${actual}`);
const hash = value => Number(value).toString(16).padStart(64, "0");
const makeFile = (id, patch = {}) => {
  const base = {
    sha256: hash(id), tenantId: "occasionally-odd", capturedAt: `2026-10-${String(20 + id % 7).padStart(2, "0")}T12:00:00Z`,
    metadata: { name: `slice-${id}.3mf`, projectTitle: "Test product", printer: "Bambu Lab P2S", printerProfile: "Bambu Lab P2S 0.4 nozzle", nozzle: "0.4", sliceProfile: "0.20mm Standard",
      plates: [{ index: "1", grams: 100, seconds: 3600, objectCount: 3, supportUsed: false, outsidePlate: false, warnings: [], filaments: [{ id: "1", type: "PLA", profile: "Generic PLA", color: "#000000", grams: 100 }] }] },
    analysis: { plates: [{ index: "1", materialCost: null }] }
  };
  return { ...base, ...patch, metadata: { ...base.metadata, ...patch.metadata } };
};
const makeSnapshot = (files = [makeFile(1), makeFile(2)], patch = {}) => {
  const base = {
    ok: true, tenant_id: "occasionally-odd",
    settings: { currency: "USD", costsConfirmed: true, costs: { filament: 15, machine: 1, labor: 20, failure: .1, hourly: 10, minutes: 10, packaging: 1, fee: 0, fixedFee: 0, margin: .3, revenue: 25 } },
    files,
    workflow: { planning: { printers: [{ id: "p2s", label: "Bambu P2S", model: "P2S", hoursPerDay: 24 }, { id: "p1s", label: "Bambu P1S", model: "P1S", hoursPerDay: 24 }], finishingHoursPerDay: 2 }, recipes: [] }
  };
  return { ...base, ...patch, settings: { ...base.settings, ...patch.settings, costs: { ...base.settings.costs, ...patch.settings?.costs } }, workflow: { ...base.workflow, ...patch.workflow, planning: { ...base.workflow.planning, ...patch.workflow?.planning } } };
};
const recipe = (files, patch = {}) => ({ id: "recipe-one", name: "Confirmed product", fileHash: files[0].sha256, linkedFileHashes: files.map(file => file.sha256), completeProduct: true, unitsPerBatch: 2, finishingMinutesPerBatch: 5, hardwareCostPerBatch: 0, packagingCostPerUnit: 1, compatiblePrinterIds: ["p2s"], ...patch });
const firstGroup = snapshot => buildPrintDecisionLab(snapshot).groups[0];
const variant = (group, file) => group.variants.find(row => row.hash === file.sha256);

// A real misleading-title case: different composition and printer, only 206 s faster.
const santaP1s = makeFile(1, { metadata: { projectTitle: "Santa Stop Here Christmas Signpost - No AMS Needed", printer: "Bambu Lab P1S", printerProfile: "Bambu Lab P1S 0.4 nozzle", plates: [{ index: "1", grams: 142.87, seconds: 14963, objectCount: 3, supportUsed: false, filaments: [] }] } });
const santaP2s = makeFile(2, { metadata: { projectTitle: "Santa Stop Here Christmas Signpost - No AMS Needed", plates: [{ index: "1", grams: 155.67, seconds: 14757, objectCount: 4, supportUsed: false, filaments: [] }] } });
const santa = firstGroup(makeSnapshot([santaP1s, santaP2s]));
check(() => assert.equal(santa.relation, "title-candidate"));
check(() => assert.equal(santa.equivalenceConfirmed, false));
check(() => assert.equal(santa.recommendation, null, "Matching titles cannot justify a winning version"));
check(() => assert.match(santa.warnings.join(" "), /part|composition/i));
check(() => assert.match(santa.warnings.join(" "), /printer/i));
check(() => close(Math.abs(santa.comparisons[0].gramsDelta), 12.8, "Observed mass change"));
check(() => close(Math.abs(santa.comparisons[0].secondsDelta), 206, "Observed duration change"));
check(() => close(santa.comparisons[0].conditionalCostPerHourSaved, (12.8 * .015 - 206 / 3600) / (206 / 3600), "Conditional extra print cost per freed hour"));
check(() => assert.ok(!/\bwinner\b|\bchoose\b|\buse this\b/i.test(santa.comparisons[0].decision), "A title candidate must not recommend replacing the original"));
const santaLinked = buildPrintDecisionLab(makeSnapshot([santaP1s, santaP2s], { workflow: { recipes: [recipe([santaP1s, santaP2s])] } })).groups.find(group => group.relation === "recipe");
check(() => assert.equal(santaLinked.recommendation, null, "A declared recipe must not erase observed printer/composition differences"));

const base = makeFile(3);
const fasterLighter = makeFile(4, { metadata: { plates: [{ ...base.metadata.plates[0], grams: 80, seconds: 3000, filaments: [{ ...base.metadata.plates[0].filaments[0], grams: 80 }] }] } });
const linked = makeSnapshot([base, fasterLighter], { workflow: { recipes: [recipe([base, fasterLighter])] } });
const linkedGroup = buildPrintDecisionLab(linked).groups.find(group => group.relation === "recipe");
check(() => assert.ok(linkedGroup));
check(() => assert.equal(linkedGroup.equivalenceConfirmed, true));
check(() => assert.ok(linkedGroup.recommendation, "Linked complete-product variants with matching composition/profile can expose an improvement"));
check(() => assert.ok(linkedGroup.comparisons[0].productionCostDelta !== null));
const titleOnly = firstGroup(makeSnapshot([base, fasterLighter]));
check(() => assert.equal(titleOnly.recommendation, null, "Even an apparently dominant slice needs output equivalence"));
const incompleteRecipe = firstGroup(makeSnapshot([base, fasterLighter], { workflow: { recipes: [recipe([base, fasterLighter], { completeProduct: false })] } }));
check(() => assert.equal(incompleteRecipe.equivalenceConfirmed, false));
check(() => assert.equal(incompleteRecipe.recommendation, null));
const coarse = makeFile(9, { metadata: { sliceProfile: "0.28mm Extra Draft", plates: [{ ...base.metadata.plates[0], grams: 70, seconds: 2000, filaments: [{ ...base.metadata.plates[0].filaments[0], grams: 70 }] }] } });
const qualityChanged = buildPrintDecisionLab(makeSnapshot([base, coarse], { workflow: { recipes: [recipe([base, coarse])] } })).groups.find(group => group.relation === "recipe");
check(() => assert.equal(qualityChanged.recommendation, null, "Cheaper draft quality is a tradeoff requiring review, not a free improvement"));

// Missing data stays missing, even when another plate has valid measurements.
const missing = makeFile(5, { metadata: { plates: [{ index: "1", grams: null, seconds: null, objectCount: 3, supportUsed: false, filaments: [] }] } });
const unknownGroup = firstGroup(makeSnapshot([base, missing]));
check(() => assert.equal(variant(unknownGroup, missing).grams, null));
check(() => assert.equal(variant(unknownGroup, missing).seconds, null));
check(() => assert.equal(variant(unknownGroup, missing).productionCost, null));
check(() => assert.equal(unknownGroup.comparisons[0].productionCostDelta, null));
const partlyMissing = makeFile(6, { metadata: { plates: [{ ...base.metadata.plates[0] }, { ...base.metadata.plates[0], index: "2", grams: null }] } });
check(() => assert.equal(variant(firstGroup(makeSnapshot([base, partlyMissing])), partlyMissing).grams, null));

// Exact saved plate material amounts override generic USD/kg; foreign currency does not.
const recorded = makeFile(7, { analysis: { plates: [{ index: "1", materialCost: { amount: 4, currency: "USD", source: "saved-business-materials" } }] } });
const recordedGroup = firstGroup(makeSnapshot([base, recorded]));
check(() => close(variant(recordedGroup, recorded).productionCost, (4 + 1) / .9, "Saved material amount plus machine allowance"));
const foreign = makeFile(8, { analysis: { plates: [{ index: "1", materialCost: { amount: 4, currency: "EUR", source: "saved-business-materials" } }] } });
check(() => close(variant(firstGroup(makeSnapshot([base, foreign])), foreign).productionCost, (1.5 + 1) / .9, "Currency mismatch retains generic material rate"));
const missingIndex = makeFile(10, { metadata: { plates: [{ grams: 100, seconds: 3600, objectCount: 3, supportUsed: false, filaments: [] }] }, analysis: { plates: [{ materialCost: { amount: 4, currency: "USD" } }] } });
check(() => close(variant(firstGroup(makeSnapshot([base, missingIndex])), missingIndex).productionCost, (1.5 + 1) / .9, "Two missing indexes do not establish a saved-material plate association"));
const duplicateIndex = makeFile(11, { analysis: { plates: [{ index: "1", materialCost: { amount: 4, currency: "USD" } }, { index: "1", materialCost: { amount: 5, currency: "USD" } }] } });
check(() => close(variant(firstGroup(makeSnapshot([base, duplicateIndex])), duplicateIndex).productionCost, (1.5 + 1) / .9, "Conflicting material rows cannot silently choose a rate"));

const leverage = buildPrintDecisionLab(makeSnapshot()).leverage;
check(() => close(leverage.cashExtraGramsPerPrinterHour, 1000 / 15, "Material budget for one machine hour"));
check(() => close(leverage.extraGramsPerFinishingMinute, 20, "One finishing minute does not incur a repeat allowance"));
check(() => close(leverage.targetExtraGramsPerPrinterHour, 11000 / 15, "Target return is separate from cash saving"));
check(() => close(leverage.capacity.printerHoursPerDay, 48, "Two stated 24-hour machines"));
check(() => close(leverage.capacity.finishingMinutesPerDay, 120, "Two hands-on hours"));
check(() => close(leverage.capacity.finishingMinutesPerPrinterHour, 2.5, "Hands-on crossover per occupied printer hour"));

// Capacity may count only configured, explicitly compatible machines.
const capacityResult = buildPrintDecisionLab(linked).recipeCapacity.find(row => row.id === "recipe-one");
check(() => close(capacityResult.printerHoursPerDay, 24, "P2S recipe must not gain P1S capacity"));
check(() => assert.deepEqual(capacityResult.compatiblePrinters, ["Bambu P2S"]));
check(() => assert.equal(capacityResult.bottleneck, "printer"));
check(() => close(capacityResult.nominalUnitsPerDay, 43.2, "Risk-adjusted 1h batches on one24h printer, two units/batch"));
const finishingLimited = buildPrintDecisionLab(makeSnapshot([base], { workflow: { recipes: [recipe([base], { finishingMinutesPerBatch: 120 })] } })).recipeCapacity[0];
check(() => assert.equal(finishingLimited.bottleneck, "finishing"));
check(() => close(finishingLimited.nominalUnitsPerDay, 2, "Hands-on time constrains completed product rate"));
const zeroFinishing = buildPrintDecisionLab(makeSnapshot([base], { workflow: { recipes: [recipe([base], { finishingMinutesPerBatch: 0 })], planning: { finishingHoursPerDay: null } } })).recipeCapacity[0];
check(() => assert.equal(zeroFinishing.bottleneck, "printer", "Explicit zero finishing does not require a guessed labor calendar"));
check(() => assert.ok(zeroFinishing.nominalUnitsPerDay > 0));
const unknownFinishing = buildPrintDecisionLab(makeSnapshot([base], { workflow: { recipes: [recipe([base], { finishingMinutesPerBatch: null })] } })).recipeCapacity[0];
check(() => assert.equal(unknownFinishing.nominalUnitsPerDay, null));
const noPrinterMatch = buildPrintDecisionLab(makeSnapshot([base], { workflow: { recipes: [recipe([base], { compatiblePrinterIds: ["unconfigured"] })] } })).recipeCapacity[0];
check(() => assert.equal(noPrinterMatch.nominalUnitsPerDay, null));

// Derived analysis must preserve frozen quotes and source snapshots exactly.
const immutable = makeSnapshot([base, fasterLighter], { workflow: { recipes: [recipe([base, fasterLighter])], quotes: [{ id: "frozen", ratesSnapshot: { filament: 25 } }] } });
const immutableBefore = structuredClone(immutable);
buildPrintDecisionLab(immutable);
check(() => assert.deepEqual(immutable, immutableBefore));
check(() => assert.deepEqual(buildPrintDecisionLab({ ...immutable, tenant_id: "client-chicagoshots" }).groups, []));
for (const malformed of [undefined, null, {}, { tenant_id: "occasionally-odd", files: null }, makeSnapshot([null, { sha256: hash(9), metadata: null }]),
  makeSnapshot([base, makeFile(11, { metadata: { plates: [null] } })]),
  makeSnapshot([base, makeFile(12, { analysis: { plates: [null] } })])]) {
  check(() => assert.doesNotThrow(() => buildPrintDecisionLab(malformed)));
}
const badRates = buildPrintDecisionLab(makeSnapshot([base, fasterLighter], { settings: { costs: { filament: NaN, machine: Infinity, failure: 1, labor: -5 } } }));
check(() => assert.equal(badRates.groups[0].variants[0].productionCost, null));
check(() => assert.equal(badRates.leverage.extraGramsPerFinishingMinute, null));
check(() => assert.equal(badRates.leverage.cashExtraGramsPerPrinterHour, null));
const zeroRate = buildPrintDecisionLab(makeSnapshot([base, fasterLighter], { settings: { costs: { filament: 0 } } }));
check(() => assert.equal(zeroRate.leverage.cashExtraGramsPerPrinterHour, null, "A free-filament scenario cannot divide by zero"));

const many = Array.from({ length: 80 }, (_, index) => makeFile(index + 10));
const bounded = firstGroup(makeSnapshot(many));
check(() => assert.ok(bounded.truncated, "Large related histories should disclose bounded comparisons"));
check(() => assert.ok(bounded.variants.length < many.length));
check(() => assert.equal(bounded.totalVariants, many.length));
check(() => assert.ok(bounded.comparisons.length <= 100, "Avoid unbounded pairwise comparison growth"));

console.log(`PASS print decision lab — ${checks} checks covering real mismatches, equivalence, unknowns, costs, resource substitution, compatible capacity and immutable bounded analysis`);
