/* PhantomForce database-auth client.
   Talks to the real multi-tenant backend (PHANTOMFORCE_AUTH_PROVIDER=
   database): email/password login, current-user + entitlements, org
   switching, the server approval queue, and the approval-gated website
   publishing pipeline. Every capability here reflects a server truth —
   when the backend doesn't advertise database auth, none of these
   surfaces render and the app behaves exactly as before. */

import { ctx, session } from "./store.js?v=phantom-live-20260722-27";

export const isDatabaseSession = () => !!ctx.session?.database;
export const isCustomerOrgSession = () => !!(ctx.session?.database || ctx.session?.localCustomer);
export const activeOrgId = () => (isCustomerOrgSession() ? ctx.session.orgId || null : null);
export const activeOrgRole = () => (isCustomerOrgSession() ? ctx.session.orgRole || null : null);
export const canManageActiveOrg = () =>
  isCustomerOrgSession() && (ctx.session.isSuperAdmin || ["owner", "admin"].includes(ctx.session.orgRole || ""));

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
  const localCustomer = payload.authMode === "local-customer" || String(s.id || "").startsWith("local:");
  const managesOrg = s.isSuperAdmin || ["owner", "admin"].includes(s.orgRole || "");
  return {
    role: managesOrg ? "admin" : "employee",
    name: s.label || s.email || "Operator",
    label: s.label || "",
    ws: "phantomforce",
    sessionId: s.id,
    canManageAccess: !!s.canManageAccess,
    database: !localCustomer,
    localCustomer,
    email: s.email || "",
    username: s.username || "",
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
  if (json?.requires2fa) {
    return { requires2fa: true, challengeToken: json.challengeToken, expiresAt: json.expiresAt, user: json.user };
  }
  const local = localSessionFromServer(json);
  session.set(local);
  ctx.session = { ...local, token: undefined };
  return ctx.session;
}

export async function databaseVerify2fa(challengeToken, code) {
  const { ok, status, json } = await api("/auth/2fa/verify", { method: "POST", body: { challengeToken, code } });
  if (!ok) throw new Error(status === 401 ? "Invalid or expired 2FA code." : String(json?.error || `2FA failed (${status}).`));
  const local = localSessionFromServer(json);
  session.set(local);
  ctx.session = { ...local, token: undefined };
  return ctx.session;
}

export async function databaseSignup(payload) {
  const config = await fetchAuthConfig();
  const localCustomer = !config?.databaseAuthEnabled && config?.customerRegisterEndpoint;
  const endpoint = localCustomer || "/auth/signup";
  const body = localCustomer
    ? { email: payload.email, password: payload.password, name: payload.name, businessName: payload.organizationName }
    : payload;
  const { ok, status, json } = await api(endpoint, { method: "POST", body });
  if (!ok) throw new Error(String(json?.error || `Signup failed (${status}).`));
  return json;
}

export async function databaseForgotUsername(email) {
  const { ok, status, json } = await api("/auth/forgot-username", { method: "POST", body: { email } });
  if (!ok) throw new Error(String(json?.error || `Username recovery failed (${status}).`));
  return json;
}

export async function databaseForgotPassword(identifier) {
  const config = await fetchAuthConfig();
  const localCustomer = !config?.databaseAuthEnabled && config?.customerPasswordResetRequestEndpoint;
  const endpoint = localCustomer || "/auth/forgot-password";
  const body = localCustomer ? { email: identifier } : { identifier };
  const { ok, status, json } = await api(endpoint, { method: "POST", body });
  if (!ok) throw new Error(String(json?.error || `Password reset request failed (${status}).`));
  if (localCustomer && json?.resetToken) return { ...json, preview: { resetToken: json.resetToken } };
  return json;
}

export async function databaseResetPassword(token, password) {
  const config = await fetchAuthConfig();
  const localCustomer = !config?.databaseAuthEnabled && config?.customerPasswordResetCompleteEndpoint;
  const endpoint = localCustomer || "/auth/reset-password";
  const { ok, status, json } = await api(endpoint, { method: "POST", body: { token, password } });
  if (!ok) throw new Error(String(json?.error || `Password reset failed (${status}).`));
  return json;
}

export async function databaseAcceptInvitation(token, payload = {}) {
  const { ok, status, json } = await api("/auth/invitations/accept", {
    method: "POST",
    body: {
      token,
      name: String(payload.name || "").trim() || undefined,
      password: String(payload.password || "") || undefined,
    },
  });
  if (!ok) {
    const message = status === 400 && /expired|invalid|accepted/i.test(String(json?.error || ""))
      ? "This invitation link is invalid, expired, or already used. Ask the workspace owner for a new invitation."
      : String(json?.error || `Invitation acceptance failed (${status}).`);
    throw new Error(message);
  }
  return json;
}

export async function databaseStart2faSetup() {
  const { ok, status, json } = await api("/auth/2fa/setup", { method: "POST", body: {} });
  if (!ok) throw new Error(String(json?.error || `2FA setup failed (${status}).`));
  return json;
}

export async function databaseConfirm2fa(code) {
  const { ok, status, json } = await api("/auth/2fa/confirm", { method: "POST", body: { code } });
  if (!ok) throw new Error(String(json?.error || `2FA confirmation failed (${status}).`));
  return json;
}

export async function databaseRegenerate2faBackupCodes(code) {
  const { ok, status, json } = await api("/auth/2fa/recovery-codes", { method: "POST", body: { code } });
  if (!ok) throw new Error(String(json?.error || `Recovery code regeneration failed (${status}).`));
  return json;
}

export async function databaseDisable2fa(code) {
  const { ok, status, json } = await api("/auth/2fa/disable", { method: "POST", body: { code } });
  if (!ok) throw new Error(String(json?.error || `2FA disable failed (${status}).`));
  return json;
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

export async function fetchCustomerPlanPreview() {
  const { ok, json } = await api("/customer/plan-preview");
  return ok ? json : null;
}

export async function switchCustomerPlan(planKey) {
  /* The local-customer control is a deliberate plan simulator. Real database
     organizations must use verified Stripe Checkout; never self-assign a paid
     tier by calling the entitlement route. */
  const endpoint = ctx.session?.localCustomer ? "/customer/plan-preview" : null;
  if (!endpoint) return { ok: false, status: 409, error: "plan_change_requires_billing", available: [] };
  const { ok, status, json } = await api(endpoint, { method: "POST", body: { planKey } });
  return ok
    ? { ok: true, ...json }
    : { ok: false, status, error: json?.error || "plan_switch_failed", available: json?.available || [] };
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
  if (ctx.session?.localCustomer) return fetchCustomerPlanPreview();
  const orgId = activeOrgId();
  if (!orgId) return null;
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/entitlements`);
  return ok ? json : null;
}

export async function fetchStripeBillingSummary() {
  const orgId = activeOrgId();
  if (!orgId || !canManageActiveOrg()) return null;
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/billing/stripe`);
  return ok ? json?.billing || null : null;
}

export async function createStripeCheckout(planKey, interval = "month") {
  const orgId = activeOrgId();
  if (!orgId || !canManageActiveOrg()) return { ok: false, error: "owner_or_admin_required" };
  const { ok, status, json } = await api(`/orgs/${encodeURIComponent(orgId)}/billing/stripe/checkout-session`, {
    method: "POST",
    body: { planKey, interval },
  });
  return ok
    ? { ok: true, checkoutUrl: json?.checkoutUrl, sessionId: json?.sessionId }
    : { ok: false, status, error: json?.error || "stripe_checkout_failed", message: json?.message || "Checkout could not start." };
}

export async function createStripeBillingPortal() {
  const orgId = activeOrgId();
  if (!orgId || !canManageActiveOrg()) return { ok: false, error: "owner_or_admin_required" };
  const { ok, status, json } = await api(`/orgs/${encodeURIComponent(orgId)}/billing/stripe/portal`, { method: "POST", body: {} });
  return ok
    ? { ok: true, portalUrl: json?.portalUrl }
    : { ok: false, status, error: json?.error || "stripe_portal_failed", message: json?.message || "Billing portal could not start." };
}

export async function fetchOrgCrm() {
  const orgId = activeOrgId();
  if (!orgId) return null;
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/crm`);
  return ok ? json : null;
}

export async function fetchOrgBrainPackage() {
  const orgId = activeOrgId();
  if (!orgId) return null;
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/brain-package`);
  return ok ? json : null;
}

export async function saveOrgCrmSettings(settings) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/crm/settings`, { method: "POST", body: settings });
  return ok ? json : { ok: false, error: json?.error || "crm_settings_failed" };
}

export async function createOrgCrmContact(contact) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/crm/contacts`, { method: "POST", body: contact });
  return ok ? json : { ok: false, error: json?.error || "crm_contact_create_failed" };
}

export async function pullOrgCrmContacts(payload) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/crm/pull`, { method: "POST", body: payload });
  return ok ? json : { ...json, ok: false, error: json?.message || json?.error || "crm_pull_failed" };
}

export async function updateOrgCrmContact(contactId, patch) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/crm/contacts/${encodeURIComponent(contactId)}`, { method: "PATCH", body: patch });
  return ok ? json : { ok: false, error: json?.error || "crm_contact_update_failed" };
}

export async function deleteOrgCrmContact(contactId) {
  const orgId = activeOrgId();
  if (!orgId) return { ok: false, error: "no_active_org" };
  const { ok, json } = await api(`/orgs/${encodeURIComponent(orgId)}/crm/contacts/${encodeURIComponent(contactId)}`, { method: "DELETE" });
  return ok ? json : { ok: false, error: json?.error || "crm_contact_delete_failed" };
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
    /* template/section copy travels with the build so the published page
       carries the real content, not just section names */
    copy: site.copy && typeof site.copy === "object"
      ? Object.fromEntries(Object.entries(site.copy)
          .filter(([key, value]) => typeof value === "string" && value.trim())
          .slice(0, 12)
          .map(([key, value]) => [String(key).slice(0, 60), String(value).slice(0, 4000)]))
      : undefined,
    products: (site.catalog || []).map((product) => ({
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      cadence: ["monthly", "yearly"].includes(product.cadence) ? product.cadence : "one_time",
      type: product.type === "digital" ? "digital" : "physical",
      delivery_url: product.type === "digital" ? String(product.delivery_url || "").slice(0, 600) : "",
      delivery_note: product.type === "digital" ? String(product.delivery_note || "").slice(0, 500) : "",
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

/* ---------------- local asset library ----------------
   Read-only desktop asset lane for editor-time assets such as the local
   Motionarray folder. This is intentionally separate from permanent org Asset
   Cloud storage: listing and previewing local assets must not upload or meter
   the whole folder. */

export async function localAssetStatus() {
  try {
    const { ok, json } = await api("/phantom-ai/local-assets/status");
    return ok ? json : { ok: false, count: 0 };
  } catch {
    return { ok: false, count: 0 };
  }
}

export async function listLocalAssets(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  try {
    const { ok, json } = await api(`/phantom-ai/local-assets?${params.toString()}`);
    return ok ? json : { ok: false, assets: [], count: 0 };
  } catch {
    return { ok: false, assets: [], count: 0 };
  }
}

export async function refreshLocalAssets() {
  try {
    const { ok, json } = await api("/phantom-ai/local-assets/refresh", { method: "POST", body: {} });
    return ok ? json : { ok: false };
  } catch {
    return { ok: false };
  }
}

const localAssetBlobCache = new Map();
export async function localAssetBlobUrl(assetId) {
  const key = String(assetId || "");
  if (!key) return null;
  if (localAssetBlobCache.has(key)) return localAssetBlobCache.get(key);
  try {
    const res = await fetch(`/phantom-ai/local-assets/${encodeURIComponent(key)}/file`, { headers: authHeaders() });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    localAssetBlobCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

export function clearLocalAssetBlobCache() {
  for (const url of localAssetBlobCache.values()) URL.revokeObjectURL(url);
  localAssetBlobCache.clear();
}
