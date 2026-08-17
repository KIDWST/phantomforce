import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateProductionPolicy, type ProductionAction, type ProductionRole } from "./policy.js";
import { ProviderAdapterError, type ProviderAdapter, type ProviderConnectionStatus, type ProviderPlatformStatus } from "./provider-adapter.js";

export type TruthState = "real" | "sandbox" | "mock" | "degraded" | "unavailable";
type Entity = { id: string; tenantId: string; createdAt: string; updatedAt: string; truth: TruthState };
type CommandResult = { entityType: string; entityId: string; data?: Record<string, unknown> };

export type ProductionCommandEnvelope = {
  tenantId: string;
  actorId: string;
  actorRole: ProductionRole;
  action: ProductionAction;
  commandId: string;
  idempotencyKey: string;
  correlationId: string;
  expectedRevision?: number;
  invocationSource?: "human" | "phantom" | "system";
  payload: Record<string, unknown>;
};

type Lead = Entity & { name: string; company: string; source: string; status: "new" | "converted"; clientId: string | null };
type Conversion = Entity & { leadId: string; clientId: string; actorId: string; correlationId: string };
type Client = Entity & { sourceLeadId: string; name: string; company: string; status: "active" | "archived" };
type Campaign = Entity & { clientId: string; name: string; objective: string; status: "active" | "archived" };
type Content = Entity & { clientId: string; campaignId: string; title: string; currentRevisionId: string; revision: number };
type ContentRevision = Entity & { contentId: string; version: number; body: string; mediaAssetIds: string[]; hash: string; createdBy: string };
type MediaAsset = Entity & { clientId: string; campaignId: string; contentId: string; name: string; storageKey: string; checksum: string; state: "ready" | "rejected" };
type Approval = Entity & { contentId: string; revisionId: string; revisionHash: string; status: "pending" | "approved" | "rejected"; requestedBy: string; decidedBy: string | null; decidedAt: string | null };
type Publication = Entity & { clientId: string; campaignId: string; contentId: string; revisionId: string; approvalId: string; providerConnectionId: string; jobId: string; status: "queued" | "publishing" | "accepted" | "published" | "failed"; providerResultId: string | null; analyticsId: string | null; failureMode: string; lastErrorCode: string | null; remediation: string | null };
type ProviderResult = Entity & { publicationId: string; providerPublicationId: string; publicUrl: string; rawStatus: string; responsePersistedAt: string };
type Analytics = Entity & { clientId: string; campaignId: string; contentId: string; publicationId: string; providerResultId: string; providerPublicationId: string; capturedAt: string; impressions: number; engagements: number; clicks: number };
type ProviderConnection = Entity & { providerId: string; environment: "sandbox" | "production"; platformStatus: ProviderPlatformStatus; connectionStatus: ProviderConnectionStatus; verifiedAt: string | null; detail: string; lastErrorCode: string | null };
type CoreJob = Entity & { type: "publication.dispatch"; publicationId: string; state: "queued" | "running" | "retrying" | "succeeded" | "failed"; attempt: number; maxAttempts: number; availableAt: string; startedAt: string | null; completedAt: string | null; leaseOwner: string | null; leaseExpiresAt: string | null; correlationId: string; idempotencyKey: string; lastErrorCode: string | null; lastError: string | null; retryable: boolean; remediation: string | null };
type DomainEvent = Entity & { eventType: string; entityType: string; entityId: string; correlationId: string; actorId: string; payload: Record<string, unknown> };
type AuditEvent = Entity & { action: ProductionAction | "provider.publish" | "provider.analytics" | "provider.webhook"; entityType: string; entityId: string; correlationId: string; actorId: string; role: ProductionRole; policy: string; decision: "allowed"; payload: Record<string, unknown> };
type Activity = Entity & { clientId: string | null; campaignId: string | null; entityType: string; entityId: string; correlationId: string; summary: string };
type PhantomAction = Entity & { actorId: string; invocation: string; contextEntityIds: string[]; requestedCommand: string; commandsExecuted: string[]; result: string; correlationId: string; startedAt: string; completedAt: string };
type Recommendation = Entity & { clientId: string; campaignId: string; publicationId: string; analyticsId: string; summary: string; nextCommand: "followup.create"; phantomActionId: string };
type FollowUp = Entity & { clientId: string; campaignId: string; recommendationId: string; status: "open" | "done"; summary: string };
type CommandReceipt = Entity & { commandId: string; idempotencyKey: string; action: ProductionAction; correlationId: string; actorId: string; result: CommandResult };
type ProviderWebhook = Entity & { providerId: string; webhookId: string; providerPublicationId: string; sequence: number; eventType: "publication.succeeded" | "publication.failed"; correlationId: string; payloadHash: string; applied: boolean; ignoredReason: string | null };
type Incident = Entity & { correlationId: string; kind: string; status: "open" | "resolved"; summary: string; entityType: string; entityId: string; remediation: string | null; resolvedAt: string | null };

export type ProductionCoreDocument = {
  schemaVersion: 1;
  tenantId: string;
  organizationStatus: "active" | "suspended";
  version: number;
  updatedAt: string;
  leads: Lead[];
  conversions: Conversion[];
  clients: Client[];
  campaigns: Campaign[];
  contents: Content[];
  revisions: ContentRevision[];
  mediaAssets: MediaAsset[];
  approvals: Approval[];
  publications: Publication[];
  providerResults: ProviderResult[];
  analytics: Analytics[];
  providerConnections: ProviderConnection[];
  jobs: CoreJob[];
  events: DomainEvent[];
  auditEvents: AuditEvent[];
  activities: Activity[];
  phantomActions: PhantomAction[];
  recommendations: Recommendation[];
  followUps: FollowUp[];
  commands: CommandReceipt[];
  providerWebhooks: ProviderWebhook[];
  incidents: Incident[];
};

export class ProductionCoreError extends Error {
  constructor(public readonly code: string, message = code, public readonly statusCode = 409, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ProductionCoreError";
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/production-core");
const locks = new Map<string, Promise<unknown>>();

function clean(value: unknown, max = 300) { return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : ""; }
function safeTenant(value: string) { return clean(value, 80).replace(/[^a-zA-Z0-9_.:-]+/gu, "-").replace(/^-+|-+$/gu, "") || "unknown"; }
function now() { return new Date().toISOString(); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function entity<T extends Record<string, unknown>>(tenantId: string, truth: TruthState, extra: T): Entity & T {
  const at = now();
  return { id: randomUUID(), tenantId, truth, createdAt: at, updatedAt: at, ...extra };
}
function emptyDocument(tenantId: string): ProductionCoreDocument {
  return { schemaVersion: 1, tenantId: safeTenant(tenantId), organizationStatus: "active", version: 1, updatedAt: now(), leads: [], conversions: [], clients: [], campaigns: [], contents: [], revisions: [], mediaAssets: [], approvals: [], publications: [], providerResults: [], analytics: [], providerConnections: [], jobs: [], events: [], auditEvents: [], activities: [], phantomActions: [], recommendations: [], followUps: [], commands: [], providerWebhooks: [], incidents: [] };
}
function coreRoot(override?: string) { return resolve(override || process.env.PHANTOMFORCE_PRODUCTION_CORE_DIR || defaultRoot); }
function documentPath(tenantId: string, root?: string) { return resolve(coreRoot(root), `${safeTenant(tenantId)}.json`); }

export async function readProductionCore(tenantId: string, root?: string): Promise<ProductionCoreDocument> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as Partial<ProductionCoreDocument>;
    const base = emptyDocument(tenantId);
    const arrays = Object.keys(base).filter((key) => Array.isArray(base[key as keyof ProductionCoreDocument]));
    for (const key of arrays) (base as unknown as Record<string, unknown>)[key] = Array.isArray((raw as unknown as Record<string, unknown>)[key]) ? (raw as unknown as Record<string, unknown>)[key] : [];
    base.version = Number.isInteger(raw.version) && Number(raw.version) > 0 ? Number(raw.version) : 1;
    base.organizationStatus = raw.organizationStatus === "suspended" ? "suspended" : "active";
    base.updatedAt = clean(raw.updatedAt, 80) || now();
    return base;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDocument(tenantId);
    throw error;
  }
}

async function mutate<T>(tenantId: string, operation: (document: ProductionCoreDocument) => T | Promise<T>, root?: string): Promise<T> {
  const key = documentPath(tenantId, root).toLowerCase();
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const document = await readProductionCore(tenantId, root);
    const result = await operation(document);
    if (process.env.PHANTOMFORCE_PRODUCTION_CORE_FORCE_WRITE_FAILURE === "true") throw new ProductionCoreError("transaction_unavailable", "The production-core transaction store rejected the write.", 503);
    document.version += 1;
    document.updatedAt = now();
    const target = documentPath(tenantId, root);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return result;
  });
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

function required(document: ProductionCoreDocument, collection: keyof ProductionCoreDocument, id: unknown, code: string) {
  const rows = document[collection] as unknown[];
  const row = rows.find((item) => (item as { id?: string }).id === clean(id, 120));
  if (!row) throw new ProductionCoreError(code, code, 404);
  return row as Record<string, unknown>;
}
function event(document: ProductionCoreDocument, envelope: ProductionCommandEnvelope, eventType: string, entityType: string, entityId: string, payload: Record<string, unknown> = {}) {
  document.events.push(entity(document.tenantId, "real", { eventType, entityType, entityId, correlationId: envelope.correlationId, actorId: envelope.actorId, payload }));
}
function audit(document: ProductionCoreDocument, envelope: ProductionCommandEnvelope, entityType: string, entityId: string, payload: Record<string, unknown> = {}) {
  document.auditEvents.push(entity(document.tenantId, "real", { action: envelope.action, entityType, entityId, correlationId: envelope.correlationId, actorId: envelope.actorId, role: envelope.actorRole, policy: "production-core-v1", decision: "allowed" as const, payload }));
}
function activity(document: ProductionCoreDocument, envelope: ProductionCommandEnvelope, entityType: string, entityId: string, summary: string, clientId: string | null = null, campaignId: string | null = null) {
  document.activities.push(entity(document.tenantId, "real", { entityType, entityId, correlationId: envelope.correlationId, summary: clean(summary, 300), clientId, campaignId }));
}
function commandReceipt(document: ProductionCoreDocument, envelope: ProductionCommandEnvelope, result: CommandResult) {
  document.commands.push(entity(document.tenantId, "real", { commandId: envelope.commandId, idempotencyKey: envelope.idempotencyKey, action: envelope.action, correlationId: envelope.correlationId, actorId: envelope.actorId, result }));
}

export async function executeProductionCommand(envelope: ProductionCommandEnvelope, root?: string) {
  const tenantId = safeTenant(envelope.tenantId);
  if (!clean(envelope.commandId, 180) || !clean(envelope.idempotencyKey, 180) || !clean(envelope.correlationId, 180)) throw new ProductionCoreError("command_metadata_required", "Command ID, idempotency key, and correlation ID are required.", 400);
  const policy = evaluateProductionPolicy(envelope.actorRole, envelope.action);
  if (!policy.allowed) throw new ProductionCoreError(policy.reason, policy.reason, 403, { action: envelope.action, role: envelope.actorRole, policy: policy.policy });
  return mutate(tenantId, (document) => {
    if (document.organizationStatus === "suspended" && envelope.action !== "organization.resume") {
      throw new ProductionCoreError("organization_suspended", "This organization is suspended; consequential commands are blocked.", 423);
    }
    const existing = document.commands.find((receipt) => receipt.commandId === envelope.commandId || (receipt.action === envelope.action && receipt.idempotencyKey === envelope.idempotencyKey));
    if (existing) return { repeated: true, receipt: existing, result: existing.result, documentVersion: document.version };
    const payload = envelope.payload || {};
    let result: CommandResult;

    switch (envelope.action) {
      case "lead.create": {
        const lead = entity(document.tenantId, "real", { name: clean(payload.name, 160) || "Unnamed lead", company: clean(payload.company, 160) || clean(payload.name, 160) || "Unnamed lead", source: clean(payload.source, 120) || "Manual capture", status: "new" as const, clientId: null });
        document.leads.push(lead);
        event(document, envelope, "LeadCreated", "lead", lead.id, { source: lead.source }); audit(document, envelope, "lead", lead.id); activity(document, envelope, "lead", lead.id, `Lead created: ${lead.company}`);
        result = { entityType: "lead", entityId: lead.id, data: { lead } };
        break;
      }
      case "lead.convert": {
        const lead = required(document, "leads", payload.leadId, "lead_not_found") as unknown as Lead;
        if (lead.clientId) {
          result = { entityType: "client", entityId: lead.clientId, data: { client: required(document, "clients", lead.clientId, "client_not_found"), lead } };
          break;
        }
        const client = entity(document.tenantId, "real", { sourceLeadId: lead.id, name: lead.name, company: lead.company, status: "active" as const });
        const conversion = entity(document.tenantId, "real", { leadId: lead.id, clientId: client.id, actorId: envelope.actorId, correlationId: envelope.correlationId });
        lead.status = "converted"; lead.clientId = client.id; lead.updatedAt = now(); document.clients.push(client); document.conversions.push(conversion);
        event(document, envelope, "LeadConverted", "client", client.id, { sourceLeadId: lead.id, conversionId: conversion.id }); audit(document, envelope, "client", client.id, { sourceLeadId: lead.id }); activity(document, envelope, "client", client.id, `Lead converted to canonical client ${client.company}.`, client.id);
        result = { entityType: "client", entityId: client.id, data: { client, lead, conversion } };
        break;
      }
      case "client.archive": {
        const client = required(document, "clients", payload.clientId, "client_not_found") as unknown as Client;
        client.status = "archived"; client.updatedAt = now();
        for (const campaign of document.campaigns.filter((item) => item.clientId === client.id)) { campaign.status = "archived"; campaign.updatedAt = now(); }
        event(document, envelope, "ClientArchived", "client", client.id, { affectedCampaignIds: document.campaigns.filter((item) => item.clientId === client.id).map((item) => item.id) });
        audit(document, envelope, "client", client.id); activity(document, envelope, "client", client.id, `Client archived: ${client.company}.`, client.id);
        result = { entityType: "client", entityId: client.id, data: { client } };
        break;
      }
      case "campaign.create": {
        const client = required(document, "clients", payload.clientId, "client_not_found") as unknown as Client;
        if (client.status !== "active") throw new ProductionCoreError("client_not_active");
        const campaign = entity(document.tenantId, "real", { clientId: client.id, name: clean(payload.name, 160) || "Untitled campaign", objective: clean(payload.objective, 600), status: "active" as const });
        document.campaigns.push(campaign); event(document, envelope, "CampaignCreated", "campaign", campaign.id, { clientId: client.id }); audit(document, envelope, "campaign", campaign.id); activity(document, envelope, "campaign", campaign.id, `Campaign created: ${campaign.name}`, client.id, campaign.id);
        result = { entityType: "campaign", entityId: campaign.id, data: { campaign } };
        break;
      }
      case "content.create": {
        const campaign = required(document, "campaigns", payload.campaignId, "campaign_not_found") as unknown as Campaign;
        const campaignClient = required(document, "clients", campaign.clientId, "client_not_found") as unknown as Client;
        if (campaign.status !== "active" || campaignClient.status !== "active") throw new ProductionCoreError("client_not_active", "Archived client work cannot create new content.");
        const content = entity(document.tenantId, "real", { clientId: campaign.clientId, campaignId: campaign.id, title: clean(payload.title, 200) || "Untitled content", currentRevisionId: "", revision: 1 });
        const body = clean(payload.body, 20_000);
        const revision = entity(document.tenantId, "real", { contentId: content.id, version: 1, body, mediaAssetIds: [] as string[], hash: hash({ body, mediaAssetIds: [] }), createdBy: envelope.actorId });
        content.currentRevisionId = revision.id; document.contents.push(content); document.revisions.push(revision);
        event(document, envelope, "ContentCreated", "content", content.id, { campaignId: campaign.id, revisionId: revision.id }); event(document, envelope, "ContentRevisionCreated", "revision", revision.id, { contentId: content.id, version: 1, hash: revision.hash }); audit(document, envelope, "content", content.id); activity(document, envelope, "content", content.id, `Content created at revision 1: ${content.title}`, campaign.clientId, campaign.id);
        result = { entityType: "content", entityId: content.id, data: { content, revision } };
        break;
      }
      case "content.revise": {
        const content = required(document, "contents", payload.contentId, "content_not_found") as unknown as Content;
        if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== content.revision) throw new ProductionCoreError("revision_conflict", "The content changed before this command executed.", 409, { expected: envelope.expectedRevision, actual: content.revision });
        const current = required(document, "revisions", content.currentRevisionId, "revision_not_found") as unknown as ContentRevision;
        const body = clean(payload.body, 20_000) || current.body;
        const revision = entity(document.tenantId, "real", { contentId: content.id, version: content.revision + 1, body, mediaAssetIds: [...current.mediaAssetIds], hash: hash({ body, mediaAssetIds: current.mediaAssetIds }), createdBy: envelope.actorId });
        content.currentRevisionId = revision.id; content.revision = revision.version; content.updatedAt = now(); document.revisions.push(revision);
        event(document, envelope, "ContentRevisionCreated", "revision", revision.id, { contentId: content.id, version: revision.version, hash: revision.hash }); audit(document, envelope, "revision", revision.id); activity(document, envelope, "revision", revision.id, `Content revised to version ${revision.version}.`, content.clientId, content.campaignId);
        result = { entityType: "revision", entityId: revision.id, data: { content, revision } };
        break;
      }
      case "media.attach": {
        const content = required(document, "contents", payload.contentId, "content_not_found") as unknown as Content;
        if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== content.revision) throw new ProductionCoreError("revision_conflict", "The content changed before media was attached.", 409, { expected: envelope.expectedRevision, actual: content.revision });
        const current = required(document, "revisions", content.currentRevisionId, "revision_not_found") as unknown as ContentRevision;
        const asset = entity(document.tenantId, "real", { clientId: content.clientId, campaignId: content.campaignId, contentId: content.id, name: clean(payload.name, 200) || "Attached media", storageKey: clean(payload.storageKey, 400) || `production-core/${randomUUID()}`, checksum: clean(payload.checksum, 128) || hash(payload.name || randomUUID()), state: "ready" as const });
        const mediaAssetIds = [...current.mediaAssetIds, asset.id];
        const revision = entity(document.tenantId, "real", { contentId: content.id, version: content.revision + 1, body: current.body, mediaAssetIds, hash: hash({ body: current.body, mediaAssetIds }), createdBy: envelope.actorId });
        content.currentRevisionId = revision.id; content.revision = revision.version; content.updatedAt = now(); document.mediaAssets.push(asset); document.revisions.push(revision);
        event(document, envelope, "MediaAttached", "media_asset", asset.id, { contentId: content.id, revisionId: revision.id }); event(document, envelope, "ContentRevisionCreated", "revision", revision.id, { contentId: content.id, version: revision.version, hash: revision.hash }); audit(document, envelope, "media_asset", asset.id); activity(document, envelope, "media_asset", asset.id, `Media attached and revision ${revision.version} created.`, content.clientId, content.campaignId);
        result = { entityType: "media_asset", entityId: asset.id, data: { asset, content, revision } };
        break;
      }
      case "approval.request": {
        const content = required(document, "contents", payload.contentId, "content_not_found") as unknown as Content;
        const revision = required(document, "revisions", payload.revisionId, "revision_not_found") as unknown as ContentRevision;
        if (revision.contentId !== content.id) throw new ProductionCoreError("revision_content_mismatch");
        const approval = entity(document.tenantId, "real", { contentId: content.id, revisionId: revision.id, revisionHash: revision.hash, status: "pending" as const, requestedBy: envelope.actorId, decidedBy: null, decidedAt: null });
        document.approvals.push(approval); event(document, envelope, "ApprovalRequested", "approval", approval.id, { contentId: content.id, revisionId: revision.id, revisionHash: revision.hash }); audit(document, envelope, "approval", approval.id); activity(document, envelope, "approval", approval.id, `Approval requested for revision ${revision.version}.`, content.clientId, content.campaignId);
        result = { entityType: "approval", entityId: approval.id, data: { approval } };
        break;
      }
      case "approval.decide": {
        const approval = required(document, "approvals", payload.approvalId, "approval_not_found") as unknown as Approval;
        if (approval.status !== "pending") throw new ProductionCoreError("approval_already_decided");
        approval.status = payload.decision === "approved" ? "approved" : "rejected"; approval.decidedBy = envelope.actorId; approval.decidedAt = now(); approval.updatedAt = approval.decidedAt;
        const revision = required(document, "revisions", approval.revisionId, "revision_not_found") as unknown as ContentRevision;
        if (revision.hash !== approval.revisionHash) throw new ProductionCoreError("approved_revision_hash_mismatch");
        const content = required(document, "contents", approval.contentId, "content_not_found") as unknown as Content;
        event(document, envelope, approval.status === "approved" ? "ContentApproved" : "ContentRejected", "approval", approval.id, { contentId: content.id, revisionId: revision.id, revisionHash: revision.hash }); audit(document, envelope, "approval", approval.id, { decision: approval.status }); activity(document, envelope, "approval", approval.id, `Revision ${revision.version} ${approval.status}.`, content.clientId, content.campaignId);
        result = { entityType: "approval", entityId: approval.id, data: { approval } };
        break;
      }
      case "provider.connect": {
        throw new ProductionCoreError("provider_verification_requires_adapter", "Use verifyProductionProviderConnection for provider connections.", 400);
      }
      case "provider.refresh": {
        throw new ProductionCoreError("provider_refresh_requires_adapter", "Use refreshProductionProviderConnection for authorization refresh.", 400);
      }
      case "publication.request": {
        if (process.env.PHANTOMFORCE_PRODUCTION_CORE_QUEUE_STATE === "unavailable") throw new ProductionCoreError("queue_unavailable", "The publication queue is unavailable; no publication was created.", 503);
        const content = required(document, "contents", payload.contentId, "content_not_found") as unknown as Content;
        const client = required(document, "clients", content.clientId, "client_not_found") as unknown as Client;
        const campaign = required(document, "campaigns", content.campaignId, "campaign_not_found") as unknown as Campaign;
        if (client.status !== "active" || campaign.status !== "active") throw new ProductionCoreError("client_not_active", "Archived client work cannot be published.");
        const revision = required(document, "revisions", payload.revisionId, "revision_not_found") as unknown as ContentRevision;
        if (revision.contentId !== content.id) throw new ProductionCoreError("revision_content_mismatch");
        const approval = document.approvals.find((item) => item.contentId === content.id && item.revisionId === revision.id && item.revisionHash === revision.hash && item.status === "approved");
        if (!approval) throw new ProductionCoreError("approved_revision_required", "The exact revision must be approved before publishing.");
        const connection = required(document, "providerConnections", payload.providerConnectionId, "provider_connection_not_found") as unknown as ProviderConnection;
        if (connection.connectionStatus !== "authorized" || connection.platformStatus !== "operational") throw new ProductionCoreError("provider_connection_not_ready", "Provider platform and organization authorization must both be verified.", 409, { platformStatus: connection.platformStatus, connectionStatus: connection.connectionStatus });
        const job = entity(document.tenantId, connection.truth, { type: "publication.dispatch" as const, publicationId: "", state: "queued" as const, attempt: 0, maxAttempts: 3, availableAt: now(), startedAt: null, completedAt: null, leaseOwner: null, leaseExpiresAt: null, correlationId: envelope.correlationId, idempotencyKey: envelope.idempotencyKey, lastErrorCode: null, lastError: null, retryable: false, remediation: null });
        const publication = entity(document.tenantId, connection.truth, { clientId: content.clientId, campaignId: content.campaignId, contentId: content.id, revisionId: revision.id, approvalId: approval.id, providerConnectionId: connection.id, jobId: job.id, status: "queued" as const, providerResultId: null, analyticsId: null, failureMode: clean(payload.failureMode, 80), lastErrorCode: null, remediation: null });
        job.publicationId = publication.id; document.publications.push(publication); document.jobs.push(job);
        event(document, envelope, "PublicationRequested", "publication", publication.id, { contentId: content.id, revisionId: revision.id, approvalId: approval.id, jobId: job.id }); audit(document, envelope, "publication", publication.id); activity(document, envelope, "publication", publication.id, `Publication queued for approved revision ${revision.version}.`, content.clientId, content.campaignId);
        result = { entityType: "publication", entityId: publication.id, data: { publication, job } };
        break;
      }
      case "job.retry": {
        const job = required(document, "jobs", payload.jobId, "job_not_found") as unknown as CoreJob;
        if (!job.retryable && job.state === "failed") throw new ProductionCoreError("job_not_retryable", job.remediation || "This failure requires corrective action before a new publication.");
        if (!["failed", "retrying"].includes(job.state)) throw new ProductionCoreError("job_not_retryable_state");
        job.state = "queued"; job.availableAt = now(); job.leaseOwner = null; job.leaseExpiresAt = null; job.updatedAt = now();
        event(document, envelope, "PublicationRetryQueued", "job", job.id, { publicationId: job.publicationId, attempt: job.attempt }); audit(document, envelope, "job", job.id);
        result = { entityType: "job", entityId: job.id, data: { job } };
        break;
      }
      case "organization.suspend": {
        document.organizationStatus = "suspended";
        event(document, envelope, "OrganizationSuspended", "organization", document.tenantId); audit(document, envelope, "organization", document.tenantId); activity(document, envelope, "organization", document.tenantId, "Organization suspended; consequential commands and active jobs are blocked.");
        result = { entityType: "organization", entityId: document.tenantId, data: { status: document.organizationStatus } };
        break;
      }
      case "organization.resume": {
        document.organizationStatus = "active";
        event(document, envelope, "OrganizationResumed", "organization", document.tenantId); audit(document, envelope, "organization", document.tenantId); activity(document, envelope, "organization", document.tenantId, "Organization resumed.");
        result = { entityType: "organization", entityId: document.tenantId, data: { status: document.organizationStatus } };
        break;
      }
      case "phantom.recommend": {
        const publication = required(document, "publications", payload.publicationId, "publication_not_found") as unknown as Publication;
        if (!publication.analyticsId) throw new ProductionCoreError("analytics_required_for_recommendation");
        const analytics = required(document, "analytics", publication.analyticsId, "analytics_not_found") as unknown as Analytics;
        const startedAt = now();
        const phantomAction = entity(document.tenantId, "real", { actorId: envelope.actorId, invocation: clean(payload.invocation, 600) || "Recommend the next measured action.", contextEntityIds: [publication.clientId, publication.campaignId, publication.contentId, publication.id, analytics.id], requestedCommand: "phantom.recommend", commandsExecuted: ["phantom.recommend"], result: "recommendation_created", correlationId: envelope.correlationId, startedAt, completedAt: now() });
        const recommendation = entity(document.tenantId, "real", { clientId: publication.clientId, campaignId: publication.campaignId, publicationId: publication.id, analyticsId: analytics.id, summary: analytics.clicks > 0 ? `Follow up on ${analytics.clicks} measured click${analytics.clicks === 1 ? "" : "s"}.` : "Review the measured result and prepare the next approved variation.", nextCommand: "followup.create" as const, phantomActionId: phantomAction.id });
        document.phantomActions.push(phantomAction); document.recommendations.push(recommendation);
        event(document, envelope, "PhantomRecommendationCreated", "recommendation", recommendation.id, { publicationId: publication.id, analyticsId: analytics.id, phantomActionId: phantomAction.id }); audit(document, envelope, "recommendation", recommendation.id); activity(document, envelope, "recommendation", recommendation.id, recommendation.summary, publication.clientId, publication.campaignId);
        result = { entityType: "recommendation", entityId: recommendation.id, data: { recommendation, phantomAction } };
        break;
      }
      case "followup.create": {
        const recommendation = required(document, "recommendations", payload.recommendationId, "recommendation_not_found") as unknown as Recommendation;
        const followUp = entity(document.tenantId, "real", { clientId: recommendation.clientId, campaignId: recommendation.campaignId, recommendationId: recommendation.id, status: "open" as const, summary: clean(payload.summary, 600) || recommendation.summary });
        document.followUps.push(followUp); event(document, envelope, "FollowUpCreated", "follow_up", followUp.id, { recommendationId: recommendation.id }); audit(document, envelope, "follow_up", followUp.id); activity(document, envelope, "follow_up", followUp.id, followUp.summary, followUp.clientId, followUp.campaignId);
        result = { entityType: "follow_up", entityId: followUp.id, data: { followUp } };
        break;
      }
      case "job.run": throw new ProductionCoreError("job_run_requires_adapter", "Use runProductionJob for leased provider work.", 400);
      default: throw new ProductionCoreError("unsupported_command", "Unsupported production-core command.", 400);
    }
    commandReceipt(document, envelope, result);
    return { repeated: false, result, documentVersion: document.version + 1 };
  }, root);
}

export async function verifyProductionProviderConnection(envelope: ProductionCommandEnvelope, adapter: ProviderAdapter | null, root?: string) {
  if (envelope.action !== "provider.connect") throw new ProductionCoreError("provider_connect_command_required", "Expected provider.connect.", 400);
  const policy = evaluateProductionPolicy(envelope.actorRole, envelope.action);
  if (!policy.allowed) throw new ProductionCoreError(policy.reason, policy.reason, 403);
  if (!adapter) throw new ProductionCoreError("provider_unavailable", "No provider adapter is configured.", 503);
  const health = await adapter.healthCheck();
  return mutate(envelope.tenantId, (document) => {
    if (document.organizationStatus === "suspended") throw new ProductionCoreError("organization_suspended", "This organization is suspended; provider connections cannot change.", 423);
    const existing = document.commands.find((receipt) => receipt.commandId === envelope.commandId || (receipt.action === envelope.action && receipt.idempotencyKey === envelope.idempotencyKey));
    if (existing) return { repeated: true, result: existing.result, documentVersion: document.version };
    const connectionStatus: ProviderConnectionStatus = health.platformStatus === "operational" ? "authorized" : "unavailable";
    const connection = entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { providerId: adapter.id, environment: adapter.environment, platformStatus: health.platformStatus, connectionStatus, verifiedAt: health.checkedAt, detail: health.detail, lastErrorCode: null });
    document.providerConnections.push(connection);
    event(document, envelope, "ProviderConnectionVerified", "provider_connection", connection.id, { providerId: adapter.id, environment: adapter.environment, platformStatus: health.platformStatus, connectionStatus }); audit(document, envelope, "provider_connection", connection.id, { checkedAt: health.checkedAt }); activity(document, envelope, "provider_connection", connection.id, `${adapter.environment} provider verification: ${health.platformStatus}/${connectionStatus}.`);
    const result = { entityType: "provider_connection", entityId: connection.id, data: { connection } };
    commandReceipt(document, envelope, result);
    return { repeated: false, result, documentVersion: document.version + 1 };
  }, root);
}

export async function refreshProductionProviderConnection(envelope: ProductionCommandEnvelope, adapter: ProviderAdapter | null, root?: string) {
  if (envelope.action !== "provider.refresh") throw new ProductionCoreError("provider_refresh_command_required", "Expected provider.refresh.", 400);
  const policy = evaluateProductionPolicy(envelope.actorRole, envelope.action);
  if (!policy.allowed) throw new ProductionCoreError(policy.reason, policy.reason, 403);
  if (!adapter) throw new ProductionCoreError("provider_unavailable", "No provider adapter is configured.", 503);
  const connectionId = clean(envelope.payload.providerConnectionId, 120);
  const before = await readProductionCore(envelope.tenantId, root);
  if (before.organizationStatus === "suspended") throw new ProductionCoreError("organization_suspended", "This organization is suspended; provider connections cannot change.", 423);
  required(before, "providerConnections", connectionId, "provider_connection_not_found");
  try {
    const refreshed = await adapter.refreshAuthorization(envelope.correlationId, clean(envelope.payload.failureMode, 80));
    return mutate(envelope.tenantId, (document) => {
      const existing = document.commands.find((receipt) => receipt.commandId === envelope.commandId || (receipt.action === envelope.action && receipt.idempotencyKey === envelope.idempotencyKey));
      if (existing) return { repeated: true, failed: false, result: existing.result, documentVersion: document.version };
      const connection = required(document, "providerConnections", connectionId, "provider_connection_not_found") as unknown as ProviderConnection;
      connection.connectionStatus = refreshed.connectionStatus; connection.platformStatus = "operational"; connection.verifiedAt = refreshed.checkedAt; connection.detail = refreshed.detail; connection.lastErrorCode = null; connection.updatedAt = now();
      event(document, envelope, "ProviderAuthorizationRefreshed", "provider_connection", connection.id, { providerId: adapter.id }); audit(document, envelope, "provider_connection", connection.id); activity(document, envelope, "provider_connection", connection.id, "Provider authorization refreshed.");
      const result = { entityType: "provider_connection", entityId: connection.id, data: { connection } };
      commandReceipt(document, envelope, result);
      return { repeated: false, failed: false, result, documentVersion: document.version + 1 };
    }, root);
  } catch (error) {
    const providerError = error instanceof ProviderAdapterError ? error : new ProviderAdapterError("UNKNOWN", (error as Error)?.message || "Authorization refresh failed.", false, "Reconnect the provider connection.");
    return mutate(envelope.tenantId, (document) => {
      const existing = document.commands.find((receipt) => receipt.commandId === envelope.commandId || (receipt.action === envelope.action && receipt.idempotencyKey === envelope.idempotencyKey));
      if (existing) return { repeated: true, failed: true, result: existing.result, documentVersion: document.version };
      const connection = required(document, "providerConnections", connectionId, "provider_connection_not_found") as unknown as ProviderConnection;
      connection.connectionStatus = providerError.code === "AUTH_EXPIRED" ? "expired" : providerError.code === "PERMISSION_DENIED" ? "permission_missing" : "failed";
      connection.lastErrorCode = providerError.code; connection.detail = providerError.message; connection.verifiedAt = now(); connection.updatedAt = now();
      const incident = entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { correlationId: envelope.correlationId, kind: "provider_authorization", status: "open" as const, summary: `Provider authorization refresh failed: ${providerError.code}.`, entityType: "provider_connection", entityId: connection.id, remediation: providerError.remediation, resolvedAt: null });
      document.incidents.push(incident); event(document, envelope, "ProviderAuthorizationRefreshFailed", "provider_connection", connection.id, { errorCode: providerError.code, incidentId: incident.id }); audit(document, envelope, "provider_connection", connection.id, { errorCode: providerError.code }); activity(document, envelope, "provider_connection", connection.id, `${incident.summary} ${providerError.remediation}`);
      const result = { entityType: "provider_connection", entityId: connection.id, data: { connection, incident, error: { code: providerError.code, retryable: providerError.retryable, remediation: providerError.remediation } } };
      commandReceipt(document, envelope, result);
      return { repeated: false, failed: true, result, documentVersion: document.version + 1 };
    }, root);
  }
}

export async function runProductionJob(envelope: ProductionCommandEnvelope, adapter: ProviderAdapter | null, root?: string) {
  if (envelope.action !== "job.run") throw new ProductionCoreError("job_run_command_required", "Expected job.run.", 400);
  const policy = evaluateProductionPolicy(envelope.actorRole, envelope.action);
  if (!policy.allowed) throw new ProductionCoreError(policy.reason, policy.reason, 403);
  if (!adapter) throw new ProductionCoreError("provider_unavailable", "No provider adapter is configured.", 503);
  const jobId = clean(envelope.payload.jobId, 120);
  const workerId = clean(envelope.payload.workerId, 120) || `worker-${process.pid}`;
  const leaseMs = Math.max(250, Number(process.env.PHANTOMFORCE_PRODUCTION_CORE_LEASE_MS || 30_000));
  const lease = await mutate(envelope.tenantId, (document) => {
    const prior = document.commands.find((receipt) => receipt.commandId === envelope.commandId);
    if (prior) return { repeated: true as const, result: prior.result };
    const job = required(document, "jobs", jobId, "job_not_found") as unknown as CoreJob;
    if (job.state === "succeeded") return { repeated: true as const, result: { entityType: "job", entityId: job.id, data: { job } } };
    const leaseActive = job.state === "running" && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now();
    if (leaseActive) throw new ProductionCoreError("job_lease_active", "Another worker owns the active lease.", 409, { leaseOwner: job.leaseOwner, leaseExpiresAt: job.leaseExpiresAt });
    if (job.state === "failed" && !job.retryable) throw new ProductionCoreError("job_not_retryable", job.remediation || "Correct the permanent failure before creating a new publication.");
    const publication = required(document, "publications", job.publicationId, "publication_not_found") as unknown as Publication;
    const client = required(document, "clients", publication.clientId, "client_not_found") as unknown as Client;
    const campaign = required(document, "campaigns", publication.campaignId, "campaign_not_found") as unknown as Campaign;
    const connection = required(document, "providerConnections", publication.providerConnectionId, "provider_connection_not_found") as unknown as ProviderConnection;
    const block = document.organizationStatus === "suspended"
      ? { code: "ORGANIZATION_SUSPENDED", remediation: "Resume the organization, verify its provider connection, then retry the same job." }
      : client.status !== "active" || campaign.status !== "active"
        ? { code: "CLIENT_ARCHIVED", remediation: "Restore the client and campaign before creating a new approved publication." }
        : !["authorized", "rate_limited", "reconnecting"].includes(connection.connectionStatus) || connection.platformStatus !== "operational"
          ? { code: "PROVIDER_CONNECTION_NOT_READY", remediation: "Reconnect and verify the organization provider connection before retrying." }
          : null;
    if (block) {
      job.state = "failed"; job.completedAt = now(); job.leaseOwner = null; job.leaseExpiresAt = null; job.lastErrorCode = block.code; job.lastError = block.code; job.retryable = false; job.remediation = block.remediation; job.updatedAt = now();
      publication.status = "failed"; publication.lastErrorCode = block.code; publication.remediation = block.remediation; publication.updatedAt = now();
      const incident = entity(document.tenantId, publication.truth, { correlationId: envelope.correlationId, kind: "publication_blocked", status: "open" as const, summary: `Publication blocked: ${block.code}.`, entityType: "publication", entityId: publication.id, remediation: block.remediation, resolvedAt: null });
      document.incidents.push(incident); event(document, envelope, "PublicationFailed", "publication", publication.id, { jobId: job.id, errorCode: block.code, retryable: false, incidentId: incident.id }); audit(document, envelope, "job", job.id, { errorCode: block.code }); activity(document, envelope, "publication", publication.id, `${incident.summary} ${block.remediation}`, publication.clientId, publication.campaignId);
      const result = { entityType: "job", entityId: job.id, data: { job, publication, incident, error: { code: block.code, retryable: false, remediation: block.remediation } } };
      commandReceipt(document, envelope, result);
      return { repeated: false as const, blocked: true as const, result };
    }
    job.state = "running"; job.attempt += 1; job.startedAt = now(); job.leaseOwner = workerId; job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString(); job.updatedAt = now();
    publication.status = "publishing"; publication.updatedAt = now();
    event(document, envelope, "PublicationDispatched", "publication", publication.id, { jobId: job.id, attempt: job.attempt, leaseOwner: workerId }); audit(document, envelope, "job", job.id, { leaseOwner: workerId, leaseExpiresAt: job.leaseExpiresAt });
    return { repeated: false as const, blocked: false as const, job: { ...job }, publication: { ...publication } };
  }, root);
  if (lease.repeated) return { repeated: true, result: lease.result };
  if (lease.blocked) return { repeated: false, result: lease.result };

  const snapshot = await readProductionCore(envelope.tenantId, root);
  const publication = snapshot.publications.find((item) => item.id === lease.publication.id)!;
  const revision = snapshot.revisions.find((item) => item.id === publication.revisionId)!;
  const media = revision.mediaAssetIds.map((id) => snapshot.mediaAssets.find((item) => item.id === id)).filter(Boolean) as MediaAsset[];
  let acceptedResult = publication.providerResultId ? snapshot.providerResults.find((item) => item.id === publication.providerResultId) || null : null;
  let failureStage: "publish" | "analytics" = acceptedResult ? "analytics" : "publish";
  try {
    if (!acceptedResult) {
      const providerResult = await adapter.publish({ idempotencyKey: lease.job.idempotencyKey, correlationId: lease.job.correlationId, publicationId: publication.id, revisionHash: revision.hash, content: revision.body, media: media.map((item) => ({ id: item.id, name: item.name, checksum: item.checksum })), failureMode: publication.failureMode || undefined });
      acceptedResult = await mutate(envelope.tenantId, (document) => {
        const job = required(document, "jobs", lease.job.id, "job_not_found") as unknown as CoreJob;
        if (job.leaseOwner !== workerId) throw new ProductionCoreError("job_lease_lost");
        const currentPublication = required(document, "publications", publication.id, "publication_not_found") as unknown as Publication;
        if (currentPublication.providerResultId) return required(document, "providerResults", currentPublication.providerResultId, "provider_result_not_found") as unknown as ProviderResult;
        const resultRecord = entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { publicationId: currentPublication.id, providerPublicationId: providerResult.providerPublicationId, publicUrl: providerResult.publicUrl, rawStatus: providerResult.rawStatus, responsePersistedAt: now() });
        document.providerResults.push(resultRecord); currentPublication.providerResultId = resultRecord.id; currentPublication.status = "accepted"; currentPublication.updatedAt = now();
        event(document, envelope, "ProviderAcceptedPublication", "provider_result", resultRecord.id, { publicationId: currentPublication.id, providerPublicationId: resultRecord.providerPublicationId });
        document.auditEvents.push(entity(document.tenantId, resultRecord.truth, { action: "provider.publish" as const, entityType: "provider_result", entityId: resultRecord.id, correlationId: envelope.correlationId, actorId: workerId, role: "system" as const, policy: "production-core-v1", decision: "allowed" as const, payload: { jobId: job.id, providerId: adapter.id } }));
        activity(document, envelope, "publication", currentPublication.id, `Provider accepted publication ${resultRecord.providerPublicationId}; response persisted before analytics.`, currentPublication.clientId, currentPublication.campaignId);
        return resultRecord;
      }, root);
    }
    failureStage = "analytics";
    const providerAnalytics = await adapter.fetchAnalytics(acceptedResult.providerPublicationId, lease.job.correlationId);
    return mutate(envelope.tenantId, (document) => {
      const job = required(document, "jobs", lease.job.id, "job_not_found") as unknown as CoreJob;
      if (job.leaseOwner !== workerId) throw new ProductionCoreError("job_lease_lost");
      const currentPublication = required(document, "publications", publication.id, "publication_not_found") as unknown as Publication;
      const resultRecord = required(document, "providerResults", currentPublication.providerResultId, "provider_result_not_found") as unknown as ProviderResult;
      const connection = required(document, "providerConnections", currentPublication.providerConnectionId, "provider_connection_not_found") as unknown as ProviderConnection;
      const analytics = entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { clientId: currentPublication.clientId, campaignId: currentPublication.campaignId, contentId: currentPublication.contentId, publicationId: currentPublication.id, providerResultId: resultRecord.id, providerPublicationId: resultRecord.providerPublicationId, capturedAt: providerAnalytics.capturedAt, impressions: providerAnalytics.impressions, engagements: providerAnalytics.engagements, clicks: providerAnalytics.clicks });
      document.analytics.push(analytics);
      currentPublication.status = "published"; currentPublication.providerResultId = resultRecord.id; currentPublication.analyticsId = analytics.id; currentPublication.lastErrorCode = null; currentPublication.remediation = null; currentPublication.updatedAt = now();
      job.state = "succeeded"; job.completedAt = now(); job.leaseOwner = null; job.leaseExpiresAt = null; job.lastError = null; job.lastErrorCode = null; job.retryable = false; job.remediation = null; job.updatedAt = now();
      connection.connectionStatus = "authorized"; connection.platformStatus = "operational"; connection.lastErrorCode = null; connection.detail = "Latest provider operation succeeded."; connection.updatedAt = now();
      event(document, envelope, "PublicationSucceeded", "publication", currentPublication.id, { jobId: job.id, providerResultId: resultRecord.id });
      event(document, envelope, "AnalyticsImported", "analytics", analytics.id, { publicationId: currentPublication.id, providerPublicationId: resultRecord.providerPublicationId });
      document.auditEvents.push(entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { action: "provider.analytics" as const, entityType: "analytics", entityId: analytics.id, correlationId: envelope.correlationId, actorId: workerId, role: "system" as const, policy: "production-core-v1", decision: "allowed" as const, payload: { publicationId: currentPublication.id, providerId: adapter.id } }));
      activity(document, envelope, "publication", currentPublication.id, `Analytics attributed to provider publication ${resultRecord.providerPublicationId}.`, currentPublication.clientId, currentPublication.campaignId);
      const result = { entityType: "job", entityId: job.id, data: { job, publication: currentPublication, providerResult: resultRecord, analytics } };
      commandReceipt(document, envelope, result);
      return { repeated: false, result, documentVersion: document.version + 1 };
    }, root);
  } catch (error) {
    const providerError = error instanceof ProviderAdapterError ? error : new ProviderAdapterError("UNKNOWN", (error as Error)?.message || "Provider call failed.", false, "Inspect the provider response and create a corrected publication.");
    return mutate(envelope.tenantId, (document) => {
      const job = required(document, "jobs", lease.job.id, "job_not_found") as unknown as CoreJob;
      const currentPublication = required(document, "publications", publication.id, "publication_not_found") as unknown as Publication;
      const retrying = providerError.retryable && job.attempt < job.maxAttempts;
      job.state = retrying ? "retrying" : "failed"; job.availableAt = retrying ? new Date(Date.now() + 1_000).toISOString() : job.availableAt; job.completedAt = retrying ? null : now(); job.leaseOwner = null; job.leaseExpiresAt = null; job.lastErrorCode = providerError.code; job.lastError = providerError.message; job.retryable = providerError.retryable; job.remediation = providerError.remediation; job.updatedAt = now();
      currentPublication.status = currentPublication.providerResultId && retrying ? "accepted" : retrying ? "queued" : "failed"; currentPublication.lastErrorCode = providerError.code; currentPublication.remediation = providerError.remediation; currentPublication.updatedAt = now();
      const connection = required(document, "providerConnections", currentPublication.providerConnectionId, "provider_connection_not_found") as unknown as ProviderConnection;
      if (providerError.code === "AUTH_EXPIRED") connection.connectionStatus = "expired";
      if (providerError.code === "PERMISSION_DENIED") connection.connectionStatus = "permission_missing";
      if (providerError.code === "RATE_LIMITED") connection.connectionStatus = "rate_limited";
      connection.lastErrorCode = providerError.code; connection.detail = providerError.message; connection.updatedAt = now();
      const eventType = failureStage === "analytics" ? "AnalyticsImportFailed" : "PublicationFailed";
      event(document, envelope, eventType, "publication", currentPublication.id, { jobId: job.id, errorCode: providerError.code, retryable: providerError.retryable, remediation: providerError.remediation, providerResultId: currentPublication.providerResultId });
      let incident: Incident | null = null;
      if (!retrying) {
        incident = entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { correlationId: envelope.correlationId, kind: failureStage === "analytics" ? "analytics_import" : "provider_publish", status: "open" as const, summary: `${failureStage === "analytics" ? "Analytics import" : "Publication"} failed: ${providerError.code}.`, entityType: "publication", entityId: currentPublication.id, remediation: providerError.remediation, resolvedAt: null });
        document.incidents.push(incident);
      }
      document.auditEvents.push(entity(document.tenantId, adapter.environment === "sandbox" ? "sandbox" : "real", { action: failureStage === "analytics" ? "provider.analytics" as const : "provider.publish" as const, entityType: "publication", entityId: currentPublication.id, correlationId: envelope.correlationId, actorId: workerId, role: "system" as const, policy: "production-core-v1", decision: "allowed" as const, payload: { jobId: job.id, providerId: adapter.id, errorCode: providerError.code, retryable: providerError.retryable, failureStage, incidentId: incident?.id || null } }));
      activity(document, envelope, "publication", currentPublication.id, `${failureStage === "analytics" ? "Analytics import" : "Publication"} failed: ${providerError.code}. ${providerError.remediation}`, currentPublication.clientId, currentPublication.campaignId);
      const result = { entityType: "job", entityId: job.id, data: { job, publication: currentPublication, ...(currentPublication.providerResultId ? { providerResult: required(document, "providerResults", currentPublication.providerResultId, "provider_result_not_found") } : {}), ...(incident ? { incident } : {}), error: { code: providerError.code, message: providerError.message, retryable: providerError.retryable, remediation: providerError.remediation, stage: failureStage } } };
      commandReceipt(document, envelope, result);
      return { repeated: false, result, documentVersion: document.version + 1 };
    }, root);
  }
}

export type ProductionProviderWebhookInput = {
  tenantId: string;
  providerId: string;
  webhookId: string;
  providerPublicationId: string;
  sequence: number;
  eventType: "publication.succeeded" | "publication.failed";
  correlationId: string;
  payload?: Record<string, unknown>;
};

export async function ingestProductionProviderWebhook(input: ProductionProviderWebhookInput, root?: string) {
  if (!clean(input.webhookId, 180) || !clean(input.providerPublicationId, 180) || !Number.isInteger(input.sequence) || input.sequence < 0) {
    throw new ProductionCoreError("invalid_provider_webhook", "Webhook ID, provider publication ID, and non-negative sequence are required.", 400);
  }
  return mutate(input.tenantId, (document) => {
    const duplicate = document.providerWebhooks.find((item) => item.providerId === input.providerId && item.webhookId === input.webhookId);
    if (duplicate) return { repeated: true, webhook: duplicate, documentVersion: document.version };
    const result = document.providerResults.find((item) => item.providerPublicationId === input.providerPublicationId);
    if (!result) throw new ProductionCoreError("provider_publication_not_found", "The webhook does not match a persisted provider publication.", 404);
    const publication = required(document, "publications", result.publicationId, "publication_not_found") as unknown as Publication;
    const previousSequence = document.providerWebhooks
      .filter((item) => item.providerId === input.providerId && item.providerPublicationId === input.providerPublicationId && item.applied)
      .reduce((highest, item) => Math.max(highest, item.sequence), -1);
    const applied = input.sequence > previousSequence;
    const ignoredReason = applied ? null : "out_of_order";
    const webhook = entity(document.tenantId, result.truth, { providerId: clean(input.providerId, 120), webhookId: clean(input.webhookId, 180), providerPublicationId: result.providerPublicationId, sequence: input.sequence, eventType: input.eventType, correlationId: clean(input.correlationId, 180), payloadHash: hash(input.payload || {}), applied, ignoredReason });
    document.providerWebhooks.push(webhook);
    if (applied) {
      if (input.eventType === "publication.failed") {
        publication.status = "failed"; publication.lastErrorCode = "PROCESSING_FAILED"; publication.remediation = "Inspect the provider processing result, correct the content, approve a new revision, and publish again."; publication.updatedAt = now();
        const job = document.jobs.find((item) => item.id === publication.jobId);
        if (job) { job.state = "failed"; job.lastErrorCode = "PROCESSING_FAILED"; job.lastError = "Provider reported asynchronous processing failure."; job.retryable = false; job.remediation = publication.remediation; job.completedAt = now(); job.updatedAt = now(); }
        const incident = entity(document.tenantId, result.truth, { correlationId: webhook.correlationId, kind: "provider_processing", status: "open" as const, summary: "Provider reported asynchronous publication failure.", entityType: "publication", entityId: publication.id, remediation: publication.remediation, resolvedAt: null });
        document.incidents.push(incident);
      } else if (publication.analyticsId) {
        publication.status = "published"; publication.lastErrorCode = null; publication.remediation = null; publication.updatedAt = now();
      }
    }
    document.events.push(entity(document.tenantId, result.truth, { eventType: applied ? "ProviderWebhookApplied" : "ProviderWebhookIgnored", entityType: "provider_webhook", entityId: webhook.id, correlationId: webhook.correlationId, actorId: input.providerId, payload: { publicationId: publication.id, providerPublicationId: result.providerPublicationId, sequence: input.sequence, providerEventType: input.eventType, ignoredReason } }));
    document.auditEvents.push(entity(document.tenantId, result.truth, { action: "provider.webhook" as const, entityType: "provider_webhook", entityId: webhook.id, correlationId: webhook.correlationId, actorId: input.providerId, role: "system" as const, policy: "production-core-webhook-v1", decision: "allowed" as const, payload: { publicationId: publication.id, sequence: input.sequence, applied, ignoredReason } }));
    document.activities.push(entity(document.tenantId, result.truth, { entityType: "provider_webhook", entityId: webhook.id, correlationId: webhook.correlationId, summary: applied ? `Provider webhook applied: ${input.eventType}.` : "Out-of-order provider webhook recorded and ignored.", clientId: publication.clientId, campaignId: publication.campaignId }));
    return { repeated: false, webhook, publication, documentVersion: document.version + 1 };
  }, root);
}

export async function productionCoreDiagnosis(tenantId: string, correlationId: string, root?: string) {
  const document = await readProductionCore(tenantId, root);
  const correlation = clean(correlationId, 180);
  const timeline = [
    ...document.events.filter((item) => item.correlationId === correlation).map((item) => ({ at: item.createdAt, kind: "event", type: item.eventType, entityType: item.entityType, entityId: item.entityId, detail: item.payload })),
    ...document.auditEvents.filter((item) => item.correlationId === correlation).map((item) => ({ at: item.createdAt, kind: "audit", type: item.action, entityType: item.entityType, entityId: item.entityId, detail: item.payload })),
    ...document.activities.filter((item) => item.correlationId === correlation).map((item) => ({ at: item.createdAt, kind: "activity", type: "Activity", entityType: item.entityType, entityId: item.entityId, detail: { summary: item.summary } })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const publications = document.publications.filter((item) => document.jobs.some((job) => job.publicationId === item.id && job.correlationId === correlation));
  const jobs = document.jobs.filter((item) => item.correlationId === correlation);
  return {
    tenantId: document.tenantId,
    correlationId: correlation,
    timeline,
    publications,
    jobs,
    providerResults: document.providerResults.filter((item) => publications.some((publication) => publication.providerResultId === item.id)),
    analytics: document.analytics.filter((item) => publications.some((publication) => publication.analyticsId === item.id)),
    webhooks: document.providerWebhooks.filter((item) => item.correlationId === correlation),
    incidents: document.incidents.filter((item) => item.correlationId === correlation),
    actionableFailures: jobs.filter((job) => ["failed", "retrying"].includes(job.state)).map((job) => ({ jobId: job.id, publicationId: job.publicationId, errorCode: job.lastErrorCode, retryable: job.retryable, remediation: job.remediation })),
  };
}

export function publicProductionCore(document: ProductionCoreDocument) {
  return {
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    organizationStatus: document.organizationStatus,
    version: document.version,
    updatedAt: document.updatedAt,
    counts: {
      leads: document.leads.length, clients: document.clients.length, campaigns: document.campaigns.length, contents: document.contents.length, revisions: document.revisions.length, mediaAssets: document.mediaAssets.length, approvals: document.approvals.length, publications: document.publications.length, analytics: document.analytics.length, jobs: document.jobs.length, phantomActions: document.phantomActions.length, incidents: document.incidents.length,
    },
    providerConnections: document.providerConnections,
    recentPublications: document.publications.slice(-20).reverse(),
    recentJobs: document.jobs.slice(-20).reverse(),
    recentActivity: document.activities.slice(-40).reverse(),
    recentIncidents: document.incidents.slice(-20).reverse(),
    recentProviderWebhooks: document.providerWebhooks.slice(-20).reverse(),
    graph: { leads: document.leads, conversions: document.conversions, clients: document.clients, campaigns: document.campaigns, contents: document.contents, revisions: document.revisions, mediaAssets: document.mediaAssets, approvals: document.approvals, publications: document.publications, providerResults: document.providerResults, analytics: document.analytics, providerWebhooks: document.providerWebhooks, incidents: document.incidents, recommendations: document.recommendations, followUps: document.followUps },
  };
}
