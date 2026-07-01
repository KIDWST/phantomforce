import {
  ADMIN_PUBLIC_HOST,
  CLIENT_PUBLIC_HOST,
  canUseSessionOnPublicHost,
  filterSessionsForPublicHost,
  publicHostFromHeaders,
} from "../src/access/public-hosts.js";
import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const admin: AccessSession = {
  id: "admin-jordan",
  label: "Jordan (admin)",
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
  "admin host resolves from origin",
);
assert(
  publicHostFromHeaders({ "x-forwarded-host": CLIENT_PUBLIC_HOST }) === CLIENT_PUBLIC_HOST,
  "client host resolves from forwarded host",
);
assert(canUseSessionOnPublicHost(ADMIN_PUBLIC_HOST, admin), "admin can use admin host");
assert(!canUseSessionOnPublicHost(ADMIN_PUBLIC_HOST, client), "client cannot use admin host");
assert(canUseSessionOnPublicHost(CLIENT_PUBLIC_HOST, client), "client can use client host");
assert(!canUseSessionOnPublicHost(CLIENT_PUBLIC_HOST, admin), "admin session is not exposed on client host");
assert(
  filterSessionsForPublicHost(ADMIN_PUBLIC_HOST, sessions).map((session) => session.id).join(",") === "admin-jordan",
  "admin host only lists admin sessions",
);
assert(
  filterSessionsForPublicHost(CLIENT_PUBLIC_HOST, sessions).map((session) => session.id).join(",") ===
    "client-sports-demo",
  "client host only lists client sessions",
);
assert(filterSessionsForPublicHost("127.0.0.1", sessions).length === 2, "local dev still lists both sessions");

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
