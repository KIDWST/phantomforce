import cors from "@fastify/cors";
import {
  ACTION_SCHEMAS,
  ActionSchema,
  FALCON_JOB_SCHEMAS,
  FalconJobSchema,
  MediaLabEffectsQuerySchema,
} from "@phantomforce/contracts";
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import {
  AccessApprovalDecisionSchema,
  AccessChangeProposalSchema,
  AccessModuleSetProposalBodySchema,
  ClientProvisionProposalSchema,
  decideAccessApproval,
  dryRunClientProvision,
  initializeAccessWorkflowState,
  listAccessActions,
  listAccessApprovals,
  listAccessAuditEvents,
  proposeAccessChange,
  proposeClientProvision,
  proposeModuleSet,
} from "./access/access-workflow.js";
import { accessRepository } from "./access/access-repository.js";
import {
  assertModuleAccess,
  assertWorkspaceAccess,
} from "./access/access-guard.js";
import { initializeAccessIdentityState } from "./access/access-identity-state.js";
import { getWorkspaceModuleView } from "./access/module-handlers.js";
import {
  AUTHORIZATION_HEADER,
  AccessLoginSchema,
  SESSION_HEADER,
  assertAccessAuthConfiguration,
  canViewClientWorkspace,
  getAccessAuthConfiguration,
  issueAccessSessionToken,
  listAccessSessions,
  requireAdminAccessSession,
  requireAccessSession,
  requireClientWorkspaceView,
  type AccessSession,
} from "./access/session.js";
import {
  ClientAccessStatusSchema,
  defaultPrivateRouteForBusiness,
  getAccessDecision,
  getClientAccess,
  initializeClientAccessState,
  listClientAccess,
  provisionClientAccess,
  type PaymentStatus,
} from "./access/client-access-state.js";
import { listPangolinDryRunPlan } from "./access/pangolin-reconciler.js";
import { checkPangolinReadOnlyStatus } from "./access/pangolin-status.js";
import { buildProductionReadinessReport } from "./access/production-readiness.js";
import { getBillingProviderStatus } from "./access/billing-provider.js";
import { createAccessStorageSnapshot } from "./access/access-storage.js";
import { actionRegistry } from "./approval/action-registry.js";
import { createFalconBroker } from "./falcon/broker.js";
import { listMediaLabEffects, mediaLabLicenseBoundary } from "./media-lab/effects-library.js";
import {
  canUsePhantomPlay,
  getPhantomPlaySnapshot,
  startPhantomPlaySession,
  togglePhantomPlayFavorite,
  updatePhantomPlayPolicy,
  updatePhantomPlaySession,
} from "./phantomplay/state.js";
import {
  createVoiceboxSpeechJob,
  getVoiceboxStatus,
  listVoiceboxProfiles,
} from "./voicebox/voicebox-client.js";
import {
  buildConnectAllSocialsPlan,
  getSocialAnalyticsSnapshot,
  listSocialProviderStatuses,
} from "./connectors/social-analytics.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5190);

const app = Fastify({
  logger: process.env.PHANTOMFORCE_SERVER_LOGGER === "false" ? false : true,
});

await app.register(cors, {
  origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/],
  credentials: true,
  allowedHeaders: ["Content-Type", AUTHORIZATION_HEADER, SESSION_HEADER],
});

const falconBroker = createFalconBroker({
  baseUrl: process.env.FALCON_BASE_URL ?? "http://127.0.0.1:8765",
});

const linkedCsvStorePath = resolve("data", "linked-client-csvs.json");

type LinkedClientCsv = {
  id: string;
  label: string;
  path: string;
  lastSyncedAt?: string;
};

function readLinkedClientCsvs(): LinkedClientCsv[] {
  try {
    if (!existsSync(linkedCsvStorePath)) return [];
    const parsed = JSON.parse(readFileSync(linkedCsvStorePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as LinkedClientCsv[]) : [];
  } catch {
    return [];
  }
}

function writeLinkedClientCsvs(records: LinkedClientCsv[]) {
  mkdirSync(dirname(linkedCsvStorePath), { recursive: true });
  writeFileSync(linkedCsvStorePath, JSON.stringify(records, null, 2));
}

function parseCsvRows(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));

  return rows.slice(1).map((values) => {
    const output: Record<string, string> = {};
    headers.forEach((header, index) => {
      output[header] = values[index] ?? "";
    });
    return output;
  });
}

function pickCsvValue(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (row[key]) return row[key].trim();
  }

  return "";
}

function normalizePaymentStatus(value: string): PaymentStatus {
  const normalized = value.trim().toLowerCase();
  if (["paid", "active", "current", "ok", "yes", "true"].includes(normalized)) return "paid";
  if (["due", "past_due", "past due", "pending"].includes(normalized)) return "due";
  return "failed";
}

async function ingestClientCsv(csv: string, source: string) {
  const rows = parseCsvRows(csv);
  const imported = [];
  const skipped = [];

  for (const row of rows) {
    const business = pickCsvValue(row, ["business", "client", "company", "name", "organization"]);
    if (!business) {
      skipped.push({ row, reason: "Missing business/client/company/name column." });
      continue;
    }

    const explicitId = pickCsvValue(row, ["id", "client_id", "clientId"]);
    const clientId =
      explicitId ||
      `client-${business
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}`;
    const modules = (pickCsvValue(row, ["modules", "module_list"]) || "Command,Tasks,Reports")
      .split(/[|;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const paymentStatus = normalizePaymentStatus(pickCsvValue(row, ["payment_status", "payment", "status"]));
    const record = await provisionClientAccess(
      {
        clientId,
        business,
        owner: pickCsvValue(row, ["owner", "contact", "client_owner"]) || "Client Owner",
        plan: pickCsvValue(row, ["plan", "package", "offer"]) || "Manual CSV client",
        paymentStatus,
        privateRoute: pickCsvValue(row, ["private_route", "route", "url"]) || defaultPrivateRouteForBusiness(business),
        modules,
      },
      `CSV update from ${source}`,
    );
    imported.push(record);
  }

  return { rows: rows.length, imported, skipped };
}

function requireMediaLabAccess(
  session: AccessSession,
  reply: FastifyReply,
  clientId: string | undefined,
) {
  const requestedClientId = clientId?.trim() || session.clientId;

  if (session.canManageAccess && !requestedClientId) {
    return {
      scope: "admin-global" as const,
      clientId: null,
    };
  }

  if (!requestedClientId) {
    reply.code(403).send({
      ok: false,
      error: "Media Lab catalog access requires an admin session or a client workspace.",
      session,
    });
    return undefined;
  }

  if (!canViewClientWorkspace(session, requestedClientId)) {
    reply.code(403).send({
      ok: false,
      error: "This session cannot view the requested Media Lab workspace.",
      session,
      clientId: requestedClientId,
    });
    return undefined;
  }

  if (session.canManageAccess) {
    return {
      scope: "admin-client" as const,
      clientId: requestedClientId,
    };
  }

  const access = assertModuleAccess(requestedClientId, "Media Lab");

  if (!access.ok) {
    reply.code(access.statusCode).send({
      ok: false,
      error: access.error,
      record: access.record,
      decision: access.decision,
    });
    return undefined;
  }

  return {
    scope: "client-module" as const,
    clientId: requestedClientId,
  };
}

try {
  assertAccessAuthConfiguration();
  await initializeClientAccessState();
  await initializeAccessIdentityState();
  await initializeAccessWorkflowState();
} catch (error) {
  app.log.error(error, "PhantomForce server startup failed while loading access state.");
  await app.close();
  process.exit(1);
}

app.get("/health", async () => {
  return {
    ok: true,
    service: "phantomforce-server",
    contracts: {
      actions: Object.keys(ACTION_SCHEMAS),
      falconJobs: Object.keys(FALCON_JOB_SCHEMAS),
    },
  };
});

app.get("/contracts/actions", async () => {
  return {
    actionTypes: Object.keys(ACTION_SCHEMAS),
    falconJobTypes: Object.keys(FALCON_JOB_SCHEMAS),
  };
});

app.get("/media-lab/effects", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const query = request.query as { clientId?: string };
  const access = requireMediaLabAccess(session, reply, query.clientId);

  if (!access) {
    return reply;
  }

  const parsed = MediaLabEffectsQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    access,
    ...(await listMediaLabEffects(parsed.data)),
  };
});

app.get("/media-lab/license-boundary", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    boundary: mediaLabLicenseBoundary,
  };
});

app.get("/voicebox/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    status: await getVoiceboxStatus(),
  };
});

app.get("/voicebox/profiles", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  try {
    return {
      ok: true,
      session,
      ...(await listVoiceboxProfiles()),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voicebox profiles are unavailable.";
    return reply.code(503).send({
      ok: false,
      error: message,
    });
  }
});

app.post("/content/create/voice", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = request.body as {
    text?: string;
    profile?: string;
    profileId?: string;
    language?: string;
    engine?: string;
    instruct?: string;
    personality?: boolean;
  };

  try {
    const generation = await createVoiceboxSpeechJob({
      text: body.text ?? "",
      profile: body.profile,
      profileId: body.profileId,
      language: body.language,
      engine: body.engine,
      instruct: body.instruct,
      personality: body.personality,
    });

    return {
      ok: true,
      session,
      generation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice generation failed.";
    return reply.code(503).send({
      ok: false,
      error: message,
    });
  }
});

app.get("/analytics/social/status", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    providers: listSocialProviderStatuses(),
  };
});

app.post("/analytics/social/oauth-all", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    ...buildConnectAllSocialsPlan(),
  };
});

app.get("/analytics/social/summary", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    snapshot: await getSocialAnalyticsSnapshot(),
  };
});

app.get("/sessions", async () => {
  const authConfiguration = getAccessAuthConfiguration();

  return {
    ok: true,
    auth: {
      ...authConfiguration,
    },
    sessions: listAccessSessions(),
  };
});

async function handleSessionLogin(request: FastifyRequest, reply: FastifyReply) {
  const authConfiguration = getAccessAuthConfiguration();

  if (!authConfiguration.sessionLoginEnabled) {
    return reply.code(403).send({
      ok: false,
      error: "Session login is disabled.",
      auth: authConfiguration,
    });
  }

  const parsed = AccessLoginSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const token = issueAccessSessionToken(parsed.data.sessionId, {
    ownerKey: parsed.data.ownerKey,
  });

  if (!token) {
    return reply.code(401).send({
      ok: false,
      error: "Invalid session credentials.",
      sessions: listAccessSessions(),
    });
  }

  return {
    ok: true,
    ...token,
  };
}

app.post("/auth/session-login", async (request, reply) => {
  return handleSessionLogin(request, reply);
});

app.post("/auth/owner-login", async (request, reply) => {
  return handleSessionLogin(request, reply);
});

app.post("/auth/demo-login", async (request, reply) => {
  const authConfiguration = getAccessAuthConfiguration();

  if (!authConfiguration.demoAuthEnabled) {
    return reply.code(403).send({
      ok: false,
      error: "Demo auth is disabled.",
      auth: authConfiguration,
    });
  }

  return handleSessionLogin(request, reply);
});

app.get("/session", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
  };
});

app.get("/readiness", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    report: await buildProductionReadinessReport(),
  };
});

app.get("/billing/status/read-only", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    status: getBillingProviderStatus(),
  };
});

app.get("/client-access", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const records = session.canManageAccess
    ? listClientAccess()
    : listClientAccess().filter((record) => record.id === session.clientId);

  return {
    ok: true,
    session,
    records,
  };
});

app.get("/client-access/:id/decision", async (request, reply) => {
  const params = request.params as { id: string };
  const session = requireClientWorkspaceView(request, reply, params.id);

  if (!session) {
    return reply;
  }

  const record = getClientAccess(params.id);

  if (!record) {
    return reply.code(404).send({
      ok: false,
      error: "Client access record not found.",
    });
  }

  return {
    ok: true,
    session,
    record,
    decision: getAccessDecision(params.id),
  };
});

app.get("/client-workspaces/:id", async (request, reply) => {
  const params = request.params as { id: string };
  const session = requireClientWorkspaceView(request, reply, params.id);

  if (!session) {
    return reply;
  }

  const access = assertWorkspaceAccess(params.id);

  if (!access.ok) {
    return reply.code(access.statusCode).send({
      ok: false,
      error: access.error,
      record: access.record,
      decision: access.decision,
    });
  }

  return {
    ok: true,
    session,
    workspace: {
      id: access.record.id,
      business: access.record.business,
      owner: access.record.owner,
      plan: access.record.plan,
      privateRoute: access.record.privateRoute,
      gateway: access.record.gateway,
      accessStatus: access.record.accessStatus,
      paymentStatus: access.record.paymentStatus,
      mode: access.decision.mode,
      modules: access.decision.modules,
    },
    decision: access.decision,
  };
});

app.get("/client-workspaces/:id/modules/:moduleKey", async (request, reply) => {
  const params = request.params as { id: string; moduleKey: string };
  const session = requireClientWorkspaceView(request, reply, params.id);

  if (!session) {
    return reply;
  }

  const access = assertModuleAccess(params.id, params.moduleKey);

  if (!access.ok) {
    return reply.code(access.statusCode).send({
      ok: false,
      error: access.error,
      record: access.record,
      decision: access.decision,
    });
  }

  return {
    ok: true,
    session,
    module: access.module,
    mode: access.decision.mode,
    moduleView: await getWorkspaceModuleView(access.record, access.decision, access.module),
    workspace: {
      id: access.record.id,
      business: access.record.business,
      accessStatus: access.record.accessStatus,
      paymentStatus: access.record.paymentStatus,
    },
  };
});

app.post("/client-access/:id/status/propose", async (request, reply) => {
  const params = request.params as { id: string };
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AccessChangeProposalSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
      allowedStatuses: ClientAccessStatusSchema.options,
    });
  }

  const result = await proposeAccessChange(
    params.id,
    parsed.data.accessStatus,
    parsed.data.reason,
    parsed.data.proposedBy,
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Client access record not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.post("/client-access/:id/modules/:moduleKey/propose", async (request, reply) => {
  const params = request.params as { id: string; moduleKey: string };
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AccessModuleSetProposalBodySchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const result = await proposeModuleSet(
    params.id,
    params.moduleKey,
    parsed.data.enabled,
    parsed.data.reason,
    parsed.data.proposedBy,
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Client access record not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.post("/client-provisioning/dry-run", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = ClientProvisionProposalSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    plan: dryRunClientProvision(parsed.data),
  };
});

app.post("/client-provisioning/propose", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = ClientProvisionProposalSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    ...(await proposeClientProvision(parsed.data)),
  };
});

app.get("/client-access-workflow", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    actions: listAccessActions(),
    approvals: listAccessApprovals(),
    auditEvents: listAccessAuditEvents(),
    repository: accessRepository.info(),
    storage: accessRepository.info().storage,
  };
});

app.post("/client-access-workflow/snapshot", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = request.body as { label?: unknown } | undefined;
  const label = typeof body?.label === "string" ? body.label : "manual";

  return {
    ok: true,
    session,
    snapshot: createAccessStorageSnapshot(label),
    storage: accessRepository.info().storage,
  };
});

app.get("/client-access/csv-links", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    links: readLinkedClientCsvs(),
  };
});

app.post("/client-access/csv-import", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = request.body as { csv?: unknown; filename?: unknown; source?: unknown } | undefined;
  const csv = typeof body?.csv === "string" ? body.csv : "";
  const source =
    typeof body?.filename === "string" && body.filename.trim()
      ? body.filename.trim()
      : typeof body?.source === "string" && body.source.trim()
        ? body.source.trim()
        : "dragged CSV";

  if (!csv.trim()) {
    return reply.code(400).send({ ok: false, error: "CSV content is required." });
  }

  const result = await ingestClientCsv(csv, source);

  return {
    ok: true,
    session,
    source,
    ...result,
    records: listClientAccess(),
  };
});

app.post("/client-access/csv-links", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = request.body as { path?: unknown; label?: unknown } | undefined;
  const path = typeof body?.path === "string" ? body.path.trim() : "";
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : "Linked client CSV";

  if (!path) {
    return reply.code(400).send({ ok: false, error: "CSV path is required." });
  }

  const links = readLinkedClientCsvs();
  const next: LinkedClientCsv = {
    id: `csv-${Buffer.from(path).toString("base64url").slice(0, 18)}`,
    label,
    path,
  };
  const updated = [next, ...links.filter((item) => item.path !== path)];
  writeLinkedClientCsvs(updated);

  return {
    ok: true,
    session,
    link: next,
    links: updated,
  };
});

app.post("/client-access/csv-links/sync", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const body = request.body as { id?: unknown } | undefined;
  const id = typeof body?.id === "string" ? body.id : "";
  const links = readLinkedClientCsvs();
  const target = links.find((item) => item.id === id) ?? links[0];

  if (!target) {
    return reply.code(400).send({ ok: false, error: "No linked CSVs have been saved." });
  }

  if (!existsSync(target.path)) {
    return reply.code(404).send({ ok: false, error: "Linked CSV was not found on this machine.", link: target });
  }

  const result = await ingestClientCsv(readFileSync(target.path, "utf8"), target.path);
  const synced = { ...target, lastSyncedAt: new Date().toISOString() };
  const updated = links.map((item) => (item.id === synced.id ? synced : item));
  writeLinkedClientCsvs(updated);

  return {
    ok: true,
    session,
    link: synced,
    links: updated,
    ...result,
    records: listClientAccess(),
  };
});

app.get("/pangolin/reconcile/dry-run", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    ...listPangolinDryRunPlan(),
  };
});

app.get("/pangolin/status/read-only", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  return {
    ok: true,
    session,
    status: await checkPangolinReadOnlyStatus(),
  };
});

app.post("/client-access-approvals/:approvalId/decision", async (request, reply) => {
  const params = request.params as { approvalId: string };
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = AccessApprovalDecisionSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const result = await decideAccessApproval(
    params.approvalId,
    parsed.data.decision,
    parsed.data.decidedBy,
    parsed.data.reason,
  );

  if (!result) {
    return reply.code(404).send({
      ok: false,
      error: "Access approval not found.",
    });
  }

  return {
    ok: true,
    ...result,
  };
});

app.post("/actions/validate", async (request, reply) => {
  const parsed = ActionSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const handler = actionRegistry[parsed.data.type];

  return {
    ok: true,
    actionType: parsed.data.type,
    policy: parsed.data.policy,
    handlerState: handler ? "registered" : "not-implemented",
  };
});

app.post("/falcon/jobs/validate", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const parsed = FalconJobSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  return {
    ok: true,
    session,
    jobType: parsed.data.type,
    requiresApproval: parsed.data.requiresApproval,
    broker: falconBroker.describe(),
  };
});

app.get("/phantomplay/snapshot", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const orgId = "phantomforce-default";
  const userId = session.id;

  return {
    ok: true,
    session,
    ...getPhantomPlaySnapshot(orgId, userId),
  };
});

app.post("/phantomplay/policy", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const orgId = "phantomforce-default";
  const body = request.body as Record<string, unknown> | undefined;

  return {
    ok: true,
    session,
    policy: updatePhantomPlayPolicy(orgId, (body ?? {}) as Parameters<typeof updatePhantomPlayPolicy>[1]),
  };
});

app.post("/phantomplay/sessions", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const orgId = "phantomforce-default";
  const userId = session.id;
  const role = session.role ?? "member";
  const body = request.body as { gameId?: unknown; hasActiveBackgroundJob?: unknown } | undefined;
  const access = canUsePhantomPlay({
    orgId,
    role,
    hasActiveBackgroundJob: body?.hasActiveBackgroundJob === true,
  });

  if (!access.ok) {
    return reply.code(403).send({ ok: false, reason: access.reason });
  }

  const playSession = startPhantomPlaySession({
    gameId: typeof body?.gameId === "string" ? body.gameId : "game-solitaire",
    orgId,
    userId,
  });

  if (!playSession) {
    return reply.code(404).send({ ok: false, error: "PhantomPlay game not found." });
  }

  return {
    ok: true,
    session,
    playSession,
  };
});

app.patch("/phantomplay/sessions/:id", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { id?: string };
  const body = request.body as { status?: "active" | "paused" | "ended"; saveState?: Record<string, unknown> } | undefined;
  const playSession = updatePhantomPlaySession(params.id ?? "", {
    status: body?.status,
    saveState: body?.saveState,
  });

  if (!playSession) {
    return reply.code(404).send({ ok: false, error: "PhantomPlay session not found." });
  }

  return {
    ok: true,
    session,
    playSession,
  };
});

app.post("/phantomplay/favorites/:gameId", async (request, reply) => {
  const session = requireAccessSession(request, reply);

  if (!session) {
    return reply;
  }

  const params = request.params as { gameId?: string };
  const userId = session.id;

  return {
    ok: true,
    session,
    favorites: togglePhantomPlayFavorite(userId, params.gameId ?? ""),
  };
});

try {
  await app.listen({ host, port });
  app.log.info(`PhantomForce server listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
