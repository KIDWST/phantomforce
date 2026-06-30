import cors from "@fastify/cors";
import {
  ACTION_SCHEMAS,
  ActionSchema,
  FALCON_JOB_SCHEMAS,
  FalconJobSchema,
} from "@phantomforce/contracts";
import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import {
  AccessApprovalDecisionSchema,
  AccessChangeProposalSchema,
  AccessModuleSetProposalBodySchema,
  ClientProvisionProposalSchema,
  decideAccessApproval,
  dryRunClientProvision,
  initializeAccessWorkflowState,
  listAccessActions,
  listAccessApprovals,
  listAccessAuditEvents,
  proposeAccessChange,
  proposeClientProvision,
  proposeModuleSet,
} from "./access/access-workflow.js";
import { accessRepository } from "./access/access-repository.js";
import {
  assertModuleAccess,
  assertWorkspaceAccess,
} from "./access/access-guard.js";
import { initializeAccessIdentityState } from "./access/access-identity-state.js";
import { getWorkspaceModuleView } from "./access/module-handlers.js";
import {
  AUTHORIZATION_HEADER,
  AccessLoginSchema,
  SESSION_HEADER,
  assertAccessAuthConfiguration,
  getAccessAuthConfiguration,
  issueAccessSessionToken,
  listAccessSessions,
  requireAdminAccessSession,
  requireAccessSession,
  requireClientWorkspaceView,
} from "./access/session.js";
import {
  ClientAccessStatusSchema,
  getAccessDecision,
  getClientAccess,
  initializeClientAccessState,
  listClientAccess,
} from "./access/client-access-state.js";
import { listPangolinDryRunPlan } from "./access/pangolin-reconciler.js";
import { checkPangolinReadOnlyStatus } from "./access/pangolin-status.js";
import { buildProductionReadinessReport } from "./access/production-readiness.js";
import { getBillingProviderStatus } from "./access/billing-provider.js";
import { createAccessStorageSnapshot } from "./access/access-storage.js";
import { actionRegistry } from "./approval/action-registry.js";
import { createFalconBroker } from "./falcon/broker.js";
import {
  appendApprovalQueueTransition,
  getApprovalQueueFileStatus,
  getApprovalTransitionFileStatus,
  isForbiddenApprovalTransitionStatus,
  normalizeApprovalQueueLimit,
  parseApprovalTransitionStatus,
  persistApprovalQueuePreview,
  readApprovalQueueWithTransitions,
  redactApprovalRequestPreview,
} from "./phantom-ai/approval-queue.js";
import {
  getHermesLedgerStatus,
  readRedactedHermesLedgerRecords,
  redactHermesLedgerRecord,
  redactSensitiveText,
} from "./phantom-ai/hermes-ledger.js";
import {
  normalizeHermesLiveReceiptStoreLimit,
  persistHermesLiveReceiptPreview,
  readHermesLiveReceiptStoreRecords,
} from "./phantom-ai/hermes-live-receipt-store.js";
import { buildHermesLiveCallReceiptContract } from "./phantom-ai/hermes-live-receipts.js";
import { buildHermesInteractionMemoryPreview } from "./phantom-ai/hermes-interaction-memory.js";
import {
  getHermesInteractionMemoryStoreStatus,
  normalizeHermesInteractionMemoryStoreLimit,
  persistHermesInteractionMemoryPreview,
  readHermesInteractionMemoryStoreRecords,
} from "./phantom-ai/hermes-interaction-memory-store.js";
import { buildHermesMemoryContextPreview } from "./phantom-ai/hermes-memory-context.js";
import { buildLiveSmokePreflightReport } from "./phantom-ai/live-smoke-preflight.js";
import {
  getProviderSetupStatus,
  previewModelRouterFoundation,
  runModelRouterFoundation,
} from "./phantom-ai/model-router.js";
import { evaluateProviderLiveReceiptLedgerContract } from "./phantom-ai/provider-live-receipt-ledger-contract.js";
import {
  evaluateProviderBudgetPolicy,
  getProviderBudgetPolicyStatus,
} from "./phantom-ai/provider-policy.js";
import {
  evaluateProviderBudgetHardGate,
  evaluateProviderBudgetHardGateFromPolicy,
} from "./phantom-ai/provider-budget-hard-gate.js";
import {
  buildProviderBudgetApprovalRecordContract,
  buildProviderFundingRecordContract,
  evaluateProviderFundingApprovalContract,
} from "./phantom-ai/provider-funding-approval-contract.js";
import { getProviderReadinessReport } from "./phantom-ai/provider-readiness.js";
import type {
  ActorRole,
  ApprovalQueueTransitionStatus,
  ApprovalQueueWriteResult,
  ContextModuleData,
  ProviderLiveReceiptLedgerOperation,
  SensitivityLevel,
} from "./phantom-ai/types.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5190);

const app = Fastify({
  logger: process.env.PHANTOMFORCE_SERVER_LOGGER === "false" ? false : true,
});

await app.register(cors, {
  origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/],
  credentials: true,
  allowedHeaders: ["Content-Type", AUTHORIZATION_HEADER, SESSION_HEADER],
});

const falconBroker = createFalconBroker({
  baseUrl: process.env.FALCON_BASE_URL ?? "http://127.0.0.1:8765",
});

try {
  assertAccessAuthConfiguration();
  await initializeClientAccessState();
  await initializeAccessIdentityState();
  await initializeAccessWorkflowState();
} catch (error) {
  app.log.error(error, "PhantomForce server startup failed while loading access state.");
  await app.close();
  process.exit(1);
}

app.get("/health", async () => {
  return {
    ok: true,
    service: "phantomforce-server",
    contracts: {
      actions: Object.keys(ACTION_SCHEMAS),
      falconJobs: Object.keys(FALCON_JOB_SCHEMAS),
    },
  };
});

app.get("/contracts/actions", async () => {
  return {
    actionTypes: Object.keys(ACTION_SCHEMAS),
    falconJobTypes: Object.keys(FALCON_JOB_SCHEMAS),
  };
});

app.get("/sessions", async () => {
  const authConfiguration = getAccessAuthConfiguration();

  return {
    ok: true,
    auth: {
      ...authConfiguration,
    },
    sessions: listAccessSessions(),
  };
});

async function handleSessionLogin(request: FastifyRequest, reply: FastifyReply) {
  const authConfiguration = getAccessAuthConfiguration();

  if (!authConfiguration.sessionLoginEnabled) {
    return reply.code(403).send({
      ok: false,
      error: "Session login is disabled.",
      auth: authConfiguration,
    });
  }

  const parsed = AccessLoginSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const token = issueAccessSessionToken(parsed.data.sessionId, {
    ownerKey: parsed.data.ownerKey,
  });

  if (!token) {
    return reply.code(401).send({
      ok: false,
      error: "Invalid session credentials.",
      sessions: listAccessSessions(),
    });
  }

  return {
    ok: true,
    ...token,
  };
}

app.post("/auth/session-login", async (request, reply) => {
  return handleSessionLogin(request, reply);
});

app.post("/auth/owner-login", async (request, reply) => {
  return handleSessionLogin(request, reply);
});

app.post("/auth/demo-login", async (request, reply) => {
  const authConfiguration = getAccessAuthConfiguration();

  if (!authConfiguration.demoAuthEnabled) {
    return reply.code(403).send({
      ok: false,
      error: "Demo auth is disabled.",
      auth: authConfiguration,
    });
  }

  return handleSessionLogin(request, reply);
});

app.get("/session", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
  };
});

app.get("/readiness", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    report: await buildProductionReadinessReport(),
  };
});

app.get("/billing/status/read-only", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    status: getBillingProviderStatus(),
  };
});

function parseHermesRecordLimit(value: string | undefined) {
  const parsedLimit = Number(value ?? 25);
  return Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 25;
}

function parseSensitivityLevel(value: unknown): SensitivityLevel {
  return value === "medium" || value === "high" ? value : "low";
}

function parseLiveReceiptLedgerOperation(value: unknown): ProviderLiveReceiptLedgerOperation {
  if (
    value === "future_transport_attempt" ||
    value === "future_provider_result" ||
    value === "production_ledger_write"
  ) {
    return value;
  }

  return "preflight_preview";
}

function parseNonNegativeNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseNullableNonNegativeNumber(value: unknown, fallback: number | null) {
  if (value === null || value === "missing") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseContextModuleData(value: unknown): ContextModuleData[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 8).flatMap((module) => {
    if (!module || typeof module !== "object") return [];
    const source = module as {
      module?: unknown;
      summary?: unknown;
      items?: unknown;
    };

    if (typeof source.module !== "string" || typeof source.summary !== "string") return [];

    return [
      {
        module: source.module.slice(0, 80),
        summary: source.summary.slice(0, 320),
        items: Array.isArray(source.items)
          ? source.items.slice(0, 5).flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const itemSource = item as { title?: unknown; status?: unknown; detail?: unknown };

              if (typeof itemSource.title !== "string") return [];

              return [
                {
                  title: itemSource.title.slice(0, 120),
                  status: typeof itemSource.status === "string" ? itemSource.status.slice(0, 60) : undefined,
                  detail: typeof itemSource.detail === "string" ? itemSource.detail.slice(0, 220) : undefined,
                },
              ];
            })
          : [],
      },
    ];
  });
}

function buildModelRouterRequestFromBody(
  body: {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  },
  session: { id: string; canManageAccess: boolean },
  requestIdPrefix: string,
) {
  const actorRole: ActorRole = session.canManageAccess ? "platform_admin" : "business_owner";

  return {
    tenant_id: typeof body.tenant_id === "string" ? body.tenant_id.slice(0, 80) : "demo-trainer",
    business_name:
      typeof body.business_name === "string" ? body.business_name.slice(0, 120) : "West Loop Strength Lab",
    actor_user_id: typeof body.actor_user_id === "string" ? body.actor_user_id.slice(0, 80) : session.id,
    actor_role: actorRole,
    request_id:
      typeof body.request_id === "string" ? body.request_id.slice(0, 120) : `${requestIdPrefix}-${Date.now()}`,
    task_type: typeof body.task_type === "string" ? body.task_type.slice(0, 120) : "summary",
    sensitivity_level: parseSensitivityLevel(body.sensitivity_level),
    user_request:
      typeof body.user_request === "string"
        ? body.user_request.slice(0, 1600)
        : "Summarize local demo workspace state without executing external actions.",
    business_summary:
      typeof body.business_summary === "string"
        ? body.business_summary.slice(0, 900)
        : "Owner-only personal training demo workspace. External actions approval-only.",
    module_data: parseContextModuleData(body.module_data),
  };
}

app.get("/phantom-ai/provider-status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const providerStatus = getProviderSetupStatus();
  const ledgerStatus = await getHermesLedgerStatus();

  return {
    ok: true,
    session,
    status: {
      ...providerStatus,
      hermes: {
        ...providerStatus.hermes,
        ledger_path: ledgerStatus.ledgerPath,
        ledger_exists: ledgerStatus.exists,
        ledger_bytes: ledgerStatus.bytes,
      },
    },
  };
});

app.get("/phantom-ai/provider-policy/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const policy = getProviderBudgetPolicyStatus();
  const preview = evaluateProviderBudgetPolicy({
    route_candidate: "mock",
    sensitivity_level: "low",
    action_classification: "safe",
    estimated_tokens: 0,
    estimated_cost_usd: 0,
    approval_required: false,
    provider_enabled: true,
  });
  const hardBudgetGate = evaluateProviderBudgetHardGateFromPolicy({
    tenant_id: "demo-trainer",
    business_name: "West Loop Strength Lab",
    provider_id: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    estimated_tokens: 0,
    estimated_cost_usd: null,
    approval_status: "pending",
    policy_result: preview,
  });

  return {
    ok: true,
    session,
    policy,
    preview,
    hard_budget_gate: hardBudgetGate,
    execution_disabled: true,
    live_provider_called: false,
    approval_execution_implemented: false,
    secrets_stored: false,
  };
});

app.post("/phantom-ai/provider-budget/hard-gate/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const result = previewModelRouterFoundation(
    buildModelRouterRequestFromBody(body, session, "provider-budget-hard-gate-preview"),
  );

  return {
    ok: true,
    session,
    dry_run: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    ready_for_send: false,
    hard_budget_gate: result.provider_invocation.budget_hard_gate,
    provider_invocation: result.provider_invocation,
    provider_policy: result.provider_policy,
  };
});

app.post("/phantom-ai/provider-funding/approval-contract/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    funding_record_present?: unknown;
    funding_state?: unknown;
    funding_cap_usd?: unknown;
    current_daily_spend_usd?: unknown;
    current_monthly_spend_usd?: unknown;
    approval_record_present?: unknown;
    approval_state?: unknown;
    approval_cap_usd?: unknown;
    approved_by?: unknown;
    approved_at?: unknown;
    estimated_tokens?: unknown;
    estimated_cost_usd?: unknown;
  };
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.slice(0, 80) : "demo-trainer";
  const businessName =
    typeof body.business_name === "string" ? body.business_name.slice(0, 120) : "West Loop Strength Lab";
  const providerId = "openrouter_glm";
  const modelId = "z-ai/glm-5.2";
  const policy = getProviderBudgetPolicyStatus();
  const fundingState = body.funding_state === "funded" ? "funded" : "unfunded";
  const approvalState = body.approval_state === "approved" ? "approved" : "not_approved";
  const fundingRecord =
    body.funding_record_present === true
      ? buildProviderFundingRecordContract({
          tenant_id: tenantId,
          provider_id: providerId,
          model_id: modelId,
          funding_state: fundingState,
          funded_budget_cap_usd: parseNullableNonNegativeNumber(body.funding_cap_usd, 0),
          current_daily_spend_usd: parseNonNegativeNumber(body.current_daily_spend_usd, 0),
          current_monthly_spend_usd: parseNonNegativeNumber(body.current_monthly_spend_usd, 0),
        })
      : null;
  const approvalRecord =
    body.approval_record_present === true
      ? buildProviderBudgetApprovalRecordContract({
          tenant_id: tenantId,
          provider_id: providerId,
          model_id: modelId,
          approval_state: approvalState,
          approved_budget_cap_usd: parseNullableNonNegativeNumber(body.approval_cap_usd, 0),
          approved_by: typeof body.approved_by === "string" ? body.approved_by.slice(0, 80) : session.id,
          approved_at: typeof body.approved_at === "string" ? body.approved_at.slice(0, 80) : null,
        })
      : null;
  const estimatedTokens = parseNonNegativeNumber(body.estimated_tokens, 1200);
  const estimatedCostUsd = parseNullableNonNegativeNumber(body.estimated_cost_usd, null);
  const fundingApprovalContract = evaluateProviderFundingApprovalContract({
    tenant_id: tenantId,
    business_name: businessName,
    provider_id: providerId,
    model_id: modelId,
    estimated_tokens: estimatedTokens,
    estimated_cost_usd: estimatedCostUsd,
    budget_caps: policy.budget_guard.caps,
    funding_record: fundingRecord,
    approval_record: approvalRecord,
  });
  const hardBudgetGate = evaluateProviderBudgetHardGate({
    tenant_id: tenantId,
    business_name: businessName,
    provider_id: providerId,
    model_id: modelId,
    estimated_tokens: estimatedTokens,
    estimated_cost_usd: estimatedCostUsd,
    current_daily_spend_usd: fundingRecord?.current_daily_spend_usd,
    current_monthly_spend_usd: fundingRecord?.current_monthly_spend_usd,
    budget_caps: policy.budget_guard.caps,
    payment_status: fundingState === "funded" && fundingRecord ? "paid" : "unpaid",
    budget_approved: approvalState === "approved" && Boolean(approvalRecord),
    approval_status: approvalState === "approved" ? "approved" : "pending",
  });

  return {
    ok: true,
    session,
    dry_run: true,
    contract_only: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    payment_collected: false,
    production_ledger_written: false,
    ready_for_send: false,
    funding_approval_contract: fundingApprovalContract,
    hard_budget_gate: hardBudgetGate,
  };
});

async function handleProviderReadinessStatus(request: FastifyRequest, reply: FastifyReply) {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    readiness: getProviderReadinessReport(),
    live_provider_called: false,
    execution_disabled: true,
    secrets_stored: false,
  };
}

app.get("/phantom-ai/provider-readiness/status", async (request, reply) => {
  return handleProviderReadinessStatus(request, reply);
});

app.get("/phantom-ai/provider-readiness", async (request, reply) => {
  return handleProviderReadinessStatus(request, reply);
});

app.post("/phantom-ai/provider-invocation/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const result = previewModelRouterFoundation(
    buildModelRouterRequestFromBody(body, session, "provider-invocation-preview"),
  );

  return {
    ok: true,
    session,
    dry_run: true,
    ledger_written: false,
    queue_written: false,
    live_provider_called: false,
    approval_execution_implemented: false,
    provider_invocation: result.provider_invocation,
    provider_policy: result.provider_policy,
    provider_readiness: result.provider_invocation.readiness_result,
    action_preview: {
      ...result.action_preview,
      reasons: result.action_preview.reasons.map((reason) => redactSensitiveText(reason)),
      next_action: redactSensitiveText(result.action_preview.next_action),
    },
    approval_requirement: result.provider_invocation.approval_requirement,
    context: {
      context_chars: result.context_packet.context_chars,
      estimated_tokens: result.context_packet.estimated_tokens,
      raw_context_chars: result.context_packet.raw_context_chars,
      compression_ratio: result.context_packet.compression_ratio,
    },
  };
});

app.post("/phantom-ai/live-smoke/preflight", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const result = previewModelRouterFoundation(
    buildModelRouterRequestFromBody(body, session, "live-smoke-preflight"),
  );
  const preflight = await buildLiveSmokePreflightReport(result);

  return {
    ok: true,
    session,
    dry_run: true,
    live_smoke_allowed: false,
    execution_disabled: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    approval_execution_implemented: false,
    preflight,
  };
});

app.post("/phantom-ai/hermes-live-receipts/contract", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const result = previewModelRouterFoundation(
    buildModelRouterRequestFromBody(body, session, "hermes-live-receipt-contract"),
  );
  const preflight = await buildLiveSmokePreflightReport(result);
  const receipt_contract = buildHermesLiveCallReceiptContract({
    preview: result,
    preflight,
  });

  return {
    ok: true,
    session,
    dry_run: true,
    contract_only: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    ready_for_send: false,
    approval_execution_implemented: false,
    receipt_contract,
  };
});

app.post("/phantom-ai/provider-live-receipts/ledger-contract", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
    requested_operation?: unknown;
    production_ledger_write_requested?: unknown;
  };
  const result = previewModelRouterFoundation(
    buildModelRouterRequestFromBody(body, session, "provider-live-receipt-ledger-contract"),
  );
  const preflight = await buildLiveSmokePreflightReport(result);
  const receipt_contract = buildHermesLiveCallReceiptContract({
    preview: result,
    preflight,
  });
  const ledger_contract = evaluateProviderLiveReceiptLedgerContract({
    tenant_id: result.context_packet.tenant_id,
    business_name: result.context_packet.business_name,
    provider_route: result.decision.provider_route,
    model_id: result.decision.model_id,
    requested_operation: parseLiveReceiptLedgerOperation(body.requested_operation),
    readiness_passed: false,
    budget_passed: false,
    funding_approval_contract: result.provider_invocation.budget_hard_gate.funding_approval_contract,
    approval_snapshot: result.approval_request,
    estimated_cost_usd: result.decision.estimated_cost_usd,
    redaction: receipt_contract.redaction,
    receipt_contract,
    transport_proof: null,
    production_ledger_write_requested: body.production_ledger_write_requested === true,
  });

  return {
    ok: true,
    session,
    dry_run: true,
    contract_only: true,
    provider_called: false,
    network_call_performed: false,
    provider_transport_allowed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    ledger_written: false,
    production_ledger_written: false,
    queue_written: false,
    approval_executed: false,
    payment_collected: false,
    receipt_contract,
    ledger_contract,
  };
});

app.post("/phantom-ai/hermes-live-receipts/persist-preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const result = previewModelRouterFoundation(
    buildModelRouterRequestFromBody(body, session, "hermes-live-receipt-persist-preview"),
  );
  const preflight = await buildLiveSmokePreflightReport(result);
  const receipt_contract = buildHermesLiveCallReceiptContract({
    preview: result,
    preflight,
  });
  const persistence = await persistHermesLiveReceiptPreview(receipt_contract);

  return {
    ok: true,
    session,
    dry_run: true,
    local_dev_only: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    ready_for_send: false,
    external_ledger_written: false,
    production_ledger_written: false,
    production_write_allowed: false,
    receipt_contract,
    persistence,
  };
});

app.get("/phantom-ai/hermes-live-receipts/history", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string };
  const history = await readHermesLiveReceiptStoreRecords({
    limit: normalizeHermesLiveReceiptStoreLimit(query.limit),
  });

  return {
    ok: true,
    session,
    local_dev_only: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    ready_for_send: false,
    history,
  };
});

app.get("/phantom-ai/hermes-ledger/history", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const limit = parseHermesRecordLimit(query?.limit);
  const ledgerStatus = await getHermesLedgerStatus();

  return {
    ok: true,
    session,
    limit,
    ledger: {
      path: ledgerStatus.ledgerPath,
      exists: ledgerStatus.exists,
      bytes: ledgerStatus.bytes,
    },
    records: await readRedactedHermesLedgerRecords({ limit }),
  };
});

app.get("/phantom-ai/hermes-ledger/tail", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const limit = parseHermesRecordLimit(query?.limit);

  return {
    ok: true,
    session,
    records: await readRedactedHermesLedgerRecords({ limit }),
  };
});

app.get("/phantom-ai/approvals/queue", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const limit = normalizeApprovalQueueLimit(query?.limit);
  const queueStatus = await getApprovalQueueFileStatus();
  const transitionStatus = await getApprovalTransitionFileStatus();
  const queue = await readApprovalQueueWithTransitions({ limit });

  return {
    ok: true,
    session,
    limit,
    queue: {
      path: queueStatus.queuePath,
      exists: queueStatus.exists,
      bytes: queueStatus.bytes,
      transitions_path: transitionStatus.transitionsPath,
      transitions_exists: transitionStatus.exists,
      transitions_bytes: transitionStatus.bytes,
      malformed_lines: queue.malformed_lines,
      transition_malformed_lines: queue.transition_malformed_lines,
      pending_count: queue.records.filter((record) => record.queue_status === "pending").length,
      blocked_preview_count: queue.records.filter((record) => record.queue_status === "blocked_preview").length,
      preview_only_count: queue.records.filter((record) => record.queue_status === "preview_only").length,
      reviewed_count: queue.records.filter((record) => record.latest_review_status === "reviewed").length,
      dismissed_count: queue.records.filter((record) => record.latest_review_status === "dismissed").length,
      needs_changes_count: queue.records.filter((record) => record.latest_review_status === "needs_changes").length,
      expired_count: queue.records.filter((record) => record.latest_review_status === "expired").length,
    },
    records: queue.records,
  };
});

app.post("/phantom-ai/approvals/queue/:queueId/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { queueId?: string };
  const body = (request.body ?? {}) as {
    status?: unknown;
    note?: unknown;
  };
  const queueId = typeof params.queueId === "string" ? params.queueId.slice(0, 120) : "";

  if (!queueId) {
    return reply.code(400).send({
      ok: false,
      error: "Missing approval queue id.",
    });
  }

  if (isForbiddenApprovalTransitionStatus(body.status)) {
    return reply.code(400).send({
      ok: false,
      error: "Execution-capable approval statuses are not allowed.",
      allowed_statuses: ["reviewed", "dismissed", "needs_changes", "expired"] satisfies ApprovalQueueTransitionStatus[],
    });
  }

  const toStatus = parseApprovalTransitionStatus(body.status);

  if (!toStatus) {
    return reply.code(400).send({
      ok: false,
      error: "Invalid approval queue review status.",
      allowed_statuses: ["reviewed", "dismissed", "needs_changes", "expired"] satisfies ApprovalQueueTransitionStatus[],
    });
  }

  const transition = await appendApprovalQueueTransition({
    queueId,
    toStatus,
    requestedBy: {
      actor_user_id: session.id,
      actor_role: "platform_admin",
    },
    note: typeof body.note === "string" ? body.note.slice(0, 800) : "",
  });

  if (!transition) {
    return reply.code(404).send({
      ok: false,
      error: "Approval queue record was not found in the local bounded queue window.",
    });
  }

  return {
    ok: true,
    session,
    transition,
    execution_disabled: true,
    approval_execution_implemented: false,
    live_provider_called: false,
    ledger_written: false,
  };
});

function buildHermesInteractionMemoryPreviewFromBody(
  body: {
    tenant_id?: unknown;
    actor_user_id?: unknown;
    task_id?: unknown;
    interaction_type?: unknown;
    summary?: unknown;
    metadata?: unknown;
  },
  session: { id: string },
) {
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, string | number | boolean | null>)
      : undefined;

  return buildHermesInteractionMemoryPreview({
    tenant_id: typeof body.tenant_id === "string" ? body.tenant_id : session.id,
    actor_user_id: typeof body.actor_user_id === "string" ? body.actor_user_id : session.id,
    task_id: typeof body.task_id === "string" ? body.task_id : null,
    interaction_type: typeof body.interaction_type === "string" ? body.interaction_type : "phantom_ai_activity",
    summary: typeof body.summary === "string" ? body.summary : "",
    metadata,
  });
}

app.post("/phantom-ai/hermes/interaction-memory/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    actor_user_id?: unknown;
    task_id?: unknown;
    interaction_type?: unknown;
    summary?: unknown;
    metadata?: unknown;
  };
  const memory_preview = buildHermesInteractionMemoryPreviewFromBody(body, session);

  return {
    ok: true,
    session,
    dry_run: true,
    ledger_write_preview_only: true,
    provider_request_body_created: false,
    provider_called: false,
    network_call_performed: false,
    queue_written: false,
    approval_executed: false,
    production_ledger_write: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    provider_transport_allowed: false,
    memory_preview,
  };
});

app.post("/phantom-ai/hermes/interaction-memory/persist-preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    actor_user_id?: unknown;
    task_id?: unknown;
    interaction_type?: unknown;
    summary?: unknown;
    metadata?: unknown;
  };
  const memory_preview = buildHermesInteractionMemoryPreviewFromBody(body, session);
  const persistence = await persistHermesInteractionMemoryPreview(memory_preview);

  return {
    ok: true,
    session,
    local_dev_only: true,
    memory_preview,
    persistence,
    provider_request_body_created: false,
    provider_called: false,
    network_call_performed: false,
    hermes_ledger_written: false,
    external_ledger_written: false,
    production_ledger_written: false,
    production_write_allowed: false,
    queue_written: false,
    approval_executed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    provider_transport_allowed: false,
  };
});

app.get("/phantom-ai/hermes/interaction-memory/history", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as {
    limit?: string;
    tenant_id?: string;
    actor_user_id?: string;
    task_id?: string;
    interaction_type?: string;
  } | undefined;
  const limit = normalizeHermesInteractionMemoryStoreLimit(query?.limit);
  const status = await getHermesInteractionMemoryStoreStatus();
  const history = await readHermesInteractionMemoryStoreRecords({
    limit,
    tenantId: query?.tenant_id,
    actorUserId: query?.actor_user_id,
    taskId: query?.task_id,
    interactionType: query?.interaction_type,
  });

  return {
    ok: true,
    session,
    store: {
      path: status.store_path,
      exists: status.exists,
      bytes: status.bytes,
      local_dev_only: status.local_dev_only,
      production_write_allowed: status.production_write_allowed,
      malformed_lines: history.malformed_lines,
      returned_count: history.records.length,
      limit: history.limit,
    },
    records: history.records,
    provider_request_body_created: false,
    provider_called: false,
    network_call_performed: false,
    hermes_ledger_written: false,
    external_ledger_written: false,
    production_ledger_written: false,
    production_write_allowed: false,
    queue_written: false,
    approval_executed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    provider_transport_allowed: false,
  };
});

app.post("/phantom-ai/hermes/memory-context/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const normalized = buildModelRouterRequestFromBody(body, session, "hermes-memory-context");
  const memory_context = await buildHermesMemoryContextPreview({
    tenant_id: normalized.tenant_id,
    business_name: normalized.business_name,
    actor_user_id: normalized.actor_user_id,
    request_id: normalized.request_id,
    task_type: normalized.task_type,
    sensitivity_level: normalized.sensitivity_level,
    user_request: normalized.user_request,
    business_summary: normalized.business_summary,
    module_data: normalized.module_data,
  });

  return {
    ok: true,
    session,
    dry_run: true,
    provider_request_body_created: false,
    provider_transport_allowed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    production_ledger_write: false,
    memory_context,
  };
});

app.post("/phantom-ai/context-preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const normalized = buildModelRouterRequestFromBody(body, session, "preview");
  const result = previewModelRouterFoundation(normalized);
  const memoryContext = await buildHermesMemoryContextPreview({
    tenant_id: normalized.tenant_id,
    business_name: normalized.business_name,
    actor_user_id: normalized.actor_user_id,
    request_id: normalized.request_id,
    task_type: normalized.task_type,
    sensitivity_level: result.decision.sensitivity_level,
    provider_route: result.decision.provider_route,
    user_request: normalized.user_request,
    business_summary: normalized.business_summary,
    module_data: normalized.module_data,
  });

  return {
    ok: true,
    session,
    dry_run: result.dry_run,
    ledger_written: result.ledger_written,
    live_provider_called: result.live_provider_called,
    decision: {
      ...result.decision,
      risks: result.decision.risks.map((risk) => redactSensitiveText(risk)),
      next_action: redactSensitiveText(result.decision.next_action),
    },
    action_preview: {
      ...result.action_preview,
      reasons: result.action_preview.reasons.map((reason) => redactSensitiveText(reason)),
      next_action: redactSensitiveText(result.action_preview.next_action),
    },
    approval_request: redactApprovalRequestPreview(result.approval_request),
    provider_policy: result.provider_policy,
    provider_readiness: result.provider_invocation.readiness_result,
    provider_invocation: result.provider_invocation,
    memory_context: memoryContext,
    context: {
      compact_context: redactSensitiveText(memoryContext.augmented_context_preview),
      base_compact_context: redactSensitiveText(result.context_packet.compact_context),
      user_request_summary: redactSensitiveText(result.context_packet.user_request_summary),
      context_chars: memoryContext.augmented_context_chars,
      estimated_tokens: Math.ceil(memoryContext.augmented_context_chars / 4),
      base_context_chars: result.context_packet.context_chars,
      base_estimated_tokens: result.context_packet.estimated_tokens,
      raw_context_chars: result.context_packet.raw_context_chars,
      compression_ratio: result.context_packet.compression_ratio,
      hermes_memory_recalled: memoryContext.memory.recalled_count,
      provider_request_body_created: false,
      live_call_allowed: false,
      execution_disabled: true,
      ready_for_send: false,
    },
  };
});

app.post("/phantom-ai/approvals/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
    queue_approval?: unknown;
    queue_preview_only?: unknown;
  };
  const result = previewModelRouterFoundation(buildModelRouterRequestFromBody(body, session, "approval-preview"));
  const queueRequested = body.queue_approval === true;
  const queueWrite: ApprovalQueueWriteResult = queueRequested
    ? await persistApprovalQueuePreview(result.approval_request, {
        allowPreviewOnly: body.queue_preview_only === true,
      })
    : {
        queued: false,
        reason: "queue_not_requested",
        record: null,
      };

  return {
    ok: true,
    session,
    dry_run: result.dry_run,
    ledger_written: result.ledger_written,
    live_provider_called: result.live_provider_called,
    approval_execution_implemented: false,
    decision: {
      ...result.decision,
      risks: result.decision.risks.map((risk) => redactSensitiveText(risk)),
      next_action: redactSensitiveText(result.decision.next_action),
    },
    action_preview: {
      ...result.action_preview,
      reasons: result.action_preview.reasons.map((reason) => redactSensitiveText(reason)),
      next_action: redactSensitiveText(result.action_preview.next_action),
    },
    approval_request: redactApprovalRequestPreview(result.approval_request),
    provider_policy: result.provider_policy,
    provider_readiness: result.provider_invocation.readiness_result,
    provider_invocation: result.provider_invocation,
    queue_write: {
      ...queueWrite,
      record: queueWrite.record,
    },
    context: {
      context_chars: result.context_packet.context_chars,
      estimated_tokens: result.context_packet.estimated_tokens,
      raw_context_chars: result.context_packet.raw_context_chars,
      compression_ratio: result.context_packet.compression_ratio,
    },
  };
});

app.post("/phantom-ai/mock-route", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const result = await runModelRouterFoundation(buildModelRouterRequestFromBody(body, session, "mock"));

  return {
    ok: true,
    session,
    decision: result.decision,
    context: {
      context_chars: result.context_packet.context_chars,
      estimated_tokens: result.context_packet.estimated_tokens,
      raw_context_chars: result.context_packet.raw_context_chars,
      compression_ratio: result.context_packet.compression_ratio,
    },
    ledger_record: redactHermesLedgerRecord(result.ledger_record),
    approval_request: redactApprovalRequestPreview(result.approval_request),
    provider_policy: result.provider_policy,
    provider_readiness: result.provider_invocation.readiness_result,
    provider_invocation: result.provider_invocation,
  };
});

app.get("/client-access", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const records = session.canManageAccess
    ? listClientAccess()
    : listClientAccess().filter((record) => record.id === session.clientId);

  return {
    ok: true,
    session,
    records,
  };
});

app.get("/client-access/:id/decision", async (request, reply) => {
  const params = request.params as { id: string };
  const session = requireClientWorkspaceView(request, reply, params.id);

  if (!session) {
    return reply;
  }

  const record = getClientAccess(params.id);

  if (!record) {
    return reply.code(404).send({
      ok: false,
      error: "Client access record not found.",
    });
  }

  return {
    ok: true,
    session,
    record,
    decision: getAccessDecision(params.id),
  };
});

app.get("/client-workspaces/:id", async (request, reply) => {
  const params = request.params as { id: string };
  const session = requireClientWorkspaceView(request, reply, params.id);

  if (!session) {
    return reply;
  }

  const access = assertWorkspaceAccess(params.id);

  if (!access.ok) {
    return reply.code(access.statusCode).send({
      ok: false,
      error: access.error,
      record: access.record,
      decision: access.decision,
    });
  }

  return {
    ok: true,
    session,
    workspace: {
      id: access.record.id,
      business: access.record.business,
      owner: access.record.owner,
      plan: access.record.plan,
      privateRoute: access.record.privateRoute,
      gateway: access.record.gateway,
      accessStatus: access.record.accessStatus,
      paymentStatus: access.record.paymentStatus,
      mode: access.decision.mode,
      modules: access.decision.modules,
    },
    decision: access.decision,
  };
});

app.get("/client-workspaces/:id/modules/:moduleKey", async (request, reply) => {
  const params = request.params as { id: string; moduleKey: string };
  const session = requireClientWorkspaceView(request, reply, params.id);

  if (!session) {
    return reply;
  }

  const access = assertModuleAccess(params.id, params.moduleKey);

  if (!access.ok) {
    return reply.code(access.statusCode).send({
      ok: false,
      error: access.error,
      record: access.record,
      decision: access.decision,
    });
  }

  return {
    ok: true,
    session,
    module: access.module,
    mode: access.decision.mode,
    moduleView: await getWorkspaceModuleView(access.record, access.decision, access.module),
    workspace: {
      id: access.record.id,
      business: access.record.business,
      accessStatus: access.record.accessStatus,
      paymentStatus: access.record.paymentStatus,
    },
  };
});

app.post("/client-access/:id/status/propose", async (request, reply) => {
  const params = request.params as { id: string };
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AccessChangeProposalSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
      allowedStatuses: ClientAccessStatusSchema.options,
    });
  }

  const result = await proposeAccessChange(
    params.id,
    parsed.data.accessStatus,
    parsed.data.reason,
    parsed.data.proposedBy,
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Client access record not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.post("/client-access/:id/modules/:moduleKey/propose", async (request, reply) => {
  const params = request.params as { id: string; moduleKey: string };
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AccessModuleSetProposalBodySchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const result = await proposeModuleSet(
    params.id,
    params.moduleKey,
    parsed.data.enabled,
    parsed.data.reason,
    parsed.data.proposedBy,
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Client access record not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.post("/client-provisioning/dry-run", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = ClientProvisionProposalSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    plan: dryRunClientProvision(parsed.data),
  };
});

app.post("/client-provisioning/propose", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = ClientProvisionProposalSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    ...(await proposeClientProvision(parsed.data)),
  };
});

app.get("/client-access-workflow", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    actions: listAccessActions(),
    approvals: listAccessApprovals(),
    auditEvents: listAccessAuditEvents(),
    repository: accessRepository.info(),
    storage: accessRepository.info().storage,
  };
});

app.post("/client-access-workflow/snapshot", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = request.body as { label?: unknown } | undefined;
  const label = typeof body?.label === "string" ? body.label : "manual";

  return {
    ok: true,
    session,
    snapshot: createAccessStorageSnapshot(label),
    storage: accessRepository.info().storage,
  };
});

app.get("/pangolin/reconcile/dry-run", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    ...listPangolinDryRunPlan(),
  };
});

app.get("/pangolin/status/read-only", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    status: await checkPangolinReadOnlyStatus(),
  };
});

app.post("/client-access-approvals/:approvalId/decision", async (request, reply) => {
  const params = request.params as { approvalId: string };
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AccessApprovalDecisionSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const result = await decideAccessApproval(
    params.approvalId,
    parsed.data.decision,
    parsed.data.decidedBy,
    parsed.data.reason,
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Access approval not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.post("/actions/validate", async (request, reply) => {
  const parsed = ActionSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const handler = actionRegistry[parsed.data.type];

  return {
    ok: true,
    actionType: parsed.data.type,
    policy: parsed.data.policy,
    handlerState: handler ? "registered" : "not-implemented",
  };
});

app.post("/falcon/jobs/validate", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = FalconJobSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    jobType: parsed.data.type,
    requiresApproval: parsed.data.requiresApproval,
    broker: falconBroker.describe(),
  };
});

try {
  await app.listen({ host, port });
  app.log.info(`PhantomForce server listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
