import assert from 'node:assert/strict';
import { PRINT_DEFAULTS, printProjectProfiles } from '../app/js/print-opportunity-core.js';
import { analyzePrintOpportunities, matchPrintMaterial, selectPrintFiles } from '../app/js/print-opportunity-intelligence.js';
import { createPrintOpportunityState, renderPrintOpportunities } from '../app/js/print-opportunity.js';

let checks = 0;
const check = assertion => { assertion(); checks++; };
const filament = { id: '1', profile: 'Generic PLA @BBL P2S', vendor: 'Generic', type: 'PLA', color: '#161616', grams: 64.2 };
const fast = { name: 'Fast.3mf', sha256: 'a', printer: 'Bambu Lab P2S', presetCosts: ['3400'], plates: [{ index: '1', grams: 64.2, seconds: 6396, objectCount: 1, warnings: [], filaments: [filament] }] };
const light = { name: 'Light.3mf', sha256: 'b', printer: 'Bambu Lab X1 Carbon', plates: [{ index: '1', grams: 40, seconds: 10000, objectCount: 4, warnings: [], filaments: [{ ...filament, grams: 40 }] }] };
const costs = { ...PRINT_DEFAULTS };
const options = { businessId: 'shop-a', costs };
const material = { id: 'pla', tenantId: 'shop-a', name: filament.profile, unit: 'kg', unitCost: 40 };
const context = { tenantId: 'shop-a', materials: [material], printers: [{ id: 'printer', tenantId: 'shop-a', name: fast.printer }] };

const profiles = printProjectProfiles({ filament_type: ['PLA'], filament_colour: ['#161616'], filament_settings_id: [filament.profile], filament_vendor: ['Generic'] });
check(() => assert.deepEqual(profiles, [{ id: '1', type: 'PLA', color: '#161616', profile: filament.profile, vendor: 'Generic' }]));
check(() => assert.deepEqual(printProjectProfiles(null), []));
check(() => assert.equal(printProjectProfiles({ filament_type: Array(200).fill('PLA') }).length, 128));

const result = analyzePrintOpportunities([fast, light, { ...fast, name: 'Duplicate.3mf' }, { name: 'Unsliced.3mf', sha256: 'c', plates: [] }], options);
check(() => assert.equal(result.counts.duplicates, 1));
check(() => assert.equal(result.counts.plates, 2));
check(() => assert.equal(result.counts.needsSlice, 1));
check(() => assert.equal(result.fastest.file.name, fast.name));
check(() => assert.equal(result.lightest.file.name, light.name));
check(() => assert.match(result.nextAction, /Slice Unsliced/));
check(() => assert.equal(result.moneyBasis, 'illustrative-example-only'));
check(() => assert.equal(result.rows[0].materialCost, null, 'Unverified preset price must not become a material purchase cost.'));
check(() => assert.equal(result.rows[0].plate.objectCount, 1));
check(() => assert.equal(result.rows[1].plate.objectCount, 4));
const unreadable = analyzePrintOpportunities([{ name: 'Damaged.3mf', error: 'CRC mismatch', plates: [] }, fast], options);
check(() => assert.equal(unreadable.counts.unreadable, 1));
check(() => assert.match(unreadable.nextAction, /Re-save Damaged/));
check(() => assert.match(analyzePrintOpportunities([fast], options).nextAction, /actual filament cost/));
check(() => assert.match(analyzePrintOpportunities([fast, light], options).nextAction, /different printer profiles/));
const zeroMass = analyzePrintOpportunities([{ ...fast, plates: [{ ...fast.plates[0], grams: 0 }] }], options);
check(() => assert.equal(zeroMass.rows[0].ready, false));
check(() => assert.equal(zeroMass.rows[0].estimate, null, 'A zero-mass plate must not produce a financial estimate.'));
check(() => assert.equal(zeroMass.rows[0].materialCost, null));
check(() => assert.match(analyzePrintOpportunities([{ ...fast, plates: [{ ...fast.plates[0], warnings: ['temperature'] }] }], options).nextAction, /saved slicing warning/));
check(() => assert.match(analyzePrintOpportunities([{ ...fast, plates: [{ ...fast.plates[0], outsidePlate: true }] }], options).nextAction, /outside the printable plate/));

check(() => assert.equal(matchPrintMaterial(filament, [material]).costPerGram, .04));
check(() => assert.equal(matchPrintMaterial(filament, [{ ...material, unit: 'g', unitCost: .04 }]).costPerGram, .04));
check(() => assert.equal(matchPrintMaterial(filament, [{ ...material, unit: 'each' }]), null));
check(() => assert.equal(matchPrintMaterial(filament, [{ ...material, unitCost: 0 }]), null, 'Default zero is an unknown purchase cost, not free filament.'));
check(() => assert.equal(matchPrintMaterial(filament, [material, { ...material, id: 'duplicate', unitCost: 0 }]), null));
check(() => assert.equal(matchPrintMaterial(filament, [{ ...material, name: 'PLA' }]), null, 'A generic type cannot silently match a specific brand/color/profile.'));
const priced = analyzePrintOpportunities([fast], { ...options, businessContext: context });
check(() => assert.ok(Math.abs(priced.rows[0].materialCost.amount - 2.568) < 1e-9));
check(() => assert.equal(priced.rows[0].materialCost.source, 'saved-business-materials'));
check(() => assert.equal(priced.rows[0].printerMatch, fast.printer));
check(() => assert.equal(analyzePrintOpportunities([fast], { ...options, businessContext: { ...context, tenantId: 'other-shop' } }).rows[0].materialCost, null));
check(() => assert.equal(analyzePrintOpportunities([fast], { ...options, businessContext: { ...context, materials: [{ ...material, tenantId: 'other-shop' }] } }).rows[0].materialCost, null));
check(() => assert.equal(analyzePrintOpportunities([fast], { ...options, businessContext: { ...context, currency: 'EUR' } }).rows[0].materialCost, null));
check(() => assert.equal(analyzePrintOpportunities([fast], { ...options, businessContext: { ...context, materials: {}, printers: [null] } }).rows[0].materialCost, null));
check(() => assert.equal(analyzePrintOpportunities([fast], { ...options, businessContext: { ...context, materials: [null, material] } }).rows[0].materialCost.amount, priced.rows[0].materialCost.amount));
check(() => assert.equal(analyzePrintOpportunities([{ ...fast, plates: [{ ...fast.plates[0], filaments: [{ ...filament, grams: 50 }] }] }], { ...options, businessContext: context }).rows[0].materialCost, null, 'Unaccounted filament cannot silently become zero-cost material.'));
check(() => assert.equal(analyzePrintOpportunities([fast], { ...options, costsSource: 'saved' }).moneyBasis, 'saved-device-assumptions'));

const selection = selectPrintFiles([...Array.from({ length: 23 }, (_, index) => ({ name: `Part-${index}.3MF`, webkitRelativePath: `folder/Part-${index}.3MF` })), { name: 'notes.txt' }]);
check(() => assert.equal(selection.files.length, 20));
check(() => assert.equal(selection.totalProjects, 23));
check(() => assert.equal(selection.truncated, 3));
check(() => assert.equal(selection.ignored, 1));
check(() => assert.equal(selectPrintFiles([{ name: 'notes.txt' }]).files.length, 0));

globalThis.localStorage = { getItem: key => key.endsWith(':saved-shop') ? JSON.stringify({ ...PRINT_DEFAULTS, filament: 99 }) : null };
function rootFixture() {
  const results = { innerHTML: '' }, scenario = { innerHTML: '' }, form = { pendingValue: 'A manual edit', addEventListener() {} };
  let html = '', mounts = 0;
  return { results, scenario, form, get mounts() { return mounts; }, get innerHTML() { return html; }, set innerHTML(value) { html = value; mounts++; },
    querySelector(selector) { return selector === '[data-po-results]' ? results : selector === '[data-po-scenario-results]' ? scenario : selector === '[data-po-costs]' ? form : null; },
  };
}
const emptyRoot = rootFixture(), emptyState = createPrintOpportunityState('empty-shop');
renderPrintOpportunities(emptyRoot, { businessId: 'empty-shop', state: emptyState });
check(() => assert.match(emptyRoot.innerHTML, /analysis starts automatically/));
check(() => assert.match(emptyRoot.innerHTML, /data-po-folder/));
check(() => assert.doesNotMatch(emptyRoot.innerHTML, /data-po-cost-details open/));
const savedRoot = rootFixture(), savedState = createPrintOpportunityState('saved-shop');
renderPrintOpportunities(savedRoot, { businessId: 'saved-shop', state: savedState });
check(() => assert.equal(savedState.costs.filament, 99));
check(() => assert.equal(savedState.costsSource, 'saved'));

const root = rootFixture(), state = createPrintOpportunityState('shop-a'); state.files = [fast];
const controller = renderPrintOpportunities(root, { businessId: 'shop-a', state });
const mountCount = root.mounts; state.busy = true; state.generation = 9;
check(() => assert.equal(controller.updateBusinessContext(context), true));
check(() => assert.equal(root.mounts, mountCount, 'Async context refinement must not recreate the file/cost mount.'));
check(() => assert.equal(root.form.pendingValue, 'A manual edit'));
check(() => assert.equal(state.generation, 9));
check(() => assert.equal(state.busy, true));
check(() => assert.match(root.results.innerHTML, /\$2\.57/));
const acceptedResults = root.results.innerHTML;
check(() => assert.equal(controller.updateBusinessContext({ ...context, tenantId: 'other-shop' }), false));
check(() => assert.equal(root.results.innerHTML, acceptedResults));
controller.destroy();
check(() => assert.equal(controller.updateBusinessContext(context), false));

function draftRootFixture() {
  const percentages = new Set(['failure', 'fee', 'margin']);
  const controls = Object.fromEntries(Object.entries(PRINT_DEFAULTS).map(([key, value]) => [key, { value: String(percentages.has(key) ? value * 100 : value) }]));
  const form = { handlers: {}, elements: { namedItem: key => controls[key] }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const picker = () => ({ files: [], handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const files = picker(), folder = picker(), clear = picker(), save = picker();
  const results = { innerHTML: '' }, scenario = { innerHTML: '' }, notice = { textContent: '' }, error = { textContent: '', hidden: true };
  const panel = { preserved: false, toggleAttribute(name, active) { if (name === 'data-preserve-workspace') this.preserved = active; } };
  let html = '', mounts = 0;
  return { controls, form, files, folder, clear, save, panel, get mounts() { return mounts; }, get innerHTML() { return html; },
    set innerHTML(value) {
      html = value; mounts++;
      for (const match of value.matchAll(/<input name="([^"]+)"[^>]*value="([^"]*)"/g)) if (controls[match[1]]) controls[match[1]].value = match[2];
    },
    querySelector(selector) { return ({ '[data-po-costs]': form, '[data-po-files]': files, '[data-po-folder]': folder, '[data-po-clear]': clear, '[data-po-save]': save, '[data-po-results]': results, '[data-po-scenario-results]': scenario, '[data-po-cost-draft]': notice, '[data-po-error]': error, '.po-panel': panel })[selector] || null; },
  };
}

const draftRoot = draftRootFixture(), draftState = createPrintOpportunityState('shop-a');
draftRoot.controls.filament.value = '999';
const draftController = renderPrintOpportunities(draftRoot, { businessId: 'shop-a', state: draftState });
check(() => assert.equal(draftRoot.controls.filament.value, '25', 'A new mount must not import a former mount’s DOM draft.'));
check(() => assert.equal(draftState.costDraft, null));
draftRoot.controls.filament.value = '';
draftRoot.controls.revenue.value = '12.5000';
draftRoot.form.handlers.input();
check(() => assert.equal(draftState.costDraft.filament, ''));
check(() => assert.equal(draftState.costDraft.revenue, '12.5000'));
check(() => assert.equal(draftState.costDraftChanged, true));
check(() => assert.equal(draftRoot.panel.preserved, true));
let busy = false, resolveComplete;
Object.defineProperty(draftState, 'busy', { get: () => busy, set(value) { busy = value; if (!value) resolveComplete?.(); } });
for (const picker of [draftRoot.files, draftRoot.folder]) {
  let rejectRead;
  const blockedRead = new Promise((resolve, reject) => { rejectRead = reject; });
  const completed = new Promise(resolve => { resolveComplete = resolve; });
  picker.files = [{ name: 'Draft.3mf', size: 1, arrayBuffer: () => blockedRead }];
  picker.handlers.change();
  check(() => assert.equal(draftState.busy, true, 'Optional invalid fields must not block selected file reading.'));
  check(() => assert.equal(draftRoot.controls.filament.value, ''));
  check(() => assert.equal(draftRoot.controls.revenue.value, '12.5000'));
  check(() => assert.equal(draftState.costs.filament, 25, 'An invalid/unapplied draft must not become a scenario cost.'));
  rejectRead(new Error('Disposable unreadable archive fixture'));
  await completed;
  check(() => assert.equal(draftRoot.controls.filament.value, ''));
  check(() => assert.equal(draftRoot.controls.revenue.value, '12.5000'));
  check(() => assert.equal(draftState.costDraftChanged, true));
}
draftRoot.clear.handlers.click();
check(() => assert.equal(draftState.files.length, 0));
check(() => assert.match(draftRoot.innerHTML, /data-preserve-workspace/));
const draftMounts = draftRoot.mounts;
check(() => assert.equal(draftController.updateBusinessContext(context), true));
check(() => assert.equal(draftRoot.mounts, draftMounts));
check(() => assert.equal(draftRoot.controls.filament.value, ''));
check(() => assert.equal(draftState.costDraftChanged, true));
const NativeFormData = globalThis.FormData;
globalThis.FormData = class { constructor(form) { this.form = form; } get(key) { return this.form.elements.namedItem(key)?.value ?? null; } };
globalThis.localStorage.setItem = () => {};
try {
  draftRoot.save.handlers.click();
  check(() => assert.equal(draftState.costs.filament, 25));
  check(() => assert.equal(draftState.costDraft.filament, ''));
  check(() => assert.equal(draftState.costDraftChanged, true));
  draftRoot.controls.filament.value = '77.50';
  draftRoot.form.handlers.submit({ preventDefault() {} });
  check(() => assert.equal(draftState.costs.filament, 77.5));
  check(() => assert.equal(draftState.costDraft, null));
  check(() => assert.equal(draftState.costDraftChanged, false));
  check(() => assert.equal(draftState.costsChanged, true));
  draftRoot.save.handlers.click();
  check(() => assert.equal(draftState.costsChanged, false));
  check(() => assert.equal(draftState.costDraftChanged, false));
} finally { globalThis.FormData = NativeFormData; draftController.destroy(); }

console.log(`Print intelligence: ${checks} checks passed (automatic findings, file/folder limits, provenance, exact material costs, tenant isolation, optional forms and non-destructive context refinement).`);
