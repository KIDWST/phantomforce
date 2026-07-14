import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getOrganizationConfiguration,
  planAssistantCustomization,
  previewConfigurationChange,
  publishConfigurationChange,
  rollbackOrganizationConfiguration,
} from "../src/customization/customization-service.js";

const root = await mkdtemp(join(tmpdir(), "phantomforce-customization-test-"));
const noPremium = { coBranded: false, whiteLabel: false, internalPhantomForce: false };

try {
  const alpha = await getOrganizationConfiguration("alpha-org", "owner-alpha", root);
  const beta = await getOrganizationConfiguration("beta-org", "owner-beta", root);
  assert.equal(alpha.configuration.tenantId, "alpha-org");
  assert.equal(beta.configuration.tenantId, "beta-org");
  assert.notEqual(alpha.configuration, beta.configuration);

  const validPatch = {
    theme: { primary: "#22ee88" },
    modules: alpha.configuration.modules.map((module) => module.id === "crm" ? { ...module, label: "Athletes" } : module),
  };
  const validPreview = await previewConfigurationChange({
    tenantId: "alpha-org",
    actor: "owner-alpha",
    entitlements: noPremium,
    root,
    patch: validPatch,
  });
  assert.equal(validPreview.valid, true);
  assert.equal(validPreview.candidate.theme.primary, "#22ee88");
  assert.equal(validPreview.candidate.modules.find((module) => module.id === "crm")?.label, "Athletes");

  await assert.rejects(() => previewConfigurationChange({ tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root, patch: { theme: { customCss: "body{display:none}" } } }));
  await assert.rejects(() => previewConfigurationChange({ tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root, patch: { theme: { primary: "red" } } }));

  const whiteLabel = await previewConfigurationChange({ tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root, patch: { brand: { mode: "white_label" } } });
  assert.equal(whiteLabel.valid, false);
  assert.match(whiteLabel.issues[0]?.message ?? "", /enterprise/i);

  const disableApproval = await previewConfigurationChange({
    tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root,
    patch: { modules: alpha.configuration.modules.map((module) => module.id === "approvals" ? { ...module, enabled: false } : module) },
  });
  assert.equal(disableApproval.valid, false);
  assert.ok(disableApproval.issues.some((issue) => issue.path === "modules.approvals"));

  const reservedField = await previewConfigurationChange({
    tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root,
    patch: { customObjects: [{ id: "athletes", singularLabel: "Athlete", pluralLabel: "Athletes", icon: "users", rolePermissions: {}, fields: [{ id: "tenant_id", label: "Tenant", type: "short_text", required: false, options: [], readOnly: false }] }] },
  });
  assert.equal(reservedField.valid, false);
  assert.ok(reservedField.issues.some((issue) => /reserved/i.test(issue.message)));

  const unsafeWorkflow = await previewConfigurationChange({
    tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root,
    patch: { workflows: [{ id: "send_followup", name: "Send follow-up", enabled: true, trigger: "manual", actions: [{ type: "connector_action", target: "gmail", requiresApproval: false }] }] },
  });
  assert.equal(unsafeWorkflow.valid, false);

  const published = await publishConfigurationChange({
    tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root,
    patch: validPatch,
    summary: "Sports workspace labels and theme",
    expectedVersion: 1,
  });
  assert.equal(published.configuration.version, 2);
  const betaAfterPublish = await getOrganizationConfiguration("beta-org", "owner-beta", root);
  assert.equal(betaAfterPublish.configuration.version, 1, "Publishing alpha must not change beta.");

  const plan = planAssistantCustomization("Change Clients to Recruits and make the assistant professional.", published.configuration);
  assert.equal(plan.understood, true);
  assert.equal(plan.sourceCodeEdited, false);
  assert.equal(plan.protectedCoreTouched, false);

  const rolledBack = await rollbackOrganizationConfiguration({ tenantId: "alpha-org", actor: "owner-alpha", version: 1, entitlements: noPremium, root });
  assert.equal(rolledBack.configuration.version, 3);
  assert.equal(rolledBack.configuration.modules.find((module) => module.id === "crm")?.label, "Clients");

  // Legacy label repair: a stored config that renamed a module "Client Setup"
  // (published by earlier tooling; lives in data, not code) must come back
  // with the canonical module name at read time.
  const legacyPublish = await publishConfigurationChange({
    tenantId: "alpha-org", actor: "owner-alpha", entitlements: noPremium, root,
    patch: { modules: rolledBack.configuration.modules.map((module) => module.id === "crm" ? { ...module, label: "Client Setup" } : module) },
    summary: "Simulate a legacy client-setup label",
    expectedVersion: 3,
  });
  assert.equal(legacyPublish.configuration.version, 4);
  const repaired = await getOrganizationConfiguration("alpha-org", "owner-alpha", root);
  assert.equal(repaired.configuration.modules.find((module) => module.id === "crm")?.label, "Clients", "Legacy 'Client Setup' labels must be repaired to the canonical module name on read.");

  console.log(JSON.stringify({
    ok: true,
    tests: [
      "tenant isolation", "valid theme and terminology", "unsafe CSS rejection", "invalid color rejection",
      "white-label entitlement", "required module preservation", "reserved field protection",
      "workflow approval enforcement", "version publish", "assistant safe planning", "rollback",
    ],
    finalVersion: rolledBack.configuration.version,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
