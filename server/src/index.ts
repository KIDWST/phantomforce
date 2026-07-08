import cors from "@fastify/cors";
import {
  ACTION_SCHEMAS,
  ActionSchema,
  FALCON_JOB_SCHEMAS,
  FalconJobSchema,
} from "@phantomforce/contracts";
import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

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
  getWorkspaceAccess,
} from "./access/access-guard.js";
import { initializeAccessIdentityState } from "./access/access-identity-state.js";
import { getWorkspaceModuleView } from "./access/module-handlers.js";
import {
  AUTHORIZATION_HEADER,
  AccessLoginSchema,
  SESSION_HEADER,
  assertAccessAuthConfiguration,
  getAccessAuthConfiguration,
  getAccessSession,
  issueAccessSessionToken,
  listAccessSessions,
  requireAdminAccessSession,
  requireAccessSession,
  requireClientWorkspaceView,
} from "./access/session.js";
import type { AccessSession } from "./access/session.js";
import {
  canUseSessionOnPublicHost,
  filterSessionsForPublicHost,
  publicHostFromHeaders,
  PUBLIC_WEB_ORIGINS,
} from "./access/public-hosts.js";
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
import { buildDeploymentModelStatus } from "./access/deployment-model.js";
import { paywallPreHandler } from "./access/paywall-guard.js";
import { getPaywallDecision } from "./access/paywall.js";
import { listSubscriptions, setSubscription } from "./access/subscription-store.js";
import { timingSafeEqual } from "node:crypto";
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
  appendHermesLedgerRecord,
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
import { recallHermesInteractionMemory } from "./phantom-ai/hermes-interaction-recall.js";
import { buildOpsDashboardContext } from "./phantom-ai/ops-context.js";
import { buildAgentWorkforceStatus } from "./phantom-ai/agent-workforce.js";
import {
  AgentActionRequestSchema,
  getAgentActionDefinitions,
  runAgentAction,
} from "./phantom-ai/agent-actions.js";
import { getSalesConnectorStatus } from "./connectors/sales-connector.js";
import {
  getHermesInteractionMemoryStoreStatus,
  normalizeHermesInteractionMemoryStoreLimit,
  persistHermesInteractionMemoryPreview,
  recordHermesInteractionMemoryFromRun,
  readHermesInteractionMemoryStoreRecords,
} from "./phantom-ai/hermes-interaction-memory-store.js";
import { buildHermesMemoryContextPreview } from "./phantom-ai/hermes-memory-context.js";
import { buildOwnerCodexMemoryStatus } from "./phantom-ai/owner-codex-memory.js";
import { buildToolLanePreview } from "./phantom-ai/tool-lane.js";
import { buildChicagoShotsLeadIntakePreview } from "./phantom-ai/ops-workflow.js";
import {
  createChicagoShotsProposalHistoryRecord,
  getChicagoShotsProposalHistoryStatus,
  normalizeChicagoShotsProposalHistoryLimit,
  normalizeChicagoShotsProposalStatus,
  persistChicagoShotsProposalHistoryRecord,
  readChicagoShotsProposalHistoryRecordById,
  readChicagoShotsProposalHistoryRecords,
  updateChicagoShotsProposalHistoryRecordStatus,
} from "./phantom-ai/chicagoshots-proposal-history.js";
import { getChicagoShotsNexProspexCrm } from "./phantom-ai/chicagoshots-nexprospex-crm.js";
import { buildLiveSmokePreflightReport } from "./phantom-ai/live-smoke-preflight.js";
import {
  getSecurityScannerStatus,
  runSecurityScanPreview,
  SecurityScanRequestSchema,
} from "./phantom-ai/security-scanner.js";
import {
  ExternalSecurityMonitorRequestSchema,
  getExternalSecurityMonitorStatus,
  runExternalSecurityMonitor,
} from "./phantom-ai/external-security-monitor.js";
import {
  getAutonomousSecurityScanStatus,
  startAutonomousSecurityScanScheduler,
} from "./phantom-ai/security-scan-scheduler.js";
import {
  getProviderSetupStatus,
  previewModelRouterFoundation,
  runModelRouterFoundation,
} from "./phantom-ai/model-router.js";
import {
  clientSafeMediaLabImageToolchainStatus,
  getMediaLabImageToolchainStatus,
} from "./phantom-ai/media-lab-image-toolchain.js";
import { callClaudeCliChat } from "./phantom-ai/providers/claude-cli-transport.js";
import { callCodexCliChat } from "./phantom-ai/providers/codex-cli-transport.js";
import { callLocalOllamaChat } from "./phantom-ai/providers/local-ollama-transport.js";
import { callOpenRouterGlm52 } from "./phantom-ai/providers/openrouter-live-transport.js";
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
  HermesLedgerRecord,
  ProviderLiveReceiptLedgerOperation,
  SensitivityLevel,
} from "./phantom-ai/types.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5190);

const app = Fastify({
  logger: process.env.PHANTOMFORCE_SERVER_LOGGER === "false" ? false : true,
});

await app.register(cors, {
  origin: [
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/localhost:\d+$/,
    ...PUBLIC_WEB_ORIGINS,
  ],
  credentials: true,
  allowedHeaders: ["Content-Type", AUTHORIZATION_HEADER, SESSION_HEADER],
});

// Un-bypassable paywall: free/anonymous sessions may view but not mutate.
app.addHook("preHandler", paywallPreHandler);

const falconBroker = createFalconBroker({
  baseUrl: process.env.FALCON_BASE_URL ?? "http://127.0.0.1:8765",
});

const HiggsfieldDraftSchema = z.object({
  prompt: z.string().trim().min(1).max(3000),
  media_path: z.string().trim().max(600).optional().default(""),
  mode: z.enum(["video", "image", "marketing", "analyze"]).optional().default("video"),
  model: z.string().trim().max(80).optional().default("seedance_2_0"),
  duration: z.string().trim().max(12).optional().default("12"),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional().default("9:16"),
  resolution: z.enum(["480p", "720p", "1080p", "2k", "4k"]).optional().default("720p"),
  media_role: z.enum(["image", "start-image", "end-image", "video", "audio"]).optional().default("video"),
  product_url: z.string().trim().max(600).optional().default(""),
  generate_audio: z.enum(["", "true", "false", "yes", "no"]).optional().default(""),
});

type PhantomCutBridgeResult =
  | {
      ok: true;
      status: number;
      data: unknown;
      latencyMs: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
      latencyMs: number;
    };

function phantomCutBaseUrl() {
  return (process.env.PHANTOMCUT_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
}

function hasMediaLabAccess(session: AccessSession | undefined) {
  if (!session) return false;
  if (session.canManageAccess) return true;
  if (!session.clientId) return false;

  const workspace = getWorkspaceAccess(session.clientId);
  if (!workspace?.decision.allowed) return false;

  return workspace.decision.modules.some((moduleKey) =>
    ["video", "media", "media lab", "content"].includes(moduleKey.trim().toLowerCase()),
  );
}

async function callPhantomCut(pathname: string, init?: RequestInit): Promise<PhantomCutBridgeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${phantomCutBaseUrl()}${pathname}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.headers ?? {}),
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();

    return response.ok
      ? {
          ok: true,
          status: response.status,
          data,
          latencyMs: Date.now() - startedAt,
        }
      : {
          ok: false,
          status: response.status,
          error: typeof data === "string" ? data : JSON.stringify(data),
          latencyMs: Date.now() - startedAt,
        };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: error instanceof Error ? error.message : "PhantomCut bridge did not respond.",
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

function requestPublicHost(request: FastifyRequest) {
  return publicHostFromHeaders(request.headers as Record<string, unknown>);
}

app.get("/", async (request, reply) => {
  const publicHost = requestPublicHost(request);
  const hostName = String(request.headers.host ?? "").split(":")[0]?.toLowerCase();
  const target = publicHost === "admin.phantomforce.online" || hostName === "admin.phantomforce.online"
    ? "https://admin.phantomforce.online/app/index.html"
    : "/app/index.html";

  return reply.code(302).header("Location", target).send();
});

app.get("/sessions", async (request) => {
  const authConfiguration = getAccessAuthConfiguration();
  const publicHost = requestPublicHost(request);

  return {
    ok: true,
    auth: {
      ...authConfiguration,
    },
    sessions: filterSessionsForPublicHost(publicHost, listAccessSessions()),
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

  const requestedSession = getAccessSession(parsed.data.sessionId);
  const publicHost = requestPublicHost(request);

  if (requestedSession && !canUseSessionOnPublicHost(publicHost, requestedSession)) {
    return reply.code(403).send({
      ok: false,
      error: "This login is not available on this public host.",
      host: publicHost || "local",
      sessions: filterSessionsForPublicHost(publicHost, listAccessSessions()),
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

// The signed-in account's own plan — the dashboard reads this to show the plan
// badge and an "upgrade to make changes" prompt. Any authenticated session.
app.get("/billing/subscription/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const decision = getPaywallDecision(session);
  return {
    ok: true,
    session,
    plan: decision.tier,
    canView: decision.canView,
    canWrite: decision.canWrite,
    reason: decision.reason,
  };
});

// Owner-only trusted write path: grant or revoke paid access for an account.
const SubscriptionGrantSchema = z.object({
  email: z.string().trim().min(3).max(200),
  active: z.boolean(),
  note: z.string().trim().max(300).optional(),
});
app.post("/billing/subscription/grant", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = SubscriptionGrantSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  const subscription = setSubscription({
    email: parsed.data.email,
    active: parsed.data.active,
    source: "owner-grant",
    note: parsed.data.note,
  });
  return { ok: true, session, subscription };
});

app.get("/billing/subscriptions", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return { ok: true, session, subscriptions: listSubscriptions() };
});

// Payment webhook (stub, ready for a real provider). Authenticated ONLY by a
// signing secret (PHANTOM_BILLING_WEBHOOK_SECRET), never a session. Disabled
// with 503 until the secret is set, so it can never be used to self-grant.
const BillingWebhookSchema = z.object({
  email: z.string().trim().min(3).max(200),
  event: z.enum(["subscription_active", "subscription_canceled"]),
  provider: z.string().trim().max(40).optional().default("manual"),
});
app.post("/billing/webhook", async (request, reply) => {
  const secret = process.env.PHANTOM_BILLING_WEBHOOK_SECRET ?? "";
  if (secret.length < 16) {
    return reply.code(503).send({
      ok: false,
      error: "billing_webhook_disabled",
      reason: "PHANTOM_BILLING_WEBHOOK_SECRET is not configured (>=16 chars).",
    });
  }

  const presented = request.headers["x-phantom-billing-secret"];
  const provided = Array.isArray(presented) ? presented[0] : presented;
  const authorized =
    typeof provided === "string" &&
    provided.length === secret.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!authorized) {
    return reply.code(401).send({ ok: false, error: "invalid_webhook_signature" });
  }

  const parsed = BillingWebhookSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  const subscription = setSubscription({
    email: parsed.data.email,
    active: parsed.data.event === "subscription_active",
    source: `webhook:${parsed.data.provider}`,
  });
  return { ok: true, subscription, liveProvider: false };
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

const OWNER_MEMORY_TENANT_ID = "phantomforce-owner";
const MAX_MEMORY_SCOPE_ID_CHARS = 80;

function cleanMemoryScopeId(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/\s+/g, "-");
  return trimmed ? trimmed.slice(0, MAX_MEMORY_SCOPE_ID_CHARS) : fallback;
}

function tenantIdForAccessSession(session: AccessSession) {
  if (session.canManageAccess) {
    return OWNER_MEMORY_TENANT_ID;
  }

  return cleanMemoryScopeId(session.clientId, `client-${session.id}`);
}

function resolveMemoryScopeFromBody(
  body: {
    tenant_id?: unknown;
    actor_user_id?: unknown;
  },
  session: AccessSession,
) {
  const requestedTenantId = cleanMemoryScopeId(body.tenant_id);
  const requestedActorUserId = cleanMemoryScopeId(body.actor_user_id);

  if (!session.canManageAccess) {
    const tenantId = tenantIdForAccessSession(session);
    return {
      tenant_id: tenantId,
      actor_user_id: cleanMemoryScopeId(session.id, session.id),
      memory_scope: "client_tenant_only" as const,
      requested_tenant_id: requestedTenantId || null,
      requested_actor_user_id: requestedActorUserId || null,
      tenant_override_blocked: Boolean(requestedTenantId && requestedTenantId !== tenantId),
      actor_override_blocked: Boolean(requestedActorUserId && requestedActorUserId !== session.id),
    };
  }

  const tenantId = requestedTenantId || OWNER_MEMORY_TENANT_ID;
  const actorUserId = requestedActorUserId || session.id;

  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    memory_scope: tenantId === OWNER_MEMORY_TENANT_ID ? ("owner_private" as const) : ("owner_selected_tenant" as const),
    requested_tenant_id: requestedTenantId || null,
    requested_actor_user_id: requestedActorUserId || null,
    tenant_override_blocked: false,
    actor_override_blocked: false,
  };
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
  session: AccessSession,
  requestIdPrefix: string,
) {
  const actorRole: ActorRole = session.canManageAccess ? "platform_admin" : "business_owner";
  const memoryScope = resolveMemoryScopeFromBody(body, session);

  return {
    tenant_id: memoryScope.tenant_id,
    business_name:
      typeof body.business_name === "string" ? body.business_name.slice(0, 120) : "PhantomForce",
    actor_user_id: memoryScope.actor_user_id,
    actor_role: actorRole,
    request_id:
      typeof body.request_id === "string" ? body.request_id.slice(0, 120) : `${requestIdPrefix}-${Date.now()}`,
    task_type: typeof body.task_type === "string" ? body.task_type.slice(0, 120) : "summary",
    sensitivity_level: parseSensitivityLevel(body.sensitivity_level),
    user_request:
      typeof body.user_request === "string"
        ? body.user_request.slice(0, 1600)
        : "Summarize the PhantomForce workspace and recommend the next safe business action.",
    business_summary:
      typeof body.business_summary === "string"
        ? body.business_summary.slice(0, 900)
        : "Owner-only PhantomForce workspace. External actions approval-only.",
    module_data: parseContextModuleData(body.module_data),
    memory_scope: memoryScope.memory_scope,
    requested_tenant_id: memoryScope.requested_tenant_id,
    requested_actor_user_id: memoryScope.requested_actor_user_id,
    tenant_override_blocked: memoryScope.tenant_override_blocked,
    actor_override_blocked: memoryScope.actor_override_blocked,
  };
}

function buildMemoryScopeProof(normalized: {
  memory_scope: string;
  tenant_id: string;
  actor_user_id: string;
  requested_tenant_id: string | null;
  requested_actor_user_id: string | null;
  tenant_override_blocked: boolean;
  actor_override_blocked: boolean;
}) {
  return {
    scope: normalized.memory_scope,
    tenant_id: normalized.tenant_id,
    actor_user_id: normalized.actor_user_id,
    requested_tenant_id: normalized.requested_tenant_id,
    requested_actor_user_id: normalized.requested_actor_user_id,
    tenant_override_blocked: normalized.tenant_override_blocked,
    actor_override_blocked: normalized.actor_override_blocked,
  };
}

function parsePhantomAiChatProvider(value: unknown) {
  return value === "openrouter_glm" ? "openrouter_glm" : "phantom";
}

type AdminPhantomAiModelLane = "codex" | "glm_5_2" | "claude_cli";

function parseAdminPhantomAiModelLane(value: unknown): AdminPhantomAiModelLane {
  if (value === "glm_5_2" || value === "openrouter_glm" || value === "glm") return "glm_5_2";
  if (value === "claude_cli" || value === "claude") return "claude_cli";
  return "codex";
}

function adminPhantomAiModelLabel(lane: AdminPhantomAiModelLane) {
  if (lane === "glm_5_2") return "Local GLM";
  if (lane === "claude_cli") return "Claude CLI";
  return "Private Brain";
}

function publicAdminPhantomAiModelLane(lane: AdminPhantomAiModelLane) {
  return lane === "codex" ? "private_brain" : lane;
}

function adminPhantomAiProviderRoute(lane: AdminPhantomAiModelLane) {
  if (lane === "glm_5_2") return "local" as const;
  if (lane === "claude_cli") return "claude" as const;
  return "local" as const;
}

type PendingPrivacyIntent = {
  kind: "weather";
  created_at_ms: number;
  original_request: string;
};

const pendingPrivacyIntents = new Map<string, PendingPrivacyIntent>();
const PENDING_PRIVACY_INTENT_TTL_MS = 10 * 60 * 1000;

const weatherCodeLabels: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "heavy rain showers",
  95: "thunderstorms",
  96: "thunderstorms with hail",
  99: "thunderstorms with hail",
};

function purgeExpiredPendingPrivacyIntents(now = Date.now()) {
  for (const [key, intent] of pendingPrivacyIntents.entries()) {
    if (now - intent.created_at_ms > PENDING_PRIVACY_INTENT_TTL_MS) {
      pendingPrivacyIntents.delete(key);
    }
  }
}

function buildChatMemoryKey(
  session: AccessSession,
  normalized: {
    tenant_id: string;
    actor_user_id: string;
  },
) {
  return `${session.id}:${normalized.tenant_id}:${normalized.actor_user_id}`;
}

function cleanLocationCandidate(value: string) {
  return value
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(?:the\s+)?weather\s+(?:in|for|near|at)\s+/i, "")
    .replace(/\b(please|pls|thanks|thank you)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyBareLocationCandidate(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/\b(weather|forecast|temperature|temp|rain|snow|storm|humidity|outside|what'?s|whats|what is|how'?s|hows|how is)\b/.test(normalized)) {
    return false;
  }
  return /[a-z0-9]/i.test(normalized);
}

function extractExplicitWeatherLocation(userRequest: string) {
  const normalized = userRequest.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:what'?s|whats|what is|how'?s|hows|how is)\s+(?:the\s+)?(?:weather|forecast|temperature|temp)\s+(?:in|for|near|at)\s+(.{2,80})$/i,
    /\b(?:weather|forecast|temperature|temp)\s+(?:in|for|near|at)\s+(.{2,80})$/i,
    /\b(?:in|for|near|at)\s+([a-z][a-z .'-]{1,80}(?:,\s*[a-z]{2})?|\d{5})(?:\s+(?:weather|forecast|temperature|temp))?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1] ? cleanLocationCandidate(match[1]) : "";
    if (candidate && /[a-z0-9]/i.test(candidate)) return candidate;
  }

  return null;
}

function extractLocationFollowUp(userRequest: string) {
  const normalized = userRequest.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const patterns = [
    /^(?:ok(?:ay)?[, ]*)?(?:what'?s|whats|what is|how'?s|hows|how is)\s+(?:the\s+)?(?:weather|forecast|temperature|temp)\s+(?:in|for|near|at)\s+(.{2,80})$/i,
    /^(?:ok(?:ay)?[, ]*)?(?:weather|forecast|temperature|temp)\s+(?:in|for|near|at)\s+(.{2,80})$/i,
    /^(?:ok(?:ay)?[, ]*)?(?:i'?m|im|i am|we'?re|were|we are)\s+(?:in|near|at)\s+(.{2,80})$/i,
    /^(?:ok(?:ay)?[, ]*)?(?:use|try|check|make it|set it to)\s+(.{2,80})$/i,
    /^(?:ok(?:ay)?[, ]*)?(?:my location is|location is|city is|zip is)\s+(.{2,80})$/i,
    /^([a-z][a-z .'-]{1,80}(?:,\s*[a-z]{2})?|\d{5})$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1] ? cleanLocationCandidate(match[1]) : "";
    if (candidate && isLikelyBareLocationCandidate(candidate)) return candidate;
  }

  return null;
}

function numberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isWeatherLookupEnabled() {
  return process.env.PHANTOM_WEATHER_LOOKUP_ENABLED !== "false";
}

async function lookupWeatherForExplicitLocation(location: string) {
  if (!isWeatherLookupEnabled()) {
    return {
      ok: false as const,
      reason: "weather_lookup_disabled",
      message: "Weather lookup is currently disabled on this PhantomForce backend.",
    };
  }

  const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodeUrl.searchParams.set("name", location);
  geocodeUrl.searchParams.set("count", "1");
  geocodeUrl.searchParams.set("language", "en");
  geocodeUrl.searchParams.set("format", "json");

  const geocodeResponse = await fetch(geocodeUrl, { headers: { Accept: "application/json" } });
  if (!geocodeResponse.ok) {
    return {
      ok: false as const,
      reason: "geocode_failed",
      message: `I could not resolve ${location} for a weather lookup.`,
    };
  }

  const geocodeJson = await geocodeResponse.json().catch(() => null);
  const result = geocodeJson && typeof geocodeJson === "object"
    ? (geocodeJson as { results?: unknown }).results
    : null;
  const first = Array.isArray(result) && result[0] && typeof result[0] === "object"
    ? (result[0] as Record<string, unknown>)
    : null;

  if (!first) {
    return {
      ok: false as const,
      reason: "location_not_found",
      message: `I could not find a weather match for ${location}. Try city + state or ZIP.`,
    };
  }

  const latitude = numberFromRecord(first, "latitude");
  const longitude = numberFromRecord(first, "longitude");
  const name = stringFromRecord(first, "name") ?? location;
  const admin1 = stringFromRecord(first, "admin1");
  const country = stringFromRecord(first, "country");

  if (latitude === null || longitude === null) {
    return {
      ok: false as const,
      reason: "location_coordinates_missing",
      message: `I found ${location}, but weather coordinates were missing.`,
    };
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(latitude));
  forecastUrl.searchParams.set("longitude", String(longitude));
  forecastUrl.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
  );
  forecastUrl.searchParams.set("temperature_unit", "fahrenheit");
  forecastUrl.searchParams.set("wind_speed_unit", "mph");
  forecastUrl.searchParams.set("precipitation_unit", "inch");
  forecastUrl.searchParams.set("timezone", "auto");

  const forecastResponse = await fetch(forecastUrl, { headers: { Accept: "application/json" } });
  if (!forecastResponse.ok) {
    return {
      ok: false as const,
      reason: "forecast_failed",
      message: `I found ${name}, but the weather service did not return current conditions.`,
    };
  }

  const forecastJson = await forecastResponse.json().catch(() => null);
  const current = forecastJson && typeof forecastJson === "object"
    ? (forecastJson as { current?: unknown }).current
    : null;
  const currentRecord = current && typeof current === "object" ? (current as Record<string, unknown>) : null;

  if (!currentRecord) {
    return {
      ok: false as const,
      reason: "current_conditions_missing",
      message: `I found ${name}, but current weather was missing from the response.`,
    };
  }

  const temperature = numberFromRecord(currentRecord, "temperature_2m");
  const feelsLike = numberFromRecord(currentRecord, "apparent_temperature");
  const humidity = numberFromRecord(currentRecord, "relative_humidity_2m");
  const wind = numberFromRecord(currentRecord, "wind_speed_10m");
  const precipitation = numberFromRecord(currentRecord, "precipitation");
  const weatherCode = numberFromRecord(currentRecord, "weather_code");
  const label = weatherCode === null ? "current conditions" : weatherCodeLabels[weatherCode] ?? "current conditions";
  const place = [name, admin1, country].filter(Boolean).join(", ");
  const tempText = temperature === null ? "temperature unavailable" : `${Math.round(temperature)}°F`;
  const feelsText = feelsLike === null ? "" : `, feels like ${Math.round(feelsLike)}°F`;
  const windText = wind === null ? "" : ` Wind ${Math.round(wind)} mph.`;
  const humidityText = humidity === null ? "" : ` Humidity ${Math.round(humidity)}%.`;
  const rainText = precipitation && precipitation > 0 ? ` Precipitation ${precipitation.toFixed(2)} in.` : "";

  return {
    ok: true as const,
    place,
    label,
    temperature,
    feels_like: feelsLike,
    humidity,
    wind_speed: wind,
    precipitation,
    weather_code: weatherCode,
    message: `${place}: ${tempText}${feelsText}, ${label}.${windText}${humidityText}${rainText}`,
  };
}

async function buildWeatherReadyReply(location: string, session: AccessSession, reason: string) {
  const weather = await lookupWeatherForExplicitLocation(location);
  const content = weather.ok
    ? `${weather.message}\n\nPrivacy note: I used only the location you typed. No device, IP, browser, or account location was used.`
    : `${weather.message} Privacy note: I still did not use device, IP, browser, or account location.`;

  return {
    ok: true,
    session,
    provider_choice: "phantom",
    model_id: weather.ok ? "phantom-weather-explicit-location" : "phantom-privacy-weather-context",
    message: {
      role: "assistant",
      content,
    },
    weather,
    privacy_guard: {
      location_accessed: false,
      location_inferred: false,
      device_location_used: false,
      ip_location_used: false,
      explicit_location_received: true,
      explicit_location: location,
      requires_explicit_location: false,
      requires_live_lookup_approval: false,
      user_provided_location_only: true,
      reason,
    },
    provider_request_body_created: false,
    live_provider_called: false,
    network_call_performed: weather.ok,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    payment_request_created: false,
    invoice_created: false,
  };
}

async function buildPrivacyFirstLocationReply(userRequest: string, session: AccessSession, chatMemoryKey: string) {
  purgeExpiredPendingPrivacyIntents();
  const normalized = userRequest.toLowerCase().replace(/\s+/g, " ").trim();
  const asksOwnLocation =
    /\b(where am i|my location|where do you think i am|do you know where i am|what city am i in)\b/.test(normalized);
  const asksWeather =
    /\b(weather|forecast|temperature|temp|rain|snow|storm|humidity|wind chill|heat index)\b/.test(normalized) ||
    /\b(how'?s|how is|what'?s|what is)\s+(it\s+)?outside\b/.test(normalized);

  const pendingIntent = pendingPrivacyIntents.get(chatMemoryKey);
  const followUpLocation = pendingIntent?.kind === "weather" ? extractLocationFollowUp(userRequest) : null;

  if (pendingIntent?.kind === "weather" && followUpLocation) {
    pendingPrivacyIntents.delete(chatMemoryKey);
    return await buildWeatherReadyReply(followUpLocation, session, "weather_location_followup_received");
  }

  if (!asksOwnLocation && !asksWeather) return null;

  const explicitWeatherLocation = asksWeather ? extractExplicitWeatherLocation(userRequest) : null;

  if (asksWeather && explicitWeatherLocation) {
    pendingPrivacyIntents.delete(chatMemoryKey);
    return await buildWeatherReadyReply(explicitWeatherLocation, session, "weather_request_explicit_location_received");
  }

  const content = asksWeather
    ? "I can help with weather, but PhantomForce does not access or infer your location. Send a city or ZIP, or explicitly approve a live weather lookup, and I will use only that location."
    : "I do not have access to your location, and PhantomForce will not infer it from your device, IP, browser, or account. If you want location-based help, tell me the city or place to use.";

  if (asksWeather) {
    pendingPrivacyIntents.set(chatMemoryKey, {
      kind: "weather",
      created_at_ms: Date.now(),
      original_request: userRequest.slice(0, 240),
    });
  }

  return {
    ok: true,
    session,
    provider_choice: "phantom",
    model_id: "phantom-privacy-location-guard",
    message: {
      role: "assistant",
      content,
    },
    privacy_guard: {
      location_accessed: false,
      location_inferred: false,
      device_location_used: false,
      ip_location_used: false,
      requires_explicit_location: true,
      pending_intent_saved: asksWeather,
      reason: asksWeather ? "weather_request_requires_explicit_location" : "location_request_blocked",
    },
    provider_request_body_created: false,
    live_provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    payment_request_created: false,
    invoice_created: false,
  };
}

function buildPhantomAiWorkspaceReply(userRequest: string, businessName: string) {
  const lower = userRequest.toLowerCase();
  const business = businessName.trim() || "PhantomForce";

  if (/^(hi|hello|hey|yo|phantom)\b/.test(lower.trim())) {
    return `Hey — what are we working on for ${business}?`;
  }

  if (/\b(annoying|frustrating|hate|sucks|weird|robotic|feels off|feels wrong|not what i wanted|disappointed)\b/.test(lower)) {
    return [
      "Yeah, that shouldn't feel like that — thanks for calling it out.",
      "Want me to turn this into a fix task, or just talk through what feels wrong? Nothing gets created unless you say so.",
    ].join("\n\n");
  }

  if (lower.includes("brief") || lower.includes("today") || lower.includes("priority")) {
    return [
      "Today's best order:",
      "1. Reply to the highest-priority lead with two call windows and a clear next step.",
      "2. Review the ChicagoShots proposal packet and mark the status: draft, sent manually, follow-up needed, won, or lost.",
      "3. Prepare one Core Sprint follow-up around the $1,500 offer, with $750 Starter as the fallback.",
      "4. Keep Media Lab/PhantomCut proof private unless the prospect asks for examples.",
    ].join("\n");
  }

  if (lower.includes("price") || lower.includes("quote") || lower.includes("offer") || lower.includes("package")) {
    return [
      "Use this offer ladder:",
      "- $750 Starter: quick cleanup, first follow-up, simple action board.",
      "- $1,500 Core Sprint: default offer for ops + content setup.",
      "- $2,500 Pro: messy workflows, dashboards, media, or heavier delivery.",
      "For retainers, start at $300/mo unless the client only needs light follow-up support.",
    ].join("\n");
  }

  if (lower.includes("chicagoshots") || lower.includes("media") || lower.includes("video") || lower.includes("content")) {
    return [
      "ChicagoShots should be framed as the media execution arm:",
      "1. Confirm the shoot/content goal.",
      "2. Pick the package and delivery timeline.",
      "3. Draft the follow-up manually.",
      "4. Track status in proposal history before any external send.",
      "Media Lab and PhantomCut are proof-backed support tools, not autonomous posting tools.",
    ].join("\n");
  }

  return [
    "Got it — happy to talk that through. Nothing was turned into a task.",
    `When you want action for ${business}, say the word — "make it a task", "plan it", or "start a build" — and I'll run it properly with proof.`,
  ].join("\n\n");
}

function getSendReadinessStatus() {
  return {
    status: "planned_disabled" as const,
    send_enabled: false,
    send_route_present: false,
    approval_required: true,
    manual_operator_confirmation_required: true,
    automatic_send_allowed: false,
    bulk_send_allowed: false,
    queue_execution_allowed: false,
    test_allowlist_required: true,
    test_allowlist_configured: false,
    credentials_configured: false,
    credentials_status: "not_configured_no_secret_read" as const,
    external_send: false,
    provider_called: false,
    n8n_executed: false,
    approval_execution: false,
    queue_write: false,
    production_ledger_write: false,
    audit_receipt_required: true,
    audit_receipt_written: false,
    architecture: [
      "Draft only inside PhantomForce.",
      "Owner approval required before any external send route can exist.",
      "Manual operator confirmation required for one allowed test recipient.",
      "No automatic send, bulk send, queue execution, or n8n execution.",
      "No credentials may be committed or printed.",
      "A redacted audit receipt is required after any future approved send.",
    ],
    next_required_before_send: [
      "Implement a separate approval-gated send adapter.",
      "Add a local test-recipient allowlist.",
      "Add a one-message explicit confirmation phrase.",
      "Add redacted receipt storage for every send attempt.",
      "Run test-only delivery to approved Jordan-owned recipients before any client use.",
    ],
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
    tenant_id: "phantomforce-admin",
    business_name: "PhantomForce",
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
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.slice(0, 80) : "phantomforce-admin";
  const businessName =
    typeof body.business_name === "string" ? body.business_name.slice(0, 120) : "PhantomForce";
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
  session: AccessSession,
) {
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, string | number | boolean | null>)
      : undefined;
  const memoryScope = resolveMemoryScopeFromBody(body, session);

  return buildHermesInteractionMemoryPreview({
    tenant_id: memoryScope.tenant_id,
    actor_user_id: memoryScope.actor_user_id,
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

app.post("/phantom-ai/hermes/interaction-memory/recall/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    actor_user_id?: unknown;
    task_id?: unknown;
    interaction_type?: unknown;
    limit?: unknown;
  };
  const recall = await recallHermesInteractionMemory({
    tenantId: typeof body.tenant_id === "string" ? body.tenant_id : session.id,
    actorUserId: typeof body.actor_user_id === "string" ? body.actor_user_id : null,
    taskId: typeof body.task_id === "string" ? body.task_id : null,
    interactionType: typeof body.interaction_type === "string" ? body.interaction_type : null,
    limit: typeof body.limit === "string" || typeof body.limit === "number" ? body.limit : undefined,
  });

  return {
    ok: true,
    session,
    dry_run: true,
    read_only: true,
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
    recall,
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

app.post("/phantom-ai/ops/chicagoshots/lead-intake/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    tenant_id?: unknown;
    actor_user_id?: unknown;
    client_name?: unknown;
    contact?: unknown;
    event_type?: unknown;
    date_time?: unknown;
    location?: unknown;
    requested_service?: unknown;
    budget_rate?: unknown;
    notes?: unknown;
    source_platform?: unknown;
    urgency?: unknown;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const lead = await buildChicagoShotsLeadIntakePreview({
    tenant_id: str(body.tenant_id) ?? "chicagoshots",
    actor_user_id: str(body.actor_user_id) ?? session.id,
    client_name: str(body.client_name),
    contact: str(body.contact),
    event_type: str(body.event_type),
    date_time: str(body.date_time),
    location: str(body.location),
    requested_service: str(body.requested_service),
    budget_rate: str(body.budget_rate),
    notes: str(body.notes),
    source_platform: str(body.source_platform),
    urgency: str(body.urgency),
  });

  return {
    ok: true,
    session,
    dry_run: true,
    provider_called: false,
    network_call_performed: false,
    external_send: false,
    would_send: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    lead,
  };
});

app.post("/phantom-ai/ops/chicagoshots/proposal-history/save", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    packet?: unknown;
    lead?: unknown;
    proposal_summary?: unknown;
    client_ready_proposal?: unknown;
    exported_markdown?: unknown;
  };

  try {
    const packet = body.packet ?? body.lead;
    const record = createChicagoShotsProposalHistoryRecord({
      packet: packet as Parameters<typeof createChicagoShotsProposalHistoryRecord>[0]["packet"],
      proposalSummary: typeof body.proposal_summary === "string" ? body.proposal_summary : "",
      clientReadyProposal: typeof body.client_ready_proposal === "string" ? body.client_ready_proposal : "",
      exportedMarkdown: typeof body.exported_markdown === "string" ? body.exported_markdown : "",
    });
    const persistence = await persistChicagoShotsProposalHistoryRecord(record);

    if (!persistence.persisted) {
      return reply.code(403).send({
        ok: false,
        session,
        error: "ChicagoShots proposal history writes are blocked in production mode.",
        persistence,
      });
    }

    return {
      ok: true,
      session,
      store: {
        path: persistence.store_path,
        local_dev_only: true,
        admin_only: true,
        production_write_allowed: false,
      },
      record,
      safety_flags: persistence.safety_flags,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      payment_request_created: false,
      invoice_created: false,
    };
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      session,
      error: (error as Error).message,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      payment_request_created: false,
      invoice_created: false,
    });
  }
});

app.get("/phantom-ai/ops/chicagoshots/proposal-history", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const limit = normalizeChicagoShotsProposalHistoryLimit(query?.limit);
  const [status, history] = await Promise.all([
    getChicagoShotsProposalHistoryStatus(),
    readChicagoShotsProposalHistoryRecords({ limit }),
  ]);

  return {
    ok: true,
    session,
    store: {
      path: status.store_path,
      exists: status.exists,
      bytes: status.bytes,
      local_dev_only: status.local_dev_only,
      admin_only: status.admin_only,
      production_write_allowed: status.production_write_allowed,
      malformed_lines: history.malformed_lines,
      returned_count: history.records.length,
      total_count: history.total_count,
      limit: history.limit,
    },
    summary_counts: history.status_counts,
    records: history.records,
    provider_called: false,
    network_call_performed: false,
    external_send: false,
    n8n_executed: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    payment_request_created: false,
    invoice_created: false,
  };
});

app.get("/phantom-ai/ops/chicagoshots/nexprospex-crm", async (request, reply) => {
  const session = requireClientWorkspaceView(request, reply, "client-chicagoshots");

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const requestedLimit = Number.parseInt(String(query?.limit ?? "25"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(75, requestedLimit)) : 25;

  try {
    const crm = await getChicagoShotsNexProspexCrm(limit);

    return {
      ok: true,
      session,
      crm,
      safety: crm.safety,
      workspace_scoped: true,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      source_data_mutated: false,
      credentials_returned: false,
    };
  } catch (error) {
    return reply.code(503).send({
      ok: false,
      session,
      error: error instanceof Error ? error.message : "NexProspex CRM unavailable.",
      source: "NexProspex CRM",
      workspace_scoped: true,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      source_data_mutated: false,
      credentials_returned: false,
    });
  }
});

app.patch("/phantom-ai/ops/chicagoshots/proposal-history/:id/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { id: string };
  const body = (request.body ?? {}) as { status?: unknown };
  const status = normalizeChicagoShotsProposalStatus(body.status);

  if (!status) {
    return reply.code(400).send({
      ok: false,
      session,
      error: "Unsupported ChicagoShots proposal status.",
      allowed_statuses: ["draft", "sent_manually", "follow_up_needed", "won", "lost"],
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      payment_request_created: false,
      invoice_created: false,
    });
  }

  const result = await updateChicagoShotsProposalHistoryRecordStatus(params.id, status);

  if (!result.found) {
    return reply.code(404).send({
      ok: false,
      session,
      error: "ChicagoShots proposal history record not found.",
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      payment_request_created: false,
      invoice_created: false,
    });
  }

  if (!result.persistence?.persisted || !result.record) {
    return reply.code(403).send({
      ok: false,
      session,
      error: "ChicagoShots proposal status updates are blocked in production mode.",
      persistence: result.persistence,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      n8n_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      payment_request_created: false,
      invoice_created: false,
    });
  }

  return {
    ok: true,
    session,
    record: result.record,
    status: result.record.status,
    status_updated_at: result.record.status_updated_at,
    provider_called: false,
    network_call_performed: false,
    external_send: false,
    n8n_executed: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    payment_request_created: false,
    invoice_created: false,
  };
});

app.get("/phantom-ai/ops/chicagoshots/proposal-history/:id", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { id: string };
  const record = await readChicagoShotsProposalHistoryRecordById(params.id);

  if (!record) {
    return reply.code(404).send({
      ok: false,
      session,
      error: "ChicagoShots proposal history record not found.",
    });
  }

  return {
    ok: true,
    session,
    record,
    provider_called: false,
    network_call_performed: false,
    external_send: false,
    n8n_executed: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    payment_request_created: false,
    invoice_created: false,
  };
});

app.get("/phantom-ai/ops/context", async (request, reply) => {
  // Embedded dashboard assistant context. Available to any authenticated
  // session; standard/client sessions receive a redacted shell (no operator
  // business records, no provider/debug internals).
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = (request.query ?? {}) as { module?: unknown; packet_id?: unknown };
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);

  const context = await buildOpsDashboardContext({
    isAdmin: session.canManageAccess,
    tenantId: session.clientId ?? null,
    actorUserId: session.id,
    module: str(query.module) ?? null,
    packetId: str(query.packet_id) ?? null,
  });

  return { ok: true, session, read_only: true, context };
});

app.get("/phantom-ai/agents/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = (request.query ?? {}) as { window_hours?: unknown };
  const requestedWindow =
    typeof query.window_hours === "string" ? Number.parseInt(query.window_hours, 10) : undefined;
  const windowHours =
    Number.isInteger(requestedWindow) && requestedWindow && requestedWindow >= 1 && requestedWindow <= 24 * 7
      ? requestedWindow
      : 24;
  const workforce = await buildAgentWorkforceStatus({
    admin: session.canManageAccess,
    windowHours,
  });

  return {
    ok: true,
    session,
    read_only: true,
    workforce,
  };
});

app.get("/phantom-ai/agents/actions", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    read_only: true,
    actions: getAgentActionDefinitions(),
    safety_flags: {
      product_repo_edits: false,
      external_actions: false,
      provider_calls: false,
      n8n_started: false,
      workflow_executed: false,
      credentials_used: false,
    },
  };
});

app.get("/phantom-ai/deployment/model/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    read_only: true,
    deployment_model: buildDeploymentModelStatus({
      audience: session.canManageAccess ? "admin" : "client",
    }),
  };
});

app.post("/phantom-ai/agents/actions/run", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AgentActionRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
      safety_flags: {
        product_repo_edits: false,
        external_actions: false,
        provider_calls: false,
        n8n_started: false,
        workflow_executed: false,
        credentials_used: false,
      },
    });
  }

  try {
    const result = await runAgentAction(parsed.data);

    if (!result.ok) {
      return reply.code(404).send({ ok: false, session, result });
    }

    return {
      ok: true,
      session,
      result,
    };
  } catch (error) {
    return reply.code(500).send({
      ok: false,
      session,
      error: error instanceof Error ? error.message : "Agent action failed.",
      safety_flags: {
        product_repo_edits: false,
        external_actions: false,
        provider_calls: false,
        n8n_started: false,
        workflow_executed: false,
        credentials_used: false,
      },
    });
  }
});

app.get("/phantom-ai/ops/sales-connector/status", async (request, reply) => {
  // Admin-only. Sales connector is intentionally planned/disabled pre-live:
  // no credentials, no external send, no live action.
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return { ok: true, session, read_only: true, sales_connector: getSalesConnectorStatus() };
});

app.get("/phantom-ai/ops/send-readiness/status", async (request, reply) => {
  // Admin-only checkpoint for the future approved-send architecture. This is
  // status-only and never creates a send request, provider call, queue item, or
  // credential lookup.
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    read_only: true,
    send_readiness: getSendReadinessStatus(),
  };
});

app.get("/phantom-ai/security/scan/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    read_only: true,
    scanner: getSecurityScannerStatus(),
    access: {
      role: session.role,
      admin: session.canManageAccess,
      scope: session.canManageAccess
        ? "admin_and_client_website_content_preview"
        : "own_client_workspace_content_preview",
      filesystem_scan_enabled: false,
      admin_filesystem_scan_required: false,
    },
  };
});

app.get("/phantom-ai/security/external-monitor/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const monitor = getExternalSecurityMonitorStatus();

  if (!session.canManageAccess) {
    return {
      ok: true,
      session,
      admin_only: true,
      details_redacted: true,
      monitor: {
        monitor_version: monitor.monitor_version,
        configured: monitor.configured,
        connectors: monitor.connectors.map((connector) => ({
          id: connector.id,
          name: connector.name,
          configured: connector.configured,
          active: connector.active,
        })),
        safety: monitor.safety,
      },
    };
  }

  return {
    ok: true,
    session,
    admin_only: true,
    monitor,
  };
});

app.post("/phantom-ai/security/external-monitor/run", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = ExternalSecurityMonitorRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
      monitor: getExternalSecurityMonitorStatus(),
      safety_flags: {
        admin_only: true,
        destructive_action: false,
        upload_performed: false,
        deletes_files: false,
        plaintext_passwords_accepted: false,
        raw_credentials_returned: false,
      },
    });
  }

  const result = await runExternalSecurityMonitor(parsed.data);

  return {
    ok: true,
    session,
    admin_only: true,
    result,
    provider_called: false,
    upload_performed: false,
    destructive_action: false,
  };
});

app.get("/phantom-ai/security/autonomous/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const status = await getAutonomousSecurityScanStatus();

  if (!session.canManageAccess) {
    return {
      ok: true,
      session,
      autonomous: true,
      cadence: status.cadence,
      status: status.status,
      protection_active: status.enabled,
      target_count: status.target_count,
      last_run_at: status.last_run_at,
      next_run_after: status.next_run_after,
      password_health: {
        enabled: true,
        rotation_interval_days: status.password_health.policy.rotation_interval_days,
        last_checked_at: status.password_health.checked_at,
        breach_check_timing: status.password_health.policy.breach_check_timing,
        details_redacted: true,
      },
      details_redacted: true,
      safety_flags: {
        local_only: true,
        destructive_action: false,
        external_scan_provider_called: false,
        upload_performed: false,
      },
    };
  }

  return {
    ok: true,
    session,
    autonomous: true,
    status,
    safety_flags: status.safety_flags,
  };
});

app.get("/phantom-ai/media-lab/higgsfield/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const entitled = hasMediaLabAccess(session);
  const [health, providerStatus] = await Promise.all([
    callPhantomCut("/api/health"),
    callPhantomCut("/api/providers/higgsfield/status"),
  ]);

  return {
    ok: true,
    session,
    service: "PhantomForce Media Lab",
    provider: "higgsfield",
    commercial_provider: true,
    subscribed_access: entitled,
    admin_access: session.canManageAccess,
    client_visible_name: "Generate Video",
    phantomcut: {
      base_url: phantomCutBaseUrl(),
      reachable: health.ok,
      health_status: health.status,
      status: providerStatus.ok ? providerStatus.data : null,
      status_error: providerStatus.ok ? null : providerStatus.error,
      latency_ms: Math.max(health.latencyMs, providerStatus.latencyMs),
    },
    safety: {
      draft_only: true,
      paid_job_called: false,
      upload_performed: false,
      run_endpoint_exposed: false,
      explicit_confirmation_required: "RUN_HIGGSFIELD_PAID_JOB",
      no_public_posting: true,
    },
  };
});

app.get("/phantom-ai/creative-engine/tools", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  // Safe tool discovery for the Creative Engine: reports which creative
  // tools Hermes can broker (via the PhantomCut bridge that owns the
  // Higgsfield MCP/tool session). NEVER generates anything and NEVER
  // spends credits — this is a read-only preflight.
  const [health, providerStatus] = await Promise.all([
    callPhantomCut("/api/health"),
    callPhantomCut("/api/providers/higgsfield/status"),
  ]);

  const bridgeReachable = health.ok;

  return {
    ok: true,
    transport: "hermes_mcp",
    broker: {
      name: "phantomcut",
      base_url: phantomCutBaseUrl(),
      reachable: bridgeReachable,
      provider_status: providerStatus.ok ? providerStatus.data : null,
      provider_status_error: providerStatus.ok ? null : providerStatus.error,
    },
    tools: [
      {
        name: "higgsfield.draft",
        available: bridgeReachable && hasMediaLabAccess(session),
        credit_spend: false,
        route: "POST /phantom-ai/media-lab/higgsfield/draft",
        note: "Creates a draft in the owner's Higgsfield studio. Draft-only — the paid render is approved separately.",
      },
      {
        name: "higgsfield.render",
        available: false,
        credit_spend: true,
        route: null,
        note: "Not exposed. PhantomCut gates paid renders behind the explicit RUN_HIGGSFIELD_PAID_JOB confirmation; Hermes intentionally has no auto-spend route.",
      },
    ],
    approval_required: true,
    safety: {
      generated_during_preflight: false,
      paid_job_called: false,
      upload_performed: false,
    },
  };
});

app.get("/phantom-ai/media-lab/image-toolchain/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const status = getMediaLabImageToolchainStatus();

  if (!session.canManageAccess) {
    return {
      ok: true,
      session,
      admin_access: false,
      image_toolchain: clientSafeMediaLabImageToolchainStatus(status),
    };
  }

  return {
    ok: true,
    session,
    admin_access: true,
    image_toolchain: status,
  };
});

app.post("/phantom-ai/media-lab/higgsfield/draft", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  if (!hasMediaLabAccess(session)) {
    return reply.code(403).send({
      ok: false,
      error: "Media Lab video generation is not enabled for this workspace.",
      provider_called: false,
      paid_job_called: false,
      upload_performed: false,
    });
  }

  const parsed = HiggsfieldDraftSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
      provider_called: false,
      paid_job_called: false,
      upload_performed: false,
    });
  }

  const draft = await callPhantomCut("/api/jobs/higgsfield/draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...parsed.data,
      explicit_confirmation: "",
    }),
  });

  if (!draft.ok) {
    return reply.code(draft.status).send({
      ok: false,
      error: draft.error,
      provider: "higgsfield",
      phantomcut_reachable: draft.status !== 503,
      provider_called: false,
      paid_job_called: false,
      upload_performed: false,
    });
  }

  return {
    ok: true,
    provider: "higgsfield",
    commercial_provider: true,
    action: "draft_only",
    draft: draft.data,
    safety: {
      paid_job_called: false,
      upload_performed: false,
      run_endpoint_exposed: false,
      explicit_confirmation_required: "RUN_HIGGSFIELD_PAID_JOB",
      note: "This dashboard creates the Higgsfield draft only. Running a paid/upload generation remains separately gated inside PhantomCut.",
    },
  };
});

app.post("/phantom-ai/security/scan/preview", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = SecurityScanRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
      scanner: getSecurityScannerStatus(),
      safety_flags: {
        local_only: true,
        destructive_action: false,
        quarantine_performed: false,
        external_scan_provider_called: false,
        upload_performed: false,
        raw_content_returned: false,
      },
    });
  }

  const result = runSecurityScanPreview(parsed.data);

  return {
    ok: true,
    session,
    read_only: true,
    scanner: getSecurityScannerStatus(),
    result,
    provider_called: false,
    external_api_call_performed: false,
    upload_performed: false,
    destructive_action: false,
  };
});

app.get("/phantom-ai/ops/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const [providerStatus, ledgerStatus, interactionMemoryStatus, toolLaneStatus] = await Promise.all([
    Promise.resolve(getProviderSetupStatus()),
    getHermesLedgerStatus(),
    getHermesInteractionMemoryStoreStatus(),
    buildToolLanePreview({ toolId: "n8n" }),
  ]);
  const localGlmModelId =
    process.env.PHANTOM_LOCAL_GLM_MODEL?.trim() ||
    process.env.PHANTOM_OLLAMA_MODEL?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    "hf.co/unsloth/GLM-5.2-GGUF:UD-IQ1_S";
  const localGlmFallbackModelId =
    process.env.PHANTOM_OLLAMA_FALLBACK_MODEL?.trim() ||
    process.env.PHANTOM_LOCAL_GLM_FALLBACK_MODEL?.trim() ||
    null;
  const localGlmMode =
    process.env.PHANTOM_MODEL_ROUTER_MODE === "local" ||
    Boolean(process.env.OLLAMA_BASE_URL?.trim()) ||
    Boolean(process.env.PHANTOM_LOCAL_GLM_MODEL?.trim());

  return {
    ok: true,
    session,
    read_only: true,
    generated_at: new Date().toISOString(),
    status: {
      product_status: "Online - protected",
      hermes: {
        ready: providerStatus.hermes.ledger_enabled && providerStatus.hermes.context_compiler_enabled,
        status: providerStatus.hermes.status,
        ledger_enabled: providerStatus.hermes.ledger_enabled,
        context_compiler_enabled: providerStatus.hermes.context_compiler_enabled,
        ledger_exists: ledgerStatus.exists,
        ledger_bytes: ledgerStatus.bytes,
        interaction_memory_store_enabled: interactionMemoryStatus.enabled,
        interaction_memory_store_exists: interactionMemoryStatus.exists,
        interaction_memory_store_bytes: interactionMemoryStatus.bytes,
        local_dev_only: interactionMemoryStatus.local_dev_only,
        production_write_allowed: interactionMemoryStatus.production_write_allowed,
      },
      glm_worker: {
        configured: localGlmMode || providerStatus.openrouter_glm.configured,
        model_id: localGlmMode ? localGlmModelId : providerStatus.openrouter_glm.model_id,
        live_transport_enabled: localGlmMode || providerStatus.openrouter_glm.live_transport_enabled,
        live_call_ready: localGlmMode || providerStatus.openrouter_glm.live_call_ready,
        status: localGlmMode ? "local_configured" : providerStatus.openrouter_glm.live_call_ready ? "ready" : "gated_or_off",
        key_present_masked_boolean: localGlmMode ? false : providerStatus.openrouter_glm.configured,
        setup_required: localGlmMode ? [] : providerStatus.openrouter_glm.setup_required,
        payment_setup_needed: localGlmMode ? false : providerStatus.openrouter_glm.payment_setup_needed,
        detail: localGlmMode
          ? `GLM lane is routed to localhost Ollama. Target: ${localGlmModelId}${localGlmFallbackModelId ? `; fallback: ${localGlmFallbackModelId}` : ""}. OpenRouter is not required.`
          : providerStatus.openrouter_glm.live_call_ready
            ? "GLM worker lane is admin-selected and live flags are enabled."
            : "GLM worker lane is gated/off unless admin env flags and provider readiness are enabled.",
      },
      tool_lane_status: {
        status: toolLaneStatus.status,
        selected_tool_id: toolLaneStatus.selected_tool?.id ?? toolLaneStatus.requested_tool_id,
        selected_tool_name: toolLaneStatus.selected_tool?.display_name ?? null,
        allowed_mode: toolLaneStatus.allowed_mode,
        execution_disabled: toolLaneStatus.execution_disabled,
        would_run: toolLaneStatus.would_run,
        reason: toolLaneStatus.reason,
        blocked_actions: toolLaneStatus.blocked_actions,
      },
      n8n: {
        n8n_scaffolded: toolLaneStatus.n8n_status.n8n_scaffolded,
        n8n_running: toolLaneStatus.n8n_status.n8n_running,
        n8n_local_url: toolLaneStatus.n8n_status.n8n_local_url,
        n8n_host: toolLaneStatus.n8n_status.n8n_host,
        n8n_port: toolLaneStatus.n8n_status.n8n_port,
        health_check: toolLaneStatus.n8n_status.health_check,
        workflow_drafts: toolLaneStatus.n8n_status.workflow_drafts.map((workflow) => ({
          id: workflow.id,
          exists: workflow.exists,
          active: workflow.active,
        })),
        public_webhooks_allowed: toolLaneStatus.n8n_status.public_webhooks_allowed,
        credentials_configured: toolLaneStatus.n8n_status.credentials_configured,
      },
      chicagoshots_ops: {
        available: true,
        route: "POST /phantom-ai/ops/chicagoshots/lead-intake/preview",
        crm_route: "GET /phantom-ai/ops/chicagoshots/nexprospex-crm",
        history_routes: [
          "POST /phantom-ai/ops/chicagoshots/proposal-history/save",
          "GET /phantom-ai/ops/chicagoshots/proposal-history",
          "GET /phantom-ai/ops/chicagoshots/proposal-history/:id",
          "PATCH /phantom-ai/ops/chicagoshots/proposal-history/:id/status",
        ],
        workflow_preview_enabled: true,
        nexprospex_crm_enabled: true,
        nexprospex_crm_workspace_scoped: true,
        proposal_history_enabled: true,
        proposal_history_local_only: true,
        dry_run_only: true,
        provider_called: false,
        external_send: false,
        n8n_executed: false,
        queue_written: false,
        approval_executed: false,
      },
      send_readiness: getSendReadinessStatus(),
      deployment_model: buildDeploymentModelStatus({ audience: "admin" }),
      safety_flags: {
        approvals_execute_absent: true,
        execution_disabled: true,
        external_sends_disabled: true,
        queue_writes_disabled: true,
        production_ledger_writes_disabled: true,
        provider_called: false,
        live_provider_called: false,
        provider_request_body_created: false,
        provider_transport_allowed: false,
        external_api_call_performed: false,
        workflow_executed: false,
        n8n_started: false,
        public_webhook_opened: false,
        credentials_used: false,
        approval_executed: false,
        queue_written: false,
        production_ledger_written: false,
        localhost_status_check_performed: toolLaneStatus.n8n_status.health_check === "localhost_tcp_probe",
      },
    },
  };
});

app.post("/phantom-ai/tool-lane/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as { tool_id?: unknown };
  const preview = await buildToolLanePreview({
    toolId: typeof body.tool_id === "string" ? body.tool_id : null,
  });

  return {
    ok: true,
    session,
    dry_run: true,
    execution_disabled: true,
    would_run: false,
    n8n_scaffolded: preview.n8n_status.n8n_scaffolded,
    n8n_running: preview.n8n_status.n8n_running,
    n8n_local_url: preview.n8n_status.n8n_local_url,
    n8n_started: false,
    public_webhook_opened: false,
    credentials_used: false,
    external_call_performed: false,
    network_call_performed: false,
    workflow_executed: false,
    provider_called: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_written: false,
    preview,
  };
});

async function handleOwnerMemoryStatus(request: FastifyRequest, reply: FastifyReply) {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { q?: string; limit?: string } | undefined;
  const ownerMemoryRaw = await buildOwnerCodexMemoryStatus({
    query: query?.q,
    limit: query?.limit,
  });
  const owner_memory = {
    ...ownerMemoryRaw,
    access_model: {
      ...ownerMemoryRaw.access_model,
      raw_operator_internal_memory_exposed: ownerMemoryRaw.access_model.raw_codex_internal_memory_exposed,
      sanitized_local_operator_artifacts_exposed: ownerMemoryRaw.access_model.sanitized_local_codex_artifacts_exposed,
    },
  };

  return {
    ok: true,
    session,
    owner_memory,
    provider_called: false,
    network_call_performed: false,
    upload_send_post: false,
    credentials_returned: false,
  };
}

app.get("/phantom-ai/admin/owner-memory/status", handleOwnerMemoryStatus);
app.get("/phantom-ai/admin/codex-memory/status", handleOwnerMemoryStatus);

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
    memory_scope: buildMemoryScopeProof(normalized),
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
    memory_scope: buildMemoryScopeProof(normalized),
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

app.post("/phantom-ai/chat", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = (request.body ?? {}) as {
    provider?: unknown;
    admin_model?: unknown;
    model_lane?: unknown;
    message?: unknown;
    tenant_id?: unknown;
    business_name?: unknown;
    actor_user_id?: unknown;
    request_id?: unknown;
    task_type?: unknown;
    sensitivity_level?: unknown;
    execution_mode?: unknown;
    user_request?: unknown;
    business_summary?: unknown;
    module_data?: unknown;
  };
  const providerChoice = parsePhantomAiChatProvider(body.provider);

  if (providerChoice === "openrouter_glm" && !session.canManageAccess) {
    return reply.code(403).send({
      ok: false,
      error: "OpenRouter GLM is admin-only in this local setup.",
      provider_choice: providerChoice,
      provider_called: false,
      network_call_performed: false,
      approval_executed: false,
      queue_written: false,
    });
  }

  const userMessage =
    typeof body.message === "string" && body.message.trim()
      ? body.message
      : typeof body.user_request === "string"
        ? body.user_request
        : "Summarize the current PhantomForce workspace.";
  const normalized = buildModelRouterRequestFromBody(
    {
      ...body,
      user_request: userMessage,
    },
    session,
    "chat",
  );
  const chatMemoryKey = buildChatMemoryKey(session, normalized);
  const privacyFirstLocationReply = await buildPrivacyFirstLocationReply(normalized.user_request, session, chatMemoryKey);

  if (privacyFirstLocationReply) {
    return privacyFirstLocationReply;
  }

  if (session.canManageAccess) {
    const adminModelLane = parseAdminPhantomAiModelLane(body.admin_model ?? body.model_lane ?? body.provider);
    const adminProviderRoute = adminPhantomAiProviderRoute(adminModelLane);
    const adminModelLabel = adminPhantomAiModelLabel(adminModelLane);
    const adminExecutionMode = body.execution_mode === "auto" ? "auto" : "approval";
    if (/^(hey|hi|hello|yo|sup|gm|gn|good morning|good afternoon|good evening|what'?s up|wassup|you there|u there)[\s.!?]*$/i.test(normalized.user_request.trim())) {
      return {
        ok: true,
        session,
        provider_choice: "phantom",
        admin_model_lane: publicAdminPhantomAiModelLane(adminModelLane),
        admin_model_label: adminModelLabel,
        model_id: "phantom-instant-router",
        message: {
          role: "assistant",
          content: "Hey Jordan. What do you want handled?",
        },
        provider_request_body_created: false,
        live_provider_called: false,
        network_call_performed: false,
        approval_executed: false,
        queue_written: false,
        production_ledger_write: false,
        payment_request_created: false,
        invoice_created: false,
        memory_scope: buildMemoryScopeProof(normalized),
      };
    }
    const preview = previewModelRouterFoundation(normalized, {
      env: {
        ...process.env,
        PHANTOM_MODEL_ROUTER_MODE: adminProviderRoute === "claude" ? "claude" : "local",
        PHANTOM_LOCAL_MODEL_AVAILABLE: adminProviderRoute === "local" ? "true" : process.env.PHANTOM_LOCAL_MODEL_AVAILABLE,
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
      },
    });
    const memoryContext = await buildHermesMemoryContextPreview({
      tenant_id: normalized.tenant_id,
      business_name: normalized.business_name,
      actor_user_id: normalized.actor_user_id,
      request_id: normalized.request_id,
      task_type: normalized.task_type,
      sensitivity_level: preview.decision.sensitivity_level,
      provider_route: adminProviderRoute,
      user_request: normalized.user_request,
      business_summary: normalized.business_summary,
      module_data: normalized.module_data,
    });
    const approvalRequired = preview.decision.approval_required || preview.action_preview.approval_required;
    const adminResult =
      adminModelLane === "glm_5_2"
        ? process.env.PHANTOM_FORCE_OPENROUTER_GLM === "true"
          ? {
              lane: adminModelLane,
              model_id: await callOpenRouterGlm52(
                {
                  requestId: normalized.request_id,
                  businessName: normalized.business_name,
                  taskType: normalized.task_type,
                  userMessage: normalized.user_request,
                  compactContext: memoryContext.augmented_context_preview,
                  sensitivityLevel: preview.decision.sensitivity_level,
                  approvalRequired,
                  executionMode: adminExecutionMode,
                  adminOperatorLane: true,
                },
                {
                  env: {
                    ...process.env,
                    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
                    PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
                  },
                },
              ),
            }
          : {
              lane: adminModelLane,
              model_id: await callLocalOllamaChat(
                {
                  requestId: normalized.request_id,
                  businessName: normalized.business_name,
                  taskType: normalized.task_type,
                  userMessage: normalized.user_request,
                  compactContext: memoryContext.augmented_context_preview,
                  sensitivityLevel: preview.decision.sensitivity_level,
                  approvalRequired,
                  executionMode: adminExecutionMode,
                  adminOperatorLane: true,
                },
                {
                  env: {
                    ...process.env,
                    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
                    PHANTOM_LOCAL_MODEL_AVAILABLE: "true",
                  },
                },
              ),
            }
        : adminModelLane === "claude_cli"
          ? {
              lane: adminModelLane,
              model_id: await callClaudeCliChat({
                requestId: normalized.request_id,
                businessName: normalized.business_name,
                taskType: normalized.task_type,
                userMessage: normalized.user_request,
                compactContext: memoryContext.augmented_context_preview,
                sensitivityLevel: preview.decision.sensitivity_level,
                approvalRequired,
                executionMode: adminExecutionMode,
              }),
            }
          : {
              lane: adminModelLane,
              model_id: await callCodexCliChat({
                requestId: normalized.request_id,
                businessName: normalized.business_name,
                taskType: normalized.task_type,
                userMessage: normalized.user_request,
                compactContext: memoryContext.augmented_context_preview,
                approvalRequired,
                executionMode: adminExecutionMode,
                cwd: process.cwd(),
              }),
            };
    const modelResult = adminResult.model_id;
    const resultStatus = "status" in modelResult ? modelResult.status : "called";
    const resultError =
      "error_message" in modelResult && typeof modelResult.error_message === "string"
        ? modelResult.error_message
        : null;
    const resultBlocked =
      "blocked_reason" in modelResult && typeof modelResult.blocked_reason === "string"
        ? modelResult.blocked_reason
        : null;
    const resultOutput = "output_text" in modelResult ? modelResult.output_text : "";
    const toolExecuted = "tool_executed" in modelResult ? modelResult.tool_executed : false;
    const toolName = "tool_name" in modelResult ? modelResult.tool_name : null;
    const providerCalled = "provider_called" in modelResult ? modelResult.provider_called : false;
    const networkCallPerformed =
      "network_call_performed" in modelResult ? modelResult.network_call_performed : providerCalled;
    const requestBodyPrepared = "request_body_prepared" in modelResult ? modelResult.request_body_prepared : false;
    const ledgerRecord: HermesLedgerRecord = {
      timestamp: new Date().toISOString(),
      tenant_id: normalized.tenant_id,
      business_name: normalized.business_name,
      actor_user_id: normalized.actor_user_id,
      actor_role: normalized.actor_role,
      request_id: normalized.request_id,
      task_type: normalized.task_type,
      sensitivity_level: preview.decision.sensitivity_level,
      provider_route: adminProviderRoute,
      model_id: modelResult.model_id,
      context_chars: memoryContext.augmented_context_chars,
      estimated_tokens: Math.ceil(memoryContext.augmented_context_chars / 4),
      estimated_cost_usd: null,
      user_request_summary: redactSensitiveText(normalized.user_request).replace(/\s+/g, " ").slice(0, 240),
      result_summary: redactSensitiveText(
        toolExecuted
          ? `${adminModelLabel} executed ${toolName ?? "tool"} and returned a receipt.`
          : providerCalled
            ? `${adminModelLabel} returned a Hermes-backed admin response.`
            : `${adminModelLabel} did not complete: ${resultBlocked ?? resultError ?? resultStatus}`,
      ).slice(0, 360),
      approval_required: approvalRequired,
      approval_status: approvalRequired ? "pending" : "not_required",
      risks: preview.decision.risks.map((risk) => redactSensitiveText(risk)).slice(0, 8),
      next_action: toolExecuted
        ? "Review the operator receipt in Phantom AI."
        : `Continue in Phantom AI with ${adminModelLabel} or switch admin model lanes.`,
      agent_run_id: `phantom-ai-admin-${adminModelLane}-${normalized.request_id}`,
      parent_task_id: normalized.request_id,
    };

    await appendHermesLedgerRecord(ledgerRecord);

    return {
      ok: true,
      session,
      provider_choice: "phantom",
      admin_model_lane: publicAdminPhantomAiModelLane(adminModelLane),
      admin_model_label: adminModelLabel,
      admin_execution_mode: adminExecutionMode,
      model_id: adminModelLane === "codex" ? "phantom-private-brain" : modelResult.model_id,
      message: {
        role: "assistant",
        content: resultError ? `${resultOutput}\n\n${adminModelLabel} error: ${resultError}` : resultOutput,
      },
      operator:
        adminModelLane === "codex" && "tool_requested" in modelResult
          ? {
              status: modelResult.status,
              admin_only: modelResult.admin_only,
              localhost_only: modelResult.localhost_only,
              tool_requested: modelResult.tool_requested,
              tool_executed: modelResult.tool_executed,
              tool_name: modelResult.tool_name,
              tool_result: modelResult.tool_result,
            }
          : null,
      private_brain:
        adminModelLane === "codex" && "provider_id" in modelResult && modelResult.provider_id === "codex_cli"
          ? {
              status: modelResult.status,
              model_id: "phantom-private-brain",
              seconds: modelResult.seconds,
              admin_only: modelResult.admin_only,
              localhost_only: modelResult.localhost_only,
              approval_executed: modelResult.approval_executed,
              external_action_executed: modelResult.external_action_executed,
              queue_written: modelResult.queue_written,
              ledger_written: modelResult.ledger_written,
            }
          : null,
      openrouter:
        adminModelLane === "glm_5_2" && "provider_id" in modelResult && modelResult.provider_id === "openrouter_glm"
          ? modelResult
          : null,
      local_ollama:
        adminModelLane === "glm_5_2" && "provider_id" in modelResult && modelResult.provider_id === "local_ollama"
          ? modelResult
          : null,
      claude_cli: adminModelLane === "claude_cli" ? modelResult : null,
      hermes: {
        context_used: true,
        ledger_written: true,
        provider_route: adminProviderRoute,
        recalled_memory_count: memoryContext.memory.recalled_count,
      },
      memory_scope: buildMemoryScopeProof(normalized),
      memory_context: {
        scope: memoryContext.scope,
        recalled_memory_count: memoryContext.memory.recalled_count,
        compact_context_chars: memoryContext.augmented_context_chars,
        redaction: memoryContext.redaction,
      },
      ledger_record: redactHermesLedgerRecord(ledgerRecord),
      provider_request_body_created: requestBodyPrepared,
      live_provider_called: providerCalled,
      network_call_performed: networkCallPerformed,
      approval_executed: false,
      queue_written: false,
      external_action_executed: false,
    };
  }

  const shouldTryGlmChat = providerChoice === "openrouter_glm" && process.env.PHANTOM_FORCE_OPENROUTER_GLM === "true";

  if (shouldTryGlmChat) {
    const preview = previewModelRouterFoundation(normalized, {
      env: {
        ...process.env,
        PHANTOM_MODEL_ROUTER_MODE: "openrouter",
      },
    });
    const memoryContext = await buildHermesMemoryContextPreview({
      tenant_id: normalized.tenant_id,
      business_name: normalized.business_name,
      actor_user_id: normalized.actor_user_id,
      request_id: normalized.request_id,
      task_type: normalized.task_type,
      sensitivity_level: preview.decision.sensitivity_level,
      provider_route: "openrouter_glm",
      user_request: normalized.user_request,
      business_summary: normalized.business_summary,
      module_data: normalized.module_data,
    });
    const approvalRequired = preview.decision.approval_required || preview.action_preview.approval_required;
    const openrouter = await callOpenRouterGlm52(
      {
        requestId: normalized.request_id,
        businessName: normalized.business_name,
        taskType: normalized.task_type,
        userMessage: normalized.user_request,
        compactContext: memoryContext.augmented_context_preview,
        sensitivityLevel: preview.decision.sensitivity_level,
        approvalRequired,
      },
      {
        env: {
          ...process.env,
          PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
          PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
        },
      },
    );
    const ledgerRecord: HermesLedgerRecord = {
      timestamp: new Date().toISOString(),
      tenant_id: normalized.tenant_id,
      business_name: normalized.business_name,
      actor_user_id: normalized.actor_user_id,
      actor_role: normalized.actor_role,
      request_id: normalized.request_id,
      task_type: normalized.task_type,
      sensitivity_level: preview.decision.sensitivity_level,
      provider_route: "openrouter_glm",
      model_id: openrouter.model_id,
      context_chars: memoryContext.augmented_context_chars,
      estimated_tokens: Math.ceil(memoryContext.augmented_context_chars / 4),
      estimated_cost_usd: null,
      user_request_summary: redactSensitiveText(normalized.user_request).replace(/\s+/g, " ").slice(0, 240),
      result_summary: redactSensitiveText(
        openrouter.provider_called
          ? "GLM 5.2 responded through OpenRouter for an admin-selected Phantom AI chat."
          : `GLM 5.2 did not run: ${openrouter.blocked_reason ?? openrouter.error_message ?? "blocked"}`,
      ).slice(0, 360),
      approval_required: approvalRequired,
      approval_status: approvalRequired ? "pending" : "not_required",
      risks: preview.decision.risks.map((risk) => redactSensitiveText(risk)).slice(0, 8),
      next_action: openrouter.provider_called
        ? "Review the GLM 5.2 draft inside Phantom AI. External actions still require approval."
        : "Finish OpenRouter server setup, then retry the admin-selected GLM 5.2 lane.",
      agent_run_id: `phantom-ai-chat-${normalized.request_id}`,
      parent_task_id: normalized.request_id,
    };

    await appendHermesLedgerRecord(ledgerRecord);

    if (!openrouter.provider_called || !openrouter.output_text.trim()) {
      if (providerChoice === "openrouter_glm") {
        return {
          ok: true,
          session,
          provider_choice: "phantom",
          model_id: "phantomforce-managed-fallback",
          message: {
            role: "assistant",
            content: buildPhantomAiWorkspaceReply(normalized.user_request, normalized.business_name),
          },
          openrouter: {
            status: openrouter.status,
            blocked_reason: openrouter.blocked_reason,
            error_message: openrouter.error_message,
            provider_called: openrouter.provider_called,
            network_call_performed: openrouter.network_call_performed,
          },
          memory_context: {
            scope: memoryContext.scope,
            recalled_memory_count: memoryContext.memory.recalled_count,
            compact_context_chars: memoryContext.augmented_context_chars,
            redaction: memoryContext.redaction,
          },
          memory_scope: buildMemoryScopeProof(normalized),
          ledger_record: redactHermesLedgerRecord(ledgerRecord),
          provider_request_body_created: openrouter.request_body_prepared,
          live_provider_called: false,
          network_call_performed: openrouter.network_call_performed,
          approval_executed: false,
          queue_written: false,
          external_action_executed: false,
        };
      }
    }

    if (openrouter.provider_called && openrouter.output_text.trim()) {
      return {
      ok: true,
      session,
      provider_choice: "phantom",
      model_id: openrouter.model_id,
      message: {
        role: "assistant",
        content: openrouter.output_text,
      },
      openrouter,
      memory_context: {
        scope: memoryContext.scope,
        recalled_memory_count: memoryContext.memory.recalled_count,
        compact_context_chars: memoryContext.augmented_context_chars,
        redaction: memoryContext.redaction,
      },
      memory_scope: buildMemoryScopeProof(normalized),
      ledger_record: redactHermesLedgerRecord(ledgerRecord),
      provider_request_body_created: openrouter.request_body_prepared,
      live_provider_called: openrouter.provider_called,
      network_call_performed: openrouter.network_call_performed,
      approval_executed: false,
      queue_written: false,
      external_action_executed: false,
      };
    }
  }

  const result = await runModelRouterFoundation(normalized);
  const interactionMemory = await recordHermesInteractionMemoryFromRun(result);
  const protectedResponse = buildPhantomAiWorkspaceReply(normalized.user_request, normalized.business_name);

  return {
    ok: true,
    session,
    provider_choice: providerChoice,
    model_id: result.decision.model_id,
    message: {
      role: "assistant",
      content: protectedResponse,
    },
    decision: result.decision,
    ledger_record: redactHermesLedgerRecord(result.ledger_record),
    interaction_memory: interactionMemory,
    memory_scope: buildMemoryScopeProof(normalized),
    provider_request_body_created: false,
    live_provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    queue_written: false,
    external_action_executed: false,
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
  const interaction_memory = await recordHermesInteractionMemoryFromRun(result);

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
    interaction_memory,
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

export { app };

let stopAutonomousSecurityScanner: (() => void) | null = null;

app.addHook("onClose", async () => {
  stopAutonomousSecurityScanner?.();
  stopAutonomousSecurityScanner = null;
});

if (process.env.PHANTOMFORCE_SERVER_LISTEN !== "false") {
  try {
    await app.listen({ host, port });
    stopAutonomousSecurityScanner = startAutonomousSecurityScanScheduler(app.log);
    app.log.info(`PhantomForce server listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
