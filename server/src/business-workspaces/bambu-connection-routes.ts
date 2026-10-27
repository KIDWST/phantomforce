import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccessSession } from "../access/session.js";
import { businessCanManage, selectedBusinessTenant } from "./business-scope.js";
import { assertPrintTenant } from "./print-runs.js";
import { getBambuConnectionSummary, removeBambuConnection, saveBambuConnection } from "./bambu-connections.js";

type MonitorControls = { reload(): Promise<unknown>; status(): unknown };
let monitor: MonitorControls | null = null;
export function attachBambuMonitor(value: MonitorControls | null) { monitor = value; }
export function registerBambuConnectionRoutes(app: FastifyInstance) {
  app.get("/api/business-workspaces/print-runs/printer-connections", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const tenantId = selectedBusinessTenant(session, (request.query as { tenant_id?: unknown })?.tenant_id); assertPrintTenant(tenantId);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business administrator access is required to manage printer connections." });
    return { ok: true, tenant_id: tenantId, ...await getBambuConnectionSummary(tenantId), monitor: monitor?.status() ?? { state: "disconnected", printers: [] } };
  });
  app.post("/api/business-workspaces/print-runs/printer-connections", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const { tenant_id, ...input } = (request.body ?? {}) as Record<string, unknown>, tenantId = selectedBusinessTenant(session, tenant_id); assertPrintTenant(tenantId);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business administrator access is required to manage printer connections." });
    const result = await saveBambuConnection(tenantId, input); await monitor?.reload();
    return { ok: true, tenant_id: tenantId, ...result, monitor: monitor?.status() ?? { state: "disconnected", printers: [] } };
  });
  app.post("/api/business-workspaces/print-runs/printer-connections/:id/disconnect", async (request, reply) => {
    const session = requireAccessSession(request, reply); if (!session) return reply;
    const { tenant_id, ...input } = (request.body ?? {}) as Record<string, unknown>, tenantId = selectedBusinessTenant(session, tenant_id); assertPrintTenant(tenantId);
    if (!businessCanManage(session, tenantId)) return reply.code(403).send({ ok: false, error: "Business administrator access is required to manage printer connections." });
    const parsed = z.object({ expectedRevision: z.number().int().nonnegative() }).strict().safeParse(input);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "Refresh printer settings before disconnecting." });
    const result = await removeBambuConnection(tenantId, (request.params as { id: string }).id, parsed.data.expectedRevision); await monitor?.reload();
    return { ok: true, tenant_id: tenantId, ...result, monitor: monitor?.status() ?? { state: "disconnected", printers: [] } };
  });
}
