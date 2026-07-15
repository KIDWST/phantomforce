import type { AccessSession } from "./session.js";

export const ADMIN_PUBLIC_HOST = "admin.phantomforce.online";
export const CLIENT_PUBLIC_HOST = "app.phantomforce.online";

export const ADMIN_PUBLIC_URL = `https://${ADMIN_PUBLIC_HOST}`;
export const CLIENT_PUBLIC_URL = `https://${CLIENT_PUBLIC_HOST}`;

export const PUBLIC_WEB_ORIGINS = [
  ADMIN_PUBLIC_URL,
  CLIENT_PUBLIC_URL,
] as const;

export function normalizePublicHost(value: string | undefined) {
  if (!value) return "";

  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

function firstHeader(value: unknown) {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

function recognizedPublicHost(value: string | undefined) {
  const normalized = normalizePublicHost(value);
  if (normalized === ADMIN_PUBLIC_HOST || normalized === CLIENT_PUBLIC_HOST) return normalized;
  return "";
}

export function publicHostFromHeaders(headers: Record<string, unknown>) {
  const directHost = normalizePublicHost(firstHeader(headers.host));
  const forwardedHost = normalizePublicHost(
    firstHeader(headers["x-forwarded-host"]) ?? firstHeader(headers["x-original-host"]),
  );
  const trustedPublicHost = recognizedPublicHost(directHost) || recognizedPublicHost(forwardedHost);
  if (trustedPublicHost) return trustedPublicHost;

  const origin = firstHeader(headers.origin);
  if (!origin) return directHost || forwardedHost;
  try {
    return recognizedPublicHost(new URL(origin).host) || directHost || forwardedHost || normalizePublicHost(new URL(origin).host);
  } catch {
    return recognizedPublicHost(origin) || directHost || forwardedHost || normalizePublicHost(origin);
  }
}

export function publicHostScope(host: string | undefined): "admin" | "client" | "local" {
  const normalized = normalizePublicHost(host);

  if (normalized === ADMIN_PUBLIC_HOST) return "admin";
  if (normalized === CLIENT_PUBLIC_HOST) return "client";
  return "local";
}

export function canUseSessionOnPublicHost(host: string | undefined, session: AccessSession) {
  const scope = publicHostScope(host);

  if (scope === "admin") return session.canManageAccess;
  if (scope === "client") return !session.canManageAccess;
  return true;
}

export function filterSessionsForPublicHost(host: string | undefined, sessions: AccessSession[]) {
  return sessions.filter((session) => canUseSessionOnPublicHost(host, session));
}
