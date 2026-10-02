import nodeAssert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyRequest } from "fastify";
import type { AccessSession } from "../src/access/session.js";
import { authorizedBusinessWorkspaces, bindBusinessRequest, businessAssistantContext, businessCanManage, businessHermesEnvironment, businessProfile } from "../src/business-workspaces/business-scope.js";
import { createBusinessRecord, listBusinessRecords, updateBusinessRecord } from "../src/business-workspaces/business-records.js";
import { getAiProviderCredential, getAiProviderCredentialStatus, saveAiProviderCredential } from "../src/phantom-ai/ai-provider-credentials.js";
import { callOpenRouterGlm52 } from "../src/phantom-ai/providers/openrouter-live-transport.js";

let checks = 0;
const assert = new Proxy(nodeAssert, { get(target, key) {
  const value = Reflect.get(target, key);
  return typeof value === "function" ? (...args: unknown[]) => { checks += 1; return value(...args); } : value;
} });

const root = await mkdtemp(join(tmpdir(), "pf-business-isolation-"));
const member: AccessSession = { id: "db:member", userId: "member", role: "client", canManageAccess: false,
  orgId: "client-chicagoshots", orgRole: "member",
  memberships: [{ orgId: "client-chicagoshots", orgName: "A name grants no authority", role: "member" }] };
function request(tenantId: string, body: unknown = {}, url = "/api/business-workspaces/records") {
  return { headers: { "x-phantomforce-business": tenantId }, body, query: {}, params: {}, url } as FastifyRequest;
}
assert.throws(() => bindBusinessRequest(request("occasionally-odd"), member), /access/);
assert.throws(() => bindBusinessRequest(request("../occasionally-odd"), member), /valid/);
assert.throws(() => bindBusinessRequest(request("client-chicagoshots", { tenant_id: "phantomforce" }), member), /differs/);
assert.equal(businessCanManage(member, "client-chicagoshots"), false);
assert.deepEqual(authorizedBusinessWorkspaces(member).map((item) => item.tenantId), ["client-chicagoshots"]);
assert.equal(bindBusinessRequest(request("client-chicagoshots"), member).businessTenantId, "client-chicagoshots");
assert.equal(bindBusinessRequest(request("client-chicagoshots"), member).orgId, "client-chicagoshots");
assert.ok(businessAssistantContext("occasionally-odd").includes("occasionallyoddsupport@gmail.com"));
assert.throws(() => businessHermesEnvironment("occasionally-odd", {}), /private AI/);
assert.equal(businessHermesEnvironment("occasionally-odd", {
  PHANTOMFORCE_HERMES_OCCASIONALLY_ODD_URL: "http://127.0.0.1:8650",
  PHANTOMFORCE_HERMES_OCCASIONALLY_ODD_KEY: "test-isolated-runtime-key",
}).PHANTOMBOT_HERMES_API_URL, "http://127.0.0.1:8650");

const scopes = ["phantomforce", "client-chicagoshots", "occasionally-odd"];
for (const scope of scopes) await createBusinessRecord(scope, { kind: scope === "phantomforce" ? "project" : scope === "client-chicagoshots" ? "shoot" : "order", title: scope + " private order" }, "owner", root);
for (const scope of scopes) {
  const rows = await listBusinessRecords(scope, root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, scope);
  assert.equal(rows[0].title, scope + " private order");
}
const otherRecord = (await listBusinessRecords("phantomforce", root))[0];
await assert.rejects(() => updateBusinessRecord("occasionally-odd", otherRecord.id, { title: "steal" }, "owner", root), /not found/);
await assert.rejects(() => createBusinessRecord("occasionally-odd", { kind: "order", title: "Unlicensed character", status: "production", metadata: { rightsStatus: "pending" } }, "owner", root), /license/);
await assert.rejects(() => createBusinessRecord("occasionally-odd", { kind: "campaign", title: "Freebie", status: "active", metadata: { isFreebie: true } }, "owner", root), /configured|approval/);
await assert.rejects(() => createBusinessRecord("client-chicagoshots", { kind: "order", title: "Wrong business workflow" }, "owner", root), /configured/);
for (const status of ["quality-check", "ready", "complete"]) {
  await assert.rejects(() => createBusinessRecord("occasionally-odd", { kind: "order", title: "Skipped license check", status, metadata: { rightsStatus: "pending" } }, "owner", root), /license/);
}
process.env.PHANTOMFORCE_BUSINESS_WORKSPACES = JSON.stringify([{ id: "occasionallyodd", tenantId: "uuid-bound-odd", name: "Explicitly mapped", assistantContext: "Decor" }]);
await assert.rejects(() => createBusinessRecord("uuid-bound-odd", { kind: "order", title: "Mapped license boundary", status: "complete" }, "owner", root), /license/);
delete process.env.PHANTOMFORCE_BUSINESS_WORKSPACES;
await createBusinessRecord("occasionally-odd", { kind: "product", title: "Original autumn decor", status: "production", metadata: { rightsStatus: "original" } }, "owner", root);
await Promise.all(Array.from({ length: 12 }, (_, index) => createBusinessRecord("phantomforce", { kind: "project", title: "Concurrent " + index }, "owner", root)));
assert.equal((await listBusinessRecords("phantomforce", root)).length, 13);
const first = (await listBusinessRecords("client-chicagoshots", root))[0];
await updateBusinessRecord("client-chicagoshots", first.id, { expectedVersion: 1, title: "Updated shoot" }, "owner", root);
await assert.rejects(() => updateBusinessRecord("client-chicagoshots", first.id, { expectedVersion: 1, title: "Stale edit" }, "owner", root), /Refresh/);
const documentPath = join(root, createHash("sha256").update("client-chicagoshots").digest("hex") + ".json");
const corrupted = JSON.parse(await readFile(documentPath, "utf8"));
corrupted.records[0].tenantId = "occasionally-odd";
await writeFile(documentPath, JSON.stringify(corrupted));
await assert.rejects(() => listBusinessRecords("client-chicagoshots", root), /review/);
await createBusinessRecord("CaseScope", { kind: "project", title: "Upper case business" }, "owner", root);
await createBusinessRecord("casescope", { kind: "project", title: "Lower case business" }, "owner", root);
assert.equal((await listBusinessRecords("CaseScope", root))[0].title, "Upper case business");
assert.equal((await listBusinessRecords("casescope", root))[0].title, "Lower case business");

const credentials = { root: join(root, "credentials"), env: { PHANTOMFORCE_SESSION_SECRET: "isolated-test-encryption-secret-over-32-characters", OPENROUTER_API_KEY: "owner-only-test-key-123456789" } };
assert.equal(businessProfile("phantomforce-internal")?.id, "phantomforce");
assert.equal(businessProfile("phantomforce-internal")?.tenantId, "phantomforce-internal");
assert.equal(businessHermesEnvironment("phantomforce-internal", credentials.env), credentials.env);
assert.equal(await getAiProviderCredential("phantomforce-internal", "openrouter_glm", credentials), credentials.env.OPENROUTER_API_KEY);
assert.equal(await getAiProviderCredential("occasionally-odd", "openrouter_glm", credentials), null);
assert.equal((await getAiProviderCredentialStatus("occasionally-odd", credentials)).openrouter_glm.configured, false);
assert.equal(await getAiProviderCredential("phantomforce", "openrouter_glm", credentials), credentials.env.OPENROUTER_API_KEY);
await saveAiProviderCredential({ ...credentials, tenantId: "occasionally-odd", providerId: "openrouter_glm", credential: "odd-only-test-key-123456789", actor: "owner" });
assert.equal(await getAiProviderCredential("occasionally-odd", "openrouter_glm", credentials), "odd-only-test-key-123456789");
assert.equal(await getAiProviderCredential("client-chicagoshots", "openrouter_glm", credentials), null);
await saveAiProviderCredential({ ...credentials, tenantId: "phantomforce-owner", providerId: "openrouter_glm", credential: "legacy-private-key-123456789", actor: "owner" });
assert.equal(await getAiProviderCredential("phantomforce-owner", "openrouter_glm", credentials), "legacy-private-key-123456789");
assert.equal(await getAiProviderCredential("phantomforce", "openrouter_glm", credentials), credentials.env.OPENROUTER_API_KEY);
let calls = 0;
const transport = await callOpenRouterGlm52({ requestId: "boundary", businessName: "Occasionally Odd", taskType: "summary", userMessage: "test", compactContext: "", sensitivityLevel: "public", approvalRequired: false, executionMode: "approval" } as any, {
  credential: null, env: { OPENROUTER_API_KEY: "owner-key", PHANTOM_LIVE_PROVIDERS_ENABLED: "true", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true" },
  fetchImpl: (async () => { calls += 1; throw new Error("Must not call owner provider"); }) as any,
});
assert.equal(calls, 0);
assert.equal(transport.provider_called, false);

Object.assign(process.env, {
  NODE_ENV: "development", PHANTOMFORCE_SERVER_LISTEN: "false", PHANTOMFORCE_SERVER_LOGGER: "false",
  PHANTOMFORCE_AUTH_PROVIDER: "demo", PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
  PHANTOMFORCE_SKIP_SERVER_DOTENV: "true", PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER: "false",
  PHANTOMFORCE_ACCESS_REPOSITORY: "json-file", DATABASE_URL: "",
  PHANTOMFORCE_BUSINESS_RECORDS_DIR: join(root, "http-records"),
  PHANTOMFORCE_AI_CREDENTIALS_DIR: join(root, "http-credentials"),
  PHANTOMFORCE_SOCIAL_DATA_DIR: join(root, "social"), PHANTOMFORCE_DATA_DIR: join(root, "data"),
  PHANTOMFORCE_CRM_PIPELINE_DIR: join(root, "crm"), PHANTOMFORCE_WORKSPACE_APPROVAL_DIR: join(root, "approvals"),
  PHANTOMFORCE_CONTENT_ASSET_DIR: join(root, "assets"), PHANTOMFORCE_FINANCE_LEDGER_DIR: join(root, "finance"),
  INSTAGRAM_ACCESS_TOKEN: "owner-instagram-token", INSTAGRAM_BUSINESS_ACCOUNT_ID: "owner-private-account",
  INSTAGRAM_HANDLE: "owner-private-handle",
});
const { app } = await import("../src/index.js");
try {
  const login = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId: "admin-jordan" } });
  assert.equal(login.statusCode, 200, login.body);
  const token = login.json().token;
  const headers = (scope: string) => ({ authorization: "Bearer " + token, "x-phantomforce-business": scope });
  const preflight = await app.inject({ method: "OPTIONS", url: "/api/business-workspaces/records", headers: {
    origin: "http://127.0.0.1:5180", "access-control-request-method": "POST",
    "access-control-request-headers": "authorization,content-type,x-phantomforce-business" } });
  assert.equal(preflight.statusCode, 204);
  assert.ok(String(preflight.headers["access-control-allow-headers"]).includes("x-phantomforce-business"));
  const catalog = await app.inject({ method: "GET", url: "/api/business-workspaces", headers: headers("phantomforce") });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.deepEqual(catalog.json().workspaces.map((item: any) => item.tenantId), [...scopes, "phantomforce-owner"]);
  assert.equal(catalog.json().workspaces.at(-1).legacy, true);
  assert.equal(catalog.json().workspaces.at(-1).businessId, "phantomforce");
  const created = await app.inject({ method: "POST", url: "/api/business-workspaces/records", headers: headers("occasionally-odd"), payload: { kind: "order", title: "Private custom wreath" } });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().record.id;
  for (const scope of scopes) {
    const result = await app.inject({ method: "GET", url: "/api/business-workspaces/records", headers: headers(scope) });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().records.length, scope === "occasionally-odd" ? 1 : 0);
  }
  const crossPatch = await app.inject({ method: "PATCH", url: "/api/business-workspaces/records/" + id, headers: headers("phantomforce"), payload: { title: "Leak" } });
  assert.equal(crossPatch.statusCode, 404);
  const mismatch = await app.inject({ method: "GET", url: "/api/business-workspaces/records?tenant_id=phantomforce", headers: headers("occasionally-odd") });
  assert.equal(mismatch.statusCode, 403);
  const csrfSelector = await app.inject({ method: "GET", url: "/api/business-workspaces/records", headers: { "x-phantomforce-business": "occasionally-odd" } });
  assert.equal(csrfSelector.statusCode, 401);
  const chicagoLeak = await app.inject({ method: "GET", url: "/phantom-ai/ops/chicagoshots/studio", headers: headers("occasionally-odd") });
  assert.equal(chicagoLeak.statusCode, 403);
  const localAssetLeak = await app.inject({ method: "GET", url: "/phantom-ai/local-assets", headers: headers("occasionally-odd") });
  assert.equal(localAssetLeak.statusCode, 403);
  const orgLeak = await app.inject({ method: "GET", url: "/orgs/client-chicagoshots/assets", headers: headers("occasionally-odd") });
  assert.equal(orgLeak.statusCode, 403);
  const social = await app.inject({ method: "GET", url: "/phantom-ai/ops/social-analytics/status", headers: headers("occasionally-odd") });
  assert.equal(social.statusCode, 200, social.body);
  assert.equal(social.json().social_analytics.anyLive, false);
  assert.ok(!social.body.includes("owner-private-account"));
  assert.ok(!social.body.includes("owner-private-handle"));
  const clientLogin = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId: "client-chicagoshots" } });
  const unauthorized = await app.inject({ method: "GET", url: "/api/business-workspaces/records", headers: { authorization: "Bearer " + clientLogin.json().token, "x-phantomforce-business": "occasionally-odd" } });
  assert.equal(unauthorized.statusCode, 403);
  console.log("PASS business workspaces: " + checks + " assertions; authenticated switching, membership/role denial, three-way records, concurrency, stale writes, corruption refusal, AI keys/context, social credentials, asset/Studio boundaries, rights and campaign policy.");
} finally {
  await app.close();
}
