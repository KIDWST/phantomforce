import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptProposalVersion,
  convertAcceptedProposal,
  createProposalDraft,
  getProposalDocument,
  publicProposalDocument,
  updateProposalDraft,
} from "../src/proposals/proposal-store.js";

const root = await mkdtemp(join(tmpdir(), "phantom-proposals-"));

try {
  const created = await createProposalDraft({
    tenantId: "org-alpha",
    actor: "owner-alpha",
    root,
    proposal: {
      client: "Montréal Café 東京",
      contact: "Operations",
      pkg: "growth",
      price: 19.99,
      currency: "cad",
      status: "sent-ready",
      scope: ["Launch", "Mesure"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  assert.equal(created.result.priceMinor, 1999, "currency values must be stored in minor units");
  assert.equal(created.result.currency, "CAD");
  assert.equal(created.result.versions.length, 1);
  const firstVersion = structuredClone(created.result.versions[0]);

  const revised = await updateProposalDraft({
    tenantId: "org-alpha",
    proposalId: created.result.id,
    actor: "owner-alpha",
    root,
    patch: { scope: ["Launch", "Mesure", "Reporting"], price: 24.5 },
  });
  assert.equal(revised.result.versions.length, 2, "content edits must append an immutable version");
  assert.deepEqual(revised.result.versions[0], firstVersion, "older proposal versions must remain immutable");
  assert.equal(revised.result.priceMinor, 2450);
  const activeVersion = revised.result.versions[1];
  assert.notEqual(activeVersion.payloadHash, firstVersion.payloadHash);

  const statusOnly = await updateProposalDraft({
    tenantId: "org-alpha",
    proposalId: created.result.id,
    actor: "owner-alpha",
    root,
    patch: { status: "sent" },
  });
  assert.equal(statusOnly.result.versions.length, 2, "status changes must not fabricate content versions");

  await assert.rejects(
    acceptProposalVersion({
      tenantId: "org-alpha",
      proposalId: created.result.id,
      versionId: activeVersion.id,
      expectedPayloadHash: "0".repeat(64),
      actor: "client-alpha",
      root,
    }),
    /proposal_payload_changed/u,
    "acceptance must bind to the exact reviewed payload",
  );

  const accepted = await acceptProposalVersion({
    tenantId: "org-alpha",
    proposalId: created.result.id,
    versionId: activeVersion.id,
    expectedPayloadHash: activeVersion.payloadHash,
    actor: "client-alpha",
    root,
  });
  assert.equal(accepted.result.totalMinor, 2450);
  assert.equal(accepted.result.currency, "CAD");
  assert.equal(accepted.result.versionId, activeVersion.id);

  const acceptedAgain = await acceptProposalVersion({
    tenantId: "org-alpha",
    proposalId: created.result.id,
    versionId: activeVersion.id,
    expectedPayloadHash: activeVersion.payloadHash,
    actor: "client-alpha",
    root,
  });
  assert.equal(acceptedAgain.result.id, accepted.result.id, "repeated acceptance must be idempotent");

  const converted = await convertAcceptedProposal({
    tenantId: "org-alpha",
    proposalId: created.result.id,
    idempotencyKey: "invoice-alpha-001",
    actor: "owner-alpha",
    root,
  });
  const convertedAgain = await convertAcceptedProposal({
    tenantId: "org-alpha",
    proposalId: created.result.id,
    idempotencyKey: "invoice-alpha-001",
    actor: "owner-alpha",
    root,
  });
  assert.equal(convertedAgain.result.id, converted.result.id, "downstream conversion must be idempotent");
  assert.equal(converted.document.proposals[0].status, "invoice-ready");

  const expired = await createProposalDraft({
    tenantId: "org-alpha",
    actor: "owner-alpha",
    root,
    proposal: {
      client: "Expired",
      price: 1,
      status: "sent",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  await assert.rejects(
    acceptProposalVersion({
      tenantId: "org-alpha",
      proposalId: expired.result.id,
      versionId: expired.result.activeVersionId,
      expectedPayloadHash: expired.result.versions[0].payloadHash,
      actor: "client-alpha",
      root,
    }),
    /proposal_expired/u,
  );

  const otherTenant = await getProposalDocument("org-beta", "owner-beta", root);
  assert.equal(otherTenant.proposals.length, 0, "proposal records must not cross tenant boundaries");

  const persisted = await getProposalDocument("org-alpha", "owner-alpha", root);
  const publicDocument = publicProposalDocument(persisted);
  assert.equal(publicDocument.schemaVersion, 2);
  assert.equal(publicDocument.proposals.find((proposal) => proposal.id === created.result.id)?.versions.length, 2);

  console.log(JSON.stringify({
    ok: true,
    product: "Proposal lifecycle",
    immutableVersions: true,
    minorUnitMath: true,
    payloadBoundAcceptance: true,
    expirationEnforced: true,
    idempotentAcceptance: true,
    idempotentConversion: true,
    tenantIsolation: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
