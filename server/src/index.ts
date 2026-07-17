import "./load-env.js";

import { execFileSync } from "node:child_process";

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
  attachDatabaseSession,
  databaseAuthEnabledForSessions,
  getAccessAuthConfiguration,
  getAccessSession,
  issueAccessSessionToken,
  listAccessSessions,
  mintDatabaseSessionToken,
  OWNER_SESSION_ID,
  readBearerToken,
  requireAdminAccessSession,
  requireAccessSession,
  requireClientWorkspaceView,
  verifyOwnerCredentials,
  verifyAccessSessionTokenSid,
} from "./access/session.js";
import {
  DB_SESSION_PREFIX,
  acceptInvitation,
  asDatabaseSession,
  canAccessOrg,
  canManageOrg,
  createInvitation,
  createOrganization,
  initializeDatabaseAuthState,
  listInvitations,
  listOrgAuditEvents,
  listOrgMembers,
  listOrganizationsForSession,
  loginWithPassword,
  registerWorkspaceAccount,
  removeMember,
  resolveDatabaseSession,
  revokeDatabaseSession,
  revokeInvitation,
  switchActiveOrg,
  updateMemberRole,
} from "./access/user-accounts.js";
import {
  assignOrgPlan,
  checkSeatLimit,
  checkUsageLimit,
  consumeUsage,
  getOrgEntitlements,
  getUsageSummary,
  listPlanDefinitions,
  recordUsage,
  upgradeRequiredBody,
} from "./access/entitlements.js";
import {
  assetUsageReport,
  createCollection,
  createFolder,
  deleteAssetPermanently,
  getAsset,
  ingestAsset,
  listAssetVersions,
  listAssets,
  listCollections,
  listFolders,
  readAssetBytes,
  recordAssetUsage,
  restoreAssetVersion,
  searchAssetsForAi,
  setAssetLifecycle,
  setCollectionMembership,
  updateAsset,
} from "./assets/asset-service.js";
import { assetCloudDiagnostics } from "./assets/asset-cache.js";
import { describeAssetStorageProviders } from "./assets/asset-storage-provider.js";
import { runContentAssetMigration } from "./assets/asset-migration.js";
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
import {
  listTenantProviderConnections,
  saveTenantProviderConnection,
} from "./access/tenant-provider-connections.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccessStorageSnapshot } from "./access/access-storage.js";
import { consumeRateLimit } from "./access/rate-limit.js";
import { actionRegistry, isActionImplemented } from "./approval/action-registry.js";
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
import { buildInstantChatFallbackReply } from "./phantom-ai/instant-chat-fallback.js";
import {
  AgentActionRequestSchema,
  getAgentActionDefinitions,
  runAgentAction,
} from "./phantom-ai/agent-actions.js";
import { getSalesConnectorStatus } from "./connectors/sales-connector.js";
import { getFinanceConnectorStatus } from "./connectors/finance-connector.js";
import { parseExpenseText, parseReceiptImage } from "./connectors/finance-smart-entry.js";
import { getReceiptAssetStorageProvider } from "./connectors/receipt-asset-storage.js";
import {
  completeSocialOAuthCallback,
  createSocialOAuthStart,
  getSocialAnalyticsConnectorStatus,
  isSocialAnalyticsPlatform,
  syncSocialAnalytics,
} from "./connectors/social-analytics-connector.js";
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
  createPhantomPlayRoom,
  createPhantomPlaySubmission,
  getPhantomPlayRoom,
  getPhantomPlaySnapshot,
  getPhantomPlayStoreStatus,
  joinPhantomPlayRoom,
  leavePhantomPlayRoom,
  moderatePhantomPlaySubmission,
  startPhantomPlaySession,
  updatePhantomPlayProfile,
  updatePhantomPlayRoomMatch,
  updatePhantomPlaySession,
  updatePhantomPlaySubmission,
} from "./phantom-ai/phantomplay.js";
import {
  getPhantomStoreSnapshot,
  getPhantomStoreStatus,
  moderatePhantomStoreTool,
  recordPhantomStoreInstallClick,
  recordPhantomStoreProductBuyClick,
  submitPhantomStoreTool,
  updatePhantomStoreTool,
} from "./phantom-ai/phantomstore.js";
import {
  claimPhantomPlayHandle,
  getPhantomPlayGlobalLeaderboard,
  getPhantomPlayHandle,
  recomputeGlobalScoreForUser,
} from "./phantom-ai/phantomplay-handle.js";
import {
  confirmMissionStart,
  createMissionApproval,
  decomposeMissionObjective,
  getMission,
  getMissionReport,
  missionWorkerAction,
  synthesizeMission,
  terminaHealth,
} from "./phantom-ai/termina-bridge.js";
import {
  getPhantomPlayDeveloperAnalytics,
  getPhantomPlayDiscovery,
  getPhantomPlayGamePage,
  getPhantomPlayLeaderboard,
  getPhantomPlayResumeState,
  getPhantomPlayV2Snapshot,
  getPhantomPlayV2StoreStatus,
  getPhantomPlayWorkspacePolicy,
  heartbeatPhantomPlayPresence,
  mutatePhantomPlayFriend,
  phantomPlayV2Enabled,
  registerPhantomPlayV2Games,
  setPhantomPlayFollow,
  setPhantomPlayWishlist,
  updatePhantomPlayWorkspacePolicy,
  upsertPhantomPlayReview,
} from "./phantom-ai/phantomplay-v2.js";
import { registerPhantomPlayFlagshipGames } from "./phantom-ai/phantomplay-flagship.js";
import {
  auditCompetitorIntelligenceRequest,
  createAudienceTheme,
  createCompetitor,
  createCreativeAnalysis,
  createInterceptionPackage,
  createMysteryEvidence,
  createResearchOpportunity,
  createSignal,
  fuseCompetitorSignals,
  getCompetitorIntelligenceSnapshot,
  getCompetitorIntelligenceStoreStatus,
  updateMarketScoutContext,
  updateAggressiveMode,
} from "./phantom-ai/competitor-intelligence.js";
import {
  buildWorkspaceAwarenessText,
  getOrganizationGraph,
  getOrganizationOpportunities,
  getOrganizationPulse,
} from "./phantom-ai/organization-pulse.js";
import { getBrainContract, getSignals } from "./phantom-ai/signals.js";
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
  approveAgentRun,
  getAgentRun,
  listAgentRunOperations,
  listAgentRuns,
  rehydrateAgentRuns,
  rejectAgentRun,
  requestAgentRunCancel,
  startAgentRun,
} from "./phantom-ai/agent-runs.js";
import {
  addSiteDomain,
  createSiteBuild,
  getBuildHtml,
  getPublishedHtml,
  listOrgSites,
  registerPublishingExecutor,
  rollbackSite,
  verifySiteDomain,
} from "./sites/publishing.js";
import { orgHasFeature } from "./access/entitlements.js";
import { getContentAssetStorageProvider } from "./phantom-ai/content-asset-storage.js";
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
import { runCodexOperatorChat } from "./phantom-ai/codex-operator.js";
import { callClaudeCliChat } from "./phantom-ai/providers/claude-cli-transport.js";
import { callCodexCliChat } from "./phantom-ai/providers/codex-cli-transport.js";
import { callLocalOllamaChat } from "./phantom-ai/providers/local-ollama-transport.js";
import { callOpenRouterGlm52 } from "./phantom-ai/providers/openrouter-live-transport.js";
import {
  adminProviderAttemptOrder,
  getAdminProviderManagerStatus,
  getPublicAdminProviderManagerStatus,
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
import { PLATFORM_MODULES } from "./customization/module-registry.js";
import {
  getOrganizationConfiguration,
  planAssistantCustomization,
  previewConfigurationChange,
  publicConfiguration,
  publishConfigurationChange,
  resetOrganizationConfiguration,
  rollbackOrganizationConfiguration,
  type CustomizationEntitlements,
} from "./customization/customization-service.js";
import {
  CLIENT_SETUP_BUSINESS_TEMPLATES,
  CLIENT_SETUP_MODULES,
  getClientSetupDocument,
  isClientSetupSlotId,
  publicClientSetupDocument,
  saveClientSetupSlot,
} from "./client-setup/client-setup-store.js";
import {
  createCrmLead,
  deleteCrmLead,
  getCrmPipelineDocument,
  publicCrmPipelineDocument,
  updateCrmLead,
  upsertCrmProspectLanes,
} from "./crm/crm-pipeline-store.js";
import {
  createProposalDraft,
  deleteProposalDraft,
  getProposalDocument,
  publicProposalDocument,
  updateProposalDraft,
} from "./proposals/proposal-store.js";
import {
  createWorkspaceApproval,
  decideWorkspaceApproval,
  deleteWorkspaceApproval,
  getWorkspaceApprovalDocument,
  publicWorkspaceApprovalDocument,
} from "./workspace-approvals/workspace-approval-store.js";
import { buildManagedGrowthReport } from "./managed-growth/managed-growth-report.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5190);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const appStaticRoot = resolve(moduleDir, "..", "..", "app");
const appStaticTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};

/* Build fingerprint captured once at boot: the git commit this Hermes
   process is running. The admin sync compares it against the freshly-pulled
   repo HEAD and restarts Hermes when they differ — the same hands-free
   pattern the static server already uses via its source_hash, so a push to
   main brings NEW API ROUTES live within one sync cycle instead of waiting
   for a manual restart. */
const runningCommit = (() => {
  if (process.env.PHANTOMFORCE_BUILD_COMMIT) return process.env.PHANTOMFORCE_BUILD_COMMIT.trim().slice(0, 40);
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), timeout: 4000 })
      .toString().trim().slice(0, 40);
  } catch {
    return "unknown";
  }
})();

const app = Fastify({
  logger: process.env.PHANTOMFORCE_SERVER_LOGGER === "false" ? false : true,
});

const CustomizationTenantQuerySchema = z.object({ tenant_id: z.string().trim().max(80).optional() });
const CustomizationPreviewBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), patch: z.unknown() });
const CustomizationPublishBodySchema = CustomizationPreviewBodySchema.extend({ summary: z.string().trim().max(240).optional(), expected_version: z.number().int().positive().optional() });
const CustomizationRollbackBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), version: z.number().int().positive() });
const CustomizationAssistantBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), message: z.string().trim().min(1).max(1200) });
const ClientSetupTenantQuerySchema = z.object({ tenant_id: z.string().trim().max(80).optional() });
const ClientSetupSlotBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), slot: z.unknown() });
const CrmTenantQuerySchema = z.object({ tenant_id: z.string().trim().max(80).optional() });
const CrmLeadBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), lead: z.unknown() });
const CrmLeadPatchBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), patch: z.unknown() });
const CrmProspectLanesBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), prompt: z.string().trim().max(1200).optional(), leads: z.array(z.unknown()).max(12) });
const ProposalTenantQuerySchema = z.object({ tenant_id: z.string().trim().max(80).optional() });
const ProposalBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), proposal: z.unknown() });
const ProposalPatchBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), patch: z.unknown() });
const WorkspaceApprovalTenantQuerySchema = z.object({ tenant_id: z.string().trim().max(80).optional() });
const WorkspaceApprovalBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), approval: z.unknown() });
const WorkspaceApprovalPatchBodySchema = z.object({ tenant_id: z.string().trim().max(80).optional(), patch: z.unknown() });
const ManagedGrowthReportTenantQuerySchema = z.object({ tenant_id: z.string().trim().max(80).optional() });
const SocialAnalyticsSyncSchema = z.object({
  platform: z.enum(["youtube", "instagram", "facebook", "tiktok", "x", "linkedin", "pinterest"]),
});

function safeCustomizationTenantId(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

function customizationTenantForSession(session: AccessSession, requestedTenantId?: string) {
  if (session.canManageAccess) return safeCustomizationTenantId(requestedTenantId, "phantomforce-owner");
  return safeCustomizationTenantId(session.clientId, `client-${session.id}`);
}

function customizationEntitlements(session: AccessSession, tenantId: string): CustomizationEntitlements {
  const workspace = getWorkspaceAccess(tenantId);
  const modules = new Set((workspace?.decision.modules ?? []).map((module) => module.trim().toLowerCase()));
  const internalPhantomForce = session.canManageAccess && ["phantomforce", "phantomforce-owner"].includes(tenantId);
  return {
    internalPhantomForce,
    coBranded: internalPhantomForce || modules.has("co-branded") || modules.has("white-label"),
    whiteLabel: internalPhantomForce || modules.has("white-label"),
  };
}

function clientSetupTenantForSession(session: AccessSession, requestedTenantId?: string) {
  if (session.canManageAccess) return safeCustomizationTenantId(requestedTenantId, "phantomforce-owner");
  return safeCustomizationTenantId(session.orgId || session.clientId, `client-${session.id}`);
}

function canManageClientSetup(session: AccessSession) {
  return session.canManageAccess || session.orgRole === "owner" || session.orgRole === "admin";
}

function crmTenantForSession(session: AccessSession, requestedTenantId?: string) {
  if (session.canManageAccess) return safeCustomizationTenantId(requestedTenantId, "phantomforce-owner");
  return safeCustomizationTenantId(session.orgId || session.clientId, `client-${session.id}`);
}

function canWriteCrm(session: AccessSession) {
  return session.canManageAccess || session.orgRole === "owner" || session.orgRole === "admin" || session.orgRole === "member";
}

function proposalTenantForSession(session: AccessSession, requestedTenantId?: string) {
  return crmTenantForSession(session, requestedTenantId);
}

function workspaceApprovalTenantForSession(session: AccessSession, requestedTenantId?: string) {
  return crmTenantForSession(session, requestedTenantId);
}

function canDecideWorkspaceApprovals(session: AccessSession) {
  return session.canManageAccess || session.orgRole === "owner" || session.orgRole === "admin";
}

await app.register(cors, {
  origin: [
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/localhost:\d+$/,
    ...PUBLIC_WEB_ORIGINS,
  ],
  credentials: true,
  allowedHeaders: ["Content-Type", AUTHORIZATION_HEADER, SESSION_HEADER],
});

/* Database-auth sessions resolve from Postgres per request. This hook runs
   BEFORE the paywall so the paywall sees the real entitlement-bearing
   session. Signature and expiry are verified before any DB lookup. */
app.addHook("preHandler", async (request) => {
  if (!databaseAuthEnabledForSessions()) return;
  const sid = verifyAccessSessionTokenSid(readBearerToken(request));
  if (!sid || !sid.startsWith(DB_SESSION_PREFIX)) return;
  const session = await resolveDatabaseSession(sid);
  if (session) attachDatabaseSession(request, session);
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
  await initializeDatabaseAuthState();
  await initializeAccessWorkflowState();
  await rehydrateAgentRuns();
  /* the publish executor talks to Postgres — register only when configured */
  if (process.env.DATABASE_URL) {
    registerPublishingExecutor();
  }
} catch (error) {
  app.log.error(error, "PhantomForce server startup failed while loading access state.");
  await app.close();
  process.exit(1);
}

app.get("/health", async () => {
  return {
    ok: true,
    service: "phantomforce-server",
    /* the commit this API process is running — the sync watches this to know
       when a git pull delivered new server code and Hermes must restart */
    commit: runningCommit,
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

app.get("/phantom-ai/customization/modules", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  return {
    ok: true,
    modules: PLATFORM_MODULES.map((module) => ({
      ...module,
      visibleToCurrentSession: module.allowedRoles.includes(session.canManageAccess ? "owner" : "client"),
    })),
    protectedCore: true,
    providerCalled: false,
  };
});

app.get("/phantom-ai/customization/config", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  const state = await getOrganizationConfiguration(tenantId, session.id);
  return {
    ok: true,
    tenant_id: tenantId,
    configuration: publicConfiguration(state.configuration),
    entitlements: customizationEntitlements(session, tenantId),
    version_count: state.versions.length,
    platform_core_editable: false,
    provider_called: false,
  };
});

app.get("/phantom-ai/customization/versions", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  const state = await getOrganizationConfiguration(tenantId, session.id);
  return {
    ok: true,
    tenant_id: tenantId,
    versions: state.versions.map(({ configuration: _configuration, ...version }) => version).reverse(),
    audit: state.audit.slice().reverse(),
    provider_called: false,
  };
});

app.post("/phantom-ai/customization/preview", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationPreviewBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  try {
    const preview = await previewConfigurationChange({ tenantId, actor: session.id, patch: parsed.data.patch, entitlements: customizationEntitlements(session, tenantId) });
    return { ok: true, tenant_id: tenantId, preview, provider_called: false, source_code_edited: false };
  } catch (error) {
    if (error instanceof z.ZodError) return reply.status(400).send({ ok: false, error: error.flatten() });
    throw error;
  }
});

app.post("/phantom-ai/customization/publish", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationPublishBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  try {
    const result = await publishConfigurationChange({
      tenantId,
      actor: session.id,
      patch: parsed.data.patch,
      summary: parsed.data.summary ?? "Published workspace customization",
      expectedVersion: parsed.data.expected_version,
      entitlements: customizationEntitlements(session, tenantId),
    });
    return { ok: true, tenant_id: tenantId, result, outbound_action_executed: false, protected_core_modified: false };
  } catch (error) {
    if (error instanceof z.ZodError) return reply.status(400).send({ ok: false, error: error.flatten() });
    return reply.status(409).send({ ok: false, error: error instanceof Error ? error.message : "Customization could not be published." });
  }
});

app.post("/phantom-ai/customization/rollback", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationRollbackBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  try {
    const result = await rollbackOrganizationConfiguration({ tenantId, actor: session.id, version: parsed.data.version, entitlements: customizationEntitlements(session, tenantId) });
    return { ok: true, tenant_id: tenantId, result, protected_core_modified: false };
  } catch (error) {
    return reply.status(409).send({ ok: false, error: error instanceof Error ? error.message : "Rollback failed." });
  }
});

app.post("/phantom-ai/customization/reset", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationTenantQuerySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  const result = await resetOrganizationConfiguration({ tenantId, actor: session.id });
  return { ok: true, tenant_id: tenantId, result, organization_data_deleted: false, protected_core_modified: false };
});

app.post("/phantom-ai/customization/assistant-plan", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CustomizationAssistantBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = customizationTenantForSession(session, parsed.data.tenant_id);
  const state = await getOrganizationConfiguration(tenantId, session.id);
  const plan = planAssistantCustomization(parsed.data.message, state.configuration);
  if (!plan.understood) return reply.status(422).send({ ok: false, error: "I could not map that request to a safe workspace setting yet.", plan });
  const preview = await previewConfigurationChange({ tenantId, actor: session.id, patch: plan.patch, entitlements: customizationEntitlements(session, tenantId) });
  return { ok: true, tenant_id: tenantId, plan, preview, provider_called: false, source_code_edited: false, requires_approval: true };
});

app.get("/api/client-setup", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const parsed = ClientSetupTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = clientSetupTenantForSession(session, parsed.data.tenant_id);
  const document = await getClientSetupDocument(tenantId, session.id);
  return {
    ok: true,
    tenant_id: tenantId,
    can_manage: canManageClientSetup(session),
    document: publicClientSetupDocument(document),
    templates: CLIENT_SETUP_BUSINESS_TEMPLATES,
    modules: CLIENT_SETUP_MODULES,
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.post("/api/client-setup/slots/:slotId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canManageClientSetup(session)) {
    return reply.status(403).send({ ok: false, error: "Saving client setup requires workspace owner/admin access." });
  }
  const { slotId } = request.params as { slotId: string };
  if (!isClientSetupSlotId(slotId)) return reply.status(404).send({ ok: false, error: "Unknown setup slot." });
  const parsed = ClientSetupSlotBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = clientSetupTenantForSession(session, parsed.data.tenant_id);
  const result = await saveClientSetupSlot({ tenantId, slotId, slot: parsed.data.slot, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    slot: result.slot,
    document: publicClientSetupDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.get("/api/crm/leads", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const parsed = CrmTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = crmTenantForSession(session, parsed.data.tenant_id);
  const document = await getCrmPipelineDocument(tenantId, session.id);
  return {
    ok: true,
    tenant_id: tenantId,
    can_write: canWriteCrm(session),
    document: publicCrmPipelineDocument(document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.post("/api/crm/leads", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Saving CRM leads requires workspace member access." });
  const parsed = CrmLeadBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = crmTenantForSession(session, parsed.data.tenant_id);
  const result = await createCrmLead({ tenantId, lead: parsed.data.lead, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    lead: result.result,
    document: publicCrmPipelineDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.post("/api/crm/prospect-lanes", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Saving CRM prospect lanes requires workspace member access." });
  const parsed = CrmProspectLanesBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = crmTenantForSession(session, parsed.data.tenant_id);
  const result = await upsertCrmProspectLanes({ tenantId, leads: parsed.data.leads, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    leads: result.result,
    document: publicCrmPipelineDocument(result.document),
    prompt_recorded: Boolean(parsed.data.prompt),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.post("/api/crm/leads/:leadId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Updating CRM leads requires workspace member access." });
  const { leadId } = request.params as { leadId: string };
  const parsed = CrmLeadPatchBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = crmTenantForSession(session, parsed.data.tenant_id);
  try {
    const result = await updateCrmLead({ tenantId, leadId, patch: parsed.data.patch, actor: session.id });
    return {
      ok: true,
      tenant_id: tenantId,
      lead: result.result,
      document: publicCrmPipelineDocument(result.document),
      provider_called: false,
      outbound_action_executed: false,
      public_exposure_changed: false,
    };
  } catch (error) {
    return reply.status(404).send({ ok: false, error: error instanceof Error ? error.message : "CRM lead not found." });
  }
});

app.delete("/api/crm/leads/:leadId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Deleting CRM leads requires workspace member access." });
  const { leadId } = request.params as { leadId: string };
  const parsed = CrmTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = crmTenantForSession(session, parsed.data.tenant_id);
  const result = await deleteCrmLead({ tenantId, leadId, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    deleted: result.result,
    document: publicCrmPipelineDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.get("/api/proposals", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const parsed = ProposalTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = proposalTenantForSession(session, parsed.data.tenant_id);
  const document = await getProposalDocument(tenantId, session.id);
  return {
    ok: true,
    tenant_id: tenantId,
    can_write: canWriteCrm(session),
    document: publicProposalDocument(document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.post("/api/proposals", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Saving proposal drafts requires workspace member access." });
  const parsed = ProposalBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = proposalTenantForSession(session, parsed.data.tenant_id);
  const result = await createProposalDraft({ tenantId, proposal: parsed.data.proposal, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    proposal: result.result,
    document: publicProposalDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.post("/api/proposals/:proposalId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Updating proposal drafts requires workspace member access." });
  const { proposalId } = request.params as { proposalId: string };
  const parsed = ProposalPatchBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = proposalTenantForSession(session, parsed.data.tenant_id);
  try {
    const result = await updateProposalDraft({ tenantId, proposalId, patch: parsed.data.patch, actor: session.id });
    return {
      ok: true,
      tenant_id: tenantId,
      proposal: result.result,
      document: publicProposalDocument(result.document),
      provider_called: false,
      outbound_action_executed: false,
      public_exposure_changed: false,
    };
  } catch (error) {
    return reply.status(404).send({ ok: false, error: error instanceof Error ? error.message : "Proposal draft not found." });
  }
});

app.delete("/api/proposals/:proposalId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Deleting proposal drafts requires workspace member access." });
  const { proposalId } = request.params as { proposalId: string };
  const parsed = ProposalTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = proposalTenantForSession(session, parsed.data.tenant_id);
  const result = await deleteProposalDraft({ tenantId, proposalId, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    deleted: result.result,
    document: publicProposalDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
  };
});

app.get("/api/workspace-approvals", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const parsed = WorkspaceApprovalTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = workspaceApprovalTenantForSession(session, parsed.data.tenant_id);
  const document = await getWorkspaceApprovalDocument(tenantId, session.id);
  return {
    ok: true,
    tenant_id: tenantId,
    can_write: canWriteCrm(session),
    can_decide: canDecideWorkspaceApprovals(session),
    document: publicWorkspaceApprovalDocument(document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
    approval_execution_implemented: false,
  };
});

app.post("/api/workspace-approvals", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canWriteCrm(session)) return reply.status(403).send({ ok: false, error: "Creating approval requests requires workspace member access." });
  const parsed = WorkspaceApprovalBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = workspaceApprovalTenantForSession(session, parsed.data.tenant_id);
  const result = await createWorkspaceApproval({ tenantId, approval: parsed.data.approval, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    approval: result.result,
    document: publicWorkspaceApprovalDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
    approval_execution_implemented: false,
  };
});

app.post("/api/workspace-approvals/:approvalId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canDecideWorkspaceApprovals(session)) return reply.status(403).send({ ok: false, error: "Deciding approval requests requires owner or admin access." });
  const { approvalId } = request.params as { approvalId: string };
  const parsed = WorkspaceApprovalPatchBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = workspaceApprovalTenantForSession(session, parsed.data.tenant_id);
  try {
    const result = await decideWorkspaceApproval({ tenantId, approvalId, patch: parsed.data.patch, actor: session.id });
    return {
      ok: true,
      tenant_id: tenantId,
      approval: result.result,
      document: publicWorkspaceApprovalDocument(result.document),
      provider_called: false,
      outbound_action_executed: false,
      public_exposure_changed: false,
      approval_execution_implemented: false,
    };
  } catch (error) {
    return reply.status(404).send({ ok: false, error: error instanceof Error ? error.message : "Workspace approval not found." });
  }
});

app.delete("/api/workspace-approvals/:approvalId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!canDecideWorkspaceApprovals(session)) return reply.status(403).send({ ok: false, error: "Deleting approval requests requires owner or admin access." });
  const { approvalId } = request.params as { approvalId: string };
  const parsed = WorkspaceApprovalTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = workspaceApprovalTenantForSession(session, parsed.data.tenant_id);
  const result = await deleteWorkspaceApproval({ tenantId, approvalId, actor: session.id });
  return {
    ok: true,
    tenant_id: tenantId,
    deleted: result.result,
    document: publicWorkspaceApprovalDocument(result.document),
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
    approval_execution_implemented: false,
  };
});

app.get("/api/managed-growth/report", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const parsed = ManagedGrowthReportTenantQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return reply.status(400).send({ ok: false, error: parsed.error.flatten() });
  const tenantId = crmTenantForSession(session, parsed.data.tenant_id);
  const [clientSetup, crm, proposals, approvals] = await Promise.all([
    getClientSetupDocument(tenantId, session.id),
    getCrmPipelineDocument(tenantId, session.id),
    getProposalDocument(tenantId, session.id),
    getWorkspaceApprovalDocument(tenantId, session.id),
  ]);
  const report = buildManagedGrowthReport({ tenantId, clientSetup, crm, proposals, approvals });
  return {
    ok: true,
    tenant_id: tenantId,
    report,
    provider_called: false,
    outbound_action_executed: false,
    public_exposure_changed: false,
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

app.get("/app", async (_request, reply) => reply.code(302).header("Location", "/app/index.html").send());

app.get("/app/*", async (request, reply) => {
  const rawPath = String((request.params as { "*": string })["*"] || "index.html");
  if (rawPath.includes("\0")) return reply.code(400).send({ ok: false, error: "Invalid app asset path." });

  const assetPath = resolve(appStaticRoot, rawPath.replace(/^[/\\]+/, ""));
  if (assetPath !== appStaticRoot && !assetPath.startsWith(`${appStaticRoot}${sep}`)) {
    return reply.code(403).send({ ok: false, error: "App asset path is outside the local app bundle." });
  }

  try {
    const bytes = await readFile(assetPath);
    const contentType = appStaticTypes[extname(assetPath).toLowerCase()] ?? "application/octet-stream";
    return reply.header("content-type", contentType).header("cache-control", "no-store").send(bytes);
  } catch {
    return reply.code(404).send({ ok: false, error: "app_asset_not_found" });
  }
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

/* Brute-force throttle for auth endpoints. Keyed per-IP+identifier so one
   attacker hammering a single account can't lock other accounts out, and
   per-IP alone so a single script rotating identifiers is still capped. */
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 10;
const AUTH_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

function enforceAuthRateLimit(request: FastifyRequest, reply: FastifyReply, identifier: string) {
  const ip = request.ip || "unknown";
  const normalizedIdentifier = (identifier || "unknown").trim().toLowerCase().slice(0, 200);

  const perIdentifier = consumeRateLimit(
    `auth:id:${ip}:${normalizedIdentifier}`,
    AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    AUTH_RATE_LIMIT_WINDOW_MS,
  );
  const perIp = consumeRateLimit(`auth:ip:${ip}`, AUTH_RATE_LIMIT_MAX_ATTEMPTS * 3, AUTH_RATE_LIMIT_WINDOW_MS);

  const result = perIdentifier.limited ? perIdentifier : perIp;
  if (result.limited) {
    reply
      .header("Retry-After", Math.ceil(result.retryAfterMs / 1000).toString())
      .code(429)
      .send({ ok: false, error: "too_many_attempts" });
    return false;
  }
  return true;
}

async function handleSessionLogin(request: FastifyRequest, reply: FastifyReply) {
  const authConfiguration = getAccessAuthConfiguration();

  const parsed = AccessLoginSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  if (!enforceAuthRateLimit(request, reply, parsed.data.email || parsed.data.sessionId)) {
    return reply;
  }

  /* Under the database auth provider, sessionLoginEnabled is false (it only
     covers the legacy in-memory providers below) — but the admin gate still
     posts email+password to this same endpoint for the platform super-admin,
     so that specific shape must be allowed through before the legacy gate. */
  const isDatabaseOwnerLoginAttempt =
    authConfiguration.databaseAuthEnabled && parsed.data.sessionId === OWNER_SESSION_ID && Boolean(parsed.data.password);

  if (!authConfiguration.sessionLoginEnabled && !isDatabaseOwnerLoginAttempt) {
    return reply.code(403).send({
      ok: false,
      error: "Session login is disabled.",
      auth: authConfiguration,
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

  /* Owner-production's in-memory owner key doesn't apply under database
     auth — the platform super-admin must be verified against the real
     Postgres user instead. Only isSuperAdmin users may authenticate here;
     ordinary org members/owners still sign in through /auth/login. */
  if (isDatabaseOwnerLoginAttempt && parsed.data.password) {
    const dbSession = parsed.data.email ? await loginWithPassword(parsed.data.email, parsed.data.password) : undefined;
    if (!dbSession || !dbSession.isSuperAdmin) {
      return reply.code(401).send({
        ok: false,
        error: "Invalid owner email or password.",
        sessions: [],
      });
    }
    if (!canUseSessionOnPublicHost(publicHost, dbSession)) {
      await revokeDatabaseSession(dbSession.authSessionId);
      return reply.code(403).send({
        ok: false,
        error: "This session is not available on this public host.",
        host: publicHost || "local",
      });
    }
    const dbToken = mintDatabaseSessionToken(dbSession.id);
    if (!dbToken) {
      return reply.code(500).send({ ok: false, error: "Token minting unavailable." });
    }
    return { ok: true, ...dbToken, session: dbSession };
  }

  let ownerKeyForToken = parsed.data.ownerKey;

  if (authConfiguration.ownerProductionAuthEnabled && parsed.data.password) {
    if (!verifyOwnerCredentials(parsed.data.email, parsed.data.password)) {
      return reply.code(401).send({
        ok: false,
        error: "Invalid owner email or password.",
        sessions: [],
      });
    }

    ownerKeyForToken = parsed.data.password;
  }

  const token = issueAccessSessionToken(parsed.data.sessionId, {
    ownerKey: ownerKeyForToken,
  });

  if (!token) {
    return reply.code(401).send({
      ok: false,
      error: "Invalid session credentials.",
      auth: authConfiguration,
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

/* ============================================================================
   DATABASE AUTH + ORGANIZATIONS
   Real multi-user login (Postgres users, scrypt hashes, revocable sessions),
   org memberships with distinct roles, invitations, org switching, audit.
   All org routes enforce tenant isolation server-side: non-members are 403'd
   regardless of what the frontend shows. */

const DatabaseLoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const DatabaseSignupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().max(120).optional(),
  workspaceName: z.string().min(2).max(120),
  workspaceBrief: z.string().trim().min(12).max(600),
  workspaceProfile: z.enum(["business", "creator", "developer"]).default("business"),
});

app.post("/auth/signup", async (request, reply) => {
  const authConfiguration = getAccessAuthConfiguration();
  if (!authConfiguration.databaseAuthEnabled) {
    return reply.code(403).send({ ok: false, error: "Database auth is disabled.", auth: authConfiguration });
  }
  const parsed = DatabaseSignupSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.workspaceBrief?.length) return reply.code(400).send({ ok: false, error: "workspace_brief_required" });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }
  if (!enforceAuthRateLimit(request, reply, parsed.data.email)) {
    return reply;
  }
  const result = await registerWorkspaceAccount(parsed.data);
  if (!result.ok) {
    const status = result.error === "account_exists" ? 409 : 400;
    return reply.code(status).send({ ok: false, error: result.error });
  }
  const publicHost = requestPublicHost(request);
  if (!canUseSessionOnPublicHost(publicHost, result.session)) {
    await revokeDatabaseSession(result.session.authSessionId);
    return reply.code(403).send({
      ok: false,
      error: "This account is not available on this public host.",
      host: publicHost || "local",
    });
  }
  const token = mintDatabaseSessionToken(result.session.id);
  if (!token) return reply.code(500).send({ ok: false, error: "Token minting unavailable." });
  return {
    ok: true,
    ...token,
    session: result.session,
    org: result.org,
    workspaceProfile: {
      id: result.profile.id,
      label: result.profile.label,
      workspaceName: result.profile.workspaceName,
      homeModuleId: result.profile.homeModuleId,
    },
  };
});

app.post("/auth/login", async (request, reply) => {
  const authConfiguration = getAccessAuthConfiguration();
  if (!authConfiguration.databaseAuthEnabled) {
    return reply.code(403).send({ ok: false, error: "Database auth is disabled.", auth: authConfiguration });
  }
  const parsed = DatabaseLoginSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }
  if (!enforceAuthRateLimit(request, reply, parsed.data.email)) {
    return reply;
  }
  const session = await loginWithPassword(parsed.data.email, parsed.data.password);
  if (!session) {
    /* uniform delay-free refusal; no user-exists oracle */
    return reply.code(401).send({ ok: false, error: "Invalid email or password." });
  }
  const publicHost = requestPublicHost(request);
  if (!canUseSessionOnPublicHost(publicHost, session)) {
    await revokeDatabaseSession(session.authSessionId);
    return reply.code(403).send({
      ok: false,
      error: "This account is not available on this public host.",
      host: publicHost || "local",
    });
  }
  const token = mintDatabaseSessionToken(session.id);
  if (!token) {
    return reply.code(500).send({ ok: false, error: "Token minting unavailable." });
  }
  return { ok: true, ...token, session };
});

app.post("/auth/logout", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const dbSession = asDatabaseSession(session);
  if (!dbSession) {
    return { ok: true, note: "Stateless session tokens expire on their own; nothing to revoke server-side." };
  }
  await revokeDatabaseSession(dbSession.authSessionId);
  return { ok: true, revoked: true };
});

app.get("/auth/me", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const dbSession = asDatabaseSession(session);
  if (!dbSession) {
    return { ok: true, session, database: false };
  }
  const entitlements = dbSession.orgId ? await getOrgEntitlements(dbSession.orgId).catch(() => null) : null;
  return {
    ok: true,
    database: true,
    user: {
      id: dbSession.userId,
      email: dbSession.email,
      name: dbSession.label,
      isSuperAdmin: dbSession.isSuperAdmin,
    },
    activeOrg: dbSession.orgId
      ? {
          id: dbSession.orgId,
          name: dbSession.memberships.find((m) => m.orgId === dbSession.orgId)?.orgName ?? dbSession.orgId,
          role: dbSession.orgRole,
        }
      : null,
    memberships: dbSession.memberships,
    entitlements: entitlements
      ? {
          plan: entitlements.planName,
          planKey: entitlements.planKey,
          status: entitlements.effectiveStatus,
          canWrite: entitlements.canWrite,
          features: entitlements.features,
          limits: entitlements.limits,
        }
      : null,
  };
});

const SwitchOrgSchema = z.object({ orgId: z.string().min(1).max(120) });

app.post("/auth/switch-org", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const dbSession = asDatabaseSession(session);
  if (!dbSession) return reply.code(400).send({ ok: false, error: "Org switching requires database auth." });
  const parsed = SwitchOrgSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await switchActiveOrg(dbSession, parsed.data.orgId);
  if (!result.ok) return reply.code(403).send({ ok: false, error: result.error });
  return { ok: true, session: result.session };
});

const InvitationAcceptSchema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().max(120).optional(),
  password: z.string().min(8).max(200).optional(),
});

app.post("/auth/invitations/accept", async (request, reply) => {
  const authConfiguration = getAccessAuthConfiguration();
  if (!authConfiguration.databaseAuthEnabled) {
    return reply.code(403).send({ ok: false, error: "Database auth is disabled." });
  }
  const parsed = InvitationAcceptSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await acceptInvitation(parsed.data);
  if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
  return { ok: true, userId: result.userId, orgId: result.orgId, next: "Sign in at /auth/login." };
});

/* -- org routes: every one resolves membership server-side -- */

function requireDatabaseSession(request: FastifyRequest, reply: FastifyReply) {
  const session = requireAccessSession(request, reply);
  if (!session) return undefined;
  const dbSession = asDatabaseSession(session);
  if (!dbSession) {
    reply.code(403).send({ ok: false, error: "This route requires database auth." });
    return undefined;
  }
  return dbSession;
}

function requireOrgMember(request: FastifyRequest, reply: FastifyReply, orgId: string) {
  const dbSession = requireDatabaseSession(request, reply);
  if (!dbSession) return undefined;
  if (!canAccessOrg(dbSession, orgId)) {
    reply.code(403).send({ ok: false, error: "This session is not a member of the requested organization." });
    return undefined;
  }
  return dbSession;
}

function requireOrgManager(request: FastifyRequest, reply: FastifyReply, orgId: string) {
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return undefined;
  if (!canManageOrg(dbSession, orgId)) {
    reply.code(403).send({ ok: false, error: "Managing this organization requires an owner or admin role." });
    return undefined;
  }
  return dbSession;
}

function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  const dbSession = requireDatabaseSession(request, reply);
  if (!dbSession) return undefined;
  if (!dbSession.isSuperAdmin) {
    reply.code(403).send({ ok: false, error: "Platform super-admin access required." });
    return undefined;
  }
  return dbSession;
}

app.get("/orgs", async (request, reply) => {
  const dbSession = requireDatabaseSession(request, reply);
  if (!dbSession) return reply;
  return { ok: true, organizations: await listOrganizationsForSession(dbSession) };
});

const OrgCreateSchema = z.object({ name: z.string().min(2).max(120) });

app.post("/orgs", async (request, reply) => {
  const dbSession = requireSuperAdmin(request, reply);
  if (!dbSession) return reply;
  const parsed = OrgCreateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const org = await createOrganization({ name: parsed.data.name, actor: dbSession });
  return { ok: true, org: { id: org.id, name: org.name } };
});

app.get("/orgs/:orgId/members", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, members: await listOrgMembers(orgId) };
});

const MemberRoleSchema = z.object({ role: z.enum(["owner", "admin", "member", "client"]) });

app.post("/orgs/:orgId/members/:userId/role", async (request, reply) => {
  const { orgId, userId } = request.params as { orgId: string; userId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = MemberRoleSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await updateMemberRole({ orgId, targetUserId: userId, role: parsed.data.role, actor: dbSession });
  if (!result.ok) return reply.code(403).send({ ok: false, error: result.error });
  return { ok: true };
});

app.delete("/orgs/:orgId/members/:userId", async (request, reply) => {
  const { orgId, userId } = request.params as { orgId: string; userId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await removeMember({ orgId, targetUserId: userId, actor: dbSession });
  if (!result.ok) return reply.code(403).send({ ok: false, error: result.error });
  return { ok: true };
});

const InvitationCreateSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(["owner", "admin", "member", "client"]).default("member"),
});

app.post("/orgs/:orgId/invitations", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = InvitationCreateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const seats = await checkSeatLimit(orgId);
  if (!seats.allowed) {
    const entitlements = await getOrgEntitlements(orgId);
    return reply.code(403).send({ ...upgradeRequiredBody("seat_limit_reached", entitlements), seats });
  }
  const result = await createInvitation({ orgId, email: parsed.data.email, role: parsed.data.role, actor: dbSession });
  if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
  return {
    ok: true,
    invitation: { id: result.invitation.id, email: result.invitation.email, role: result.invitation.role, expiresAt: result.invitation.expiresAt.toISOString() },
    /* shown exactly once — only the hash is stored */
    token: result.token,
    accept_endpoint: "/auth/invitations/accept",
  };
});

app.get("/orgs/:orgId/invitations", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, invitations: await listInvitations(orgId) };
});

app.post("/orgs/:orgId/invitations/:invitationId/revoke", async (request, reply) => {
  const { orgId, invitationId } = request.params as { orgId: string; invitationId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await revokeInvitation({ orgId, invitationId, actor: dbSession });
  if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
  return { ok: true };
});

app.get("/orgs/:orgId/audit", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, events: await listOrgAuditEvents(orgId) };
});

/* -- entitlements: current org for members; assignment is super-admin only -- */

app.get("/orgs/:orgId/entitlements", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, ...(await getUsageSummary(orgId)) };
});

const TenantProviderConnectionSchema = z.object({
  provider: z.string().trim().min(2).max(60),
  credentialReference: z.string().trim().max(180).optional(),
  subscriptionReference: z.string().trim().max(180).optional(),
  historyMode: z.enum(["provider_managed", "workspace_scoped", "none"]).default("provider_managed"),
  note: z.string().trim().max(240).optional(),
});

app.get("/orgs/:orgId/provider-connections", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  return {
    ok: true,
    connections: await listTenantProviderConnections(orgId),
    secret_storage: "not_in_browser",
    tenant_owned_only: true,
  };
});

app.post("/orgs/:orgId/provider-connections", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = TenantProviderConnectionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await saveTenantProviderConnection({ orgId, ...parsed.data });
  if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
  return {
    ok: true,
    connection: result.connection,
    secret_stored: false,
    tenant_owned_only: true,
  };
});

app.get("/admin/plans", async (request, reply) => {
  const dbSession = requireSuperAdmin(request, reply);
  if (!dbSession) return reply;
  return { ok: true, plans: listPlanDefinitions() };
});

const PlanAssignSchema = z.object({
  planKey: z.string().min(1).max(60),
  status: z.enum(["trial", "active", "grace", "suspended"]).optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  graceUntil: z.string().datetime().nullable().optional(),
  overrides: z
    .object({ features: z.record(z.string(), z.unknown()).optional(), limits: z.record(z.string(), z.unknown()).optional() })
    .nullable()
    .optional(),
  note: z.string().max(300).nullable().optional(),
});

app.post("/admin/orgs/:orgId/plan", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireSuperAdmin(request, reply);
  if (!dbSession) return reply;
  const parsed = PlanAssignSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await assignOrgPlan({
    orgId,
    planKey: parsed.data.planKey,
    status: parsed.data.status,
    trialEndsAt: parsed.data.trialEndsAt ?? undefined,
    graceUntil: parsed.data.graceUntil ?? undefined,
    overrides: parsed.data.overrides as Parameters<typeof assignOrgPlan>[0]["overrides"],
    note: parsed.data.note ?? undefined,
    assignedByUserId: dbSession.userId,
  });
  if (!result.ok) return reply.code(400).send({ ok: false, error: result.error, available: result.available });
  await recordPlanAssignmentAudit(orgId, dbSession.email, parsed.data.planKey, parsed.data.status ?? "active");
  return { ok: true, entitlements: await getOrgEntitlements(orgId) };
});

async function recordPlanAssignmentAudit(orgId: string, actor: string, planKey: string, status: string) {
  const { recordOrgAuditEvent } = await import("./access/user-accounts.js");
  await recordOrgAuditEvent({
    orgId,
    actor,
    eventType: "plan.assigned",
    targetType: "org_plan",
    targetId: orgId,
    payload: { planKey, status },
  });
}

app.get("/admin/orgs/:orgId/usage", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireSuperAdmin(request, reply);
  if (!dbSession) return reply;
  return { ok: true, ...(await getUsageSummary(orgId)) };
});

/* ============================================================================
   ASSET CLOUD — the org-isolated permanent creative library.
   Blobs are content-addressed on the storage provider; metadata lives in
   Prisma; every route is org-gated; uploads meter storage_mb through the
   entitlement engine and permanent deletes release it. */

const AssetUploadSchema = z.object({
  data_url: z.string().min(32),
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  source: z.string().max(40).optional(),
  folder_id: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  brand: z.boolean().optional(),
  on_duplicate: z.enum(["keep_both", "skip", "version_of"]).optional(),
  version_of: z.string().max(120).optional(),
});

app.post("/orgs/:orgId/assets", { bodyLimit: 24 * 1024 * 1024 }, async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = AssetUploadSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  /* meter BEFORE writing: estimated MiB from base64 length (~3/4) */
  const estimatedMb = Math.max(1, Math.ceil((parsed.data.data_url.length * 0.75) / 1048576));
  if (!dbSession.isSuperAdmin) {
    const usage = await checkUsageLimit(orgId, "storage_mb", estimatedMb);
    if (!usage.allowed) {
      return reply.code(403).send({
        ...upgradeRequiredBody(usage.reason, usage.entitlements),
        usage: { metric: "storage_mb", used: usage.used, limit: usage.limit, resetAt: usage.resetAt },
      });
    }
  }

  const result = await ingestAsset({
    orgId,
    actorUserId: dbSession.userId,
    actorEmail: dbSession.email,
    dataUrl: parsed.data.data_url,
    name: parsed.data.name,
    title: parsed.data.title,
    source: parsed.data.source,
    folderId: parsed.data.folder_id ?? null,
    tags: parsed.data.tags,
    brand: parsed.data.brand,
    onDuplicate: parsed.data.on_duplicate,
    versionOfAssetId: parsed.data.version_of,
  });
  if (!result.ok) return reply.code(400).send(result);
  if (!result.deduplicated && result.asset) {
    await recordUsage(orgId, "storage_mb", Math.ceil(Number(result.asset.sizeBytes) / 1048576), {
      assetId: result.asset.id, mime: result.asset.mimeType,
    });
  }
  return result;
});

app.get("/orgs/:orgId/assets", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const q = request.query as Record<string, string | undefined>;
  const result = await listAssets(orgId, {
    view: q.view as Parameters<typeof listAssets>[1]["view"],
    kind: q.kind as Parameters<typeof listAssets>[1]["kind"],
    folderId: q.folder_id,
    collectionId: q.collection_id,
    search: q.search,
    tag: q.tag,
    source: q.source,
    orientation: q.orientation as Parameters<typeof listAssets>[1]["orientation"],
    sort: q.sort as Parameters<typeof listAssets>[1]["sort"],
    cursor: q.cursor,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  return { ok: true, ...result };
});

app.get("/orgs/:orgId/assets/:assetId", async (request, reply) => {
  const { orgId, assetId } = request.params as { orgId: string; assetId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const asset = await getAsset(orgId, assetId);
  if (!asset) return reply.code(404).send({ ok: false, error: "asset_not_found" });
  return { ok: true, asset, versions: await listAssetVersions(orgId, assetId), usage: await assetUsageReport(orgId, assetId) };
});

/* raw bytes — sniffing disabled and scripts sandboxed because these bytes
   are user uploads served under the app origin */
for (const variant of ["file", "thumbnail"] as const) {
  app.get(`/orgs/:orgId/assets/:assetId/${variant}`, async (request, reply) => {
    const { orgId, assetId } = request.params as { orgId: string; assetId: string };
    const dbSession = requireOrgMember(request, reply, orgId);
    if (!dbSession) return reply;
    const content = await readAssetBytes(orgId, assetId, variant);
    if (!content) return reply.code(404).send({ ok: false, error: "asset_content_not_found" });
    return reply
      .header("content-type", content.mime)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox")
      .header("cache-control", "private, max-age=3600")
      .send(content.bytes);
  });
}

const AssetPatchSchema = z.object({
  title: z.string().max(200).optional(),
  folder_id: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  favorite: z.boolean().optional(),
  brand: z.boolean().optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
});

app.post("/orgs/:orgId/assets/:assetId", async (request, reply) => {
  const { orgId, assetId } = request.params as { orgId: string; assetId: string };
  const parsed = AssetPatchSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  /* governance flags + brand marking are manager actions; everyday metadata
     (title/tags/favorite/folder) is open to members */
  const needsManager = parsed.data.flags !== undefined || parsed.data.brand !== undefined;
  const dbSession = needsManager ? requireOrgManager(request, reply, orgId) : requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await updateAsset({
    orgId,
    assetId,
    actorEmail: dbSession.email,
    patch: {
      title: parsed.data.title,
      folderId: parsed.data.folder_id,
      tags: parsed.data.tags,
      favorite: parsed.data.favorite,
      brand: parsed.data.brand,
      flags: parsed.data.flags,
    },
  });
  if (!result.ok) return reply.code(result.error === "asset_locked" ? 423 : 404).send(result);
  return result;
});

const AssetLifecycleSchema = z.object({ action: z.enum(["archive", "unarchive", "trash", "restore"]) });

app.post("/orgs/:orgId/assets/:assetId/lifecycle", async (request, reply) => {
  const { orgId, assetId } = request.params as { orgId: string; assetId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = AssetLifecycleSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await setAssetLifecycle({ orgId, assetId, actorEmail: dbSession.email, action: parsed.data.action });
  if (!result.ok) return reply.code(404).send(result);
  return result;
});

app.delete("/orgs/:orgId/assets/:assetId", async (request, reply) => {
  const { orgId, assetId } = request.params as { orgId: string; assetId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await deleteAssetPermanently({ orgId, assetId, actorEmail: dbSession.email });
  if (!result.ok) return reply.code(result.error === "not_in_trash" ? 409 : 404).send(result);
  /* release metered storage — negative usage reconciles the absolute sum */
  await recordUsage(orgId, "storage_mb", -Math.ceil(result.freedBytes / 1048576), { assetId, reason: "asset_deleted" });
  return { ok: true, freed_bytes: result.freedBytes, dependency_warnings: result.hadUsages };
});

app.get("/orgs/:orgId/assets/:assetId/versions", async (request, reply) => {
  const { orgId, assetId } = request.params as { orgId: string; assetId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, versions: await listAssetVersions(orgId, assetId) };
});

app.post("/orgs/:orgId/assets/:assetId/versions/:versionNumber/restore", async (request, reply) => {
  const { orgId, assetId, versionNumber } = request.params as { orgId: string; assetId: string; versionNumber: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await restoreAssetVersion({
    orgId, assetId, versionNumber: Number(versionNumber),
    actorEmail: dbSession.email, actorUserId: dbSession.userId,
  });
  if (!result.ok) return reply.code(404).send(result);
  return result;
});

const AssetUsageSchema = z.object({
  surface: z.string().min(1).max(40),
  ref_id: z.string().min(1).max(120),
  ref_label: z.string().min(1).max(160),
});

app.post("/orgs/:orgId/assets/:assetId/usage", async (request, reply) => {
  const { orgId, assetId } = request.params as { orgId: string; assetId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = AssetUsageSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await recordAssetUsage({ orgId, assetId, surface: parsed.data.surface, refId: parsed.data.ref_id, refLabel: parsed.data.ref_label });
  if (!result.ok) return reply.code(404).send(result);
  return result;
});

app.get("/orgs/:orgId/asset-folders", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, folders: await listFolders(orgId) };
});

const FolderCreateSchema = z.object({ name: z.string().min(1).max(120), parent_id: z.string().max(120).nullable().optional() });

app.post("/orgs/:orgId/asset-folders", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = FolderCreateSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await createFolder(orgId, parsed.data.name, parsed.data.parent_id ?? null);
  if (!result.ok) return reply.code(404).send(result);
  return result;
});

app.get("/orgs/:orgId/asset-collections", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, collections: await listCollections(orgId) };
});

app.post("/orgs/:orgId/asset-collections", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  return createCollection(orgId, parsed.data.name);
});

app.post("/orgs/:orgId/asset-collections/:collectionId/items", async (request, reply) => {
  const { orgId, collectionId } = request.params as { orgId: string; collectionId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = z.object({ asset_id: z.string().min(1).max(120), present: z.boolean() }).safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await setCollectionMembership({ orgId, collectionId, assetId: parsed.data.asset_id, present: parsed.data.present });
  if (!result.ok) return reply.code(404).send(result);
  return result;
});

/* admin curtain: diagnostics, provider status, migration */
app.get("/admin/asset-cloud/diagnostics", async (request, reply) => {
  const dbSession = requireSuperAdmin(request, reply);
  if (!dbSession) return reply;
  return { ok: true, ...(await assetCloudDiagnostics()), providers: describeAssetStorageProviders() };
});

const AssetMigrationSchema = z.object({
  scope_to_org: z.record(z.string(), z.string().max(120)),
  dry_run: z.boolean().default(true),
});

app.post("/admin/asset-cloud/migrate", async (request, reply) => {
  const dbSession = requireSuperAdmin(request, reply);
  if (!dbSession) return reply;
  const parsed = AssetMigrationSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const report = await runContentAssetMigration({
    scopeToOrg: parsed.data.scope_to_org,
    dryRun: parsed.data.dry_run,
    actorEmail: dbSession.email,
  });
  return { ok: true, report };
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

function requireManualBrainEditor(session: AccessSession, reply: FastifyReply) {
  if (session.canManageAccess) return true;
  reply.code(403).send({
    ok: false,
    error: "Manual brain editing is reserved for the platform owner workspace. Customer workspaces use scoped web memory and provider-managed history.",
    provider_called: false,
    network_call_performed: false,
    external_action_executed: false,
  });
  return false;
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
type AdminPhantomAiRouteTier = "instant" | "standard" | "deep";

function parseAdminPhantomAiModelLane(value: unknown): AdminPhantomAiModelLane {
  if (value === "glm_5_2" || value === "openrouter_glm" || value === "glm") return "glm_5_2";
  if (value === "claude_cli" || value === "claude") return "claude_cli";
  if (value === "private_brain" || value === "private" || value === "operator") return "codex";
  return "codex";
}

function parseAdminPhantomAiRouteTier(value: unknown): AdminPhantomAiRouteTier {
  if (value === "instant" || value === "standard" || value === "deep") return value;
  return "standard";
}

function parseRequestedAdminModel(value: unknown) {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > 100) return null;
  return /^[\w./:@+-]+$/.test(model) ? model : null;
}

function parseAdminMaxProviderMs(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.min(Math.max(Math.round(numeric), 3000), 60000);
}

function parseAllowProviderFallback(value: unknown, routeTier: AdminPhantomAiRouteTier) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return routeTier !== "instant";
}

function isExplicitAdminOperatorPrompt(value: string) {
  return /^(?:\/(?:run|list|read|search)\s+|run command:\s*|run cmd:\s*|execute command:\s*|execute:\s*)/i.test(value.trim());
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

function parseAllowedAdminProviders(value: unknown): AdminPhantomAiProviderId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const providers = Array.from(new Set(value.map((item: unknown) => {
    if (item === "private_brain" || item === "private") return "codex_cli";
    return item;
  }).filter((item: unknown): item is AdminPhantomAiProviderId =>
    item === "codex_cli" || item === "claude_cli" || item === "openrouter_glm" || item === "local_ollama")));
  return providers.length ? providers : undefined;
}

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
  if (providerId === "codex_cli") return "Private Brain";
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
  requestedModelId?: string | null;
  routeTier?: AdminPhantomAiRouteTier;
  maxProviderMs?: number | null;
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

const ADMIN_CHAT_INSTANT_TIMEOUT_MS = {
  codex_cli: 5000,
  claude_cli: 7000,
  openrouter_glm: 5000,
  local_ollama: 5000,
} as const;

function adminPhantomAiProviderTimeoutMs(providerId: AdminPhantomAiProviderId, ctx: AdminPhantomAiChatContext) {
  const tier = ctx.routeTier ?? "standard";
  const base = tier === "instant" ? ADMIN_CHAT_INSTANT_TIMEOUT_MS[providerId] : ADMIN_CHAT_FALLBACK_TIMEOUT_MS[providerId];
  if (typeof ctx.maxProviderMs === "number" && Number.isFinite(ctx.maxProviderMs)) {
    return Math.min(Math.max(Math.round(ctx.maxProviderMs), 3000), base);
  }
  return base;
}

async function callAdminPhantomAiProvider(providerId: AdminPhantomAiProviderId, ctx: AdminPhantomAiChatContext) {
  const timeoutMs = adminPhantomAiProviderTimeoutMs(providerId, ctx);
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
          PHANTOM_CODEX_TIMEOUT_MS: String(timeoutMs),
          ...(ctx.requestedModelId ? { PHANTOM_CODEX_MODEL: ctx.requestedModelId } : {}),
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
      timeoutMs,
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
          PHANTOM_OPENROUTER_TIMEOUT_MS: String(timeoutMs),
          ...(ctx.requestedModelId ? { OPENROUTER_MODEL: ctx.requestedModelId } : {}),
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
        PHANTOM_OLLAMA_TIMEOUT_MS: String(timeoutMs),
        ...(ctx.requestedModelId ? { PHANTOM_OLLAMA_MODEL: ctx.requestedModelId } : {}),
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

async function runAdminPhantomAiChatWithFallback(
  requestedLane: AdminPhantomAiModelLane,
  ctx: AdminPhantomAiChatContext,
  allowedProviders?: AdminPhantomAiProviderId[],
  options: { allowFallback?: boolean } = {},
) {
  const requestedPrimaryProviderId = adminPhantomAiProviderIdForLane(requestedLane);
  const allowed = Array.isArray(allowedProviders) && allowedProviders.length ? new Set(allowedProviders) : null;
  const attemptOrder = options.allowFallback === false ? [requestedPrimaryProviderId] : adminProviderAttemptOrder(requestedPrimaryProviderId);
  const filteredOrder = attemptOrder.filter((providerId) => !allowed || allowed.has(providerId));
  const order = filteredOrder.length ? filteredOrder : allowed ? [...allowed] : [requestedPrimaryProviderId];
  const primaryProviderId = order[0];
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

const INSTANT_ADMIN_CHAT_TASK_TYPES = new Set(["identity", "capability", "question", "chat"]);
const INSTANT_ADMIN_CHAT_BLOCKLIST = /\b(?:build|create|draft|write|make|fix|debug|code|implement|analy[sz]e|research|compare|summari[sz]e|plan|strategy|proposal|website|site|content|video|image|media|schedule|client|lead|transaction|accounting|bank|security|deploy|send|post|upload|delete|weather|forecast|current|latest|today|tomorrow|yesterday|price|stock|law|legal|medical|diagnosis|contract|tenant|isolation|phantomforce)\b/i;

function isInstantAdminChatSafe(normalized: { task_type: string; user_request: string }) {
  const text = normalized.user_request.trim();
  if (!INSTANT_ADMIN_CHAT_TASK_TYPES.has(normalized.task_type)) return false;
  if (!text || text.length > 180 || text.split(/\s+/).filter(Boolean).length > 22) return false;
  return !INSTANT_ADMIN_CHAT_BLOCKLIST.test(text);
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
      provider_manager: getPublicAdminProviderManagerStatus(),
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

/* ============================================================================
   PHANTOMPLAY
   Tenant-scoped game catalog, player progress, developer submissions, and
   platform moderation. Games run in a browser sandbox; these routes never
   proxy game traffic or expose internal infrastructure. */

async function phantomPlayAccess(session: AccessSession) {
  if (session.canManageAccess || session.isSuperAdmin) {
    return { entitled: true, dailyMinuteLimit: 1_000_000, submissionLimit: 100_000, reason: "platform_admin" };
  }
  if (session.orgId) {
    try {
      const decision = await orgHasFeature(session.orgId, "phantomPlay");
      return {
        entitled: decision.allowed,
        dailyMinuteLimit: decision.entitlements.limits.phantomPlayMinutesPerDay,
        submissionLimit: decision.entitlements.limits.gameSubmissions,
        reason: decision.reason,
      };
    } catch {
      return { entitled: false, dailyMinuteLimit: 0, submissionLimit: 0, reason: "entitlements_unavailable" };
    }
  }
  return {
    entitled: session.subscriptionActive !== false,
    dailyMinuteLimit: session.subscriptionActive === false ? 0 : 60,
    submissionLimit: 0,
    reason: session.subscriptionActive === false ? "subscription_inactive" : "legacy_session",
  };
}

app.get("/api/phantomplay", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const access = await phantomPlayAccess(session);
  return {
    ok: true,
    session,
    ...(await getPhantomPlaySnapshot(session, { tenantId: query.tenant_id, entitled: access.entitled, dailyMinuteLimit: access.dailyMinuteLimit, canSubmitGames: access.submissionLimit > 0 })),
    subscription: access,
    storage: session.canManageAccess ? await getPhantomPlayStoreStatus() : undefined,
  };
});

app.patch("/api/phantomplay/profile", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await phantomPlayAccess(session);
  if (!access.entitled) return reply.code(403).send({ ok: false, error: "PhantomPlay is not available for this plan.", reason: access.reason });
  return { ok: true, session, ...(await updatePhantomPlayProfile(session, (request.body ?? {}) as Record<string, unknown>)) };
});

app.post("/api/phantomplay/plays", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await phantomPlayAccess(session);
  try {
    return { ok: true, session, ...(await startPhantomPlaySession(session, (request.body ?? {}) as Record<string, unknown>, { entitled: access.entitled, dailyMinuteLimit: access.dailyMinuteLimit })) };
  } catch (error) {
    return reply.code(403).send({ ok: false, error: error instanceof Error ? error.message : "Game launch was blocked." });
  }
});

app.patch("/api/phantomplay/plays/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  const body = (request.body ?? {}) as Record<string, unknown>;
  const play = params.id ? await updatePhantomPlaySession(session, params.id.slice(0, 180), body) : null;
  if (play && body.score !== undefined && session.userId) {
    // Best-effort: keep the global leaderboard's denormalized score cache in
    // sync. Never fails the play-session response if this falls behind.
    recomputeGlobalScoreForUser(session.userId).catch(() => undefined);
  }
  return play ? { ok: true, session, play } : reply.code(404).send({ ok: false, error: "Play session was not found." });
});

app.post("/api/phantomplay/rooms", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await phantomPlayAccess(session);
  try {
    return { ok: true, session, ...(await createPhantomPlayRoom(session, (request.body ?? {}) as Record<string, unknown>, { entitled: access.entitled })) };
  } catch (error) {
    return reply.code(403).send({ ok: false, error: error instanceof Error ? error.message : "Private room creation was blocked." });
  }
});

app.get("/api/phantomplay/rooms/:code", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { code?: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const room = await getPhantomPlayRoom(session, { code: params.code, tenantId: query.tenant_id });
  return room ? { ok: true, session, room } : reply.code(404).send({ ok: false, error: "Private room was not found." });
});

app.post("/api/phantomplay/rooms/:code/join", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await phantomPlayAccess(session);
  const params = request.params as { code?: string };
  try {
    const result = await joinPhantomPlayRoom(session, { ...((request.body ?? {}) as Record<string, unknown>), code: params.code }, { entitled: access.entitled });
    return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Private room was not found." });
  } catch (error) {
    return reply.code(403).send({ ok: false, error: error instanceof Error ? error.message : "Private room join was blocked." });
  }
});

app.post("/api/phantomplay/rooms/:code/leave", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { code?: string };
  const result = await leavePhantomPlayRoom(session, { ...((request.body ?? {}) as Record<string, unknown>), code: params.code });
  return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Private room was not found." });
});

app.post("/api/phantomplay/rooms/:code/match", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { code?: string };
  try {
    const result = await updatePhantomPlayRoomMatch(session, { ...((request.body ?? {}) as Record<string, unknown>), code: params.code });
    return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Private room was not found." });
  } catch (error) {
    return reply.code(403).send({ ok: false, error: error instanceof Error ? error.message : "Match relay was blocked." });
  }
});

app.post("/api/phantomplay/submissions", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await phantomPlayAccess(session);
  const body = (request.body ?? {}) as Record<string, unknown>;
  const snapshot = await getPhantomPlaySnapshot(session, { tenantId: body.tenantId, entitled: access.entitled, dailyMinuteLimit: access.dailyMinuteLimit, canSubmitGames: access.submissionLimit > 0 });
  if (!access.entitled || !snapshot.access.canSubmitGames || access.submissionLimit < 1) return reply.code(403).send({ ok: false, error: "Game submissions are not enabled for this account or plan." });
  if (snapshot.submissions.length >= access.submissionLimit && !session.canManageAccess) return reply.code(403).send({ ok: false, error: "This plan's game submission limit has been reached." });
  try {
    return { ok: true, session, ...(await createPhantomPlaySubmission(session, body)) };
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Game submission could not be saved." });
  }
});

app.patch("/api/phantomplay/submissions/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await phantomPlayAccess(session);
  if (!access.entitled || access.submissionLimit < 1) return reply.code(403).send({ ok: false, error: "Game submissions are not enabled for this account or plan." });
  const params = request.params as { id?: string };
  try {
    const result = params.id ? await updatePhantomPlaySubmission(session, params.id.slice(0, 180), (request.body ?? {}) as Record<string, unknown>) : null;
    return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Game submission was not found." });
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Game update could not be saved." });
  }
});

app.post("/api/phantomplay/submissions/:id/moderate", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    const submission = params.id ? await moderatePhantomPlaySubmission(session, params.id.slice(0, 180), (request.body ?? {}) as Record<string, unknown>) : null;
    return submission ? { ok: true, session, submission } : reply.code(404).send({ ok: false, error: "Game submission was not found." });
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Moderation decision could not be saved." });
  }
});

app.get("/api/phantomstore", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return {
    ok: true,
    session,
    ...(await getPhantomStoreSnapshot(session, { tenantId: query.tenant_id })),
    storage: session.canManageAccess ? await getPhantomStoreStatus() : undefined,
  };
});

app.post("/api/phantomstore/tools", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  try {
    return { ok: true, session, ...(await submitPhantomStoreTool(session, (request.body ?? {}) as Record<string, unknown>)) };
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Tool submission could not be saved." });
  }
});

app.patch("/api/phantomstore/tools/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    const result = params.id ? await updatePhantomStoreTool(session, params.id.slice(0, 180), (request.body ?? {}) as Record<string, unknown>) : null;
    return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Tool was not found." });
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Tool update could not be saved." });
  }
});

app.post("/api/phantomstore/tools/:id/moderate", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    const tool = params.id ? await moderatePhantomStoreTool(session, params.id.slice(0, 180), (request.body ?? {}) as Record<string, unknown>) : null;
    return tool ? { ok: true, session, tool } : reply.code(404).send({ ok: false, error: "Tool was not found." });
  } catch (error) {
    return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Moderation decision could not be saved." });
  }
});

app.post("/api/phantomstore/tools/:id/install", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  const result = params.id ? await recordPhantomStoreInstallClick(session, params.id.slice(0, 180)) : null;
  return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Tool was not found." });
});

app.post("/api/phantomstore/products/:id/buy", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  const result = params.id ? await recordPhantomStoreProductBuyClick(session, params.id.slice(0, 180)) : null;
  return result ? { ok: true, session, ...result } : reply.code(404).send({ ok: false, error: "Product was not found or is not available yet." });
});

/* ---- PhantomPlay V2: platform layer (social, community, workspace, dev hub) ----
   Additive routes over ./phantom-ai/phantomplay-v2.ts. V1 routes above are
   untouched. PHANTOMFORCE_PHANTOMPLAY_V2_ENABLED=false turns all of this off
   (including V2 game registration) and V1 behaves exactly as before. */

if (phantomPlayV2Enabled()) registerPhantomPlayV2Games();
registerPhantomPlayFlagshipGames();

function phantomPlayV2Gate(reply: FastifyReply) {
  if (phantomPlayV2Enabled()) return true;
  reply.code(404).send({ ok: false, error: "phantomplay_v2_disabled" });
  return false;
}

function phantomPlayV2Error(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "PhantomPlay request could not be completed." });
}

app.get("/api/phantomplay/v2", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return {
    ok: true,
    session,
    ...(await getPhantomPlayV2Snapshot(session, { tenantId: query.tenant_id })),
    storage: session.canManageAccess ? await getPhantomPlayV2StoreStatus() : undefined,
  };
});

app.post("/api/phantomplay/v2/presence", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  try { return { ok: true, ...(await heartbeatPhantomPlayPresence(session, (request.body ?? {}) as Record<string, unknown>)) }; }
  catch (error) { return phantomPlayV2Error(reply, error); }
});

app.post("/api/phantomplay/v2/friends", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  try { await mutatePhantomPlayFriend(session, (request.body ?? {}) as Record<string, unknown>); return { ok: true }; }
  catch (error) { return phantomPlayV2Error(reply, error); }
});

app.get("/api/phantomplay/v2/games/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const params = request.params as { id?: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const page = params.id ? await getPhantomPlayGamePage(session, params.id.slice(0, 180), { tenantId: query.tenant_id }) : null;
  return page ? { ok: true, ...page } : reply.code(404).send({ ok: false, error: "That game is not in the catalog." });
});

app.post("/api/phantomplay/v2/games/:id/review", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const params = request.params as { id?: string };
  try { return { ok: true, ...(await upsertPhantomPlayReview(session, String(params.id || "").slice(0, 180), (request.body ?? {}) as Record<string, unknown>)) }; }
  catch (error) { return phantomPlayV2Error(reply, error); }
});

app.post("/api/phantomplay/v2/games/:id/wishlist", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const params = request.params as { id?: string };
  try { return { ok: true, ...(await setPhantomPlayWishlist(session, String(params.id || "").slice(0, 180), (request.body ?? {}) as Record<string, unknown>)) }; }
  catch (error) { return phantomPlayV2Error(reply, error); }
});

app.post("/api/phantomplay/v2/follows", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  try { return { ok: true, ...(await setPhantomPlayFollow(session, (request.body ?? {}) as Record<string, unknown>)) }; }
  catch (error) { return phantomPlayV2Error(reply, error); }
});

app.get("/api/phantomplay/v2/discovery", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return { ok: true, ...(await getPhantomPlayDiscovery(session, { tenantId: query.tenant_id })) };
});

app.get("/api/phantomplay/v2/leaderboard/:gameId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const params = request.params as { gameId?: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return { ok: true, ...(await getPhantomPlayLeaderboard(session, String(params.gameId || "").slice(0, 180), { tenantId: query.tenant_id })) };
});

app.get("/api/phantomplay/v2/resume/:gameId", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const params = request.params as { gameId?: string };
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return { ok: true, ...(await getPhantomPlayResumeState(session, String(params.gameId || "").slice(0, 180), { tenantId: query.tenant_id })) };
});

app.get("/api/phantomplay/v2/developer/analytics", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return { ok: true, ...(await getPhantomPlayDeveloperAnalytics(session, { tenantId: query.tenant_id })) };
});

app.get("/api/phantomplay/v2/workspace-policy", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  return { ok: true, ...(await getPhantomPlayWorkspacePolicy(session, { tenantId: query.tenant_id })) };
});

app.patch("/api/phantomplay/v2/workspace-policy", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  const body = (request.body ?? {}) as Record<string, unknown>;
  // Workspace policy is an org-owner/admin control, mirroring how V1 gates
  // submissions: platform admins always may; org members need an admin role.
  const isWorkspaceAdmin = session.canManageAccess || session.orgRole === "owner" || session.orgRole === "admin";
  if (!isWorkspaceAdmin) return reply.code(403).send({ ok: false, error: "Workspace policy requires an admin or owner role." });
  try { return { ok: true, ...(await updatePhantomPlayWorkspacePolicy(session, body)) }; }
  catch (error) { return phantomPlayV2Error(reply, error); }
});

/* ---- PhantomPlay global leaderboard (docs/superpowers/specs/2026-07-15-
   phantomplay-global-leaderboard-design.md). The only cross-tenant-visible
   surface in the app: getPhantomPlayGlobalLeaderboard strictly returns
   { rank, username, globalScore } and nothing else -- see that module's
   header comment before changing what it returns. Handles require a
   database-auth account (session.userId); legacy demo/session accounts get a
   clear 400 rather than a silent no-op. */
app.get("/api/phantomplay/handle", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  return { ok: true, ...(await getPhantomPlayHandle(session)) };
});

app.post("/api/phantomplay/handle", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  try {
    return { ok: true, ...(await claimPhantomPlayHandle(session, (request.body ?? {}) as Record<string, unknown>)) };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 400;
    return reply.code(statusCode).send({ ok: false, error: error instanceof Error ? error.message : "That handle could not be claimed." });
  }
});

app.get("/api/phantomplay/leaderboard/global", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  if (!phantomPlayV2Gate(reply)) return reply;
  return { ok: true, ...(await getPhantomPlayGlobalLeaderboard(session)) };
});

/* ---- Termina Mission Bridge (vertical slice) ----
   docs/superpowers/specs/2026-07-15-termina-mission-bridge-design.md.
   Owner-facing only (mirrors the CLI/Termina view in missioncontrol.js,
   already admin-gated client-side) -- this executes real commands via
   Termina's PTY worker sessions, so every route here requires a platform
   admin session, not just any signed-in session. */
function terminaError(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Termina request failed." });
}

app.get("/phantom-ai/termina/health", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  return { ok: true, ...(await terminaHealth()) };
});

app.post("/phantom-ai/missions/decompose", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const body = (request.body ?? {}) as { objective?: unknown };
  try {
    const plan = await decomposeMissionObjective(String(body.objective ?? ""));
    return { ok: true, ...plan };
  } catch (error) { return terminaError(reply, error); }
});

app.post("/phantom-ai/missions", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const body = (request.body ?? {}) as { objective?: unknown; missionName?: unknown; roles?: unknown };
  const objective = String(body.objective ?? "").trim();
  const roles = Array.isArray(body.roles) ? body.roles : [];
  if (!objective || !roles.length) return reply.code(400).send({ ok: false, error: "An objective and decomposed roles are required -- call decompose first." });
  // This only records a pending approval; it does not start any workers or
  // execute anything yet. See POST .../approvals/:id/confirm.
  const approval = createMissionApproval({
    requestedByLabel: session.label,
    missionName: String(body.missionName ?? "Untitled mission").trim() || "Untitled mission",
    objective,
    roles: roles as never,
  });
  return { ok: true, ...approval };
});

app.post("/phantom-ai/missions/approvals/:id/confirm", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    const mission = params.id ? await confirmMissionStart(params.id) : null;
    return mission ? { ok: true, mission } : reply.code(404).send({ ok: false, error: "Mission approval was not found." });
  } catch (error) { return terminaError(reply, error); }
});

app.get("/phantom-ai/missions/:id", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    return { ok: true, ...(await getMission(String(params.id))) };
  } catch (error) { return terminaError(reply, error); }
});

app.post("/phantom-ai/missions/:id/workers/:workerId/:action", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string; workerId?: string; action?: string };
  if (params.action !== "stop" && params.action !== "retry") return reply.code(400).send({ ok: false, error: "Action must be stop or retry." });
  try {
    const worker = await missionWorkerAction(String(params.id), String(params.workerId), params.action);
    return { ok: true, worker };
  } catch (error) { return terminaError(reply, error); }
});

app.post("/phantom-ai/missions/:id/synthesize", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    return { ok: true, ...(await synthesizeMission(String(params.id))) };
  } catch (error) { return terminaError(reply, error); }
});

app.get("/phantom-ai/missions/:id/report", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const params = request.params as { id?: string };
  try {
    return { ok: true, ...(await getMissionReport(String(params.id))) };
  } catch (error) { return terminaError(reply, error); }
});

/* ============================================================================
   COMPETITOR INTELLIGENCE
   Tenant-scoped analysis of lawfully available public signals. These routes
   store evidence and prepare original response plans; they never scrape,
   contact, publish, impersonate, or take an external competitive action. */

async function competitorIntelligenceAccess(session: AccessSession) {
  if (session.canManageAccess || session.isSuperAdmin) {
    return { entitled: true, aggressiveEntitled: true, competitorLimit: 100_000, signalLimit: 1_000_000, reason: "platform_admin" };
  }
  if (session.orgId) {
    try {
      const [base, aggressive] = await Promise.all([
        orgHasFeature(session.orgId, "competitorIntelligence"),
        orgHasFeature(session.orgId, "aggressiveIntelligence"),
      ]);
      return {
        entitled: base.allowed,
        aggressiveEntitled: aggressive.allowed,
        competitorLimit: base.entitlements.limits.competitorProfiles,
        signalLimit: base.entitlements.limits.competitorSignals,
        reason: base.reason,
      };
    } catch {
      return { entitled: false, aggressiveEntitled: false, competitorLimit: 0, signalLimit: 0, reason: "entitlements_unavailable" };
    }
  }
  return {
    entitled: session.subscriptionActive !== false,
    aggressiveEntitled: false,
    competitorLimit: session.subscriptionActive === false ? 0 : 3,
    signalLimit: session.subscriptionActive === false ? 0 : 100,
    reason: session.subscriptionActive === false ? "subscription_inactive" : "legacy_session",
  };
}

function intelligenceError(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Competitor intelligence request could not be completed." });
}

app.get("/api/competitor-intelligence", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  const access = await competitorIntelligenceAccess(session);
  return {
    ok: true,
    session,
    ...(await getCompetitorIntelligenceSnapshot(session, { tenantId: query.tenant_id, ...access })),
    subscription: access,
    storage: session.canManageAccess ? await getCompetitorIntelligenceStoreStatus() : undefined,
  };
});

app.patch("/api/competitor-intelligence/mode", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const access = await competitorIntelligenceAccess(session);
  if (!access.entitled) return reply.code(403).send({ ok: false, error: "Competitor Intelligence is not available for this plan.", reason: access.reason });
  try { return { ok: true, settings: await updateAggressiveMode(session, (request.body ?? {}) as Record<string, unknown>, access) }; }
  catch (error) { return intelligenceError(reply, error); }
});

app.post("/api/competitor-intelligence/scout", async (request, reply) => {
  const session = requireAccessSession(request, reply); if (!session) return reply;
  const access = await competitorIntelligenceAccess(session); if (!access.entitled) return reply.code(403).send({ ok: false, error: "Competitor Intelligence is not available for this plan." });
  try { return { ok: true, scout: await updateMarketScoutContext(session, (request.body ?? {}) as Record<string, unknown>) }; } catch (error) { return intelligenceError(reply, error); }
});

app.post("/api/competitor-intelligence/competitors", async (request, reply) => {
  const session = requireAccessSession(request, reply); if (!session) return reply;
  const access = await competitorIntelligenceAccess(session); if (!access.entitled) return reply.code(403).send({ ok: false, error: "Competitor Intelligence is not available for this plan." });
  try { return { ok: true, competitor: await createCompetitor(session, (request.body ?? {}) as Record<string, unknown>, access.competitorLimit) }; } catch (error) { return intelligenceError(reply, error); }
});

app.post("/api/competitor-intelligence/signals", async (request, reply) => {
  const session = requireAccessSession(request, reply); if (!session) return reply;
  const access = await competitorIntelligenceAccess(session); if (!access.entitled) return reply.code(403).send({ ok: false, error: "Competitor Intelligence is not available for this plan." });
  try { return { ok: true, signal: await createSignal(session, (request.body ?? {}) as Record<string, unknown>, access.signalLimit) }; } catch (error) { return intelligenceError(reply, error); }
});

app.post("/api/competitor-intelligence/fuse", async (request, reply) => {
  const session = requireAccessSession(request, reply); if (!session) return reply;
  const access = await competitorIntelligenceAccess(session); if (!access.entitled) return reply.code(403).send({ ok: false, error: "Competitor Intelligence is not available for this plan." });
  try { return { ok: true, inferences: await fuseCompetitorSignals(session, (request.body ?? {}) as Record<string, unknown>) }; } catch (error) { return intelligenceError(reply, error); }
});

const intelligenceCreateRoutes: Array<[string, (session: AccessSession, body: Record<string, unknown>) => Promise<unknown>]> = [
  ["/api/competitor-intelligence/audience-themes", createAudienceTheme],
  ["/api/competitor-intelligence/creative-analyses", createCreativeAnalysis],
  ["/api/competitor-intelligence/interceptions", createInterceptionPackage],
  ["/api/competitor-intelligence/opportunities", createResearchOpportunity],
  ["/api/competitor-intelligence/mystery-evidence", createMysteryEvidence],
  ["/api/competitor-intelligence/policy-check", auditCompetitorIntelligenceRequest],
];
for (const [route, handler] of intelligenceCreateRoutes) {
  app.post(route, async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const access = await competitorIntelligenceAccess(session); if (!access.entitled) return reply.code(403).send({ ok: false, error: "Competitor Intelligence is not available for this plan." });
    try { return { ok: true, result: await handler(session, (request.body ?? {}) as Record<string, unknown>) }; } catch (error) { return intelligenceError(reply, error); }
  });
}

/* ============================================================================
   ORGANIZATION PULSE + BRAIN GRAPH
   One tenant-scoped aggregation over real stores: live attention data for the
   dashboard, graph, and chat context. */

async function pulseAccessFor(session: AccessSession, requestedTenant: unknown) {
  const ciAccess = await competitorIntelligenceAccess(session);
  const dbSession = asDatabaseSession(session);
  const canManage = Boolean(session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin");
  const own = session.orgId || session.clientId || session.id;
  const requested = typeof requestedTenant === "string" && requestedTenant.trim() ? requestedTenant.trim().slice(0, 120) : "";
  return {
    tenantId: canManage && requested ? requested : own,
    orgId: dbSession?.orgId && process.env.DATABASE_URL ? dbSession.orgId : null,
    competitorEntitled: ciAccess.entitled,
    canManage,
  };
}

app.get("/api/organization/pulse", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  try {
    return { ok: true, pulse: await getOrganizationPulse(session, await pulseAccessFor(session, query.tenant_id)) };
  } catch (error) {
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : "Pulse could not be assembled." });
  }
});

app.get("/api/organization/graph", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  try {
    return { ok: true, graph: await getOrganizationGraph(session, await pulseAccessFor(session, query.tenant_id)) };
  } catch (error) {
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : "Graph could not be assembled." });
  }
});

app.get("/api/organization/opportunities", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  try {
    return { ok: true, ...(await getOrganizationOpportunities(session, await pulseAccessFor(session, query.tenant_id))) };
  } catch (error) {
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : "Opportunities could not be assembled." });
  }
});

/* Brain Signal contract — see server/src/phantom-ai/signals.ts and
   docs/BRAIN_SIGNAL_CONTRACT.md. Normalizes organization-pulse opportunities
   + graph disconnections into one cross-department Signal[]; /contract is
   the single read other modules should consume instead of re-deriving their
   own priority logic. */
app.get("/api/brain/signals", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  try {
    return { ok: true, ...(await getSignals(session, await pulseAccessFor(session, query.tenant_id))) };
  } catch (error) {
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : "Signals could not be assembled." });
  }
});

app.get("/api/brain/contract", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const query = (request.query ?? {}) as { tenant_id?: unknown };
  try {
    return { ok: true, ...(await getBrainContract(session, await pulseAccessFor(session, query.tenant_id))) };
  } catch (error) {
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : "Brain contract could not be assembled." });
  }
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
  if (!requireManualBrainEditor(session, reply)) return reply;

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
  if (!requireManualBrainEditor(session, reply)) return reply;

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
  if (!requireManualBrainEditor(session, reply)) return reply;

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
   A run is a persisted record with real states (low-risk: queued → executing
   → verifying → completed; external: awaiting_approval → approved → … →
   succeeded/partially_succeeded, or rejected/expired), progress events,
   on-disk artifacts, receipts, and a Hermes ledger proof entry. Global
   list/start stay super-admin; a single run is visible to anyone with
   authority over its workspace so org owners can watch their own runs. */
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
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const run = getAgentRun((request.params as { id: string }).id);
  if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });
  /* tenant isolation: a run is visible to the platform super-admin or to
     members of the org it belongs to — never across orgs */
  const dbSession = asDatabaseSession(session);
  const isMember = dbSession ? canAccessOrg(dbSession, run.workspace) : false;
  if (!session.canManageAccess && !isMember) {
    return reply.code(403).send({ ok: false, error: "This session cannot view runs for that workspace." });
  }
  return { ok: true, run };
});

app.post("/phantom-ai/runs", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = AgentRunStartSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "bad_request", detail: parsed.error.flatten() });
  }
  /* Entitlement gate (database-auth orgs only): agent runs metered per day. */
  {
    const dbSession = asDatabaseSession(session);
    if (dbSession?.orgId && !dbSession.isSuperAdmin) {
      const usage = await consumeUsage(dbSession.orgId, "agent_runs", 1, { operation: parsed.data.operation });
      if (!usage.allowed) {
        return reply.code(403).send({
          ...upgradeRequiredBody(usage.reason, usage.entitlements),
          usage: { metric: "agent_runs", used: usage.used, limit: usage.limit, resetAt: usage.resetAt },
        });
      }
    }
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

/* ---- approval-gated external execution (same run engine, no second one) ----
   Approving requires authority over the run's workspace: the platform
   super-admin always can; org owners/admins can approve runs scoped to their
   own org unless the executor demands super_admin. */

function canDecideRun(session: AccessSession, run: NonNullable<ReturnType<typeof getAgentRun>>) {
  if (session.canManageAccess) return true;
  if (run.required_role === "super_admin") return false;
  const dbSession = asDatabaseSession(session);
  if (!dbSession) return false;
  return canManageOrg(dbSession, run.workspace);
}

app.post("/phantom-ai/runs/:id/approve", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const run = getAgentRun((request.params as { id: string }).id);
  if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });
  if (!canDecideRun(session, run)) {
    return reply.code(403).send({ ok: false, error: "This session cannot approve runs for that workspace." });
  }
  const result = await approveAgentRun(
    run.id,
    { id: session.id, email: session.email ?? session.label },
    { tenantId: `${run.workspace}-owner`, businessName: run.workspace },
  );
  if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });
  return { ok: true, run: result.run };
});

const RunRejectSchema = z.object({ reason: z.string().max(300).optional() });

app.post("/phantom-ai/runs/:id/reject", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const run = getAgentRun((request.params as { id: string }).id);
  if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });
  if (!canDecideRun(session, run)) {
    return reply.code(403).send({ ok: false, error: "This session cannot reject runs for that workspace." });
  }
  const parsed = RunRejectSchema.safeParse(request.body ?? {});
  const result = await rejectAgentRun(run.id, { id: session.id, email: session.email ?? session.label }, parsed.success ? parsed.data.reason : undefined);
  if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });
  return { ok: true, run: result.run };
});

/* Org-scoped run list — the approval queue for org owners/admins. Members
   can see their org's runs; only managers/super-admin can decide them. */
app.get("/orgs/:orgId/runs", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const state = (request.query as { state?: string }).state as NonNullable<Parameters<typeof listAgentRuns>[0]>["state"];
  return { ok: true, runs: listAgentRuns({ workspace: orgId, state, limit: 30 }) };
});

/* ---- website publishing pipeline (builds → approval → deploy → verify) ---- */

const SiteSnapshotSchema = z.object({
  siteId: z.string().max(120).optional(),
  title: z.string().min(2).max(160),
  sections: z.array(z.string().min(1).max(60)).min(1).max(12),
  design: z.object({
    brand: z.string().max(120).optional(),
    headline: z.string().max(200).optional(),
    subhead: z.string().max(300).optional(),
    offer: z.string().max(300).optional(),
    cta: z.string().max(80).optional(),
    theme: z.string().max(40).optional(),
    style: z.string().max(40).optional(),
  }).default({}),
  products: z.array(z.object({
    id: z.string().min(1).max(120).regex(/^[a-z0-9_-]+$/i),
    name: z.string().min(1).max(100),
    price: z.number().min(0).max(10_000_000),
    cadence: z.enum(["one_time", "monthly"]).default("one_time"),
    desc: z.string().max(500).default(""),
    visible: z.boolean().default(true),
  })).max(50).default([]),
  store: z.object({
    enabled: z.boolean().default(false),
    currency: z.string().min(3).max(3).default("USD"),
    checkoutMode: z.literal("test").default("test"),
    paymentsConnected: z.literal(false).default(false),
  }).default({ enabled: false, currency: "USD", checkoutMode: "test", paymentsConnected: false }),
});

app.get("/orgs/:orgId/sites", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  return { ok: true, sites: await listOrgSites(orgId) };
});

app.post("/orgs/:orgId/sites/builds", async (request, reply) => {
  const { orgId } = request.params as { orgId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = SiteSnapshotSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await createSiteBuild({
    orgId,
    actorUserId: dbSession.userId,
    actorEmail: dbSession.email,
    snapshot: parsed.data,
  });
  if (!result.ok) return reply.code(403).send(result);
  return {
    ok: true,
    site: { id: result.site.id, title: result.site.title },
    build: { id: result.build.id, version: result.build.version, status: result.build.status },
    validated: result.validated,
    buildLog: result.buildLog,
  };
});

app.get("/orgs/:orgId/sites/:siteId/builds/:buildId/preview", async (request, reply) => {
  const { orgId, siteId, buildId } = request.params as { orgId: string; siteId: string; buildId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const html = await getBuildHtml(orgId, siteId, buildId);
  if (!html) return reply.code(404).send({ ok: false, error: "build_not_found" });
  return reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").send(html);
});

const PublishRequestSchema = z.object({ buildId: z.string().min(1).max(120) });

app.post("/orgs/:orgId/sites/:siteId/publish-request", async (request, reply) => {
  const { orgId, siteId } = request.params as { orgId: string; siteId: string };
  const dbSession = requireOrgMember(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = PublishRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const feature = await orgHasFeature(orgId, "websitePublishing");
  if (!feature.allowed) {
    return reply.code(403).send(upgradeRequiredBody(feature.reason, feature.entitlements));
  }
  const result = await startAgentRun({
    operation: "publish_site",
    workspace: orgId,
    sessionId: dbSession.id,
    request: `Publish site ${siteId} (build ${parsed.data.buildId})`,
    tenantId: `${orgId}-owner`,
    businessName: orgId,
    requestedBy: dbSession.email,
    inputs: { siteId, buildId: parsed.data.buildId },
  });
  if (!("id" in result)) return reply.code(400).send({ ok: false, ...result });
  return { ok: true, run: result, note: "Awaiting approval — nothing is live until an org owner/admin approves this run." };
});

app.post("/orgs/:orgId/sites/:siteId/rollback", async (request, reply) => {
  const { orgId, siteId } = request.params as { orgId: string; siteId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await rollbackSite({ orgId, siteId, actorEmail: dbSession.email });
  if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });
  return { ok: true, deployment: { id: result.deployment.id, receipt: result.receipt } };
});

const DomainAddSchema = z.object({ domain: z.string().min(4).max(253) });

app.post("/orgs/:orgId/sites/:siteId/domains", async (request, reply) => {
  const { orgId, siteId } = request.params as { orgId: string; siteId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const parsed = DomainAddSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const result = await addSiteDomain({ orgId, siteId, domain: parsed.data.domain, actorEmail: dbSession.email });
  if (!result.ok) return reply.code(400).send(result);
  return {
    ok: true,
    domain: {
      id: result.domain.id,
      domain: result.domain.domain,
      state: result.domain.state,
      verificationToken: result.domain.verificationToken,
      instructions: `Create a TXT record at _phantomforce-verify.${result.domain.domain} with value ${result.domain.verificationToken}, then call the verify endpoint. PhantomForce never changes your DNS.`,
    },
  };
});

app.post("/orgs/:orgId/sites/:siteId/domains/:domainId/verify", async (request, reply) => {
  const { orgId, domainId } = request.params as { orgId: string; siteId: string; domainId: string };
  const dbSession = requireOrgManager(request, reply, orgId);
  if (!dbSession) return reply;
  const result = await verifySiteDomain({ orgId, domainId });
  if (!result.ok) return reply.code(404).send({ ok: false, error: result.error });
  return { ok: true, domain: { id: result.domain.id, domain: result.domain.domain, state: result.domain.state, sslState: result.domain.sslState }, check: result.check };
});

/* Published sites are public by definition — served read-only from the
   promoted build on disk, with the deployment receipt as provenance. */
app.get("/public/sites/:siteId", async (request, reply) => {
  const { siteId } = request.params as { siteId: string };
  const published = await getPublishedHtml(siteId).catch(() => null);
  if (!published) return reply.code(404).send({ ok: false, error: "site_not_published" });
  return reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").send(published.html);
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

const FinanceExpenseTextSchema = z.object({
  text: z.string().trim().min(1).max(400),
});

app.post("/phantom-ai/ops/finance/parse-expense-text", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;

  const parsed = FinanceExpenseTextSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const result = parseExpenseText(parsed.data.text);
  if (!result.ok) return reply.code(422).send({ ok: false, error: result.error });

  return { ok: true, session, read_only: true, draft: result.draft };
});

const FinanceReceiptSchema = z.object({
  image: z.string().trim().min(1).max(20_000_000),
  filename: z.string().trim().max(160).optional(),
});

app.post("/phantom-ai/ops/finance/parse-receipt", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;

  const parsed = FinanceReceiptSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const storageProvider = getReceiptAssetStorageProvider();
  const stored = await storageProvider.putAsset({
    ownerScope: session.id,
    dataUrl: parsed.data.image,
    originalName: parsed.data.filename,
  });
  const assetId = stored.ok ? stored.asset.id : null;

  const aiResult = await parseReceiptImage(parsed.data.image);

  return {
    ok: true,
    session,
    read_only: true,
    assetId,
    aiAvailable: aiResult.available,
    draft: aiResult.available ? aiResult.draft : null,
    reason: aiResult.available ? undefined : aiResult.reason,
  };
});

app.get("/phantom-ai/ops/finance/receipt/:assetId", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;

  const { assetId } = request.params as { assetId: string };
  const storageProvider = getReceiptAssetStorageProvider();
  const result = await storageProvider.getAssetFile(assetId, session.id);
  if (!result.ok) return reply.code(404).send({ ok: false, error: result.error });

  return { ok: true, session, image: result.dataUrl, asset: result.asset };
});

app.get("/phantom-ai/ops/social-analytics/status", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  return {
    ok: true,
    session,
    read_only: true,
    social_analytics: getSocialAnalyticsConnectorStatus(),
  };
});

app.post("/phantom-ai/ops/social-oauth/start", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const body = (request.body ?? {}) as { platform?: unknown };
  if (!isSocialAnalyticsPlatform(body.platform)) {
    return reply.code(400).send({ ok: false, error: "Unsupported social platform." });
  }
  try {
    return {
      ok: true,
      session,
      external_send: false,
      approval_executed: false,
      oauth: createSocialOAuthStart(body.platform),
    };
  } catch (error) {
    return reply.code(409).send({
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 400) : "OAuth start is not configured.",
      connector: getSocialAnalyticsConnectorStatus().connectors.find((item) => item.id === body.platform),
    });
  }
});

app.get("/phantom-ai/ops/social-oauth/callback", async (request, reply) => {
  try {
    const result = await completeSocialOAuthCallback((request.query ?? {}) as Record<string, unknown>);
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>PhantomForce Social Connected</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #020807; color: #e9fff4; font-family: Inter, Arial, sans-serif; }
      main { max-width: 520px; border: 1px solid rgba(44, 255, 164, .35); border-radius: 28px; padding: 32px; background: rgba(3, 25, 17, .82); box-shadow: 0 24px 80px rgba(0, 255, 130, .12); }
      p { color: #a7c7b9; line-height: 1.55; }
      code { color: #45ffad; }
    </style>
  </head>
  <body>
    <main>
      <p style="letter-spacing:.24em;text-transform:uppercase;color:#45ffad;font-weight:800;">Connection saved</p>
      <h1>${String(result.platform).replace(/</g, "&lt;")} is connected to PhantomForce.</h1>
      <p>Return to the admin app and press <code>Sync analytics</code>. Tokens were stored locally and were not printed in this page.</p>
      <script>setTimeout(() => { try { window.close(); } catch {} }, 1800);</script>
    </main>
  </body>
</html>`);
  } catch (error) {
    return reply.code(400).type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090202;color:#ffe8e8;font-family:Arial,sans-serif;">
  <main style="max-width:560px;border:1px solid rgba(255,80,110,.4);border-radius:24px;padding:28px;background:rgba(30,4,8,.85);">
    <p style="letter-spacing:.22em;text-transform:uppercase;color:#ff8095;font-weight:800;">Connection blocked</p>
    <h1>PhantomForce could not save this social connection.</h1>
    <p>${(error instanceof Error ? error.message : "OAuth callback failed.").replace(/</g, "&lt;").slice(0, 500)}</p>
  </main>
</body></html>`);
  }
});

app.post("/phantom-ai/ops/social-analytics/sync", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = SocialAnalyticsSyncSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  const status = getSocialAnalyticsConnectorStatus();
  const connector = status.connectors.find((item) => item.id === parsed.data.platform);
  if (!connector?.configured) {
    return reply.code(409).send({
      ok: false,
      error: `${connector?.name || "That channel"} is not connected. Add the official API connection in Settings first.`,
      connector,
    });
  }
  try {
    const analytics = await syncSocialAnalytics(parsed.data.platform);
    return { ok: true, session, read_only: true, analytics };
  } catch (error) {
    return reply.code(502).send({
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 400) : "The platform analytics sync failed.",
      connector,
    });
  }
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

  /* Entitlement gate (database-auth orgs only): chat is metered per org per
     day. Legacy providers (demo/owner-production/gateway) are untouched. */
  {
    const dbSession = asDatabaseSession(session);
    if (dbSession?.orgId && !dbSession.isSuperAdmin) {
      const usage = await consumeUsage(dbSession.orgId, "chat_requests", 1, { route: "/phantom-ai/chat" });
      if (!usage.allowed) {
        return reply.code(403).send({
          ...upgradeRequiredBody(usage.reason, usage.entitlements),
          usage: { metric: "chat_requests", used: usage.used, limit: usage.limit, resetAt: usage.resetAt },
        });
      }
    }
  }

  const body = (request.body ?? {}) as {
    provider?: unknown;
    allowed_providers?: unknown;
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
    requested_model?: unknown;
    route_tier?: unknown;
    max_provider_ms?: unknown;
    allow_provider_fallback?: unknown;
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
  const adminModelLane = parseAdminPhantomAiModelLane(body.admin_model ?? body.model_lane ?? body.provider);
  const adminProviderRoute = adminPhantomAiProviderRoute(adminModelLane);
  const adminModelLabel = adminPhantomAiModelLabel(adminModelLane);
  const adminExecutionMode = body.execution_mode === "auto" ? "auto" : "approval";
  const adminRouteTier = parseAdminPhantomAiRouteTier(body.route_tier);
  const requestedModelId = parseRequestedAdminModel(body.requested_model);
  const maxProviderMs = parseAdminMaxProviderMs(body.max_provider_ms);
  const allowProviderFallback = parseAllowProviderFallback(body.allow_provider_fallback, adminRouteTier);
  const allowedAdminProviders = parseAllowedAdminProviders(body.allowed_providers);
  /* Asset Cloud retrieval — structured and permission-aware. Matching
     assets from THIS org's library ride into context as one compact module
     (never whole folders); assets flagged aiReferenceAllowed:false or
     deprecated are filtered inside the search. Failures never break chat. */
  if (adminRouteTier !== "instant") {
    const dbSession = asDatabaseSession(session);
    if (dbSession?.orgId && process.env.DATABASE_URL) {
      try {
        const aiAssets = await searchAssetsForAi(dbSession.orgId, normalized.user_request);
        if (aiAssets.length) {
          normalized.module_data.push({
            module: "asset_library",
            summary: `${aiAssets.length} matching asset(s) in this business's Asset Cloud. Reference them by title/id; do not invent assets.`,
            items: aiAssets.slice(0, 5).map((asset) => ({
              title: String(asset.title).slice(0, 120),
              status: `${String(asset.kind)}${asset.brand ? " · brand" : ""}${asset.favorite ? " · favorite" : ""}`,
              detail: `id ${String(asset.id)} · ${String(asset.mimeType)}${asset.width ? ` · ${asset.width}x${asset.height}` : ""}${Array.isArray(asset.tags) && asset.tags.length ? ` · tags: ${(asset.tags as string[]).join(", ")}` : ""}`.slice(0, 220),
            })),
          });
        }
      } catch { /* retrieval is additive only */ }
    }
  }

  /* Workspace pulse — live org state (approvals waiting, failed runs,
     competitor coverage, asset inventory) so Phantom answers from what the
     business is ACTUALLY doing right now, not memory alone. Additive only. */
  try {
    const dbSession = asDatabaseSession(session);
    const ciAccess = await competitorIntelligenceAccess(session);
    const pulse = await getOrganizationPulse(session, {
      tenantId: normalized.tenant_id,
      orgId: dbSession?.orgId && process.env.DATABASE_URL ? dbSession.orgId : null,
      competitorEntitled: ciAccess.entitled,
      canManage: Boolean(session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin"),
    });
    const opportunityReport = await getOrganizationOpportunities(session, {
      tenantId: normalized.tenant_id,
      orgId: dbSession?.orgId && process.env.DATABASE_URL ? dbSession.orgId : null,
      competitorEntitled: ciAccess.entitled,
      canManage: Boolean(session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin"),
    }, pulse);
    normalized.module_data.push({
      module: "workspace_pulse",
      summary: buildWorkspaceAwarenessText(pulse).slice(0, 900),
      items: opportunityReport.opportunities.slice(0, 3).map((opportunity) => ({
        title: `Opportunity (${opportunity.impact}): ${opportunity.title}`.slice(0, 120),
        status: opportunity.action.label.slice(0, 60),
        detail: opportunity.why.slice(0, 200),
      })),
    });
  } catch { /* awareness is additive only */ }

  const chatMemoryKey = buildChatMemoryKey(session, normalized);
  const privacyFirstLocationReply = await buildPrivacyFirstLocationReply(normalized.user_request, session, chatMemoryKey);

  if (privacyFirstLocationReply) {
    return privacyFirstLocationReply;
  }

  if (session.canManageAccess && adminModelLane === "codex" && isExplicitAdminOperatorPrompt(normalized.user_request)) {
    const operatorResult = await runCodexOperatorChat({
      requestId: normalized.request_id,
      businessName: normalized.business_name,
      userMessage: normalized.user_request,
      compactContext: "Explicit admin operator command. Return a receipt for the local action only.",
      approvalRequired: false,
      cwd: process.cwd(),
    });
    const ledgerRecord: HermesLedgerRecord = {
      timestamp: new Date().toISOString(),
      tenant_id: normalized.tenant_id,
      business_name: normalized.business_name,
      actor_user_id: normalized.actor_user_id,
      actor_role: normalized.actor_role,
      request_id: normalized.request_id,
      task_type: normalized.task_type,
      sensitivity_level: normalized.sensitivity_level,
      provider_route: "router",
      model_id: "phantom-private-brain",
      context_chars: 0,
      estimated_tokens: 0,
      estimated_cost_usd: null,
      user_request_summary: redactSensitiveText(normalized.user_request).replace(/\s+/g, " ").slice(0, 240),
      result_summary: redactSensitiveText(
        operatorResult.tool_executed
          ? `Private Brain executed ${operatorResult.tool_name ?? "operator tool"} and returned a receipt.`
          : `Private Brain operator did not execute: ${operatorResult.error_message ?? operatorResult.status}`,
      ).slice(0, 360),
      approval_required: false,
      approval_status: "not_required",
      risks: [],
      next_action: operatorResult.tool_executed
        ? "Review the private operator receipt in Phantom AI."
        : "Review the private operator lane error and retry if appropriate.",
      agent_run_id: `phantom-ai-admin-codex-${normalized.request_id}`,
      parent_task_id: normalized.request_id,
    };
    await appendHermesLedgerRecord(ledgerRecord);

    return {
      ok: true,
      session,
      provider_choice: "phantom",
      admin_model_lane: "private_brain",
      admin_model_label: adminPhantomAiModelLabel("codex"),
      admin_model_requested_lane: "private_brain",
      admin_execution_mode: adminExecutionMode,
      model_id: "phantom-private-brain",
      message: {
        role: "assistant",
        content: operatorResult.output_text,
      },
      operator: {
        status: operatorResult.status,
        admin_only: operatorResult.admin_only,
        localhost_only: operatorResult.localhost_only,
        tool_requested: operatorResult.tool_requested,
        tool_executed: operatorResult.tool_executed,
        tool_name: operatorResult.tool_name,
        tool_result: operatorResult.tool_result,
      },
      private_brain: {
        status: operatorResult.status,
        model_id: "phantom-private-brain",
        admin_only: operatorResult.admin_only,
        localhost_only: operatorResult.localhost_only,
        approval_executed: operatorResult.approval_executed,
        external_action_executed: operatorResult.external_action_executed,
        queue_written: operatorResult.queue_written,
        ledger_written: true,
      },
      fallback: {
        used: false,
        all_failed: false,
        requested_provider: adminPhantomAiProviderLabel("codex_cli"),
        responding_provider: adminPhantomAiProviderLabel("codex_cli"),
        attempts: [{ provider_id: "codex_cli", status: operatorResult.status, error_message: operatorResult.error_message }],
      },
      hermes: {
        context_used: false,
        ledger_written: true,
        provider_route: "private_brain",
        recalled_memory_count: 0,
      },
      memory_scope: buildMemoryScopeProof(normalized),
      memory_context: {
        scope: normalized.memory_scope,
        recalled_memory_count: 0,
        compact_context_chars: 0,
        redaction: "not_used_for_explicit_operator_command",
      },
      ledger_record: redactHermesLedgerRecord(ledgerRecord),
      provider_request_body_created: operatorResult.request_body_prepared,
      live_provider_called: operatorResult.provider_called,
      network_call_performed: operatorResult.network_call_performed,
      approval_executed: false,
      queue_written: false,
      external_action_executed: false,
    };
  }

  if (session.canManageAccess && adminRouteTier === "instant" && isInstantAdminChatSafe(normalized)) {
    const instantChat = await runAdminPhantomAiChatWithFallback(adminModelLane, {
      requestId: normalized.request_id,
      businessName: normalized.business_name,
      taskType: normalized.task_type,
      userMessage: normalized.user_request,
      compactContext: "Fast casual chat. No business memory required unless the user explicitly asks for PhantomForce, a client, an organization, files, money, security, or current/live facts.",
      sensitivityLevel: normalized.sensitivity_level,
      approvalRequired: false,
      executionMode: adminExecutionMode,
      requestedModelId,
      routeTier: adminRouteTier,
      maxProviderMs,
    }, allowedAdminProviders, { allowFallback: false });
    const respondingProviderId = instantChat.providerId;
    const respondingLane = adminPhantomAiLaneForProviderId(respondingProviderId);
    const respondingLabel = adminPhantomAiProviderLabel(respondingProviderId);
    const respondingProviderRoute = adminPhantomAiProviderRoute(respondingLane);
    const modelResult = instantChat.result;
    const resultStatus = "status" in modelResult ? modelResult.status : "error";
    const resultOutput = "output_text" in modelResult ? String(modelResult.output_text || "") : "";
    const providerCalled = "provider_called" in modelResult ? Boolean(modelResult.provider_called) : false;
    const networkCallPerformed =
      "network_call_performed" in modelResult ? Boolean(modelResult.network_call_performed) : providerCalled;
    const requestBodyPrepared = "request_body_prepared" in modelResult ? Boolean(modelResult.request_body_prepared) : false;
    const allProvidersFailed = instantChat.allFailed;
    const instantLocalFallback = allProvidersFailed
      ? buildInstantChatFallbackReply(normalized.user_request, normalized.business_name)
      : null;

    return {
      ok: true,
      session,
      provider_choice: "phantom",
      admin_model_lane: publicAdminPhantomAiModelLane(respondingLane),
      admin_model_label: respondingLabel,
      admin_model_requested_lane: publicAdminPhantomAiModelLane(adminModelLane),
      admin_execution_mode: adminExecutionMode,
      model_id: instantLocalFallback?.model_id ?? ("model_id" in modelResult ? modelResult.model_id : respondingProviderId),
      message: {
        role: "assistant",
        content: instantLocalFallback?.output_text ?? resultOutput,
      },
      private_brain:
        respondingProviderId === "codex_cli" && "provider_id" in modelResult && modelResult.provider_id === "codex_cli"
          ? {
              status: modelResult.status,
              model_id: modelResult.model_id,
              seconds: modelResult.seconds,
              admin_only: modelResult.admin_only,
              localhost_only: modelResult.localhost_only,
              approval_executed: modelResult.approval_executed,
              external_action_executed: modelResult.external_action_executed,
              queue_written: modelResult.queue_written,
              ledger_written: modelResult.ledger_written,
            }
          : null,
      fallback: {
        used: Boolean(instantLocalFallback),
        all_failed: allProvidersFailed,
        requested_provider: adminPhantomAiProviderLabel(instantChat.primaryProviderId),
        responding_provider: respondingLabel,
        attempts: instantChat.attempts,
        local_instant_fallback_used: Boolean(instantLocalFallback),
      },
      instant_local_fallback: instantLocalFallback,
      hermes: {
        context_used: false,
        ledger_written: false,
        provider_route: instantLocalFallback ? "local" : respondingProviderRoute,
        route_tier: "instant",
        recalled_memory_count: 0,
      },
      brain: {
        context_used: false,
        suggested_intent: normalized.task_type,
        risk_level: "low",
        needs_approval: false,
        micro_prompt: "Fast casual chat; business memory intentionally skipped.",
        relevant_memory_count: 0,
        used_memory_ids: [],
        active_rules: [],
        reasons: ["instant_route"],
      },
      memory_scope: buildMemoryScopeProof(normalized),
      memory_context: {
        scope: normalized.memory_scope,
        recalled_memory_count: 0,
        compact_context_chars: 0,
        redaction: "not_used_for_instant_route",
      },
      provider_request_body_created: requestBodyPrepared,
      live_provider_called: providerCalled,
      network_call_performed: networkCallPerformed,
      approval_executed: false,
      queue_written: false,
      external_action_executed: false,
      route_tier: adminRouteTier,
      provider_timeout_ms: adminPhantomAiProviderTimeoutMs(respondingProviderId, {
        requestId: normalized.request_id,
        businessName: normalized.business_name,
        taskType: normalized.task_type,
        userMessage: normalized.user_request,
        compactContext: "",
        sensitivityLevel: normalized.sensitivity_level,
        approvalRequired: false,
        executionMode: adminExecutionMode,
        routeTier: adminRouteTier,
        maxProviderMs,
      }),
      result_status: instantLocalFallback?.status ?? resultStatus,
    };
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
      requestedModelId,
      routeTier: adminRouteTier,
      maxProviderMs,
    }, allowedAdminProviders, { allowFallback: allowProviderFallback });
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
    handlerState: isActionImplemented(handler) ? "registered" : "not-implemented",
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
