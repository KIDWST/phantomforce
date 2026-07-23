import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type MediaGenerationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type MediaGenerationJob = {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  status: MediaGenerationStatus;
  modality: "image" | "video";
  prompt: string;
  provider: string;
  model: string;
  parameters: Record<string, unknown>;
  referenceAssetIds: string[];
  outputAssetIds: string[];
  retryOf: string | null;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  createdBy: string;
};

type MediaGenerationDocument = {
  schemaVersion: 1;
  tenantId: string;
  jobs: MediaGenerationJob[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/media-generation");
const locks = new Map<string, Promise<unknown>>();

function clean(value: unknown, max = 300) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

function safeTenant(value: string) {
  return clean(value, 80).replace(/[^a-zA-Z0-9_.:-]+/gu, "-").replace(/^-+|-+$/gu, "") || "unknown";
}

function documentPath(tenantId: string, root?: string) {
  return resolve(root || process.env.PHANTOMFORCE_MEDIA_GENERATION_DIR || defaultRoot, `${safeTenant(tenantId)}.json`);
}

function normalizeJob(raw: Partial<MediaGenerationJob>, tenantId: string): MediaGenerationJob {
  const now = new Date().toISOString();
  const status: MediaGenerationStatus = ["queued", "running", "completed", "failed", "cancelled"].includes(String(raw.status))
    ? raw.status as MediaGenerationStatus
    : "queued";
  return {
    id: clean(raw.id, 100) || randomUUID(),
    tenantId: safeTenant(tenantId),
    idempotencyKey: clean(raw.idempotencyKey, 180) || randomUUID(),
    status,
    modality: raw.modality === "video" ? "video" : "image",
    prompt: clean(raw.prompt, 2_000) || "Untitled media request",
    provider: clean(raw.provider, 100) || "unassigned",
    model: clean(raw.model, 160),
    parameters: raw.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters) ? raw.parameters : {},
    referenceAssetIds: Array.isArray(raw.referenceAssetIds) ? raw.referenceAssetIds.map((item) => clean(item, 120)).filter(Boolean).slice(0, 12) : [],
    outputAssetIds: Array.isArray(raw.outputAssetIds) ? raw.outputAssetIds.map((item) => clean(item, 120)).filter(Boolean).slice(0, 24) : [],
    retryOf: clean(raw.retryOf, 100) || null,
    attempt: Math.max(1, Math.min(20, Number(raw.attempt) || 1)),
    errorCode: clean(raw.errorCode, 100) || null,
    errorMessage: clean(raw.errorMessage, 500) || null,
    createdAt: clean(raw.createdAt, 80) || now,
    startedAt: clean(raw.startedAt, 80) || null,
    finishedAt: clean(raw.finishedAt, 80) || null,
    updatedAt: clean(raw.updatedAt, 80) || now,
    createdBy: clean(raw.createdBy, 140) || "system",
  };
}

async function readDocument(tenantId: string, root?: string): Promise<MediaGenerationDocument> {
  const authoritativeTenant = safeTenant(tenantId);
  try {
    const parsed = JSON.parse(await readFile(documentPath(authoritativeTenant, root), "utf8")) as Partial<MediaGenerationDocument>;
    return {
      schemaVersion: 1,
      tenantId: authoritativeTenant,
      jobs: Array.isArray(parsed.jobs)
        ? parsed.jobs.map((job) => normalizeJob(job, authoritativeTenant)).slice(0, 2_000)
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, tenantId: authoritativeTenant, jobs: [] };
    }
    throw error;
  }
}

async function writeDocument(document: MediaGenerationDocument, root?: string) {
  const target = documentPath(document.tenantId, root);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function mutate<T>(tenantId: string, operation: (document: MediaGenerationDocument) => T, root?: string) {
  const key = documentPath(tenantId, root).toLowerCase();
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const document = await readDocument(tenantId, root);
    const result = operation(document);
    document.jobs = document.jobs.slice(0, 2_000);
    await writeDocument(document, root);
    return result;
  });
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

export async function listMediaGenerationJobs(tenantId: string, options: { activeOnly?: boolean; root?: string } = {}) {
  const document = await readDocument(tenantId, options.root);
  const jobs = options.activeOnly
    ? document.jobs.filter((job) => job.status === "queued" || job.status === "running")
    : document.jobs;
  return jobs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function createMediaGenerationJob(options: {
  tenantId: string;
  actor: string;
  idempotencyKey: string;
  input: Partial<MediaGenerationJob>;
  root?: string;
}) {
  return mutate(options.tenantId, (document) => {
    const idempotencyKey = clean(options.idempotencyKey, 180);
    if (!idempotencyKey) throw new Error("idempotency_key_required");
    const existing = document.jobs.find((job) => job.idempotencyKey === idempotencyKey);
    if (existing) return { job: existing, created: false };
    const now = new Date().toISOString();
    const job = normalizeJob({
      ...options.input,
      id: randomUUID(),
      tenantId: document.tenantId,
      idempotencyKey,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      createdBy: options.actor,
    }, document.tenantId);
    document.jobs.unshift(job);
    return { job, created: true };
  }, options.root);
}

export async function transitionMediaGenerationJob(options: {
  tenantId: string;
  jobId: string;
  actor: string;
  status: Exclude<MediaGenerationStatus, "queued">;
  outputAssetIds?: string[];
  errorCode?: string;
  errorMessage?: string;
  root?: string;
}) {
  return mutate(options.tenantId, (document) => {
    const job = document.jobs.find((candidate) => candidate.id === options.jobId);
    if (!job) throw new Error("job_not_found");
    if (job.status === options.status) return { job, changed: false };
    if (["completed", "failed", "cancelled"].includes(job.status)) throw new Error("job_terminal");
    if (options.status === "completed" && !(options.outputAssetIds || []).length) throw new Error("verified_output_reference_required");
    const now = new Date().toISOString();
    job.status = options.status;
    job.updatedAt = now;
    if (options.status === "running") {
      job.startedAt ||= now;
    } else {
      job.finishedAt = now;
      job.outputAssetIds = (options.outputAssetIds || []).map((item) => clean(item, 120)).filter(Boolean).slice(0, 24);
      job.errorCode = options.status === "failed" ? clean(options.errorCode, 100) || "provider_failed" : null;
      job.errorMessage = options.status === "failed" ? clean(options.errorMessage, 500) || "Media generation failed." : null;
    }
    return { job, changed: true, actor: options.actor };
  }, options.root);
}

export async function retryMediaGenerationJob(options: {
  tenantId: string;
  jobId: string;
  actor: string;
  idempotencyKey: string;
  root?: string;
}) {
  const source = (await listMediaGenerationJobs(options.tenantId, { root: options.root }))
    .find((job) => job.id === options.jobId);
  if (!source) throw new Error("job_not_found");
  if (!["failed", "cancelled"].includes(source.status)) throw new Error("retry_requires_failed_or_cancelled_job");
  return createMediaGenerationJob({
    tenantId: options.tenantId,
    actor: options.actor,
    idempotencyKey: options.idempotencyKey,
    input: {
      modality: source.modality,
      prompt: source.prompt,
      provider: source.provider,
      model: source.model,
      parameters: source.parameters,
      referenceAssetIds: source.referenceAssetIds,
      retryOf: source.id,
      attempt: source.attempt + 1,
    },
    root: options.root,
  });
}
