import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ProposalStatus = "draft" | "sent-ready" | "sent" | "won" | "lost" | "invoice-ready";

export type ProposalDraft = {
  id: string;
  tenantId: string;
  ws: string;
  client: string;
  contact: string;
  pkg: string;
  price: number;
  retainer: string;
  status: ProposalStatus;
  pain: string;
  scope: string[];
  timeline: string;
  leadId: string | null;
  setupSlotId: string;
  createdAt: string;
  updated: string;
  updatedBy: string;
  serverBacked: true;
};

export type ProposalAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  proposalId: string;
  eventType: "created" | "updated" | "deleted";
  summary: string;
  createdAt: string;
};

export type ProposalDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  proposals: ProposalDraft[];
  audit: ProposalAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/proposals");
const locks = new Map<string, Promise<unknown>>();
const STATUSES = new Set(["draft", "sent-ready", "sent", "won", "lost", "invoice-ready"]);

function safeTenantId(tenantId: string) {
  return tenantId.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

export function proposalRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_PROPOSAL_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(proposalRoot(root), `${safeTenantId(tenantId)}.json`);
}

function checksum(document: Omit<ProposalDocument, "checksum">) {
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

function cleanStatus(value: unknown): ProposalStatus {
  return typeof value === "string" && STATUSES.has(value) ? value as ProposalStatus : "draft";
}

function cleanPrice(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000, Math.round(number))) : 0;
}

function cleanScope(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 20);
}

function documentWithChecksum(document: Omit<ProposalDocument, "checksum">): ProposalDocument {
  return { ...document, checksum: checksum(document) };
}

export function defaultProposalDocument(tenantId: string, actor = "system"): ProposalDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({
    schemaVersion: 1,
    tenantId: safeTenantId(tenantId),
    version: 1,
    proposals: [],
    audit: [],
    updatedAt: now,
    updatedBy: actor,
  });
}

export function normalizeProposalDraft(value: unknown, tenantId: string, actor: string, existing?: ProposalDraft): ProposalDraft {
  const source = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  const client = cleanText(source.client ?? existing?.client, 140) || "New client";
  return {
    id: cleanText(source.id ?? existing?.id, 90) || randomUUID(),
    tenantId: safeTenantId(tenantId),
    ws: cleanText(source.ws ?? existing?.ws ?? tenantId, 90) || safeTenantId(tenantId),
    client,
    contact: cleanText(source.contact ?? existing?.contact, 140) || client,
    pkg: cleanText(source.pkg ?? existing?.pkg, 80) || "core",
    price: cleanPrice(source.price ?? existing?.price),
    retainer: cleanText(source.retainer ?? existing?.retainer, 80),
    status: cleanStatus(source.status ?? existing?.status),
    pain: cleanText(source.pain ?? existing?.pain, 600) || "Capture the pain in one sentence.",
    scope: cleanScope(source.scope ?? existing?.scope),
    timeline: cleanText(source.timeline ?? existing?.timeline, 240) || "Timeline not set.",
    leadId: cleanText(source.leadId ?? existing?.leadId, 120) || null,
    setupSlotId: cleanText(source.setupSlotId ?? existing?.setupSlotId, 80),
    createdAt: cleanText(existing?.createdAt ?? source.createdAt, 80) || now,
    updated: now,
    updatedBy: cleanText(actor, 120) || "system",
    serverBacked: true,
  };
}

export async function readProposalDocument(tenantId: string, root?: string): Promise<ProposalDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as ProposalDocument;
    return documentWithChecksum({
      schemaVersion: 1,
      tenantId: safeTenantId(raw.tenantId || tenantId),
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      proposals: Array.isArray(raw.proposals) ? raw.proposals.map((proposal) => normalizeProposalDraft(proposal, raw.tenantId || tenantId, proposal.updatedBy || "system", proposal)) : [],
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-400) : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeProposalDocumentUnlocked(document: ProposalDocument, root?: string) {
  const path = documentPath(document.tenantId, root);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return path;
}

export async function getProposalDocument(tenantId: string, actor = "system", root?: string) {
  return await readProposalDocument(tenantId, root) ?? defaultProposalDocument(tenantId, actor);
}

function audit(tenantId: string, actor: string, proposalId: string, eventType: ProposalAuditEntry["eventType"], summary: string): ProposalAuditEntry {
  return { id: randomUUID(), tenantId, actor, proposalId, eventType, summary: summary.slice(0, 240), createdAt: new Date().toISOString() };
}

async function mutateProposalDocument<T>(tenantId: string, actor: string, operation: (document: ProposalDocument) => T, root?: string) {
  return withTenantLock(tenantId, async () => {
    const current = await getProposalDocument(tenantId, actor, root);
    const result = operation(current);
    const now = new Date().toISOString();
    const document = documentWithChecksum({
      schemaVersion: 1,
      tenantId: current.tenantId,
      version: current.version + 1,
      proposals: current.proposals.slice(0, 500),
      audit: current.audit.slice(-400),
      updatedAt: now,
      updatedBy: actor,
    });
    const path = await writeProposalDocumentUnlocked(document, root);
    return { path, document, result };
  });
}

export async function createProposalDraft(options: { tenantId: string; proposal: unknown; actor: string; root?: string }) {
  return mutateProposalDocument(options.tenantId, options.actor, (document) => {
    const proposal = normalizeProposalDraft(options.proposal, document.tenantId, options.actor);
    document.proposals.unshift(proposal);
    document.audit.push(audit(document.tenantId, options.actor, proposal.id, "created", `Created proposal draft for ${proposal.client}`));
    return proposal;
  }, options.root);
}

export async function updateProposalDraft(options: { tenantId: string; proposalId: string; patch: unknown; actor: string; root?: string }) {
  return mutateProposalDocument(options.tenantId, options.actor, (document) => {
    const existing = document.proposals.find((proposal) => proposal.id === options.proposalId);
    if (!existing) throw new Error("Proposal draft not found.");
    const next = normalizeProposalDraft({ ...existing, ...(isRecord(options.patch) ? options.patch : {}) }, document.tenantId, options.actor, existing);
    Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt });
    document.audit.push(audit(document.tenantId, options.actor, existing.id, "updated", `Updated proposal draft for ${existing.client}`));
    return existing;
  }, options.root);
}

export async function deleteProposalDraft(options: { tenantId: string; proposalId: string; actor: string; root?: string }) {
  return mutateProposalDocument(options.tenantId, options.actor, (document) => {
    const existing = document.proposals.find((proposal) => proposal.id === options.proposalId);
    document.proposals = document.proposals.filter((proposal) => proposal.id !== options.proposalId);
    document.audit.push(audit(document.tenantId, options.actor, options.proposalId, "deleted", `Deleted proposal draft ${existing?.client || options.proposalId}`));
    return existing ?? null;
  }, options.root);
}

export function publicProposalDocument(document: ProposalDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    version: document.version,
    proposals: document.proposals,
    audit: document.audit.slice(-25),
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}
