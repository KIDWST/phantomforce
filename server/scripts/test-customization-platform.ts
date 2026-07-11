import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultOrganizationConfiguration,
  getOrganizationConfiguration,
  planAssistantCustomization,
  previewConfigurationChange,
  publishConfigurationChange,
  resetOrganizationConfiguration,
  rollbackOrganizationConfiguration,
  validateOrganizationConfiguration,
  type CustomizationEntitlements,
} from "../src/customization/customization-service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(path.join(os.tmpdir(), "phantomforce-customization-test-"));
const entitlements: CustomizationEntitlements = {
  coBranded: true,
  whiteLabel: false,
  internalPhantomForce: true,
};

try {
  const defaults = defaultOrganizationConfiguration("phantomforce-owner", "test-owner");
  assert(defaults.modules.every((module) => module.roles.length > 0), "every default module must have at least one valid role");
  assert(validateOrganizationConfiguration(defaults, entitlements).every((issue) => issue.severity !== "error"), "defaults must satisfy platform safeguards");

  const initial = await getOrganizationConfiguration("phantomforce-owner", "test-owner", root);
  assert(initial.configuration.version === 1, "first load must create version 1");

  const validPreview = await previewConfigurationChange({
    tenantId: "phantomforce-owner",
    actor: "test-owner",
    patch: { theme: { primary: "#22cc88" } },
    entitlements,
    root,
  });
  assert(validPreview.valid && validPreview.proposedVersion === 2, "valid preview must be reversible version 2");

  const blockedPreview = await previewConfigurationChange({
    tenantId: "phantomforce-owner",
    actor: "test-owner",
    patch: {
      modules: initial.configuration.modules.map((module) => module.id === "approvals" ? { ...module, enabled: false } : module),
    },
    entitlements,
    root,
  });
  assert(!blockedPreview.valid, "required approval controls must not be disableable");

  const published = await publishConfigurationChange({
    tenantId: "phantomforce-owner",
    actor: "test-owner",
    patch: { theme: { primary: "#22cc88" } },
    summary: "Test theme update",
    expectedVersion: 1,
    entitlements,
    root,
  });
  assert(published.configuration.version === 2, "publish must advance the configuration version");

  const rolledBack = await rollbackOrganizationConfiguration({
    tenantId: "phantomforce-owner",
    actor: "test-owner",
    version: 1,
    entitlements,
    root,
  });
  assert(rolledBack.configuration.version === 3, "rollback must create a new version instead of rewriting history");

  const reset = await resetOrganizationConfiguration({ tenantId: "phantomforce-owner", actor: "test-owner", root });
  assert(reset.configuration.version === 4, "reset must also preserve version history");

  const assistantPlan = planAssistantCustomization("Make the assistant concise and use #33dd99", reset.configuration);
  assert(assistantPlan.understood && assistantPlan.requiresApproval, "assistant planning must remain deterministic and approval-gated");

  console.log("customization platform checks passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
