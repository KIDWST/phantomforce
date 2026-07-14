/* PhantomForce database-auth client.
   Talks to the real multi-tenant backend (PHANTOMFORCE_AUTH_PROVIDER=
   database): email/password login, current-user + entitlements, org
   switching, the server approval queue, and the approval-gated website
   publishing pipeline. Every capability here reflects a server truth —
   when the backend doesn't advertise database auth, none of these
   surfaces render and the app behaves exactly as before. */

import { ctx, session } from "./store.js?v=phantom-live-20260714-258";

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
  const managesOrg = s.isSuperAdmin || ["owner", "admin"].includes(s.orgRole || "");
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

export async function databaseSignup({ email, password, name, workspaceName, workspaceBrief, workspaceProfile }) {
  const { ok, status, json } = await api("/auth/signup", {
    method: "POST",
    body: { email, password, name, workspaceName, workspaceBrief, workspaceProfile },
  });
  if (!ok) {
    const message = status === 409
      ? "That email already has a workspace. Sign in instead."
      : json?.error === "workspace_brief_required"
        ? "Tell PhantomForce what this workspace does before creating it."
      : String(json?.error || `Workspace creation failed (${status}).`);
    throw new Error(message);
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
    products: (site.catalog || []).map((product) => ({
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      cadence: product.cadence === "monthly" ? "monthly" : "one_time",
      desc: product.desc || "",
      visible: product.visible !== false,
    })),
    store: {
      enabled: Boolean(site.store?.enabled || site.design?.storeEnabled),
      currency: site.store?.currency || "USD",
      checkoutMode: "test",
      paymentsConnected: false,
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

/* ---------------- Asset Cloud client ----------------
   The permanent org creative library. Fetches include the bearer token, so
   <img>/<video> must load bytes as blob URLs (assetBlobUrl) — the server
   requires Authorization on every asset route. */

export const assetsAvailable = () => isDatabaseSession() && !!activeOrgId();

export async function uploadAsset(dataUrl, name, opts = {}) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, status, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets`, {
    method: "POST",
    body: {
      data_url: dataUrl,
      name,
      title: opts.title,
      source: opts.source || "upload",
      folder_id: opts.folderId,
      tags: opts.tags,
      brand: opts.brand,
      on_duplicate: opts.onDuplicate,
      version_of: opts.versionOf,
    },
  });
  if (!ok) return { ok: false, error: json?.error || `upload_failed_${status}`, detail: json };
  return { ok: true, ...json };
}

export async function listAssets(query = {}) {
  const orgId = activeOrgId();
  if (!orgId) return { assets: [], next_cursor: null };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets?${params.toString()}`);
  return ok ? { assets: json.assets || [], next_cursor: json.next_cursor || null } : { assets: [], next_cursor: null };
}

export async function fetchAsset(assetId) {
  const orgId = activeOrgId();
  if (!orgId) return null;
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}`);
  return ok ? json : null;
}

export async function patchAsset(assetId, patch) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, status, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}`, { method: "POST", body: patch });
  return ok ? { ok: true, ...json } : { ok: false, error: json?.error || `patch_failed_${status}` };
}

export async function assetLifecycle(assetId, action) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}/lifecycle`, { method: "POST", body: { action } });
  return ok ? { ok: true, ...json } : { ok: false, error: json?.error };
}

export async function deleteAsset(assetId) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  return ok ? { ok: true, ...json } : { ok: false, error: json?.error };
}

export async function restoreAssetVersion(assetId, versionNumber) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}/versions/${versionNumber}/restore`, { method: "POST", body: {} });
  return ok ? { ok: true, ...json } : { ok: false, error: json?.error };
}

export async function recordAssetUsage(assetId, surface, refId, refLabel) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false };
  const { ok } = await api(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}/usage`, { method: "POST", body: { surface, ref_id: refId, ref_label: refLabel } });
  return { ok };
}

export async function listAssetFolders() {
  const orgId = activeOrgId();
  if (!orgId) return [];
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/asset-folders`);
  return ok ? json.folders || [] : [];
}

export async function createAssetFolder(name) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/asset-folders`, { method: "POST", body: { name } });
  return ok ? { ok: true, ...json } : { ok: false, error: json?.error };
}

export async function listAssetCollections() {
  const orgId = activeOrgId();
  if (!orgId) return [];
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/asset-collections`);
  return ok ? json.collections || [] : [];
}

/* Load asset bytes as an object URL for <img>/<video> — the server needs the
   bearer header, so plain src= can't be used. Callers must revokeObjectURL. */
const blobUrlCache = new Map();
export async function assetBlobUrl(assetId, variant = "thumbnail") {
  const orgId = activeOrgId();
  if (!orgId) return null;
  const cacheKey = `${orgId}:${assetId}:${variant}`;
  if (blobUrlCache.has(cacheKey)) return blobUrlCache.get(cacheKey);
  try {
    const res = await fetch(`/orgs/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(assetId)}/${variant}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

export function clearAssetBlobCache() {
  for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
  blobUrlCache.clear();
}

/* Save a data URL straight into the library from any editor (Media Lab,
   photo editor, generated media). Returns the created asset or a clear
   unavailable state — callers treat it as best-effort. */
export async function saveToAssetCloud(dataUrl, name, opts = {}) {
  if (!assetsAvailable()) return { ok: false, error: "assets_unavailable" };
  return uploadAsset(dataUrl, name, { source: opts.source || "media-lab", tags: opts.tags, folderId: opts.folderId });
}
