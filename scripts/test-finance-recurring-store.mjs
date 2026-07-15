// scripts/test-finance-recurring-store.mjs
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { store, moneyView } = await import("../app/js/store.js");

// A freshly-seeded store has an empty recurringRules array
assert.deepEqual(store.state.finance.recurringRules, []);

// normalizeFinance backfills defaults for a rule missing optional fields
store.state.finance.recurringRules.push({
  id: "rule-1",
  ws: "phantomforce",
  description: "Contractor payment",
  amount: 500,
  direction: "expense",
  category: "Contractors",
  account: "Manual ledger",
  frequency: "weekly",
  startDate: "2026-04-01",
});

// Re-read through moneyView, which forces ensureFinance()/normalizeFinance()
// to re-normalize the current in-memory state. No reload from localStorage
// is needed here -- normalizeFinance always re-runs on the live object on
// every call, whether or not state was ever null.
const view = moneyView();
const normalized = view.recurringRules.find((r) => r.id === "rule-1");
assert.ok(normalized, "recurring rule should survive normalization");
assert.equal(normalized.status, "active", "status should default to active");
assert.equal(normalized.lastGeneratedDate, null, "lastGeneratedDate should default to null");
assert.equal(normalized.source, "manual", "source should default to manual");
assert.equal(normalized.intervalDays, null, "intervalDays should default to null for non-custom-days frequency");

// Transaction normalization backfills the new optional fields
store.state.finance.transactions.push({ id: "txn-1", ws: "phantomforce", date: "2026-04-01", description: "Contractor", amount: -500, category: "Contractors", account: "Manual ledger", source: "ai-parsed" });
store.save();
const txView = moneyView();
const tx = txView.transactions.find((t) => t.id === "txn-1");
assert.equal(tx.receiptAssetId, null);
assert.equal(tx.recurringRuleId, null);
assert.equal(tx.aiAssisted, false);

console.log(JSON.stringify({ ok: true, suite: "finance-recurring-store" }));
