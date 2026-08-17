import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { analyzeProduct } from "./calculators.mjs";
import { PRODUCTS, PRODUCT_IDS, productById, publicProduct } from "./catalog.mjs";
import { CoreLoopValidationError, validateCoreFields } from "./core-loops.mjs";
import { LocalIdentityAdapter } from "./identity.mjs";
import { RelationalRepositoryBoundary, createRepositoryHub } from "./repositories.mjs";

const SCHEMA_VERSION = 2;
const clone = (value) => structuredClone(value);
const text = (value, limit = 12000) => String(value ?? "").trim().slice(0, limit);
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

export class PlatformError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message); this.name = "PlatformError"; this.code = code; this.status = status; this.details = details;
  }
}

export const DEMO_SESSIONS = Object.freeze({
  "ai-demo-owner-token": { actorId: "ai-demo-owner", workspaceId: "ai-demo-workspace", role: "owner", displayName: "Portfolio Owner" },
  "ai-demo-reviewer-token": { actorId: "ai-demo-reviewer", workspaceId: "ai-demo-workspace", role: "reviewer", displayName: "Evidence Reviewer" },
  "ai-demo-outsider-token": { actorId: "ai-demo-outsider", workspaceId: "ai-outside-workspace", role: "owner", displayName: "Isolation Fixture" }
});

export function initialDocument(now = new Date().toISOString()) {
  const entitlements = Object.fromEntries(PRODUCT_IDS.map((id) => [id, { status: "active", plan: "evaluation", grantedAt: now }]));
  const flags = Object.fromEntries(PRODUCT_IDS.map((id) => [id, { enabled: true, analysisEnabled: true, jobsEnabled: true, expensiveOperationsEnabled: true, externalProvidersEnabled: false, rollout: "invited_alpha", analysisPath: "deterministic-domain-v1" }]));
  const consent = Object.fromEntries(PRODUCT_IDS.map((id) => [id, { status: "not_requested", updatedAt: now }]));
  return {
    schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now,
    workspaces: {
      "ai-demo-workspace": { id: "ai-demo-workspace", name: "PHANTOMStore Domain Lab", members: { "ai-demo-owner": "owner", "ai-demo-reviewer": "reviewer" }, entitlements, flags, consent, planLimits: { artifactsPerProduct: 500, analysesPerProduct: 1000, concurrentJobs: 5 } },
      "ai-outside-workspace": { id: "ai-outside-workspace", name: "Isolation Fixture", members: { "ai-demo-outsider": "owner" }, entitlements: { "phantom-oracle": entitlements["phantom-oracle"] }, flags: { "phantom-oracle": flags["phantom-oracle"] }, consent: { "phantom-oracle": consent["phantom-oracle"] } }
    },
    artifacts: [], analyses: [], jobs: [], sources: [], consentRecords: [], audit: [], metrics: [], traces: [], idempotency: [], deletedArtifacts: []
  };
}

export function migrateDocument(raw, now = new Date().toISOString()) {
  const source = raw && typeof raw === "object" ? raw : {};
  if (!source.schemaVersion) return initialDocument(now);
  if (source.schemaVersion > SCHEMA_VERSION) throw new PlatformError("SCHEMA_TOO_NEW", "The local data file was created by a newer package version.", 409);
  const base = initialDocument(source.createdAt || now);
  const migrated = {
    ...base, ...source, schemaVersion: SCHEMA_VERSION, updatedAt: now,
    workspaces: source.workspaces || base.workspaces,
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : [],
    analyses: Array.isArray(source.analyses) ? source.analyses : [],
    jobs: Array.isArray(source.jobs) ? source.jobs : [],
    sources: Array.isArray(source.sources) ? source.sources : [],
    consentRecords: Array.isArray(source.consentRecords) ? source.consentRecords : [],
    audit: Array.isArray(source.audit) ? source.audit : [],
    metrics: Array.isArray(source.metrics) ? source.metrics : [],
    traces: Array.isArray(source.traces) ? source.traces : [],
    idempotency: Array.isArray(source.idempotency) ? source.idempotency : [],
    deletedArtifacts: Array.isArray(source.deletedArtifacts) ? source.deletedArtifacts : []
  };
  for (const [workspaceId, workspace] of Object.entries(migrated.workspaces)) for (const [productId, consent] of Object.entries(workspace.consent || {})) {
    if (!consent || consent.status === "not_requested" || migrated.consentRecords.some((item) => item.workspaceId === workspaceId && item.productId === productId && item.status === consent.status)) continue;
    const id = `migrated-consent-${digest(`${workspaceId}|${productId}|${consent.updatedAt || now}`).slice(0, 16)}`; migrated.consentRecords.push({ id, workspaceId, productId, status: consent.status, purpose: consent.purpose || "Migrated local preview consent.", retentionDays: Number(consent.retentionDays) || 30, actorId: consent.actorId || "migration", createdAt: consent.updatedAt || now, updatedAt: consent.updatedAt || now, supersedesId: null, migrated: true }); workspace.consent[productId] = { ...consent, id };
  }
  for (const artifact of migrated.artifacts) {
    artifact.sourceDependencies ||= [];
    for (const evidence of artifact.evidence || []) {
      const consentRecordId = migrated.consentRecords.filter((item) => item.workspaceId === artifact.workspaceId && item.productId === artifact.productId && item.status === "granted").at(-1)?.id || null;
      if (!migrated.sources.some((item) => item.id === evidence.id && item.workspaceId === artifact.workspaceId)) migrated.sources.push({ id: evidence.id, workspaceId: artifact.workspaceId, productId: artifact.productId, consentRecordId, state: artifact.status === "restricted" ? "restricted" : "active", contentHash: evidence.contentHash, createdAt: evidence.capturedAt || artifact.createdAt, updatedAt: now, deletedAt: null });
      if (!artifact.sourceDependencies.some((item) => item.sourceId === evidence.id)) artifact.sourceDependencies.push({ sourceId: evidence.id, consentRecordId, relation: "derived_from" });
    }
    artifact.dependencyState ||= artifact.status === "restricted" ? "restricted" : "fresh";
  }
  return migrated;
}

export class JsonFileAdapter {
  constructor(filePath) { this.filePath = filePath; }
  async read() { try { return JSON.parse(await readFile(this.filePath, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
  async write(document) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}

export class MemoryAdapter {
  constructor(document = null) { this.document = document ? clone(document) : null; }
  async read() { return this.document ? clone(this.document) : null; }
  async write(document) { this.document = clone(document); }
}

export class AiProductsPlatform {
  constructor({ adapter, now = () => new Date().toISOString(), id = () => randomUUID(), identityAdapter = null }) {
    this.adapter = adapter; this.now = now; this.id = id; this.identityAdapter = identityAdapter || new LocalIdentityAdapter({ now }); this.relationalBoundary = new RelationalRepositoryBoundary(); this.document = null; this.writeChain = Promise.resolve();
  }
  async init() { this.document = migrateDocument(await this.adapter.read(), this.now()); await this.adapter.write(this.document); return this; }
  repositories(document = this.document) { return createRepositoryHub(document); }
  sessionForToken(token) { const session = this.identityAdapter.authenticate(text(token, 160)); if (!session) throw new PlatformError("AUTH_REQUIRED", "Use a valid local demo session.", 401); if (Date.parse(session.sessionExpiresAt) <= Date.parse(this.now())) throw new PlatformError("SESSION_EXPIRED", "The local session expired.", 401); return clone(session); }
  catalog() { return PRODUCTS.map(publicProduct); }
  async mutate(operation) {
    const pending = this.writeChain.then(async () => { const result = await operation(this.document); this.document.updatedAt = this.now(); await this.adapter.write(this.document); return clone(result); });
    this.writeChain = pending.catch(() => {}); return pending;
  }
  workspaceFor(session) {
    const workspace = this.document.workspaces[session.workspaceId];
    if (!workspace || !workspace.members?.[session.actorId]) throw new PlatformError("WORKSPACE_FORBIDDEN", "This session cannot access the workspace.", 403);
    return workspace;
  }
  authorize(session, productId, { role = "viewer", analysis = false, jobs = false } = {}) {
    const product = productById(productId); if (!product) throw new PlatformError("PRODUCT_NOT_FOUND", "The product does not exist.", 404);
    const workspace = this.workspaceFor(session); const entitlement = workspace.entitlements?.[productId]; const flags = workspace.flags?.[productId];
    if (!entitlement || entitlement.status !== "active") throw new PlatformError("ENTITLEMENT_REQUIRED", "This workspace is not entitled to the product.", 403);
    if (!flags?.enabled || ["paused", "retired"].includes(flags.rollout)) throw new PlatformError("PRODUCT_UNAVAILABLE", "The product is paused for this workspace.", 403);
    if (analysis && !flags.analysisEnabled) throw new PlatformError("ANALYSIS_PAUSED", "Automated analysis is paused; source artifacts remain available.", 503);
    if (jobs && !flags.jobsEnabled) throw new PlatformError("JOBS_PAUSED", "Job execution is paused for this product.", 503);
    if (analysis && flags.expensiveOperationsEnabled === false) throw new PlatformError("EXPENSIVE_OPERATION_PAUSED", "Analysis operations are paused for this workspace.", 503);
    if (analysis && flags.externalProvidersEnabled) throw new PlatformError("EXTERNAL_PROVIDER_POLICY", "External providers are disabled for this milestone.", 503);
    const levels = { viewer: 0, reviewer: 1, owner: 2 }; const actualRole = workspace.members[session.actorId];
    if ((levels[actualRole] ?? -1) < (levels[role] ?? 0)) throw new PlatformError("ROLE_FORBIDDEN", "This action requires a higher workspace role.", 403);
    return { workspace, entitlement, flags, product, role: actualRole };
  }
  audit(document, session, productId, entityType, entityId, action) {
    this.repositories(document).audit.insert(session.workspaceId, { id: this.id(), schemaVersion: 1, workspaceId: session.workspaceId, productId, actorId: session.actorId, entityType, entityId, action, occurredAt: this.now(), correlationId: this.id(), privacyClass: "workspace_sensitive", payload: { contentIncluded: false, fieldNames: [] }, redactionHints: ["actorId"] });
  }
  measure(document, workspaceId, productId, name, value, unit = "count") {
    this.repositories(document).metrics.insert(workspaceId, { id: this.id(), workspaceId, productId, name, value, unit, at: this.now() });
    if (document.metrics.length > 1000) document.metrics.splice(0, document.metrics.length - 1000);
  }
  observe(document, { workspaceId, productId = null, operation, requestId = null, correlationId = null, jobId = null, durationMs = 0, resultState = "succeeded", errorCode = null, retryCount = 0 }) {
    const safeWorkspace = digest(workspaceId).slice(0, 16); const trace = { id: this.id(), workspaceId, schemaVersion: 1, requestId: requestId || this.id(), correlationId: correlationId || this.id(), jobId, tenantHash: safeWorkspace, productId, operation, durationMs: Math.max(0, Number(durationMs) || 0), resultState, errorCode, retryCount, modelRoute: "local_deterministic", modelCostUsd: 0, at: this.now(), rawContentIncluded: false };
    this.repositories(document).traces.insert(workspaceId, trace); if (document.traces.length > 2000) document.traces.splice(0, document.traces.length - 2000); return trace;
  }
  async recordTrace(context) { return this.mutate((document) => this.observe(document, context)); }
  previous(document, session, scope, key, inputDigest = null) {
    const normalized = text(key, 180); if (!normalized) throw new PlatformError("IDEMPOTENCY_KEY_REQUIRED", "This mutation requires an Idempotency-Key header.", 400);
    const found = document.idempotency.find((item) => item.workspaceId === session.workspaceId && item.scope === scope && item.key === normalized) || null;
    if (found && inputDigest && found.inputDigest && found.inputDigest !== inputDigest) throw new PlatformError("IDEMPOTENCY_COLLISION", "The idempotency key was already used with a different request.", 409);
    return found;
  }
  remember(document, session, scope, key, result, inputDigest = null) {
    document.idempotency.push({ id: this.id(), workspaceId: session.workspaceId, scope, key: text(key, 180), inputDigest, result, createdAt: this.now() });
    if (document.idempotency.length > 1000) document.idempotency.splice(0, document.idempotency.length - 1000);
  }
  validateFields(product, supplied) {
    const fields = {}; const fieldErrors = [];
    for (const definition of product.fields) {
      const value = text(supplied?.[definition.id], definition.type === "textarea" ? 12000 : 1000);
      if (definition.required && !value) fieldErrors.push({ field: definition.id, message: `${definition.label} is required.` });
      if (definition.type === "number" && value && !Number.isFinite(Number(value))) fieldErrors.push({ field: definition.id, message: `${definition.label} must be numeric.` });
      fields[definition.id] = value;
    }
    if (fieldErrors.length) throw new PlatformError("VALIDATION_FAILED", "Complete the required domain fields.", 422, { fieldErrors });
    return fields;
  }
  async setConsent(session, productId, input = {}) {
    this.authorize(session, productId, { role: "owner" }); const status = input.status === "withdrawn" ? "withdrawn" : "granted";
    return this.mutate((document) => {
      const workspace = document.workspaces[session.workspaceId];
      const consentRecord = { id: this.id(), workspaceId: session.workspaceId, productId, status, purpose: text(input.purpose, 500) || "Create and review local domain analysis artifacts.", retentionDays: Math.max(1, Math.min(3650, Number(input.retentionDays) || 30)), actorId: session.actorId, createdAt: this.now(), updatedAt: this.now(), supersedesId: this.repositories(document).consents.list(session.workspaceId, (item) => item.productId === productId).at(-1)?.id || null };
      this.repositories(document).consents.insert(session.workspaceId, consentRecord); workspace.consent[productId] = { ...consentRecord };
      if (status === "withdrawn") {
        for (const source of this.repositories(document).sources.list(session.workspaceId, (item) => item.productId === productId && !item.deletedAt)) { source.state = "restricted"; source.updatedAt = this.now(); }
        for (const artifact of this.repositories(document).artifacts.list(session.workspaceId, (item) => item.productId === productId)) { artifact.status = "restricted"; artifact.dependencyState = "restricted"; artifact.dependencyReason = "consent_withdrawn"; }
        for (const analysis of this.repositories(document).analyses.list(session.workspaceId, (item) => item.productId === productId)) { analysis.status = "stale"; analysis.accessState = "restricted"; analysis.staleReason = "consent_withdrawn"; }
      } else {
        for (const source of this.repositories(document).sources.list(session.workspaceId, (item) => item.productId === productId && item.state === "restricted" && !item.deletedAt)) { source.state = "active"; source.consentRecordId = consentRecord.id; source.updatedAt = this.now(); }
        for (const artifact of this.repositories(document).artifacts.list(session.workspaceId, (item) => item.productId === productId && item.status === "restricted")) { artifact.status = "draft"; artifact.dependencyState = "stale"; artifact.dependencyReason = "consent_restored_recompute_required"; artifact.recomputeAvailable = true; artifact.sourceDependencies = (artifact.sourceDependencies || []).map((item) => ({ ...item, consentRecordId: consentRecord.id })); }
      }
      this.audit(document, session, productId, "consent", productId, status === "granted" ? "consent.granted" : "consent.withdrawn");
      this.observe(document, { workspaceId: session.workspaceId, productId, operation: `consent.${status}`, resultState: status });
      return workspace.consent[productId];
    });
  }
  async createArtifact(session, productId, input = {}, idempotencyKey) {
    const { workspace, product } = this.authorize(session, productId, { role: "reviewer" });
    if (workspace.consent?.[productId]?.status !== "granted") throw new PlatformError("CONSENT_REQUIRED", "Grant product-specific consent before creating an artifact.", 409);
    const fields = this.validateFields(product, input.fields); const evidenceNote = text(input.evidenceNote, 4000);
    if (!evidenceNote) throw new PlatformError("EVIDENCE_REQUIRED", "Add a source or provenance note.", 422);
    try { validateCoreFields(productId, fields); } catch (error) { if (error instanceof CoreLoopValidationError) throw new PlatformError(error.code, error.message, 422, error.details); throw error; }
    if (this.repositories().artifacts.list(session.workspaceId, (item) => item.productId === productId).length >= Number(workspace.planLimits?.artifactsPerProduct || 500)) throw new PlatformError("PLAN_LIMIT_REACHED", "The workspace artifact limit for this product was reached.", 403);
    const requestDigest = digest(JSON.stringify({ productId, fields, evidenceNote, evidenceLabel: text(input.evidenceLabel, 240) }));
    return this.mutate((document) => {
      const scope = `artifact.create:${productId}`; const repeated = this.previous(document, session, scope, idempotencyKey, requestDigest); if (repeated) return { ...repeated.result, idempotent: true };
      const consentRecord = this.repositories(document).consents.activeForProduct(session.workspaceId, productId); if (!consentRecord) throw new PlatformError("CONSENT_RECORD_REQUIRED", "An active source consent record is required.", 409);
      const artifactId = this.id(); const sourceId = this.id(); const evidence = [{ id: sourceId, label: text(input.evidenceLabel, 240) || "User-provided domain evidence", sourceType: "user_provided", content: evidenceNote, contentHash: digest(evidenceNote), capturedAt: this.now(), immutableOriginal: true }];
      const source = { id: sourceId, workspaceId: session.workspaceId, productId, consentRecordId: consentRecord.id, state: "active", contentHash: digest(evidenceNote), createdAt: this.now(), updatedAt: this.now(), deletedAt: null };
      this.repositories(document).sources.insert(session.workspaceId, source);
      const artifact = { id: artifactId, schemaVersion: 2, workspaceId: session.workspaceId, productId, objectType: product.objectType, title: fields[product.fields[0].id], fields, evidence, sourceDependencies: [{ sourceId, consentRecordId: consentRecord.id, relation: "derived_from" }], dependencyState: "fresh", dependencyReason: null, recomputeAvailable: false, status: "draft", revision: 1, versionHistory: [{ revision: 1, actorId: session.actorId, at: this.now(), changedFields: Object.keys(fields), inputDigest: digest(JSON.stringify(fields)) }], createdBy: session.actorId, createdAt: this.now(), updatedAt: this.now(), archivedAt: null, deletedAt: null };
      this.repositories(document).artifacts.insert(session.workspaceId, artifact); this.audit(document, session, productId, "artifact", artifact.id, "artifact.created"); this.measure(document, session.workspaceId, productId, "artifact.created", 1); this.observe(document, { workspaceId: session.workspaceId, productId, operation: "artifact.create", resultState: "succeeded" });
      const result = { artifact, idempotent: false }; this.remember(document, session, scope, idempotencyKey, result, requestDigest); return result;
    });
  }
  artifactFor(session, artifactId, { includeArchived = false, includeRestricted = false } = {}) {
    const artifact = this.repositories().artifacts.get(session.workspaceId, artifactId);
    if (!artifact) throw new PlatformError("ARTIFACT_NOT_FOUND", "The artifact was not found.", 404);
    this.authorize(session, artifact.productId);
    if (artifact.status === "archived" && !includeArchived) throw new PlatformError("ARTIFACT_ARCHIVED", "The artifact is archived.", 409);
    if (artifact.status === "restricted" && !includeRestricted) throw new PlatformError("CONSENT_WITHDRAWN", "The artifact is restricted after consent withdrawal.", 403);
    return artifact;
  }
  dependencyStateFor(session, artifactId) {
    const artifact = this.repositories().artifacts.get(session.workspaceId, artifactId); if (!artifact) throw new PlatformError("ARTIFACT_NOT_FOUND", "The artifact was not found.", 404); this.authorize(session, artifact.productId);
    const dependencies = (artifact.sourceDependencies || []).map((dependency) => { const source = this.repositories().sources.get(session.workspaceId, dependency.sourceId, { includeDeleted: true }); const consent = dependency.consentRecordId ? this.repositories().consents.get(session.workspaceId, dependency.consentRecordId, { includeDeleted: true }) : null; const state = !source || source.deletedAt || source.state === "deleted" ? "deleted" : source.state === "restricted" || consent?.status === "withdrawn" ? "restricted" : "active"; return { ...dependency, state, reason: state === "active" ? null : state === "deleted" ? "source_deleted" : "source_consent_withdrawn" }; });
    const state = dependencies.some((item) => item.state === "deleted") ? "deleted" : dependencies.some((item) => item.state === "restricted") ? "restricted" : artifact.dependencyState === "stale" ? "stale" : "fresh";
    return { artifactId, state, usable: state === "fresh", recomputeAvailable: Boolean(artifact.recomputeAvailable || state === "stale"), reasons: [...new Set(dependencies.map((item) => item.reason).filter(Boolean))], dependencies };
  }
  listArtifacts(session, { productId = "", includeArchived = false } = {}) {
    this.workspaceFor(session); if (productId) this.authorize(session, productId);
    return clone(this.repositories().artifacts.list(session.workspaceId, (item) => !item.deletedAt && (includeArchived || item.status !== "archived") && (!productId || item.productId === productId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)));
  }
  async updateArtifact(session, artifactId, input = {}, idempotencyKey) {
    const existing = this.artifactFor(session, artifactId); const { product } = this.authorize(session, existing.productId, { role: "reviewer" });
    return this.mutate((document) => {
      const artifact = this.repositories(document).artifacts.get(session.workspaceId, artifactId); const expected = Number(input.expectedRevision);
      const requestDigest = digest(JSON.stringify({ expected, fields: input.fields || {} })); const scope = `artifact.update:${artifactId}:${expected}`; const repeated = this.previous(document, session, scope, idempotencyKey, requestDigest); if (repeated) return { ...repeated.result, idempotent: true };
      if (expected !== artifact.revision) throw new PlatformError("REVISION_CONFLICT", "The artifact changed since it was opened.", 409, { currentRevision: artifact.revision });
      const nextFields = this.validateFields(product, { ...artifact.fields, ...(input.fields || {}) });
      try { validateCoreFields(artifact.productId, nextFields); } catch (error) { if (error instanceof CoreLoopValidationError) throw new PlatformError(error.code, error.message, 422, error.details); throw error; }
      artifact.fields = nextFields; artifact.title = artifact.fields[product.fields[0].id]; artifact.revision += 1; artifact.updatedAt = this.now(); artifact.status = "draft"; artifact.dependencyState = "fresh"; artifact.dependencyReason = null; artifact.recomputeAvailable = false;
      this.repositories(document).versions.append(session.workspaceId, artifactId, { revision: artifact.revision, actorId: session.actorId, at: this.now(), changedFields: Object.keys(input.fields || {}), inputDigest: digest(JSON.stringify(nextFields)) });
      for (const analysis of this.repositories(document).analyses.forArtifact(session.workspaceId, artifactId).filter((item) => item.status !== "stale")) { analysis.status = "stale"; analysis.staleReason = "source_revision_changed"; }
      this.audit(document, session, artifact.productId, "artifact", artifact.id, "artifact.updated"); this.observe(document, { workspaceId: session.workspaceId, productId: artifact.productId, operation: "artifact.update", resultState: "succeeded" }); const result = { artifact, idempotent: false }; this.remember(document, session, scope, idempotencyKey, result, requestDigest); return result;
    });
  }
  async duplicateArtifact(session, artifactId, idempotencyKey) {
    const existing = this.artifactFor(session, artifactId); this.authorize(session, existing.productId, { role: "reviewer" });
    return this.mutate((document) => {
      const requestDigest = digest(artifactId); const scope = `artifact.duplicate:${artifactId}`; const repeated = this.previous(document, session, scope, idempotencyKey, requestDigest); if (repeated) return { ...repeated.result, idempotent: true };
      const original = this.repositories(document).artifacts.get(session.workspaceId, artifactId); const copy = clone(original); copy.id = this.id(); copy.title = `${copy.title} — copy`; copy.fields[productById(copy.productId).fields[0].id] = copy.title; copy.status = "draft"; copy.revision = 1; copy.createdBy = session.actorId; copy.createdAt = this.now(); copy.updatedAt = this.now(); copy.versionHistory = [{ revision: 1, actorId: session.actorId, at: this.now(), changedFields: ["duplicatedFrom"], duplicatedFrom: artifactId, inputDigest: digest(JSON.stringify(copy.fields)) }];
      const activeConsent = this.repositories(document).consents.activeForProduct(session.workspaceId, copy.productId); copy.evidence = copy.evidence.map((item) => { const id = this.id(); this.repositories(document).sources.insert(session.workspaceId, { id, workspaceId: session.workspaceId, productId: copy.productId, consentRecordId: activeConsent?.id || null, state: "active", contentHash: item.contentHash, createdAt: this.now(), updatedAt: this.now(), deletedAt: null }); return { ...item, id }; }); copy.sourceDependencies = copy.evidence.map((item) => ({ sourceId: item.id, consentRecordId: activeConsent?.id || null, relation: "duplicated_from_source" }));
      this.repositories(document).artifacts.insert(session.workspaceId, copy); this.audit(document, session, copy.productId, "artifact", copy.id, "artifact.duplicated"); this.observe(document, { workspaceId: session.workspaceId, productId: copy.productId, operation: "artifact.duplicate", resultState: "succeeded" }); const result = { artifact: copy, idempotent: false }; this.remember(document, session, scope, idempotencyKey, result, requestDigest); return result;
    });
  }
  async runAnalysis(session, artifactId, input = {}, idempotencyKey) {
    const existing = this.artifactFor(session, artifactId); const { flags, product } = this.authorize(session, existing.productId, { role: "reviewer", analysis: true, jobs: true });
    const dependency = this.dependencyStateFor(session, artifactId); if (!["fresh", "stale"].includes(dependency.state)) throw new PlatformError("SOURCE_DEPENDENCY_RESTRICTED", "A source dependency is restricted or deleted.", 409, { dependencyState: dependency.state, reasons: dependency.reasons });
    const path = input.path === "deterministic-conservative-v1" ? "deterministic-conservative-v1" : flags.analysisPath; const requestDigest = digest(JSON.stringify({ artifactId, sourceRevision: existing.revision, path })); const scope = `analysis.run:${artifactId}:${existing.revision}`;
    const kickoff = await this.mutate((document) => {
      const repeated = this.previous(document, session, scope, idempotencyKey, requestDigest); if (repeated) return { repeated: true, result: repeated.result };
      const artifact = this.repositories(document).artifacts.get(session.workspaceId, artifactId); const correlationId = this.id(); const job = { id: this.id(), schemaVersion: 1, workspaceId: session.workspaceId, productId: artifact.productId, artifactId, operation: product.taskId, inputDigest: digest(JSON.stringify(artifact.fields)), idempotencyKey: text(idempotencyKey, 180), attemptCount: 0, maxAttempts: 3, status: "queued", phase: "queued", progressMessage: "Analysis job persisted and queued.", createdAt: this.now(), startedAt: null, completedAt: null, updatedAt: this.now(), lastErrorCode: null, retryable: false, resultArtifactId: artifact.id, resultAnalysisId: null, correlationId, causationId: input.causationId ? text(input.causationId, 180) : correlationId };
      this.repositories(document).jobs.insert(session.workspaceId, job); this.remember(document, session, scope, idempotencyKey, { job }, requestDigest); this.observe(document, { workspaceId: session.workspaceId, productId: artifact.productId, operation: "analysis.queued", jobId: job.id, correlationId, resultState: "queued" }); return { repeated: false, job };
    });
    if (kickoff.repeated) return { ...kickoff.result, idempotent: true };
    await this.mutate((document) => { const job = this.repositories(document).jobs.get(session.workspaceId, kickoff.job.id); job.status = "running"; job.phase = "validating_inputs"; job.progressMessage = "Validating versioned source inputs."; job.attemptCount = 1; job.startedAt = this.now(); job.updatedAt = this.now(); this.observe(document, { workspaceId: session.workspaceId, productId: job.productId, operation: "analysis.running", jobId: job.id, correlationId: job.correlationId, resultState: "running" }); return job; });
    if (input.simulateFailure === "crash_retryable") {
      await this.mutate((document) => { const job = this.repositories(document).jobs.get(session.workspaceId, kickoff.job.id); job.status = "failed"; job.phase = "worker_interrupted"; job.progressMessage = "The in-process worker stopped after the durable job record was written."; job.lastErrorCode = "SIMULATED_WORKER_CRASH"; job.retryable = true; job.updatedAt = this.now(); this.observe(document, { workspaceId: session.workspaceId, productId: job.productId, operation: "analysis.failed", jobId: job.id, correlationId: job.correlationId, resultState: "failed", errorCode: job.lastErrorCode, retryCount: job.attemptCount - 1 }); return job; });
      throw new PlatformError("SIMULATED_WORKER_CRASH", "The durable local job was interrupted and can be retried.", 503, { jobId: kickoff.job.id, retryable: true });
    }
    return this.executeAnalysisJob(session, kickoff.job.id, path, scope);
  }
  async executeAnalysisJob(session, jobId, path, idempotencyScope = null) {
    const jobSnapshot = this.repositories().jobs.get(session.workspaceId, jobId); if (!jobSnapshot) throw new PlatformError("JOB_NOT_FOUND", "The job was not found.", 404); const artifactSnapshot = this.repositories().artifacts.get(session.workspaceId, jobSnapshot.artifactId); if (!artifactSnapshot) throw new PlatformError("ARTIFACT_NOT_FOUND", "The artifact was not found.", 404);
    let output;
    try { output = analyzeProduct(artifactSnapshot.productId, artifactSnapshot.fields, artifactSnapshot.evidence.map((item) => item.id), { now: this.now(), path }); }
    catch (error) {
      await this.mutate((document) => { const job = this.repositories(document).jobs.get(session.workspaceId, jobId); job.status = job.attemptCount >= job.maxAttempts ? "dead_letter" : "failed"; job.phase = "schema_validation_failed"; job.progressMessage = "Domain output validation failed; source work was preserved."; job.lastErrorCode = error?.code || "ANALYSIS_VALIDATION_FAILED"; job.retryable = job.status !== "dead_letter"; job.completedAt = job.status === "dead_letter" ? this.now() : null; job.updatedAt = this.now(); this.observe(document, { workspaceId: session.workspaceId, productId: job.productId, operation: "analysis.failed", jobId, correlationId: job.correlationId, resultState: job.status, errorCode: job.lastErrorCode, retryCount: job.attemptCount - 1 }); return job; });
      const code = error instanceof CoreLoopValidationError ? error.code : "ANALYSIS_VALIDATION_FAILED"; throw new PlatformError(code, "The domain analysis failed output validation; source work was preserved.", 422, error?.details || {});
    }
    const finalized = await this.mutate((document) => {
      const job = this.repositories(document).jobs.get(session.workspaceId, jobId); const artifact = this.repositories(document).artifacts.get(session.workspaceId, job.artifactId); if (job.inputDigest !== digest(JSON.stringify(artifact.fields))) { job.status = "stale"; job.phase = "source_changed"; job.progressMessage = "The source changed before job completion."; job.lastErrorCode = "SOURCE_REVISION_CHANGED"; job.retryable = false; job.completedAt = this.now(); job.updatedAt = this.now(); return { stale: true, job }; }
      const analysis = { id: this.id(), schemaVersion: 2, workspaceId: session.workspaceId, productId: artifact.productId, artifactId: artifact.id, sourceRevision: artifact.revision, sourceDependencies: clone(artifact.sourceDependencies || []), accessState: "usable", taskId: job.operation, providerPath: path, output, status: "pending_review", reviewerId: null, finalDisposition: null, correction: null, createdAt: this.now(), reviewedAt: null, staleReason: null };
      this.repositories(document).analyses.insert(session.workspaceId, analysis); job.status = "awaiting_review"; job.phase = "awaiting_human_review"; job.progressMessage = "Deterministic analysis completed and awaits human review."; job.resultAnalysisId = analysis.id; job.retryable = false; job.updatedAt = this.now(); artifact.status = "analysis_review"; artifact.updatedAt = this.now();
      this.audit(document, session, artifact.productId, "analysis", analysis.id, "analysis.generated"); this.measure(document, session.workspaceId, artifact.productId, "analysis.cost", 0, "USD"); this.observe(document, { workspaceId: session.workspaceId, productId: artifact.productId, operation: "analysis.awaiting_review", jobId: job.id, correlationId: job.correlationId, resultState: "awaiting_review", retryCount: job.attemptCount - 1 });
      const result = { analysis, job, artifact, idempotent: false }; if (idempotencyScope) { const record = document.idempotency.find((item) => item.workspaceId === session.workspaceId && item.scope === idempotencyScope && item.key === job.idempotencyKey); if (record) record.result = result; } return result;
    });
    if (finalized.stale) throw new PlatformError("SOURCE_REVISION_CHANGED", "The source changed while the job was running.", 409); return finalized;
  }
  async retryJob(session, jobId) {
    const existing = this.repositories().jobs.get(session.workspaceId, jobId); if (!existing) throw new PlatformError("JOB_NOT_FOUND", "The job was not found.", 404); this.authorize(session, existing.productId, { role: "reviewer", analysis: true, jobs: true });
    if (existing.status !== "failed" || !existing.retryable) throw new PlatformError("JOB_NOT_RETRYABLE", "The job is not in a retryable failed state.", 409); if (existing.attemptCount >= existing.maxAttempts) throw new PlatformError("JOB_ATTEMPTS_EXHAUSTED", "The job exhausted its retry attempts.", 409);
    const retryState = await this.mutate((document) => { const job = this.repositories(document).jobs.get(session.workspaceId, jobId); const artifact = this.repositories(document).artifacts.get(session.workspaceId, job.artifactId); if (job.inputDigest !== digest(JSON.stringify(artifact.fields))) { job.status = "stale"; job.phase = "source_changed"; job.retryable = false; job.updatedAt = this.now(); return { stale: true, job }; } job.status = "running"; job.phase = "retrying"; job.progressMessage = "Retrying from the durable source digest."; job.attemptCount += 1; job.lastErrorCode = null; job.updatedAt = this.now(); this.observe(document, { workspaceId: session.workspaceId, productId: job.productId, operation: "analysis.retry", jobId, correlationId: job.correlationId, resultState: "running", retryCount: job.attemptCount - 1 }); return { stale: false, job }; });
    if (retryState.stale) throw new PlatformError("SOURCE_REVISION_CHANGED", "The source changed; create a new analysis job.", 409);
    return this.executeAnalysisJob(session, jobId, this.document.workspaces[session.workspaceId].flags[existing.productId].analysisPath, `analysis.run:${existing.artifactId}:${this.repositories().artifacts.get(session.workspaceId, existing.artifactId).revision}`);
  }
  async cancelJob(session, jobId) {
    const existing = this.repositories().jobs.get(session.workspaceId, jobId); if (!existing) throw new PlatformError("JOB_NOT_FOUND", "The job was not found.", 404); this.authorize(session, existing.productId, { role: "reviewer", jobs: true });
    return this.mutate((document) => { const job = this.repositories(document).jobs.get(session.workspaceId, jobId); if (!["queued", "running", "failed"].includes(job.status)) throw new PlatformError("JOB_NOT_CANCELABLE", "The job can no longer be canceled.", 409); job.status = "canceled"; job.phase = "canceled"; job.progressMessage = "Canceled by an authorized workspace member."; job.retryable = false; job.completedAt = this.now(); job.updatedAt = this.now(); this.audit(document, session, job.productId, "job", job.id, "job.canceled"); return { job }; });
  }
  analysesFor(session, artifactId) {
    const artifact = this.artifactFor(session, artifactId, { includeArchived: true, includeRestricted: true }); return clone(this.repositories().analyses.forArtifact(session.workspaceId, artifact.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async reviewAnalysis(session, analysisId, input = {}, idempotencyKey) {
    const existing = this.repositories().analyses.get(session.workspaceId, analysisId);
    if (!existing) throw new PlatformError("ANALYSIS_NOT_FOUND", "The analysis was not found.", 404);
    this.authorize(session, existing.productId, { role: "reviewer" }); const decision = ["accepted", "corrected", "rejected"].includes(input.decision) ? input.decision : ""; const correction = text(input.correction, 4000);
    if (!decision) throw new PlatformError("VALIDATION_FAILED", "Choose accepted, corrected, or rejected.", 422);
    if (decision === "corrected" && !correction) throw new PlatformError("CORRECTION_REQUIRED", "Record the correction before accepting corrected output.", 422);
    return this.mutate((document) => {
      const analysis = this.repositories(document).analyses.get(session.workspaceId, analysisId); const requestDigest = digest(JSON.stringify({ decision, correction })); const scope = `analysis.review:${analysisId}`; const repeated = this.previous(document, session, scope, idempotencyKey, requestDigest); if (repeated) return { ...repeated.result, idempotent: true };
      if (analysis.status !== "pending_review") throw new PlatformError("ANALYSIS_NOT_REVIEWABLE", "The analysis is not awaiting review.", 409);
      analysis.status = "reviewed"; analysis.reviewerId = session.actorId; analysis.finalDisposition = decision; analysis.correction = correction || null; analysis.reviewedAt = this.now();
      const artifact = this.repositories(document).artifacts.get(session.workspaceId, analysis.artifactId); artifact.status = decision === "rejected" ? "draft" : "published"; artifact.updatedAt = this.now();
      const job = this.repositories(document).jobs.list(session.workspaceId, (item) => item.resultAnalysisId === analysis.id)[0] || null; if (job) { job.status = "succeeded"; job.phase = "completed"; job.progressMessage = `Human review ${decision}.`; job.completedAt = this.now(); job.updatedAt = this.now(); }
      this.audit(document, session, analysis.productId, "analysis", analysis.id, `analysis.${decision}`); this.observe(document, { workspaceId: session.workspaceId, productId: analysis.productId, operation: "analysis.review", jobId: job?.id || null, correlationId: job?.correlationId || null, resultState: decision }); const result = { analysis, artifact, job, idempotent: false }; this.remember(document, session, scope, idempotencyKey, result, requestDigest); return result;
    });
  }
  async archiveArtifact(session, artifactId, restore = false) {
    const existing = this.artifactFor(session, artifactId, { includeArchived: true }); this.authorize(session, existing.productId, { role: "reviewer" });
    return this.mutate((document) => { const artifact = this.repositories(document).artifacts.get(session.workspaceId, artifactId); artifact.status = restore ? "draft" : "archived"; artifact.archivedAt = restore ? null : this.now(); artifact.updatedAt = this.now(); this.audit(document, session, artifact.productId, "artifact", artifact.id, restore ? "artifact.restored_from_archive" : "artifact.archived"); return { artifact }; });
  }
  async deleteArtifact(session, artifactId, confirmation) {
    if (confirmation !== `DELETE ${artifactId}`) throw new PlatformError("DELETE_CONFIRMATION_REQUIRED", `Confirm with DELETE ${artifactId}.`, 409);
    const existing = this.repositories().artifacts.get(session.workspaceId, artifactId, { includeDeleted: true }); const recoverable = this.document.deletedArtifacts.find((item) => item.id === artifactId && item.workspaceId === session.workspaceId);
    if (!existing && !recoverable) throw new PlatformError("ARTIFACT_NOT_FOUND", "The artifact was not found.", 404); this.authorize(session, (existing || recoverable).productId, { role: "owner" });
    if (recoverable && !existing) return { deleted: true, idempotent: true, recoverUntil: recoverable.recoverUntil };
    return this.mutate((document) => { const artifact = this.repositories(document).artifacts.remove(session.workspaceId, artifactId); artifact.deletedAt = this.now(); artifact.status = "deleted"; artifact.dependencyState = "deleted"; artifact.dependencyReason = "artifact_deleted"; const recoverUntil = new Date(Date.parse(this.now()) + 30 * 86400000).toISOString(); document.deletedArtifacts.push({ ...artifact, recoverUntil, recoveryPolicy: "local_30_day_recoverable" }); for (const dependency of artifact.sourceDependencies || []) { const source = this.repositories(document).sources.get(session.workspaceId, dependency.sourceId, { includeDeleted: true }); if (source) { source.state = "deleted"; source.deletedAt = this.now(); source.updatedAt = this.now(); } } for (const analysis of this.repositories(document).analyses.forArtifact(session.workspaceId, artifact.id)) { analysis.status = "stale"; analysis.accessState = "deleted"; analysis.staleReason = "source_deleted"; } this.audit(document, session, artifact.productId, "artifact", artifact.id, "artifact.deleted"); this.observe(document, { workspaceId: session.workspaceId, productId: artifact.productId, operation: "artifact.delete", resultState: "deleted" }); return { deleted: true, idempotent: false, recoverUntil }; });
  }
  async restoreDeletedArtifact(session, artifactId) {
    this.workspaceFor(session); return this.mutate((document) => { const index = document.deletedArtifacts.findIndex((item) => item.id === artifactId && item.workspaceId === session.workspaceId); if (index < 0) throw new PlatformError("RECOVERY_NOT_FOUND", "No recoverable artifact was found.", 404); const artifact = document.deletedArtifacts[index]; this.authorize(session, artifact.productId, { role: "owner" }); artifact.deletedAt = null; artifact.status = "draft"; artifact.dependencyState = "stale"; artifact.dependencyReason = "source_restored_recompute_required"; artifact.recomputeAvailable = true; artifact.updatedAt = this.now(); delete artifact.recoverUntil; delete artifact.recoveryPolicy; this.repositories(document).artifacts.insert(session.workspaceId, artifact); document.deletedArtifacts.splice(index, 1); const activeConsent = this.repositories(document).consents.activeForProduct(session.workspaceId, artifact.productId); for (const dependency of artifact.sourceDependencies || []) { const source = this.repositories(document).sources.get(session.workspaceId, dependency.sourceId, { includeDeleted: true }); if (source && activeConsent) { source.state = "active"; source.deletedAt = null; source.consentRecordId = activeConsent.id; source.updatedAt = this.now(); dependency.consentRecordId = activeConsent.id; } } this.audit(document, session, artifact.productId, "artifact", artifact.id, "artifact.recovered"); return { artifact, recomputeAvailable: Boolean(activeConsent) }; });
  }
  async deleteSource(session, sourceId, confirmation) {
    const source = this.repositories().sources.get(session.workspaceId, sourceId, { includeDeleted: true }); if (!source) throw new PlatformError("SOURCE_NOT_FOUND", "The source was not found.", 404); this.authorize(session, source.productId, { role: "owner" }); if (confirmation !== `DELETE SOURCE ${sourceId}`) throw new PlatformError("DELETE_CONFIRMATION_REQUIRED", `Confirm with DELETE SOURCE ${sourceId}.`, 409);
    if (source.deletedAt) return { deleted: true, idempotent: true };
    return this.mutate((document) => { const current = this.repositories(document).sources.get(session.workspaceId, sourceId, { includeDeleted: true }); current.state = "deleted"; current.deletedAt = this.now(); current.updatedAt = this.now(); for (const artifact of this.repositories(document).artifacts.list(session.workspaceId, (item) => (item.sourceDependencies || []).some((dependency) => dependency.sourceId === sourceId))) { artifact.status = "restricted"; artifact.dependencyState = "deleted"; artifact.dependencyReason = "source_deleted"; for (const analysis of this.repositories(document).analyses.forArtifact(session.workspaceId, artifact.id)) { analysis.status = "stale"; analysis.accessState = "deleted"; analysis.staleReason = "source_deleted"; } } this.audit(document, session, source.productId, "source", sourceId, "source.deleted"); return { deleted: true, idempotent: false }; });
  }
  async exportArtifact(session, artifactId) {
    const artifact = this.artifactFor(session, artifactId, { includeArchived: true, includeRestricted: true }); const analyses = this.analysesFor(session, artifactId); const dependencyState = this.dependencyStateFor(session, artifactId); const exportedArtifact = clone(artifact); const accessibleIds = new Set(dependencyState.dependencies.filter((item) => item.state === "active").map((item) => item.sourceId)); exportedArtifact.evidence = exportedArtifact.evidence.map((item) => accessibleIds.has(item.id) ? item : { id: item.id, label: item.label, sourceType: item.sourceType, contentHash: item.contentHash, capturedAt: item.capturedAt, contentOmitted: true, omissionReason: dependencyState.reasons[0] || "source_inaccessible" });
    const reviewHistory = analyses.map((item) => ({ analysisId: item.id, sourceRevision: item.sourceRevision, status: item.status, reviewerId: item.reviewerId, finalDisposition: item.finalDisposition, correction: item.correction, createdAt: item.createdAt, reviewedAt: item.reviewedAt }));
    const payload = { schemaVersion: 2, exportedAt: this.now(), product: publicProduct(productById(artifact.productId)), artifact: exportedArtifact, accessibleProvenance: dependencyState.dependencies.filter((item) => item.state === "active"), dependencyState, analyses, reviewHistory, lifecycleStatus: artifact.status, calculationMetadata: analyses.map((item) => ({ analysisId: item.id, taskId: item.taskId, providerPath: item.providerPath, sourceRevision: item.sourceRevision, metrics: item.output.metrics, warnings: item.output.warnings, method: item.output.method })), timestamps: { createdAt: artifact.createdAt, updatedAt: artifact.updatedAt, exportedAt: this.now() }, portability: { format: "application/json", sourceIdsPreserved: true, inaccessibleSourceContentExcluded: true } };
    await this.mutate((document) => { this.audit(document, session, artifact.productId, "artifact", artifact.id, "artifact.exported"); return true; });
    return payload;
  }
  snapshot(session) {
    const workspace = this.workspaceFor(session); const products = PRODUCT_IDS.filter((id) => workspace.entitlements?.[id]?.status === "active").map((id) => { const product = publicProduct(productById(id)); return { ...product, entitlement: workspace.entitlements[id], rollout: workspace.flags[id]?.rollout, consent: workspace.consent[id] }; });
    const artifacts = this.listArtifacts(session, { includeArchived: true }); const ids = new Set(artifacts.map((item) => item.id)); const analyses = this.repositories().analyses.list(session.workspaceId, (item) => ids.has(item.artifactId));
    return { version: 2, workspace: { id: workspace.id, name: workspace.name, role: workspace.members[session.actorId], consent: clone(workspace.consent), planLimits: clone(workspace.planLimits || {}) }, identity: { subjectId: session.subjectId || session.actorId, authenticationStrength: session.authenticationStrength || "direct_test_fixture", capabilities: clone(session.capabilities || []) }, products, artifacts, analyses: clone(analyses), foundation: { repositoryContract: "workspace_scoped_v1", relationalBoundary: this.relationalBoundary.describe(), jobContract: "durable_job_v1", dependencyContract: "source_consent_graph_v1", traceContract: "privacy_safe_trace_v1" }, diagnostics: this.status() };
  }
  auditLog(session, limit = 100) { this.workspaceFor(session); return clone(this.repositories().audit.list(session.workspaceId).slice(-Math.max(1, Math.min(500, Number(limit) || 100))).reverse()); }
  jobLog(session) { this.workspaceFor(session); return clone(this.repositories().jobs.list(session.workspaceId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  traceLog(session, limit = 100) { this.workspaceFor(session); return clone(this.repositories().traces.list(session.workspaceId).slice(-Math.max(1, Math.min(500, Number(limit) || 100))).reverse()); }
  status() { return { ok: true, deployment: "local_preview", schemaVersion: SCHEMA_VERSION, productCount: PRODUCTS.length, artifactCount: this.document?.artifacts.length || 0, analysisCount: this.document?.analyses.length || 0, pendingReviewCount: this.document?.analyses.filter((item) => item.status === "pending_review").length || 0, jobs: { queued: this.document?.jobs.filter((item) => item.status === "queued").length || 0, running: this.document?.jobs.filter((item) => item.status === "running").length || 0, awaitingReview: this.document?.jobs.filter((item) => item.status === "awaiting_review").length || 0, failed: this.document?.jobs.filter((item) => item.status === "failed").length || 0, deadLetter: this.document?.jobs.filter((item) => item.status === "dead_letter").length || 0 }, externalModelsActive: false, externalSpendUsd: 0 }; }
}

export function errorEnvelope(error, requestId) {
  const safe = error instanceof PlatformError ? error : new PlatformError("INTERNAL_ERROR", "The local service could not complete the request.", 500);
  return { error: { code: safe.code, message: safe.message, requestId, ...(safe.details || {}) } };
}
