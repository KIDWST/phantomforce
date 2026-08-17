import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function spawnProcess(command, args, env) {
  const logs = [];
  const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env }, windowsHide: true });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  return { child, logs };
}

const coreRoot = await mkdtemp(path.join(os.tmpdir(), "phantomforce-production-core-"));
const providerPort = await freePort();
const apiPort = await freePort();
const providerOrigin = `http://127.0.0.1:${providerPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const provider = spawnProcess(process.execPath, [path.join(repoRoot, "scripts", "golden-path", "http-sandbox-provider.mjs")], { PORT: String(providerPort), HOST: "127.0.0.1" });
let api = null;
let token = "";

function startApi(extraEnv = {}) {
  return spawnProcess(process.execPath, [path.join(repoRoot, "server", "dist", "index.js")], {
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    PHANTOMFORCE_AUTH_PROVIDER: "demo",
    PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
    PHANTOMFORCE_SERVER_LOGGER: "false",
    PHANTOMFORCE_PRODUCTION_CORE_DIR: coreRoot,
    PHANTOMFORCE_PRODUCTION_CORE_PROVIDER_URL: providerOrigin,
    PHANTOMFORCE_PRODUCTION_CORE_PROVIDER_TIMEOUT_MS: "300",
    PHANTOMFORCE_PRODUCTION_CORE_LEASE_MS: "500",
    CREATIVE_ENGINE_TRANSPORT: "disabled",
    HIGGSFIELD_CLI_FALLBACK_ENABLED: "false",
    ...extraEnv,
  });
}

async function request(pathname, { method = "GET", body, auth = token } = {}) {
  const response = await fetch(`${apiOrigin}${pathname}`, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function login(sessionId = "admin-jordan") {
  const { response, payload } = await request("/auth/demo-login", { method: "POST", body: { sessionId }, auth: "" });
  assert.equal(response.status, 200, `Login failed: ${JSON.stringify(payload)}`);
  assert.equal(payload?.ok, true);
  assert.ok(payload?.token);
  return payload.token;
}

let serial = 0;
async function command(action, payload, { correlationId, idempotencyKey, commandId, expectedRevision, invocationSource = "human", tenantId = "golden-path-staging", auth = token, expectedStatus = 201 } = {}) {
  serial += 1;
  const body = {
    tenant_id: tenantId,
    action,
    command_id: commandId || `${correlationId}-${action}-${serial}`,
    idempotency_key: idempotencyKey || `${correlationId}-${action}-${serial}`,
    correlation_id: correlationId,
    invocation_source: invocationSource,
    ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
    payload,
  };
  const result = await request("/api/production-core/commands", { method: "POST", body, auth });
  assert.equal(result.response.status, expectedStatus, `${action} expected ${expectedStatus}, received ${result.response.status}: ${JSON.stringify(result.payload)}`);
  return { ...result, body };
}

function data(outcome, key) {
  return outcome.payload?.result?.data?.[key];
}

async function prepareApprovedPublication({ campaignId, connectionId, correlationId, title, failureMode = "", tenantId = "golden-path-staging", auth = token }) {
  const content = data(await command("content.create", { campaignId, title, body: `${title}: failure-safe Golden Path evidence.` }, { correlationId, tenantId, auth }), "content");
  const revision = data(await command("media.attach", { contentId: content.id, name: `${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}.png`, checksum: `checksum-${correlationId}` }, { correlationId, tenantId, auth, expectedRevision: 1 }), "revision");
  const approval = data(await command("approval.request", { contentId: content.id, revisionId: revision.id }, { correlationId, tenantId, auth }), "approval");
  await command("approval.decide", { approvalId: approval.id, decision: "approved" }, { correlationId, tenantId, auth });
  const publicationOutcome = await command("publication.request", { contentId: content.id, revisionId: revision.id, providerConnectionId: connectionId, ...(failureMode ? { failureMode } : {}) }, { correlationId, tenantId, auth });
  return { content, revision, approval, publication: data(publicationOutcome, "publication"), job: data(publicationOutcome, "job"), publicationOutcome };
}

const checks = {};
const traces = {};

try {
  await waitFor(`${providerOrigin}/health`);
  api = startApi();
  await waitFor(`${apiOrigin}/health`);
  const appBoot = await fetch(`${apiOrigin}/app/`);
  assert.equal(appBoot.status, 200);
  checks.app_boots_clean = true;

  token = await login();
  checks.owner_authenticates = true;

  const correlationId = `cor-gp001-${Date.now()}`;
  const connectionOutcome = await command("provider.connect", {}, { correlationId, idempotencyKey: `${correlationId}-connect` });
  const connection = data(connectionOutcome, "connection");
  assert.equal(connection.environment, "sandbox");
  assert.equal(connection.platformStatus, "operational");
  assert.equal(connection.connectionStatus, "authorized");

  const leadCommandId = `${correlationId}-lead-command`;
  const leadKey = `${correlationId}-lead-key`;
  const leadOutcome = await command("lead.create", { name: "Sarah Pearson", company: "Pearson Studio", source: "Golden Path intake" }, { correlationId, commandId: leadCommandId, idempotencyKey: leadKey });
  const lead = data(leadOutcome, "lead");
  const repeatedLead = await command("lead.create", { name: "Duplicate must not persist" }, { correlationId, commandId: leadCommandId, idempotencyKey: leadKey, expectedStatus: 200 });
  assert.equal(repeatedLead.payload.repeated, true);
  assert.equal(repeatedLead.payload.result.entityId, lead.id);
  checks.lead_persists = true;
  checks.browser_repeat_idempotent = true;
  traces.GP014 = { correlationId, commandId: leadCommandId, idempotencyKey: leadKey, repeatedEntityId: lead.id };

  const conversionOutcome = await command("lead.convert", { leadId: lead.id }, { correlationId });
  const client = data(conversionOutcome, "client");
  assert.equal(data(conversionOutcome, "lead").clientId, client.id);
  checks.lead_converts = true;
  checks.canonical_client_id = true;

  const campaignOutcome = await command("campaign.create", { clientId: client.id, name: "Measured launch", objective: "Prove the complete business transaction." }, { correlationId });
  const campaign = data(campaignOutcome, "campaign");
  assert.equal(campaign.clientId, client.id);
  checks.campaign_persists = true;

  const contentOutcome = await command("content.create", { campaignId: campaign.id, title: "Golden Path launch", body: "A revision-specific, approval-gated launch." }, { correlationId });
  const content = data(contentOutcome, "content");
  const firstRevision = data(contentOutcome, "revision");
  const mediaOutcome = await command("media.attach", { contentId: content.id, name: "launch-hero.png", storageKey: "sandbox/assets/launch-hero.png", checksum: "sha256-golden-path-media" }, { correlationId, expectedRevision: 1 });
  const approvedRevision = data(mediaOutcome, "revision");
  assert.equal(approvedRevision.version, 2);
  assert.equal(data(mediaOutcome, "content").clientId, client.id);
  checks.content_and_media_persist = true;

  const approvalRequest = await command("approval.request", { contentId: content.id, revisionId: approvedRevision.id }, { correlationId });
  const approval = data(approvalRequest, "approval");
  assert.equal(approval.revisionHash, approvedRevision.hash);
  const approvalDecision = await command("approval.decide", { approvalId: approval.id, decision: "approved" }, { correlationId });
  assert.equal(data(approvalDecision, "approval").status, "approved");
  checks.approval_binds_revision_hash = true;

  const publicationKey = `${correlationId}-publication-key`;
  const publicationCommand = `${correlationId}-publication-command`;
  const publicationOutcome = await command("publication.request", { contentId: content.id, revisionId: approvedRevision.id, providerConnectionId: connection.id }, { correlationId, idempotencyKey: publicationKey, commandId: publicationCommand });
  const publication = data(publicationOutcome, "publication");
  const job = data(publicationOutcome, "job");
  assert.equal(publication.revisionId, approvedRevision.id);
  assert.equal(job.publicationId, publication.id);
  const duplicatePublication = await command("publication.request", { contentId: content.id, revisionId: approvedRevision.id, providerConnectionId: connection.id }, { correlationId, idempotencyKey: publicationKey, commandId: publicationCommand, expectedStatus: 200 });
  assert.equal(duplicatePublication.payload.result.entityId, publication.id);
  checks.publish_creates_leased_job = true;
  checks.duplicate_publish_prevented = true;
  traces.GP013 = { correlationId, commandId: publicationCommand, idempotencyKey: publicationKey, repeatedPublicationId: publication.id };

  const runOutcome = await command("job.run", { jobId: job.id, workerId: "golden-path-worker" }, { correlationId, invocationSource: "system" });
  const completedJob = data(runOutcome, "job");
  const published = data(runOutcome, "publication");
  const providerResult = data(runOutcome, "providerResult");
  const analytics = data(runOutcome, "analytics");
  assert.equal(completedJob.state, "succeeded");
  assert.equal(published.status, "published");
  assert.ok(providerResult.providerPublicationId.startsWith("sandbox-post-"));
  assert.equal(analytics.publicationId, publication.id);
  assert.equal(analytics.clientId, client.id);
  checks.provider_sandbox_http_called = true;
  checks.provider_response_persisted = true;
  checks.publication_lineage_complete = true;
  checks.analytics_attributed = true;

  const recommendationOutcome = await command("phantom.recommend", { publicationId: publication.id, invocation: "What measured follow-up should happen next?" }, { correlationId, invocationSource: "phantom" });
  const recommendation = data(recommendationOutcome, "recommendation");
  const phantomAction = data(recommendationOutcome, "phantomAction");
  assert.equal(recommendation.analyticsId, analytics.id);
  assert.equal(phantomAction.requestedCommand, "phantom.recommend");
  const followUpOutcome = await command("followup.create", { recommendationId: recommendation.id }, { correlationId, invocationSource: "phantom" });
  assert.equal(data(followUpOutcome, "followUp").clientId, client.id);
  checks.phantom_uses_typed_command = true;

  const revisedOutcome = await command("content.revise", { contentId: content.id, body: "Revision three must not inherit revision two approval." }, { correlationId, expectedRevision: 2 });
  const unapprovedRevision = data(revisedOutcome, "revision");
  const blockedRevision = await command("publication.request", { contentId: content.id, revisionId: unapprovedRevision.id, providerConnectionId: connection.id }, { correlationId, expectedStatus: 409 });
  assert.equal(blockedRevision.payload.error.code, "approved_revision_required");
  checks.unapproved_revision_blocked = true;

  const graphResult = await request(`/api/production-core/graph?tenant_id=golden-path-staging`);
  assert.equal(graphResult.response.status, 200);
  assert.equal(graphResult.payload.tenantId, "golden-path-staging");
  assert.equal(graphResult.payload.graph.clients[0].id, client.id);
  assert.equal(graphResult.payload.graph.analytics[0].providerPublicationId, providerResult.providerPublicationId);
  checks.correct_org_loads = true;
  checks.persisted_object_graph = true;

  const phantomContext = await request(`/api/production-core/phantom/context?tenant_id=golden-path-staging`);
  assert.equal(phantomContext.payload.commandTransport, "typed-production-core-command");
  assert.equal(phantomContext.payload.context.clients[0].id, client.id);
  checks.phantom_reads_canonical_graph = true;

  const diagnosis = await request(`/api/production-core/admin/diagnose?tenant_id=golden-path-staging&correlation_id=${encodeURIComponent(correlationId)}`);
  assert.equal(diagnosis.response.status, 200);
  assert.ok(diagnosis.payload.timeline.some((item) => item.type === "ProviderAcceptedPublication"));
  assert.ok(diagnosis.payload.timeline.some((item) => item.kind === "audit"));
  checks.events_and_audit_emitted = true;
  checks.correlation_end_to_end = true;
  checks.admin_diagnoses_without_database = true;
  traces.GP001 = { correlationId, clientId: client.id, campaignId: campaign.id, contentId: content.id, approvedRevisionId: approvedRevision.id, publicationId: publication.id, jobId: job.id, providerPublicationId: providerResult.providerPublicationId, analyticsId: analytics.id, recommendationId: recommendation.id };

  const retryCorrelation = `cor-gp003-${Date.now()}`;
  const retryContent = data(await command("content.create", { campaignId: campaign.id, title: "Rate-limit recovery", body: "Retry without duplicate effects." }, { correlationId: retryCorrelation }), "content");
  const retryRevision = data(await command("media.attach", { contentId: retryContent.id, name: "retry.png", checksum: "retry-checksum" }, { correlationId: retryCorrelation, expectedRevision: 1 }), "revision");
  const retryApproval = data(await command("approval.request", { contentId: retryContent.id, revisionId: retryRevision.id }, { correlationId: retryCorrelation }), "approval");
  await command("approval.decide", { approvalId: retryApproval.id, decision: "approved" }, { correlationId: retryCorrelation });
  const retryPublicationOutcome = await command("publication.request", { contentId: retryContent.id, revisionId: retryRevision.id, providerConnectionId: connection.id, failureMode: "rate_limit_once" }, { correlationId: retryCorrelation });
  const retryJob = data(retryPublicationOutcome, "job");
  const firstRetryRun = await command("job.run", { jobId: retryJob.id, workerId: "retry-worker" }, { correlationId: retryCorrelation, invocationSource: "system" });
  assert.equal(data(firstRetryRun, "job").state, "retrying");
  assert.equal(data(firstRetryRun, "error").code, "RATE_LIMITED");
  await command("job.retry", { jobId: retryJob.id }, { correlationId: retryCorrelation });
  const secondRetryRun = await command("job.run", { jobId: retryJob.id, workerId: "retry-worker" }, { correlationId: retryCorrelation, invocationSource: "system" });
  assert.equal(data(secondRetryRun, "job").state, "succeeded");
  checks.retry_recovers = true;
  traces.GP003 = { correlationId: retryCorrelation, jobId: retryJob.id, attempts: data(secondRetryRun, "job").attempt };

  const failureCorrelation = `cor-gp006-${Date.now()}`;
  const failureContent = data(await command("content.create", { campaignId: campaign.id, title: "Rejected media", body: "Permanent failure must be actionable." }, { correlationId: failureCorrelation }), "content");
  const failureRevision = data(await command("media.attach", { contentId: failureContent.id, name: "rejected.png", checksum: "rejected-checksum" }, { correlationId: failureCorrelation, expectedRevision: 1 }), "revision");
  const failureApproval = data(await command("approval.request", { contentId: failureContent.id, revisionId: failureRevision.id }, { correlationId: failureCorrelation }), "approval");
  await command("approval.decide", { approvalId: failureApproval.id, decision: "approved" }, { correlationId: failureCorrelation });
  const failurePublication = await command("publication.request", { contentId: failureContent.id, revisionId: failureRevision.id, providerConnectionId: connection.id, failureMode: "invalid_media" }, { correlationId: failureCorrelation });
  const failureJob = data(failurePublication, "job");
  const failureRun = await command("job.run", { jobId: failureJob.id, workerId: "failure-worker" }, { correlationId: failureCorrelation, invocationSource: "system" });
  assert.equal(data(failureRun, "job").state, "failed");
  assert.equal(data(failureRun, "error").code, "INVALID_MEDIA");
  assert.ok(data(failureRun, "error").remediation);
  const failureDiagnosis = await request(`/api/production-core/admin/diagnose?tenant_id=golden-path-staging&correlation_id=${encodeURIComponent(failureCorrelation)}`);
  assert.equal(failureDiagnosis.payload.actionableFailures[0].errorCode, "INVALID_MEDIA");
  checks.permanent_failure_actionable = true;
  traces.GP006 = { correlationId: failureCorrelation, jobId: failureJob.id, errorCode: "INVALID_MEDIA", remediation: failureDiagnosis.payload.actionableFailures[0].remediation };

  const authExpiredCorrelation = `cor-gp002-${Date.now()}`;
  const authExpiredConnection = data(await command("provider.connect", {}, { correlationId: authExpiredCorrelation }), "connection");
  const authExpiredFixture = await prepareApprovedPublication({ campaignId: campaign.id, connectionId: authExpiredConnection.id, correlationId: authExpiredCorrelation, title: "Expired authorization", failureMode: "auth_expired" });
  const authExpiredRun = await command("job.run", { jobId: authExpiredFixture.job.id, workerId: "auth-expired-worker" }, { correlationId: authExpiredCorrelation, invocationSource: "system" });
  assert.equal(data(authExpiredRun, "job").state, "failed");
  assert.equal(data(authExpiredRun, "error").code, "AUTH_EXPIRED");
  const authExpiredGraph = await request("/api/production-core/graph?tenant_id=golden-path-staging");
  assert.equal(authExpiredGraph.payload.providerConnections.find((item) => item.id === authExpiredConnection.id).connectionStatus, "expired");
  checks.gp002_provider_token_expired = true;
  traces.GP002 = { correlationId: authExpiredCorrelation, jobId: authExpiredFixture.job.id, connectionId: authExpiredConnection.id, errorCode: "AUTH_EXPIRED" };

  const timeoutCorrelation = `cor-gp004-${Date.now()}`;
  const timeoutConnection = data(await command("provider.connect", {}, { correlationId: timeoutCorrelation }), "connection");
  const timeoutFixture = await prepareApprovedPublication({ campaignId: campaign.id, connectionId: timeoutConnection.id, correlationId: timeoutCorrelation, title: "Timeout recovery", failureMode: "timeout_once" });
  const timeoutFirst = await command("job.run", { jobId: timeoutFixture.job.id, workerId: "timeout-worker" }, { correlationId: timeoutCorrelation, invocationSource: "system" });
  assert.equal(data(timeoutFirst, "job").state, "retrying");
  assert.equal(data(timeoutFirst, "error").code, "TEMPORARY_FAILURE");
  await command("job.retry", { jobId: timeoutFixture.job.id }, { correlationId: timeoutCorrelation });
  await sleep(800);
  const timeoutSecond = await command("job.run", { jobId: timeoutFixture.job.id, workerId: "timeout-worker" }, { correlationId: timeoutCorrelation, invocationSource: "system" });
  assert.equal(data(timeoutSecond, "job").state, "succeeded");
  checks.gp004_provider_timeout = true;
  traces.GP004 = { correlationId: timeoutCorrelation, jobId: timeoutFixture.job.id, attempts: data(timeoutSecond, "job").attempt };

  const asyncFailureCorrelation = `cor-gp005-${Date.now()}`;
  const asyncFailureConnection = data(await command("provider.connect", {}, { correlationId: asyncFailureCorrelation }), "connection");
  const asyncFailureFixture = await prepareApprovedPublication({ campaignId: campaign.id, connectionId: asyncFailureConnection.id, correlationId: asyncFailureCorrelation, title: "Accepted then failed", failureMode: "async_processing_failure" });
  const asyncFailureRun = await command("job.run", { jobId: asyncFailureFixture.job.id, workerId: "async-failure-worker" }, { correlationId: asyncFailureCorrelation, invocationSource: "system" });
  assert.equal(data(asyncFailureRun, "job").state, "failed");
  assert.equal(data(asyncFailureRun, "error").code, "PROCESSING_FAILED");
  assert.equal(data(asyncFailureRun, "error").stage, "analytics");
  assert.ok(data(asyncFailureRun, "providerResult").providerPublicationId);
  assert.equal(data(asyncFailureRun, "publication").analyticsId, null);
  checks.gp005_provider_async_failure = true;
  traces.GP005 = { correlationId: asyncFailureCorrelation, jobId: asyncFailureFixture.job.id, providerPublicationId: data(asyncFailureRun, "providerResult").providerPublicationId, errorCode: "PROCESSING_FAILED" };

  const analyticsCorrelation = `cor-gp015-${Date.now()}`;
  const analyticsConnection = data(await command("provider.connect", {}, { correlationId: analyticsCorrelation }), "connection");
  const analyticsFixture = await prepareApprovedPublication({ campaignId: campaign.id, connectionId: analyticsConnection.id, correlationId: analyticsCorrelation, title: "Analytics recovery", failureMode: "analytics_unavailable_once" });
  const analyticsFirst = await command("job.run", { jobId: analyticsFixture.job.id, workerId: "analytics-worker" }, { correlationId: analyticsCorrelation, invocationSource: "system" });
  assert.equal(data(analyticsFirst, "job").state, "retrying");
  assert.equal(data(analyticsFirst, "publication").status, "accepted");
  assert.ok(data(analyticsFirst, "providerResult").providerPublicationId);
  await command("job.retry", { jobId: analyticsFixture.job.id }, { correlationId: analyticsCorrelation });
  const analyticsSecond = await command("job.run", { jobId: analyticsFixture.job.id, workerId: "analytics-worker" }, { correlationId: analyticsCorrelation, invocationSource: "system" });
  assert.equal(data(analyticsSecond, "job").state, "succeeded");
  assert.equal(data(analyticsSecond, "providerResult").id, data(analyticsFirst, "providerResult").id);
  checks.gp015_analytics_unavailable = true;
  traces.GP015 = { correlationId: analyticsCorrelation, jobId: analyticsFixture.job.id, providerResultId: data(analyticsSecond, "providerResult").id, attempts: data(analyticsSecond, "job").attempt };

  const refreshCorrelation = `cor-gp018-${Date.now()}`;
  const refreshConnection = data(await command("provider.connect", {}, { correlationId: refreshCorrelation }), "connection");
  const refreshFailure = await command("provider.refresh", { providerConnectionId: refreshConnection.id, failureMode: "refresh_auth_expired" }, { correlationId: refreshCorrelation, expectedStatus: 409 });
  assert.equal(data(refreshFailure, "connection").connectionStatus, "expired");
  assert.equal(data(refreshFailure, "error").code, "AUTH_EXPIRED");
  assert.equal(data(refreshFailure, "incident").status, "open");
  checks.gp018_token_refresh_failure = true;
  traces.GP018 = { correlationId: refreshCorrelation, connectionId: refreshConnection.id, incidentId: data(refreshFailure, "incident").id };

  const webhookCorrelation = `cor-gp016-${Date.now()}`;
  const webhookBody = { tenant_id: "golden-path-staging", provider_id: "phantomforce-http-sandbox", webhook_id: `${webhookCorrelation}-webhook`, provider_publication_id: providerResult.providerPublicationId, sequence: 5, event_type: "publication.succeeded", correlation_id: webhookCorrelation, payload: { status: "published" } };
  const webhookFirst = await request("/api/production-core/provider/webhooks", { method: "POST", body: webhookBody });
  assert.equal(webhookFirst.response.status, 202);
  assert.equal(webhookFirst.payload.webhook.applied, true);
  const webhookDuplicate = await request("/api/production-core/provider/webhooks", { method: "POST", body: webhookBody });
  assert.equal(webhookDuplicate.response.status, 200);
  assert.equal(webhookDuplicate.payload.repeated, true);
  const webhookOutOfOrder = await request("/api/production-core/provider/webhooks", { method: "POST", body: { ...webhookBody, webhook_id: `${webhookCorrelation}-older`, sequence: 4, event_type: "publication.failed" } });
  assert.equal(webhookOutOfOrder.response.status, 202);
  assert.equal(webhookOutOfOrder.payload.webhook.applied, false);
  assert.equal(webhookOutOfOrder.payload.webhook.ignoredReason, "out_of_order");
  assert.equal(webhookOutOfOrder.payload.publication.status, "published");
  checks.gp016_duplicate_webhook = true;
  checks.gp017_out_of_order_webhook = true;
  traces.GP016 = { correlationId: webhookCorrelation, webhookId: webhookBody.webhook_id, repeated: true };
  traces.GP017 = { correlationId: webhookCorrelation, webhookId: webhookOutOfOrder.payload.webhook.webhookId, ignoredReason: "out_of_order" };

  const archivedCorrelation = `cor-gp009-${Date.now()}`;
  const archivedLead = data(await command("lead.create", { name: "Archived Client", company: "Archived Client LLC", source: "Failure suite" }, { correlationId: archivedCorrelation }), "lead");
  const archivedClient = data(await command("lead.convert", { leadId: archivedLead.id }, { correlationId: archivedCorrelation }), "client");
  const archivedCampaign = data(await command("campaign.create", { clientId: archivedClient.id, name: "Archived campaign", objective: "Prove archival blocks execution." }, { correlationId: archivedCorrelation }), "campaign");
  const archivedContent = data(await command("content.create", { campaignId: archivedCampaign.id, title: "Archive boundary", body: "Must not publish after archival." }, { correlationId: archivedCorrelation }), "content");
  const archivedRevision = data(await command("media.attach", { contentId: archivedContent.id, name: "archive.png", checksum: "archive-checksum" }, { correlationId: archivedCorrelation, expectedRevision: 1 }), "revision");
  const archivedApproval = data(await command("approval.request", { contentId: archivedContent.id, revisionId: archivedRevision.id }, { correlationId: archivedCorrelation }), "approval");
  await command("approval.decide", { approvalId: archivedApproval.id, decision: "approved" }, { correlationId: archivedCorrelation });
  const archivedConnection = data(await command("provider.connect", {}, { correlationId: archivedCorrelation }), "connection");
  await command("client.archive", { clientId: archivedClient.id }, { correlationId: archivedCorrelation });
  const archivedPublish = await command("publication.request", { contentId: archivedContent.id, revisionId: archivedRevision.id, providerConnectionId: archivedConnection.id }, { correlationId: archivedCorrelation, expectedStatus: 409 });
  assert.equal(archivedPublish.payload.error.code, "client_not_active");
  checks.gp009_client_archived = true;
  traces.GP009 = { correlationId: archivedCorrelation, clientId: archivedClient.id, blockedCode: "client_not_active" };

  const suspendedCorrelation = `cor-gp019-${Date.now()}`;
  const suspendedConnection = data(await command("provider.connect", {}, { correlationId: suspendedCorrelation }), "connection");
  const suspendedFixture = await prepareApprovedPublication({ campaignId: campaign.id, connectionId: suspendedConnection.id, correlationId: suspendedCorrelation, title: "Suspended organization" });
  await command("organization.suspend", {}, { correlationId: suspendedCorrelation });
  const suspendedRun = await command("job.run", { jobId: suspendedFixture.job.id, workerId: "suspended-worker" }, { correlationId: suspendedCorrelation, invocationSource: "system" });
  assert.equal(data(suspendedRun, "job").state, "failed");
  assert.equal(data(suspendedRun, "error").code, "ORGANIZATION_SUSPENDED");
  assert.equal(data(suspendedRun, "incident").status, "open");
  await command("organization.resume", {}, { correlationId: suspendedCorrelation });
  checks.gp019_organization_suspended = true;
  traces.GP019 = { correlationId: suspendedCorrelation, jobId: suspendedFixture.job.id, incidentId: data(suspendedRun, "incident").id };

  const crashCorrelation = `cor-gp010-${Date.now()}`;
  const crashConnection = data(await command("provider.connect", {}, { correlationId: crashCorrelation }), "connection");
  const crashFixture = await prepareApprovedPublication({ campaignId: campaign.id, connectionId: crashConnection.id, correlationId: crashCorrelation, title: "Worker crash recovery", failureMode: "worker_crash_once" });
  const interruptedRun = command("job.run", { jobId: crashFixture.job.id, workerId: "crashed-worker" }, { correlationId: crashCorrelation, invocationSource: "system" }).then(() => ({ completed: true })).catch((error) => ({ completed: false, error }));
  let runningObserved = false;
  for (let attempt = 0; attempt < 10 && !runningObserved; attempt += 1) {
    await sleep(25);
    const runningGraph = await request("/api/production-core/graph?tenant_id=golden-path-staging");
    runningObserved = runningGraph.payload?.recentJobs?.find((item) => item.id === crashFixture.job.id)?.state === "running";
  }
  assert.equal(runningObserved, true);
  await stop(api.child);
  const interruptedResult = await interruptedRun;
  assert.equal(interruptedResult.completed, false);
  await sleep(650);
  api = startApi();
  await waitFor(`${apiOrigin}/health`);
  token = await login();
  const recoveredRun = await command("job.run", { jobId: crashFixture.job.id, workerId: "replacement-worker" }, { correlationId: crashCorrelation, invocationSource: "system" });
  assert.equal(data(recoveredRun, "job").state, "succeeded");
  assert.equal(data(recoveredRun, "job").attempt, 2);
  checks.gp010_worker_crash = true;
  checks.gp020_deploy_during_active_job = true;
  traces.GP010 = { correlationId: crashCorrelation, jobId: crashFixture.job.id, resumedAttempt: 2 };
  traces.GP020 = { correlationId: crashCorrelation, replacementProcess: true, providerPublicationId: data(recoveredRun, "providerResult").providerPublicationId };

  const queueCorrelation = `cor-gp011-${Date.now()}`;
  const queueConnection = data(await command("provider.connect", {}, { correlationId: queueCorrelation }), "connection");
  const queueContent = data(await command("content.create", { campaignId: campaign.id, title: "Queue boundary", body: "Queue outage must be atomic." }, { correlationId: queueCorrelation }), "content");
  const queueRevision = data(await command("media.attach", { contentId: queueContent.id, name: "queue.png", checksum: "queue-checksum" }, { correlationId: queueCorrelation, expectedRevision: 1 }), "revision");
  const queueApproval = data(await command("approval.request", { contentId: queueContent.id, revisionId: queueRevision.id }, { correlationId: queueCorrelation }), "approval");
  await command("approval.decide", { approvalId: queueApproval.id, decision: "approved" }, { correlationId: queueCorrelation });
  const queueCountBefore = (await request("/api/production-core/graph?tenant_id=golden-path-staging")).payload.counts.publications;
  await stop(api.child);
  api = startApi({ PHANTOMFORCE_PRODUCTION_CORE_QUEUE_STATE: "unavailable" });
  await waitFor(`${apiOrigin}/health`);
  token = await login();
  const unavailableQueue = await command("publication.request", { contentId: queueContent.id, revisionId: queueRevision.id, providerConnectionId: queueConnection.id }, { correlationId: queueCorrelation, expectedStatus: 503 });
  assert.equal(unavailableQueue.payload.error.code, "queue_unavailable");
  assert.equal((await request("/api/production-core/graph?tenant_id=golden-path-staging")).payload.counts.publications, queueCountBefore);
  checks.gp011_queue_unavailable = true;
  traces.GP011 = { correlationId: queueCorrelation, publicationCountUnchanged: true };

  const transactionCorrelation = `cor-gp012-${Date.now()}`;
  const leadCountBefore = (await request("/api/production-core/graph?tenant_id=golden-path-staging")).payload.counts.leads;
  await stop(api.child);
  api = startApi({ PHANTOMFORCE_PRODUCTION_CORE_FORCE_WRITE_FAILURE: "true" });
  await waitFor(`${apiOrigin}/health`);
  token = await login();
  const failedTransaction = await command("lead.create", { name: "Must Roll Back", company: "No Partial State" }, { correlationId: transactionCorrelation, expectedStatus: 503 });
  assert.equal(failedTransaction.payload.error.code, "transaction_unavailable");
  assert.equal((await request("/api/production-core/graph?tenant_id=golden-path-staging")).payload.counts.leads, leadCountBefore);
  await stop(api.child);
  api = startApi();
  await waitFor(`${apiOrigin}/health`);
  token = await login();
  assert.equal((await request("/api/production-core/graph?tenant_id=golden-path-staging")).payload.counts.leads, leadCountBefore);
  checks.gp012_transaction_failure = true;
  traces.GP012 = { correlationId: transactionCorrelation, atomicRollback: true };

  const clientToken = await login("client-sports-demo");
  const permissionCorrelation = `cor-gp007-${Date.now()}`;
  const permissionTenant = "client-sports-demo";
  const permissionConnection = data(await command("provider.connect", {}, { correlationId: permissionCorrelation, tenantId: permissionTenant }), "connection");
  const permissionLead = data(await command("lead.create", { name: "Permission Boundary", company: "Permission Boundary Co", source: "Failure suite" }, { correlationId: permissionCorrelation, tenantId: permissionTenant }), "lead");
  const permissionClient = data(await command("lead.convert", { leadId: permissionLead.id }, { correlationId: permissionCorrelation, tenantId: permissionTenant }), "client");
  const permissionCampaign = data(await command("campaign.create", { clientId: permissionClient.id, name: "Permission boundary", objective: "Prove backend rechecks permissions." }, { correlationId: permissionCorrelation, tenantId: permissionTenant }), "campaign");
  const permissionContent = data(await command("content.create", { campaignId: permissionCampaign.id, title: "Permission boundary", body: "Approval and publish must recheck." }, { correlationId: permissionCorrelation, tenantId: permissionTenant }), "content");
  const permissionRevision = data(await command("media.attach", { contentId: permissionContent.id, name: "permission.png", checksum: "permission-checksum" }, { correlationId: permissionCorrelation, tenantId: permissionTenant, expectedRevision: 1 }), "revision");
  const permissionApproval = data(await command("approval.request", { contentId: permissionContent.id, revisionId: permissionRevision.id }, { correlationId: permissionCorrelation, tenantId: permissionTenant }), "approval");
  const lostBeforeApproval = await command("approval.decide", { approvalId: permissionApproval.id, decision: "approved" }, { correlationId: permissionCorrelation, tenantId: permissionTenant, auth: clientToken, expectedStatus: 403 });
  assert.equal(lostBeforeApproval.payload.error, "read_only_plan");
  await command("approval.decide", { approvalId: permissionApproval.id, decision: "approved" }, { correlationId: permissionCorrelation, tenantId: permissionTenant });
  const lostBeforePublish = await command("publication.request", { contentId: permissionContent.id, revisionId: permissionRevision.id, providerConnectionId: permissionConnection.id }, { correlationId: permissionCorrelation, tenantId: permissionTenant, auth: clientToken, expectedStatus: 403 });
  assert.equal(lostBeforePublish.payload.error, "read_only_plan");
  checks.gp007_permission_lost_before_approval = true;
  checks.gp008_permission_lost_before_publish = true;
  traces.GP007 = { correlationId: permissionCorrelation, approvalId: permissionApproval.id, backendDenied: true };
  traces.GP008 = { correlationId: permissionCorrelation, contentId: permissionContent.id, backendDenied: true };
  const crossOrg = await request("/api/production-core/graph?tenant_id=golden-path-staging", { auth: clientToken });
  assert.equal(crossOrg.response.status, 403);
  assert.equal(crossOrg.payload.error.code, "TENANT_MEMBERSHIP_REQUIRED");
  const deniedPolicy = await command("approval.decide", { approvalId: "none", decision: "approved" }, { correlationId: "cor-policy-denied", tenantId: "client-sports-demo", auth: clientToken, expectedStatus: 403 });
  assert.equal(deniedPolicy.payload.error, "read_only_plan");
  checks.cross_org_denied = true;
  checks.backend_policy_enforced = true;

  await stop(api.child);
  api = startApi();
  await waitFor(`${apiOrigin}/health`);
  token = await login();
  const afterRestart = await request(`/api/production-core/graph?tenant_id=golden-path-staging`);
  assert.equal(afterRestart.response.status, 200);
  assert.ok(afterRestart.payload.graph.publications.some((item) => item.id === publication.id && item.status === "published"));
  assert.ok(afterRestart.payload.graph.followUps.some((item) => item.recommendationId === recommendation.id));
  checks.process_restart_persistence = true;

  const providerState = await fetch(`${providerOrigin}/state`).then((response) => response.json());
  assert.ok(providerState.publicationCount >= 2);
  checks.actual_provider_transport = true;

  const required = [
    "app_boots_clean", "owner_authenticates", "correct_org_loads", "lead_persists", "lead_converts", "canonical_client_id", "campaign_persists", "content_and_media_persist", "approval_binds_revision_hash", "publish_creates_leased_job", "provider_sandbox_http_called", "provider_response_persisted", "retry_recovers", "permanent_failure_actionable", "publication_lineage_complete", "analytics_attributed", "phantom_reads_canonical_graph", "phantom_uses_typed_command", "events_and_audit_emitted", "correlation_end_to_end", "admin_diagnoses_without_database", "cross_org_denied", "process_restart_persistence",
    "gp002_provider_token_expired", "gp004_provider_timeout", "gp005_provider_async_failure", "gp007_permission_lost_before_approval", "gp008_permission_lost_before_publish", "gp009_client_archived", "gp010_worker_crash", "gp011_queue_unavailable", "gp012_transaction_failure", "gp015_analytics_unavailable", "gp016_duplicate_webhook", "gp017_out_of_order_webhook", "gp018_token_refresh_failure", "gp019_organization_suspended", "gp020_deploy_during_active_job",
  ];
  for (const check of required) assert.equal(checks[check], true, `Required Golden Path check failed: ${check}`);
  const runDir = path.join(repoRoot, "tmp", "golden-path", new Date().toISOString().replace(/[:.]/gu, "-"));
  await mkdir(runDir, { recursive: true });
  const report = { ok: true, gate: "PHANTOMFORCE_PRODUCTION_CORE", outcome: "STAGING_CORE_PASS", checkedAt: new Date().toISOString(), tenantId: "golden-path-staging", truth: { persistence: "real", provider: "sandbox" }, checks, traces, providerState, coreRoot: "temporary-isolated-store" };
  await writeFile(path.join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, report: path.join(runDir, "report.json") }, null, 2));
} catch (error) {
  const diagnostics = { api: api?.logs.slice(-30), provider: provider.logs.slice(-30) };
  console.error(error?.stack || String(error));
  console.error(JSON.stringify(diagnostics, null, 2));
  process.exitCode = 1;
} finally {
  await stop(api?.child);
  await stop(provider.child);
  await rm(coreRoot, { recursive: true, force: true });
}
