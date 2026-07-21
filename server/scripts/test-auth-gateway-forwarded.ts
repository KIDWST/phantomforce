/*
 * test-auth-gateway-forwarded.ts
 *
 * Proves the Pangolin "unified single login" auth path (gateway-forwarded).
 * Pangolin authenticates the user at its gate and reverse-proxies the request
 * carrying the user's identity in a header plus a shared secret. PhantomForce
 * must trust that identity ONLY when the secret matches, and must FAIL CLOSED
 * for spoofed, missing, wrong, or unmapped identities.
 *
 * Pure unit test: no server boot, no network. Env is set before the dynamic
 * import so session.ts reads the gateway config at module-load time.
 *
 * Run: npx tsx scripts/test-auth-gateway-forwarded.ts
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const SECRET = ["pf", "gateway", "shared", "secret", "0123456789abcd"].join("-");
const ADMIN_USER = "jordan@phantomforce.online";
const FORCE_USER = "coach@theforce.com";
const SHOTS_USER = "owner@chicagoshots.com";

process.env.NODE_ENV = "test";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "gateway-forwarded";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "false";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOMFORCE_GATEWAY_SHARED_SECRET = SECRET;
process.env.PHANTOMFORCE_GATEWAY_SECRET_HEADER = "x-phantomforce-gateway";
process.env.PHANTOMFORCE_GATEWAY_USER_HEADER = "remote-user";
process.env.PHANTOMFORCE_GATEWAY_ADMIN_USERS = `${ADMIN_USER}, second-admin@phantomforce.online`;
process.env.PHANTOMFORCE_GATEWAY_CLIENT_MAP = `${FORCE_USER}=client-past-due, ${SHOTS_USER}=client-chicagoshots`;

const session = await import("../src/access/session.js");

// Mock a Fastify request — resolveAccessSession only reads request.headers.
function req(headers: Record<string, string>): any {
  return { headers };
}
const withSecret = (extra: Record<string, string>) => req({ "x-phantomforce-gateway": SECRET, ...extra });

// 1. Config validation must boot clean for a strong gateway setup.
const config = session.assertAccessAuthConfiguration();
assert(config.gatewayForwardedAuthEnabled === true, "gateway-forwarded auth reported enabled");
assert(config.gatewayConfigured === true, "gateway reported configured");
assert(config.sessionSource === "gateway-forwarded", "sessionSource is gateway-forwarded");
assert(config.productionReady === true, "configured gateway counts as production-ready auth");
assert(config.demoAuthEnabled === false, "demo auth is off under gateway-forwarded");

// 2. Fail closed: no secret header at all → no session, even with a valid user.
assert(
  session.resolveAccessSession(req({ "remote-user": ADMIN_USER })) === undefined,
  "missing shared secret is denied (anti-spoof)",
);

// 3. Fail closed: wrong secret → no session.
assert(
  session.resolveAccessSession(req({ "x-phantomforce-gateway": "wrong-secret-value", "remote-user": ADMIN_USER })) ===
    undefined,
  "wrong shared secret is denied",
);

// 4. Fail closed: valid secret but no user header → no session.
assert(session.resolveAccessSession(withSecret({})) === undefined, "valid secret but no user is denied");

// 5. Admin user (allowlist) → admin session that can manage access.
const admin = session.resolveAccessSession(withSecret({ "remote-user": ADMIN_USER }));
assert(admin !== undefined, "admin user resolves to a session");
assert(admin!.role === "admin" && admin!.canManageAccess === true, "admin user gets admin + manage rights");
assert(admin!.clientId === undefined, "admin session is not scoped to a client");
assert(admin!.secondFactorPolicy === "required", "admin session marks second factor required");

// 6. Admin match is case-insensitive (Pangolin may forward mixed case).
const adminCased = session.resolveAccessSession(withSecret({ "remote-user": "Jordan@PhantomForce.Online" }));
assert(adminCased !== undefined && adminCased!.role === "admin", "admin match is case-insensitive");

// 7. Mapped client (The Force) → client session scoped to its org, no manage.
const force = session.resolveAccessSession(withSecret({ "remote-user": FORCE_USER }));
assert(force !== undefined, "mapped client user resolves to a session");
assert(
  force!.role === "client" && force!.clientId === "client-past-due" && force!.canManageAccess === false,
  "client maps to The Force workspace with no manage rights",
);
assert(force!.secondFactorPolicy === "optional", "client second factor is optional");

// 8. Mapped client (ChicagoShots) → its own scoped org.
const shots = session.resolveAccessSession(withSecret({ "remote-user": SHOTS_USER }));
assert(
  shots !== undefined && shots!.clientId === "client-chicagoshots" && shots!.role === "client",
  "client maps to ChicagoShots workspace",
);

// 9. Fail closed: gateway-authenticated but UNMAPPED user → no default workspace.
assert(
  session.resolveAccessSession(withSecret({ "remote-user": "stranger@nowhere.com" })) === undefined,
  "authenticated-but-unmapped user is denied (no default workspace)",
);

// 10. Cross-tenant safety: a client session cannot view another client's workspace.
assert(
  session.canViewClientWorkspace(force!, "client-past-due") === true,
  "client can view its own workspace",
);
assert(
  session.canViewClientWorkspace(force!, "client-chicagoshots") === false,
  "client cannot view another client's workspace",
);
assert(
  session.canViewClientWorkspace(admin!, "client-chicagoshots") === true,
  "admin can view any workspace",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      authProvider: config.authProvider,
      sessionSource: config.sessionSource,
      gatewayConfigured: config.gatewayConfigured,
      productionReady: config.productionReady,
      adminRole: admin!.role,
      adminSecondFactorPolicy: admin!.secondFactorPolicy,
      forceClientId: force!.clientId,
      clientSecondFactorPolicy: force!.secondFactorPolicy,
      shotsClientId: shots!.clientId,
      failClosed: {
        missingSecret: true,
        wrongSecret: true,
        noUser: true,
        unmappedUser: true,
      },
      crossTenantBlocked: true,
    },
    null,
    2,
  ),
);
