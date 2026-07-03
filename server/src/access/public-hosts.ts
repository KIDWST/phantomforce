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

export function publicHostFromHeaders(headers: Record<string, unknown>) {
  const origin = firstHeader(headers.origin);

  if (origin) {
    try {
      return normalizePublicHost(new URL(origin).host);
    } catch {
      return normalizePublicHost(origin);
    }
  }

  return normalizePublicHost(
    firstHeader(headers["x-forwarded-host"]) ??
      firstHeader(headers["x-original-host"]) ??
      firstHeader(headers.host),
  );
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
