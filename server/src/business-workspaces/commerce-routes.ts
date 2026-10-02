import type { FastifyInstance } from "fastify";
import { requireAccessSession } from "../access/session.js";
import { businessCanManage, selectedBusinessTenant } from "./business-scope.js";
import { commerceSummary, executeCommerceCommand, getCommerceState } from "./commerce-store.js";

/** Register after the application's authentication, business binding, and paywall hooks. */
export function registerCommerceRoutes(app: FastifyInstance) {
  app.get("/api/business-workspaces/commerce", async (request, reply) => {
    const session = requireAccessSession(request, reply);
    if (!session) return reply;
    const tenantId = selectedBusinessTenant(session, (request.query as { tenant_id?: unknown })?.tenant_id);
    const canManage = businessCanManage(session, tenantId);
    const state = await getCommerceState(tenantId);
    return { ok: true, tenant_id: tenantId, canManage, state, summary: commerceSummary(state) };
  });
  app.post("/api/business-workspaces/commerce/commands", async (request, reply) => {
    const session = requireAccessSession(request, reply);
    if (!session) return reply;
    const { tenant_id, ...input } = (request.body ?? {}) as Record<string, unknown>;
    const tenantId = selectedBusinessTenant(session, tenant_id);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business owner or administrator access is required." });
    const result = await executeCommerceCommand(tenantId, input, session.userId || session.id);
    return { ok: true, tenant_id: tenantId, canManage: true, ...result };
  });
}
