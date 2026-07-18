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

assert.match(main, /if \(isClientPublicHost\(\)\) \{\s*renderCustomerAuthLoading\(card\);\s*maybeUpgradeGateToDatabaseLogin\(card, \{ customerApp: true, required: true \}\);\s*return;\s*\}/u, "app.phantomforce.online must render required real-account auth instead of role buttons.");
assert.match(main, /if \(isLiveAdminHost\(\)\) \{[\s\S]*data-owner-login[\s\S]*ownerLogin\(email, password\)[\s\S]*maybeUpgradeGateToDatabaseLogin\(card, \{ internalAdmin: true \}\);[\s\S]*return;\s*\}\s*if \(isClientPublicHost\(\)/u, "admin.phantomforce.online must render the internal-admin login and return before the customer app panel can mount.");
assert.match(main, /const \{ customerApp = false, internalAdmin = false, required = false \} = options;/u, "The shared account renderer must have an explicit internal-admin mode.");
assert.match(main, /if \(internalAdmin && !\["signin", "2fa"\]\.includes\(state\.mode\)\) state\.mode = "signin";/u, "Internal admin auth must be forced back to sign-in/2FA if a signup or recovery mode is requested.");
assert.match(main, /\$\{internalAdmin \? "" : `<div class="auth-tabs">/u, "Internal admin auth must not render the create/recovery/reset tab strip.");
assert.doesNotMatch(main.match(/if \(isLiveAdminHost\(\)\) \{([\s\S]*?)\n  \}\n\n  if \(isClientPublicHost\(\)/u)?.[1] || "", /customerApp: true|data-auth-mode="signup"|Forgot password|Create account/u, "Admin login must not mount customer create-account/password-reset controls.");
assert.match(main, /if \(isLocalDevHost\(\)\) \{\s*try \{/u, "Demo login must remain local-development only.");
assert.match(main, /function renderCustomerAuthBlocked\(card, message = "Customer account login is not enabled on this backend\."\)/u, "Customer app must block when database auth is disabled.");
assert.match(main, /Platform admin accounts must use admin\.phantomforce\.online/u, "Customer app must direct platform admin accounts away from app.phantomforce.online.");
assert.match(main, /try \{\s*if \(databaseSession\) await databaseLogout\(\);\s*\} finally \{\s*session\.clear\(\);/u, "Logout must always clear local access even if database revocation fails.");
assert.match(main, /url\.searchParams\.delete\("session"\)/u, "Logout must remove local session shortcuts from the URL.");

assert.match(orgs, /const managesOrg = s\.isSuperAdmin \|\| \["owner", "admin"\]\.includes\(s\.orgRole \|\| ""\)/u, "Only org owners/admins may map to Business Manager.");
assert.doesNotMatch(orgs, /\["owner", "admin", "member"\]\.includes\(s\.orgRole/u, "Plain org members must not map to Business Manager.");

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
