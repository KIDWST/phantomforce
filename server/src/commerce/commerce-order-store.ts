import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CommerceMode = "test" | "live";
export type CommerceOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "fulfillment_pending"
  | "fulfilled"
  | "partially_refunded"
  | "refunded"
  | "cancelled";

export type CommerceLineItem = {
  productId: string;
  name: string;
  type: "physical" | "digital";
  unitAmountMinor: number;
  quantity: number;
  lineTotalMinor: number;
};

export type CommerceOrder = {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  mode: CommerceMode;
  currency: string;
  items: CommerceLineItem[];
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  shippingRequired: boolean;
  shippingAddress: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  } | null;
  buyerEmail: string;
  status: CommerceOrderStatus;
  paidMinor: number;
  refundedMinor: number;
  provider: string | null;
  providerPaymentId: string | null;
  fulfillmentNote: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type CommerceEventReceipt = {
  id: string;
  tenantId: string;
  provider: string;
  providerEventId: string;
  orderId: string;
  eventType: "payment_succeeded" | "refund_succeeded";
  amountMinor: number;
  signatureVerified: true;
  applied: boolean;
  resultStatus: CommerceOrderStatus;
  receivedAt: string;
};

export type CommerceAuditEntry = {
  id: string;
  tenantId: string;
  orderId: string;
  actor: string;
  action: "order_created" | "provider_event_applied" | "fulfillment_updated" | "order_cancelled";
  summary: string;
  createdAt: string;
};

export type CommerceOrderDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  orders: CommerceOrder[];
  eventReceipts: CommerceEventReceipt[];
  audit: CommerceAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/commerce-orders");
const locks = new Map<string, Promise<unknown>>();

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function tenantKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function currencyCode(value: unknown) {
  const code = text(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(code)) throw new Error("commerce_currency_required");
  return code;
}

function boundedMinor(value: unknown, label: string, allowZero = true) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 100_000_000_000) {
    throw new Error(`commerce_${label}_minor_invalid`);
  }
  return amount;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withChecksum(document: Omit<CommerceOrderDocument, "checksum">): CommerceOrderDocument {
  return { ...document, checksum: hash(document) };
}

function rootPath(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_COMMERCE_ORDER_DIR || defaultRoot);
}

function filePath(tenantId: string, root?: string) {
  return resolve(rootPath(root), `${tenantKey(tenantId)}.json`);
}

function defaultDocument(tenantId: string, actor: string): CommerceOrderDocument {
  const now = new Date().toISOString();
  return withChecksum({
    schemaVersion: 1,
    tenantId: tenantKey(tenantId),
    version: 1,
    orders: [],
    eventReceipts: [],
    audit: [],
    updatedAt: now,
    updatedBy: actor,
  });
}

async function readDocument(tenantId: string, root?: string): Promise<CommerceOrderDocument | null> {
  try {
    const raw = JSON.parse(await readFile(filePath(tenantId, root), "utf8")) as CommerceOrderDocument;
    if (tenantKey(raw.tenantId) !== tenantKey(tenantId)) throw new Error("commerce_tenant_mismatch");
    return withChecksum({
      schemaVersion: 1,
      tenantId: tenantKey(tenantId),
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      orders: Array.isArray(raw.orders) ? raw.orders : [],
      eventReceipts: Array.isArray(raw.eventReceipts) ? raw.eventReceipts.slice(-2_000) : [],
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-2_000) : [],
      updatedAt: text(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: text(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function getCommerceOrders(tenantId: string, actor = "system", root?: string) {
  return await readDocument(tenantId, root) ?? defaultDocument(tenantId, actor);
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>) {
  const key = tenantKey(tenantId);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

function addAudit(document: CommerceOrderDocument, orderId: string, actor: string, action: CommerceAuditEntry["action"], summary: string) {
  document.audit.push({
    id: randomUUID(),
    tenantId: document.tenantId,
    orderId,
    actor,
    action,
    summary: summary.slice(0, 240),
    createdAt: new Date().toISOString(),
  });
}

async function mutate<T>(tenantId: string, actor: string, operation: (document: CommerceOrderDocument) => T, root?: string) {
  return withTenantLock(tenantId, async () => {
    const document = await getCommerceOrders(tenantId, actor, root);
    const result = operation(document);
    const next = withChecksum({
      schemaVersion: 1,
      tenantId: document.tenantId,
      version: document.version + 1,
      orders: document.orders.slice(0, 10_000),
      eventReceipts: document.eventReceipts.slice(-2_000),
      audit: document.audit.slice(-2_000),
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    });
    const path = filePath(document.tenantId, root);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return { document: next, result };
  });
}

function normalizeItems(input: unknown) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) throw new Error("commerce_items_required");
  return input.map((raw): CommerceLineItem => {
    const item = record(raw);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("commerce_item_quantity_invalid");
    const unitAmountMinor = boundedMinor(item.unitAmountMinor, "item", false);
    return {
      productId: text(item.productId, 120) || randomUUID(),
      name: text(item.name, 160) || "Product",
      type: item.type === "digital" ? "digital" : "physical",
      unitAmountMinor,
      quantity,
      lineTotalMinor: unitAmountMinor * quantity,
    };
  });
}

function normalizeShipping(value: unknown) {
  const shipping = record(value);
  const result = {
    line1: text(shipping.line1, 160),
    line2: text(shipping.line2, 160),
    city: text(shipping.city, 100),
    region: text(shipping.region, 100),
    postalCode: text(shipping.postalCode, 40),
    country: text(shipping.country, 2).toUpperCase(),
  };
  if (!result.line1 || !result.city || !result.postalCode || !/^[A-Z]{2}$/u.test(result.country)) {
    throw new Error("commerce_shipping_address_required");
  }
  return result;
}

export async function createCommerceOrder(options: {
  tenantId: string;
  actor: string;
  idempotencyKey: string;
  order: unknown;
  root?: string;
}) {
  return mutate(options.tenantId, options.actor, (document) => {
    const idempotencyKey = text(options.idempotencyKey, 180);
    if (!idempotencyKey) throw new Error("commerce_idempotency_key_required");
    const existing = document.orders.find((order) => order.idempotencyKey === idempotencyKey);
    if (existing) return { order: existing, created: false };
    const source = record(options.order);
    const items = normalizeItems(source.items);
    const mode: CommerceMode = source.mode === "live" ? "live" : "test";
    const shippingRequired = items.some((item) => item.type === "physical");
    const shippingMinor = boundedMinor(source.shippingMinor ?? 0, "shipping");
    const taxMinor = boundedMinor(source.taxMinor ?? 0, "tax");
    const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const now = new Date().toISOString();
    const order: CommerceOrder = {
      id: randomUUID(),
      tenantId: document.tenantId,
      idempotencyKey,
      mode,
      currency: currencyCode(source.currency),
      items,
      subtotalMinor,
      shippingMinor: shippingRequired ? shippingMinor : 0,
      taxMinor,
      totalMinor: subtotalMinor + (shippingRequired ? shippingMinor : 0) + taxMinor,
      shippingRequired,
      shippingAddress: shippingRequired ? normalizeShipping(source.shippingAddress) : null,
      buyerEmail: text(source.buyerEmail, 254).toLowerCase(),
      status: "awaiting_payment",
      paidMinor: 0,
      refundedMinor: 0,
      provider: null,
      providerPaymentId: null,
      fulfillmentNote: null,
      createdAt: now,
      createdBy: options.actor,
      updatedAt: now,
      updatedBy: options.actor,
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(order.buyerEmail)) throw new Error("commerce_buyer_email_required");
    document.orders.unshift(order);
    addAudit(document, order.id, options.actor, "order_created", `${mode} order created for ${order.totalMinor} ${order.currency} minor units`);
    return { order, created: true };
  }, options.root);
}

export async function applyVerifiedCommerceEvent(options: {
  tenantId: string;
  provider: string;
  providerEventId: string;
  signatureVerified: boolean;
  orderId: string;
  eventType: "payment_succeeded" | "refund_succeeded";
  amountMinor: number;
  providerPaymentId?: string;
  root?: string;
}) {
  if (!options.signatureVerified) throw new Error("commerce_provider_signature_required");
  const provider = text(options.provider, 80);
  const eventId = text(options.providerEventId, 180);
  if (!provider || !eventId) throw new Error("commerce_provider_event_identity_required");
  return mutate(options.tenantId, `verified-webhook:${provider}`, (document) => {
    const previous = document.eventReceipts.find((receipt) => receipt.provider === provider && receipt.providerEventId === eventId);
    if (previous) {
      const order = document.orders.find((candidate) => candidate.id === previous.orderId);
      if (!order) throw new Error("commerce_event_order_missing");
      return { order, receipt: previous, duplicate: true };
    }
    const order = document.orders.find((candidate) => candidate.id === options.orderId);
    if (!order) throw new Error("commerce_order_not_found");
    const amountMinor = boundedMinor(options.amountMinor, "event_amount", false);
    if (options.eventType === "payment_succeeded") {
      if (amountMinor !== order.totalMinor) throw new Error("commerce_payment_total_mismatch");
      if (order.status !== "awaiting_payment") throw new Error("commerce_payment_state_invalid");
      order.paidMinor = amountMinor;
      order.status = "fulfillment_pending";
      order.provider = provider;
      order.providerPaymentId = text(options.providerPaymentId, 180) || null;
    } else {
      if (order.paidMinor <= 0) throw new Error("commerce_refund_requires_payment");
      if (order.refundedMinor + amountMinor > order.paidMinor) throw new Error("commerce_refund_exceeds_payment");
      order.refundedMinor += amountMinor;
      order.status = order.refundedMinor === order.paidMinor ? "refunded" : "partially_refunded";
    }
    order.updatedAt = new Date().toISOString();
    order.updatedBy = `verified-webhook:${provider}`;
    const receipt: CommerceEventReceipt = {
      id: randomUUID(),
      tenantId: document.tenantId,
      provider,
      providerEventId: eventId,
      orderId: order.id,
      eventType: options.eventType,
      amountMinor,
      signatureVerified: true,
      applied: true,
      resultStatus: order.status,
      receivedAt: new Date().toISOString(),
    };
    document.eventReceipts.push(receipt);
    addAudit(document, order.id, order.updatedBy, "provider_event_applied", `${options.eventType} ${eventId} moved order to ${order.status}`);
    return { order, receipt, duplicate: false };
  }, options.root);
}

export async function updateCommerceFulfillment(options: {
  tenantId: string;
  actor: string;
  orderId: string;
  fulfilled: boolean;
  note?: string;
  root?: string;
}) {
  return mutate(options.tenantId, options.actor, (document) => {
    const order = document.orders.find((candidate) => candidate.id === options.orderId);
    if (!order) throw new Error("commerce_order_not_found");
    if (!["fulfillment_pending", "fulfilled"].includes(order.status)) throw new Error("commerce_fulfillment_state_invalid");
    order.status = options.fulfilled ? "fulfilled" : "fulfillment_pending";
    order.fulfillmentNote = text(options.note, 500) || null;
    order.updatedAt = new Date().toISOString();
    order.updatedBy = options.actor;
    addAudit(document, order.id, options.actor, "fulfillment_updated", `Fulfillment set to ${order.status}`);
    return order;
  }, options.root);
}

export function commerceOrderSummary(document: CommerceOrderDocument) {
  const liveOrders = document.orders.filter((order) => order.mode === "live");
  const actualPaid = liveOrders.filter((order) => order.paidMinor > 0);
  const currencies = [...new Set(actualPaid.map((order) => order.currency))];
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;
  return {
    hasActualRevenue: actualPaid.length > 0,
    currency: singleCurrency,
    grossPaidMinor: singleCurrency ? actualPaid.reduce((sum, order) => sum + order.paidMinor, 0) : null,
    refundedMinor: singleCurrency ? actualPaid.reduce((sum, order) => sum + order.refundedMinor, 0) : null,
    netPaidMinor: singleCurrency ? actualPaid.reduce((sum, order) => sum + order.paidMinor - order.refundedMinor, 0) : null,
    liveOrderCount: liveOrders.length,
    testOrderCount: document.orders.filter((order) => order.mode === "test").length,
    fulfillmentPendingCount: liveOrders.filter((order) => order.status === "fulfillment_pending").length,
  };
}

export function publicCommerceOrders(document: CommerceOrderDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    version: document.version,
    orders: document.orders,
    eventReceipts: document.eventReceipts.slice(-100),
    audit: document.audit.slice(-100),
    summary: commerceOrderSummary(document),
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}
