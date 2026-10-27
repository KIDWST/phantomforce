import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateBambuEconomics, summarizeBambuComparables, buildBambuInsight } from "../app/js/bambu-print-feed.js";

const costs = { filament: 20, machine: 2, labor: 24, minutes: 15, packaging: 2, fixedFee: .5, failure: .2, fee: .1, margin: .3, hourly: 10, revenue: 50 };
const plates = [{ index: "1", grams: 100, seconds: 3600, objectCount: 24, filaments: [{ id: "1", type: "PLA", color: "#000000", grams: 50 }, { id: "2", type: "PLA", color: "#ffffff", grams: 50 }], supportUsed: true }, { index: "2", grams: 50, seconds: 1800, objectCount: 10, filaments: [] }];
const result = calculateBambuEconomics(plates, costs, { materialCosts: [{ index: "1", materialCost: { amount: 5 } }] });
assert.equal(result.filament, 6, "Exact material amount must replace the generic rate only for its plate");
assert.equal(result.machine, 3);
assert.equal(result.failureAllowance, 2.25, "Only material/machine costs repeat under full-reprint assumption");
assert.equal(result.labor, 6, "Hands-on finishing occurs once per full project");
assert.equal(result.cost, 19.75, "Packaging and fixed fees must not repeat for every plate");
assert.equal(result.expectedHours, 1.875);
assert.equal(result.breakEven, 19.75 / .9);
assert.equal(result.marginPrice, 19.75 / (.9 - .3));
assert.equal(result.hourlyPrice, (19.75 + 18.75) / .9);
assert.equal(result.perUnit, null, "Object count never becomes saleable yield");
const withHardware = calculateBambuEconomics(plates, costs, { extraCostPerBatch: 12, saleableUnits: 3, completeProduct: true });
assert.equal(withHardware.additionalParts, 12);
assert.equal(withHardware.perUnit.cost, withHardware.cost / 3);
assert.throws(() => calculateBambuEconomics(plates, costs, { extraCostPerBatch: -1 }));
assert.equal(calculateBambuEconomics(plates, costs, { saleableUnits: 2, completeProduct: false }).perUnit, null);
assert.equal(calculateBambuEconomics(plates, costs, { saleableUnits: 2, completeProduct: true }).perUnit.units, 2);
assert.equal(calculateBambuEconomics([{ grams: 20, seconds: null }], costs), null);
assert.throws(() => calculateBambuEconomics(plates, { ...costs, failure: 1 }));
assert.throws(() => calculateBambuEconomics(plates, { ...costs, margin: .95 }));
const now = Date.parse("2026-10-26T18:00:00Z"), base = { observedAt: "2026-10-26T00:00:00Z", currency: "USD", price: 20, shipping: 0, quantity: 2, kind: "asking", comparable: true, notes: "Reviewed physical product" };
const comps = [
  { ...base, url: "https://shop.example/a" },
  { ...base, url: "https://shop.example/b", price: 30 },
  { ...base, url: "https://shop.example/c", price: 40 },
  { ...base, url: "https://shop.example/a", price: 400 },
  { ...base, url: "https://shop.example/a", price: 60, observedAt: "2026-10-26T12:00:00Z" },
  { ...base, url: "https://shop.example/sold", price: 50, kind: "sold" },
  { ...base, url: "https://shop.example/missing-shipping", shipping: null },
  { ...base, url: "https://shop.example/foreign", currency: "EUR" },
  { ...base, url: "https://shop.example/stale", observedAt: "2025-10-26T00:00:00Z" },
  { ...base, url: "https://shop.example/future", observedAt: "2026-10-27T00:00:00Z" },
  { ...base, url: "javascript:alert(1)" },
  { ...base, url: "https://shop.example/unreviewed", comparable: false },
];
const market = summarizeBambuComparables(comps, "USD", now);
assert.equal(market.asking.count, 3, "Duplicate source URLs must not manufacture independent observations");
assert.equal(market.asking.median, 20, "A refreshed source replaces its earlier price instead of becoming another comparable");
assert.equal(market.sold.count, 1);
assert.equal(market.sold.low, 25, "Sold and asking prices remain separate");
assert.equal(market.sold.median, null, "Tiny samples cannot claim a market median");
assert.equal(market.excluded, 6);
const insight = buildBambuInsight({ metadata: { plates } }, { currency: "USD", costsConfirmed: false }, result);
assert.match(insight, /^Next: confirm shop rates/);
assert.match(insight, /finished unit yield/);
assert.match(insight, /2 filament selections/);
assert.match(insight, /cleanup/);
assert.match(insight, /higher of the margin and printer-hour targets/);
assert.match(insight, /commercial rights/);
const shell = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const printButton = shell.slice(shell.indexOf('if (e.target.closest("[data-print-analysis-open]"))'), shell.indexOf('if (e.target.closest("[data-print-analysis-open]"))') + 650);
assert.match(printButton, /currentTenantId\(\) === "occasionally-odd"\) routeWorkspace\("business-production", true\)/, "Occasionally Odd header action should open its automatic feed");
assert.match(printButton, /else[^\n]*showWorkspaceAccess/, "Other businesses retain their standalone local scanner");
console.log("PASS full-project cost breakdown, exact material substitution, failure/yield boundaries, fresh comparable filtering and automatic decision brief");
