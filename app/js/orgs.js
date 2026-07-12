/* PhantomForce database-auth client.
   Talks to the real multi-tenant backend (PHANTOMFORCE_AUTH_PROVIDER=
   database): email/password login, current-user + entitlements, org
   switching, the server approval queue, and the approval-gated website
   publishing pipeline. Every capability here reflects a server truth —
   when the backend doesn't advertise database auth, none of these
   surfaces render and the app behaves exactly as before. */

import { ctx, session } from "./store.js?v=phantom-live-20260712-202";

export const isDatabaseSession = () => !!ctx.session?.database;
export const activeOrgId = () => (isDatabaseSession() ? ctx.session.orgId || null : null);
export const activeOrgRole = () => (isDatabaseSession() ? ctx.session.orgRole || null : null);
export const canManageActiveOrg = () =>
  isDatabaseSession() && (ctx.session.isSuperAdmin || ["owner", "admin"].includes(ctx.session.orgRole || ""));

function authHeaders(extra = {}) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path, { method = "GET", body } = {}) {
  const headers = authHeaders(body !== undefined ? { "Content-Type": "application/json" } : {});
  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, json };
}

let cachedAuthConfig = null;
export async function fetchAuthConfig() {
  if (cachedAuthConfig) return cachedAuthConfig;
  try {
    const { json } = await api("/sessions");
    cachedAuthConfig = json?.auth || null;
  } catch {
    cachedAuthConfig = null;
  }
  return cachedAuthConfig;
}

/* Maps the server's database session onto the local session shape the app
   already uses. Frontend role is presentation only — every real boundary
   is enforced server-side per request. */
function localSessionFromServer(payload) {
  const s = payload.session || {};
  const managesOrg = s.isSuperAdmin || ["owner", "admin", "member"].includes(s.orgRole || "");
  return {
    role: managesOrg ? "admin" : "employee",
    name: s.label || s.email || "Operator",
    label: s.label || "",
    ws: "phantomforce",
    sessionId: s.id,
    canManageAccess: !!s.canManageAccess,
    database: true,
    email: s.email || "",
    orgId: s.orgId || null,
    orgRole: s.orgRole || null,
    memberships: s.memberships || [],
    isSuperAdmin: !!s.isSuperAdmin,
    token: payload.token,
  };
}

export async function databaseLogin(email, password) {
  const { ok, status, json } = await api("/auth/login", { method: "POST", body: { email, password } });
  if (!ok) {
    throw new Error(status === 401 ? "Invalid email or password." : String(json?.error || `Login failed (${status}).`));
  }
  const local = localSessionFromServer(json);
  session.set(local);
  ctx.session = { ...local, token: undefined };
  return ctx.session;
}

export async function databaseLogout() {
  try {
    await api("/auth/logout", { method: "POST", body: {} });
  } catch { /* revocation is best-effort from the client; the server owns truth */ }
}

export async function fetchAuthMe() {
  const { ok, json } = await api("/auth/me");
  return ok ? json : null;
}

export async function switchOrg(orgId) {
  const { ok, json } = await api("/auth/switch-org", { method: "POST", body: { orgId } });
  if (!ok || !json?.session) return { ok: false, error: json?.error || "switch_failed" };
  /* refresh the local session mirror with the new active org */
  const current = ctx.session || {};
  const updated = {
    ...current,
    orgId: json.session.orgId || null,
    orgRole: json.session.orgRole || null,
    memberships: json.session.memberships || current.memberships || [],
  };
  session.set({ ...updated, token: undefined });
  ctx.session = updated;
  return { ok: true, session: updated };
}

export async function fetchEntitlementsSummary() {
  const orgId = activeOrgId();
  if (!orgId) return null;
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/entitlements`);
  return ok ? json : null;
}

/* ---------------- server approval queue (agent runs) ---------------- */

export async function fetchServerApprovals() {
  const orgId = activeOrgId();
  if (!orgId) return [];
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/runs?state=awaiting_approval`);
  return ok ? json.runs || [] : [];
}

export async function fetchOrgRuns(limit = 10) {
  const orgId = activeOrgId();
  if (!orgId) return [];
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/runs`);
  return ok ? (json.runs || []).slice(0, limit) : [];
}

export async function decideServerRun(runId, approve, reason) {
  const path = `/phantom-ai/runs/${encodeURIComponent(runId)}/${approve ? "approve" : "reject"}`;
  const { ok, json } = await api(path, { method: "POST", body: approve ? {} : { reason: reason || undefined } });
  return ok ? { ok: true, run: json.run } : { ok: false, error: json?.error || "decision_failed" };
}

export async function fetchServerRun(runId) {
  const { ok, json } = await api(`/phantom-ai/runs/${encodeURIComponent(runId)}`);
  return ok ? json.run : null;
}

/* ---------------- server publishing pipeline ---------------- */

/* Registers a build from the local site record and requests an
   approval-gated publish. Returns the run so the UI can show REAL state. */
export async function requestServerPublish(site) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const snapshot = {
    ...(site.serverSiteId ? { siteId: site.serverSiteId } : {}),
    title: site.title,
    sections: site.sections?.length ? site.sections : ["Hero", "Contact"],
    design: {
      brand: site.design?.brand || undefined,
      headline: site.design?.headline || undefined,
      subhead: site.design?.subhead || undefined,
      offer: site.design?.offer || undefined,
      cta: site.design?.cta || undefined,
      theme: site.design?.theme || undefined,
      style: site.design?.style || undefined,
    },
  };
  const build = await api(`/orgs/${encodeURIComponent(orgId)}/sites/builds`, { method: "POST", body: snapshot });
  if (!build.ok) return { ok: false, error: build.json?.error || `build_failed_${build.status}`, detail: build.json };
  if (!build.json.validated) return { ok: false, error: "build_validation_failed", buildLog: build.json.buildLog };

  const publish = await api(
    `/orgs/${encodeURIComponent(orgId)}/sites/${encodeURIComponent(build.json.site.id)}/publish-request`,
    { method: "POST", body: { buildId: build.json.build.id } },
  );
  if (!publish.ok) return { ok: false, error: publish.json?.error || `publish_request_failed_${publish.status}`, detail: publish.json };
  return {
    ok: true,
    serverSiteId: build.json.site.id,
    buildId: build.json.build.id,
    buildVersion: build.json.build.version,
    run: publish.json.run,
  };
}

export async function fetchServerSites() {
  const orgId = activeOrgId();
  if (!orgId) return [];
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/sites`);
  return ok ? json.sites || [] : [];
}
