import "./load-env.js";

import cors from "@fastify/cors";
import {
  ACTION_SCHEMAS,
  ActionSchema,
  FALCON_JOB_SCHEMAS,
  FalconJobSchema,
} from "@phantomforce/contracts";
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
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { getFinanceConnectorStatus } from "./connectors/finance-connector.js";
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
  activateVacationMode,
  cancelVacationOperatorTask,
  createVacationOperatorTask,
  deactivateVacationMode,
  decideVacationApproval,
  getVacationModeActivity,
  getVacationModeApprovals,
  getVacationModeStatus,
  getVacationOperatorTasks,
  runVacationModeCheckIn,
  startVacationModeEngine,
  updateVacationOperatorTask,
  updateVacationModeSettings,
} from "./phantom-ai/vacation-mode.js";
import {
  getAutonomousSecurityScanStatus,
  startAutonomousSecurityScanScheduler,
} from "./phantom-ai/security-scan-scheduler.js";
import {
  listAutomationJobs,
  runAutomationJobNow,
  setAutomationJobEnabled,
  startAutomationEngine,
} from "./phantom-ai/automation-engine.js";
import {
  getAgentRun,
  listAgentRunOperations,
  listAgentRuns,
  requestAgentRunCancel,
  startAgentRun,
} from "./phantom-ai/agent-runs.js";
import { getContentAssetStorageProvider } from "./phantom-ai/content-asset-storage.js";
import {
  addAssetToCollection,
  archivePreset,
  createCollection,
  createPreset,
  createPresetVersion,
  getAssetById as getVaultAssetById,
  getPresetById,
  listAssetsInCollection,
  listCollections,
  listPresets,
  listTagsForAsset,
  searchAssets,
  setAssetArchived,
  setAssetFavorite,
  setAssetPinned,
  tagAsset,
  untagAsset,
  type AssetSearchQuery,
} from "./phantom-ai/asset-db.js";
import { getCacheStats, previewCleanup, runCleanup } from "./phantom-ai/asset-cache-manager.js";
import {
  getProviderSetupStatus,
  previewModelRouterFoundation,
  runModelRouterFoundation,
} from "./phantom-ai/model-router.js";
import {
  clientSafeMediaLabImageToolchainStatus,
  getMediaLabImageToolchainStatus,
} from "./phantom-ai/media-lab-image-toolchain.js";
import {
  appendBrainEvent,
  buildBrainStatus,
  composeBrainContext,
  createBrainMemory,
  forgetBrainMemory,
  listBrainMemories,
  recordBrainFeedback,
  updateBrainMemory,
  type BrainStoreOptions,
} from "./phantom-ai/neural-spine.js";
import { detectRembg, runRembgRemoveBackground } from "./phantom-ai/rembg-bridge.js";
import {
  controlWindowsMedia,
  getWindowsMediaStatus,
  isWindowsMediaCommand,
} from "./phantom-ai/windows-media-session.js";
import { callClaudeCliChat } from "./phantom-ai/providers/claude-cli-transport.js";
import { callCodexCliChat } from "./phantom-ai/providers/codex-cli-transport.js";
import { callLocalOllamaChat } from "./phantom-ai/providers/local-ollama-transport.js";
import { callOpenRouterGlm52 } from "./phantom-ai/providers/openrouter-live-transport.js";
import {
  adminProviderAttemptOrder,
  getAdminProviderManagerStatus,
  recordAdminProviderFailure,
  recordAdminProviderSuccess,
  startAdminProviderHealthMonitor,
  type AdminProviderId,
} from "./phantom-ai/admin-provider-manager.js";
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

const BrainMemoryCreateSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  text: z.string().trim().min(1).max(1200),
  type: z.string().trim().max(40).optional(),
  confidence: z.number().min(0.05).max(1).optional(),
  weight: z.number().min(0.05).max(1).optional(),
  source: z.string().trim().max(80).optional(),
});

const BrainMemoryPatchSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  text: z.string().trim().min(1).max(1200).optional(),
  type: z.string().trim().max(40).optional(),
  confidence: z.number().min(0.05).max(1).optional(),
  weight: z.number().min(0.05).max(1).optional(),
  active: z.boolean().optional(),
});

const BrainFeedbackSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  kind: z.string().trim().max(80).optional(),
  text: z.string().trim().max(1200).optional(),
  targetId: z.string().trim().max(160).optional(),
  useful: z.boolean().optional(),
  surface: z.string().trim().max(60).optional(),
});

const BrainContextPreviewSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  message: z.string().max(1600).optional(),
  surface: z.string().trim().max(60).optional(),
  proposedActionType: z.string().trim().max(80).optional(),
  currentModule: z.string().trim().max(80).optional(),
});

const BrainEventSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  surface: z.string().trim().max(60).optional(),
  type: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(320),
  linkedRunId: z.string().trim().max(140).optional(),
  outcome: z.string().trim().max(80).optional(),
  importance: z.enum(["low", "medium", "high"]).optional(),
  safeForMemory: z.boolean().optional(),
  source: z.string().trim().max(80).optional(),
  metadata: z.record(z.unknown()).optional(),
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

/* ---- Higgsfield MCP through the operator brain ----
   The Higgsfield MCP is registered with the operator CLI (codex) on this
   box — PhantomCut is retired. Drafts run as a strict machine task through
   the operator: draft/queue only, never a paid render, JSON receipt only. */
let lastHiggsfieldMcpDraftAt: string | null = null;

function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    const candidate = raw.slice(start, end);
    if (!candidate.endsWith("}")) continue;
    try { return JSON.parse(candidate) as Record<string, unknown>; } catch { /* keep shrinking */ }
  }
  return null;
}

async function runHiggsfieldMcpDraft(params: Record<string, unknown>): Promise<
  { ok: true; draft: Record<string, unknown> } | { ok: false; error: string }
> {
  const instruction = [
    "MEDIA DRAFT REQUEST — machine task, not conversation.",
    "Use your available Higgsfield MCP tools to create a DRAFT generation only.",
    "HARD RULES: draft/queue only. Do NOT run a paid render. Do NOT spend credits. Do NOT publish, post, or upload anything.",
    `Draft parameters JSON: ${JSON.stringify(params)}`,
    "After the tool call, respond with ONLY one JSON object and no other text:",
    '{"ok":true,"draft":{"id":"<draft id or name>","status":"queued","tool":"<mcp tool used>","notes":"<one short line>"}}',
    'If no Higgsfield MCP tools are available to you, respond ONLY with: {"ok":false,"error":"no_higgsfield_mcp_tools"}',
    'If the tool call fails, respond ONLY with: {"ok":false,"error":"<short reason>"}',
  ].join("\n");

  try {
    const result = await callCodexCliChat({
      requestId: `hf-mcp-draft-${Date.now().toString(36)}`,
      businessName: "PhantomForce",
      taskType: "media_draft",
      userMessage: instruction,
      compactContext: "",
      approvalRequired: false,
      executionMode: "approval",
      cwd: process.cwd(),
    });
    const output = "output_text" in result ? String(result.output_text || "") : "";
    const parsed = extractFirstJsonObject(output);
    if (!parsed) {
      return { ok: false, error: `operator returned no JSON receipt (${output.replace(/\s+/g, " ").slice(0, 120) || "empty output"})` };
    }
    if (parsed.ok === true && parsed.draft && typeof parsed.draft === "object") {
      return { ok: true, draft: parsed.draft as Record<string, unknown> };
    }
    return { ok: false, error: String(parsed.error || "mcp draft failed").slice(0, 200) };
  } catch (error) {
    return { ok: false, error: `operator lane error: ${String(error instanceof Error ? error.message : error).slice(0, 160)}` };
  }
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
  const trimmed = value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_MEMORY_SCOPE_ID_CHARS);
  return trimmed || fallback;
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

function brainStoreOptionsForSession(session: AccessSession, carrier?: { tenant_id?: unknown }): BrainStoreOptions {
  const requestedTenantId = cleanMemoryScopeId(carrier?.tenant_id);
  return {
    tenantId: session.canManageAccess ? requestedTenantId || OWNER_MEMORY_TENANT_ID : tenantIdForAccessSession(session),
  };
}

function brainScopeProofForSession(session: AccessSession, carrier?: { tenant_id?: unknown }) {
  const requestedTenantId = cleanMemoryScopeId(carrier?.tenant_id);
  const tenantId = session.canManageAccess ? requestedTenantId || OWNER_MEMORY_TENANT_ID : tenantIdForAccessSession(session);
  return {
    tenant_id: tenantId,
    requested_tenant_id: requestedTenantId || null,
    scope: session.canManageAccess
      ? tenantId === OWNER_MEMORY_TENANT_ID ? "owner_private" : "owner_selected_tenant"
      : "client_tenant_only",
    tenant_override_blocked: !session.canManageAccess && Boolean(requestedTenantId && requestedTenantId !== tenantId),
  };
}

function buildBrainContextModule(brainContext: Awaited<ReturnType<typeof composeBrainContext>>): ContextModuleData {
  return {
    module: "phantom_brain",
    summary: brainContext.microPrompt.slice(0, 320),
    items: [
      {
        title: `Intent: ${brainContext.suggestedIntent}`,
        status: brainContext.riskLevel,
        detail: brainContext.needsApproval ? "Approval gate active." : "Local/chat-safe.",
      },
      ...brainContext.relevantMemories.slice(0, 4).map((memory) => ({
        title: `${memory.type}: ${memory.text.slice(0, 72)}`,
        status: `confidence ${Math.round(memory.confidence * 100)}%`,
        detail: memory.reason,
      })),
    ],
  };
}

function buildBrainAugmentedSummary(
  normalized: { business_summary: string },
  brainContext: Awaited<ReturnType<typeof composeBrainContext>>,
) {
  return `${normalized.business_summary}\n\nPhantom Brain micro-context:\n${brainContext.microPrompt}`.slice(0, 1600);
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

/* Admin Phantom AI chat fallback chain -----------------------------------
   Jordan picks a lane in Settings, but a dead provider should not leave the
   chat silent or get retried on every prompt. The provider manager keeps
   failures offline, prefers the last healthy lane, and restores the chosen
   lane after background health recovery. Provider details stay in Developer. */
type AdminPhantomAiProviderId = AdminProviderId;

function adminPhantomAiProviderIdForLane(lane: AdminPhantomAiModelLane): AdminPhantomAiProviderId {
  if (lane === "claude_cli") return "claude_cli";
  if (lane === "glm_5_2") return process.env.PHANTOM_FORCE_OPENROUTER_GLM === "true" ? "openrouter_glm" : "local_ollama";
  return "codex_cli";
}

function adminPhantomAiLaneForProviderId(providerId: AdminPhantomAiProviderId): AdminPhantomAiModelLane {
  if (providerId === "claude_cli") return "claude_cli";
  if (providerId === "codex_cli") return "codex";
  return "glm_5_2";
}

function adminPhantomAiProviderLabel(providerId: AdminPhantomAiProviderId) {
  if (providerId === "codex_cli") return "Private Brain (Codex)";
  if (providerId === "claude_cli") return "Claude CLI";
  if (providerId === "openrouter_glm") return "OpenRouter GLM 5.2";
  return "Local GLM (Ollama)";
}

type AdminPhantomAiChatContext = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  executionMode: "approval" | "auto";
};

/* Fallback attempts get shorter per-provider timeouts than a direct single-lane
   call would use (Codex's own default is 120s). Admin chat may have to walk all
   four providers in one request, so each hop is capped tightly enough that the
   worst-case total stays inside the frontend's chat request timeout instead of
   quietly burning minutes before the user sees anything. */
const ADMIN_CHAT_FALLBACK_TIMEOUT_MS = {
  codex_cli: 30000,
  claude_cli: 30000,
  openrouter_glm: 20000,
  local_ollama: 25000,
} as const;

async function callAdminPhantomAiProvider(providerId: AdminPhantomAiProviderId, ctx: AdminPhantomAiChatContext) {
  if (providerId === "codex_cli") {
    return callCodexCliChat(
      {
        requestId: ctx.requestId,
        businessName: ctx.businessName,
        taskType: ctx.taskType,
        userMessage: ctx.userMessage,
        compactContext: ctx.compactContext,
        approvalRequired: ctx.approvalRequired,
        executionMode: ctx.executionMode,
        cwd: process.cwd(),
      },
      {
        env: {
          ...process.env,
          PHANTOM_CODEX_TIMEOUT_MS: String(ADMIN_CHAT_FALLBACK_TIMEOUT_MS.codex_cli),
        },
      },
    );
  }
  if (providerId === "claude_cli") {
    return callClaudeCliChat({
      requestId: ctx.requestId,
      businessName: ctx.businessName,
      taskType: ctx.taskType,
      userMessage: ctx.userMessage,
      compactContext: ctx.compactContext,
      sensitivityLevel: ctx.sensitivityLevel,
      approvalRequired: ctx.approvalRequired,
      executionMode: ctx.executionMode,
      timeoutMs: ADMIN_CHAT_FALLBACK_TIMEOUT_MS.claude_cli,
    });
  }
  if (providerId === "openrouter_glm") {
    return callOpenRouterGlm52(
      {
        requestId: ctx.requestId,
        businessName: ctx.businessName,
        taskType: ctx.taskType,
        userMessage: ctx.userMessage,
        compactContext: ctx.compactContext,
        sensitivityLevel: ctx.sensitivityLevel,
        approvalRequired: ctx.approvalRequired,
        executionMode: ctx.executionMode,
        adminOperatorLane: true,
      },
      {
        env: {
          ...process.env,
          PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
          PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
          PHANTOM_OPENROUTER_TIMEOUT_MS: String(ADMIN_CHAT_FALLBACK_TIMEOUT_MS.openrouter_glm),
        },
      },
    );
  }
  return callLocalOllamaChat(
    {
      requestId: ctx.requestId,
      businessName: ctx.businessName,
      taskType: ctx.taskType,
      userMessage: ctx.userMessage,
      compactContext: ctx.compactContext,
      sensitivityLevel: ctx.sensitivityLevel,
      approvalRequired: ctx.approvalRequired,
      executionMode: ctx.executionMode,
      adminOperatorLane: true,
    },
    {
      env: {
        ...process.env,
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
        PHANTOM_LOCAL_MODEL_AVAILABLE: "true",
        PHANTOM_OLLAMA_TIMEOUT_MS: String(ADMIN_CHAT_FALLBACK_TIMEOUT_MS.local_ollama),
      },
    },
  );
}

function isAdminPhantomAiResultUsable(result: { status: string }) {
  return result.status === "called";
}

function adminPhantomAiResultErrorMessage(result: Record<string, unknown>) {
  if (typeof result.error_message === "string" && result.error_message) return result.error_message;
  if (typeof result.blocked_reason === "string" && result.blocked_reason) return result.blocked_reason;
  return `status: ${String(result.status ?? "unknown")}`;
}

type AdminPhantomAiChatAttempt = {
  provider_id: AdminPhantomAiProviderId;
  status: string;
  error_message: string | null;
};

async function callAdminPhantomAiProviderSafe(providerId: AdminPhantomAiProviderId, ctx: AdminPhantomAiChatContext): Promise<any> {
  try {
    return await callAdminPhantomAiProvider(providerId, ctx);
  } catch (error) {
    return {
      provider_id: providerId,
      model_id: providerId,
      status: "error" as const,
      output_text: "",
      error_message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runAdminPhantomAiChatWithFallback(requestedLane: AdminPhantomAiModelLane, ctx: AdminPhantomAiChatContext) {
  const primaryProviderId = adminPhantomAiProviderIdForLane(requestedLane);
  const order = adminProviderAttemptOrder(primaryProviderId);
  const attempts: AdminPhantomAiChatAttempt[] = [];
  let providerId = primaryProviderId;
  let result: any = null;

  for (const candidate of order) {
    providerId = candidate;
    const startedAt = Date.now();
    result = await callAdminPhantomAiProviderSafe(providerId, ctx);
    const usable = isAdminPhantomAiResultUsable(result as { status: string });
    const latencyMs = Date.now() - startedAt;
    if (usable) recordAdminProviderSuccess(providerId, latencyMs);
    else recordAdminProviderFailure(providerId, adminPhantomAiResultErrorMessage(result as Record<string, unknown>), latencyMs);
    attempts.push({
      provider_id: providerId,
      status: (result as { status: string }).status,
      error_message: usable ? null : adminPhantomAiResultErrorMessage(result as Record<string, unknown>),
    });
    if (usable) {
      return { providerId, result, attempts, primaryProviderId, fallbackUsed: providerId !== primaryProviderId, allFailed: false };
    }
  }

  return { providerId, result: result ?? { status: "error", output_text: "", model_id: "phantom" }, attempts, primaryProviderId, fallbackUsed: true, allFailed: true };
}

function buildAdminPhantomAiAllProvidersFailedMessage() {
  return "I couldn't complete that just now. Your request is still here — try again in a moment.";
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
      provider_manager: getAdminProviderManagerStatus(),
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

app.get("/api/vacation-mode/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    ...(await getVacationModeStatus(session)),
  };
});

app.post("/api/vacation-mode/activate", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const result = await activateVacationMode(session, request.body ?? {});

  return {
    ok: true,
    session,
    ...result,
    external_send_performed: false,
    provider_call_performed: false,
  };
});

app.post("/api/vacation-mode/deactivate", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const result = await deactivateVacationMode(session);

  return {
    ok: true,
    session,
    ...result,
    external_send_performed: false,
    provider_call_performed: false,
  };
});

app.patch("/api/vacation-mode/settings", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const result = await updateVacationModeSettings(session, request.body ?? {});

  return {
    ok: true,
    session,
    ...result,
    external_send_performed: false,
    provider_call_performed: false,
  };
});

app.get("/api/vacation-mode/activity", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const limit = Number(query?.limit ?? 30);

  return {
    ok: true,
    session,
    activity: await getVacationModeActivity(session, limit),
  };
});

app.get("/api/vacation-mode/approvals", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { limit?: string } | undefined;
  const limit = Number(query?.limit ?? 30);

  return {
    ok: true,
    session,
    approvals: await getVacationModeApprovals(session, limit),
    execution_disabled: true,
  };
});

app.post("/api/vacation-mode/approvals/:id/decision", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { id?: string };
  const body = (request.body ?? {}) as { decision?: unknown; note?: unknown };
  const decision = body.decision === "approve" || body.decision === "reject" || body.decision === "snooze"
    ? body.decision
    : null;

  if (!params.id || !decision) {
    return reply.code(400).send({
      ok: false,
      error: "Missing vacation approval id or valid decision.",
      allowed_decisions: ["approve", "reject", "snooze"],
    });
  }

  const result = await decideVacationApproval(
    session,
    params.id.slice(0, 160),
    decision,
    typeof body.note === "string" ? body.note : "",
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Vacation approval was not found.",
    });
  }

  return {
    ok: true,
    session,
    ...result,
    external_send_performed: false,
    provider_call_performed: false,
  };
});

app.get("/api/vacation-mode/operator-tasks", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = request.query as { limit?: string } | undefined;
  return { ok: true, session, tasks: await getVacationOperatorTasks(session, Number(query?.limit ?? 50)) };
});

app.post("/api/vacation-mode/operator-tasks", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  try {
    return { ok: true, session, ...(await createVacationOperatorTask(session, request.body ?? {})) };
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Operator request could not be saved." });
  }
});

app.post("/api/vacation-mode/operator-tasks/:id/cancel", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  const task = params.id ? await cancelVacationOperatorTask(session, params.id.slice(0, 180)) : null;
  return task ? { ok: true, session, task } : reply.code(404).send({ ok: false, error: "Operator request was not found." });
});

app.patch("/api/vacation-mode/operator-tasks/:id/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    const task = params.id ? await updateVacationOperatorTask(session, params.id.slice(0, 180), request.body ?? {}) : null;
    return task ? { ok: true, session, task } : reply.code(404).send({ ok: false, error: "Operator request was not found." });
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Operator status could not be updated." });
  }
});

app.post("/api/vacation-mode/check-in", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  return { ok: true, session, ...(await runVacationModeCheckIn("owner_requested")) };
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
  const memoryScope = resolveMemoryScopeFromBody(body, session);
  const recall = await recallHermesInteractionMemory({
    tenantId: memoryScope.tenant_id,
    actorUserId: memoryScope.actor_user_id,
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
    memory_scope: buildMemoryScopeProof({
      memory_scope: memoryScope.memory_scope,
      tenant_id: memoryScope.tenant_id,
      actor_user_id: memoryScope.actor_user_id,
      requested_tenant_id: memoryScope.requested_tenant_id,
      requested_actor_user_id: memoryScope.requested_actor_user_id,
      tenant_override_blocked: memoryScope.tenant_override_blocked,
      actor_override_blocked: memoryScope.actor_override_blocked,
    }),
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
  const memoryScope = resolveMemoryScopeFromBody(query ?? {}, session);
  const status = await getHermesInteractionMemoryStoreStatus();
  const history = await readHermesInteractionMemoryStoreRecords({
    limit,
    tenantId: memoryScope.tenant_id,
    actorUserId: memoryScope.actor_user_id,
    taskId: query?.task_id,
    interactionType: query?.interaction_type,
  });

  return {
    ok: true,
    session,
    memory_scope: buildMemoryScopeProof({
      memory_scope: memoryScope.memory_scope,
      tenant_id: memoryScope.tenant_id,
      actor_user_id: memoryScope.actor_user_id,
      requested_tenant_id: memoryScope.requested_tenant_id,
      requested_actor_user_id: memoryScope.requested_actor_user_id,
      tenant_override_blocked: memoryScope.tenant_override_blocked,
      actor_override_blocked: memoryScope.actor_override_blocked,
    }),
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

app.get("/phantom-ai/brain/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const brainOptions = brainStoreOptionsForSession(session, query);
  const brain = await buildBrainStatus(session, brainOptions);

  return {
    ok: true,
    session,
    read_only: true,
    brain,
    brain_scope: brainScopeProofForSession(session, query),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.get("/phantom-ai/brain/memories", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = (request.query ?? {}) as { type?: unknown; limit?: unknown; include_inactive?: unknown; tenant_id?: unknown };
  const limit =
    typeof query.limit === "string" && Number.isFinite(Number(query.limit))
      ? Math.max(1, Math.min(200, Number(query.limit)))
      : 120;
  const brainOptions = brainStoreOptionsForSession(session, query);
  const memories = await listBrainMemories(session, {
    ...brainOptions,
    type: typeof query.type === "string" ? query.type : undefined,
    limit,
    includeInactive: query.include_inactive === "true",
  });

  return {
    ok: true,
    session,
    memories,
    brain_scope: brainScopeProofForSession(session, query),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.post("/phantom-ai/brain/memories", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = BrainMemoryCreateSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, session, error: "Invalid memory payload.", issues: parsed.error.issues });
  }

  const brainOptions = brainStoreOptionsForSession(session, parsed.data);
  const memory = await createBrainMemory(session, parsed.data, brainOptions);

  return {
    ok: true,
    session,
    memory,
    brain_scope: brainScopeProofForSession(session, parsed.data),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.patch("/phantom-ai/brain/memories/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = BrainMemoryPatchSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, session, error: "Invalid memory patch.", issues: parsed.error.issues });
  }

  const params = request.params as { id: string };
  const brainOptions = brainStoreOptionsForSession(session, parsed.data);
  let memory;
  try {
    memory = await updateBrainMemory(session, params.id, parsed.data, brainOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory_update_failed";
    if (message === "memory_not_found") {
      return reply.code(404).send({ ok: false, session, error: "Memory not found." });
    }
    throw error;
  }
  if (!memory) {
    return reply.code(404).send({ ok: false, session, error: "Memory not found." });
  }

  return {
    ok: true,
    session,
    memory,
    brain_scope: brainScopeProofForSession(session, parsed.data),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.delete("/phantom-ai/brain/memories/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const brainOptions = brainStoreOptionsForSession(session, query);
  let memory;
  try {
    memory = await forgetBrainMemory(session, params.id, brainOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory_forget_failed";
    if (message === "memory_not_found") {
      return reply.code(404).send({ ok: false, session, error: "Memory not found." });
    }
    throw error;
  }
  if (!memory) {
    return reply.code(404).send({ ok: false, session, error: "Memory not found." });
  }

  return {
    ok: true,
    session,
    memory,
    brain_scope: brainScopeProofForSession(session, query),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.post("/phantom-ai/brain/feedback", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = BrainFeedbackSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, session, error: "Invalid feedback payload.", issues: parsed.error.issues });
  }

  const brainOptions = brainStoreOptionsForSession(session, parsed.data);
  const feedback = await recordBrainFeedback(session, parsed.data, brainOptions);

  return {
    ok: true,
    session,
    feedback,
    brain_scope: brainScopeProofForSession(session, parsed.data),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.post("/phantom-ai/brain/context-preview", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = BrainContextPreviewSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ ok: false, session, error: "Invalid context preview payload.", issues: parsed.error.issues });
  }

  const brainOptions = brainStoreOptionsForSession(session, parsed.data);
  const context = await composeBrainContext(session, { ...parsed.data, logEvent: false }, brainOptions);

  return {
    ok: true,
    session,
    read_only: true,
    context,
    brain_scope: brainScopeProofForSession(session, parsed.data),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
});

app.post("/phantom-ai/brain/events", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = BrainEventSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, session, error: "Invalid brain event payload.", issues: parsed.error.issues });
  }

  const brainOptions = brainStoreOptionsForSession(session, parsed.data);
  const event = await appendBrainEvent(session, parsed.data, brainOptions);

  return {
    ok: true,
    session,
    event,
    brain_scope: brainScopeProofForSession(session, parsed.data),
    provider_called: false,
    network_call_performed: false,
    approval_executed: false,
    external_action_executed: false,
  };
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

app.get("/phantom-ai/desktop-media/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const media = await getWindowsMediaStatus();
  return {
    ok: media.ok,
    session,
    media,
    privacy: {
      playback_metadata_only: true,
      browser_history_read: false,
      files_read: false,
      messages_read: false,
      credentials_read: false,
    },
  };
});

const DesktopMediaControlSchema = z.object({
  session_id: z.string().trim().max(300).optional().default(""),
  command: z.string().trim().max(30),
});

app.post("/phantom-ai/desktop-media/control", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = DesktopMediaControlSchema.safeParse(request.body ?? {});
  if (!parsed.success || !isWindowsMediaCommand(parsed.data.command)) {
    return reply.code(400).send({ ok: false, error: "unsupported_media_command" });
  }

  const media = await controlWindowsMedia(parsed.data.session_id, parsed.data.command);
  return {
    ok: media.ok,
    session,
    media,
    process_started: false,
    provider_called: false,
    external_send: false,
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

app.get("/phantom-ai/automations", async (request, reply) => {
  // Owner-only. Lists the real, scheduled (daily/weekly/monthly) automation
  // jobs — every one is read-only/prep-only and logs a real Hermes ledger
  // record on each run, which is what makes the agent-workforce "active
  // worker" counts respond to real recurring activity.
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    read_only: true,
    jobs: await listAutomationJobs(),
    safety_flags: {
      sends_or_posts: false,
      payments_or_invoices: false,
      provider_calls: false,
      external_writes: false,
    },
  };
});

/* ---------------- agent runs: the real execution lifecycle ----------------
   Admin-only. A run is a persisted record with real states (queued →
   executing → verifying → completed/failed/cancelled), progress events,
   on-disk artifacts, and a Hermes ledger proof entry. Executors do
   read-only/prep work only — no sends, spends, or external actions. */
const AgentRunStartSchema = z.object({
  operation: z.string().min(1).max(60),
  request: z.string().max(400).optional(),
  workspace: z.string().max(60).optional(),
});

app.get("/phantom-ai/runs/operations", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  return { ok: true, operations: listAgentRunOperations() };
});

app.get("/phantom-ai/runs", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  return { ok: true, runs: listAgentRuns({ limit: 20 }) };
});

app.get("/phantom-ai/runs/:id", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const run = getAgentRun((request.params as { id: string }).id);
  if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });
  return { ok: true, run };
});

app.post("/phantom-ai/runs", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = AgentRunStartSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "bad_request", detail: parsed.error.flatten() });
  }
  const result = await startAgentRun({
    operation: parsed.data.operation,
    workspace: parsed.data.workspace || "phantomforce",
    sessionId: session.id,
    request: parsed.data.request || "",
    tenantId: `${parsed.data.workspace || "phantomforce"}-owner`,
    businessName: parsed.data.workspace || "PhantomForce",
  });
  /* AgentRun itself carries an `error: string|null` field, so discriminate on
     the run id — only the unknown-operation branch lacks one */
  if (!("id" in result)) {
    return reply.code(400).send({ ok: false, ...result });
  }
  return { ok: true, run: result };
});

app.post("/phantom-ai/runs/:id/cancel", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const run = requestAgentRunCancel((request.params as { id: string }).id);
  if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });
  return { ok: true, run };
});

const AutomationToggleSchema = z.object({ enabled: z.boolean() });

app.post("/phantom-ai/automations/:id/toggle", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AutomationToggleSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  const { id } = request.params as { id: string };
  const result = await setAutomationJobEnabled(id, parsed.data.enabled);

  if (!result.ok) {
    return reply.code(404).send({ ok: false, error: "unknown_automation_job" });
  }

  return { ok: true, session, job_id: result.job_id, enabled: result.enabled };
});

app.post("/phantom-ai/automations/:id/run", async (request, reply) => {
  // Manual "run now" — still just executes the same read-only job body a
  // scheduled tick would; no different code path, no elevated permissions.
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const { id } = request.params as { id: string };
  const result = await runAutomationJobNow(id);

  if (!result.ok) {
    return reply.code(404).send({ ok: false, error: "unknown_automation_job" });
  }

  return {
    ok: true,
    session,
    job_id: result.job_id,
    last_run_at: result.last_run_at,
    last_status: result.last_status,
    last_summary: result.last_summary,
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

app.get("/phantom-ai/ops/finance-connector/status", async (request, reply) => {
  // Admin-only. Manual/CSV finance ledger is ready; live bank/card sync is
  // fail-closed until a real provider runtime and encrypted token store exist.
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return { ok: true, session, read_only: true, finance_connector: getFinanceConnectorStatus() };
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

async function handleMediaLabCreativeStatus(request: FastifyRequest, reply: FastifyReply) {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const entitled = hasMediaLabAccess(session);
  const [health, providerStatus] = await Promise.all([
    callPhantomCut("/api/health"),
    callPhantomCut("/api/providers/higgsfield/status"),
  ]);

  const statusToolMode = (process.env.PHANTOM_HIGGSFIELD_TOOL_MODE ?? "auto").trim().toLowerCase();
  return {
    ok: true,
    session,
    service: "PhantomForce Media Lab",
    provider: "cinematic",
    commercial_provider: true,
    subscribed_access: entitled,
    admin_access: session.canManageAccess,
    client_visible_name: "Media Lab",
    media_tool_lanes: {
      mode: statusToolMode,
      mcp_cli: {
        enabled: statusToolMode !== "phantomcut",
        last_success_at: lastHiggsfieldMcpDraftAt,
        note: "Operator media lane verified on first successful draft.",
      },
      phantomcut: { enabled: statusToolMode !== "mcp_cli", reachable: health.ok, legacy: true },
    },
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
      explicit_confirmation_required: "RUN_MEDIA_PAID_JOB",
      no_public_posting: true,
    },
  };
}

app.get("/phantom-ai/media-lab/creative/status", handleMediaLabCreativeStatus);
app.get("/phantom-ai/media-lab/higgsfield/status", handleMediaLabCreativeStatus);

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
  const toolsToolMode = (process.env.PHANTOM_HIGGSFIELD_TOOL_MODE ?? "auto").trim().toLowerCase();
  const mcpLaneEnabled = toolsToolMode !== "phantomcut";

  return {
    ok: true,
    transport: "hermes_mcp",
    broker: {
      name: mcpLaneEnabled ? "operator-mcp" : "phantomcut",
      mode: toolsToolMode,
      mcp_last_success_at: lastHiggsfieldMcpDraftAt,
      base_url: phantomCutBaseUrl(),
      reachable: bridgeReachable,
      provider_status: providerStatus.ok ? providerStatus.data : null,
      provider_status_error: providerStatus.ok ? null : providerStatus.error,
    },
    tools: [
      {
        name: "media.draft",
        available: (mcpLaneEnabled || bridgeReachable) && hasMediaLabAccess(session),
        credit_spend: false,
        route: "POST /phantom-ai/media-lab/creative/draft",
        note: mcpLaneEnabled
          ? "Creates a draft through the operator media lane. Draft-only — the paid render is approved separately."
          : "Creates a Media Lab draft. Draft-only — the paid render is approved separately.",
      },
      {
        name: "media.render",
        available: false,
        credit_spend: true,
        route: null,
        note: "Not exposed. Paid renders stay behind explicit Media Lab confirmation; there is no auto-spend route.",
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

/* ---- Cross-origin image proxy for the media editor ----
   The editor draws asset images onto a <canvas> to composite edits, then
   calls canvas.toDataURL() to save/export. If the source image came from a
   different origin without CORS headers, the browser silently "taints" the
   canvas and toDataURL() throws — Save looks like it does nothing. This
   route fetches the image server-side (no CORS restriction between
   servers) and hands it back as a same-origin data URL so the canvas never
   gets tainted. GET-only, admin/media-lab session required, http(s) only,
   size-capped, short timeout — this is a narrow read-only fetch proxy, not
   a general SSRF-open relay. */
const PROXY_IMAGE_MAX_BYTES = 20_000_000;
app.get("/phantom-ai/media-lab/proxy-image", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!hasMediaLabAccess(session)) {
    return reply.code(403).send({ ok: false, error: "Media Lab is not enabled for this workspace." });
  }

  const rawUrl = String((request.query as Record<string, unknown> | undefined)?.url ?? "");
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return reply.code(400).send({ ok: false, error: "Missing or invalid url query parameter." });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return reply.code(400).send({ ok: false, error: "Only http/https URLs can be proxied." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(target.toString(), { signal: controller.signal });
    if (!upstream.ok) {
      return reply.code(200).send({ ok: false, error: `Source returned HTTP ${upstream.status}.` });
    }
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return reply.code(200).send({ ok: false, error: `Source did not return an image (got "${contentType || "unknown"}").` });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > PROXY_IMAGE_MAX_BYTES) {
      return reply.code(200).send({ ok: false, error: `Image is too large to proxy (${Math.round(buffer.length / 1_000_000)}MB).` });
    }
    return { ok: true, image: `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(200).send({ ok: false, error: `Could not fetch the source image: ${message}`.slice(0, 300) });
  } finally {
    clearTimeout(timeout);
  }
});

/* ---- Content asset sync (cross-device photo/video sync) ----
   Content Hub's actual asset data (the image/video bytes) normally lives
   only in whichever browser created it — this is the real server-side
   store that lets a photo edited on one device show up on another. Scoped
   to the selected tenant for owner/admin sessions, and hard-locked to the
   caller's own client tenant for client sessions. Every asset auto-expires
   after 30 days — this is a temporary sync/archive layer, not permanent
   storage; see content-asset-storage.ts for the pluggable provider seam. */
function contentAssetOwnerScope(session: AccessSession, requestedTenantId?: unknown) {
  if (session.canManageAccess) return cleanMemoryScopeId(requestedTenantId, OWNER_MEMORY_TENANT_ID);
  return cleanMemoryScopeId(session.clientId, `client-${session.id}`);
}

const ContentAssetUploadSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  image: z.string().trim().min(1).max(24_000_000),
  filename: z.string().trim().max(160).optional(),
});

app.post("/phantom-ai/content/assets", { bodyLimit: 24 * 1024 * 1024 }, async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const parsed = ContentAssetUploadSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  const provider = getContentAssetStorageProvider();
  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const result = await provider.putAsset({
    ownerScope,
    dataUrl: parsed.data.image,
    originalName: parsed.data.filename,
  });

  if (!result.ok) {
    return reply.code(400).send({ ok: false, error: result.error });
  }

  return { ok: true, session, tenant_id: ownerScope, asset: result.asset };
});

app.get("/phantom-ai/content/assets", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const provider = getContentAssetStorageProvider();
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const assets = await provider.listAssets(ownerScope);
  return { ok: true, session, tenant_id: ownerScope, assets };
});

app.get("/phantom-ai/content/assets/:id/file", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const provider = getContentAssetStorageProvider();
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const result = await provider.getAssetFile(id, ownerScope);

  if (!result.ok) {
    return reply.code(404).send({ ok: false, error: result.error });
  }

  return { ok: true, session, tenant_id: ownerScope, image: result.dataUrl, asset: result.asset };
});

app.delete("/phantom-ai/content/assets/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const provider = getContentAssetStorageProvider();
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const deleted = await provider.deleteAsset(id, ownerScope);

  if (!deleted) {
    return reply.code(404).send({ ok: false, error: "not_found" });
  }

  return { ok: true, session, tenant_id: ownerScope };
});

/* ---- Asset Vault Stage 4: ingestion derivatives ----
   Thumbnails/proxies/waveforms produced at upload time by asset-ingest.ts.
   listDerivatives returns [] (not an error) when ffmpeg wasn't available at
   ingest time — a caller should treat a missing derivative as "not
   generated," never assume one exists. */

app.get("/phantom-ai/content/assets/:id/derivatives", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const provider = getContentAssetStorageProvider();
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const derivatives = await provider.listDerivatives(id, ownerScope);
  return { ok: true, tenant_id: ownerScope, derivatives };
});

app.get("/phantom-ai/content/assets/:id/derivatives/:kind", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id, kind } = request.params as { id: string; kind: string };
  if (kind !== "thumbnail" && kind !== "proxy" && kind !== "waveform") {
    return reply.code(400).send({ ok: false, error: "invalid_derivative_kind" });
  }
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const provider = getContentAssetStorageProvider();
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const result = await provider.getDerivativeFile(id, ownerScope, kind);

  if (!result.ok) {
    return reply.code(404).send({ ok: false, error: result.error });
  }

  return { ok: true, tenant_id: ownerScope, image: result.dataUrl, derivative: result.derivative };
});

/* ---- Asset Vault Stage 5: search ----
   Real keyword + filter search over the SQLite index (see searchAssets in
   asset-db.ts). Deliberately not "AI search" — there is no embeddings/
   vector-similarity infrastructure in this project, so this is honest
   keyword + exact-filter matching, not a dressed-up semantic search claim. */

function parseSearchQuery(raw: Record<string, unknown>): AssetSearchQuery {
  const sortValues = ["created_desc", "created_asc", "name_asc", "size_desc"] as const;
  const sort = sortValues.includes(raw.sort as any) ? (raw.sort as (typeof sortValues)[number]) : undefined;
  return {
    text: typeof raw.text === "string" && raw.text.trim() ? raw.text.trim().slice(0, 200) : undefined,
    assetType: typeof raw.asset_type === "string" && raw.asset_type ? raw.asset_type : undefined,
    tier: raw.tier === "vault" || raw.tier === "cache" ? raw.tier : undefined,
    favorite: raw.favorite === "true" ? true : raw.favorite === "false" ? false : undefined,
    archived: raw.archived === "true" ? true : raw.archived === "false" ? false : undefined,
    provider: typeof raw.provider === "string" && raw.provider ? raw.provider : undefined,
    tags:
      typeof raw.tags === "string" && raw.tags.trim()
        ? raw.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 20)
        : undefined,
    collectionId: typeof raw.collection_id === "string" && raw.collection_id ? raw.collection_id : undefined,
    sort,
    limit: typeof raw.limit === "string" && Number.isFinite(Number(raw.limit)) ? Number(raw.limit) : undefined,
    offset: typeof raw.offset === "string" && Number.isFinite(Number(raw.offset)) ? Number(raw.offset) : undefined,
  };
}

app.get("/phantom-ai/content/assets/search", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const query = (request.query ?? {}) as Record<string, unknown>;
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const searchQuery = parseSearchQuery(query);
  const { results, total } = searchAssets(ownerScope, searchQuery);
  return { ok: true, tenant_id: ownerScope, total, assets: results };
});

const FavoriteAssetSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  favorite: z.boolean(),
});

app.post("/phantom-ai/content/assets/:id/favorite", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = FavoriteAssetSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const updated = setAssetFavorite(id, ownerScope, parsed.data.favorite);
  if (!updated) return reply.code(404).send({ ok: false, error: "not_found" });
  return { ok: true, tenant_id: ownerScope, asset: getVaultAssetById(id, ownerScope) };
});

const ArchiveAssetSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  archived: z.boolean(),
});

app.post("/phantom-ai/content/assets/:id/archive", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = ArchiveAssetSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const updated = setAssetArchived(id, ownerScope, parsed.data.archived);
  if (!updated) return reply.code(404).send({ ok: false, error: "not_found" });
  return { ok: true, tenant_id: ownerScope, asset: getVaultAssetById(id, ownerScope) };
});

/* ---- Asset Vault Stage 2: tags + collections ----
   Additive routes only — nothing above this changes. Same owner_scope
   resolution (contentAssetOwnerScope) as every other content-asset route,
   so tags/collections are isolated the same way assets themselves are. */

const AssetTagSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(60),
});

app.post("/phantom-ai/content/assets/:id/tags", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = AssetTagSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  if (!getVaultAssetById(id, ownerScope)) return reply.code(404).send({ ok: false, error: "not_found" });

  const tag = tagAsset(id, ownerScope, parsed.data.name);
  return { ok: true, tenant_id: ownerScope, tag };
});

app.get("/phantom-ai/content/assets/:id/tags", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  if (!getVaultAssetById(id, ownerScope)) return reply.code(404).send({ ok: false, error: "not_found" });

  return { ok: true, tenant_id: ownerScope, tags: listTagsForAsset(id) };
});

app.delete("/phantom-ai/content/assets/:id/tags/:name", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id, name } = request.params as { id: string; name: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  if (!getVaultAssetById(id, ownerScope)) return reply.code(404).send({ ok: false, error: "not_found" });

  untagAsset(id, ownerScope, name);
  return { ok: true, tenant_id: ownerScope };
});

const CreateCollectionSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

app.post("/phantom-ai/collections", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const parsed = CreateCollectionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const collection = createCollection(ownerScope, parsed.data.name, parsed.data.description);
  return { ok: true, tenant_id: ownerScope, collection };
});

app.get("/phantom-ai/collections", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  return { ok: true, tenant_id: ownerScope, collections: listCollections(ownerScope) };
});

const AddToCollectionSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  asset_id: z.string().trim().min(1),
});

app.post("/phantom-ai/collections/:id/assets", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = AddToCollectionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  try {
    addAssetToCollection(id, parsed.data.asset_id, ownerScope);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return reply.code(404).send({ ok: false, error: message });
  }
  return { ok: true, tenant_id: ownerScope };
});

app.get("/phantom-ai/collections/:id/assets", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  return { ok: true, tenant_id: ownerScope, assets: listAssetsInCollection(id, ownerScope) };
});

/* ---- Asset Vault Stage 7: presets / effect stacks ----
   A "preset" is any named, versioned, arbitrary-JSON definition scoped the
   same way as everything else here (contentAssetOwnerScope) — today used
   for Creator Hub's saved image-editor look (brightness/contrast/crop/text/
   bokeh, the same shape editStateSnapshot() already produces), but kind is
   caller-defined so this same table/routes work for any future effect-
   stack shape without a schema change. Definitions are stored as opaque
   JSON — this server never interprets or validates their contents, only
   the caller (the editor UI) knows what a given kind's definition means. */

const CreatePresetSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  kind: z.string().trim().min(1).max(60),
  definition: z.unknown(),
});

app.post("/phantom-ai/presets", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const parsed = CreatePresetSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const preset = createPreset({
    ownerScope,
    name: parsed.data.name,
    description: parsed.data.description,
    kind: parsed.data.kind,
    definition: parsed.data.definition,
  });
  return { ok: true, tenant_id: ownerScope, preset };
});

app.get("/phantom-ai/presets", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const query = (request.query ?? {}) as { tenant_id?: unknown; kind?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const kind = typeof query.kind === "string" && query.kind ? query.kind : undefined;
  return { ok: true, tenant_id: ownerScope, presets: listPresets(ownerScope, kind) };
});

app.get("/phantom-ai/presets/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  const preset = getPresetById(id, ownerScope);
  if (!preset) return reply.code(404).send({ ok: false, error: "not_found" });
  return { ok: true, tenant_id: ownerScope, preset };
});

const CreatePresetVersionSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  definition: z.unknown(),
});

app.post("/phantom-ai/presets/:id/versions", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = CreatePresetVersionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const preset = createPresetVersion(id, ownerScope, parsed.data.definition);
  if (!preset) return reply.code(404).send({ ok: false, error: "not_found" });
  return { ok: true, tenant_id: ownerScope, preset };
});

const ArchivePresetSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
});

app.post("/phantom-ai/presets/:id/archive", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = ArchivePresetSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const archived = archivePreset(id, ownerScope);
  if (!archived) return reply.code(404).send({ ok: false, error: "not_found" });
  return { ok: true, tenant_id: ownerScope };
});

/* ---- Asset Vault Stage 3: cache manager ----
   Real stats/cleanup over the real SQLite index + real files. Only the
   requesting session's own owner_scope is ever affected — an admin session
   (canManageAccess) may pass tenant_id to inspect a specific workspace's
   cache, exactly like every other content-asset route already does. */

app.get("/phantom-ai/asset-vault/cache-stats", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const ownerScope = contentAssetOwnerScope(session, query.tenant_id);
  return { ok: true, tenant_id: ownerScope, stats: getCacheStats(ownerScope) };
});

const CacheCleanupSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  target_free_bytes: z.number().int().positive().max(50 * 1024 * 1024 * 1024),
});

app.post("/phantom-ai/asset-vault/cache/preview-cleanup", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const parsed = CacheCleanupSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  return { ok: true, tenant_id: ownerScope, preview: previewCleanup(ownerScope, parsed.data.target_free_bytes) };
});

app.post("/phantom-ai/asset-vault/cache/cleanup", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const parsed = CacheCleanupSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const result = await runCleanup(ownerScope, parsed.data.target_free_bytes);
  return { ok: true, tenant_id: ownerScope, result };
});

const PinAssetSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  pinned: z.boolean(),
});

app.post("/phantom-ai/content/assets/:id/pin", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const { id } = request.params as { id: string };
  const parsed = PinAssetSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const ownerScope = contentAssetOwnerScope(session, parsed.data.tenant_id);
  const updated = setAssetPinned(id, ownerScope, parsed.data.pinned);
  if (!updated) return reply.code(404).send({ ok: false, error: "not_found" });
  return { ok: true, tenant_id: ownerScope, asset: getVaultAssetById(id, ownerScope) };
});

/* ---- Local background removal (rembg) ----
   A real local-process bridge, not a provider call: no key, no network, no
   credit spend. Status is a genuine `import rembg` probe through whichever
   Python interpreter has it installed — never a hardcoded guess either way.
   Removal shells out to scripts/remove_background.py through that same
   interpreter, using temp files only, cleaned up after every request. */
app.get("/phantom-ai/media-lab/rembg/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;

  const forceRecheck = String((request.query as Record<string, unknown> | undefined)?.recheck ?? "") === "true";
  const status = await detectRembg(forceRecheck);
  return { ok: true, session, ...status };
});

const RembgRemoveBackgroundSchema = z.object({
  image: z.string().trim().min(1).max(24_000_000),
});
const REMBG_MAX_INPUT_BYTES = 15_000_000;

app.post(
  "/phantom-ai/media-lab/rembg/remove-background",
  { bodyLimit: 24 * 1024 * 1024 },
  async (request, reply) => {
    const session = requireAccessSession(request, reply);
    if (!session) return reply;

    if (!hasMediaLabAccess(session)) {
      return reply.code(403).send({
        ok: false,
        error: "Background removal is not enabled for this workspace.",
      });
    }

    const parsed = RembgRemoveBackgroundSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
    }

    const match = parsed.data.image.match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i);
    if (!match) {
      return reply.code(400).send({ ok: false, error: "Expected a base64 PNG/JPEG/WebP data URL." });
    }
    const inputBuffer = Buffer.from(match[2], "base64");
    if (inputBuffer.length > REMBG_MAX_INPUT_BYTES) {
      return reply.code(413).send({ ok: false, error: `Image is too large (${Math.round(inputBuffer.length / 1_000_000)}MB). Max is ${REMBG_MAX_INPUT_BYTES / 1_000_000}MB.` });
    }

    const status = await detectRembg();
    if (!status.available || !status.pythonCommand) {
      return reply.code(200).send({
        ok: false,
        error: status.error || "Background removal unavailable — rembg is not installed or not connected.",
      });
    }

    const jobId = randomUUID();
    const tempDir = join(tmpdir(), `phantomforce-rembg-${jobId}`);
    const inputPath = join(tempDir, `in.${match[1].toLowerCase().replace("jpg", "jpeg")}`);
    const outputPath = join(tempDir, "out.png");

    try {
      await mkdir(tempDir, { recursive: true });
      await writeFile(inputPath, inputBuffer);
      const run = await runRembgRemoveBackground(status.pythonCommand, inputPath, outputPath);
      if (!run.ok) {
        request.log.warn({ err: run.error }, "rembg remove-background failed");
        return reply.code(200).send({ ok: false, error: run.error });
      }
      const outputBuffer = await readFile(outputPath);
      return {
        ok: true,
        image: `data:image/png;base64,${outputBuffer.toString("base64")}`,
        pythonCommand: status.pythonCommand,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.warn({ err: message }, "rembg remove-background threw");
      return reply.code(200).send({ ok: false, error: `Background removal failed: ${message}`.slice(0, 300) });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },
);

async function handleMediaLabCreativeDraft(request: FastifyRequest, reply: FastifyReply) {
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

  /* Higgsfield tool lanes, tried in order:
     1. mcp_cli — the Higgsfield MCP incorporated into the operator brain
        (codex CLI on this box). This is the CURRENT primary lane.
     2. phantomcut — the legacy local bridge, kept only for boxes that still
        run it. PHANTOM_HIGGSFIELD_TOOL_MODE=phantomcut|mcp_cli|auto (default
        auto = MCP first, PhantomCut as legacy fallback).                    */
  const toolMode = (process.env.PHANTOM_HIGGSFIELD_TOOL_MODE ?? "auto").trim().toLowerCase();
  const lanesTried: Array<{ lane: string; error: string }> = [];

  if (toolMode !== "phantomcut") {
    const mcp = await runHiggsfieldMcpDraft(parsed.data);
    if (mcp.ok) {
      lastHiggsfieldMcpDraftAt = new Date().toISOString();
      return {
        ok: true,
        provider: "cinematic",
        commercial_provider: true,
        action: "draft_only",
        tool_lane: "mcp_cli",
        draft: mcp.draft,
        safety: {
          paid_job_called: false,
          upload_performed: false,
          run_endpoint_exposed: false,
          explicit_confirmation_required: "RUN_MEDIA_PAID_JOB",
          note: "Draft created through the operator media lane. Paid renders remain separately approved.",
        },
      };
    }
    lanesTried.push({ lane: "mcp_cli", error: mcp.error });
  }

  if (toolMode !== "mcp_cli") {
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
    if (draft.ok) {
      return {
        ok: true,
        provider: "cinematic",
        commercial_provider: true,
        action: "draft_only",
        tool_lane: "phantomcut",
        draft: draft.data,
        safety: {
          paid_job_called: false,
          upload_performed: false,
          run_endpoint_exposed: false,
          explicit_confirmation_required: "RUN_MEDIA_PAID_JOB",
          note: "This dashboard creates a Media Lab draft only. Running a paid/upload generation remains separately gated.",
        },
      };
    }
    lanesTried.push({ lane: "phantomcut (legacy)", error: draft.error });
  }

  return reply.code(502).send({
    ok: false,
    error: lanesTried.map((l) => `${l.lane}: ${l.error}`).join(" · "),
    lanes_tried: lanesTried,
    provider: "cinematic",
    provider_called: false,
    paid_job_called: false,
    upload_performed: false,
  });
}

app.post("/phantom-ai/media-lab/creative/draft", handleMediaLabCreativeDraft);
app.post("/phantom-ai/media-lab/higgsfield/draft", handleMediaLabCreativeDraft);

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

  const brainOptions = brainStoreOptionsForSession(session, normalized);
  const brainContext = await composeBrainContext(session, {
    message: normalized.user_request,
    surface: "chat",
    proposedActionType: normalized.task_type,
    currentModule: normalized.task_type,
    logEvent: true,
  }, brainOptions);
  const brainModule = buildBrainContextModule(brainContext);
  const brainAugmentedSummary = buildBrainAugmentedSummary(normalized, brainContext);

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
        brain: {
          context_used: true,
          suggested_intent: brainContext.suggestedIntent,
          risk_level: brainContext.riskLevel,
          needs_approval: brainContext.needsApproval,
          micro_prompt: brainContext.microPrompt,
          relevant_memory_count: brainContext.relevantMemories.length,
          used_memory_ids: brainContext.debug.injectedMemoryIds,
          active_rules: brainContext.activeRules,
          reasons: brainContext.debug.reasons,
        },
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
      business_summary: brainAugmentedSummary,
      module_data: [...normalized.module_data, brainModule],
      relevant_rules: brainContext.activeRules,
      approval_restrictions: brainContext.needsApproval
        ? ["Phantom Brain requires approval before external, destructive, payment, upload, post, send, or spend actions."]
        : [],
    });
    const approvalRequired = brainContext.needsApproval || preview.decision.approval_required || preview.action_preview.approval_required;
    const fallbackChat = await runAdminPhantomAiChatWithFallback(adminModelLane, {
      requestId: normalized.request_id,
      businessName: normalized.business_name,
      taskType: normalized.task_type,
      userMessage: normalized.user_request,
      compactContext: memoryContext.augmented_context_preview,
      sensitivityLevel: preview.decision.sensitivity_level,
      approvalRequired,
      executionMode: adminExecutionMode,
    });
    const respondingProviderId = fallbackChat.providerId;
    const respondingLane = adminPhantomAiLaneForProviderId(respondingProviderId);
    const respondingLabel = adminPhantomAiProviderLabel(respondingProviderId);
    const respondingProviderRoute = adminPhantomAiProviderRoute(respondingLane);
    const fallbackSwitched = fallbackChat.fallbackUsed && !fallbackChat.allFailed;
    const allProvidersFailed = fallbackChat.allFailed;
    const modelResult = fallbackChat.result;
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
      provider_route: respondingProviderRoute,
      model_id: modelResult.model_id,
      context_chars: memoryContext.augmented_context_chars,
      estimated_tokens: Math.ceil(memoryContext.augmented_context_chars / 4),
      estimated_cost_usd: null,
      user_request_summary: redactSensitiveText(normalized.user_request).replace(/\s+/g, " ").slice(0, 240),
      result_summary: redactSensitiveText(
        allProvidersFailed
          ? `All admin AI providers failed (${fallbackChat.attempts.map((a) => adminPhantomAiProviderLabel(a.provider_id)).join(", ")}).`
          : toolExecuted
            ? `${respondingLabel} executed ${toolName ?? "tool"} and returned a receipt.`
            : providerCalled
              ? `${respondingLabel} returned a Hermes-backed admin response${fallbackSwitched ? ` (fallback from ${adminPhantomAiProviderLabel(fallbackChat.primaryProviderId)})` : ""}.`
              : `${respondingLabel} did not complete: ${resultBlocked ?? resultError ?? resultStatus}`,
      ).slice(0, 360),
      approval_required: approvalRequired,
      approval_status: approvalRequired ? "pending" : "not_required",
      risks: preview.decision.risks.map((risk) => redactSensitiveText(risk)).slice(0, 8),
      next_action: allProvidersFailed
        ? "Check Codex usage limits, Claude CLI auth, OpenRouter key/flags, and Ollama status, then retry."
        : toolExecuted
          ? "Review the operator receipt in Phantom AI."
          : `Continue in Phantom AI with ${respondingLabel} or switch admin model lanes.`,
      agent_run_id: `phantom-ai-admin-${adminModelLane}-${normalized.request_id}`,
      parent_task_id: normalized.request_id,
    };

    await appendHermesLedgerRecord(ledgerRecord);
    await appendBrainEvent(session, {
      surface: "chat",
      type: "chat_response",
      summary: ledgerRecord.result_summary,
      linkedRunId: ledgerRecord.agent_run_id,
      outcome: resultStatus,
      importance: approvalRequired ? "high" : "low",
      safeForMemory: false,
      source: "phantom_ai_chat",
      metadata: {
        providerRoute: respondingProviderRoute,
        modelLane: respondingLane,
        requestedModelLane: adminModelLane,
        fallbackUsed: fallbackSwitched,
        allProvidersFailed,
        approvalRequired,
        providerCalled,
      },
      logToHermes: false,
    }, brainOptions);

    return {
      ok: true,
      session,
      provider_choice: "phantom",
      admin_model_lane: publicAdminPhantomAiModelLane(respondingLane),
      admin_model_label: respondingLabel,
      admin_model_requested_lane: publicAdminPhantomAiModelLane(adminModelLane),
      admin_execution_mode: adminExecutionMode,
      model_id: respondingProviderId === "codex_cli" ? "phantom-private-brain" : modelResult.model_id,
      message: {
        role: "assistant",
        content: allProvidersFailed
          ? buildAdminPhantomAiAllProvidersFailedMessage()
          : resultOutput,
      },
      operator:
        respondingProviderId === "codex_cli" && "tool_requested" in modelResult
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
        respondingProviderId === "codex_cli" && "provider_id" in modelResult && modelResult.provider_id === "codex_cli"
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
        "provider_id" in modelResult && modelResult.provider_id === "openrouter_glm" ? modelResult : null,
      local_ollama:
        "provider_id" in modelResult && modelResult.provider_id === "local_ollama" ? modelResult : null,
      claude_cli: respondingProviderId === "claude_cli" ? modelResult : null,
      fallback: {
        used: fallbackSwitched,
        all_failed: allProvidersFailed,
        requested_provider: adminPhantomAiProviderLabel(fallbackChat.primaryProviderId),
        responding_provider: respondingLabel,
        attempts: fallbackChat.attempts,
      },
      hermes: {
        context_used: true,
        ledger_written: true,
        provider_route: respondingProviderRoute,
        recalled_memory_count: memoryContext.memory.recalled_count,
      },
      brain: {
        context_used: true,
        suggested_intent: brainContext.suggestedIntent,
        risk_level: brainContext.riskLevel,
        needs_approval: brainContext.needsApproval,
        micro_prompt: brainContext.microPrompt,
        relevant_memory_count: brainContext.relevantMemories.length,
        used_memory_ids: brainContext.debug.injectedMemoryIds,
        active_rules: brainContext.activeRules,
        reasons: brainContext.debug.reasons,
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
      business_summary: brainAugmentedSummary,
      module_data: [...normalized.module_data, brainModule],
      relevant_rules: brainContext.activeRules,
      approval_restrictions: brainContext.needsApproval
        ? ["Phantom Brain requires approval before external, destructive, payment, upload, post, send, or spend actions."]
        : [],
    });
    const approvalRequired = brainContext.needsApproval || preview.decision.approval_required || preview.action_preview.approval_required;
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
    await appendBrainEvent(session, {
      surface: "chat",
      type: "chat_response",
      summary: ledgerRecord.result_summary,
      linkedRunId: ledgerRecord.agent_run_id,
      outcome: openrouter.status,
      importance: approvalRequired ? "high" : "low",
      safeForMemory: false,
      source: "phantom_ai_chat",
      metadata: {
        providerRoute: "openrouter_glm",
        approvalRequired,
        providerCalled: openrouter.provider_called,
      },
      logToHermes: false,
    }, brainOptions);

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
          brain: {
            context_used: true,
            suggested_intent: brainContext.suggestedIntent,
            risk_level: brainContext.riskLevel,
            needs_approval: brainContext.needsApproval,
            micro_prompt: session.canManageAccess ? brainContext.microPrompt : undefined,
            relevant_memory_count: brainContext.relevantMemories.length,
            used_memory_ids: session.canManageAccess ? brainContext.debug.injectedMemoryIds : [],
            active_rules: session.canManageAccess ? brainContext.activeRules : [],
            reasons: session.canManageAccess ? brainContext.debug.reasons : [],
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
      brain: {
        context_used: true,
        suggested_intent: brainContext.suggestedIntent,
        risk_level: brainContext.riskLevel,
        needs_approval: brainContext.needsApproval,
        micro_prompt: session.canManageAccess ? brainContext.microPrompt : undefined,
        relevant_memory_count: brainContext.relevantMemories.length,
        used_memory_ids: session.canManageAccess ? brainContext.debug.injectedMemoryIds : [],
        active_rules: session.canManageAccess ? brainContext.activeRules : [],
        reasons: session.canManageAccess ? brainContext.debug.reasons : [],
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

  const result = await runModelRouterFoundation({
    ...normalized,
    business_summary: brainAugmentedSummary,
    module_data: [...normalized.module_data, brainModule],
  });
  const interactionMemory = await recordHermesInteractionMemoryFromRun(result);
  const protectedResponse = buildPhantomAiWorkspaceReply(normalized.user_request, normalized.business_name);
  await appendBrainEvent(session, {
    surface: "chat",
    type: "chat_response",
    summary: redactSensitiveText(protectedResponse).replace(/\s+/g, " ").slice(0, 240),
    linkedRunId: result.ledger_record.agent_run_id,
    outcome: "protected_fallback",
    importance: brainContext.needsApproval ? "high" : "low",
    safeForMemory: false,
    source: "phantom_ai_chat",
    metadata: {
      suggestedIntent: brainContext.suggestedIntent,
      riskLevel: brainContext.riskLevel,
      needsApproval: brainContext.needsApproval,
    },
    logToHermes: false,
  }, brainOptions);

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
    brain: {
      context_used: true,
      suggested_intent: brainContext.suggestedIntent,
      risk_level: brainContext.riskLevel,
      needs_approval: brainContext.needsApproval,
      micro_prompt: session.canManageAccess ? brainContext.microPrompt : undefined,
      relevant_memory_count: brainContext.relevantMemories.length,
      used_memory_ids: session.canManageAccess ? brainContext.debug.injectedMemoryIds : [],
      active_rules: session.canManageAccess ? brainContext.activeRules : [],
      reasons: session.canManageAccess ? brainContext.debug.reasons : [],
    },
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
let stopAutomationEngine: (() => void) | null = null;
let stopVacationModeEngine: (() => boolean) | null = null;
let stopAdminProviderMonitor: (() => void) | null = null;

app.addHook("onClose", async () => {
  stopAutonomousSecurityScanner?.();
  stopAutonomousSecurityScanner = null;
  stopAutomationEngine?.();
  stopAutomationEngine = null;
  stopVacationModeEngine?.();
  stopVacationModeEngine = null;
  stopAdminProviderMonitor?.();
  stopAdminProviderMonitor = null;
});

if (process.env.PHANTOMFORCE_SERVER_LISTEN !== "false") {
  try {
    await app.listen({ host, port });
    stopAutonomousSecurityScanner = startAutonomousSecurityScanScheduler(app.log);
    stopAutomationEngine = startAutomationEngine(app.log);
    stopVacationModeEngine = startVacationModeEngine(app.log);
    stopAdminProviderMonitor = startAdminProviderHealthMonitor(app.log);
    app.log.info(`PhantomForce server listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
