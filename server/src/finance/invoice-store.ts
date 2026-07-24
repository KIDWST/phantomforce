/*
 * Invoice store — per-tenant JSON documents with the same durability contract
 * as the finance ledger store next to it (tenant lock + atomic temp-file
 * rename + checksum + audit trail). PhantomBot creates invoices here from chat
 * ("invoice Acme $1,200 for the June retainer") and from analyzed documents
 * (drop a receipt, turn it into a billable invoice). The host never emails or
 * charges anything — it only persists structured invoice data; sending stays a
 * separate, approval-gated action.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type InvoiceSource = "manual" | "phantom_ai" | "document_analysis";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
};

export type Invoice = {
  id: string;
  number: string;
  tenantId: string;
  status: InvoiceStatus;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  lineItems: InvoiceLineItem[];
  subtotalMinor: number;
  taxRatePct: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  notes: string;
  source: InvoiceSource;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type InvoiceAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  invoiceId: string | null;
  eventType: "invoice_created" | "invoice_status_changed" | "invoice_updated";
  summary: string;
  createdAt: string;
};

export type InvoiceDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  counter: number;
  invoices: Invoice[];
  audit: InvoiceAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/invoices");
const locks = new Map<string, Promise<unknown>>();

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function cleanMultiline(value: unknown, max = 600) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
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
function cleanDate(value: unknown, fallbackDaysFromNow = 0) {
  const text = cleanText(value, 40);
  const parsed = text ? new Date(text) : new Date(Date.now() + fallbackDaysFromNow * 86_400_000);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : new Date(Date.now() + fallbackDaysFromNow * 86_400_000).toISOString().slice(0, 10);
}
function toMinor(value: unknown): number {
  const direct = Number(value);
  if (!Number.isFinite(direct)) return 0;
  // heuristic: integers that are clearly already minor units are preserved by
  // callers passing *Minor fields; this helper always treats input as major.
  return Math.round(direct * 100);
}
function clampMinor(v: number) {
  return Math.max(-100_000_000_000, Math.min(100_000_000_000, Math.round(v)));
}
function canonicalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function documentWithChecksum(document: Omit<InvoiceDocument, "checksum">): InvoiceDocument {
  return { ...document, checksum: canonicalHash(document) };
}

export function invoiceStoreRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_INVOICE_DIR || defaultRoot);
}
function documentPath(tenantId: string, root?: string) {
  return resolve(invoiceStoreRoot(root), `${safeTenantId(tenantId)}.json`);
}

function normalizeLineItem(value: unknown): InvoiceLineItem {
  const source = isRecord(value) ? value : {};
  const description = cleanText(source.description ?? source.item ?? source.name, 180) || "Service";
  const quantity = Math.max(0.01, Math.min(100_000, Number(source.quantity ?? source.qty ?? 1) || 1));
  const unitPriceMinor = Number.isInteger(Number(source.unitPriceMinor))
    ? clampMinor(Number(source.unitPriceMinor))
    : clampMinor(toMinor(source.unitPrice ?? source.rate ?? source.price ?? 0));
  const amountMinor = Number.isInteger(Number(source.amountMinor)) && Number(source.amountMinor) !== 0
    ? clampMinor(Number(source.amountMinor))
    : clampMinor(unitPriceMinor * quantity);
  return { description, quantity: Math.round(quantity * 100) / 100, unitPriceMinor, amountMinor };
}

function normalizeInvoice(value: unknown, tenantId: string, actor: string, number: string, existing?: Invoice): Invoice {
  const source = isRecord(value) ? value : {};
  const rawItems = Array.isArray(source.lineItems) ? source.lineItems
    : Array.isArray(source.items) ? source.items
    : [];
  let lineItems = rawItems.slice(0, 100).map(normalizeLineItem).filter((li) => li.amountMinor !== 0 || li.description);
  if (lineItems.length === 0) {
    // Allow a shorthand single-line invoice: {amount, description}
    const amountMinor = Number.isInteger(Number(source.amountMinor))
      ? clampMinor(Number(source.amountMinor))
      : clampMinor(toMinor(source.amount ?? source.total ?? 0));
    lineItems = [{ description: cleanText(source.description ?? "Services rendered", 180) || "Services rendered", quantity: 1, unitPriceMinor: amountMinor, amountMinor }];
  }
  const subtotalMinor = clampMinor(lineItems.reduce((sum, li) => sum + li.amountMinor, 0));
  const taxRatePct = Math.max(0, Math.min(100, Number(source.taxRatePct ?? source.taxRate ?? 0) || 0));
  const taxMinor = clampMinor(subtotalMinor * (taxRatePct / 100));
  const discountMinor = clampMinor(Number.isInteger(Number(source.discountMinor)) ? Number(source.discountMinor) : toMinor(source.discount ?? 0));
  const totalMinor = clampMinor(subtotalMinor + taxMinor - discountMinor);
  const status: InvoiceStatus = ["draft", "sent", "paid", "void"].includes(String(source.status ?? existing?.status))
    ? (String(source.status ?? existing?.status) as InvoiceStatus)
    : "draft";
  const src: InvoiceSource = ["manual", "phantom_ai", "document_analysis"].includes(String(source.source ?? existing?.source))
    ? (String(source.source ?? existing?.source) as InvoiceSource)
    : "manual";
  return {
    id: cleanText(existing?.id ?? source.id, 90) || randomUUID(),
    number: existing?.number || number,
    tenantId: safeTenantId(tenantId),
    status,
    clientName: cleanText(source.clientName ?? source.client ?? existing?.clientName, 160) || "Client",
    clientEmail: cleanText(source.clientEmail ?? source.email ?? existing?.clientEmail, 160),
    clientAddress: cleanMultiline(source.clientAddress ?? source.address ?? existing?.clientAddress, 400),
    issueDate: cleanDate(source.issueDate ?? existing?.issueDate),
    dueDate: cleanDate(source.dueDate ?? existing?.dueDate, 14),
    currency: cleanCurrency(source.currency ?? existing?.currency),
    lineItems,
    subtotalMinor,
    taxRatePct: Math.round(taxRatePct * 100) / 100,
    taxMinor,
    discountMinor,
    totalMinor,
    notes: cleanMultiline(source.notes ?? existing?.notes, 800),
    source: src,
    createdAt: cleanText(existing?.createdAt ?? source.createdAt, 80) || new Date().toISOString(),
    createdBy: cleanText(existing?.createdBy ?? actor, 120) || "system",
    updatedAt: new Date().toISOString(),
  };
}

function defaultDocument(tenantId: string, actor: string): InvoiceDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({ schemaVersion: 1, tenantId: safeTenantId(tenantId), version: 1, counter: 0, invoices: [], audit: [], updatedAt: now, updatedBy: actor });
}

async function readDocument(tenantId: string, root?: string): Promise<InvoiceDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as InvoiceDocument;
    const authoritativeTenant = safeTenantId(raw.tenantId || tenantId);
    const invoices = Array.isArray(raw.invoices)
      ? raw.invoices.map((inv) => normalizeInvoice(inv, authoritativeTenant, inv?.createdBy || "system", inv?.number || "", inv)).slice(0, 5_000)
      : [];
    return documentWithChecksum({
      schemaVersion: 1,
      tenantId: authoritativeTenant,
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      counter: Number.isInteger(raw.counter) && raw.counter >= 0 ? raw.counter : invoices.length,
      invoices,
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-500) : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function getInvoiceDocument(tenantId: string, actor = "system", root?: string) {
  return (await readDocument(tenantId, root)) ?? defaultDocument(tenantId, actor);
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>) {
  const key = safeTenantId(tenantId);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

function audit(document: InvoiceDocument, actor: string, invoiceId: string | null, eventType: InvoiceAuditEntry["eventType"], summary: string) {
  document.audit.push({ id: randomUUID(), tenantId: document.tenantId, actor, invoiceId, eventType, summary: summary.slice(0, 240), createdAt: new Date().toISOString() });
}

async function mutate<T>(tenantId: string, actor: string, operation: (document: InvoiceDocument) => T, root?: string) {
  return withTenantLock(tenantId, async () => {
    const current = await getInvoiceDocument(tenantId, actor, root);
    const working: Omit<InvoiceDocument, "checksum"> = {
      schemaVersion: 1, tenantId: current.tenantId, version: current.version + 1, counter: current.counter,
      invoices: current.invoices.slice(0, 5_000), audit: current.audit.slice(-500),
      updatedAt: new Date().toISOString(), updatedBy: actor,
    };
    const result = operation(working as InvoiceDocument);
    const document = documentWithChecksum(working);
    const path = documentPath(document.tenantId, root);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return { path, document, result };
  });
}

function nextNumber(document: InvoiceDocument) {
  const year = new Date().getFullYear();
  document.counter += 1;
  return `INV-${year}-${String(document.counter).padStart(4, "0")}`;
}

export async function createInvoice(options: { tenantId: string; actor: string; invoice: unknown; root?: string }) {
  return mutate(options.tenantId, options.actor, (document) => {
    const number = nextNumber(document);
    const invoice = normalizeInvoice(options.invoice, document.tenantId, options.actor, number);
    document.invoices.unshift(invoice);
    audit(document, options.actor, invoice.id, "invoice_created", `Created ${invoice.number} for ${invoice.clientName} — ${(invoice.totalMinor / 100).toFixed(2)} ${invoice.currency}`);
    return { invoice, created: true };
  }, options.root);
}

export async function setInvoiceStatus(options: { tenantId: string; actor: string; invoiceId: string; status: InvoiceStatus; root?: string }) {
  return mutate(options.tenantId, options.actor, (document) => {
    const invoice = document.invoices.find((inv) => inv.id === options.invoiceId || inv.number === options.invoiceId);
    if (!invoice) throw new Error("invoice_not_found");
    if (!["draft", "sent", "paid", "void"].includes(options.status)) throw new Error("invalid_invoice_status");
    invoice.status = options.status;
    invoice.updatedAt = new Date().toISOString();
    audit(document, options.actor, invoice.id, "invoice_status_changed", `${invoice.number} → ${options.status}`);
    return { invoice };
  }, options.root);
}

export function publicInvoices(document: InvoiceDocument) {
  return {
    tenantId: document.tenantId,
    version: document.version,
    updatedAt: document.updatedAt,
    invoices: document.invoices,
    summary: invoiceSummary(document),
  };
}

export function invoiceSummary(document: InvoiceDocument) {
  const counts: Record<InvoiceStatus, number> = { draft: 0, sent: 0, paid: 0, void: 0 };
  let outstandingMinor = 0, paidMinor = 0;
  const currency = document.invoices[0]?.currency || "USD";
  for (const inv of document.invoices) {
    counts[inv.status] = (counts[inv.status] || 0) + 1;
    if (inv.status === "sent" || inv.status === "draft") outstandingMinor += inv.totalMinor;
    if (inv.status === "paid") paidMinor += inv.totalMinor;
  }
  return { total: document.invoices.length, counts, outstandingMinor, paidMinor, currency };
}
