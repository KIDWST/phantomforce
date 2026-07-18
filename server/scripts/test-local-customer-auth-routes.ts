import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "pf-local-customer-auth-routes-"));

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_AUTH = "true";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_STORE = join(root, "customer-auth.json");
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_EMAIL = "seed-customer@phantomforce.test";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_PASSWORD = "SeedCustomer1!Pass";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_NAME = "Seed Customer";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_BUSINESS = "Seed Workspace";

try {
  const { app } = await import("../src/index.js");
  const clientHost = { host: "app.phantomforce.online" };
  const adminHost = { host: "admin.phantomforce.online" };

  const sessions = await app.inject({ method: "GET", url: "/sessions", headers: clientHost });
  assert(sessions.statusCode === 200, "client host should read auth configuration");
  const auth = sessions.json().auth as Record<string, unknown>;
  assert(auth.localCustomerAuthEnabled === true, "client host should advertise local customer auth");
  assert(auth.customerLoginEndpoint === "/auth/customer-login", "client host should advertise the local customer login endpoint when database auth is off");
  assert(auth.customerSignupEndpoint === "/auth/customer-signup", "client host should advertise local customer signup");
  assert(auth.customerForgotUsernameEndpoint === undefined, "local customer mode should not expose username recovery");
  assert(auth.customerForgotPasswordEndpoint === "/auth/customer-forgot-password", "client host should advertise local customer password reset request");
  assert(auth.customerResetPasswordEndpoint === "/auth/customer-reset-password", "client host should advertise local customer password reset completion");

  const adminSessions = await app.inject({ method: "GET", url: "/sessions", headers: adminHost });
  const adminAuth = adminSessions.json().auth as Record<string, unknown>;
  assert(adminAuth.customerAccountActionsEnabled === false, "admin host must not advertise customer account actions");
  assert(adminAuth.customerLoginEndpoint === undefined, "admin host must not advertise customer login");

  const adminDenied = await app.inject({
    method: "POST",
    url: "/auth/customer-login",
    headers: adminHost,
    payload: { email: "seed-customer@phantomforce.test", password: "SeedCustomer1!Pass" },
  });
  assert(adminDenied.statusCode === 403, "customer login must be denied on admin.phantomforce.online");

  const seedLogin = await app.inject({
    method: "POST",
    url: "/auth/customer-login",
    headers: clientHost,
    payload: { email: "seed-customer@phantomforce.test", password: "SeedCustomer1!Pass" },
  });
  assert(seedLogin.statusCode === 200, "seeded local customer should log in through the route");
  const seedPayload = seedLogin.json() as { token?: string; authMode?: string; session?: { id?: string; canManageAccess?: boolean } };
  assert(seedPayload.authMode === "local-customer", "login response should identify local customer auth mode");
  assert(seedPayload.session?.id?.startsWith("local:"), "login response should return a local-prefixed session");
  assert(seedPayload.session?.canManageAccess === false, "local customers must not get platform admin access");
  assert(typeof seedPayload.token === "string" && seedPayload.token.length > 20, "login response should mint a bearer token");

  const authHeaders = { ...clientHost, Authorization: `Bearer ${seedPayload.token}` };
  const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders });
  assert(me.statusCode === 200 && me.json().localCustomer === true, "auth/me should resolve the signed local-customer token");
  assert(me.json().entitlements?.planKey === "starter", "seeded customer should start on the public Free/starter tier");

  const switchPlan = await app.inject({
    method: "POST",
    url: "/customer/plan-preview",
    headers: authHeaders,
    payload: { planKey: "elite" },
  });
  assert(switchPlan.statusCode === 200, "signed local customer should switch public plan tiers");
  assert(switchPlan.json().entitlements?.planKey === "elite", "plan switch route should return the new tier");
  assert(switchPlan.json().entitlements?.canWrite === true, "Elite should unlock writes for the local customer session");

  const signup = await app.inject({
    method: "POST",
    url: "/auth/customer-signup",
    headers: clientHost,
    payload: {
      email: "new-customer@phantomforce.test",
      password: "NewCustomer1!Pass",
      name: "New Customer",
      organizationName: "New Customer Studio",
    },
  });
  assert(signup.statusCode === 200, "customer signup route should create and sign in a local account");
  assert(signup.json().session?.orgId, "signup response should include the new customer workspace");

  const duplicate = await app.inject({
    method: "POST",
    url: "/auth/customer-signup",
    headers: clientHost,
    payload: { email: "new-customer@phantomforce.test", password: "NewCustomer1!Pass" },
  });
  assert(duplicate.statusCode === 409, "duplicate local customer signup should return conflict");

  const resetRequest = await app.inject({
    method: "POST",
    url: "/auth/customer-forgot-password",
    headers: clientHost,
    payload: { identifier: "seed-customer@phantomforce.test" },
  });
  assert(resetRequest.statusCode === 200, "password reset request should be accepted");
  const resetToken = resetRequest.json().preview?.resetToken as string | undefined;
  assert(typeof resetToken === "string" && resetToken.length > 20, "test-domain reset request should expose a dev preview token");

  const reset = await app.inject({
    method: "POST",
    url: "/auth/customer-reset-password",
    headers: clientHost,
    payload: { token: resetToken, password: "SeedCustomer2!Pass" },
  });
  assert(reset.statusCode === 200, "password reset completion should accept the preview token");

  const oldTokenMe = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders });
  assert(oldTokenMe.statusCode === 401, "password reset should revoke existing local customer sessions");

  const newLogin = await app.inject({
    method: "POST",
    url: "/auth/customer-login",
    headers: clientHost,
    payload: { email: "seed-customer@phantomforce.test", password: "SeedCustomer2!Pass" },
  });
  assert(newLogin.statusCode === 200, "customer should sign in with the reset password");
  const newToken = newLogin.json().token as string;
  const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: { ...clientHost, Authorization: `Bearer ${newToken}` } });
  assert(logout.statusCode === 200 && logout.json().revoked === true, "logout should revoke local customer sessions");
  const afterLogout = await app.inject({ method: "GET", url: "/auth/me", headers: { ...clientHost, Authorization: `Bearer ${newToken}` } });
  assert(afterLogout.statusCode === 401, "revoked local customer token should no longer resolve");

  await app.close();
  console.log(JSON.stringify({ ok: true, customerRoutes: true, hostScoped: true, seededLogin: true, signup: true, planSwitch: true, reset: true, logoutRevokes: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
