import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type FinanceSource = "manual" | "file_import" | "provider_sync";
export type ReconciliationStatus = "unreconciled" | "matched" | "reconciled";

export type FinanceTransaction = {
  id: string;
  tenantId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  category: string;
  account: string;
  source: FinanceSource;
  sourceReference: string | null;
  fingerprint: string;
  testMode: boolean;
  reconciliationStatus: ReconciliationStatus;
  reconciledAt: string | null;
  reconciledBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  createdAt: string;
  createdBy: string;
};

export type FinanceImportBatch = {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  sourceName: string;
  received: number;
  created: number;
  duplicates: number;
  transactionIds: string[];
  createdAt: string;
  createdBy: string;
};

export type FinanceAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  transactionId: string | null;
  eventType: "transaction_created" | "transaction_voided" | "transactions_imported" | "transaction_reconciled";
  summary: string;
  createdAt: string;
};

export type FinanceLedgerDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  transactions: FinanceTransaction[];
  importBatches: FinanceImportBatch[];
  audit: FinanceAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/finance-ledger");
const locks = new Map<string, Promise<unknown>>();

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function safeTenantId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanCurrency(value: unknown) {
  const currency = cleanText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/u.test(currency) ? currency : "USD";
}

function cleanDate(value: unknown) {
  const text = cleanText(value, 40);
  const parsed = text ? new Date(text) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function cleanAmountMinor(value: unknown, fallback: unknown) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct !== 0) return Math.max(-100_000_000_000, Math.min(100_000_000_000, direct));
  const amount = Number(fallback);
  if (!Number.isFinite(amount) || amount === 0) return null;
  return Math.max(-100_000_000_000, Math.min(100_000_000_000, Math.round(amount * 100)));
}

function canonicalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function transactionFingerprint(input: Pick<FinanceTransaction, "date" | "description" | "amountMinor" | "currency" | "account" | "source" | "sourceReference" | "testMode">) {
  return canonicalHash({
    source: input.source,
    sourceReference: input.sourceReference || null,
    date: input.date,
    description: input.description.toLowerCase(),
    amountMinor: input.amountMinor,
    currency: input.currency,
    account: input.account.toLowerCase(),
    testMode: input.testMode,
  });
}

function normalizeTransaction(value: unknown, tenantId: string, actor: string, existing?: FinanceTransaction): FinanceTransaction | null {
  const source = isRecord(value) ? value : {};
  const amountMinor = cleanAmountMinor(source.amountMinor ?? existing?.amountMinor, source.amount ?? (existing ? existing.amountMinor / 100 : undefined));
  if (!amountMinor) return null;
  const transaction: FinanceTransaction = {
    id: cleanText(existing?.id ?? source.id, 90) || randomUUID(),
    tenantId: safeTenantId(tenantId),
    date: cleanDate(source.date ?? existing?.date),
    description: cleanText(source.description ?? existing?.description, 180) || "Transaction",
    amountMinor,
    currency: cleanCurrency(source.currency ?? existing?.currency),
    category: cleanText(source.category ?? existing?.category, 100) || "Uncategorized",
    account: cleanText(source.account ?? existing?.account, 120) || "Manual ledger",
    source: ["manual", "file_import", "provider_sync"].includes(String(source.source ?? existing?.source))
      ? String(source.source ?? existing?.source) as FinanceSource
      : "manual",
    sourceReference: cleanText(source.sourceReference ?? source.externalId ?? existing?.sourceReference, 200) || null,
    fingerprint: "",
    testMode: Boolean(source.testMode ?? existing?.testMode),
    reconciliationStatus: ["unreconciled", "matched", "reconciled"].includes(String(source.reconciliationStatus ?? existing?.reconciliationStatus))
      ? String(source.reconciliationStatus ?? existing?.reconciliationStatus) as ReconciliationStatus
      : "unreconciled",
    reconciledAt: cleanText(existing?.reconciledAt ?? source.reconciledAt, 80) || null,
    reconciledBy: cleanText(existing?.reconciledBy ?? source.reconciledBy, 120) || null,
    voidedAt: cleanText(existing?.voidedAt ?? source.voidedAt, 80) || null,
    voidedBy: cleanText(existing?.voidedBy ?? source.voidedBy, 120) || null,
    createdAt: cleanText(existing?.createdAt ?? source.createdAt, 80) || new Date().toISOString(),
    createdBy: cleanText(existing?.createdBy ?? source.createdBy ?? actor, 120) || "system",
  };
  transaction.fingerprint = transactionFingerprint(transaction);
  return transaction;
}

function documentWithChecksum(document: Omit<FinanceLedgerDocument, "checksum">): FinanceLedgerDocument {
  return { ...document, checksum: canonicalHash(document) };
}

export function financeLedgerRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_FINANCE_LEDGER_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(financeLedgerRoot(root), `${safeTenantId(tenantId)}.json`);
}

function defaultDocument(tenantId: string, actor: string): FinanceLedgerDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({
    schemaVersion: 1,
    tenantId: safeTenantId(tenantId),
    version: 1,
    transactions: [],
    importBatches: [],
    audit: [],
    updatedAt: now,
    updatedBy: actor,
  });
}

async function readDocument(tenantId: string, root?: string): Promise<FinanceLedgerDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as FinanceLedgerDocument;
    const authoritativeTenant = safeTenantId(raw.tenantId || tenantId);
    return documentWithChecksum({
      schemaVersion: 1,
      tenantId: authoritativeTenant,
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      transactions: Array.isArray(raw.transactions)
        ? raw.transactions.map((transaction) => normalizeTransaction(transaction, authoritativeTenant, transaction.createdBy || "system", transaction)).filter((transaction): transaction is FinanceTransaction => Boolean(transaction))
        : [],
      importBatches: Array.isArray(raw.importBatches) ? raw.importBatches.slice(-250) : [],
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-500) : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function getFinanceLedger(tenantId: string, actor = "system", root?: string) {
  return await readDocument(tenantId, root) ?? defaultDocument(tenantId, actor);
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>) {
  const key = safeTenantId(tenantId);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

function audit(document: FinanceLedgerDocument, actor: string, transactionId: string | null, eventType: FinanceAuditEntry["eventType"], summary: string) {
  document.audit.push({
    id: randomUUID(),
    tenantId: document.tenantId,
    actor,
    transactionId,
    eventType,
    summary: summary.slice(0, 240),
    createdAt: new Date().toISOString(),
  });
}

async function mutate<T>(tenantId: string, actor: string, operation: (document: FinanceLedgerDocument) => T, root?: string) {
  return withTenantLock(tenantId, async () => {
    const current = await getFinanceLedger(tenantId, actor, root);
    const result = operation(current);
    const document = documentWithChecksum({
      schemaVersion: 1,
      tenantId: current.tenantId,
      version: current.version + 1,
      transactions: current.transactions.slice(0, 10_000),
      importBatches: current.importBatches.slice(-250),
      audit: current.audit.slice(-500),
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    });
    const path = documentPath(document.tenantId, root);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return { path, document, result };
  });
}

export async function addFinanceTransaction(options: { tenantId: string; actor: string; transaction: unknown; root?: string }) {
  return mutate(options.tenantId, options.actor, (document) => {
    const transaction = normalizeTransaction(options.transaction, document.tenantId, options.actor);
    if (!transaction) throw new Error("transaction_amount_required");
    const existing = document.transactions.find((candidate) => candidate.fingerprint === transaction.fingerprint);
    if (existing) return { transaction: existing, created: false, duplicate: true };
    document.transactions.unshift(transaction);
    audit(document, options.actor, transaction.id, "transaction_created", `Recorded ${transaction.description}`);
    return { transaction, created: true, duplicate: false };
  }, options.root);
}

export async function importFinanceTransactions(options: {
  tenantId: string;
  actor: string;
  idempotencyKey: string;
  sourceName: string;
  transactions: unknown[];
  root?: string;
}) {
  return mutate(options.tenantId, options.actor, (document) => {
    const key = cleanText(options.idempotencyKey, 180);
    if (!key) throw new Error("import_idempotency_key_required");
    const previous = document.importBatches.find((batch) => batch.idempotencyKey === key);
    if (previous) return previous;
    const known = new Set(document.transactions.map((transaction) => transaction.fingerprint));
    const transactionIds: string[] = [];
    let duplicates = 0;
    options.transactions.slice(0, 5_000).forEach((raw) => {
      const normalized = normalizeTransaction({ ...(isRecord(raw) ? raw : {}), source: "file_import" }, document.tenantId, options.actor);
      if (!normalized) return;
      if (known.has(normalized.fingerprint)) {
        duplicates += 1;
        return;
      }
      known.add(normalized.fingerprint);
      document.transactions.push(normalized);
      transactionIds.push(normalized.id);
    });
    const batch: FinanceImportBatch = {
      id: randomUUID(),
      tenantId: document.tenantId,
      idempotencyKey: key,
      sourceName: cleanText(options.sourceName, 160) || "Imported file",
      received: options.transactions.length,
      created: transactionIds.length,
      duplicates,
      transactionIds,
      createdAt: new Date().toISOString(),
      createdBy: options.actor,
    };
    document.importBatches.push(batch);
    audit(document, options.actor, null, "transactions_imported", `Imported ${batch.created} transactions from ${batch.sourceName}; ${batch.duplicates} duplicates skipped`);
    return batch;
  }, options.root);
}

export async function reconcileFinanceTransaction(options: { tenantId: string; actor: string; transactionId: string; status: ReconciliationStatus; root?: string }) {
  return mutate(options.tenantId, options.actor, (document) => {
    const transaction = document.transactions.find((candidate) => candidate.id === options.transactionId && !candidate.voidedAt);
    if (!transaction) throw new Error("transaction_not_found");
    transaction.reconciliationStatus = options.status;
    transaction.reconciledAt = options.status === "reconciled" ? new Date().toISOString() : null;
    transaction.reconciledBy = options.status === "reconciled" ? options.actor : null;
    audit(document, options.actor, transaction.id, "transaction_reconciled", `Set reconciliation to ${options.status} for ${transaction.description}`);
    return transaction;
  }, options.root);
}

export async function voidFinanceTransaction(options: { tenantId: string; actor: string; transactionId: string; root?: string }) {
  return mutate(options.tenantId, options.actor, (document) => {
    const transaction = document.transactions.find((candidate) => candidate.id === options.transactionId);
    if (!transaction) throw new Error("transaction_not_found");
    if (!transaction.voidedAt) {
      transaction.voidedAt = new Date().toISOString();
      transaction.voidedBy = options.actor;
      audit(document, options.actor, transaction.id, "transaction_voided", `Voided ${transaction.description}`);
    }
    return transaction;
  }, options.root);
}

export function financeLedgerSummary(document: FinanceLedgerDocument) {
  const actual = document.transactions.filter((transaction) => !transaction.voidedAt && !transaction.testMode);
  if (actual.length === 0) {
    return {
      hasData: false,
      currency: null,
      cashInMinor: null,
      cashOutMinor: null,
      netMinor: null,
      transactionCount: 0,
      testTransactionCount: document.transactions.filter((transaction) => !transaction.voidedAt && transaction.testMode).length,
      unreconciledCount: 0,
    };
  }
  const currencies = [...new Set(actual.map((transaction) => transaction.currency))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  const cashInMinor = actual.filter((transaction) => transaction.amountMinor > 0).reduce((sum, transaction) => sum + transaction.amountMinor, 0);
  const cashOutMinor = actual.filter((transaction) => transaction.amountMinor < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amountMinor), 0);
  return {
    hasData: true,
    currency,
    cashInMinor: currency ? cashInMinor : null,
    cashOutMinor: currency ? cashOutMinor : null,
    netMinor: currency ? cashInMinor - cashOutMinor : null,
    transactionCount: actual.length,
    testTransactionCount: document.transactions.filter((transaction) => !transaction.voidedAt && transaction.testMode).length,
    unreconciledCount: actual.filter((transaction) => transaction.reconciliationStatus !== "reconciled").length,
  };
}

export function publicFinanceLedger(document: FinanceLedgerDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    version: document.version,
    transactions: document.transactions,
    importBatches: document.importBatches.slice(-25),
    audit: document.audit.slice(-50),
    summary: financeLedgerSummary(document),
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}
