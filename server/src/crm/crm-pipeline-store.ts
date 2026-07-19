import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CrmLeadStatus = "new" | "follow-up" | "proposal" | "won" | "lost";

export type CrmLead = {
  id: string;
  tenantId: string;
  ws: string;
  name: string;
  company: string;
  source: string;
  status: CrmLeadStatus;
  value: number;
  next: string;
  due: string;
  owner: string;
  notes: string;
  proposalId: string | null;
  segment: string;
  setupSlotId: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  serverBacked: true;
};

export type CrmAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  leadId: string;
  eventType: "created" | "updated" | "deleted" | "prospect_lanes_created";
  summary: string;
  createdAt: string;
};

export type CrmPipelineDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  leads: CrmLead[];
  audit: CrmAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/crm-pipeline");
const locks = new Map<string, Promise<unknown>>();
const STATUSES = new Set(["new", "follow-up", "proposal", "won", "lost"]);

function safeTenantId(tenantId: string) {
  return tenantId.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

export function crmPipelineRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_CRM_PIPELINE_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(crmPipelineRoot(root), `${safeTenantId(tenantId)}.json`);
}

function checksum(document: Omit<CrmPipelineDocument, "checksum">) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanNotes(value: unknown, max = 1400) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function cleanStatus(value: unknown): CrmLeadStatus {
  return typeof value === "string" && STATUSES.has(value) ? value as CrmLeadStatus : "new";
}

function cleanDue(value: unknown) {
  const text = cleanText(value, 80);
  const parsed = text ? new Date(text) : new Date(Date.now() + 86_400_000);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(Date.now() + 86_400_000).toISOString();
}

function cleanValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000, Math.round(number))) : 0;
}

function dedupeKey(lead: Pick<CrmLead, "company" | "name" | "source" | "segment">) {
  return [lead.company || lead.name, lead.source, lead.segment].map((part) => String(part || "").trim().toLowerCase()).join("::");
}

function documentWithChecksum(document: Omit<CrmPipelineDocument, "checksum">): CrmPipelineDocument {
  return { ...document, checksum: checksum(document) };
}

export function defaultCrmPipelineDocument(tenantId: string, actor = "system"): CrmPipelineDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({
    schemaVersion: 1,
    tenantId: safeTenantId(tenantId),
    version: 1,
    leads: [],
    audit: [],
    updatedAt: now,
    updatedBy: actor,
  });
}

export function normalizeCrmLead(value: unknown, tenantId: string, actor: string, existing?: CrmLead): CrmLead {
  const source = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  const name = cleanText(source.name ?? existing?.name, 120);
  const company = cleanText(source.company ?? existing?.company ?? name, 120) || name || "Unnamed prospect lane";
  return {
    id: cleanText(source.id ?? existing?.id, 90) || randomUUID(),
    tenantId: safeTenantId(tenantId),
    // The authenticated tenant is authoritative. Never let a request body
    // relabel a record as another workspace and poison the browser cache.
    ws: safeTenantId(tenantId),
    name: name || company,
    company,
    source: cleanText(source.source ?? existing?.source, 120) || "Manual capture",
    status: cleanStatus(source.status ?? existing?.status),
    value: cleanValue(source.value ?? existing?.value),
    next: cleanText(source.next ?? existing?.next, 400) || "Qualify the need, decision maker, timing, and next best step.",
    due: cleanDue(source.due ?? existing?.due),
    owner: cleanText(source.owner ?? existing?.owner, 120) || "Lead Hunter",
    notes: cleanNotes(source.notes ?? existing?.notes),
    proposalId: cleanText(source.proposalId ?? existing?.proposalId, 120) || null,
    segment: cleanText(source.segment ?? existing?.segment, 120),
    setupSlotId: cleanText(source.setupSlotId ?? existing?.setupSlotId, 80),
    createdAt: cleanText(existing?.createdAt ?? source.createdAt, 80) || now,
    updatedAt: now,
    updatedBy: cleanText(actor, 120) || "system",
    serverBacked: true,
  };
}

export async function readCrmPipelineDocument(tenantId: string, root?: string): Promise<CrmPipelineDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as CrmPipelineDocument;
    return documentWithChecksum({
      schemaVersion: 1,
      tenantId: safeTenantId(raw.tenantId || tenantId),
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      leads: Array.isArray(raw.leads) ? raw.leads.map((lead) => normalizeCrmLead(lead, raw.tenantId || tenantId, lead.updatedBy || "system", lead)) : [],
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-400) : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeCrmPipelineDocumentUnlocked(document: CrmPipelineDocument, root?: string) {
  const path = documentPath(document.tenantId, root);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return path;
}

export async function getCrmPipelineDocument(tenantId: string, actor = "system", root?: string) {
  return await readCrmPipelineDocument(tenantId, root) ?? defaultCrmPipelineDocument(tenantId, actor);
}

function audit(tenantId: string, actor: string, leadId: string, eventType: CrmAuditEntry["eventType"], summary: string): CrmAuditEntry {
  return { id: randomUUID(), tenantId, actor, leadId, eventType, summary: summary.slice(0, 240), createdAt: new Date().toISOString() };
}

async function mutateCrmDocument<T>(tenantId: string, actor: string, operation: (document: CrmPipelineDocument) => T, root?: string) {
  return withTenantLock(tenantId, async () => {
    const current = await getCrmPipelineDocument(tenantId, actor, root);
    const result = operation(current);
    const now = new Date().toISOString();
    const document = documentWithChecksum({
      schemaVersion: 1,
      tenantId: current.tenantId,
      version: current.version + 1,
      leads: current.leads.slice(0, 500),
      audit: current.audit.slice(-400),
      updatedAt: now,
      updatedBy: actor,
    });
    const path = await writeCrmPipelineDocumentUnlocked(document, root);
    return { path, document, result };
  });
}

export async function createCrmLead(options: { tenantId: string; lead: unknown; actor: string; root?: string }) {
  return mutateCrmDocument(options.tenantId, options.actor, (document) => {
    const lead = normalizeCrmLead(options.lead, document.tenantId, options.actor);
    document.leads.unshift(lead);
    document.audit.push(audit(document.tenantId, options.actor, lead.id, "created", `Created CRM lead ${lead.company}`));
    return lead;
  }, options.root);
}

export async function upsertCrmProspectLanes(options: { tenantId: string; leads: unknown[]; actor: string; root?: string }) {
  return mutateCrmDocument(options.tenantId, options.actor, (document) => {
    const existingByKey = new Map(document.leads.map((lead) => [dedupeKey(lead), lead]));
    const saved: CrmLead[] = [];
    options.leads.slice(0, 12).forEach((raw) => {
      const candidate = normalizeCrmLead(raw, document.tenantId, options.actor);
      const key = dedupeKey(candidate);
      const existing = existingByKey.get(key);
      if (existing) {
        const next = normalizeCrmLead(candidate, document.tenantId, options.actor, existing);
        Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt });
        document.audit.push(audit(document.tenantId, options.actor, existing.id, "updated", `Updated CRM prospect lane ${existing.company}`));
        saved.push(existing);
      } else {
        document.leads.unshift(candidate);
        existingByKey.set(key, candidate);
        document.audit.push(audit(document.tenantId, options.actor, candidate.id, "prospect_lanes_created", `Created CRM prospect lane ${candidate.company}`));
        saved.push(candidate);
      }
    });
    return saved;
  }, options.root);
}

export async function updateCrmLead(options: { tenantId: string; leadId: string; patch: unknown; actor: string; root?: string }) {
  return mutateCrmDocument(options.tenantId, options.actor, (document) => {
    const existing = document.leads.find((lead) => lead.id === options.leadId);
    if (!existing) throw new Error("CRM lead not found.");
    const next = normalizeCrmLead({ ...existing, ...(isRecord(options.patch) ? options.patch : {}) }, document.tenantId, options.actor, existing);
    Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt });
    document.audit.push(audit(document.tenantId, options.actor, existing.id, "updated", `Updated CRM lead ${existing.company}`));
    return existing;
  }, options.root);
}

export async function deleteCrmLead(options: { tenantId: string; leadId: string; actor: string; root?: string }) {
  return mutateCrmDocument(options.tenantId, options.actor, (document) => {
    const existing = document.leads.find((lead) => lead.id === options.leadId);
    document.leads = document.leads.filter((lead) => lead.id !== options.leadId);
    document.audit.push(audit(document.tenantId, options.actor, options.leadId, "deleted", `Deleted CRM lead ${existing?.company || options.leadId}`));
    return existing ?? null;
  }, options.root);
}

export function publicCrmPipelineDocument(document: CrmPipelineDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    version: document.version,
    leads: document.leads,
    audit: document.audit.slice(-25),
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}
