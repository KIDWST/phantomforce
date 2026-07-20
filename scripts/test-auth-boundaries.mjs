import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const index = read("../app/index.html");
const main = read("../app/js/main.js");
const orgs = read("../app/js/orgs.js");
const store = read("../app/js/store.js");
const server = read("../server/src/index.ts");
const publicHosts = read("../server/src/access/public-hosts.ts");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");

assert.match(store, /export const CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u, "The customer app host must be explicit in the browser session layer.");
assert.match(store, /export const isClientPublicHost = \(\) => location\.hostname === CLIENT_PUBLIC_HOST/u, "The browser must detect the customer app host.");
assert.match(store, /export const isLocalDevHost = \(\) => LOCAL_DEV_HOSTS\.has\(location\.hostname\)/u, "Demo session shortcuts must be local-dev only.");
assert.match(store, /const allowLocalSessionShortcut = isLocalDevHost\(\)/u, "Session query shortcuts must be guarded by local-dev host detection.");
assert.match(store, /if \(saved\?\.database && !token\) \{\s*session\.clear\(\);\s*return null;\s*\}/u, "Saved database sessions must not restore after the token is gone.");
assert.match(store, /isClientPublicHost\(\) && \(\(!saved\.database && !saved\.localCustomer\) \|\| saved\.canManageAccess \|\| saved\.isSuperAdmin\)/u, "The customer app must reject local/admin/super-admin session mirrors (database or local-customer accounts are the only accepted kinds).");
assert.match(store, /if \(auth\?\.databaseAuthEnabled && !auth\?\.ownerProductionAuthEnabled\) \{\s*return databaseOwnerLogin\(ownerKeyOrEmail, password\);\s*\}/u, "The admin owner form must use database login when database auth is the configured live lane.");
assert.match(store, /fetch\("\/auth\/login", \{[\s\S]*body: JSON\.stringify\(\{ email, password \}\)[\s\S]*if \(!s\.canManageAccess\) \{\s*session\.clear\(\);/u, "Database-backed admin login must use the server-owned login route and refuse accounts without admin access.");
assert.match(store, /if \(payload\?\.requires2fa\) \{\s*return \{\s*requires2fa: true,\s*challengeToken: payload\.challengeToken/u, "Owner login must return the live 2FA challenge instead of hiding it behind an error.");

assert.match(main, /if \(isClientPublicHost\(\)\) \{\s*renderCustomerAuthLoading\(card\);\s*maybeUpgradeGateToDatabaseLogin\(card, \{ customerApp: true, required: true \}\);\s*return;\s*\}/u, "app.phantomforce.online must render required real-account auth instead of role buttons.");
assert.match(main, /if \(isLiveAdminHost\(\)\) \{[\s\S]*data-owner-login[\s\S]*ownerLogin\(email, password\)[\s\S]*maybeUpgradeGateToDatabaseLogin\(card, \{ internalAdmin: true \}\);[\s\S]*return;\s*\}\s*if \(isClientPublicHost\(\)/u, "admin.phantomforce.online must render the internal-admin login and return before the customer app panel can mount.");
assert.match(main, /if \(nextSession\?\.requires2fa\) \{\s*renderOwnerTwoFactorGate\(card, nextSession\.challengeToken\);\s*return;/u, "The owner gate must visibly switch to 2FA after the password is accepted.");
assert.match(main, /function renderOwnerTwoFactorGate\(card, challengeToken\)[\s\S]*data-owner-2fa[\s\S]*databaseVerify2fa\(challengeToken, code\)[\s\S]*!nextSession\?\.canManageAccess && !nextSession\?\.isSuperAdmin/u, "The owner 2FA form must verify the challenge and retain the admin-only boundary.");
assert.match(main, /const \{ customerApp = false, internalAdmin = false, required = false \} = options;/u, "The shared account renderer must have an explicit internal-admin mode.");
assert.match(main, /if \(internalAdmin && !\["signin", "2fa"\]\.includes\(state\.mode\)\) state\.mode = "signin";/u, "Internal admin auth must be forced back to sign-in/2FA if a signup or recovery mode is requested.");
assert.match(main, /\$\{internalAdmin \|\| state\.mode === "invite" \? "" : `<div class="auth-tabs auth-tabs-primary">/u, "Internal admin auth must not render public account choices.");
assert.match(main, /\$\{tab\("signin", "Sign in"\)\}\$\{tab\("signup", "Create account"\)\}/u, "Customer auth must keep only Sign in and Create account as primary choices.");
assert.match(main, /data-auth-mode="forgot-user">Forgot username\?<\/button><button type="button" data-auth-mode="forgot-pass">Forgot password\?/u, "Recovery actions must be contextual links below sign in, not five competing primary tabs.");
assert.match(main, /state\.mode === "2fa" \? "Use another account" : "Back to sign in"/u, "An expired or rejected 2FA challenge must always have an escape back to sign in.");
assert.match(main, /if \(state\.busy\) return;[\s\S]*const data = new FormData\(form\);[\s\S]*form\.setAttribute\("aria-busy", "true"\)[\s\S]*control\.disabled = true/u, "Account forms must capture values, block duplicate submissions, and expose their busy state.");
assert.match(main, /invite_token[\s\S]*databaseAcceptInvitation\(state\.inviteToken/u, "Invitation links must open a real one-time workspace acceptance flow.");
assert.match(main, /Sign-in is temporarily unavailable\. Try again in a moment\./u, "Customer outages must use calm user-facing recovery copy instead of backend instructions.");
assert.doesNotMatch(main, /The account system is not reachable\. Start the backend/u, "Customer auth must not expose backend-start instructions.");
assert.doesNotMatch(main.match(/if \(isLiveAdminHost\(\)\) \{([\s\S]*?)\n  \}\n\n  if \(isClientPublicHost\(\)/u)?.[1] || "", /customerApp: true|data-auth-mode="signup"|Forgot password|Create account/u, "Admin login must not mount customer create-account/password-reset controls.");
assert.match(main, /if \(isLocalDevHost\(\)\) \{\s*try \{/u, "Demo login must remain local-development only.");
assert.match(main, /function renderCustomerAuthBlocked\(card, message = "Customer account login is not enabled on this backend\."\)/u, "Customer app must block when database auth is disabled.");
assert.match(main, /Platform admin accounts must use admin\.phantomforce\.online/u, "Customer app must direct platform admin accounts away from app.phantomforce.online.");
assert.match(main, /try \{\s*if \(databaseSession\) await databaseLogout\(\);\s*\} finally \{\s*session\.clear\(\);/u, "Logout must always clear local access even if database revocation fails.");
assert.match(main, /url\.searchParams\.delete\("session"\)/u, "Logout must remove local session shortcuts from the URL.");

assert.match(orgs, /const managesOrg = s\.isSuperAdmin \|\| \["owner", "admin"\]\.includes\(s\.orgRole \|\| ""\)/u, "Only org owners/admins may map to Business Manager.");
assert.doesNotMatch(orgs, /\["owner", "admin", "member"\]\.includes\(s\.orgRole/u, "Plain org members must not map to Business Manager.");
assert.match(orgs, /export async function databaseAcceptInvitation\(token, payload = \{\}\)[\s\S]*\/auth\/invitations\/accept/u, "The browser must accept workspace invitations through the server-owned route.");

assert.doesNotMatch(index, /Business owner or workspace admin/u, "The public gate must not blur full admin access with customer workspace admins.");
assert.match(index, /Full Force owner\/admin access/u, "Business Manager copy must make admin full-Force access explicit.");
assert.match(index, /Admin is never a client workspace selector/u, "The static gate must state that admin always opens full Force.");
assert.match(main, /Admin always opens full Force, not a customer workspace/u, "Live admin login must clarify that admin is full Force, not workspace-scoped.");

assert.match(publicHosts, /export const CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u, "The server public-host boundary must know the customer app host.");
assert.match(publicHosts, /if \(scope === "admin"\) return session\.canManageAccess/u, "The admin host must only allow platform/admin access sessions.");
assert.match(publicHosts, /if \(scope === "client"\) return !session\.canManageAccess/u, "The customer host must reject platform/admin access sessions.");
assert.match(server, /const publicHost = requestPublicHost\(request\);\s*if \(!canUseSessionOnPublicHost\(publicHost, session\)\) \{\s*await revokeDatabaseSession\(session\.authSessionId\);/u, "Database login must enforce the public-host boundary and revoke refused sessions.");
assert.match(server, /const scope = publicHostScope\(publicHost\);[\s\S]*const customerAccountActionsEnabled = scope !== "admin" && \(databaseLoginUsable \|\| localCustomerEnabled\);[\s\S]*customerLoginEndpoint: scope !== "admin" && \(databaseLoginUsable \|\| localCustomerEnabled\) \? "\/auth\/login" : undefined/u, "/sessions must not advertise customer login/register/reset endpoints to admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/signup"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer accounts cannot be created on admin\.phantomforce\.online/u, "Database signup must be blocked on admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/forgot-username"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer account recovery belongs on app\.phantomforce\.online/u, "Username recovery must be blocked on admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/forgot-password"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer account recovery belongs on app\.phantomforce\.online/u, "Password recovery must be blocked on admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/reset-password"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer password reset belongs on app\.phantomforce\.online/u, "Password reset must be blocked on admin.phantomforce.online.");
assert.match(staticServer, /headers\["x-forwarded-host"\] = originalHost;[\s\S]*headers\["x-original-host"\] = originalHost;/u, "The admin static proxy must preserve the original public host so Hermes can enforce admin/app auth boundaries.");

console.log("Auth boundary checks passed.");
