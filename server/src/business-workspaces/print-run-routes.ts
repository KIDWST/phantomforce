import type { FastifyInstance } from "fastify";
import { requireAccessSession } from "../access/session.js";
import { businessCanManage, selectedBusinessTenant } from "./business-scope.js";
import { assertPrintTenant, getPrintRunArchive, getPrintRuns, updatePrintModel, updatePrintSettings } from "./print-runs.js";

/** Authentication/business hooks must run first. The fixed tenant guard is enforced here too. */
export function registerPrintRunRoutes(app: FastifyInstance) {
  app.get("/api/business-workspaces/print-runs", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const tenantId = selectedBusinessTenant(session, (request.query as { tenant_id?: unknown })?.tenant_id); assertPrintTenant(tenantId);
    return { ...await getPrintRuns(tenantId), canManage: businessCanManage(session, tenantId) };
  });
  app.get("/api/business-workspaces/print-runs/:id/file", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const tenantId = selectedBusinessTenant(session, (request.query as { tenant_id?: unknown })?.tenant_id); assertPrintTenant(tenantId);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business owner or administrator access is required to download models." });
    const archive = await getPrintRunArchive(tenantId, (request.params as { id: string }).id);
    return reply.header("content-type", "model/3mf").header("content-disposition", `attachment; filename="${archive.name}"`).header("x-content-type-options", "nosniff").header("cache-control", "private, no-store").header("x-phantomforce-sha256", archive.sha256).send(archive.bytes);
  });
  app.post("/api/business-workspaces/print-runs/settings", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const { tenant_id, ...input } = (request.body ?? {}) as Record<string, unknown>, tenantId = selectedBusinessTenant(session, tenant_id); assertPrintTenant(tenantId);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business owner or administrator access is required." });
    return { ok: true, tenant_id: tenantId, canManage: true, settings: await updatePrintSettings(tenantId, input) };
  });
  app.post("/api/business-workspaces/print-runs/models/:hash", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const { tenant_id, ...input } = (request.body ?? {}) as Record<string, unknown>, tenantId = selectedBusinessTenant(session, tenant_id); assertPrintTenant(tenantId);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business owner or administrator access is required." });
    return { ok: true, tenant_id: tenantId, canManage: true, model: await updatePrintModel(tenantId, (request.params as { hash: string }).hash, input) };
  });
}
