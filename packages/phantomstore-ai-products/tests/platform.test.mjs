import test from "node:test";
import assert from "node:assert/strict";
import { AiProductsPlatform, MemoryAdapter, PlatformError } from "../src/platform.mjs";
import { PRODUCTS } from "../src/catalog.mjs";

const owner = { actorId: "ai-demo-owner", workspaceId: "ai-demo-workspace", role: "owner", displayName: "Portfolio Owner" };
const reviewer = { actorId: "ai-demo-reviewer", workspaceId: "ai-demo-workspace", role: "reviewer", displayName: "Evidence Reviewer" };
const outsider = { actorId: "ai-demo-outsider", workspaceId: "ai-outside-workspace", role: "owner", displayName: "Isolation Fixture" };
const fixedNow = () => "2026-08-17T00:00:00.000Z";
const platformFor = async () => { let sequence = 0; return new AiProductsPlatform({ adapter: new MemoryAdapter(), now: fixedNow, id: () => `id-${++sequence}` }).init(); };

test("all ten prescribed primary modules persist a domain artifact, analysis job, and human disposition", async () => {
  const platform = await platformFor();
  for (const product of PRODUCTS) {
    await platform.setConsent(owner, product.id, { status: "granted", retentionDays: 30 });
    const created = await platform.createArtifact(reviewer, product.id, { fields: product.sample, evidenceNote: `Golden evidence for ${product.name}` }, `create:${product.id}`);
    assert.equal(created.artifact.objectType, product.objectType, product.name);
    const run = await platform.runAnalysis(reviewer, created.artifact.id, {}, `run:${product.id}`);
    assert.equal(run.job.status, "awaiting_review", product.name);
    assert.equal(run.job.phase, "awaiting_human_review", product.name);
    assert.equal(run.analysis.output.metrics[0].name, product.metricName, product.name);
    assert.equal(run.analysis.output.metrics[0].unit, product.metricUnit, product.name);
    const reviewed = await platform.reviewAnalysis(reviewer, run.analysis.id, { decision: "accepted" }, `review:${product.id}`);
    assert.equal(reviewed.artifact.status, "published", product.name);
    assert.equal(reviewed.job.status, "succeeded", product.name);
    assert.equal(reviewed.artifact.revision, 1, "analysis never overwrites source fields");
  }
  assert.equal(platform.status().productCount, 10);
  assert.equal(platform.status().analysisCount, 10);
  assert.equal(platform.document.metrics.filter((item) => item.name === "analysis.cost").every((item) => item.value === 0), true);
});

test("identity, roles, tenant boundaries, entitlements, and kill switches fail closed", async () => {
  const platform = await platformFor(); const product = PRODUCTS[0];
  assert.throws(() => platform.sessionForToken("wrong"), (error) => error.code === "AUTH_REQUIRED");
  await assert.rejects(platform.setConsent(reviewer, product.id, { status: "granted" }), (error) => error.code === "ROLE_FORBIDDEN");
  await platform.setConsent(owner, product.id, { status: "granted" });
  const created = await platform.createArtifact(owner, product.id, { fields: product.sample, evidenceNote: "private-evidence-marker" }, "create:closed");
  assert.throws(() => platform.artifactFor(outsider, created.artifact.id), (error) => error.code === "ARTIFACT_NOT_FOUND");
  platform.document.workspaces[owner.workspaceId].flags[product.id].analysisEnabled = false;
  await assert.rejects(platform.runAnalysis(owner, created.artifact.id, {}, "run:paused"), (error) => error.code === "ANALYSIS_PAUSED");
  platform.document.workspaces[owner.workspaceId].flags[product.id].analysisEnabled = true;
  platform.document.workspaces[owner.workspaceId].entitlements[product.id].status = "expired";
  assert.throws(() => platform.artifactFor(owner, created.artifact.id), (error) => error.code === "ENTITLEMENT_REQUIRED");
});

test("validation, idempotency, revisions, and source-change staleness preserve accepted work", async () => {
  const platform = await platformFor(); const product = PRODUCTS[5]; await platform.setConsent(owner, product.id, { status: "granted" });
  await assert.rejects(platform.createArtifact(owner, product.id, { fields: {}, evidenceNote: "evidence" }, "bad"), (error) => error.code === "VALIDATION_FAILED" && error.details.fieldErrors.length >= 4);
  const first = await platform.createArtifact(owner, product.id, { fields: product.sample, evidenceNote: "architecture worksheet" }, "same-key");
  const repeated = await platform.createArtifact(owner, product.id, { fields: product.sample, evidenceNote: "architecture worksheet" }, "same-key");
  assert.equal(repeated.artifact.id, first.artifact.id); assert.equal(repeated.idempotent, true);
  const run = await platform.runAnalysis(owner, first.artifact.id, {}, "analysis-v1");
  await assert.rejects(platform.updateArtifact(owner, first.artifact.id, { expectedRevision: 9, fields: { system: "Wrong revision" } }, "bad-revision"), (error) => error.code === "REVISION_CONFLICT");
  const updated = await platform.updateArtifact(owner, first.artifact.id, { expectedRevision: 1, fields: { system: "Partner document exchange v2" } }, "update-v2");
  assert.equal(updated.artifact.revision, 2); assert.equal(platform.document.analyses.find((item) => item.id === run.analysis.id).status, "stale");
});

test("duplicate, archive, restore, export, delete, recovery, and privacy-safe audit form a reversible lifecycle", async () => {
  const platform = await platformFor(); const product = PRODUCTS[7]; await platform.setConsent(owner, product.id, { status: "granted" });
  const created = await platform.createArtifact(owner, product.id, { fields: product.sample, evidenceNote: "PRIVATE SOURCE TEXT" }, "lifecycle-create");
  const duplicate = await platform.duplicateArtifact(owner, created.artifact.id, "duplicate-key"); assert.notEqual(duplicate.artifact.id, created.artifact.id);
  await platform.archiveArtifact(owner, duplicate.artifact.id, false); assert.throws(() => platform.artifactFor(owner, duplicate.artifact.id), (error) => error.code === "ARTIFACT_ARCHIVED");
  await platform.archiveArtifact(owner, duplicate.artifact.id, true); assert.equal(platform.artifactFor(owner, duplicate.artifact.id).status, "draft");
  const exported = await platform.exportArtifact(owner, created.artifact.id); assert.equal(exported.artifact.id, created.artifact.id); assert.equal(exported.portability.sourceIdsPreserved, true);
  await assert.rejects(platform.deleteArtifact(owner, created.artifact.id, "wrong"), (error) => error.code === "DELETE_CONFIRMATION_REQUIRED");
  await platform.deleteArtifact(owner, created.artifact.id, `DELETE ${created.artifact.id}`); assert.throws(() => platform.artifactFor(owner, created.artifact.id), (error) => error.code === "ARTIFACT_NOT_FOUND");
  const recovered = await platform.restoreDeletedArtifact(owner, created.artifact.id); assert.equal(recovered.artifact.status, "draft");
  assert.equal(JSON.stringify(platform.document.audit).includes("PRIVATE SOURCE TEXT"), false);
  assert.ok(platform.document.audit.every((event) => event.payload.contentIncluded === false));
});

test("consent withdrawal restricts artifacts and stales dependent analysis", async () => {
  const platform = await platformFor(); const product = PRODUCTS[9]; await platform.setConsent(owner, product.id, { status: "granted" });
  const created = await platform.createArtifact(owner, product.id, { fields: product.sample, evidenceNote: "experiment worksheet" }, "causal-create");
  const run = await platform.runAnalysis(owner, created.artifact.id, {}, "causal-run"); await platform.setConsent(owner, product.id, { status: "withdrawn" });
  assert.throws(() => platform.artifactFor(owner, created.artifact.id), (error) => error.code === "CONSENT_WITHDRAWN");
  assert.equal(platform.document.analyses.find((item) => item.id === run.analysis.id).status, "stale");
});
