import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountErrorMessage, accountSignInResult } from "../app/js/account-errors.js";

// Exercise response handling, never a real credential store or service.
let checks = 0;
const check = (name, run) => { run(); checks++; };
for (const error of [true, false, 1, {}, { fieldErrors: { email: ["Required"] } }, "Internal Server Error", null]) {
  check("server error shapes produce actionable safe copy", () => {
    const message = accountErrorMessage(500, { error, message: "PRIVATE_DATABASE_DETAILS" });
    assert.match(message, /account service.*sign you in.*Try again/i);
    assert.doesNotMatch(message, /true|false|\[object|PRIVATE_DATABASE_DETAILS|500/);
  });
}
check("unavailable is not rejected credentials", () => assert.match(accountErrorMessage(503, { error: true }), /account service/));
check("invalid credentials retain specific copy", () => assert.equal(accountErrorMessage(401, { error: true }), "Invalid email or password."));
check("invalid 2FA retains specific copy", () => assert.equal(accountErrorMessage(401, { message: "Invalid code" }, "twoFactor"), "Invalid or expired 2FA code."));
check("validation object is not serialized", () => assert.match(accountErrorMessage(400, { error: { fieldErrors: { password: ["Required"] } } }), /Check your email or username and password/));
check("Fastify message informs only known public conditions", () => assert.match(accountErrorMessage(403, { error: true, message: "Database auth is disabled." }), /account service/));
check("nested public invitation error is useful", () => assert.match(accountErrorMessage(400, { error: { code: "invitation_expired" } }, "invitation"), /invalid, expired, or already used/));
check("throttling is actionable", () => assert.match(accountErrorMessage(429, { error: true }), /Wait a moment/));
check("network failure is useful", () => assert.match(accountErrorMessage(0, {}), /Check your connection/));

const valid = () => ({ ok: true, token: "account-response-fixture-token", session: {
  id: "db:response-fixture", label: "Fixture operator", orgId: "org-fixture", orgRole: "owner",
  canManageAccess: true, isSuperAdmin: true, memberships: [{ orgId: "org-fixture", role: "owner" }],
} });
const challenge = () => ({ ok: true, requires2fa: true, challengeToken: "account-challenge-fixture", expiresAt: "2030-01-01T00:00:00.000Z" });
check("complete session accepted", () => assert.deepEqual(accountSignInResult(valid()), valid()));
check("pending factor accepted as a challenge only", () => assert.equal(accountSignInResult(challenge()).requires2fa, true));
const malformed = [
  null, true, {}, { ok: false }, { ok: true, error: true }, { ...valid(), token: undefined },
  { ...valid(), token: "true" }, { ...valid(), token: "bad\nresponse-token" }, { ...valid(), session: null },
  { ...valid(), session: { ...valid().session, id: undefined } },
  { ...valid(), session: { ...valid().session, canManageAccess: "false" } },
  { ...valid(), session: { ...valid().session, isSuperAdmin: 1 } },
  { ...valid(), session: { ...valid().session, memberships: {} } },
  { ...valid(), session: { ...valid().session, memberships: [{ role: "owner" }] } },
  { ...valid(), requires2fa: "true" }, { ...challenge(), challengeToken: undefined },
  { ...challenge(), challengeToken: "short" }, { ...challenge(), expiresAt: "not-a-date" },
  { ...challenge(), token: "ambiguous-challenge-token" },
];
for (const payload of malformed) check("malformed success is refused", () => assert.throws(() => accountSignInResult(payload), /incomplete sign-in response/));
check("verify cannot complete with another challenge", () => assert.throws(() => accountSignInResult(challenge(), { allowChallenge: false }), /incomplete sign-in response/));

const saved = new Map(), tab = new Map();
const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
globalThis.localStorage = storage(saved); globalThis.sessionStorage = storage(tab);
globalThis.location = { hostname: "app.phantomforce.online", search: "", origin: "https://app.phantomforce.online", href: "https://app.phantomforce.online/app/index.html" };
globalThis.window = { location, dispatchEvent() {}, addEventListener() {} }; globalThis.CustomEvent = class {};
globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
const orgsSource = readFileSync(new URL("../app/js/orgs.js", import.meta.url), "utf8");
const storePath = orgsSource.match(/from "(\.\/store\.js[^\"]*)"/)[1];
const { ctx, session, isOwnerOperator } = await import(new URL(`../app/js/${storePath.slice(2)}`, import.meta.url));
const { databaseLogin, databaseVerify2fa } = await import("../app/js/orgs.js");
const response = (status, payload) => { globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload }); };
const reset = () => { session.clear(); ctx.session = null; };
const refused = async (operation, pattern) => {
  reset(); await assert.rejects(operation, pattern); assert.equal(ctx.session, null); assert.equal(session.token(), ""); checks++;
};
response(500, { error: true, message: "PRIVATE_DATABASE_DETAILS" });
await refused(() => databaseLogin("fixture@example.invalid", "fixture-password"), /account service.*sign you in/i);
response(503, { error: { internal: "PRIVATE_DATABASE_DETAILS" } });
await refused(() => databaseVerify2fa("fixture-challenge-token", "123456"), /account service.*2FA/i);
response(401, { error: true });
await refused(() => databaseLogin("fixture@example.invalid", "fixture-password"), /Invalid email or password/);
globalThis.fetch = async () => { throw new TypeError("PRIVATE_NETWORK_DIAGNOSTIC"); };
await refused(() => databaseLogin("fixture@example.invalid", "fixture-password"), /could not be reached/);
for (const payload of malformed) {
  response(200, payload);
  await refused(() => databaseLogin("fixture@example.invalid", "fixture-password"), /incomplete sign-in response/);
}
response(200, challenge()); reset();
assert.equal((await databaseLogin("fixture@example.invalid", "fixture-password")).requires2fa, true);
assert.equal(ctx.session, null); assert.equal(session.token(), ""); checks++;
await refused(() => databaseVerify2fa("fixture-challenge-token", "123456"), /incomplete sign-in response/);
response(200, valid()); reset();
assert.equal((await databaseVerify2fa("fixture-challenge-token", "123456")).sessionId, valid().session.id);
assert.equal(isOwnerOperator(), true); assert.equal(session.token(), valid().token); checks++;
response(200, { ...valid(), session: { ...valid().session, isSuperAdmin: false, canManageAccess: false, orgRole: "member" } }); reset();
await databaseLogin("fixture@example.invalid", "fixture-password");
assert.equal(isOwnerOperator(), false); assert.equal(ctx.session.role, "employee"); checks++;
reset();
console.log(`Account response handling: ${checks} checks passed (boolean/object failures, safe service errors, strict success/challenge validation and actual client session behavior).`);
