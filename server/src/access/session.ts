import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { isSubscriptionActive } from "./subscription-store.js";

export const SESSION_HEADER = "x-phantomforce-session";
export const AUTHORIZATION_HEADER = "Authorization";

export type SessionRole = "admin" | "client";

export type AccessSession = {
  id: string;
  label: string;
  role: SessionRole;
  clientId?: string;
  canManageAccess: boolean;
  visibleOnLogin?: boolean;
  /** Paid access, resolved server-side from the subscription store. Never client-set. */
  subscriptionActive?: boolean;
};

const DEFAULT_SESSION_SECRET = "phantomforce-local-dev-session-secret-change-before-production";
const nodeEnv = process.env.NODE_ENV ?? "development";
const productionMode = nodeEnv === "production";
const authProvider = process.env.PHANTOMFORCE_AUTH_PROVIDER ?? "demo";
const enableDemoAuth =
  authProvider === "demo" && process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH !== "false" && !productionMode;
const enablePrismaDevAuth = authProvider === "prisma-dev" && !productionMode;
const enableOwnerProductionAuth = authProvider === "owner-production";
const enableGatewayForwardedAuth = authProvider === "gateway-forwarded";
const ownerEmail = (process.env.PHANTOMFORCE_OWNER_EMAIL ?? "").trim().toLowerCase();
const ownerLoginKey = process.env.PHANTOMFORCE_OWNER_LOGIN_KEY ?? "";
const MIN_OWNER_LOGIN_KEY_LENGTH = 16;
const MIN_SESSION_SECRET_LENGTH = 32;
const enableLocalSessionLogin = enableDemoAuth || enablePrismaDevAuth || enableOwnerProductionAuth;

const demoSessions: AccessSession[] = [
  {
    id: "admin-jordan",
    label: "Jordan (admin)",
    role: "admin",
    canManageAccess: true,
    visibleOnLogin: true,
  },
  {
    id: "client-chicagoshots",
    label: "ChicagoShots client workspace",
    role: "client",
    clientId: "client-chicagoshots",
    canManageAccess: false,
    visibleOnLogin: false,
  },
  {
    id: "client-sports-demo",
    label: "Test Client",
    role: "client",
    clientId: "client-sports-demo",
    canManageAccess: false,
    visibleOnLogin: true,
  },
  {
    id: "client-past-due",
    label: "The Force",
    role: "client",
    clientId: "client-past-due",
    canManageAccess: false,
    visibleOnLogin: false,
  },
];

export const OWNER_SESSION_ID = "owner-admin";

const ownerSession: AccessSession = {
  id: OWNER_SESSION_ID,
  // Public /sessions exposes this label, so it must not leak the owner email.
  label: "PhantomForce Owner",
  role: "admin",
  canManageAccess: true,
};

let accessSessions: AccessSession[] = enableDemoAuth
  ? demoSessions
  : enableOwnerProductionAuth
    ? [ownerSession]
    : [];

const tokenTtlMs = Number(process.env.PHANTOMFORCE_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000);
const sessionSecret = process.env.PHANTOMFORCE_SESSION_SECRET ?? DEFAULT_SESSION_SECRET;
const allowUnsignedSessionHeader = process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER === "true";
const sessionSecretUsesDefault = sessionSecret === DEFAULT_SESSION_SECRET;
const sessionSecretIsStrong =
  !sessionSecretUsesDefault && sessionSecret.length >= MIN_SESSION_SECRET_LENGTH;
const ownerProductionConfigured =
  enableOwnerProductionAuth &&
  sessionSecretIsStrong &&
  Boolean(ownerEmail) &&
  ownerLoginKey.length >= MIN_OWNER_LOGIN_KEY_LENGTH &&
  !enableDemoAuth &&
  !allowUnsignedSessionHeader;

// --- gateway-forwarded auth (Pangolin forward-auth / unified single login) ---
// Pangolin authenticates the user at its gate (built-in accounts) and reverse-
// proxies the request with the user's identity in a header. PhantomForce trusts
// that identity ONLY when the request also carries the shared secret, so the
// header cannot be forged by anything that bypasses the gateway. Fail-closed:
// no secret, wrong secret, no user, or an unmapped user => no session.
const MIN_GATEWAY_SECRET_LENGTH = 16;
const gatewaySharedSecret = process.env.PHANTOMFORCE_GATEWAY_SHARED_SECRET ?? "";
const gatewaySecretHeader = (
  process.env.PHANTOMFORCE_GATEWAY_SECRET_HEADER ?? "x-phantomforce-gateway"
)
  .trim()
  .toLowerCase();
const gatewayUserHeader = (process.env.PHANTOMFORCE_GATEWAY_USER_HEADER ?? "remote-user")
  .trim()
  .toLowerCase();
const gatewayAdminUsers = new Set(
  (process.env.PHANTOMFORCE_GATEWAY_ADMIN_USERS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const gatewayClientMap = new Map<string, string>(
  (process.env.PHANTOMFORCE_GATEWAY_CLIENT_MAP ?? "")
    .split(",")
    .map((pair) => pair.split("="))
    .filter((kv) => kv.length === 2 && kv[0]?.trim() && kv[1]?.trim())
    .map(([user, clientId]) => [user.trim().toLowerCase(), clientId.trim()]),
);
const gatewayConfigured =
  enableGatewayForwardedAuth &&
  gatewaySharedSecret.length >= MIN_GATEWAY_SECRET_LENGTH &&
  (gatewayAdminUsers.size > 0 || gatewayClientMap.size > 0) &&
  !enableDemoAuth &&
  !allowUnsignedSessionHeader;

const AccessSessionTokenPayloadSchema = z.object({
  v: z.literal(1),
  sid: z.string().min(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});

export const AccessLoginSchema = z.object({
  sessionId: z.string().min(1),
  ownerKey: z.string().optional(),
});

export function getAccessAuthConfiguration() {
  return {
    authProvider,
    productionMode,
    demoAuthEnabled: enableDemoAuth,
    prismaDevAuthEnabled: enablePrismaDevAuth,
    ownerProductionAuthEnabled: enableOwnerProductionAuth,
    gatewayForwardedAuthEnabled: enableGatewayForwardedAuth,
    gatewayConfigured,
    sessionLoginEnabled: enableLocalSessionLogin,
    sessionSource: enableGatewayForwardedAuth
      ? "gateway-forwarded"
      : enableOwnerProductionAuth
        ? "owner-production"
        : enablePrismaDevAuth
          ? "prisma-membership"
          : enableDemoAuth
            ? "demo-seed"
            : "disabled",
    productionReady: ownerProductionConfigured || gatewayConfigured,
    tokenType: "Bearer" as const,
    authorizationHeader: AUTHORIZATION_HEADER,
    legacyHeader: SESSION_HEADER,
    legacyHeaderAccepted: allowUnsignedSessionHeader,
    sessionSecretConfigured: Boolean(process.env.PHANTOMFORCE_SESSION_SECRET),
    sessionSecretUsesDefault,
    sessionSecretIsStrong,
    ownerEmailConfigured: Boolean(ownerEmail),
    ownerLoginKeyConfigured: ownerLoginKey.length >= MIN_OWNER_LOGIN_KEY_LENGTH,
    tokenTtlMs,
    loginEndpoint: enableLocalSessionLogin ? "/auth/session-login" : undefined,
    ownerLoginEndpoint: enableOwnerProductionAuth ? "/auth/owner-login" : undefined,
    demoLoginEndpoint: enableDemoAuth ? "/auth/demo-login" : undefined,
  };
}

export function assertAccessAuthConfiguration() {
  const authConfiguration = getAccessAuthConfiguration();

  if (
    authProvider !== "demo" &&
    authProvider !== "prisma-dev" &&
    authProvider !== "owner-production" &&
    authProvider !== "gateway-forwarded"
  ) {
    throw new Error(`Unsupported PHANTOMFORCE_AUTH_PROVIDER "${authProvider}".`);
  }

  // Gateway-forwarded (Pangolin single login). Valid in production too. Must be
  // strongly configured and never coexist with demo auth or unsigned headers.
  if (enableGatewayForwardedAuth) {
    if (enableDemoAuth) {
      throw new Error("Demo auth must be disabled for gateway-forwarded auth.");
    }

    if (allowUnsignedSessionHeader) {
      throw new Error(
        "PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER cannot be enabled with gateway-forwarded auth.",
      );
    }

    if (gatewaySharedSecret.length < MIN_GATEWAY_SECRET_LENGTH) {
      throw new Error(
        "PHANTOMFORCE_GATEWAY_SHARED_SECRET must be set to a strong value (at least 16 characters) for gateway-forwarded auth.",
      );
    }

    if (gatewayAdminUsers.size === 0 && gatewayClientMap.size === 0) {
      throw new Error(
        "gateway-forwarded auth requires PHANTOMFORCE_GATEWAY_ADMIN_USERS and/or PHANTOMFORCE_GATEWAY_CLIENT_MAP to map forwarded identities.",
      );
    }

    return authConfiguration;
  }

  // Owner-controlled production auth. Must be strongly configured whether or not
  // NODE_ENV=production, and never coexists with demo auth or unsigned headers.
  if (enableOwnerProductionAuth) {
    if (allowUnsignedSessionHeader) {
      throw new Error(
        "PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER cannot be enabled with owner-production auth.",
      );
    }

    if (enableDemoAuth) {
      throw new Error("Demo auth must be disabled for owner-production auth.");
    }

    if (sessionSecretUsesDefault || sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
      throw new Error(
        "PHANTOMFORCE_SESSION_SECRET must be a strong non-default value (at least 32 characters) for owner-production auth.",
      );
    }

    if (!ownerEmail) {
      throw new Error("PHANTOMFORCE_OWNER_EMAIL must be set for owner-production auth.");
    }

    if (ownerLoginKey.length < MIN_OWNER_LOGIN_KEY_LENGTH) {
      throw new Error(
        "PHANTOMFORCE_OWNER_LOGIN_KEY must be set to a strong value (at least 16 characters) for owner-production auth.",
      );
    }

    return authConfiguration;
  }

  if (!productionMode) {
    return authConfiguration;
  }

  if (allowUnsignedSessionHeader) {
    throw new Error("PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER cannot be enabled in production.");
  }

  if (sessionSecretUsesDefault || sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error("PHANTOMFORCE_SESSION_SECRET must be set to a strong non-default value in production.");
  }

  throw new Error(
    "Production auth requires PHANTOMFORCE_AUTH_PROVIDER=owner-production. Refusing to serve demo/dev sessions in NODE_ENV=production.",
  );
}

export function listAccessSessions(options?: { includeHidden?: boolean }) {
  if (options?.includeHidden) return accessSessions;

  return accessSessions.filter((session) => session.visibleOnLogin !== false);
}

export function setAccessSessions(sessions: AccessSession[]) {
  accessSessions = sessions;
}

export function getAccessSession(id: string | undefined) {
  if (!enableLocalSessionLogin) return undefined;
  if (!id) return undefined;
  return accessSessions.find((session) => session.id === id);
}

function signTokenSegment(segment: string) {
  return createHmac("sha256", sessionSecret).update(segment).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;

  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim();
}

function verifyAccessSessionToken(token: string | undefined) {
  if (!token) return undefined;

  const [payloadSegment, signature, unexpected] = token.split(".");

  if (!payloadSegment || !signature || unexpected) {
    return undefined;
  }

  const expectedSignature = signTokenSegment(payloadSegment);

  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }

  try {
    const payload = AccessSessionTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")),
    );

    if (payload.exp < Date.now()) {
      return undefined;
    }

    return getAccessSession(payload.sid);
  } catch {
    return undefined;
  }
}

export function ownerProductionAuthEnabled() {
  return enableOwnerProductionAuth;
}

export function verifyOwnerKey(provided: string | undefined): boolean {
  if (!enableOwnerProductionAuth) {
    return false;
  }

  if (ownerLoginKey.length < MIN_OWNER_LOGIN_KEY_LENGTH) {
    return false;
  }

  if (!provided) {
    return false;
  }

  return safeEqual(provided, ownerLoginKey);
}

export function issueAccessSessionToken(sessionId: string, options?: { ownerKey?: string }) {
  if (!enableLocalSessionLogin) {
    return undefined;
  }

  // Owner-production requires the owner login key before any token is minted.
  if (enableOwnerProductionAuth && !verifyOwnerKey(options?.ownerKey)) {
    return undefined;
  }

  const session = getAccessSession(sessionId);

  if (!session) {
    return undefined;
  }

  const issuedAt = Date.now();
  const expiresAtMs = issuedAt + tokenTtlMs;
  const payloadSegment = Buffer.from(
    JSON.stringify({
      v: 1,
      sid: session.id,
      iat: issuedAt,
      exp: expiresAtMs,
    }),
  ).toString("base64url");

  return {
    tokenType: "Bearer" as const,
    token: `${payloadSegment}.${signTokenSegment(payloadSegment)}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    session,
  };
}

function getSessionHeader(request: FastifyRequest) {
  const value = request.headers[SESSION_HEADER];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function readForwardedHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === "string" ? header : undefined;
}

// Resolve a session from Pangolin's forwarded identity. Trust nothing unless the
// shared secret matches (timing-safe). An unmapped but gateway-authenticated
// user is denied rather than granted a default workspace — fail closed.
function resolveGatewayForwardedSession(request: FastifyRequest): AccessSession | undefined {
  if (gatewaySharedSecret.length < MIN_GATEWAY_SECRET_LENGTH) {
    return undefined;
  }

  const presentedSecret = readForwardedHeader(request, gatewaySecretHeader);
  if (!presentedSecret || !safeEqual(presentedSecret, gatewaySharedSecret)) {
    return undefined;
  }

  const user = (readForwardedHeader(request, gatewayUserHeader) ?? "").trim().toLowerCase();
  if (!user) {
    return undefined;
  }

  if (gatewayAdminUsers.has(user)) {
    return {
      id: `gateway:${user}`,
      label: "Operator",
      role: "admin",
      canManageAccess: true,
    };
  }

  const clientId = gatewayClientMap.get(user);
  if (!clientId) {
    return undefined;
  }

  return {
    id: `gateway:${user}`,
    label: "Client workspace",
    role: "client",
    clientId,
    canManageAccess: false,
    subscriptionActive: isSubscriptionActive(user),
  };
}

export function resolveAccessSession(request: FastifyRequest) {
  if (enableGatewayForwardedAuth) {
    return resolveGatewayForwardedSession(request);
  }

  const bearerSession = verifyAccessSessionToken(readBearerToken(request));

  if (bearerSession) {
    return bearerSession;
  }

  if (allowUnsignedSessionHeader) {
    return getAccessSession(getSessionHeader(request));
  }

  return undefined;
}

export function requireAccessSession(request: FastifyRequest, reply: FastifyReply) {
  const session = resolveAccessSession(request);

  if (!session) {
    reply.code(401).send({
      ok: false,
      error: `Missing or invalid ${AUTHORIZATION_HEADER} bearer token.`,
      loginEndpoint: enableOwnerProductionAuth
        ? "/auth/owner-login"
        : enableDemoAuth
          ? "/auth/demo-login"
          : "/auth/session-login",
      sessions: listAccessSessions(),
    });
    return undefined;
  }

  return session;
}

export function requireAdminAccessSession(request: FastifyRequest, reply: FastifyReply) {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return undefined;
  }

  if (!session.canManageAccess) {
    reply.code(403).send({
      ok: false,
      error: "This session cannot manage client access.",
      session,
    });
    return undefined;
  }

  return session;
}

export function canViewClientWorkspace(session: AccessSession, clientId: string) {
  return session.canManageAccess || session.clientId === clientId;
}

export function requireClientWorkspaceView(
  request: FastifyRequest,
  reply: FastifyReply,
  clientId: string,
) {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return undefined;
  }

  if (!canViewClientWorkspace(session, clientId)) {
    reply.code(403).send({
      ok: false,
      error: "This session cannot view the requested client workspace.",
      session,
      clientId,
    });
    return undefined;
  }

  return session;
}
