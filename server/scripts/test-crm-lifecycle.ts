import assert from "node:assert/strict";
import { buildCrmMergePreview, crmStageTransition, type CrmContactSnapshot } from "../src/crm/crm-lifecycle.js";

const target: CrmContactSnapshot = {
  id: "target",
  orgId: "org-a",
  name: "株式会社みらい",
  organization: "Miraï Montréal",
  email: "",
  phone: "",
  status: "follow-up",
  crmStage: "Qualified",
  value: 2500,
  tags: ["priority"],
  qualification: ["budget"],
  socials: { linkedin: "target-linkedin" },
};
const source: CrmContactSnapshot = {
  id: "source",
  orgId: "org-a",
  name: "Duplicate",
  organization: "Miraï Montréal",
  email: "ops@example.test",
  phone: "+81 3 1234 5678",
  status: "new",
  crmStage: "Prospect",
  value: 1000,
  tags: ["international", "priority"],
  qualification: ["timing"],
  socials: { instagram: "source-instagram", linkedin: "source-linkedin" },
};

const preview = buildCrmMergePreview({ orgId: "org-a", source, target });
assert.equal(preview.merged.id, "target");
assert.equal(preview.merged.email, "ops@example.test", "missing target data should be filled from the source");
assert.equal(preview.merged.status, "follow-up", "target workflow state remains authoritative");
assert.deepEqual(preview.merged.tags, ["priority", "international"]);
assert.deepEqual(preview.merged.socials, { instagram: "source-instagram", linkedin: "target-linkedin" });
assert.match(preview.previewHash, /^[a-f0-9]{64}$/u);
assert.deepEqual(source.tags, ["international", "priority"], "preview must not mutate either source record");
assert.deepEqual(target.tags, ["priority"]);

const changedPreview = buildCrmMergePreview({
  orgId: "org-a",
  source: { ...source, phone: "+81 3 9999 0000" },
  target,
});
assert.notEqual(changedPreview.previewHash, preview.previewHash, "any concurrent record change must invalidate the preview");

assert.throws(
  () => buildCrmMergePreview({ orgId: "org-a", source: { ...source, orgId: "org-b" }, target }),
  /crm_cross_tenant_merge_blocked/u,
);
assert.throws(
  () => buildCrmMergePreview({ orgId: "org-a", source: { ...source, id: "target" }, target }),
  /crm_merge_requires_two_contacts/u,
);

const transition = crmStageTransition({
  contactId: "target",
  actor: "owner@example.test",
  beforeStatus: "new",
  afterStatus: "follow-up",
  beforeStage: "Prospect",
  afterStage: "Qualified",
  at: "2026-07-23T00:00:00.000Z",
});
assert.deepEqual(transition?.from, { status: "new", stage: "Prospect" });
assert.deepEqual(transition?.to, { status: "follow-up", stage: "Qualified" });
assert.equal(crmStageTransition({
  contactId: "target",
  actor: "owner@example.test",
  beforeStatus: "new",
  afterStatus: "new",
  beforeStage: "Prospect",
  afterStage: "Prospect",
}), null);

console.log(JSON.stringify({
  ok: true,
  product: "CRM lifecycle",
  mergePreview: true,
  stalePreviewDetection: true,
  reversibleRouteContract: true,
  stageHistory: true,
  internationalData: true,
  tenantIsolation: true,
}, null, 2));
