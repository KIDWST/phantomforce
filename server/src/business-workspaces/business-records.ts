import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { businessError, businessProfile, validBusinessTenant } from "./business-scope.js";

export const BusinessRecordInput = z.object({
  kind: z.enum(["project", "automation", "shoot", "edit", "delivery", "social", "gear", "order", "product", "campaign", "licensing", "template"]),
  title: z.string().trim().min(1).max(180),
  status: z.string().trim().max(60).default("draft"),
  customer: z.string().trim().max(180).optional().default(""),
  due: z.string().trim().max(40).optional().default(""),
  notes: z.string().trim().max(6000).optional().default(""),
  metadata: z.object({
    quantity: z.number().int().min(0).max(1_000_000).optional(),
    channel: z.string().max(120).optional(),
    rightsStatus: z.enum(["original", "pending", "authorized", "not-required", "unconfirmed"]).optional(),
    rightsReference: z.string().max(500).optional(),
    templateId: z.string().max(120).optional(),
    checklist: z.array(z.string().max(400)).max(40).optional(),
    approvalReference: z.string().max(180).optional(),
    isFreebie: z.boolean().optional(),
    assetTag: z.string().max(120).optional(),
    location: z.string().max(180).optional(),
    checkoutTo: z.string().max(180).optional(),
  }).strict().optional().default({}),
}).strict();
export const BusinessRecordPatch = BusinessRecordInput.omit({ kind: true }).partial().extend({
  expectedVersion: z.number().int().positive().optional(),
}).strict();
export type BusinessRecord = z.infer<typeof BusinessRecordInput> & {
  id: string; tenantId: string; businessId: string; ws: string;
  version: number; createdAt: string; updatedAt: string; updatedBy: string;
};
type Document = { schemaVersion: 1; tenantId: string; records: BusinessRecord[] };
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../.local/business-workspaces");
const locks = new Map<string, Promise<unknown>>();

function documentPath(tenantId: string, root?: string) {
  if (!validBusinessTenant(tenantId)) throw businessError("INVALID_BUSINESS_SCOPE", "Invalid business scope.", 400);
  // A hash-free, validated stable namespace with no directory traversal or alias collisions.
  return resolve(root || process.env.PHANTOMFORCE_BUSINESS_RECORDS_DIR || defaultRoot, createHash("sha256").update(tenantId).digest("hex") + ".json");
}
async function readDocument(tenantId: string, root?: string): Promise<Document> {
  try {
    const document = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as Document;
    if (document.schemaVersion !== 1 || document.tenantId !== tenantId || !Array.isArray(document.records)
      || document.records.some((record) => record.tenantId !== tenantId || record.businessId !== tenantId || record.ws !== tenantId)) {
      throw businessError("BUSINESS_RECORD_SCOPE_INVALID", "Business records require administrator review.", 409);
    }
    return document;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, tenantId, records: [] };
    throw error; // Corrupt or ambiguous data is never silently reset.
  }
}
async function mutate<T>(tenantId: string, root: string | undefined, operation: (document: Document) => T) {
  const path = documentPath(tenantId, root);
  const previous = locks.get(path) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const document = await readDocument(tenantId, root);
    const result = operation(document);
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(document, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    return result;
  });
  locks.set(path, current);
  try { return await current; } finally { if (locks.get(path) === current) locks.delete(path); }
}
function assertWorkflowPolicy(record: z.infer<typeof BusinessRecordInput>, tenantId: string) {
  const status = record.status.toLowerCase().replace(/[ _]+/g, "-");
  const profileId = businessProfile(tenantId)?.id;
  const workflows: Record<string, Record<string, string[]>> = {
    phantomforce: { project: ["draft", "scoping", "building", "review", "complete"], automation: ["draft", "scoping", "review", "ready"], template: ["draft", "review", "ready"] },
    chicagoshots: { project: ["draft", "briefing", "production", "editing", "review", "complete"], gear: ["draft", "available", "reserved", "checked-out", "maintenance", "retired"], shoot: ["draft", "briefing", "scheduled", "captured", "complete"], edit: ["draft", "editing", "review", "ready", "complete"], delivery: ["draft", "preparing", "review", "ready", "complete"], social: ["draft", "editing", "review", "ready"], template: ["draft", "review", "ready"] },
    occasionallyodd: { order: ["draft", "quoted", "confirmed", "production", "quality-check", "ready", "complete"], product: ["draft", "design", "review", "production", "quality-check", "ready"], campaign: ["draft", "planning", "review", "ready", "complete"], licensing: ["draft", "research", "review", "awaiting-response", "complete"], template: ["draft", "review", "ready"] },
  };
  // The tracker cannot invent a provider receipt, customer delivery, or owner approval.
  if (["published", "sent", "approved"].includes(status)) {
    throw businessError("VERIFIED_RECEIPT_REQUIRED", "Complete approval or publication in the connected workflow; a tracker status cannot confirm it.", 409);
  }
  if (profileId && workflows[profileId] && !workflows[profileId][record.kind]?.includes(status)) {
    throw businessError("BUSINESS_WORKFLOW_INVALID", "Choose a workflow and stage configured for this business.", 400);
  }
  if (profileId !== "occasionallyodd") return;
  if (["production", "quality-check", "ready", "complete", "in-production", "listed", "ready-to-list", "ready-to-ship", "shipped"].includes(status)
    && ["product", "order"].includes(record.kind)
    && record.metadata.rightsStatus !== "original"
    && !(record.metadata.rightsStatus === "authorized" && record.metadata.rightsReference?.trim())) {
    throw businessError("RIGHTS_AUTHORIZATION_REQUIRED", "Confirm original artwork or record a license reference before production or listing.", 409);
  }
  if (record.kind === "campaign" && record.metadata.isFreebie && ["active", "launched", "running"].includes(status)) {
    throw businessError("CAMPAIGN_APPROVAL_REQUIRED", "Freebie campaigns remain drafts until the approval workflow authorizes launch.", 409);
  }
}
export async function listBusinessRecords(tenantId: string, root?: string) {
  return (await readDocument(tenantId, root)).records;
}
export async function createBusinessRecord(tenantId: string, input: unknown, actor: string, root?: string) {
  const validation = BusinessRecordInput.safeParse(input);
  if (!validation.success) throw businessError("BUSINESS_RECORD_INVALID", "Check the record fields and try again.", 400);
  const parsed = validation.data;
  assertWorkflowPolicy(parsed, tenantId);
  return mutate(tenantId, root, (document) => {
    const now = new Date().toISOString();
    const record: BusinessRecord = { ...parsed, id: randomUUID(), tenantId, businessId: tenantId, ws: tenantId,
      version: 1, createdAt: now, updatedAt: now, updatedBy: actor };
    document.records.push(record);
    return record;
  });
}
export async function updateBusinessRecord(tenantId: string, id: string, input: unknown, actor: string, root?: string) {
  const validation = BusinessRecordPatch.safeParse(input);
  if (!validation.success) throw businessError("BUSINESS_RECORD_INVALID", "Check the record fields and try again.", 400);
  const patch = validation.data;
  return mutate(tenantId, root, (document) => {
    const index = document.records.findIndex((record) => record.id === id);
    if (index < 0) throw businessError("BUSINESS_RECORD_NOT_FOUND", "Record not found in this business.", 404);
    const previous = document.records[index];
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== previous.version) {
      throw businessError("BUSINESS_RECORD_CONFLICT", "This record changed. Refresh before saving.", 409);
    }
    const { expectedVersion: _version, ...changes } = patch;
    const record = { ...previous, ...changes, metadata: { ...previous.metadata, ...changes.metadata },
      version: previous.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
    assertWorkflowPolicy(record, tenantId);
    document.records[index] = record;
    return record;
  });
}
