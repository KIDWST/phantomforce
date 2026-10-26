import {
  ADMIN_PUBLIC_HOST,
  CLIENT_PUBLIC_HOST,
  canUseSessionOnPublicHost,
  filterSessionsForPublicHost,
  publicHostFromHeaders,
} from "../src/access/public-hosts.js";
import type { AccessSession } from "../src/access/session.js";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizedBusinessWorkspaces } from "../src/business-workspaces/business-scope.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const admin: AccessSession = {
  id: "owner-admin",
  label: "PhantomForce Owner",
  role: "admin",
  canManageAccess: true,
};

const client: AccessSession = {
  id: "client-sports-demo",
  label: "Test Client",
  role: "client",
  clientId: "client-sports-demo",
  canManageAccess: false,
};

const sessions = [admin, client];

assert(
  publicHostFromHeaders({ origin: `https://${ADMIN_PUBLIC_HOST}` }) === ADMIN_PUBLIC_HOST,
  "admin host resolves from origin fallback",
);
assert(
  publicHostFromHeaders({ "x-forwarded-host": CLIENT_PUBLIC_HOST }) === CLIENT_PUBLIC_HOST,
  "client host resolves from forwarded host",
);
assert(
  publicHostFromHeaders({
    origin: `https://${CLIENT_PUBLIC_HOST}`,
    "x-forwarded-host": ADMIN_PUBLIC_HOST,
  }) === ADMIN_PUBLIC_HOST,
  "routed host wins over spoofed origin",
);
assert(
  publicHostFromHeaders({
    origin: `https://${ADMIN_PUBLIC_HOST}`,
    host: CLIENT_PUBLIC_HOST,
  }) === CLIENT_PUBLIC_HOST,
  "host wins over spoofed origin fallback",
);
assert(canUseSessionOnPublicHost(ADMIN_PUBLIC_HOST, admin), "admin can use admin host");
assert(!canUseSessionOnPublicHost(ADMIN_PUBLIC_HOST, client), "client cannot use admin host");
assert(canUseSessionOnPublicHost(CLIENT_PUBLIC_HOST, client), "client can use client host");
assert(canUseSessionOnPublicHost(CLIENT_PUBLIC_HOST, admin), "a verified owner can use the canonical app alongside customers");
assert(
  filterSessionsForPublicHost(ADMIN_PUBLIC_HOST, sessions).map((session) => session.id).join(",") === "owner-admin",
  "admin host only lists admin sessions",
);
assert(
  filterSessionsForPublicHost(CLIENT_PUBLIC_HOST, sessions).map((session) => session.id).join(",") ===
    "owner-admin,client-sports-demo",
  "the canonical app accepts both account kinds without changing their capabilities",
);
assert(filterSessionsForPublicHost("127.0.0.1", sessions).length === 2, "local dev still lists both sessions");

// Actual bearer-token and owner guards, on an injected isolated server. Demo
// identities exist only inside this test process; no database or real login is used.
const root = await mkdtemp(join(tmpdir(), "pf-public-host-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "", PHANTOMFORCE_SKIP_SERVER_DOTENV: "true",
  PHANTOMFORCE_AUTH_PROVIDER: "demo", PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
  PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER: "false", PHANTOMFORCE_ACCESS_REPOSITORY: "json-file",
  PHANTOMFORCE_BUSINESS_WORKSPACES: "",
  PHANTOMFORCE_ACCESS_DATA_DIR: root, PHANTOMFORCE_SESSION_SECRET: "public-host-fixture-signing-secret-0123456789abcdef",
});
const { issueAccessSessionToken, requireAccessSession, requireAdminAccessSession } = await import("../src/access/session.js");
const app = Fastify();
app.get("/account", async (request, reply) => {
  const resolved = requireAccessSession(request, reply);
  return resolved ? { id: resolved.id, canManageAccess: resolved.canManageAccess } : reply;
});
app.get("/owner", async (request, reply) => {
  const resolved = requireAdminAccessSession(request, reply);
  return resolved ? { id: resolved.id, canManageAccess: true } : reply;
});
app.get("/catalog", async (request, reply) => {
  const resolved = requireAccessSession(request, reply);
  return resolved ? { workspaces: authorizedBusinessWorkspaces(resolved) } : reply;
});
try {
  const ownerToken = issueAccessSessionToken("admin-jordan")?.token;
  const customerToken = issueAccessSessionToken("client-sports-demo")?.token;
  assert(ownerToken && customerToken, "isolated fixture tokens were minted");
  const ownerHeaders = { host: CLIENT_PUBLIC_HOST, authorization: `Bearer ${ownerToken}` };
  const customerHeaders = { host: CLIENT_PUBLIC_HOST, authorization: `Bearer ${customerToken}` };
  assert((await app.inject({ url: "/account", headers: ownerHeaders })).statusCode === 200, "canonical app accepts authenticated owner bearer");
  assert((await app.inject({ url: "/owner", headers: ownerHeaders })).statusCode === 200, "existing owner capability is usable on the canonical app");
  const ownerCatalog = await app.inject({ url: "/catalog", headers: ownerHeaders });
  assert(ownerCatalog.statusCode === 200 && ownerCatalog.json().workspaces.map((item: { tenantId: string }) => item.tenantId).join(",") === "phantomforce,client-chicagoshots,occasionally-odd,phantomforce-owner", "the authenticated owner receives the existing full business catalog on the canonical app");
  const customerAccount = await app.inject({ url: "/account", headers: customerHeaders });
  assert(customerAccount.statusCode === 200 && customerAccount.json().canManageAccess === false, "customer identity remains a customer on the same app");
  const customerCatalog = await app.inject({ url: "/catalog", headers: customerHeaders });
  assert(customerCatalog.statusCode === 200 && customerCatalog.json().workspaces.map((item: { tenantId: string }) => item.tenantId).join(",") === "client-sports-demo", "sharing the app host does not add owner memberships or businesses to a customer catalog");
  assert((await app.inject({ url: "/owner", headers: customerHeaders })).statusCode === 403, "customer cannot call owner API on the canonical app");
  assert((await app.inject({ url: "/owner", headers: { ...customerHeaders, "x-phantomforce-session": "admin-jordan", "x-can-manage-access": "true" } })).statusCode === 403, "client-supplied owner-looking headers do not elevate the customer");
  assert((await app.inject({ url: "/owner", headers: { host: CLIENT_PUBLIC_HOST } })).statusCode === 401, "anonymous canonical-app requests remain unauthenticated");
  assert((await app.inject({ url: "/owner", headers: { host: CLIENT_PUBLIC_HOST, authorization: "Bearer invalid-fixture-token" } })).statusCode === 401, "invalid canonical-app bearer is rejected");
  assert((await app.inject({ url: "/account", headers: { ...customerHeaders, host: ADMIN_PUBLIC_HOST } })).statusCode === 403, "legacy admin alias still refuses customer sessions");
  assert((await app.inject({ url: "/owner", headers: { ...ownerHeaders, host: ADMIN_PUBLIC_HOST } })).statusCode === 200, "legacy admin alias retains verified owner access");
} finally { await app.close(); await rm(root, { recursive: true, force: true }); }

console.log(
  JSON.stringify(
    {
      ok: true,
      adminHost: ADMIN_PUBLIC_HOST,
      clientHost: CLIENT_PUBLIC_HOST,
      adminHostSessions: filterSessionsForPublicHost(ADMIN_PUBLIC_HOST, sessions).map((session) => session.id),
      clientHostSessions: filterSessionsForPublicHost(CLIENT_PUBLIC_HOST, sessions).map((session) => session.id),
      localDevSessions: filterSessionsForPublicHost("127.0.0.1", sessions).map((session) => session.id),
    },
    null,
    2,
  ),
);
