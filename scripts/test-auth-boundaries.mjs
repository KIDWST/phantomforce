import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const index = read("../app/index.html");
const main = read("../app/js/main.js");
const orgs = read("../app/js/orgs.js");
const store = read("../app/js/store.js");
const server = read("../server/src/index.ts");
const publicHosts = read("../server/src/access/public-hosts.ts");

assert.match(store, /export const CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u, "The customer app host must be explicit in the browser session layer.");
assert.match(store, /export const isClientPublicHost = \(\) => location\.hostname === CLIENT_PUBLIC_HOST/u, "The browser must detect the customer app host.");
assert.match(store, /export const isLocalDevHost = \(\) => LOCAL_DEV_HOSTS\.has\(location\.hostname\)/u, "Demo session shortcuts must be local-dev only.");
assert.match(store, /const allowLocalSessionShortcut = isLocalDevHost\(\)/u, "Session query shortcuts must be guarded by local-dev host detection.");
assert.match(store, /if \(saved\?\.database && !token\) \{\s*session\.clear\(\);\s*return null;\s*\}/u, "Saved database sessions must not restore after the token is gone.");
assert.match(store, /isClientPublicHost\(\) && \(!saved\.database \|\| saved\.canManageAccess \|\| saved\.isSuperAdmin\)/u, "The customer app must reject local/admin/super-admin session mirrors.");
assert.match(store, /let liveSessionToken = "";/u, "The current tab must retain a volatile bearer token when browser sessionStorage is unavailable.");
assert.match(store, /const token = s\?\.token \|\| "";\s*if \(token\) liveSessionToken = token;/u, "Session set must capture the live token before writing browser storage.");
assert.match(store, /const \{ token: _token, \.\.\.safeSession \} = s \|\| \{\};\s*localStorage\.setItem\(SESSION_KEY, JSON\.stringify\(safeSession\)\);/u, "Durable local session storage must continue stripping bearer tokens.");
assert.match(store, /if \(liveSessionToken\) return liveSessionToken;/u, "Authenticated API clients must read the volatile token before falling back to sessionStorage.");
assert.match(store, /liveSessionToken = "";\s*try \{\s*localStorage\.removeItem\(SESSION_KEY\);/u, "Logout must clear the volatile bearer token before clearing browser storage.");

assert.match(main, /if \(isClientPublicHost\(\)\) \{\s*renderCustomerAuthLoading\(card\);\s*maybeUpgradeGateToDatabaseLogin\(card, \{ customerApp: true, required: true \}\);\s*return;\s*\}/u, "app.phantomforce.online must render required real-account auth instead of role buttons.");
assert.match(main, /if \(isLocalDevHost\(\)\) \{\s*renderLocalAuthLoading\(card\);\s*maybeUpgradeGateToDatabaseLogin\(card, \{ localDev: true, allowLocalFallback: true \}\);\s*return;\s*\}/u, "Local QA must check the configured auth backend before showing shortcut entry.");
assert.match(main, /if \(!isLocalDevHost\(\)\) return;\s*try \{\s*const response = await fetch\("\/auth\/demo-login"/u, "Demo login must remain local-development only.");
assert.match(main, /localDev && auth\?\.ownerProductionAuthEnabled && auth\?\.productionReady[\s\S]*renderOwnerLoginGate\(card,[\s\S]*LOCAL OWNER ACCESS[\s\S]*Local shortcuts stay hidden while owner auth is ready/u, "Local QA must use real owner sign-in when owner-production auth is configured.");
assert.match(main, /function renderCustomerAuthBlocked\(card, message = "Customer account login is not enabled on this backend\."\)/u, "Customer app must block when database auth is disabled.");
assert.match(main, /Platform admin accounts must use admin\.phantomforce\.online/u, "Customer app must direct platform admin accounts away from app.phantomforce.online.");
assert.match(main, /try \{\s*if \(databaseSession\) await databaseLogout\(\);\s*\} finally \{\s*session\.clear\(\);/u, "Logout must always clear local access even if database revocation fails.");
assert.match(main, /url\.searchParams\.delete\("session"\)/u, "Logout must remove local session shortcuts from the URL.");
assert.doesNotMatch(main, /confirm\("Sign out of PhantomForce\?"\)/u, "Sign out should not be blocked by a native confirmation before clearing access.");
assert.doesNotMatch(main, /phantomforcesupport@gmail\.com/u, "Owner login must not expose or prefill a real owner email.");
assert.match(main, /name="pf-access-identity" autocomplete="new-password"[\s\S]*placeholder="you@yourcompany\.com"/u, "Owner email field must use neutral anti-autofill attributes.");
assert.match(main, /emailInput\) emailInput\.value = "";/u, "Owner email field must be cleared after render to defeat browser prefill.");
assert.doesNotMatch(`${main}\n${store}`, /admin PC|Hermes\/backend|server\\?\.env|PHANTOMFORCE_OWNER_LOGIN_KEY/u, "Browser login/auth copy must not expose backend internals.");

assert.match(orgs, /const managesOrg = s\.isSuperAdmin \|\| \["owner", "admin"\]\.includes\(s\.orgRole \|\| ""\)/u, "Only org owners/admins may map to Business Manager.");
assert.doesNotMatch(orgs, /\["owner", "admin", "member"\]\.includes\(s\.orgRole/u, "Plain org members must not map to Business Manager.");

assert.doesNotMatch(index, /Jordan . full command across clients/u, "The customer-facing gate must not describe Business Manager as Jordan's account.");
assert.match(index, /Business owner or workspace admin/u, "Business Manager copy must describe customer owners/admins.");
assert.match(index, /Jordan and PhantomForce platform admins use admin\.phantomforce\.online/u, "The static gate must separate Jordan/admin from customer app users.");

assert.match(publicHosts, /export const CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u, "The server public-host boundary must know the customer app host.");
assert.match(publicHosts, /if \(scope === "admin"\) return session\.canManageAccess/u, "The admin host must only allow platform/admin access sessions.");
assert.match(publicHosts, /if \(scope === "client"\) return !session\.canManageAccess/u, "The customer host must reject platform/admin access sessions.");
assert.match(server, /const publicHost = requestPublicHost\(request\);\s*if \(!canUseSessionOnPublicHost\(publicHost, session\)\) \{\s*await revokeDatabaseSession\(session\.authSessionId\);/u, "Database login must enforce the public-host boundary and revoke refused sessions.");

console.log("Auth boundary checks passed.");
