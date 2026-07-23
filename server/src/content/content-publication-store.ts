import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PublicationStatus =
  | "draft"
  | "scheduled"
  | "approval_required"
  | "publishing"
  | "published"
  | "partial"
  | "failed"
  | "cancelled"
  | "manual_record";

export type PublicationChannelResult = {
  channel: string;
  status: "pending" | "published" | "failed";
  providerReceiptId: string | null;
  publicUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

export type ContentPublication = {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  status: PublicationStatus;
  channels: string[];
  channelResults: PublicationChannelResult[];
  caption: string;
  sourceAssetId: string | null;
  thumbnailAssetId: string | null;
  postType: string;
  timezone: string;
  scheduledFor: string | null;
  approvalId: string | null;
  externalSent: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

type PublicationDocument = { schemaVersion: 1; tenantId: string; publications: ContentPublication[] };
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/content-publications");
const locks = new Map<string, Promise<unknown>>();

function clean(value: unknown, max = 300) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}
function safeTenant(value: string) {
  return clean(value, 80).replace(/[^a-zA-Z0-9_.:-]+/gu, "-").replace(/^-+|-+$/gu, "") || "unknown";
}
function pathFor(tenantId: string, root?: string) {
  return resolve(root || process.env.PHANTOMFORCE_CONTENT_PUBLICATION_DIR || defaultRoot, `${safeTenant(tenantId)}.json`);
}
function validTimezone(value: unknown) {
  const candidate = clean(value, 100) || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}
function dateOrNull(value: unknown) {
  const text = clean(value, 80);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function normalizeChannelResult(value: Partial<PublicationChannelResult>, now: string): PublicationChannelResult {
  const status = ["pending", "published", "failed"].includes(String(value.status))
    ? value.status as PublicationChannelResult["status"]
    : "pending";
  return {
    channel: clean(value.channel, 80),
    status,
    providerReceiptId: clean(value.providerReceiptId, 200) || null,
    publicUrl: clean(value.publicUrl, 1_000) || null,
    errorCode: clean(value.errorCode, 100) || null,
    errorMessage: clean(value.errorMessage, 400) || null,
    updatedAt: dateOrNull(value.updatedAt) || now,
  };
}
function normalize(raw: Partial<ContentPublication>, tenantId: string): ContentPublication {
  const now = new Date().toISOString();
  const status = ["draft", "scheduled", "approval_required", "publishing", "published", "partial", "failed", "cancelled", "manual_record"].includes(String(raw.status))
    ? raw.status as PublicationStatus
    : "draft";
  const channels = [...new Set((Array.isArray(raw.channels) ? raw.channels : []).map((item) => clean(item, 80)).filter(Boolean))].slice(0, 12);
  return {
    id: clean(raw.id, 100) || randomUUID(),
    tenantId: safeTenant(tenantId),
    idempotencyKey: clean(raw.idempotencyKey, 180) || randomUUID(),
    status,
    channels,
    channelResults: Array.isArray(raw.channelResults)
      ? raw.channelResults.map((result) => normalizeChannelResult(result, now)).filter((result) => channels.includes(result.channel))
      : channels.map((channel) => normalizeChannelResult({ channel }, now)),
    caption: clean(raw.caption, 8_000),
    sourceAssetId: clean(raw.sourceAssetId, 140) || null,
    thumbnailAssetId: clean(raw.thumbnailAssetId, 140) || null,
    postType: clean(raw.postType, 80) || "auto",
    timezone: validTimezone(raw.timezone),
    scheduledFor: dateOrNull(raw.scheduledFor),
    approvalId: clean(raw.approvalId, 140) || null,
    externalSent: Boolean(raw.externalSent),
    createdAt: dateOrNull(raw.createdAt) || now,
    updatedAt: dateOrNull(raw.updatedAt) || now,
    createdBy: clean(raw.createdBy, 140) || "system",
  };
}
async function readDocument(tenantId: string, root?: string): Promise<PublicationDocument> {
  const tenant = safeTenant(tenantId);
  try {
    const parsed = JSON.parse(await readFile(pathFor(tenant, root), "utf8")) as Partial<PublicationDocument>;
    return {
      schemaVersion: 1,
      tenantId: tenant,
      publications: Array.isArray(parsed.publications)
        ? parsed.publications.map((record) => normalize(record, tenant)).slice(0, 2_000)
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, tenantId: tenant, publications: [] };
    throw error;
  }
}
async function mutate<T>(tenantId: string, operation: (document: PublicationDocument) => T, root?: string) {
  const key = pathFor(tenantId, root).toLowerCase();
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const document = await readDocument(tenantId, root);
    const result = operation(document);
    document.publications = document.publications.slice(0, 2_000);
    const target = pathFor(document.tenantId, root);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return result;
  });
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

export async function listContentPublications(tenantId: string, root?: string) {
  return (await readDocument(tenantId, root)).publications.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function createContentPublication(options: {
  tenantId: string;
  actor: string;
  idempotencyKey: string;
  input: Partial<ContentPublication>;
  root?: string;
}) {
  return mutate(options.tenantId, (document) => {
    const key = clean(options.idempotencyKey, 180);
    if (!key) throw new Error("idempotency_key_required");
    const existing = document.publications.find((record) => record.idempotencyKey === key);
    if (existing) return { publication: existing, created: false };
    const now = new Date().toISOString();
    const publication = normalize({
      ...options.input,
      id: randomUUID(),
      tenantId: document.tenantId,
      idempotencyKey: key,
      externalSent: false,
      createdAt: now,
      updatedAt: now,
      createdBy: options.actor,
    }, document.tenantId);
    if (!publication.channels.length) throw new Error("publication_channel_required");
    if (publication.status === "scheduled" && !publication.scheduledFor) throw new Error("valid_schedule_required");
    if (["publishing", "published", "partial"].includes(publication.status)) throw new Error("provider_transition_required");
    document.publications.unshift(publication);
    return { publication, created: true };
  }, options.root);
}

export async function approveContentPublication(options: {
  tenantId: string;
  publicationId: string;
  approvalId: string;
  actor: string;
  root?: string;
}) {
  return mutate(options.tenantId, (document) => {
    const publication = document.publications.find((record) => record.id === options.publicationId);
    if (!publication) throw new Error("publication_not_found");
    if (["published", "partial", "cancelled"].includes(publication.status)) throw new Error("publication_terminal");
    const approvalId = clean(options.approvalId, 140);
    if (!approvalId) throw new Error("approval_id_required");
    publication.approvalId = approvalId;
    publication.status = "publishing";
    publication.updatedAt = new Date().toISOString();
    return publication;
  }, options.root);
}

export async function recordPublicationChannelResult(options: {
  tenantId: string;
  publicationId: string;
  actor: string;
  channel: string;
  status: "published" | "failed";
  providerReceiptId?: string;
  publicUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  root?: string;
}) {
  return mutate(options.tenantId, (document) => {
    const publication = document.publications.find((record) => record.id === options.publicationId);
    if (!publication) throw new Error("publication_not_found");
    if (publication.status !== "publishing") throw new Error("publication_not_in_progress");
    if (!publication.approvalId) throw new Error("approval_required");
    const channel = clean(options.channel, 80);
    if (!publication.channels.includes(channel)) throw new Error("channel_not_selected");
    const receipt = clean(options.providerReceiptId, 200);
    if (options.status === "published" && !receipt) throw new Error("provider_receipt_required");
    const now = new Date().toISOString();
    const result = publication.channelResults.find((row) => row.channel === channel);
    if (!result) throw new Error("channel_not_selected");
    result.status = options.status;
    result.providerReceiptId = receipt || null;
    result.publicUrl = clean(options.publicUrl, 1_000) || null;
    result.errorCode = options.status === "failed" ? clean(options.errorCode, 100) || "provider_failed" : null;
    result.errorMessage = options.status === "failed" ? clean(options.errorMessage, 400) || "Channel publish failed." : null;
    result.updatedAt = now;
    const complete = publication.channelResults.every((row) => row.status !== "pending");
    const publishedCount = publication.channelResults.filter((row) => row.status === "published").length;
    if (complete) {
      publication.status = publishedCount === publication.channelResults.length ? "published" : publishedCount ? "partial" : "failed";
      publication.externalSent = publishedCount > 0;
    }
    publication.updatedAt = now;
    return publication;
  }, options.root);
}

export async function cancelContentPublication(tenantId: string, publicationId: string, root?: string) {
  return mutate(tenantId, (document) => {
    const publication = document.publications.find((record) => record.id === publicationId);
    if (!publication) throw new Error("publication_not_found");
    if (publication.externalSent || ["published", "partial"].includes(publication.status)) throw new Error("published_content_cannot_be_cancelled");
    publication.status = "cancelled";
    publication.updatedAt = new Date().toISOString();
    return publication;
  }, root);
}
