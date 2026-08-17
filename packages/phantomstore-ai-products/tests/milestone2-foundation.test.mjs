import test from "node:test";
import assert from "node:assert/strict";
import { AiProductsPlatform, MemoryAdapter } from "../src/platform.mjs";
import { PRODUCTS } from "../src/catalog.mjs";
import { IdentityContract, LocalIdentityAdapter, ProductionIdentityAdapter } from "../src/identity.mjs";
import { RelationalRepositoryBoundary, RepositoryContract, createRepositoryHub } from "../src/repositories.mjs";

const owner = { actorId: "ai-demo-owner", workspaceId: "ai-demo-workspace", role: "owner", displayName: "Portfolio Owner" };
const reviewer = { actorId: "ai-demo-reviewer", workspaceId: "ai-demo-workspace", role: "reviewer", displayName: "Evidence Reviewer" };
const outsider = { actorId: "ai-demo-outsider", workspaceId: "ai-outside-workspace", role: "owner", displayName: "Isolation Fixture" };
const fixedNow = () => "2026-08-17T01:30:00.000Z";
const platformFor = async () => { let sequence = 0; return new AiProductsPlatform({ adapter: new MemoryAdapter(), now: fixedNow, id: () => `m2-${++sequence}` }).init(); };

test("identity adapters expose the production-shaped contract while production remains disabled", () => {
  const local = new LocalIdentityAdapter({ now: fixedNow }); const identity = local.authenticate("ai-demo-owner-token");
  for (const field of IdentityContract.requiredFields) assert.ok(field in identity, field); assert.equal(identity.subjectId, "ai-demo-owner"); assert.equal(identity.authenticationStrength, "local_demo"); assert.ok(identity.capabilities.includes("consent:manage"));
  assert.equal(local.authenticate("unknown"), null); assert.throws(() => new ProductionIdentityAdapter().authenticate(), /DISABLED/);
});

test("all repository reads require workspace scope and a known foreign ID cannot bypass it", async () => {
  const platform = await platformFor(); const item = PRODUCTS[0]; await platform.setConsent(owner, item.id, { status: "granted" }); const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "tenant-scoped source" }, "repo-scope"); const repositories = createRepositoryHub(platform.document);
  assert.ok(RepositoryContract.mandatoryScope.includes("workspaceId")); assert.throws(() => repositories.artifacts.get("", created.artifact.id), /workspaceId/); assert.equal(repositories.artifacts.get(outsider.workspaceId, created.artifact.id), null); assert.ok(repositories.artifacts.get(owner.workspaceId, created.artifact.id));
  assert.throws(() => repositories.artifacts.insert(owner.workspaceId, { id: "foreign", workspaceId: outsider.workspaceId }), /does not match/); assert.equal(new RelationalRepositoryBoundary().describe().enabled, false);
});

test("a workspace viewer remains read-only even when it knows product and object identifiers", async () => {
  const platform = await platformFor(); const item = PRODUCTS[0]; platform.document.workspaces[owner.workspaceId].members["read-only-fixture"] = "viewer"; const viewer = { actorId: "read-only-fixture", workspaceId: owner.workspaceId, role: "viewer" }; await platform.setConsent(owner, item.id, { status: "granted" }); const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "owner source" }, "viewer-owner-create"); assert.equal(platform.artifactFor(viewer, created.artifact.id).id, created.artifact.id); await assert.rejects(platform.createArtifact(viewer, item.id, { fields: item.sample, evidenceNote: "viewer write" }, "viewer-write"), (error) => error.code === "ROLE_FORBIDDEN"); await assert.rejects(platform.deleteArtifact(viewer, created.artifact.id, `DELETE ${created.artifact.id}`), (error) => error.code === "ROLE_FORBIDDEN");
});

test("consent/source graph enforces active, withdrawal, restore/recompute, deletion/export, and reviewer limits", async () => {
  const platform = await platformFor(); const item = PRODUCTS[9]; await platform.setConsent(owner, item.id, { status: "granted", purpose: "experiment review" }); const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "PRIVATE EXPERIMENT SOURCE" }, "consent-graph-create"); const sourceId = created.artifact.sourceDependencies[0].sourceId;
  assert.equal(platform.dependencyStateFor(owner, created.artifact.id).state, "fresh"); const run = await platform.runAnalysis(owner, created.artifact.id, {}, "consent-graph-run"); assert.equal(run.analysis.accessState, "usable");
  await assert.rejects(platform.setConsent(reviewer, item.id, { status: "withdrawn" }), (error) => error.code === "ROLE_FORBIDDEN"); await platform.setConsent(owner, item.id, { status: "withdrawn" }); assert.equal(platform.dependencyStateFor(owner, created.artifact.id).state, "restricted"); assert.equal(platform.document.analyses.find((analysis) => analysis.id === run.analysis.id).staleReason, "consent_withdrawn");
  await platform.setConsent(owner, item.id, { status: "granted" }); const restored = platform.dependencyStateFor(owner, created.artifact.id); assert.equal(restored.state, "stale"); assert.equal(restored.recomputeAvailable, true);
  await platform.deleteSource(owner, sourceId, `DELETE SOURCE ${sourceId}`); const exported = await platform.exportArtifact(owner, created.artifact.id); assert.equal(exported.dependencyState.state, "deleted"); assert.equal(exported.artifact.evidence[0].contentOmitted, true); assert.equal(JSON.stringify(exported).includes("PRIVATE EXPERIMENT SOURCE"), false);
});

test("durable analysis job persists before work, survives simulated crash, retries, awaits review, and completes", async () => {
  const platform = await platformFor(); const item = PRODUCTS[2]; await platform.setConsent(owner, item.id, { status: "granted" }); const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "foundry recipe" }, "job-create");
  let jobId; await assert.rejects(platform.runAnalysis(owner, created.artifact.id, { simulateFailure: "crash_retryable" }, "job-crash"), (error) => { jobId = error.details.jobId; return error.code === "SIMULATED_WORKER_CRASH" && error.details.retryable; }); const failed = platform.repositories().jobs.get(owner.workspaceId, jobId); assert.equal(failed.status, "failed"); assert.equal(failed.attemptCount, 1); assert.equal(failed.lastErrorCode, "SIMULATED_WORKER_CRASH");
  const retried = await platform.retryJob(owner, jobId); assert.equal(retried.job.status, "awaiting_review"); assert.equal(retried.job.attemptCount, 2); assert.equal(retried.analysis.output.coreLoop.benchmark.immutable, true); const reviewed = await platform.reviewAnalysis(reviewer, retried.analysis.id, { decision: "accepted" }, "job-review"); assert.equal(reviewed.job.status, "succeeded"); assert.ok(reviewed.job.completedAt);
  let canceledJobId; await assert.rejects(platform.runAnalysis(owner, created.artifact.id, { simulateFailure: "crash_retryable" }, "job-cancel-fixture"), (error) => { canceledJobId = error.details.jobId; return error.code === "SIMULATED_WORKER_CRASH"; }); const canceled = await platform.cancelJob(reviewer, canceledJobId); assert.equal(canceled.job.status, "canceled"); assert.equal(canceled.job.retryable, false);
});

test("idempotency detects collisions and deletion is exact plus repeat-safe", async () => {
  const platform = await platformFor(); const item = PRODUCTS[0]; await platform.setConsent(owner, item.id, { status: "granted" }); const first = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "first request" }, "collision-key");
  await assert.rejects(platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "different request" }, "collision-key"), (error) => error.code === "IDEMPOTENCY_COLLISION"); await assert.rejects(platform.deleteArtifact(owner, first.artifact.id, "wrong"), (error) => error.code === "DELETE_CONFIRMATION_REQUIRED"); const deleted = await platform.deleteArtifact(owner, first.artifact.id, `DELETE ${first.artifact.id}`); const repeated = await platform.deleteArtifact(owner, first.artifact.id, `DELETE ${first.artifact.id}`); assert.equal(deleted.idempotent, false); assert.equal(repeated.idempotent, true);
});

test("plan limits and operation kill switches are enforced before mutation", async () => {
  const platform = await platformFor(); const item = PRODUCTS[1]; await platform.setConsent(owner, item.id, { status: "granted" }); platform.document.workspaces[owner.workspaceId].planLimits.artifactsPerProduct = 1; const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "within limit" }, "limit-one"); await assert.rejects(platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "over limit" }, "limit-two"), (error) => error.code === "PLAN_LIMIT_REACHED"); platform.document.workspaces[owner.workspaceId].flags[item.id].expensiveOperationsEnabled = false; await assert.rejects(platform.runAnalysis(owner, created.artifact.id, {}, "kill-switch"), (error) => error.code === "EXPENSIVE_OPERATION_PAUSED");
});

test("proof persistence rejects an evidence record with a nonexistent source reference", async () => {
  const platform = await platformFor(); const item = PRODUCTS[7]; await platform.setConsent(owner, item.id, { status: "granted" }); const fields = { ...item.sample, evidence: `${item.sample.evidence}\nsupport | 0.5 | does-not-exist | 2026-08-01` };
  await assert.rejects(platform.createArtifact(owner, item.id, { fields, evidenceNote: "proof fixture" }, "missing-source"), (error) => error.code === "SOURCE_REFERENCE_NOT_FOUND" && error.details.sourceIds.includes("does-not-exist")); assert.equal(platform.document.artifacts.length, 0);
});

test("privacy-safe traces carry stable operational fields without raw source bodies", async () => {
  const platform = await platformFor(); const item = PRODUCTS[4]; await platform.setConsent(owner, item.id, { status: "granted" }); const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: "TRACE_PRIVATE_MARKER" }, "trace-create"); await platform.runAnalysis(owner, created.artifact.id, {}, "trace-run"); const traces = platform.traceLog(owner, 100);
  assert.ok(traces.length >= 3); for (const trace of traces) for (const field of ["requestId", "correlationId", "tenantHash", "productId", "operation", "durationMs", "resultState", "retryCount", "modelRoute", "modelCostUsd"]) assert.ok(field in trace, field); assert.equal(JSON.stringify(traces).includes("TRACE_PRIVATE_MARKER"), false); assert.ok(traces.every((trace) => trace.rawContentIncluded === false && trace.modelCostUsd === 0));
});

test("shared lifecycle contract reaches every primary product without bypassing domain boundaries", async () => {
  const platform = await platformFor();
  for (const item of PRODUCTS) {
    await platform.setConsent(owner, item.id, { status: "granted" }); const key = item.id; const created = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: `source:${key}` }, `shared-create:${key}`); const repeated = await platform.createArtifact(owner, item.id, { fields: item.sample, evidenceNote: `source:${key}` }, `shared-create:${key}`); assert.equal(repeated.idempotent, true);
    assert.throws(() => platform.artifactFor(outsider, created.artifact.id), (error) => error.code === "ARTIFACT_NOT_FOUND"); const firstField = item.fields[0].id; const updated = await platform.updateArtifact(owner, created.artifact.id, { expectedRevision: 1, fields: { [firstField]: `${item.sample[firstField]} v2` } }, `shared-update:${key}`); assert.equal(updated.artifact.revision, 2); const duplicate = await platform.duplicateArtifact(owner, created.artifact.id, `shared-duplicate:${key}`); await platform.archiveArtifact(owner, duplicate.artifact.id, false); await platform.archiveArtifact(owner, duplicate.artifact.id, true);
    const run = await platform.runAnalysis(owner, created.artifact.id, {}, `shared-analysis:${key}`); assert.ok(run.analysis.output.coreLoop.modules.length >= 6); const changed = await platform.updateArtifact(owner, created.artifact.id, { expectedRevision: 2, fields: { [firstField]: `${item.sample[firstField]} v3` } }, `shared-update-stale:${key}`); assert.equal(platform.repositories().analyses.get(owner.workspaceId, run.analysis.id).status, "stale"); const exported = await platform.exportArtifact(owner, created.artifact.id); assert.equal(exported.artifact.revision, changed.artifact.revision); assert.ok(exported.reviewHistory); const deleted = await platform.deleteArtifact(owner, duplicate.artifact.id, `DELETE ${duplicate.artifact.id}`); assert.equal(deleted.deleted, true); const recovered = await platform.restoreDeletedArtifact(owner, duplicate.artifact.id); assert.equal(recovered.artifact.status, "draft");
  }
  assert.equal(new Set(platform.document.artifacts.map((artifact) => artifact.productId)).size, 10); assert.ok(platform.document.audit.length >= 90); assert.ok(platform.document.metrics.every((metric) => metric.workspaceId));
});
