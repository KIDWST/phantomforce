import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const index = read("../app/index.html");
const main = read("../app/js/main.js");
const accountGate = read("../app/js/account-access-gate.js");
const orgs = read("../app/js/orgs.js");
const store = read("../app/js/store.js");
const server = read("../server/src/index.ts");
const publicHosts = read("../server/src/access/public-hosts.ts");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");
const hermesLauncher = read("../ops/admin-live/Start-Hermes.ps1");

assert.match(store, /export const CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u, "The customer app host must be explicit in the browser session layer.");
assert.match(store, /export const isClientPublicHost = \(\) => location\.hostname === CLIENT_PUBLIC_HOST/u, "The browser must detect the customer app host.");
assert.match(store, /export const isLocalDevHost = \(\) => LOCAL_DEV_HOSTS\.has\(location\.hostname\)/u, "Demo session shortcuts must be local-dev only.");
assert.match(store, /function liveAdminUrl\(\)[\s\S]*new URL\(`https:\/\/\$\{CLIENT_PUBLIC_HOST\}\/app\/index\.html`\)/u, "Legacy owner-entry helpers must send users to the canonical app, not depend on the admin alias.");
assert.match(store, /const allowLocalSessionShortcut = isLocalDevHost\(\)/u, "Session query shortcuts must be guarded by local-dev host detection.");
assert.match(store, /if \(saved\?\.database && !token\) \{\s*session\.clear\(\);\s*return null;\s*\}/u, "Saved database sessions must not restore after the token is gone.");
assert.match(store, /isClientPublicHost\(\) && \(!token \|\| \(!saved\.database && !saved\.localCustomer && !signedOwnerMirror\)\)/u, "The canonical app must require a tab token and a supported account mirror; arbitrary local/demo mirrors stay rejected.");
assert.match(store, /if \(!isLiveAdminHost\(\) && !isClientPublicHost\(\)\) return resolveSession\(\)/u, "Both public hosts must verify restored accounts through the server.");
assert.match(store, /isLiveAdminHost\(\) && !payload\.session\.canManageAccess/u, "The legacy admin alias must retain its platform-owner restriction.");
assert.match(store, /const liveAdminDatabaseLane = isLiveAdminHost\(\) && auth\?\.ownerProductionAuthEnabled !== true;[\s\S]*if \(\(auth\?\.databaseAuthEnabled \|\| liveAdminDatabaseLane\) && !auth\?\.ownerProductionAuthEnabled\) \{\s*return databaseOwnerLogin\(ownerKeyOrEmail, password\);\s*\}/u, "The admin owner fallback must use database login on the live admin host.");
assert.match(store, /fetch\("\/auth\/login", \{[\s\S]*body: JSON\.stringify\(\{ email, password \}\)[\s\S]*if \(!s\.canManageAccess\) \{\s*session\.clear\(\);/u, "Database-backed admin login must use the server-owned login route and refuse accounts without admin access.");
assert.match(store, /if \(payload\?\.requires2fa\) \{\s*return \{\s*requires2fa: true,\s*challengeToken: payload\.challengeToken/u, "Owner login must return the live 2FA challenge instead of hiding it behind an error.");

assert.match(main, /if \(isClientPublicHost\(\)\) \{\s*renderCustomerAuthLoading\(card\);\s*maybeUpgradeGateToDatabaseLogin\(card, \{ customerApp: true, required: true \}\);\s*return;\s*\}/u, "app.phantomforce.online must render required real-account auth instead of role buttons.");
assert.match(main, /if \(isLiveAdminHost\(\)\) \{\s*renderInternalAdminAuthLoading\(card\);\s*maybeUpgradeGateToDatabaseLogin\(card, \{ internalAdmin: true, required: true \}\);\s*return;\s*\}\s*if \(isClientPublicHost\(\)/u, "admin.phantomforce.online must mount the database admin gate directly, without a legacy owner-form race.");
assert.doesNotMatch(main, /data-owner-login|ownerLogin\(/u, "The live UI must not keep the legacy owner login form path.");
assert.match(accountGate, /if \(nextSession\?\.requires2fa\) \{\s*state\.challenge = nextSession\.challengeToken;\s*state\.mode = "2fa";\s*state\.message = "Password accepted\. Enter your authenticator code to finish signing in\.";\s*render\(\);\s*return;/u, "The database gate must visibly switch to 2FA after the password is accepted.");
assert.match(accountGate, /state\.mode === "2fa"[\s\S]*data-auth-form="2fa"[\s\S]*databaseVerify2fa\(state\.challenge, String\(data\.get\("code"\) \|\| ""\)\)/u, "The database 2FA form must verify the server challenge.");
assert.match(accountGate, /const \{ customerApp = false, internalAdmin = false, required = false, attempt = 0 \} = options;/u, "The shared account renderer must have an explicit internal-admin mode.");
assert.match(accountGate, /if \(internalAdmin && !\["signin", "2fa"\]\.includes\(state\.mode\)\) state\.mode = "signin";/u, "Internal admin auth must be forced back to sign-in/2FA if a signup or recovery mode is requested.");
assert.match(accountGate, /\$\{internalAdmin \|\| adminIntent \|\| !customerEnabled \|\| state\.mode === "invite" \? "" : `<div class="auth-tabs auth-tabs-primary">/u, "Internal admin auth must not render public account choices.");
assert.match(accountGate, /\$\{tab\("signin", "Sign in"\)\}\$\{tab\("signup", "Create account"\)\}/u, "Customer auth must keep only Sign in and Create account as primary choices.");
assert.match(accountGate, /data-auth-mode="forgot-user">Forgot username\?<\/button><button type="button" data-auth-mode="forgot-pass">Forgot password\?/u, "Recovery actions must be contextual links below sign in, not five competing primary tabs.");
assert.match(accountGate, /state\.mode === "2fa" \? "Use another account" : "Back to sign in"/u, "An expired or rejected 2FA challenge must always have an escape back to sign in.");
assert.match(main, /function renderInternalAdminAuthLoading\(card, message = "Connecting to the PhantomForce account system\.\.\."\)/u, "Live admin must show an account-system loading state while the database auth config is fetched.");
assert.match(accountGate, /window\.setTimeout\(\(\) => mountAccountAccessGate\(\{[^\n]*\.\.\.options, attempt: attempt \+ 1 \}\), 3000\)/u, "Required auth gates must retry automatically instead of getting stuck during backend startup.");
assert.match(accountGate, /if \(state\.busy\) return;[\s\S]*const data = new FormData\(form\);[\s\S]*form\.setAttribute\("aria-busy", "true"\)[\s\S]*control\.disabled = true/u, "Account forms must capture values, block duplicate submissions, and expose their busy state.");
assert.match(accountGate, /invite_token[\s\S]*databaseAcceptInvitation\(state\.inviteToken/u, "Invitation links must open a real one-time workspace acceptance flow.");
assert.match(accountGate, /Sign-in is temporarily unavailable\. Try again in a moment\./u, "Customer outages must use calm user-facing recovery copy instead of backend instructions.");
assert.doesNotMatch(main, /The account system is not reachable\. Start the backend/u, "Customer auth must not expose backend-start instructions.");
assert.doesNotMatch(main.match(/if \(isLiveAdminHost\(\)\) \{([\s\S]*?)\n  \}\n\n  if \(isClientPublicHost\(\)/u)?.[1] || "", /customerApp: true|data-auth-mode="signup"|Forgot password|Create account|data-owner-login/u, "Admin login must not mount customer create-account/password-reset controls or the legacy owner form.");
assert.match(main, /if \(isLocalDevHost\(\)\) \{\s*try \{/u, "Demo login must remain local-development only.");
assert.match(main, /function renderCustomerAuthBlocked\(card, message = "Account sign-in is temporarily unavailable\."\)/u, "The canonical app must show a blocked state while account verification is unavailable.");
assert.doesNotMatch(main, /Platform admin accounts must use admin\.phantomforce\.online/u, "The canonical app must not log out verified platform owners or force a different host.");
assert.match(main, /surface\?\.internalOnly[\s\S]*ctx\.session\?\.canManageAccess/u, "Internal UI capabilities may be offered to a server-confirmed platform owner on the canonical app.");
assert.match(main, /const publicHost = isLiveAdminHost\(\) \|\| isClientPublicHost\(\);[\s\S]*const restored = publicHost \? await verifyLiveSession\(\) : resolveSession\(\);[\s\S]*if \(publicHost\) return restored;/u, "Public boot must use server verification and must not restore privileged offline mirrors after a failed verifier.");
assert.match(main, /try \{\s*if \(databaseSession\) await databaseLogout\(\);\s*\} finally \{\s*session\.clear\(\);/u, "Logout must always clear local access even if database revocation fails.");
assert.match(main, /url\.searchParams\.delete\("session"\)/u, "Logout must remove local session shortcuts from the URL.");

assert.match(main, /void import\("\.\/account-access-gate\.js\?v=/u, "The dual access gate must remain lazy so the signed-in shell gains no eager bundle.");
assert.match(accountGate, /data-auth-access="customer"[\s\S]*data-auth-access="admin"/u, "The canonical app must visibly offer customer and admin access.");
assert.match(accountGate, /!hasPlatformAdminAccess\(nextSession\)[\s\S]*void databaseLogout\(\);[\s\S]*session\.clear\(\); ctx\.session = null;/u, "Admin intent must immediately clear an authenticated customer even if server revocation is unavailable.");
assert.match(accountGate, /const ownerEnabled = auth\?\.ownerProductionAuthEnabled === true/u, "Legacy owner sign-in may be offered only when the backend explicitly advertises it.");
assert.match(accountGate, /await ownerLogin\(identifier, password\)/u, "The advertised owner-only fallback must use the existing credential verifier.");
assert.match(accountGate, /ownerCredentials \? 'type="email"'/u, "Legacy owner sign-in must collect the email required by its existing server schema.");
assert.match(accountGate, /fetchAuthConfig\(\{ refresh: attempt > 0 \}\)/u, "Required-gate retries must read fresh server availability instead of a cached outage.");
assert.match(orgs, /cachedAuthConfig && !refresh/u, "Explicit account-config refresh must bypass the ordinary cache.");
assert.match(orgs, /api\("\/auth\/logout", \{ method: "POST", body: \{\}, signal: AbortSignal.timeout\(10_000\) \}\)/u, "Unavailable revocation must never leave normal sign-out waiting indefinitely.");
assert.doesNotMatch(accountGate, /role:\s*"admin"|canManageAccess:\s*true|isSuperAdmin:\s*true/u, "Choosing an admin entry must never manufacture platform authority.");

assert.match(orgs, /const managesOrg = s\.isSuperAdmin \|\| \["owner", "admin"\]\.includes\(s\.orgRole \|\| ""\)/u, "Only org owners/admins may map to Business Manager.");
assert.doesNotMatch(orgs, /\["owner", "admin", "member"\]\.includes\(s\.orgRole/u, "Plain org members must not map to Business Manager.");
assert.match(orgs, /export async function databaseAcceptInvitation\(token, payload = \{\}\)[\s\S]*\/auth\/invitations\/accept/u, "The browser must accept workspace invitations through the server-owned route.");

assert.doesNotMatch(index, /Business owner or workspace admin/u, "The public gate must not confuse business-admin authority with platform-owner authority.");
assert.match(index, /Full Force owner\/admin access/u, "Business Manager copy must make admin full-Force access explicit.");
assert.match(index, /All accounts use app\.phantomforce\.online\. Your verified role controls business and platform access\./u, "The static gate must identify the canonical shared app without granting a role from its hostname.");
assert.match(main, /Admin opens full Force with platform access/u, "Live admin login must clarify that admin is full Force, not workspace-scoped.");
assert.match(index, /pf_build_probe/u, "The live page must poll for a new build.");
assert.match(index, /location\.replace\(nextUrl\.href\)/u, "The live page must replace stale tabs after deploys.");

assert.match(publicHosts, /export const CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u, "The server public-host boundary must know the customer app host.");
assert.match(publicHosts, /if \(scope === "admin"\) return session\.canManageAccess/u, "The admin host must only allow platform/admin access sessions.");
assert.match(publicHosts, /if \(scope === "client"\) return true/u, "The canonical app accepts authenticated owners and customers; host selection never grants a role.");
assert.match(server, /const publicHost = requestPublicHost\(request\);\s*if \(!canUseSessionOnPublicHost\(publicHost, session\)\) \{\s*await revokeDatabaseSession\(session\.authSessionId\);/u, "Database login must enforce the public-host boundary and revoke refused sessions.");
assert.match(server, /const scope = publicHostScope\(publicHost\);[\s\S]*const customerAccountActionsEnabled = scope !== "admin" && \(databaseLoginUsable \|\| localCustomerEnabled\);[\s\S]*customerLoginEndpoint: scope !== "admin" && \(databaseLoginUsable \|\| localCustomerEnabled\) \? "\/auth\/login" : undefined/u, "/sessions must not advertise customer login/register/reset endpoints to admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/signup"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer accounts cannot be created on admin\.phantomforce\.online/u, "Database signup must be blocked on admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/forgot-username"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer account recovery belongs on app\.phantomforce\.online/u, "Username recovery must be blocked on admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/forgot-password"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer account recovery belongs on app\.phantomforce\.online/u, "Password recovery must be blocked on admin.phantomforce.online.");
assert.match(server, /app\.post\("\/auth\/reset-password"[\s\S]*customerAuthForbiddenOnHost\(request\)[\s\S]*Customer password reset belongs on app\.phantomforce\.online/u, "Password reset must be blocked on admin.phantomforce.online.");
assert.match(staticServer, /headers\["x-forwarded-host"\] = originalHost;[\s\S]*headers\["x-original-host"\] = originalHost;/u, "The admin static proxy must preserve the original public host so Hermes can enforce admin/app auth boundaries.");
assert.match(hermesLauncher, /function Test-PostgresProtocol/u, "The Hermes launcher must verify PostgreSQL itself instead of trusting an occupied TCP port.");
assert.match(hermesLauncher, /if \(Test-PostgresProtocol -HostName "127\.0\.0\.1" -Port 5432\) \{\s*return/u, "The Hermes launcher must only accept a protocol-responsive local database.");
assert.doesNotMatch(hermesLauncher, /if \(Test-NetConnection[^\n]*5432[^\n]*\) \{\s*return/u, "A Docker proxy port without a PostgreSQL backend must not be treated as healthy.");
assert.match(hermesLauncher, /\$containerDeadline = \(Get-Date\)\.AddSeconds\(30\)[\s\S]*container inspect[\s\S]*while \(\(Get-Date\) -lt \$containerDeadline\)/u, "The launcher must wait for Docker to restore saved containers before declaring PostgreSQL missing.");

console.log("Auth boundary checks passed.");
