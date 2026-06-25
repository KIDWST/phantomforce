import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const SESSION_HEADER = "x-phantomforce-session";
export const AUTHORIZATION_HEADER = "Authorization";

export type SessionRole = "admin" | "client";

export type AccessSession = {
  id: string;
  label: string;
  role: SessionRole;
  clientId?: string;
  canManageAccess: boolean;
};

const DEFAULT_SESSION_SECRET = "phantomforce-local-dev-session-secret-change-before-production";
const nodeEnv = process.env.NODE_ENV ?? "development";
const productionMode = nodeEnv === "production";
const authProvider = process.env.PHANTOMFORCE_AUTH_PROVIDER ?? "demo";
const enableDemoAuth =
  authProvider === "demo" && process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH !== "false" && !productionMode;
const enablePrismaDevAuth = authProvider === "prisma-dev" && !productionMode;
const enableLocalSessionLogin = enableDemoAuth || enablePrismaDevAuth;

const demoSessions: AccessSession[] = [
  {
    id: "admin-jordan",
    label: "Jordan / PhantomForce Admin",
    role: "admin",
    canManageAccess: true,
  },
  {
    id: "client-chicagoshots",
    label: "ChicagoShots client workspace",
    role: "client",
    clientId: "client-chicagoshots",
    canManageAccess: false,
  },
  {
    id: "client-sports-demo",
    label: "Sports Ops Demo client",
    role: "client",
    clientId: "client-sports-demo",
    canManageAccess: false,
  },
  {
    id: "client-past-due",
    label: "Past Due Pilot client",
    role: "client",
    clientId: "client-past-due",
    canManageAccess: false,
  },
];

let accessSessions: AccessSession[] = enableDemoAuth ? demoSessions : [];

const tokenTtlMs = Number(process.env.PHANTOMFORCE_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000);
const sessionSecret = process.env.PHANTOMFORCE_SESSION_SECRET ?? DEFAULT_SESSION_SECRET;
const allowUnsignedSessionHeader = process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER === "true";

const AccessSessionTokenPayloadSchema = z.object({
  v: z.literal(1),
  sid: z.string().min(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});

export const AccessLoginSchema = z.object({
  sessionId: z.string().min(1),
});

export function getAccessAuthConfiguration() {
  return {
    authProvider,
    productionMode,
    demoAuthEnabled: enableDemoAuth,
    prismaDevAuthEnabled: enablePrismaDevAuth,
    sessionLoginEnabled: enableLocalSessionLogin,
    sessionSource: enablePrismaDevAuth ? "prisma-membership" : enableDemoAuth ? "demo-seed" : "disabled",
    productionReady: false,
    tokenType: "Bearer" as const,
    authorizationHeader: AUTHORIZATION_HEADER,
    legacyHeader: SESSION_HEADER,
    legacyHeaderAccepted: allowUnsignedSessionHeader,
    sessionSecretConfigured: Boolean(process.env.PHANTOMFORCE_SESSION_SECRET),
    sessionSecretUsesDefault: sessionSecret === DEFAULT_SESSION_SECRET,
    tokenTtlMs,
    loginEndpoint: enableLocalSessionLogin ? "/auth/session-login" : undefined,
    demoLoginEndpoint: enableDemoAuth ? "/auth/demo-login" : undefined,
  };
}

export function assertAccessAuthConfiguration() {
  const authConfiguration = getAccessAuthConfiguration();

  if (!productionMode) {
    if (authProvider !== "demo" && authProvider !== "prisma-dev") {
      throw new Error(`Unsupported PHANTOMFORCE_AUTH_PROVIDER "${authProvider}".`);
    }

    return authConfiguration;
  }

  if (allowUnsignedSessionHeader) {
    throw new Error("PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER cannot be enabled in production.");
  }

  if (authConfiguration.sessionSecretUsesDefault || sessionSecret.length < 32) {
    throw new Error("PHANTOMFORCE_SESSION_SECRET must be set to a strong non-default value in production.");
  }

  throw new Error(
    "Production auth is not implemented yet. Refusing to serve demo sessions in NODE_ENV=production.",
  );
}

export function listAccessSessions() {
  return accessSessions;
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

export function issueAccessSessionToken(sessionId: string) {
  if (!enableLocalSessionLogin) {
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

export function resolveAccessSession(request: FastifyRequest) {
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
      loginEndpoint: "/auth/demo-login",
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
