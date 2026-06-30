import { ACTION_SCHEMAS } from "@phantomforce/contracts";

import { accessRepository } from "./access-repository.js";
import { getBillingProviderStatus } from "./billing-provider.js";
import { checkPangolinReadOnlyStatus } from "./pangolin-status.js";
import { getAccessAuthConfiguration } from "./session.js";
import { getSalesConnectorStatus } from "../connectors/sales-connector.js";

export type ProductionReadinessGate = {
  id: string;
  label: string;
  status: "ready" | "needs_config" | "blocked";
  detail: string;
  evidence: string;
};

export type ProductionReadinessReport = {
  checkedAt: string;
  localDemoReady: boolean;
  productionReady: boolean;
  summary: string;
  gates: ProductionReadinessGate[];
};

function gate(
  id: string,
  label: string,
  status: ProductionReadinessGate["status"],
  detail: string,
  evidence: string,
): ProductionReadinessGate {
  return {
    id,
    label,
    status,
    detail,
    evidence,
  };
}

export async function buildProductionReadinessReport(): Promise<ProductionReadinessReport> {
  const repository = accessRepository.info();
  const auth = getAccessAuthConfiguration();
  const billing = getBillingProviderStatus();
  const salesConnector = getSalesConnectorStatus();
  const pangolinStatus = await checkPangolinReadOnlyStatus();
  const actionTypes = Object.keys(ACTION_SCHEMAS);
  const accessActionContractsReady = [
    "client.access.update",
    "client.module.set",
    "client.provision",
  ].every((actionType) => actionTypes.includes(actionType));

  const gates: ProductionReadinessGate[] = [
    gate(
      "local_access_spine",
      "Local access spine",
      "ready",
      "Signed sessions, client scoping, request-time guards, approval decisions, audit trail, and Pangolin dry-run are wired locally.",
      "Covered by npm run test:access --workspace @phantomforce/server.",
    ),
    gate(
      "access_action_contracts",
      "Access action contracts",
      accessActionContractsReady ? "ready" : "blocked",
      accessActionContractsReady
        ? "Access update, module entitlement, and client provisioning actions are registered."
        : "One or more access action contracts are missing from the shared contract registry.",
      accessActionContractsReady
        ? "ACTION_SCHEMAS includes client.access.update, client.module.set, and client.provision."
        : `ACTION_SCHEMAS currently includes: ${actionTypes.join(", ")}`,
    ),
    gate(
      "audit_content_parity",
      "Audit content and driver parity",
      "ready",
      "Access workflow tests assert audit event actor/action/before-after/source fields and run through both JSON fallback and Prisma/Postgres drivers.",
      "Covered by test:access and test:access:postgres; summaries expose auditContentAssertions and driverParitySuite.",
    ),
    gate(
      "calendar_connector_boundary",
      "Calendar connector boundary",
      "ready",
      "Calendar reads go through a per-workspace local-demo credential reference with no live credentials loaded.",
      "Module payload exposes local-demo-calendar, credentialMode=local_demo, credentialSource=workspace_reference, readOnly=true, live=false.",
    ),
    gate(
      "billing_source_of_truth",
      "Billing source of truth",
      billing.productionReady ? "ready" : "needs_config",
      billing.productionReady
        ? "Billing provider is production-ready."
        : "Billing is still the local manual provider; choose and configure Stripe, invoice, CRM, or another authoritative payment source before live access revocation.",
      `provider=${billing.provider}; sourceOfTruth=${billing.sourceOfTruth}; readOnly=${billing.readOnly}; liveWebhooksAllowed=${billing.liveWebhooksAllowed}; productionReady=${billing.productionReady}`,
    ),
    gate(
      "production_postgres",
      "Production Postgres",
      repository.driver === "prisma-postgres" ? "ready" : "needs_config",
      repository.driver === "prisma-postgres"
        ? "Prisma/Postgres repository mode is enabled and fail-closed."
        : "Local JSON fallback is active; production needs DATABASE_URL and Prisma/Postgres mode.",
      `repositoryDriver=${repository.driver}; prismaWriteMode=${repository.prismaWriteMode}; failClosedOnPrismaError=${repository.failClosedOnPrismaError}`,
    ),
    gate(
      "production_auth",
      "Production auth",
      auth.productionReady ? "ready" : "blocked",
      auth.productionReady
        ? "Production auth is enabled."
        : "Production customer auth is not implemented; demo/prisma-dev session login must not be used for real clients.",
      `authProvider=${auth.authProvider}; sessionSource=${auth.sessionSource}; productionReady=${auth.productionReady}; productionMode=${auth.productionMode}`,
    ),
    gate(
      "pangolin_readonly_verification",
      "Pangolin read-only verification",
      pangolinStatus.configured && pangolinStatus.status === "reachable"
        ? "ready"
        : pangolinStatus.configured
          ? "blocked"
          : "needs_config",
      pangolinStatus.configured
        ? pangolinStatus.reason
        : "PANGOLIN_READONLY_BASE_URL is not configured; live gateway status is unverified.",
      `configured=${pangolinStatus.configured}; status=${pangolinStatus.status}; readOnly=${pangolinStatus.readOnly}; liveChangesAllowed=${pangolinStatus.liveChangesAllowed}`,
    ),
    gate(
      "live_oauth_connectors",
      "Live OAuth connectors",
      process.env.PHANTOMFORCE_LIVE_OAUTH_CONNECTORS === "true" ? "ready" : "needs_config",
      process.env.PHANTOMFORCE_LIVE_OAUTH_CONNECTORS === "true"
        ? "Live connector OAuth has been explicitly enabled."
        : "Calendar is local-demo only; Google OAuth/client credential onboarding still needs implementation before production connector use.",
      `PHANTOMFORCE_LIVE_OAUTH_CONNECTORS=${process.env.PHANTOMFORCE_LIVE_OAUTH_CONNECTORS ?? "unset"}`,
    ),
    gate(
      "deployment_target",
      "Deployment target",
      process.env.PHANTOMFORCE_DEPLOYMENT_TARGET ? "ready" : "needs_config",
      process.env.PHANTOMFORCE_DEPLOYMENT_TARGET
        ? "Deployment target is configured."
        : "No deployment target is configured for a client-facing production app.",
      `PHANTOMFORCE_DEPLOYMENT_TARGET=${process.env.PHANTOMFORCE_DEPLOYMENT_TARGET ?? "unset"}`,
    ),
    gate(
      "sales_connector_onboarding",
      "Sales connector onboarding",
      "needs_config",
      "Sales connector is intentionally planned/disabled: no live CRM/lead provider, no credentials, no external send. Implement a typed connector + approval-gated import and explicitly enable before any live use.",
      `connector=${salesConnector.connector}; status=${salesConnector.status}; enabled=${salesConnector.enabled}; live=${salesConnector.live}; external_send=${salesConnector.external_send}`,
    ),
  ];

  const localDemoReady = gates
    .filter((item) =>
      ["local_access_spine", "access_action_contracts", "audit_content_parity", "calendar_connector_boundary"].includes(item.id),
    )
    .every((item) => item.status === "ready");
  const productionReady = gates.every((item) => item.status === "ready");

  return {
    checkedAt: new Date().toISOString(),
    localDemoReady,
    productionReady,
    summary: productionReady
      ? "Production gates are ready."
      : localDemoReady
        ? "Local buyer demo is verified; production gates still need configuration or implementation."
        : "Local demo gates are incomplete.",
    gates,
  };
}
