import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addFinanceTransaction,
  getFinanceLedger,
  importFinanceTransactions,
  publicFinanceLedger,
  reconcileFinanceTransaction,
  voidFinanceTransaction,
} from "../src/finance/finance-ledger-store.js";

const root = await mkdtemp(join(tmpdir(), "phantomforce-finance-ledger-"));

try {
  const empty = publicFinanceLedger(await getFinanceLedger("org-empty", "owner", root));
  assert.deepEqual(empty.summary, {
    hasData: false,
    currency: null,
    cashInMinor: null,
    cashOutMinor: null,
    netMinor: null,
    transactionCount: 0,
    testTransactionCount: 0,
    unreconciledCount: 0,
  }, "an empty ledger must remain unknown instead of inventing zero-dollar results");

  const income = await addFinanceTransaction({
    tenantId: "org-a",
    actor: "owner@example.test",
    root,
    transaction: {
      date: "2026-07-23",
      description: "Paiement client – Montréal",
      amountMinor: 1001,
      currency: "cad",
      category: "Sales",
      account: "Business checking",
      sourceReference: "manual-income-1",
    },
  });
  assert.equal(income.result.created, true);

  const expense = await addFinanceTransaction({
    tenantId: "org-a",
    actor: "owner@example.test",
    root,
    transaction: {
      date: "2026-07-23",
      description: "Fournisseur 東京",
      amount: -2.35,
      currency: "CAD",
      category: "Supplies",
      account: "Business checking",
      sourceReference: "manual-expense-1",
    },
  });
  assert.equal(expense.result.transaction.amountMinor, -235, "decimal input must be normalized once into minor units");

  const duplicate = await addFinanceTransaction({
    tenantId: "org-a",
    actor: "owner@example.test",
    root,
    transaction: {
      date: "2026-07-23",
      description: "Paiement client – Montréal",
      amountMinor: 1001,
      currency: "CAD",
      category: "Sales",
      account: "Business checking",
      sourceReference: "manual-income-1",
    },
  });
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.result.transaction.id, income.result.transaction.id);

  const firstImport = await importFinanceTransactions({
    tenantId: "org-a",
    actor: "owner@example.test",
    idempotencyKey: "sha256:file-a",
    sourceName: "bank-export.csv",
    root,
    transactions: [
      {
        date: "2026-07-22",
        description: "Consulting deposit",
        amountMinor: 5000,
        currency: "CAD",
        account: "Business checking",
        sourceReference: "bank-row-1",
      },
      {
        date: "2026-07-22",
        description: "Consulting deposit",
        amountMinor: 5000,
        currency: "CAD",
        account: "Business checking",
        sourceReference: "bank-row-1",
      },
      {
        date: "2026-07-22",
        description: "Sandbox transaction",
        amountMinor: 999_999,
        currency: "CAD",
        account: "Test account",
        sourceReference: "test-row-1",
        testMode: true,
      },
    ],
  });
  assert.equal(firstImport.result.received, 3);
  assert.equal(firstImport.result.created, 2);
  assert.equal(firstImport.result.duplicates, 1);

  const repeatedImport = await importFinanceTransactions({
    tenantId: "org-a",
    actor: "owner@example.test",
    idempotencyKey: "sha256:file-a",
    sourceName: "renamed-export.csv",
    root,
    transactions: [{ amountMinor: 1234, description: "must not be inserted" }],
  });
  assert.equal(repeatedImport.result.id, firstImport.result.id, "an import retry must return the persisted batch");

  const reconciled = await reconcileFinanceTransaction({
    tenantId: "org-a",
    actor: "bookkeeper@example.test",
    transactionId: expense.result.transaction.id,
    status: "reconciled",
    root,
  });
  assert.equal(reconciled.result.reconciliationStatus, "reconciled");
  assert.equal(reconciled.result.reconciledBy, "bookkeeper@example.test");
  assert.ok(reconciled.result.reconciledAt);

  let ledger = publicFinanceLedger(await getFinanceLedger("org-a", "owner@example.test", root));
  assert.equal(ledger.summary.currency, "CAD");
  assert.equal(ledger.summary.cashInMinor, 6001);
  assert.equal(ledger.summary.cashOutMinor, 235);
  assert.equal(ledger.summary.netMinor, 5766);
  assert.equal(ledger.summary.testTransactionCount, 1, "test money must be counted separately");
  assert.equal(ledger.summary.transactionCount, 3, "test money must not enter actual transaction totals");
  assert.equal(ledger.transactions.find((transaction) => transaction.id === expense.result.transaction.id)?.reconciliationStatus, "reconciled");

  const voided = await voidFinanceTransaction({
    tenantId: "org-a",
    actor: "owner@example.test",
    transactionId: income.result.transaction.id,
    root,
  });
  assert.ok(voided.result.voidedAt);
  ledger = publicFinanceLedger(await getFinanceLedger("org-a", "owner@example.test", root));
  assert.equal(ledger.summary.cashInMinor, 5000, "voided records must remain auditable but leave actual totals");
  assert.ok(ledger.transactions.some((transaction) => transaction.id === income.result.transaction.id && transaction.voidedAt));

  const otherTenant = publicFinanceLedger(await getFinanceLedger("org-b", "other@example.test", root));
  assert.equal(otherTenant.transactions.length, 0, "tenant ledgers must not share records");
  assert.notEqual(otherTenant.checksum, ledger.checksum);

  console.log(JSON.stringify({
    ok: true,
    product: "Accounting ledger",
    minorUnitArithmetic: true,
    unknownVsZero: true,
    duplicateSuppression: true,
    importIdempotency: true,
    testDataExcluded: true,
    reconciliationPersisted: true,
    voidAuditPreserved: true,
    internationalData: true,
    tenantIsolation: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
