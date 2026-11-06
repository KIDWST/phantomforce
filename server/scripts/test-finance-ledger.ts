import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  const forgedMetadata = {
    id: "forged-id",
    tenantId: "different-tenant",
    source: "provider_sync",
    reconciliationStatus: "reconciled",
    reconciledAt: "2001-01-01T00:00:00.000Z",
    reconciledBy: "forged-reviewer",
    voidedAt: "2001-01-01T00:00:00.000Z",
    voidedBy: "forged-voider",
    createdAt: "2001-01-01T00:00:00.000Z",
    createdBy: "forged-creator",
    fingerprint: "forged-fingerprint",
  };
  const bookkeepingInput = {
    date: "2026-07-24", description: "Owner-entered bank row", amountMinor: 12345,
    currency: "USD", category: "Transfers", account: "Business checking",
    sourceReference: "customer-supplied-row-reference", testMode: true,
  };
  const beforeCreate = Date.now();
  const manual = await addFinanceTransaction({
    tenantId: "org-provenance", actor: "signed-in-actor", root,
    transaction: { ...bookkeepingInput, ...forgedMetadata },
  });
  function assertFreshMetadata(transaction: typeof manual.result.transaction, source: "manual" | "file_import") {
    assert.equal(transaction.tenantId, "org-provenance");
    assert.notEqual(transaction.id, forgedMetadata.id, "New identity must be generated by the server");
    assert.equal(transaction.source, source, "The write path decides provenance, not caller claims");
    assert.equal(transaction.reconciliationStatus, "unreconciled");
    assert.equal(transaction.reconciledAt, null);
    assert.equal(transaction.reconciledBy, null);
    assert.equal(transaction.voidedAt, null);
    assert.equal(transaction.voidedBy, null);
    assert.equal(transaction.createdBy, "signed-in-actor");
    assert.ok(Date.parse(transaction.createdAt) >= beforeCreate && Date.parse(transaction.createdAt) <= Date.now());
    assert.notEqual(transaction.fingerprint, forgedMetadata.fingerprint);
    assert.equal(transaction.date, bookkeepingInput.date);
    assert.equal(transaction.description, bookkeepingInput.description);
    assert.equal(transaction.amountMinor, bookkeepingInput.amountMinor);
    assert.equal(transaction.currency, bookkeepingInput.currency);
    assert.equal(transaction.category, bookkeepingInput.category);
    assert.equal(transaction.account, bookkeepingInput.account);
    assert.equal(transaction.sourceReference, bookkeepingInput.sourceReference, "References remain bookkeeping deduplication inputs");
    assert.equal(transaction.testMode, true);
  }
  assertFreshMetadata(manual.result.transaction, "manual");
  const repeatManual = await addFinanceTransaction({
    tenantId: "org-provenance", actor: "signed-in-actor", root,
    transaction: { ...bookkeepingInput, ...forgedMetadata, source: "file_import", id: "another-forged-id" },
  });
  assert.equal(repeatManual.result.duplicate, true, "Forged source or audit fields cannot bypass manual deduplication");
  assert.equal(repeatManual.result.transaction.id, manual.result.transaction.id);

  const imported = await importFinanceTransactions({
    tenantId: "org-provenance", actor: "signed-in-actor", root,
    idempotencyKey: "provenance-import", sourceName: "untrusted-export.csv",
    transactions: [{ ...bookkeepingInput, ...forgedMetadata }],
  });
  const importedTransaction = imported.document.transactions.find((transaction) => transaction.id === imported.result.transactionIds[0]);
  assert.ok(importedTransaction);
  assertFreshMetadata(importedTransaction, "file_import");
  const replayImport = await importFinanceTransactions({
    tenantId: "org-provenance", actor: "signed-in-actor", root,
    idempotencyKey: "provenance-import", sourceName: "renamed-export.csv",
    transactions: [{ ...bookkeepingInput, ...forgedMetadata, reconciliationStatus: "matched" }],
  });
  assert.deepEqual(replayImport.result.transactionIds, imported.result.transactionIds);
  const reviewed = await reconcileFinanceTransaction({
    tenantId: "org-provenance", actor: "real-reviewer", root,
    transactionId: manual.result.transaction.id, status: "reconciled",
  });
  assert.equal(reviewed.result.reconciliationStatus, "reconciled", "The dedicated review action remains available");
  assert.equal(reviewed.result.reconciledBy, "real-reviewer");
  const afterReload = await getFinanceLedger("org-provenance", "reader", root);
  assert.equal(afterReload.transactions.find((transaction) => transaction.id === manual.result.transaction.id)?.reconciledBy, "real-reviewer");

  // Existing stored provenance is preserved on read; this fix constrains fresh
  // untrusted writes rather than rewriting historical ledger evidence.
  const legacy = structuredClone(reviewed.document);
  legacy.transactions[0].source = "provider_sync";
  legacy.transactions[0].createdBy = "historical-adapter";
  await writeFile(reviewed.path, JSON.stringify(legacy), "utf8");
  const legacyReload = await getFinanceLedger("org-provenance", "reader", root);
  assert.equal(legacyReload.transactions[0].source, "provider_sync");
  assert.equal(legacyReload.transactions[0].createdBy, "historical-adapter");
  assert.equal(legacyReload.transactions[0].reconciledBy, "real-reviewer");

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
    callerProvenanceIgnored: true,
    serverOwnedAuditMetadata: true,
    historicalReadPreserved: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
