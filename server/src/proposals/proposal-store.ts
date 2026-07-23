import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ProposalStatus = "draft" | "sent-ready" | "sent" | "won" | "lost" | "invoice-ready";

export type ProposalVersion = {
  id: string;
  versionNumber: number;
  payloadHash: string;
  createdAt: string;
  createdBy: string;
  client: string;
  contact: string;
  pkg: string;
  priceMinor: number;
  currency: string;
  retainer: string;
  pain: string;
  scope: string[];
  timeline: string;
  leadId: string | null;
  expiresAt: string;
};

export type ProposalAcceptanceReceipt = {
  id: string;
  tenantId: string;
  proposalId: string;
  versionId: string;
  versionNumber: number;
  payloadHash: string;
  acceptedAt: string;
  acceptedBy: string;
  totalMinor: number;
  currency: string;
};

export type ProposalConversionRecord = {
  id: string;
  tenantId: string;
  proposalId: string;
  acceptanceReceiptId: string;
  idempotencyKey: string;
  target: "invoice";
  status: "invoice-ready";
  createdAt: string;
  createdBy: string;
};

export type ProposalDraft = {
  id: string;
  tenantId: string;
  ws: string;
  client: string;
  contact: string;
  pkg: string;
  price: number;
  priceMinor: number;
  currency: string;
  retainer: string;
  status: ProposalStatus;
  pain: string;
  scope: string[];
  timeline: string;
  leadId: string | null;
  expiresAt: string;
  versions: ProposalVersion[];
  activeVersionId: string;
  acceptanceReceipt: ProposalAcceptanceReceipt | null;
  conversion: ProposalConversionRecord | null;
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
  eventType: "created" | "updated" | "versioned" | "accepted" | "converted" | "deleted";
  summary: string;
  createdAt: string;
};

export type ProposalDocument = {
  schemaVersion: 2;
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
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000, Math.round(number * 100) / 100)) : 0;
}

function cleanPriceMinor(value: unknown, fallbackPrice: unknown) {
  const minor = Number(value);
  if (Number.isInteger(minor) && minor >= 0) return Math.min(100_000_000, minor);
  return Math.round(cleanPrice(fallbackPrice) * 100);
}

function cleanCurrency(value: unknown) {
  const currency = cleanText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/u.test(currency) ? currency : "USD";
}

function cleanIsoDate(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function cleanScope(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 20);
}

function documentWithChecksum(document: Omit<ProposalDocument, "checksum">): ProposalDocument {
  return { ...document, checksum: checksum(document) };
}

function versionPayload(proposal: Pick<ProposalDraft, "client" | "contact" | "pkg" | "priceMinor" | "currency" | "retainer" | "pain" | "scope" | "timeline" | "leadId" | "expiresAt">) {
  return {
    client: proposal.client,
    contact: proposal.contact,
    pkg: proposal.pkg,
    priceMinor: proposal.priceMinor,
    currency: proposal.currency,
    retainer: proposal.retainer,
    pain: proposal.pain,
    scope: [...proposal.scope],
    timeline: proposal.timeline,
    leadId: proposal.leadId,
    expiresAt: proposal.expiresAt,
  };
}

function payloadHash(payload: ReturnType<typeof versionPayload>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeProposalVersion(proposal: ProposalDraft, actor: string, createdAt = new Date().toISOString()): ProposalVersion {
  const payload = versionPayload(proposal);
  return {
    id: randomUUID(),
    versionNumber: proposal.versions.length + 1,
    payloadHash: payloadHash(payload),
    createdAt,
    createdBy: cleanText(actor, 120) || "system",
    ...payload,
  };
}

function normalizeVersion(value: unknown, proposal: ProposalDraft, fallbackNumber: number): ProposalVersion | null {
  if (!isRecord(value)) return null;
  const priceMinor = cleanPriceMinor(value.priceMinor, value.price);
  const normalized = {
    client: cleanText(value.client, 140) || proposal.client,
    contact: cleanText(value.contact, 140) || proposal.contact,
    pkg: cleanText(value.pkg, 80) || proposal.pkg,
    priceMinor,
    currency: cleanCurrency(value.currency),
    retainer: cleanText(value.retainer, 80),
    pain: cleanText(value.pain, 600) || proposal.pain,
    scope: cleanScope(value.scope),
    timeline: cleanText(value.timeline, 240) || proposal.timeline,
    leadId: cleanText(value.leadId, 120) || null,
    expiresAt: cleanIsoDate(value.expiresAt),
  };
  return {
    id: cleanText(value.id, 90) || randomUUID(),
    versionNumber: Number.isInteger(value.versionNumber) && Number(value.versionNumber) > 0
      ? Number(value.versionNumber)
      : fallbackNumber,
    payloadHash: payloadHash(normalized),
    createdAt: cleanIsoDate(value.createdAt) || proposal.createdAt,
    createdBy: cleanText(value.createdBy, 120) || proposal.updatedBy,
    ...normalized,
  };
}

function normalizeAcceptance(value: unknown, proposal: ProposalDraft): ProposalAcceptanceReceipt | null {
  if (!isRecord(value)) return null;
  const version = proposal.versions.find((candidate) => candidate.id === cleanText(value.versionId, 90));
  if (!version || cleanText(value.payloadHash, 64) !== version.payloadHash) return null;
  return {
    id: cleanText(value.id, 90) || randomUUID(),
    tenantId: proposal.tenantId,
    proposalId: proposal.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    payloadHash: version.payloadHash,
    acceptedAt: cleanIsoDate(value.acceptedAt) || proposal.updated,
    acceptedBy: cleanText(value.acceptedBy, 120) || "system",
    totalMinor: version.priceMinor,
    currency: version.currency,
  };
}

function normalizeConversion(value: unknown, proposal: ProposalDraft): ProposalConversionRecord | null {
  if (!isRecord(value) || !proposal.acceptanceReceipt) return null;
  if (cleanText(value.acceptanceReceiptId, 90) !== proposal.acceptanceReceipt.id) return null;
  return {
    id: cleanText(value.id, 90) || randomUUID(),
    tenantId: proposal.tenantId,
    proposalId: proposal.id,
    acceptanceReceiptId: proposal.acceptanceReceipt.id,
    idempotencyKey: cleanText(value.idempotencyKey, 180) || `proposal-conversion:${proposal.acceptanceReceipt.id}`,
    target: "invoice",
    status: "invoice-ready",
    createdAt: cleanIsoDate(value.createdAt) || proposal.updated,
    createdBy: cleanText(value.createdBy, 120) || "system",
  };
}

export function defaultProposalDocument(tenantId: string, actor = "system"): ProposalDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({
    schemaVersion: 2,
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
  const priceWasPatched = Object.prototype.hasOwnProperty.call(source, "price")
    && (!existing || Number(source.price) !== existing.price);
  const priceMinor = priceWasPatched && !Number.isInteger(Number(source.priceMinor))
    ? cleanPriceMinor(undefined, source.price)
    : cleanPriceMinor(source.priceMinor ?? existing?.priceMinor, source.price ?? existing?.price);
  return {
    id: cleanText(source.id ?? existing?.id, 90) || randomUUID(),
    tenantId: safeTenantId(tenantId),
    // The authenticated tenant is authoritative. A client-supplied ws value
    // must never make this record appear under another organization.
    ws: safeTenantId(tenantId),
    client,
    contact: cleanText(source.contact ?? existing?.contact, 140) || client,
    pkg: cleanText(source.pkg ?? existing?.pkg, 80) || "core",
    price: priceMinor / 100,
    priceMinor,
    currency: cleanCurrency(source.currency ?? existing?.currency),
    retainer: cleanText(source.retainer ?? existing?.retainer, 80),
    status: cleanStatus(source.status ?? existing?.status),
    pain: cleanText(source.pain ?? existing?.pain, 600) || "Capture the pain in one sentence.",
    scope: cleanScope(source.scope ?? existing?.scope),
    timeline: cleanText(source.timeline ?? existing?.timeline, 240) || "Timeline not set.",
    leadId: cleanText(source.leadId ?? existing?.leadId, 120) || null,
    expiresAt: cleanIsoDate(source.expiresAt ?? existing?.expiresAt),
    versions: existing?.versions.map((version) => structuredClone(version)) ?? [],
    activeVersionId: existing?.activeVersionId ?? "",
    acceptanceReceipt: existing?.acceptanceReceipt ? structuredClone(existing.acceptanceReceipt) : null,
    conversion: existing?.conversion ? structuredClone(existing.conversion) : null,
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
    const authoritativeTenantId = safeTenantId(raw.tenantId || tenantId);
    const proposals = Array.isArray(raw.proposals) ? raw.proposals.map((persisted) => {
      const proposal = normalizeProposalDraft(persisted, authoritativeTenantId, persisted.updatedBy || "system");
      const source: Record<string, unknown> = isRecord(persisted) ? persisted : {};
      proposal.versions = Array.isArray(source.versions)
        ? source.versions.map((version: unknown, index: number) => normalizeVersion(version, proposal, index + 1)).filter((version: ProposalVersion | null): version is ProposalVersion => Boolean(version))
        : [];
      if (proposal.versions.length === 0) proposal.versions = [makeProposalVersion(proposal, proposal.updatedBy, proposal.createdAt)];
      proposal.versions.sort((left, right) => left.versionNumber - right.versionNumber);
      proposal.activeVersionId = proposal.versions.some((version) => version.id === cleanText(source.activeVersionId, 90))
        ? cleanText(source.activeVersionId, 90)
        : proposal.versions.at(-1)!.id;
      proposal.acceptanceReceipt = normalizeAcceptance(source.acceptanceReceipt, proposal);
      proposal.conversion = normalizeConversion(source.conversion, proposal);
      return proposal;
    }) : [];
    return documentWithChecksum({
      schemaVersion: 2,
      tenantId: authoritativeTenantId,
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      proposals,
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
      schemaVersion: 2,
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
    const version = makeProposalVersion(proposal, options.actor, proposal.createdAt);
    proposal.versions = [version];
    proposal.activeVersionId = version.id;
    document.proposals.unshift(proposal);
    document.audit.push(audit(document.tenantId, options.actor, proposal.id, "created", `Created proposal draft for ${proposal.client}`));
    return proposal;
  }, options.root);
}

export async function updateProposalDraft(options: { tenantId: string; proposalId: string; patch: unknown; actor: string; root?: string }) {
  return mutateProposalDocument(options.tenantId, options.actor, (document) => {
    const existing = document.proposals.find((proposal) => proposal.id === options.proposalId);
    if (!existing) throw new Error("Proposal draft not found.");
    const patch = isRecord(options.patch) ? options.patch : {};
    const nextSource: Record<string, unknown> = { ...existing, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "price") && !Object.prototype.hasOwnProperty.call(patch, "priceMinor")) {
      nextSource.priceMinor = undefined;
    }
    const next = normalizeProposalDraft(nextSource, document.tenantId, options.actor, existing);
    const activeVersion = existing.versions.find((version) => version.id === existing.activeVersionId) ?? existing.versions.at(-1);
    const nextHash = payloadHash(versionPayload(next));
    if (!activeVersion || activeVersion.payloadHash !== nextHash) {
      const version = makeProposalVersion(next, options.actor);
      next.versions.push(version);
      next.activeVersionId = version.id;
      next.acceptanceReceipt = null;
      next.conversion = null;
      document.audit.push(audit(document.tenantId, options.actor, existing.id, "versioned", `Created immutable proposal version ${version.versionNumber} for ${next.client}`));
    }
    Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt });
    document.audit.push(audit(document.tenantId, options.actor, existing.id, "updated", `Updated proposal draft for ${existing.client}`));
    return existing;
  }, options.root);
}

export async function acceptProposalVersion(options: {
  tenantId: string;
  proposalId: string;
  versionId: string;
  expectedPayloadHash: string;
  actor: string;
  root?: string;
}) {
  return mutateProposalDocument(options.tenantId, options.actor, (document) => {
    const proposal = document.proposals.find((candidate) => candidate.id === options.proposalId);
    if (!proposal) throw new Error("Proposal draft not found.");
    const version = proposal.versions.find((candidate) => candidate.id === options.versionId);
    if (!version) throw new Error("Proposal version not found.");
    if (version.id !== proposal.activeVersionId) throw new Error("proposal_version_not_active");
    if (version.payloadHash !== options.expectedPayloadHash) throw new Error("proposal_payload_changed");
    if (version.expiresAt && Date.parse(version.expiresAt) <= Date.now()) throw new Error("proposal_expired");
    if (proposal.status === "lost") throw new Error("lost_proposal_cannot_be_accepted");
    if (proposal.acceptanceReceipt) {
      if (proposal.acceptanceReceipt.versionId === version.id && proposal.acceptanceReceipt.payloadHash === version.payloadHash) {
        return proposal.acceptanceReceipt;
      }
      throw new Error("proposal_already_accepted");
    }
    const receipt: ProposalAcceptanceReceipt = {
      id: randomUUID(),
      tenantId: document.tenantId,
      proposalId: proposal.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      payloadHash: version.payloadHash,
      acceptedAt: new Date().toISOString(),
      acceptedBy: cleanText(options.actor, 120) || "system",
      totalMinor: version.priceMinor,
      currency: version.currency,
    };
    proposal.acceptanceReceipt = receipt;
    proposal.status = "won";
    proposal.updated = receipt.acceptedAt;
    proposal.updatedBy = receipt.acceptedBy;
    document.audit.push(audit(document.tenantId, options.actor, proposal.id, "accepted", `Accepted proposal version ${version.versionNumber} for ${proposal.client}`));
    return receipt;
  }, options.root);
}

export async function convertAcceptedProposal(options: {
  tenantId: string;
  proposalId: string;
  idempotencyKey?: string;
  actor: string;
  root?: string;
}) {
  return mutateProposalDocument(options.tenantId, options.actor, (document) => {
    const proposal = document.proposals.find((candidate) => candidate.id === options.proposalId);
    if (!proposal) throw new Error("Proposal draft not found.");
    if (!proposal.acceptanceReceipt) throw new Error("proposal_acceptance_required");
    const key = cleanText(options.idempotencyKey, 180) || `proposal-conversion:${proposal.acceptanceReceipt.id}`;
    if (proposal.conversion) {
      if (proposal.conversion.idempotencyKey === key) return proposal.conversion;
      throw new Error("proposal_already_converted");
    }
    const conversion: ProposalConversionRecord = {
      id: randomUUID(),
      tenantId: document.tenantId,
      proposalId: proposal.id,
      acceptanceReceiptId: proposal.acceptanceReceipt.id,
      idempotencyKey: key,
      target: "invoice",
      status: "invoice-ready",
      createdAt: new Date().toISOString(),
      createdBy: cleanText(options.actor, 120) || "system",
    };
    proposal.conversion = conversion;
    proposal.status = "invoice-ready";
    proposal.updated = conversion.createdAt;
    proposal.updatedBy = conversion.createdBy;
    document.audit.push(audit(document.tenantId, options.actor, proposal.id, "converted", `Converted accepted proposal for ${proposal.client} to invoice-ready`));
    return conversion;
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
