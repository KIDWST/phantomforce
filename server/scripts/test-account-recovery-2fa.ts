/* Live API verification for the complete account lifecycle:
   create user -> recover username -> forgot/reset password -> login ->
   2FA setup/confirm -> login challenge -> 2FA verify -> disable.

   Requires a running server with PHANTOMFORCE_AUTH_PROVIDER=database and
   non-production dev previews enabled for reset-token visibility. */

import { createHmac } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:5391";
const runId = Date.now().toString(36);
const email = `recovery-${runId}@phantomforce.local`;
const username = `recovery_${runId}`;
const firstPassword = "first-password-123";
const secondPassword = "second-password-456";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 180)}` : ""}`);
  ok ? pass++ : fail++;
}

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, json };
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(value: string) {
  const clean = value.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let current = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    current = (current << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(identifier: string, password: string) {
  return api("/auth/login", { method: "POST", body: { email: identifier, password } });
}

const signup = await api("/auth/signup", {
  method: "POST",
  body: { email, username, name: "Recovery Test", organizationName: "Recovery Test Workspace", password: firstPassword },
});
check("signup creates user + starter org", signup.status === 200 && signup.json.userId && signup.json.orgId, JSON.stringify(signup.json));

const usernameRecovery = await api("/auth/forgot-username", { method: "POST", body: { email } });
check("forgot username queues recovery and dev preview returns username", usernameRecovery.status === 200 && usernameRecovery.json.preview?.username === username, JSON.stringify(usernameRecovery.json));

const forgotPassword = await api("/auth/forgot-password", { method: "POST", body: { identifier: username } });
const resetToken = forgotPassword.json.preview?.resetToken;
check("forgot password queues reset and dev preview returns reset token", forgotPassword.status === 200 && !!resetToken, JSON.stringify(forgotPassword.json));

const reset = await api("/auth/reset-password", { method: "POST", body: { token: resetToken, password: secondPassword } });
check("reset password accepts token", reset.status === 200, JSON.stringify(reset.json));

const oldLogin = await login(username, firstPassword);
check("old password no longer works", oldLogin.status === 401, JSON.stringify(oldLogin.json));

const newLogin = await login(username, secondPassword);
check("new password login works", newLogin.status === 200 && newLogin.json.token, JSON.stringify(newLogin.json));
const token = newLogin.json.token as string;

const setup2fa = await api("/auth/2fa/setup", { method: "POST", token, body: {} });
check("2FA setup returns authenticator secret", setup2fa.status === 200 && setup2fa.json.secret && setup2fa.json.otpauthUrl, JSON.stringify(setup2fa.json));
const code = totp(setup2fa.json.secret);

const confirm2fa = await api("/auth/2fa/confirm", { method: "POST", token, body: { code } });
const backupCode = confirm2fa.json.backupCodes?.[0];
check("2FA confirm enables authenticator and returns one-time backup codes", confirm2fa.status === 200 && confirm2fa.json.backupCodes?.length >= 8 && !!backupCode, JSON.stringify(confirm2fa.json));

await api("/auth/logout", { method: "POST", token, body: {} });

const challengedLogin = await login(username, secondPassword);
check("login now requires 2FA instead of returning session token", challengedLogin.status === 200 && challengedLogin.json.requires2fa && challengedLogin.json.challengeToken && !challengedLogin.json.token, JSON.stringify(challengedLogin.json));

const verify2fa = await api("/auth/2fa/verify", {
  method: "POST",
  body: { challengeToken: challengedLogin.json.challengeToken, code: totp(setup2fa.json.secret) },
});
check("2FA verify returns authenticated session token", verify2fa.status === 200 && verify2fa.json.token, JSON.stringify(verify2fa.json));

await api("/auth/logout", { method: "POST", token: verify2fa.json.token, body: {} });
const backupChallengedLogin = await login(username, secondPassword);
const verifyBackup = await api("/auth/2fa/verify", {
  method: "POST",
  body: { challengeToken: backupChallengedLogin.json.challengeToken, code: backupCode },
});
check("2FA backup code can sign in once", verifyBackup.status === 200 && verifyBackup.json.token, JSON.stringify(verifyBackup.json));

const regenerateBackup = await api("/auth/2fa/recovery-codes", {
  method: "POST",
  token: verifyBackup.json.token,
  body: { code: totp(setup2fa.json.secret) },
});
check("2FA recovery codes can be regenerated after authenticator proof", regenerateBackup.status === 200 && regenerateBackup.json.backupCodes?.length >= 8, JSON.stringify(regenerateBackup.json));

const disable2fa = await api("/auth/2fa/disable", {
  method: "POST",
  token: verifyBackup.json.token,
  body: { code: totp(setup2fa.json.secret) },
});
check("2FA disable accepts current authenticator code", disable2fa.status === 200, JSON.stringify(disable2fa.json));

await api("/auth/logout", { method: "POST", token: verifyBackup.json.token, body: {} });
const plainLoginAgain = await login(username, secondPassword);
check("login works without 2FA after disable", plainLoginAgain.status === 200 && plainLoginAgain.json.token && !plainLoginAgain.json.requires2fa, JSON.stringify(plainLoginAgain.json));

console.log(fail ? `${fail} FAILURES (${pass} passed)` : `ALL ${pass} PASS`);
process.exit(fail ? 1 : 0);
