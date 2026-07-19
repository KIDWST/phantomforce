import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type WorkspaceApprovalStatus = "pending" | "approved" | "declined" | "changes-requested";
export type WorkspaceApprovalDecision =
  | "approve"
  | "disapprove"
  | "approve-with-changes"
  | "disapprove-with-changes"
  | "removed";

export type WorkspaceApproval = {
  id: string;
  tenantId: string;
  ws: string;
  type: string;
  title: string;
  detail: string;
  ref: string;
  status: WorkspaceApprovalStatus;
  requestedBy: string;
  at: string;
  resolvedAt: string | null;
  ownerNotes: string;
  decision: WorkspaceApprovalDecision | "";
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  serverBacked: true;
};

export type WorkspaceApprovalAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  approvalId: string;
  eventType: "created" | "decided" | "deleted";
  summary: string;
  createdAt: string;
};

export type WorkspaceApprovalDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  approvals: WorkspaceApproval[];
  audit: WorkspaceApprovalAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/workspace-approvals");
const locks = new Map<string, Promise<unknown>>();
const STATUSES = new Set(["pending", "approved", "declined", "changes-requested"]);
const DECISIONS = new Set(["approve", "disapprove", "approve-with-changes", "disapprove-with-changes", "removed", ""]);

function safeTenantId(tenantId: string) {
  return tenantId.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

export function workspaceApprovalRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_WORKSPACE_APPROVAL_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(workspaceApprovalRoot(root), `${safeTenantId(tenantId)}.json`);
}

function checksum(document: Omit<WorkspaceApprovalDocument, "checksum">) {
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

function cleanNotes(value: unknown, max = 1200) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function cleanStatus(value: unknown): WorkspaceApprovalStatus {
  return typeof value === "string" && STATUSES.has(value) ? value as WorkspaceApprovalStatus : "pending";
}

function cleanDecision(value: unknown): WorkspaceApprovalDecision | "" {
  return typeof value === "string" && DECISIONS.has(value) ? value as WorkspaceApprovalDecision | "" : "";
}

function cleanDate(value: unknown) {
  const text = cleanText(value, 80);
  const date = text ? new Date(text) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function documentWithChecksum(document: Omit<WorkspaceApprovalDocument, "checksum">): WorkspaceApprovalDocument {
  return { ...document, checksum: checksum(document) };
}

export function defaultWorkspaceApprovalDocument(tenantId: string, actor = "system"): WorkspaceApprovalDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({
    schemaVersion: 1,
    tenantId: safeTenantId(tenantId),
    version: 1,
    approvals: [],
    audit: [],
    updatedAt: now,
    updatedBy: actor,
  });
}

export function normalizeWorkspaceApproval(value: unknown, tenantId: string, actor: string, existing?: WorkspaceApproval): WorkspaceApproval {
  const source = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  const status = cleanStatus(source.status ?? existing?.status);
  return {
    id: cleanText(source.id ?? existing?.id, 90) || randomUUID(),
    tenantId: safeTenantId(tenantId),
    // Approval ownership comes from the authorized tenant, not request data.
    ws: safeTenantId(tenantId),
    type: cleanText(source.type ?? existing?.type, 90) || "workspace-approval",
    title: cleanText(source.title ?? existing?.title, 180) || "Approval request",
    detail: cleanNotes(source.detail ?? existing?.detail, 1400),
    ref: cleanText(source.ref ?? existing?.ref, 120),
    status,
    requestedBy: cleanText(source.requestedBy ?? existing?.requestedBy, 120) || "Workspace",
    at: cleanDate(source.at ?? existing?.at),
    resolvedAt: status === "pending" ? null : cleanDate(source.resolvedAt ?? existing?.resolvedAt ?? now),
    ownerNotes: cleanNotes(source.ownerNotes ?? existing?.ownerNotes, 1200),
    decision: cleanDecision(source.decision ?? existing?.decision),
    createdAt: cleanText(existing?.createdAt ?? source.createdAt, 80) || now,
    updatedAt: now,
    updatedBy: cleanText(actor, 120) || "system",
    serverBacked: true,
  };
}

export async function readWorkspaceApprovalDocument(tenantId: string, root?: string): Promise<WorkspaceApprovalDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as WorkspaceApprovalDocument;
    return documentWithChecksum({
      schemaVersion: 1,
      tenantId: safeTenantId(raw.tenantId || tenantId),
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      approvals: Array.isArray(raw.approvals)
        ? raw.approvals.map((approval) => normalizeWorkspaceApproval(approval, raw.tenantId || tenantId, approval.updatedBy || "system", approval))
        : [],
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-400) : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeWorkspaceApprovalDocumentUnlocked(document: WorkspaceApprovalDocument, root?: string) {
  const path = documentPath(document.tenantId, root);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return path;
}

export async function getWorkspaceApprovalDocument(tenantId: string, actor = "system", root?: string) {
  return await readWorkspaceApprovalDocument(tenantId, root) ?? defaultWorkspaceApprovalDocument(tenantId, actor);
}

function audit(tenantId: string, actor: string, approvalId: string, eventType: WorkspaceApprovalAuditEntry["eventType"], summary: string): WorkspaceApprovalAuditEntry {
  return { id: randomUUID(), tenantId, actor, approvalId, eventType, summary: summary.slice(0, 240), createdAt: new Date().toISOString() };
}

async function mutateWorkspaceApprovalDocument<T>(tenantId: string, actor: string, operation: (document: WorkspaceApprovalDocument) => T, root?: string) {
  return withTenantLock(tenantId, async () => {
    const current = await getWorkspaceApprovalDocument(tenantId, actor, root);
    const result = operation(current);
    const now = new Date().toISOString();
    const document = documentWithChecksum({
      schemaVersion: 1,
      tenantId: current.tenantId,
      version: current.version + 1,
      approvals: current.approvals.slice(0, 500),
      audit: current.audit.slice(-400),
      updatedAt: now,
      updatedBy: actor,
    });
    const path = await writeWorkspaceApprovalDocumentUnlocked(document, root);
    return { path, document, result };
  });
}

export async function createWorkspaceApproval(options: { tenantId: string; approval: unknown; actor: string; root?: string }) {
  return mutateWorkspaceApprovalDocument(options.tenantId, options.actor, (document) => {
    const approval = normalizeWorkspaceApproval(options.approval, document.tenantId, options.actor);
    document.approvals.unshift(approval);
    document.audit.push(audit(document.tenantId, options.actor, approval.id, "created", `Created approval request ${approval.title}`));
    return approval;
  }, options.root);
}

export async function decideWorkspaceApproval(options: { tenantId: string; approvalId: string; patch: unknown; actor: string; root?: string }) {
  return mutateWorkspaceApprovalDocument(options.tenantId, options.actor, (document) => {
    const existing = document.approvals.find((approval) => approval.id === options.approvalId);
    if (!existing) throw new Error("Workspace approval not found.");
    const next = normalizeWorkspaceApproval({ ...existing, ...(isRecord(options.patch) ? options.patch : {}) }, document.tenantId, options.actor, existing);
    Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt, resolvedAt: next.status === "pending" ? null : new Date().toISOString() });
    document.audit.push(audit(document.tenantId, options.actor, existing.id, "decided", `Updated approval request ${existing.title} to ${existing.status}`));
    return existing;
  }, options.root);
}

export async function deleteWorkspaceApproval(options: { tenantId: string; approvalId: string; actor: string; root?: string }) {
  return mutateWorkspaceApprovalDocument(options.tenantId, options.actor, (document) => {
    const existing = document.approvals.find((approval) => approval.id === options.approvalId);
    document.approvals = document.approvals.filter((approval) => approval.id !== options.approvalId);
    document.audit.push(audit(document.tenantId, options.actor, options.approvalId, "deleted", `Deleted approval request ${existing?.title || options.approvalId}`));
    return existing ?? null;
  }, options.root);
}

export function publicWorkspaceApprovalDocument(document: WorkspaceApprovalDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    version: document.version,
    approvals: document.approvals,
    audit: document.audit.slice(-25),
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}
