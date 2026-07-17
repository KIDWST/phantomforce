/* PhantomForce entitlement engine — provider-neutral, backend-enforced.
   Plans are internal development definitions (no pricing, no checkout, no
   payment pretending). The super-admin assigns plans manually until a real
   billing provider is integrated; the billing-provider adapter boundary in
   billing-provider.ts stays the only place a provider would plug in.

   Resolution order: plan definition -> DB Plan row -> OrgPlan.overrides
   (manual super-admin patches). Status ladder: trial -> active, with
   trial-expiry falling into a grace window and grace-expiry suspending the
   org (view-only). All checks are server-side; the frontend only displays. */

import { Prisma } from "@prisma/client";
import type { PlanStatus, PrismaClient } from "@prisma/client";

import { prisma } from "./prisma-runtime.js";

function requirePrisma(): PrismaClient {
  if (!prisma) throw new Error("Entitlements require DATABASE_URL (Prisma repository mode).");
  return prisma;
}

export type PlanFeatures = {
  chat: boolean;
  mediaLab: boolean;
  websites: boolean;
  websitePublishing: boolean;
  customDomains: boolean;
  vacationMode: boolean;
  phantomPlay: boolean;
  competitorIntelligence: boolean;
  aggressiveIntelligence: boolean;
  advancedWorkflows: boolean;
  assetPacks: boolean;
  agentRuns: boolean;
  modelTier: "standard" | "advanced";
};

export type PlanLimits = {
  seats: number;
  businesses: number;
  mediaCreditsPerMonth: number;
  chatRequestsPerDay: number;
  agentRunsPerDay: number;
  storageMb: number;
  sitesPerOrg: number;
  phantomPlayMinutesPerDay: number;
  gameSubmissions: number;
  competitorProfiles: number;
  competitorSignals: number;
};

export type PlanDefinition = {
  key: string;
  name: string;
  description: string;
  isInternal: boolean;
  trialDays: number;
  graceDays: number;
  features: PlanFeatures;
  limits: PlanLimits;
};

/* Internal development plans. Names are placeholders — final pricing and
   packaging are a business decision, not invented here.

   Customer-facing tiers are Free / Pro / Elite (the `name` field). The
   `key` values (starter/professional/elite) stay as-is on purpose — they're
   the stable DB identifier synced into the Plan table and referenced by
   OrgPlan.planKey, so renaming a key would orphan the old row and silently
   re-point any already-assigned org onto whatever PLAN_DEFINITIONS[0]
   happens to be. Renaming `name` is safe and picked up by every reader on
   the next sync/fetch. */
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    key: "free",
    name: "Free Preview",
    description: "Try the workspace with small limits before choosing a paid plan.",
    isInternal: false,
    trialDays: 0,
    graceDays: 0,
    features: {
      chat: true, mediaLab: true, websites: true, websitePublishing: false, customDomains: false,
      vacationMode: false, phantomPlay: true, competitorIntelligence: false, aggressiveIntelligence: false, advancedWorkflows: false, assetPacks: false, agentRuns: true, modelTier: "standard",
    },
    limits: {
      seats: 1, businesses: 1, mediaCreditsPerMonth: 5, chatRequestsPerDay: 20,
      agentRunsPerDay: 3, storageMb: 128, sitesPerOrg: 1, phantomPlayMinutesPerDay: 15, gameSubmissions: 0, competitorProfiles: 0, competitorSignals: 0,
    },
  },
  {
    key: "starter",
    name: "Free",
    description: "Entry plan for a single small business.",
    isInternal: false,
    trialDays: 14,
    graceDays: 7,
    features: {
      chat: true, mediaLab: true, websites: true, websitePublishing: false, customDomains: false,
      vacationMode: false, phantomPlay: true, competitorIntelligence: false, aggressiveIntelligence: false, advancedWorkflows: false, assetPacks: false, agentRuns: true, modelTier: "standard",
    },
    limits: {
      seats: 3, businesses: 1, mediaCreditsPerMonth: 50, chatRequestsPerDay: 100,
      agentRunsPerDay: 10, storageMb: 512, sitesPerOrg: 1, phantomPlayMinutesPerDay: 30, gameSubmissions: 0, competitorProfiles: 0, competitorSignals: 0,
    },
  },
  {
    key: "professional",
    name: "Pro",
    description: "Growing business: publishing, vacation coverage, more seats.",
    isInternal: false,
    trialDays: 14,
    graceDays: 7,
    features: {
      chat: true, mediaLab: true, websites: true, websitePublishing: true, customDomains: false,
      vacationMode: true, phantomPlay: true, competitorIntelligence: true, aggressiveIntelligence: false, advancedWorkflows: false, assetPacks: true, agentRuns: true, modelTier: "standard",
    },
    limits: {
      seats: 10, businesses: 2, mediaCreditsPerMonth: 250, chatRequestsPerDay: 500,
      agentRunsPerDay: 50, storageMb: 4096, sitesPerOrg: 5, phantomPlayMinutesPerDay: 90, gameSubmissions: 1, competitorProfiles: 5, competitorSignals: 500,
    },
  },
  {
    key: "elite",
    name: "Elite",
    description: "Multi-business operators: custom domains, advanced workflows, advanced models.",
    isInternal: false,
    trialDays: 14,
    graceDays: 14,
    features: {
      chat: true, mediaLab: true, websites: true, websitePublishing: true, customDomains: true,
      vacationMode: true, phantomPlay: true, competitorIntelligence: true, aggressiveIntelligence: true, advancedWorkflows: true, assetPacks: true, agentRuns: true, modelTier: "advanced",
    },
    limits: {
      seats: 25, businesses: 5, mediaCreditsPerMonth: 1000, chatRequestsPerDay: 2000,
      agentRunsPerDay: 200, storageMb: 20480, sitesPerOrg: 20, phantomPlayMinutesPerDay: 240, gameSubmissions: 5, competitorProfiles: 25, competitorSignals: 5000,
    },
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Custom limits negotiated per contract; manual overrides expected.",
    isInternal: false,
    trialDays: 30,
    graceDays: 30,
    features: {
      chat: true, mediaLab: true, websites: true, websitePublishing: true, customDomains: true,
      vacationMode: true, phantomPlay: true, competitorIntelligence: true, aggressiveIntelligence: true, advancedWorkflows: true, assetPacks: true, agentRuns: true, modelTier: "advanced",
    },
    limits: {
      seats: 100, businesses: 25, mediaCreditsPerMonth: 10000, chatRequestsPerDay: 10000,
      agentRunsPerDay: 1000, storageMb: 102400, sitesPerOrg: 100, phantomPlayMinutesPerDay: 1440, gameSubmissions: 50, competitorProfiles: 250, competitorSignals: 50000,
    },
  },
  {
    key: "internal",
    name: "Internal / Admin",
    description: "PhantomForce internal organizations. Not sellable.",
    isInternal: true,
    trialDays: 0,
    graceDays: 0,
    features: {
      chat: true, mediaLab: true, websites: true, websitePublishing: true, customDomains: true,
      vacationMode: true, phantomPlay: true, competitorIntelligence: true, aggressiveIntelligence: true, advancedWorkflows: true, assetPacks: true, agentRuns: true, modelTier: "advanced",
    },
    limits: {
      seats: 1000, businesses: 1000, mediaCreditsPerMonth: 1000000, chatRequestsPerDay: 1000000,
      agentRunsPerDay: 100000, storageMb: 1048576, sitesPerOrg: 1000, phantomPlayMinutesPerDay: 1000000, gameSubmissions: 100000, competitorProfiles: 100000, competitorSignals: 1000000,
    },
  },
];

const DEFAULT_PLAN_KEY = "starter";

export function planDefinition(key: string): PlanDefinition {
  return PLAN_DEFINITIONS.find((plan) => plan.key === key) ?? PLAN_DEFINITIONS[0];
}

/* Keep the Plan catalog rows in sync with the definitions at boot so the
   super-admin UI and assignments reference real rows. */
export async function syncPlanCatalog() {
  const db = requirePrisma();
  for (const plan of PLAN_DEFINITIONS) {
    await db.plan.upsert({
      where: { key: plan.key },
      create: {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        isInternal: plan.isInternal,
        features: plan.features as object,
        limits: plan.limits as object,
      },
      update: {
        name: plan.name,
        description: plan.description,
        isInternal: plan.isInternal,
        features: plan.features as object,
        limits: plan.limits as object,
      },
    });
  }
}

export type ResolvedEntitlements = {
  orgId: string;
  planKey: string;
  planName: string;
  status: PlanStatus;
  /* effective status after evaluating trial/grace expiry right now */
  effectiveStatus: PlanStatus;
  trialEndsAt: string | null;
  graceUntil: string | null;
  canWrite: boolean;
  upgradeRequired: boolean;
  features: PlanFeatures;
  limits: PlanLimits;
  overridesApplied: boolean;
  note: string | null;
};

function applyOverrides<T extends Record<string, unknown>>(base: T, patch: unknown): { value: T; applied: boolean } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { value: base, applied: false };
  const merged = { ...base } as Record<string, unknown>;
  let applied = false;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key in base && value !== undefined && value !== null) {
      merged[key] = value;
      applied = true;
    }
  }
  return { value: merged as T, applied };
}

export async function getOrgEntitlements(orgId: string): Promise<ResolvedEntitlements> {
  const db = requirePrisma();
  const [orgPlan, org] = await Promise.all([
    db.orgPlan.findUnique({ where: { orgId } }),
    db.org.findUnique({ where: { id: orgId }, select: { createdAt: true } }),
  ]);
  const planKey = orgPlan?.planKey ?? DEFAULT_PLAN_KEY;
  const definition = planDefinition(planKey);

  /* An org with no assignment runs the default plan's trial clock from the
     org's creation date — no fake "active" state. */
  const status: PlanStatus = orgPlan?.status ?? "trial";
  const trialEndsAt =
    orgPlan?.trialEndsAt ??
    (status === "trial" && org
      ? new Date(org.createdAt.getTime() + definition.trialDays * 86400000)
      : null);
  const graceUntil =
    orgPlan?.graceUntil ??
    (trialEndsAt ? new Date(trialEndsAt.getTime() + definition.graceDays * 86400000) : null);

  const now = Date.now();
  let effectiveStatus: PlanStatus = status;
  if (status === "trial" && trialEndsAt && trialEndsAt.getTime() < now) {
    effectiveStatus = graceUntil && graceUntil.getTime() > now ? "grace" : "suspended";
  } else if (status === "grace" && graceUntil && graceUntil.getTime() < now) {
    effectiveStatus = "suspended";
  }

  const overridesRaw = (orgPlan?.overrides ?? null) as { features?: unknown; limits?: unknown } | null;
  const features = applyOverrides(definition.features, overridesRaw?.features);
  const limits = applyOverrides(definition.limits, overridesRaw?.limits);
  const freeViewOnly = definition.key === "starter";

  return {
    orgId,
    planKey: definition.key,
    planName: definition.name,
    status,
    effectiveStatus,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    graceUntil: graceUntil ? graceUntil.toISOString() : null,
    canWrite: effectiveStatus !== "suspended" && !freeViewOnly,
    upgradeRequired: freeViewOnly || effectiveStatus === "suspended" || effectiveStatus === "grace",
    features: features.value,
    limits: limits.value,
    overridesApplied: features.applied || limits.applied,
    note: orgPlan?.note ?? null,
  };
}

export async function orgHasFeature(orgId: string, feature: keyof PlanFeatures): Promise<{
  allowed: boolean;
  reason: string;
  entitlements: ResolvedEntitlements;
}> {
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements.canWrite) {
    return { allowed: false, reason: `plan_${entitlements.effectiveStatus}`, entitlements };
  }
  const value = entitlements.features[feature];
  const allowed = typeof value === "boolean" ? value : Boolean(value);
  return { allowed, reason: allowed ? "entitled" : "feature_not_in_plan", entitlements };
}

/* ---------------- usage ledger + limit checks ---------------- */

export type UsageMetric = "chat_requests" | "media_credits" | "agent_runs" | "storage_mb";

const METRIC_CONFIG: Record<UsageMetric, { period: "day" | "month" | "absolute"; limitKey: keyof PlanLimits }> = {
  chat_requests: { period: "day", limitKey: "chatRequestsPerDay" },
  media_credits: { period: "month", limitKey: "mediaCreditsPerMonth" },
  agent_runs: { period: "day", limitKey: "agentRunsPerDay" },
  storage_mb: { period: "absolute", limitKey: "storageMb" },
};

function periodStart(period: "day" | "month" | "absolute"): Date | null {
  const now = new Date();
  if (period === "day") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return null;
}

function periodResetAt(period: "day" | "month" | "absolute"): string | null {
  const now = new Date();
  if (period === "day") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  if (period === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return null;
}

export async function getUsage(orgId: string, metric: UsageMetric) {
  const db = requirePrisma();
  const config = METRIC_CONFIG[metric];
  const since = periodStart(config.period);
  const aggregate = await db.usageEvent.aggregate({
    where: { orgId, metric, ...(since ? { at: { gte: since } } : {}) },
    _sum: { amount: true },
  });
  return { used: aggregate._sum.amount ?? 0, resetAt: periodResetAt(config.period) };
}

export async function checkUsageLimit(orgId: string, metric: UsageMetric, amount = 1) {
  const entitlements = await getOrgEntitlements(orgId);
  const config = METRIC_CONFIG[metric];
  const limit = entitlements.limits[config.limitKey];
  const { used, resetAt } = await getUsage(orgId, metric);
  const allowed = entitlements.canWrite && used + amount <= limit;
  return {
    allowed,
    used,
    limit,
    resetAt,
    reason: !entitlements.canWrite ? `plan_${entitlements.effectiveStatus}` : allowed ? "within_limit" : "limit_reached",
    entitlements,
  };
}

export async function recordUsage(orgId: string, metric: UsageMetric, amount = 1, meta?: Record<string, unknown>) {
  const db = requirePrisma();
  await db.usageEvent.create({ data: { orgId, metric, amount, meta: (meta ?? undefined) as object | undefined } });
}

/* Check-and-record in one call for request-path gates. */
export async function consumeUsage(orgId: string, metric: UsageMetric, amount = 1, meta?: Record<string, unknown>) {
  const check = await checkUsageLimit(orgId, metric, amount);
  if (check.allowed) {
    await recordUsage(orgId, metric, amount, meta);
  }
  return check;
}

export async function getUsageSummary(orgId: string) {
  const entitlements = await getOrgEntitlements(orgId);
  const db = requirePrisma();
  const metrics = await Promise.all(
    (Object.keys(METRIC_CONFIG) as UsageMetric[]).map(async (metric) => {
      const { used, resetAt } = await getUsage(orgId, metric);
      return { metric, used, limit: entitlements.limits[METRIC_CONFIG[metric].limitKey], resetAt };
    }),
  );
  const seatCount = await db.membership.count({ where: { orgId } });
  return {
    entitlements,
    metrics,
    seats: { used: seatCount, limit: entitlements.limits.seats },
  };
}

export async function checkSeatLimit(orgId: string) {
  const summary = await getUsageSummary(orgId);
  return {
    allowed: summary.entitlements.canWrite && summary.seats.used < summary.seats.limit,
    ...summary.seats,
  };
}

/* ---------------- manual plan administration (super-admin only; the caller
   enforces authorization) ---------------- */

export async function assignOrgPlan(input: {
  orgId: string;
  planKey: string;
  status?: PlanStatus;
  trialEndsAt?: string | null;
  graceUntil?: string | null;
  overrides?: { features?: Partial<PlanFeatures>; limits?: Partial<PlanLimits> } | null;
  note?: string | null;
  assignedByUserId?: string;
}) {
  const db = requirePrisma();
  const definition = PLAN_DEFINITIONS.find((plan) => plan.key === input.planKey);
  if (!definition) return { ok: false as const, error: "unknown_plan", available: PLAN_DEFINITIONS.map((p) => p.key) };
  const status = input.status ?? "active";
  const row = await db.orgPlan.upsert({
    where: { orgId: input.orgId },
    create: {
      orgId: input.orgId,
      planKey: input.planKey,
      status,
      trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : status === "trial" ? new Date(Date.now() + definition.trialDays * 86400000) : null,
      graceUntil: input.graceUntil ? new Date(input.graceUntil) : null,
      overrides: input.overrides ? (input.overrides as object) : undefined,
      note: input.note ?? null,
      assignedByUserId: input.assignedByUserId ?? null,
    },
    update: {
      planKey: input.planKey,
      status,
      trialEndsAt: input.trialEndsAt !== undefined ? (input.trialEndsAt ? new Date(input.trialEndsAt) : null) : undefined,
      graceUntil: input.graceUntil !== undefined ? (input.graceUntil ? new Date(input.graceUntil) : null) : undefined,
      /* null clears any manual overrides; undefined leaves them untouched */
      overrides:
        input.overrides === undefined ? undefined : input.overrides === null ? Prisma.DbNull : (input.overrides as object),
      note: input.note !== undefined ? input.note : undefined,
      assignedByUserId: input.assignedByUserId ?? null,
    },
  });
  return { ok: true as const, orgPlan: row };
}

export function listPlanDefinitions() {
  return PLAN_DEFINITIONS.map((plan) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    isInternal: plan.isInternal,
    trialDays: plan.trialDays,
    graceDays: plan.graceDays,
    features: plan.features,
    limits: plan.limits,
  }));
}

/* Standard refusal payload for feature/limit gates — a 403 body the frontend
   can render as an upgrade prompt. No checkout exists yet; the message says
   exactly that. */
export function upgradeRequiredBody(reason: string, entitlements: ResolvedEntitlements) {
  return {
    ok: false as const,
    error: "upgrade_required",
    reason,
    plan: {
      key: entitlements.planKey,
      name: entitlements.planName,
      status: entitlements.effectiveStatus,
      trialEndsAt: entitlements.trialEndsAt,
      graceUntil: entitlements.graceUntil,
    },
    upgrade: "Plans are assigned manually by the PhantomForce operator until billing is connected. Contact your administrator.",
  };
}
