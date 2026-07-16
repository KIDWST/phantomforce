import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { PlanStatus } from "@prisma/client";

import { PLAN_DEFINITIONS, type PlanDefinition, type ResolvedEntitlements } from "./entitlements.js";
import type { AccessSession } from "./session.js";

export const LOCAL_CUSTOMER_SESSION_PREFIX = "local:";

type MembershipRole = "owner" | "admin" | "member" | "client";

type LocalCustomerMembership = {
  orgId: string;
  orgName: string;
  role: MembershipRole;
};

type LocalCustomerUser = {
  id: string;
  email: string;
  name: string;
  businessName: string;
  passwordHash: string;
  activeOrgId: string;
  memberships: LocalCustomerMembership[];
  planKey?: string;
  planStatus?: PlanStatus;
  planUpdatedAt?: string;
  planNote?: string;
  createdAt: string;
  updatedAt: string;
};

type LocalCustomerSessionRecord = {
  id: string;
  userId: string;
  activeOrgId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

type LocalCustomerResetRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

type LocalCustomerStore = {
  version: 1;
  users: LocalCustomerUser[];
  sessions: LocalCustomerSessionRecord[];
  passwordResets: LocalCustomerResetRecord[];
};

type LocalCustomerRegisterInput = {
  email: string;
  password: string;
  name?: string;
  businessName?: string;
};

const pbkdf2Async = promisify(pbkdf2);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultStorePath = resolve(moduleDir, "..", "..", ".local", "customer-auth.json");
const storePath = resolve(process.env.PHANTOMFORCE_LOCAL_CUSTOMER_STORE ?? defaultStorePath);
const localCustomerAuthFlag = (process.env.PHANTOMFORCE_LOCAL_CUSTOMER_AUTH ?? "").trim().toLowerCase();
const enableLocalCustomerAuth = ["1", "true", "yes", "on"].includes(localCustomerAuthFlag);
const localCustomerWriteAccess = process.env.PHANTOMFORCE_LOCAL_CUSTOMER_WRITE_ACCESS !== "false";
const sessionTtlMs = Number(process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000);
const resetTtlMs = Number(process.env.PHANTOMFORCE_LOCAL_CUSTOMER_RESET_TTL_MS ?? 30 * 60 * 1000);
const exposeResetTokens = process.env.PHANTOMFORCE_LOCAL_CUSTOMER_RESET_EXPOSE_TOKENS === "true";
const passwordIterations = 210_000;
const passwordKeyLength = 32;
const passwordDigest = "sha256";
const DEFAULT_LOCAL_CUSTOMER_PLAN_KEY = "starter";
const PLAN_STATUSES = new Set(["trial", "active", "grace", "suspended"]);

let loaded = false;
let store: LocalCustomerStore = emptyStore();

function emptyStore(): LocalCustomerStore {
  return { version: 1, users: [], sessions: [], passwordResets: [] };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function deterministicId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 14)}`;
}

function titleFromEmail(email: string) {
  const base = email.split("@")[0] || "Customer";
  return base
    .replace(/[._+-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
    .slice(0, 80) || "Customer";
}

function publicPlanDefinitions(): PlanDefinition[] {
  return PLAN_DEFINITIONS.filter((plan) => !plan.isInternal);
}

function publicPlanDefinition(planKey?: string | null): PlanDefinition {
  const publicPlans = publicPlanDefinitions();
  return publicPlans.find((plan) => plan.key === planKey)
    ?? publicPlans.find((plan) => plan.key === DEFAULT_LOCAL_CUSTOMER_PLAN_KEY)
    ?? publicPlans[0];
}

function normalizePlanStatus(value: unknown): PlanStatus {
  return PLAN_STATUSES.has(String(value)) ? value as PlanStatus : "active";
}

function resolveLocalCustomerEntitlements(user: LocalCustomerUser): ResolvedEntitlements {
  const definition = publicPlanDefinition(user.planKey);
  const status = normalizePlanStatus(user.planStatus);
  const canWrite = localCustomerWriteAccess && status !== "suspended";
  return {
    orgId: user.activeOrgId,
    planKey: definition.key,
    planName: definition.name,
    status,
    effectiveStatus: status,
    trialEndsAt: null,
    graceUntil: null,
    canWrite,
    upgradeRequired: status === "grace" || status === "suspended",
    features: definition.features,
    limits: definition.limits,
    overridesApplied: false,
    note: user.planNote ?? "Customer self-service test tier.",
  };
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = (await pbkdf2Async(password, salt, passwordIterations, passwordKeyLength, passwordDigest)) as Buffer;
  return `pbkdf2$${passwordIterations}$${salt}$${key.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [scheme, iterationsRaw, salt, expectedRaw] = encoded.split("$");
  if (scheme !== "pbkdf2" || !iterationsRaw || !salt || !expectedRaw) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) return false;
  const expected = Buffer.from(expectedRaw, "base64url");
  const actual = (await pbkdf2Async(password, salt, iterations, expected.length, passwordDigest)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function coerceStore(value: unknown): LocalCustomerStore {
  const candidate = value && typeof value === "object" ? (value as Partial<LocalCustomerStore>) : {};
  return {
    version: 1,
    users: Array.isArray(candidate.users) ? candidate.users as LocalCustomerUser[] : [],
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions as LocalCustomerSessionRecord[] : [],
    passwordResets: Array.isArray(candidate.passwordResets) ? candidate.passwordResets as LocalCustomerResetRecord[] : [],
  };
}

async function loadStore() {
  if (loaded) return;
  loaded = true;
  try {
    store = coerceStore(JSON.parse(await readFile(storePath, "utf8")));
  } catch {
    store = emptyStore();
  }
}

async function saveStore() {
  await mkdir(dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmpPath, storePath);
}

function buildUser(input: LocalCustomerRegisterInput, passwordHash: string): LocalCustomerUser {
  const email = normalizeEmail(input.email);
  const orgId = deterministicId("local-org", email);
  const businessName = (input.businessName || `${titleFromEmail(email)} Workspace`).trim().slice(0, 120);
  const stamp = nowIso();
  return {
    id: deterministicId("local-user", email),
    email,
    name: (input.name || titleFromEmail(email)).trim().slice(0, 120),
    businessName,
    passwordHash,
    activeOrgId: orgId,
    memberships: [{ orgId, orgName: businessName, role: "owner" }],
    planKey: DEFAULT_LOCAL_CUSTOMER_PLAN_KEY,
    planStatus: "active",
    planUpdatedAt: stamp,
    planNote: "Customer self-service test tier.",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

async function upsertSeedCustomer() {
  const email = normalizeEmail(process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_EMAIL ?? "");
  const password = process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_PASSWORD ?? "";
  if (!email || !password) return false;

  const existing = store.users.find((user) => user.email === email);
  const passwordHash = await hashPassword(password);
  if (existing) {
    existing.name = (process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_NAME || existing.name || titleFromEmail(email)).slice(0, 120);
    existing.businessName = (process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_BUSINESS || existing.businessName || "Customer 1 Workspace").slice(0, 120);
    existing.activeOrgId = existing.activeOrgId || deterministicId("local-org", email);
    existing.memberships = existing.memberships.length
      ? existing.memberships.map((membership, index) => index === 0 ? { ...membership, orgName: existing.businessName, role: "owner" } : membership)
      : [{ orgId: existing.activeOrgId, orgName: existing.businessName, role: "owner" }];
    existing.planKey = publicPlanDefinition(existing.planKey).key;
    existing.planStatus = normalizePlanStatus(existing.planStatus);
    existing.planUpdatedAt = existing.planUpdatedAt || nowIso();
    existing.planNote = existing.planNote || "Customer self-service test tier.";
    existing.passwordHash = passwordHash;
    existing.updatedAt = nowIso();
  } else {
    store.users.push(buildUser({
      email,
      password,
      name: process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_NAME || "Customer 1",
      businessName: process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_BUSINESS || "Customer 1 Workspace",
    }, passwordHash));
  }
  return true;
}

export function localCustomerAuthEnabled() {
  return enableLocalCustomerAuth;
}

export function localCustomerAuthStorePath() {
  return storePath;
}

export async function initializeLocalCustomerAuthState() {
  if (!enableLocalCustomerAuth) return;
  await loadStore();
  const changed = await upsertSeedCustomer();
  if (changed || store.users.length === 0) {
    await saveStore();
  }
}

function pruneExpiredRecords() {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => session.revokedAt || new Date(session.expiresAt).getTime() > now);
  store.passwordResets = store.passwordResets.filter((reset) => reset.usedAt || new Date(reset.expiresAt).getTime() > now);
}

function buildSession(user: LocalCustomerUser, sessionRecord: LocalCustomerSessionRecord): AccessSession {
  const activeOrgId = sessionRecord.activeOrgId || user.activeOrgId;
  const memberships = user.memberships.length
    ? user.memberships
    : [{ orgId: activeOrgId, orgName: user.businessName, role: "owner" as const }];
  const activeMembership = memberships.find((membership) => membership.orgId === activeOrgId) ?? memberships[0];
  const entitlements = resolveLocalCustomerEntitlements(user);
  return {
    id: `${LOCAL_CUSTOMER_SESSION_PREFIX}${sessionRecord.id}`,
    label: user.name || user.email,
    role: "client",
    clientId: activeMembership?.orgId ?? activeOrgId,
    canManageAccess: false,
    subscriptionActive: entitlements.canWrite,
    userId: user.id,
    email: user.email,
    authSessionId: sessionRecord.id,
    isSuperAdmin: false,
    orgId: activeMembership?.orgId ?? activeOrgId,
    orgRole: activeMembership?.role ?? "owner",
    memberships,
  };
}

export function listLocalCustomerPlanDefinitions() {
  return publicPlanDefinitions().map((plan) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    isInternal: false,
    trialDays: plan.trialDays,
    graceDays: plan.graceDays,
    features: plan.features,
    limits: plan.limits,
  }));
}

export async function getLocalCustomerPlanSummary(session: AccessSession) {
  if (!enableLocalCustomerAuth || !session.id.startsWith(LOCAL_CUSTOMER_SESSION_PREFIX) || !session.userId) return undefined;
  await loadStore();
  const user = store.users.find((account) => account.id === session.userId);
  if (!user) return undefined;
  const entitlements = resolveLocalCustomerEntitlements(user);
  return {
    entitlements,
    plans: listLocalCustomerPlanDefinitions(),
    metrics: [],
    seats: { used: user.memberships.length || 1, limit: entitlements.limits.seats },
  };
}

export async function assignLocalCustomerPlan(session: AccessSession, planKey: string) {
  if (!enableLocalCustomerAuth) return { ok: false as const, error: "local_customer_auth_disabled" };
  if (!session.id.startsWith(LOCAL_CUSTOMER_SESSION_PREFIX) || !session.userId) return { ok: false as const, error: "local_customer_required" };
  if (!["owner", "admin"].includes(session.orgRole || "")) return { ok: false as const, error: "owner_or_admin_required" };
  const definition = publicPlanDefinitions().find((plan) => plan.key === planKey);
  if (!definition) return { ok: false as const, error: "unknown_public_plan", available: listLocalCustomerPlanDefinitions().map((plan) => plan.key) };
  await loadStore();
  const user = store.users.find((account) => account.id === session.userId);
  if (!user) return { ok: false as const, error: "account_not_found" };
  user.planKey = definition.key;
  user.planStatus = "active";
  user.planUpdatedAt = nowIso();
  user.planNote = "Customer self-service test tier.";
  user.updatedAt = user.planUpdatedAt;
  await saveStore();
  const summary = await getLocalCustomerPlanSummary(session);
  if (!summary) return { ok: false as const, error: "account_not_found" };
  return { ok: true as const, ...summary };
}

export async function loginLocalCustomer(emailRaw: string, password: string) {
  if (!enableLocalCustomerAuth) return undefined;
  await loadStore();
  pruneExpiredRecords();
  const email = normalizeEmail(emailRaw);
  const user = store.users.find((account) => account.email === email);
  const ok = user ? await verifyPassword(password, user.passwordHash).catch(() => false) : false;
  if (!user || !ok) {
    await saveStore();
    return undefined;
  }
  const sessionRecord: LocalCustomerSessionRecord = {
    id: randomBytes(18).toString("base64url"),
    userId: user.id,
    activeOrgId: user.activeOrgId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
  };
  store.sessions.push(sessionRecord);
  await saveStore();
  return buildSession(user, sessionRecord);
}

export async function registerLocalCustomer(input: LocalCustomerRegisterInput) {
  if (!enableLocalCustomerAuth) return { ok: false as const, error: "local_customer_auth_disabled" };
  await loadStore();
  const email = normalizeEmail(input.email);
  if (store.users.some((user) => user.email === email)) {
    return { ok: false as const, error: "account_already_exists" };
  }
  const passwordHash = await hashPassword(input.password);
  const user = buildUser({ ...input, email }, passwordHash);
  store.users.push(user);
  const sessionRecord: LocalCustomerSessionRecord = {
    id: randomBytes(18).toString("base64url"),
    userId: user.id,
    activeOrgId: user.activeOrgId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
  };
  store.sessions.push(sessionRecord);
  await saveStore();
  return { ok: true as const, session: buildSession(user, sessionRecord) };
}

export async function resolveLocalCustomerSession(sid: string) {
  if (!enableLocalCustomerAuth || !sid.startsWith(LOCAL_CUSTOMER_SESSION_PREFIX)) return undefined;
  await loadStore();
  const id = sid.slice(LOCAL_CUSTOMER_SESSION_PREFIX.length);
  const sessionRecord = store.sessions.find((session) => session.id === id);
  if (!sessionRecord || sessionRecord.revokedAt || new Date(sessionRecord.expiresAt).getTime() < Date.now()) {
    return undefined;
  }
  const user = store.users.find((account) => account.id === sessionRecord.userId);
  return user ? buildSession(user, sessionRecord) : undefined;
}

export async function revokeLocalCustomerSession(sid: string) {
  if (!enableLocalCustomerAuth) return;
  await loadStore();
  const id = sid.startsWith(LOCAL_CUSTOMER_SESSION_PREFIX) ? sid.slice(LOCAL_CUSTOMER_SESSION_PREFIX.length) : sid;
  const sessionRecord = store.sessions.find((session) => session.id === id);
  if (sessionRecord && !sessionRecord.revokedAt) {
    sessionRecord.revokedAt = nowIso();
    await saveStore();
  }
}

export async function requestLocalCustomerPasswordReset(emailRaw: string) {
  if (!enableLocalCustomerAuth) return { ok: false as const, error: "local_customer_auth_disabled" };
  await loadStore();
  pruneExpiredRecords();
  const email = normalizeEmail(emailRaw);
  const user = store.users.find((account) => account.email === email);
  if (!user) {
    await saveStore();
    return { ok: true as const, resetToken: undefined, expiresAt: undefined };
  }
  const resetToken = randomBytes(32).toString("base64url");
  const reset: LocalCustomerResetRecord = {
    id: randomBytes(14).toString("base64url"),
    userId: user.id,
    tokenHash: tokenHash(resetToken),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + resetTtlMs).toISOString(),
  };
  store.passwordResets.push(reset);
  await saveStore();
  return {
    ok: true as const,
    resetToken: exposeResetTokens || email.endsWith("@phantomforce.test") ? resetToken : undefined,
    expiresAt: reset.expiresAt,
  };
}

export async function completeLocalCustomerPasswordReset(token: string, password: string) {
  if (!enableLocalCustomerAuth) return { ok: false as const, error: "local_customer_auth_disabled" };
  await loadStore();
  const hash = tokenHash(token.trim());
  const reset = store.passwordResets.find((record) => record.tokenHash === hash);
  if (!reset || reset.usedAt || new Date(reset.expiresAt).getTime() < Date.now()) {
    return { ok: false as const, error: "invalid_or_expired_reset_token" };
  }
  const user = store.users.find((account) => account.id === reset.userId);
  if (!user) return { ok: false as const, error: "account_not_found" };
  user.passwordHash = await hashPassword(password);
  user.updatedAt = nowIso();
  reset.usedAt = nowIso();
  store.sessions = store.sessions.map((session) =>
    session.userId === user.id && !session.revokedAt ? { ...session, revokedAt: reset.usedAt } : session,
  );
  await saveStore();
  return { ok: true as const };
}
