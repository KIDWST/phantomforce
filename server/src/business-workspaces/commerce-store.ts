import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { businessError, businessProfile, validBusinessTenant } from "./business-scope.js";

const number = z.number().finite().nonnegative().max(1_000_000_000);
const quantity = z.number().int().nonnegative().max(1_000_000);
const label = z.string().trim().min(1).max(180);
const id = z.string().min(1).max(180);
export const CommerceChannel = z.enum(["manual", "etsy", "tiktok-shop", "facebook-marketplace", "ebay", "shopify", "woocommerce", "storefront", "other"]);
const bom = z.array(z.object({ materialId: id, quantity: number.refine((n) => n > 0) }).strict()).max(100);
const productInput = z.object({
  sku: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).transform((s) => s.toUpperCase()),
  name: label, price: number, materialCost: number.default(0), laborCost: number.default(0),
  overheadCost: number.default(0), feePercent: z.number().finite().min(0).max(100).default(0),
  printHours: z.number().finite().min(0).max(10000).default(0), finishedStock: quantity.default(0), bom: bom.default([]),
  rightsStatus: z.enum(["unconfirmed", "original", "authorized"]).default("unconfirmed"),
  rightsReference: z.string().trim().max(500).default(""),
}).strict();
const materialInput = z.object({ name: label, unit: z.enum(["g", "kg", "each", "ml", "m"]), onHand: number.default(0), unitCost: number.default(0) }).strict();
const printerInput = z.object({ name: label, hoursPerDay: z.number().finite().min(0).max(24), status: z.enum(["idle", "printing", "offline", "maintenance"]).default("idle") }).strict();
const customerInput = z.object({ name: label, email: z.union([z.literal(""), z.string().trim().email().max(254)]).default(""), externalCustomerId: z.string().trim().max(180).default("") }).strict();
const orderInput = z.object({ externalId: label, channel: CommerceChannel, customer: customerInput,
  due: z.string().trim().max(40).refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
    : z.string().datetime({ offset: true }).safeParse(s).success, "Valid due date required"),
  lines: z.array(z.object({ sku: productInput.shape.sku, quantity: quantity.refine((n) => n > 0) }).strict()).min(1).max(100),
}).strict();
const entity = { id, tenantId: id, createdAt: z.string().datetime(), updatedAt: z.string().datetime() };
const productSchema = productInput.extend(entity);
const materialSchema = materialInput.extend(entity);
const printerSchema = printerInput.extend({ ...entity, currentJobId: id.nullable() });
const jobStatus = z.enum(["queued", "printing", "quality-check", "packing", "ready", "shipped", "cancelled"]);
const jobSchema = z.object({ ...entity, orderId: id, sku: productInput.shape.sku, quantity, makeQuantity: quantity, stockQuantity: quantity,
  status: jobStatus, printHours: number, printerId: id.nullable(), materials: bom, materialsConsumed: z.boolean(),
  attempts: quantity, failures: z.array(z.object({ at: z.string().datetime(), reason: label }).strict()).max(1000),
}).strict();
const orderSchema = z.object({ ...entity, externalId: label, channel: CommerceChannel, customerId: id, customer: customerInput, due: z.string(),
  lines: z.array(z.object({ sku: productInput.shape.sku, quantity, unitPrice: number }).strict()).min(1).max(100),
  total: number, status: z.enum(["open", "production", "ready", "shipped", "cancelled"]), fingerprint: z.string(),
  carrier: z.string().max(180), trackingNumber: z.string().max(180),
}).strict();
const customerSchema = customerInput.extend({ ...entity, channel: CommerceChannel });
const channelSchema = z.object({ ...entity, channel: CommerceChannel, enabled: z.boolean(), accountLabel: z.string().max(180),
  status: z.enum(["blocked", "not-configured"]), adapterReady: z.literal(false), blockedReason: z.string().max(400),
}).strict();
const eventSchema = z.object({ ...entity, type: z.enum(["inventory", "fulfillment"]), channel: CommerceChannel,
  status: z.literal("blocked"), reason: z.string(), revision: quantity, orderId: id.optional(), sku: z.string().optional(),
  available: quantity.optional(), globalAvailable: quantity.optional(), carrier: z.string().optional(), trackingNumber: z.string().optional(),
}).strict();
const documentSchema = z.object({ schemaVersion: z.literal(1), tenantId: id, revision: quantity,
  products: z.array(productSchema).max(10000), materials: z.array(materialSchema).max(10000), printers: z.array(printerSchema).max(1000),
  orders: z.array(orderSchema).max(100000), jobs: z.array(jobSchema).max(100000), customers: z.array(customerSchema).max(100000),
  channels: z.array(channelSchema).max(20), outbox: z.array(eventSchema).max(100000),
  audit: z.array(z.object({ id, at: z.string().datetime(), actor: label, command: z.string(), reason: z.string().optional(), revision: quantity }).strict()).max(100000),
}).strict();
export type CommerceState = z.infer<typeof documentSchema>;
type Job = CommerceState["jobs"][number];
type Channel = z.infer<typeof CommerceChannel>;
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create-product"), payload: productInput }),
  z.object({ type: z.literal("update-product"), payload: productInput.omit({ sku: true, bom: true, printHours: true, finishedStock: true }).partial().extend({ productId: id }).strict() }),
  z.object({ type: z.literal("create-material"), payload: materialInput }),
  z.object({ type: z.literal("update-material"), payload: materialInput.pick({ name: true, unitCost: true }).partial().extend({ materialId: id }).strict() }),
  z.object({ type: z.literal("create-printer"), payload: printerInput }),
  z.object({ type: z.literal("update-printer"), payload: printerInput.partial().extend({ printerId: id }).strict() }),
  z.object({ type: z.literal("create-order"), payload: orderInput }),
  z.object({ type: z.literal("advance-job"), payload: z.object({ jobId: id, to: z.enum(["printing", "quality-check", "packing", "ready"]), printerId: id.optional() }).strict() }),
  z.object({ type: z.literal("fail-job"), payload: z.object({ jobId: id, reason: label }).strict() }),
  z.object({ type: z.literal("cancel-order"), payload: z.object({ orderId: id }).strict() }),
  z.object({ type: z.literal("ship-order"), payload: z.object({ orderId: id, carrier: label, trackingNumber: label }).strict() }),
  z.object({ type: z.literal("adjust-stock"), payload: z.object({ kind: z.enum(["product", "material"]), id, delta: z.number().finite().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0), reason: label }).strict() }),
  z.object({ type: z.literal("configure-channel"), payload: z.object({ channel: CommerceChannel, enabled: z.boolean(), accountLabel: z.string().trim().max(180).default("") }).strict() }),
]);
const envelope = z.object({ type: z.string(), payload: z.unknown(), expectedRevision: quantity.optional() }).strict();
const locks = new Map<string, Promise<unknown>>();
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../.local/business-commerce");
const round = (n: number) => Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function fail(code: string, message: string, status = 409): never { throw businessError(code, message, status); }
function assertProfile(tenantId: string) {
  if (!validBusinessTenant(tenantId)) fail("INVALID_BUSINESS_SCOPE", "Choose a valid business workspace.", 400);
  if (businessProfile(tenantId)?.id !== "occasionallyodd") fail("COMMERCE_WORKSPACE_REQUIRED", "Commerce belongs to a commerce business workspace.", 403);
}
function pathFor(tenantId: string, root?: string) {
  assertProfile(tenantId);
  return resolve(root || process.env.PHANTOMFORCE_BUSINESS_COMMERCE_DIR || defaultRoot, createHash("sha256").update(tenantId).digest("hex") + ".json");
}
function empty(tenantId: string): CommerceState { return { schemaVersion: 1, tenantId, revision: 0, products: [], materials: [], printers: [], orders: [], jobs: [], customers: [], channels: [], outbox: [], audit: [] }; }
const active = (job: Job) => job.status !== "shipped" && job.status !== "cancelled";
function stockReserved(state: CommerceState, sku: string) { return state.jobs.filter((j) => active(j) && j.sku === sku).reduce((sum, j) => sum + j.stockQuantity, 0); }
function materialReserved(state: CommerceState, materialId: string) { return round(state.jobs.filter((j) => active(j) && !j.materialsConsumed).reduce((sum, j) => sum + (j.materials.find((m) => m.materialId === materialId)?.quantity || 0), 0)); }
function find<T extends { id: string }>(rows: T[], value: string): T { return rows.find((row) => row.id === value) || fail("COMMERCE_NOT_FOUND", "Record not found in this business.", 404); }
function validateDocument(raw: unknown, tenantId: string) {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) fail("COMMERCE_STORE_INVALID", "Commerce data requires administrator review.");
  const state = parsed.data;
  const collections = [state.products, state.materials, state.printers, state.orders, state.jobs, state.customers, state.channels, state.outbox];
  if (state.tenantId !== tenantId || collections.some((rows) => rows.some((row) => row.tenantId !== tenantId) || new Set(rows.map((row) => row.id)).size !== rows.length)
    || new Set(state.products.map((p) => p.sku)).size !== state.products.length
    || new Set(state.channels.map((c) => c.channel)).size !== state.channels.length
    || new Set(state.orders.map((o) => o.channel + ":" + o.externalId)).size !== state.orders.length) fail("COMMERCE_SCOPE_INVALID", "Commerce data requires administrator review.");
  for (const product of state.products) {
    if (new Set(product.bom.map((m) => m.materialId)).size !== product.bom.length || product.bom.some((m) => !state.materials.some((row) => row.id === m.materialId)) || product.finishedStock < stockReserved(state, product.sku)) fail("COMMERCE_STORE_INVALID", "Commerce inventory requires administrator review.");
  }
  for (const order of state.orders) {
    if (!state.customers.some((c) => c.id === order.customerId) || order.lines.some((line) => !state.products.some((p) => p.sku === line.sku))) fail("COMMERCE_STORE_INVALID", "Commerce order references require administrator review.");
  }
  for (const job of state.jobs) {
    if (!state.orders.some((o) => o.id === job.orderId) || !state.products.some((p) => p.sku === job.sku) || job.quantity !== job.makeQuantity + job.stockQuantity
      || job.materials.some((m) => !state.materials.some((row) => row.id === m.materialId))
      || (job.status === "printing" && !state.printers.some((p) => p.id === job.printerId && p.currentJobId === job.id && p.status === "printing"))) fail("COMMERCE_STORE_INVALID", "Commerce production references require administrator review.");
  }
  for (const printer of state.printers) {
    if (printer.currentJobId && !state.jobs.some((j) => j.id === printer.currentJobId && j.printerId === printer.id && j.status === "printing")) fail("COMMERCE_STORE_INVALID", "Commerce printer references require administrator review.");
  }
  return state;
}
export async function getCommerceState(tenantId: string, root?: string): Promise<CommerceState> {
  const path = pathFor(tenantId, root);
  try { return validateDocument(JSON.parse(await readFile(path, "utf8")), tenantId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(tenantId);
    if (error instanceof SyntaxError) fail("COMMERCE_STORE_INVALID", "Commerce data requires administrator review.");
    throw error;
  }
}
export function commerceSummary(state: CommerceState, now = new Date()) {
  const jobs = state.jobs.filter(active);
  const queuedHours = round(jobs.filter((j) => ["queued", "printing"].includes(j.status)).reduce((sum, j) => sum + j.printHours, 0));
  const hoursPerDay = round(state.printers.filter((p) => p.status === "idle" || (p.status === "printing" && p.currentJobId)).reduce((sum, p) => sum + p.hoursPerDay, 0));
  const availableHours7Days = Math.max(0, round(hoursPerDay * 7 - queuedHours));
  const materials = state.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, onHand: m.onHand, unitCost: m.unitCost, reserved: materialReserved(state, m.id), available: round(m.onHand - materialReserved(state, m.id)) }));
  const products = state.products.map((p) => {
    const reserved = stockReserved(state, p.sku);
    const materialCost = p.bom.length ? p.bom.reduce((sum, m) => sum + m.quantity * find(state.materials, m.materialId).unitCost, 0) : p.materialCost;
    const unitContribution = money(p.price * (1 - p.feePercent / 100) - materialCost - p.laborCost - p.overheadCost);
    const materialCapacity = p.bom.length ? Math.min(...p.bom.map((m) => Math.floor(Math.max(0, materials.find((row) => row.id === m.materialId)!.available) / m.quantity))) : Infinity;
    const hourCapacity = p.printHours > 0 ? Math.floor(availableHours7Days / p.printHours) : 0;
    return { id: p.id, sku: p.sku, name: p.name, onHand: p.finishedStock, reserved, available: p.finishedStock - reserved,
      makeToOrderCapacity: Math.min(materialCapacity, hourCapacity), materialCost: money(materialCost), unitContribution,
      profitPerPrinterHour: p.printHours > 0 ? money(unitContribution / p.printHours) : null };
  });
  const warnings: { code: string; severity: "warning" | "critical"; message: string; orderId?: string }[] = [];
  for (const m of materials) if (m.available < 0) warnings.push({ code: "MATERIAL_SHORTAGE", severity: "critical", message: `${m.name}: ${round(-m.available)} ${m.unit} short for reserved work.` });
  if (queuedHours && !hoursPerDay) warnings.push({ code: "NO_PRINTER_CAPACITY", severity: "critical", message: "Production is waiting for available printer capacity." });
  if (queuedHours > hoursPerDay * 7) warnings.push({ code: "CAPACITY_OVERBOOKED", severity: "warning", message: "The print queue exceeds seven days of configured capacity." });
  let cumulativeHours = 0;
  const openOrders = state.orders.filter((o) => !["shipped", "cancelled"].includes(o.status)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  for (const order of openOrders) {
    cumulativeHours += jobs.filter((j) => j.orderId === order.id && ["queued", "printing"].includes(j.status)).reduce((sum, j) => sum + j.printHours, 0);
    const daysLeft = (Date.parse(order.due) - now.getTime()) / 86_400_000;
    if (daysLeft < 0) warnings.push({ code: "ORDER_OVERDUE", severity: "critical", message: `${order.externalId} is past its ship-by date.`, orderId: order.id });
    else if (cumulativeHours > daysLeft * hoursPerDay) warnings.push({ code: "SLA_AT_RISK", severity: "warning", message: `${order.externalId} has insufficient print capacity before its ship-by date; allow additional time for QC and shipping.`, orderId: order.id });
  }
  return { metrics: { openOrders: openOrders.length, orderValue: money(openOrders.reduce((sum, o) => sum + o.total, 0)), queuedHours,
    availableUnits: products.reduce((sum, p) => sum + p.available, 0), blockedSync: state.outbox.length },
    capacity: { hoursPerDay, queuedHours, daysToClear: hoursPerDay > 0 ? round(queuedHours / hoursPerDay) : null, availableHours7Days }, products, materials, warnings,
    capacityNote: "Estimates use configured daily hours and full remaining job durations, exclude QC/packing time, and share one capacity pool across SKUs and channels. Printer status is recorded locally; live telemetry is not connected." };
}
function stamp(state: CommerceState, now: string) { return { id: randomUUID(), tenantId: state.tenantId, createdAt: now, updatedAt: now }; }
function assertRights(product: CommerceState["products"][number]) {
  if (product.rightsStatus !== "original" && !(product.rightsStatus === "authorized" && product.rightsReference)) fail("RIGHTS_AUTHORIZATION_REQUIRED", "Confirm original artwork or record a license reference before production or fulfillment.");
}
function releasePrinter(state: CommerceState, job: Job, now: string) {
  if (job.printerId) { const printer = find(state.printers, job.printerId); if (printer.currentJobId === job.id) Object.assign(printer, { currentJobId: null, status: "idle", updatedAt: now }); }
  job.printerId = null;
}
function refreshOrder(state: CommerceState, orderId: string, now: string) {
  const order = find(state.orders, orderId);
  const jobs = state.jobs.filter((j) => j.orderId === orderId);
  order.status = jobs.every((j) => j.status === "ready") ? "ready" : jobs.some((j) => j.status !== "queued") ? "production" : "open";
  order.updatedAt = now;
}
function inventoryEvents(state: CommerceState, now: string) {
  // Coalesce unsent inventory snapshots per channel/SKU, preserving the durable current obligation.
  // A full shared pool independently advertised on every marketplace can oversell during
  // provider lag. Split the finished pool conservatively; MTO remains a planning estimate.
  const enabled = state.channels.filter((c) => c.enabled && c.channel !== "manual").sort((a, b) => a.channel.localeCompare(b.channel));
  for (const channel of state.channels.filter((c) => c.channel !== "manual")) {
    for (const product of state.products) {
      const previous = state.outbox.find((e) => e.type === "inventory" && e.channel === channel.channel && e.sku === product.sku);
      const globalAvailable = product.finishedStock - stockReserved(state, product.sku);
      const index = enabled.findIndex((c) => c.id === channel.id);
      const available = index < 0 ? 0 : Math.floor(globalAvailable / enabled.length) + (index < globalAvailable % enabled.length ? 1 : 0);
      const event = { ...stamp(state, now), type: "inventory" as const, channel: channel.channel, status: "blocked" as const,
        reason: channel.enabled ? channel.blockedReason : "Channel disabled; zero-quantity withdrawal requires a verified adapter.", revision: state.revision, sku: product.sku, available, globalAvailable };
      if (previous) Object.assign(previous, { ...event, id: previous.id, createdAt: previous.createdAt }); else state.outbox.push(event);
    }
  }
}
function normalizedOrder(input: z.infer<typeof orderInput>) {
  const lines = new Map<string, number>();
  for (const line of input.lines) lines.set(line.sku, (lines.get(line.sku) || 0) + line.quantity);
  return { ...input, due: new Date(input.due).toISOString(), lines: [...lines].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => ({ sku, quantity })) };
}
export async function executeCommerceCommand(tenantId: string, input: unknown, actor: string, root?: string) {
  const validatedEnvelope = envelope.safeParse(input);
  if (!validatedEnvelope.success) fail("COMMERCE_COMMAND_INVALID", "Check the command fields and try again.", 400);
  const parsed = commandSchema.safeParse({ type: validatedEnvelope.data.type, payload: validatedEnvelope.data.payload });
  if (!parsed.success) fail("COMMERCE_COMMAND_INVALID", "Check the command fields and try again.", 400);
  const command = parsed.data;
  const path = pathFor(tenantId, root);
  const previous = locks.get(path) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const state = await getCommerceState(tenantId, root);
    let orderFingerprint = "";
    if (command.type === "create-order") {
      const order = normalizedOrder(command.payload);
      orderFingerprint = createHash("sha256").update(JSON.stringify(order)).digest("hex");
      const duplicate = state.orders.find((o) => o.channel === order.channel && o.externalId === order.externalId);
      if (duplicate) {
        if (duplicate.fingerprint !== orderFingerprint) fail("ORDER_IDEMPOTENCY_CONFLICT", "This channel order ID already exists with different details. Review the existing order.");
        return { state, summary: commerceSummary(state), duplicate: true };
      }
    }
    if (validatedEnvelope.data.expectedRevision !== undefined && validatedEnvelope.data.expectedRevision !== state.revision) fail("COMMERCE_REVISION_CONFLICT", "This workspace changed. Refresh before saving.");
    const now = new Date().toISOString();
    switch (command.type) {
      case "create-material": state.materials.push({ ...command.payload, ...stamp(state, now) }); break;
      case "update-material": { const { materialId, ...patch } = command.payload; Object.assign(find(state.materials, materialId), patch, { updatedAt: now }); break; }
      case "create-product": {
        const p = command.payload;
        if (state.products.some((row) => row.sku === p.sku)) fail("SKU_EXISTS", "That SKU already exists in this business.");
        if (new Set(p.bom.map((m) => m.materialId)).size !== p.bom.length) fail("BOM_DUPLICATE", "Include each material once in the bill of materials.", 400);
        p.bom.forEach((m) => find(state.materials, m.materialId));
        state.products.push({ ...p, ...stamp(state, now) }); break;
      }
      case "update-product": { const { productId, ...patch } = command.payload; Object.assign(find(state.products, productId), patch, { updatedAt: now }); break; }
      case "create-printer": state.printers.push({ ...command.payload, ...stamp(state, now), currentJobId: null }); break;
      case "update-printer": {
        const { printerId, ...patch } = command.payload;
        const printer = find(state.printers, printerId);
        if (printer.currentJobId && patch.status && patch.status !== "printing") fail("PRINTER_JOB_ACTIVE", "Complete or fail the active print before changing printer availability.");
        Object.assign(printer, patch, { updatedAt: now }); break;
      }
      case "create-order": {
        const order = normalizedOrder(command.payload);
        if (order.lines.some((line) => line.quantity > 1_000_000)) fail("ORDER_QUANTITY_INVALID", "Order quantities exceed the supported limit.", 400);
        // A provider customer ID always wins. ID-less manual/imported customers can
        // reuse an exact normalized email only within this tenant and source channel.
        // Never infer that an ID-less email is one of a provider's identified people.
        const normalizedEmail = order.customer.email.trim().toLowerCase();
        let customer = order.customer.externalCustomerId
          ? state.customers.find((c) => c.channel === order.channel && c.externalCustomerId === order.customer.externalCustomerId)
          : normalizedEmail ? state.customers.find((c) => c.channel === order.channel && !c.externalCustomerId && c.email.trim().toLowerCase() === normalizedEmail) : undefined;
        if (!customer) { customer = { ...order.customer, ...stamp(state, now), channel: order.channel }; state.customers.push(customer); }
        const saved = { ...order, ...stamp(state, now), customerId: customer.id, status: "open" as const, fingerprint: orderFingerprint, total: 0,
          carrier: "", trackingNumber: "", lines: order.lines.map((line) => { const product = state.products.find((p) => p.sku === line.sku) || fail("SKU_NOT_FOUND", `SKU ${line.sku} was not found in this business.`, 404); return { ...line, unitPrice: product.price }; }) };
        saved.total = money(saved.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
        for (const line of saved.lines) {
          const product = state.products.find((p) => p.sku === line.sku)!;
          const stockQuantity = Math.min(line.quantity, product.finishedStock - stockReserved(state, line.sku));
          const makeQuantity = line.quantity - stockQuantity;
          if (makeQuantity && !product.printHours) fail("PRODUCTION_RECIPE_REQUIRED", `${product.name} needs print hours for made-to-order work, or enough finished stock.`);
          state.jobs.push({ ...stamp(state, now), orderId: saved.id, sku: line.sku, quantity: line.quantity, stockQuantity, makeQuantity, status: "queued",
            printHours: round(product.printHours * makeQuantity), materials: product.bom.map((m) => ({ materialId: m.materialId, quantity: round(m.quantity * makeQuantity) })).filter((m) => m.quantity > 0),
            materialsConsumed: false, printerId: null, attempts: 0, failures: [] });
        }
        state.orders.push(saved); break;
      }
      case "advance-job": {
        const job = find(state.jobs, command.payload.jobId);
        const expected = job.status === "queued" ? (job.makeQuantity ? "printing" : "quality-check") : job.status === "printing" ? "quality-check" : job.status === "quality-check" ? "packing" : job.status === "packing" ? "ready" : null;
        if (!expected || command.payload.to !== expected) fail("JOB_TRANSITION_INVALID", "Follow production, quality check, packing, then ready to ship in order.");
        assertRights(state.products.find((p) => p.sku === job.sku)!);
        if (command.payload.to === "printing") {
          if (!command.payload.printerId) fail("PRINTER_REQUIRED", "Choose an available printer for this job.", 400);
          const printer = find(state.printers, command.payload.printerId);
          if (printer.status !== "idle" || printer.currentJobId || printer.hoursPerDay <= 0) fail("PRINTER_UNAVAILABLE", "This printer is unavailable or already assigned.");
          for (const requirement of job.materials) if (find(state.materials, requirement.materialId).onHand < requirement.quantity) fail("MATERIAL_SHORTAGE", "Receive enough materials before starting this print.");
          if (job.materialsConsumed) fail("MATERIAL_ALREADY_CONSUMED", "This print attempt has already consumed its materials.");
          for (const requirement of job.materials) { const material = find(state.materials, requirement.materialId); material.onHand = round(material.onHand - requirement.quantity); material.updatedAt = now; }
          job.materialsConsumed = true; job.attempts += 1; job.printerId = printer.id;
          Object.assign(printer, { currentJobId: job.id, status: "printing", updatedAt: now });
        } else if (job.status === "printing") releasePrinter(state, job, now);
        job.status = command.payload.to; job.updatedAt = now; refreshOrder(state, job.orderId, now); break;
      }
      case "fail-job": {
        const job = find(state.jobs, command.payload.jobId);
        if (!["printing", "quality-check"].includes(job.status) || !job.makeQuantity || !job.materialsConsumed) fail("JOB_FAILURE_INVALID", "Only an active or completed print awaiting quality check can be reprinted.");
        releasePrinter(state, job, now); job.failures.push({ at: now, reason: command.payload.reason });
        job.status = "queued"; job.materialsConsumed = false; job.updatedAt = now; refreshOrder(state, job.orderId, now); break;
      }
      case "cancel-order": {
        const order = find(state.orders, command.payload.orderId);
        if (["shipped", "cancelled"].includes(order.status)) fail("ORDER_TRANSITION_INVALID", "This order has already shipped or been cancelled.");
        for (const job of state.jobs.filter((j) => j.orderId === order.id)) {
          // Only QC-passed output can return to finished stock. Spent materials are never refunded.
          if (["packing", "ready"].includes(job.status)) { const product = state.products.find((p) => p.sku === job.sku)!; product.finishedStock += job.makeQuantity; product.updatedAt = now; }
          releasePrinter(state, job, now); job.status = "cancelled"; job.updatedAt = now;
        }
        order.status = "cancelled"; order.updatedAt = now; break;
      }
      case "ship-order": {
        const order = find(state.orders, command.payload.orderId);
        const jobs = state.jobs.filter((j) => j.orderId === order.id);
        if (order.status !== "ready" || !jobs.length || jobs.some((j) => j.status !== "ready")) fail("ORDER_NOT_READY", "Every item must pass quality check and packing before shipping.");
        for (const job of jobs) {
          const product = state.products.find((p) => p.sku === job.sku)!; assertRights(product);
          product.finishedStock -= job.stockQuantity; product.updatedAt = now; job.status = "shipped"; job.updatedAt = now;
        }
        Object.assign(order, { status: "shipped", carrier: command.payload.carrier, trackingNumber: command.payload.trackingNumber, updatedAt: now });
        if (order.channel !== "manual") state.outbox.push({ ...stamp(state, now), type: "fulfillment", channel: order.channel, status: "blocked", reason: "Provider authorization and verified fulfillment adapter required.", revision: state.revision + 1, orderId: order.id, carrier: order.carrier, trackingNumber: order.trackingNumber });
        break;
      }
      case "adjust-stock": {
        const p = command.payload;
        if (p.kind === "product") {
          if (!Number.isInteger(p.delta)) fail("STOCK_QUANTITY_INVALID", "Finished units require a whole-number adjustment.", 400);
          const product = find(state.products, p.id); const next = product.finishedStock + p.delta;
          if (next < stockReserved(state, product.sku)) fail("STOCK_RESERVED", "This adjustment would remove units reserved for open orders.");
          product.finishedStock = next; product.updatedAt = now;
        } else { const material = find(state.materials, p.id); const next = round(material.onHand + p.delta); if (next < 0) fail("NEGATIVE_STOCK", "Material stock cannot be negative."); material.onHand = next; material.updatedAt = now; }
        break;
      }
      case "configure-channel": {
        const p = command.payload;
        if (p.channel === "manual") fail("CHANNEL_INVALID", "Manual order entry does not require a channel connection.", 400);
        const previousChannel = state.channels.find((c) => c.channel === p.channel);
        const fields = { ...p, status: p.enabled ? "blocked" as const : "not-configured" as const, adapterReady: false as const, blockedReason: "Provider authorization and verified adapter required.", updatedAt: now };
        if (previousChannel) Object.assign(previousChannel, fields); else state.channels.push({ ...stamp(state, now), ...fields });
        break;
      }
    }
    state.revision += 1;
    state.audit.push({ id: randomUUID(), at: now, actor: actor.slice(0, 180) || "unknown", command: command.type, revision: state.revision,
      ...("reason" in command.payload ? { reason: command.payload.reason } : {}) });
    inventoryEvents(state, now);
    validateDocument(state, tenantId);
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + "." + randomUUID() + ".tmp";
    try { await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 }); await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    return { state, summary: commerceSummary(state), duplicate: false };
  });
  locks.set(path, current);
  try { return await current; } finally { if (locks.get(path) === current) locks.delete(path); }
}
