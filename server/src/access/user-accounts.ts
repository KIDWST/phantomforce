/* PhantomForce database auth + organizations.
   The real multi-tenant identity layer behind PHANTOMFORCE_AUTH_PROVIDER=
   "database": users with scrypt password hashes, revocable server-side login
   sessions, org memberships with distinct roles, invitations, active-org
   switching, and a hash-chained audit trail for every membership/role change.

   Role model — kept deliberately separate, never collapsed into one boolean:
   - platform super-admin  -> User.isSuperAdmin (Jordan). Only this maps to
     AccessSession.canManageAccess.
   - org owner / org admin -> Membership.role "owner"/"admin" (admin of their
     own business only; NEVER platform access).
   - employee/member       -> Membership.role "member".
   - client/restricted     -> Membership.role "client" (view-oriented; the
     product's existing client-workspace semantics).
   Tenant isolation rides on AccessSession.clientId = the active org id, so
   every existing requireClientWorkspaceView call site stays enforced. */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

import type { MembershipRole, PrismaClient } from "@prisma/client";

import { assignOrgPlan, getOrgEntitlements, syncPlanCatalog } from "./entitlements.js";
import { prisma } from "./prisma-runtime.js";
import type { AccessSession } from "./session.js";

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const productionMode = nodeEnv === "production";
export const databaseAuthEnabled = (process.env.PHANTOMFORCE_AUTH_PROVIDER ?? "demo") === "database";

const SESSION_TTL_MS = Number(process.env.PHANTOMFORCE_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000);
const INVITATION_TTL_MS = Number(process.env.PHANTOMFORCE_INVITATION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
const SESSION_CACHE_TTL_MS = 15_000;

export const DB_SESSION_PREFIX = "db:";

function requirePrisma(): PrismaClient {
  if (!prisma) {
    throw new Error("PHANTOMFORCE_AUTH_PROVIDER=database requires DATABASE_URL (Prisma repository mode).");
  }
  return prisma;
}

/* ---------------- password hashing (scrypt, no external deps) ---------------- */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof password !== "string" || !password) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(hashRaw, "base64url");
    const derived = (await scrypt(password, salt, expected.length, {
      N: Number(nRaw), r: Number(rRaw), p: Number(pRaw),
    })) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* ---------------- org-scoped audit trail (hash-chained) ---------------- */

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function recordOrgAuditEvent(input: {
  orgId: string;
  actor: string;
  eventType: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
}) {
  const db = requirePrisma();
  const previous = await db.auditEvent.findFirst({
    where: { orgId: input.orgId },
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });
  const prevHash = previous?.hash ?? null;
  const body = {
    orgId: input.orgId,
    actor: input.actor,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload,
    prevHash,
  };
  return db.auditEvent.create({
    data: { ...body, payload: input.payload as object, hash: stableHash(body) },
  });
}

/* ---------------- session resolution + cache ---------------- */

export type DatabaseSessionDetails = AccessSession & {
  userId: string;
  email: string;
  authSessionId: string;
  isSuperAdmin: boolean;
  orgId: string | null;
  orgRole: MembershipRole | null;
  memberships: Array<{ orgId: string; orgName: string; role: MembershipRole }>;
};

type CacheEntry = { session: DatabaseSessionDetails; expiresAt: number };
const sessionCache = new Map<string, CacheEntry>();

export function invalidateDatabaseSessionCache(authSessionId?: string) {
  if (authSessionId) sessionCache.delete(authSessionId);
  else sessionCache.clear();
}

function invalidateCacheForUser(userId: string) {
  for (const [key, entry] of sessionCache) {
    if (entry.session.userId === userId) sessionCache.delete(key);
  }
}

function invalidateCacheForOrg(orgId: string) {
  for (const [key, entry] of sessionCache) {
    if (entry.session.orgId === orgId || entry.session.memberships.some((m) => m.orgId === orgId)) {
      sessionCache.delete(key);
    }
  }
}

export function invalidateDatabaseSessionCacheForOrg(orgId: string) {
  invalidateCacheForOrg(orgId);
}

async function buildSessionDetails(authSessionId: string): Promise<DatabaseSessionDetails | undefined> {
  const db = requirePrisma();
  const row = await db.authSession.findUnique({
    where: { id: authSessionId },
    include: {
      user: { include: { memberships: { include: { org: { select: { id: true, name: true } } } } } },
    },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return undefined;

  const memberships = row.user.memberships.map((m) => ({ orgId: m.orgId, orgName: m.org.name, role: m.role }));
  const activeOrgId =
    row.activeOrgId && memberships.some((m) => m.orgId === row.activeOrgId)
      ? row.activeOrgId
      : row.user.isSuperAdmin
        ? row.activeOrgId
        : memberships[0]?.orgId ?? null;
  const orgRole = memberships.find((m) => m.orgId === activeOrgId)?.role ?? null;
  const isSuperAdmin = row.user.isSuperAdmin;

  /* The global write paywall reads subscriptionActive. For database sessions
     it becomes real entitlement state: the active org's plan must allow
     writes, and restricted "client" members never get the write bit. */
  let subscriptionActive = isSuperAdmin;
  if (!isSuperAdmin && activeOrgId && orgRole && orgRole !== "client") {
    try {
      const entitlements = await getOrgEntitlements(activeOrgId);
      subscriptionActive = entitlements.canWrite;
    } catch {
      subscriptionActive = false; /* fail closed */
    }
  }

  return {
    id: `${DB_SESSION_PREFIX}${row.id}`,
    label: row.user.name ?? row.user.email,
    role: isSuperAdmin ? "admin" : "client",
    clientId: isSuperAdmin ? undefined : activeOrgId ?? undefined,
    canManageAccess: isSuperAdmin,
    subscriptionActive,
    userId: row.userId,
    email: row.user.email,
    authSessionId: row.id,
    isSuperAdmin,
    orgId: activeOrgId,
    orgRole,
    memberships,
  };
}

export async function resolveDatabaseSession(sid: string): Promise<DatabaseSessionDetails | undefined> {
  if (!sid.startsWith(DB_SESSION_PREFIX)) return undefined;
  const authSessionId = sid.slice(DB_SESSION_PREFIX.length);
  const cached = sessionCache.get(authSessionId);
  if (cached && cached.expiresAt > Date.now()) return cached.session;
  const session = await buildSessionDetails(authSessionId);
  if (session) {
    sessionCache.set(authSessionId, { session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  } else {
    sessionCache.delete(authSessionId);
  }
  return session;
}

export function asDatabaseSession(session: AccessSession | undefined): DatabaseSessionDetails | undefined {
  if (!session || !session.id.startsWith(DB_SESSION_PREFIX)) return undefined;
  return session as DatabaseSessionDetails;
}

/* ---------------- login / logout / org switching ---------------- */

export async function loginWithPassword(emailRaw: string, password: string) {
  const db = requirePrisma();
  const email = emailRaw.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    /* uniform failure: no user-exists oracle */
    return undefined;
  }
  const row = await db.authSession.create({
    data: {
      userId: user.id,
      activeOrgId: user.activeOrgId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const session = await buildSessionDetails(row.id);
  if (!session) return undefined;
  sessionCache.set(row.id, { session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return session;
}

export async function revokeDatabaseSession(authSessionId: string) {
  const db = requirePrisma();
  await db.authSession.updateMany({
    where: { id: authSessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  sessionCache.delete(authSessionId);
}

export async function revokeAllSessionsForUser(userId: string) {
  const db = requirePrisma();
  await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  invalidateCacheForUser(userId);
}

export async function switchActiveOrg(session: DatabaseSessionDetails, orgId: string) {
  const db = requirePrisma();
  const isMember = session.memberships.some((m) => m.orgId === orgId);
  if (!isMember && !session.isSuperAdmin) {
    return { ok: false as const, error: "not_a_member" };
  }
  if (session.isSuperAdmin && !isMember) {
    const org = await db.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) return { ok: false as const, error: "org_not_found" };
  }
  await db.authSession.update({ where: { id: session.authSessionId }, data: { activeOrgId: orgId } });
  await db.user.update({ where: { id: session.userId }, data: { activeOrgId: orgId } });
  sessionCache.delete(session.authSessionId);
  return { ok: true as const, session: await resolveDatabaseSession(`${DB_SESSION_PREFIX}${session.authSessionId}`) };
}

/* ---------------- organizations + memberships ---------------- */

const ORG_MANAGER_ROLES: MembershipRole[] = ["owner", "admin"];

export function canManageOrg(session: DatabaseSessionDetails, orgId: string) {
  if (session.isSuperAdmin) return true;
  const membership = session.memberships.find((m) => m.orgId === orgId);
  return Boolean(membership && ORG_MANAGER_ROLES.includes(membership.role));
}

export function canAccessOrg(session: DatabaseSessionDetails, orgId: string) {
  return session.isSuperAdmin || session.memberships.some((m) => m.orgId === orgId);
}

export async function listOrganizationsForSession(session: DatabaseSessionDetails) {
  const db = requirePrisma();
  if (session.isSuperAdmin) {
    const orgs = await db.org.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { memberships: true } }, orgPlan: { select: { planKey: true, status: true } } },
    });
    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      memberCount: org._count.memberships,
      plan: org.orgPlan ? { key: org.orgPlan.planKey, status: org.orgPlan.status } : null,
      role: session.memberships.find((m) => m.orgId === org.id)?.role ?? null,
    }));
  }
  return session.memberships.map((m) => ({ id: m.orgId, name: m.orgName, role: m.role }));
}

export async function createOrganization(input: { name: string; actor: DatabaseSessionDetails; ownerEmail?: string }) {
  const db = requirePrisma();
  const org = await db.org.create({ data: { name: input.name.trim().slice(0, 120) } });
  await recordOrgAuditEvent({
    orgId: org.id,
    actor: input.actor.email,
    eventType: "org.created",
    targetType: "org",
    targetId: org.id,
    payload: { name: org.name, createdBy: input.actor.userId },
  });
  return org;
}

export async function listOrgMembers(orgId: string) {
  const db = requirePrisma();
  const rows = await db.membership.findMany({
    where: { orgId },
    include: { user: { select: { id: true, email: true, name: true, isSuperAdmin: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    isSuperAdmin: m.user.isSuperAdmin,
    joinedAt: m.createdAt.toISOString(),
  }));
}

export async function updateMemberRole(input: {
  orgId: string;
  targetUserId: string;
  role: MembershipRole;
  actor: DatabaseSessionDetails;
}) {
  const db = requirePrisma();
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: input.targetUserId, orgId: input.orgId } },
  });
  if (!membership) return { ok: false as const, error: "membership_not_found" };
  /* Granting or removing the owner role is reserved for an existing org owner
     or the platform super-admin — org admins cannot promote themselves. */
  const actorRole = input.actor.memberships.find((m) => m.orgId === input.orgId)?.role;
  const touchingOwner = membership.role === "owner" || input.role === "owner";
  if (touchingOwner && !input.actor.isSuperAdmin && actorRole !== "owner") {
    return { ok: false as const, error: "owner_change_requires_owner" };
  }
  if (membership.role === "owner" && input.role !== "owner") {
    const otherOwners = await db.membership.count({ where: { orgId: input.orgId, role: "owner", NOT: { userId: input.targetUserId } } });
    if (otherOwners === 0) return { ok: false as const, error: "cannot_remove_last_owner" };
  }
  const updated = await db.membership.update({
    where: { userId_orgId: { userId: input.targetUserId, orgId: input.orgId } },
    data: { role: input.role },
  });
  invalidateCacheForOrg(input.orgId);
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actor.email,
    eventType: "membership.role_changed",
    targetType: "membership",
    targetId: updated.id,
    payload: { userId: input.targetUserId, from: membership.role, to: input.role },
  });
  return { ok: true as const, membership: updated };
}

export async function removeMember(input: { orgId: string; targetUserId: string; actor: DatabaseSessionDetails }) {
  const db = requirePrisma();
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: input.targetUserId, orgId: input.orgId } },
  });
  if (!membership) return { ok: false as const, error: "membership_not_found" };
  if (membership.role === "owner") {
    const otherOwners = await db.membership.count({ where: { orgId: input.orgId, role: "owner", NOT: { userId: input.targetUserId } } });
    if (otherOwners === 0) return { ok: false as const, error: "cannot_remove_last_owner" };
    const actorRole = input.actor.memberships.find((m) => m.orgId === input.orgId)?.role;
    if (!input.actor.isSuperAdmin && actorRole !== "owner") {
      return { ok: false as const, error: "owner_change_requires_owner" };
    }
  }
  await db.membership.delete({ where: { userId_orgId: { userId: input.targetUserId, orgId: input.orgId } } });
  invalidateCacheForOrg(input.orgId);
  invalidateCacheForUser(input.targetUserId);
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actor.email,
    eventType: "membership.removed",
    targetType: "membership",
    targetId: membership.id,
    payload: { userId: input.targetUserId, role: membership.role },
  });
  return { ok: true as const };
}

/* ---------------- invitations ---------------- */

function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(input: {
  orgId: string;
  email: string;
  role: MembershipRole;
  actor: DatabaseSessionDetails;
}) {
  const db = requirePrisma();
  const email = input.email.trim().toLowerCase();
  const actorRole = input.actor.memberships.find((m) => m.orgId === input.orgId)?.role;
  if (input.role === "owner" && !input.actor.isSuperAdmin && actorRole !== "owner") {
    return { ok: false as const, error: "owner_invitations_require_owner" };
  }
  const existingMembership = await db.membership.findFirst({
    where: { orgId: input.orgId, user: { email } },
  });
  if (existingMembership) return { ok: false as const, error: "already_a_member" };

  const rawToken = randomBytes(32).toString("base64url");
  const invitation = await db.invitation.create({
    data: {
      orgId: input.orgId,
      email,
      role: input.role,
      tokenHash: hashInvitationToken(rawToken),
      invitedByUserId: input.actor.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actor.email,
    eventType: "invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    payload: { email, role: input.role },
  });
  /* rawToken is returned exactly once; only its hash is stored */
  return { ok: true as const, invitation, token: rawToken };
}

export async function listInvitations(orgId: string) {
  const db = requirePrisma();
  const rows = await db.invitation.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    createdAt: inv.createdAt.toISOString(),
    expiresAt: inv.expiresAt.toISOString(),
    status: inv.revokedAt ? "revoked" : inv.acceptedAt ? "accepted" : inv.expiresAt.getTime() < Date.now() ? "expired" : "pending",
  }));
}

export async function revokeInvitation(input: { orgId: string; invitationId: string; actor: DatabaseSessionDetails }) {
  const db = requirePrisma();
  const invitation = await db.invitation.findFirst({ where: { id: input.invitationId, orgId: input.orgId } });
  if (!invitation) return { ok: false as const, error: "invitation_not_found" };
  if (invitation.acceptedAt) return { ok: false as const, error: "already_accepted" };
  await db.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actor.email,
    eventType: "invitation.revoked",
    targetType: "invitation",
    targetId: invitation.id,
    payload: { email: invitation.email },
  });
  return { ok: true as const };
}

export async function acceptInvitation(input: { token: string; name?: string; password?: string }) {
  const db = requirePrisma();
  const invitation = await db.invitation.findUnique({ where: { tokenHash: hashInvitationToken(input.token) } });
  if (!invitation) return { ok: false as const, error: "invitation_not_found" };
  if (invitation.revokedAt) return { ok: false as const, error: "invitation_revoked" };
  if (invitation.acceptedAt) return { ok: false as const, error: "invitation_already_accepted" };
  if (invitation.expiresAt.getTime() < Date.now()) return { ok: false as const, error: "invitation_expired" };

  let user = await db.user.findUnique({ where: { email: invitation.email } });
  if (!user) {
    if (!input.password) return { ok: false as const, error: "password_required_for_new_account" };
    user = await db.user.create({
      data: {
        email: invitation.email,
        name: input.name?.trim().slice(0, 120) || null,
        passwordHash: await hashPassword(input.password),
        activeOrgId: invitation.orgId,
      },
    });
  }
  await db.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: invitation.orgId } },
    create: { userId: user.id, orgId: invitation.orgId, role: invitation.role },
    update: { role: invitation.role },
  });
  if (!user.activeOrgId) {
    await db.user.update({ where: { id: user.id }, data: { activeOrgId: invitation.orgId } });
  }
  await db.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date(), acceptedByUserId: user.id },
  });
  invalidateCacheForUser(user.id);
  await recordOrgAuditEvent({
    orgId: invitation.orgId,
    actor: invitation.email,
    eventType: "invitation.accepted",
    targetType: "invitation",
    targetId: invitation.id,
    payload: { userId: user.id, role: invitation.role },
  });
  return { ok: true as const, userId: user.id, orgId: invitation.orgId };
}

export async function listOrgAuditEvents(orgId: string, limit = 50) {
  const db = requirePrisma();
  const rows = await db.auditEvent.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((event) => ({
    id: event.id,
    actor: event.actor,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }));
}

/* ---------------- development seed (dev-only, clearly marked) ---------------- */

export async function initializeDatabaseAuthState() {
  if (!databaseAuthEnabled) return;
  requirePrisma();
  if (productionMode) return; /* production onboarding happens via real invitations */
  if (process.env.PHANTOMFORCE_SEED_DEV_IDENTITIES === "false") return;
  await seedDevelopmentIdentities();
}

/* DEVELOPMENT SEED DATA — deterministic fixtures for local work and tests.
   Every seeded record is prefixed dev- and uses .local emails so it can never
   be mistaken for production data. Passwords come from
   PHANTOMFORCE_DEV_SEED_PASSWORD (default "phantom-dev-password"). */
export async function seedDevelopmentIdentities() {
  const db = requirePrisma();
  const password = process.env.PHANTOMFORCE_DEV_SEED_PASSWORD ?? "phantom-dev-password";
  const passwordHash = await hashPassword(password);

  const orgs = [
    { id: "dev-org-phantomforce", name: "PhantomForce (dev)" },
    { id: "dev-org-chicagoshots", name: "ChicagoShots (dev)" },
  ];
  const users: Array<{
    id: string; email: string; name: string; isSuperAdmin: boolean;
    memberships: Array<{ orgId: string; role: MembershipRole }>;
  }> = [
    {
      id: "dev-user-jordan",
      email: "jordan@phantomforce.local",
      name: "Jordan (dev super-admin)",
      isSuperAdmin: true,
      memberships: [{ orgId: "dev-org-phantomforce", role: "owner" }],
    },
    {
      id: "dev-user-chicago-owner",
      email: "owner@chicagoshots.local",
      name: "ChicagoShots Owner (dev)",
      isSuperAdmin: false,
      memberships: [{ orgId: "dev-org-chicagoshots", role: "owner" }],
    },
    {
      id: "dev-user-chicago-employee",
      email: "employee@chicagoshots.local",
      name: "ChicagoShots Employee (dev)",
      isSuperAdmin: false,
      memberships: [{ orgId: "dev-org-chicagoshots", role: "member" }],
    },
    {
      id: "dev-user-chicago-client",
      email: "client@chicagoshots.local",
      name: "ChicagoShots Client (dev)",
      isSuperAdmin: false,
      memberships: [{ orgId: "dev-org-chicagoshots", role: "client" }],
    },
  ];

  await db.$transaction(async (tx) => {
    for (const org of orgs) {
      await tx.org.upsert({ where: { id: org.id }, create: org, update: { name: org.name } });
    }
    for (const user of users) {
      await tx.user.upsert({
        where: { email: user.email },
        create: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
          passwordHash,
          activeOrgId: user.memberships[0]?.orgId ?? null,
        },
        update: { name: user.name, isSuperAdmin: user.isSuperAdmin },
      });
      for (const membership of user.memberships) {
        await tx.membership.upsert({
          where: { userId_orgId: { userId: user.id, orgId: membership.orgId } },
          create: { userId: user.id, orgId: membership.orgId, role: membership.role },
          update: { role: membership.role },
        });
      }
    }
  });

  /* dev plan assignments — clearly marked, never production data */
  await syncPlanCatalog();
  await assignOrgPlan({ orgId: "dev-org-phantomforce", planKey: "internal", status: "active", note: "DEV SEED — internal org" });
  await assignOrgPlan({ orgId: "dev-org-chicagoshots", planKey: "professional", status: "active", note: "DEV SEED — demo business" });
}
