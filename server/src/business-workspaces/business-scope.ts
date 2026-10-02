import type { FastifyRequest } from "fastify";
import type { AccessSession } from "../access/session.js";

export const BUSINESS_HEADER = "x-phantomforce-business";
export type BusinessProfile = {
  id: string; tenantId: string; name: string; contactEmail?: string; assistantContext: string;
};
export const BUSINESS_PROFILES: readonly BusinessProfile[] = [
  { id: "phantomforce", tenantId: "phantomforce", name: "PhantomForce",
    assistantContext: "AI-assisted business operations, websites, leads and approval-gated automation. External actions require verified approval and execution receipts." },
  { id: "chicagoshots", tenantId: "client-chicagoshots", name: "ChicagoShots",
    assistantContext: "Media services: sports videography, leads and CRM, bookings, shoot calendar, client projects, editing and deliverables, invoices, gear checkout, marketing and analytics. Preserve client and athlete permissions. Public posts and outreach require approval. Commerce manufacturing and shop inventory belong to other workspaces." },
  { id: "occasionallyodd", tenantId: "occasionally-odd", name: "Occasionally Odd", contactEmail: "occasionallyoddsupport@gmail.com",
    assistantContext: "Commerce and manufacturing: seasonal made-to-order decor, custom and bulk orders, products and SKU economics, one shared inventory pool across channels, material/component reservations, printer-hour capacity, production, quality checks, packing, shipping, customers and marketing. Use actual saved order and capacity evidence; printer status is locally recorded unless telemetry is connected. Sales-channel setup does not imply authorized order or inventory sync. Warn about ship-by risks, material shortages and poor contribution per printer-hour. Horror merchandise may use third-party characters only when a documented license authorizes that use. Contact: occasionallyoddsupport@gmail.com." },
];

export function validBusinessTenant(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value);
}

/** Explicit deployment configuration extends profiles; names never grant access. */
export function businessProfiles(): readonly BusinessProfile[] {
  const raw = process.env.PHANTOMFORCE_BUSINESS_WORKSPACES;
  if (!raw) return BUSINESS_PROFILES;
  const extra = JSON.parse(raw) as unknown;
  if (!Array.isArray(extra)) throw new Error("Business workspace configuration must be an array.");
  const profiles = new Map(BUSINESS_PROFILES.map((profile) => [profile.tenantId, profile]));
  for (const item of extra) {
    if (!item || !validBusinessTenant(item.tenantId) || !validBusinessTenant(item.id)
      || typeof item.name !== "string" || typeof item.assistantContext !== "string") {
      throw new Error("Invalid explicit business workspace configuration.");
    }
    profiles.set(item.tenantId, { id: item.id, tenantId: item.tenantId, name: item.name.slice(0, 120),
      assistantContext: item.assistantContext.slice(0, 1600),
      ...(typeof item.contactEmail === "string" ? { contactEmail: item.contactEmail.slice(0, 180) } : {}) });
  }
  return [...profiles.values()];
}

export function businessProfile(tenantId: string) {
  return businessProfiles().find((profile) => profile.tenantId === tenantId)
    // Preserve owner-private records in their existing namespace; do not merge them.
    ?? (["phantomforce-owner", "phantomforce-internal"].includes(tenantId) ? { ...BUSINESS_PROFILES[0], tenantId } : undefined);
}

export function businessError(code: string, message: string, statusCode = 403) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function assertBusinessAccess(session: AccessSession, tenantId: string) {
  if (!validBusinessTenant(tenantId)) throw businessError("INVALID_BUSINESS_SCOPE", "Choose a valid business workspace.", 400);
  if (Array.isArray(session.memberships)) {
    if (session.isSuperAdmin || session.memberships.some((membership) => membership.orgId === tenantId)) return;
  } else if (session.canManageAccess || tenantId === (session.orgId || session.clientId)) {
    return;
  }
  throw businessError("BUSINESS_MEMBERSHIP_REQUIRED", "You do not have access to this business workspace.");
}

export function businessCanManage(session: AccessSession, tenantId: string) {
  assertBusinessAccess(session, tenantId);
  if (session.isSuperAdmin || session.canManageAccess) return true;
  const role = session.memberships?.find((membership) => membership.orgId === tenantId)?.role
    ?? ((session.orgId || session.clientId) === tenantId ? session.orgRole : undefined);
  return role === "owner" || role === "admin";
}

export function selectedBusinessTenant(session: AccessSession, requested?: unknown) {
  const bound = session.businessTenantId;
  if (bound) {
    if (requested !== undefined && requested !== null && requested !== "" && requested !== bound) {
      throw businessError("BUSINESS_SCOPE_MISMATCH", "This request belongs to another business. Switch businesses and retry.");
    }
    return bound;
  }
  const tenantId = requested || session.orgId || session.clientId || (session.canManageAccess ? "phantomforce" : "");
  assertBusinessAccess(session, String(tenantId));
  return String(tenantId);
}

export function authorizedBusinessWorkspaces(session: AccessSession) {
  const tenants = session.isSuperAdmin || (!Array.isArray(session.memberships) && session.canManageAccess)
    ? [...new Set([...businessProfiles().map((profile) => profile.tenantId), ...(session.memberships ?? []).map((membership) => membership.orgId), "phantomforce-owner"])]
    : session.memberships?.map((membership) => membership.orgId) ?? [session.orgId || session.clientId].filter(Boolean) as string[];
  return tenants.map((tenantId) => {
    const profile = businessProfile(tenantId);
    return { tenantId, businessId: profile?.id || null,
      name: tenantId === "phantomforce-owner" ? "PhantomForce — legacy private records" : profile?.name || session.memberships?.find((membership) => membership.orgId === tenantId)?.orgName || "Business workspace",
      legacy: tenantId === "phantomforce-owner",
      contactEmail: profile?.contactEmail || null, canManage: businessCanManage(session, tenantId),
      role: session.memberships?.find((membership) => membership.orgId === tenantId)?.role || (session.canManageAccess ? "owner" : "member") };
  });
}

const scopeKeys = ["tenant_id", "tenantId", "business_id", "businessId", "workspaceKey", "ownerScope", "orgId", "clientId"];

/** Header is a selector, never authorization. Called after authentication, before every route/paywall. */
export function bindBusinessRequest(request: Pick<FastifyRequest, "headers" | "url" | "query" | "body" | "params">, session: AccessSession): AccessSession {
  const requested = request.headers[BUSINESS_HEADER];
  if (requested === undefined) return session; // Existing native clients retain their independently guarded routes.
  if (!validBusinessTenant(requested)) throw businessError("INVALID_BUSINESS_SCOPE", "Choose a valid business workspace.", 400);
  assertBusinessAccess(session, requested);
  const path = request.url.split("?")[0];
  for (const carrier of [request.query, request.body, request.params]) {
    if (!carrier || typeof carrier !== "object" || Array.isArray(carrier)) continue;
    for (const key of scopeKeys) {
      const value = (carrier as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && value !== "" && value !== requested) {
        throw businessError("BUSINESS_SCOPE_MISMATCH", "The request scope differs from the selected business.");
      }
    }
  }
  if (path.includes("/chicagoshots/") && requested !== "client-chicagoshots") {
    throw businessError("BUSINESS_SCOPE_MISMATCH", "ChicagoShots workflows belong to the ChicagoShots business.");
  }
  // The existing owner library has one machine-wide allowlist; do not expose it to another business.
  if (path.startsWith("/phantom-ai/local-assets") && !["phantomforce", "phantomforce-owner", "phantomforce-internal"].includes(requested)) {
    throw businessError("BUSINESS_LIBRARY_NOT_CONFIGURED", "Configure a private asset library for this business.");
  }
  if (!["phantomforce", "phantomforce-owner", "phantomforce-internal"].includes(requested)
    && (/^\/phantom-ai\/(?:hermes-acp|runs|automations|approvals\/queue|media-lab\/(?:chatgpt-image|creative)|ops\/(?:context|status|send-readiness|sales-connector|agent-assist|finance|windows-media|provider|higgsfield)|agent-runs)/.test(path)
      || /^\/(?:admin|access|client-access)(?:\/|-|$)/.test(path))) {
    throw businessError("BUSINESS_INTEGRATION_NOT_CONFIGURED", "This integration requires a connection dedicated to this business.", 409);
  }
  const role = session.memberships?.find((membership) => membership.orgId === requested)?.role;
  const scoped: AccessSession = { ...session, businessTenantId: requested,
    businessProfileId: businessProfile(requested)?.id,
    orgId: requested, clientId: requested,
    ...(role ? { orgRole: role } : {}) };
  // Older routes read tenant_id directly. Pin the whole request to the validated scope.
  for (const carrier of [request.query, request.body]) {
    if (carrier && typeof carrier === "object" && !Array.isArray(carrier)) {
      (carrier as Record<string, unknown>).tenant_id = requested;
    }
  }
  return scoped;
}

export function businessAssistantContext(tenantId: string) {
  const profile = businessProfile(tenantId);
  return `Active business: ${profile?.name || "Business workspace"}; security scope: ${tenantId}. ${profile?.assistantContext || "Use only this organization's authorized business context."} Never retrieve, reuse or disclose another business's customers, credentials, files, notifications or conversation history. Do not treat a business switch as approval for an external action.`;
}

/** Dedicated Hermes process must have its own tool allowlists and credential store.
 * A different conversation ID inside the owner's process is not a filesystem boundary. */
export function businessHermesEnvironment(tenantId: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!tenantId || ["phantomforce", "phantomforce-owner", "phantomforce-internal"].includes(tenantId)) return env;
  const prefix = "PHANTOMFORCE_HERMES_" + tenantId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const url = env[prefix + "_URL"]?.trim();
  const key = env[prefix + "_KEY"]?.trim();
  if (!url || !key || url === (env.PHANTOMBOT_HERMES_API_URL || "http://127.0.0.1:8642")) {
    throw businessError("BUSINESS_AI_CONNECTION_REQUIRED", "Connect a private AI runtime for this business, or select its own API provider.", 409);
  }
  return { ...env, PHANTOMBOT_HERMES_API_URL: url, PHANTOMBOT_HERMES_API_KEY: key };
}
