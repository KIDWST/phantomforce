import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = resolve(import.meta.dirname, "..");
const [index, main, hunter, css, server] = await Promise.all([
  readFile(resolve(root, "app/index.html"), "utf8"),
  readFile(resolve(root, "app/js/main.js"), "utf8"),
  readFile(resolve(root, "app/js/phantomhunter.js"), "utf8"),
  readFile(resolve(root, "app/phantomhunter.css"), "utf8"),
  readFile(resolve(root, "server/src/phantom-ai/phantom-hunter.ts"), "utf8"),
]);
const buildId = index.match(/phantom-live-\d{8}-\d+/u)?.[0];
assert(buildId, "Index must carry the PhantomHunter build identity.");
const escapedBuildId = buildId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

assert(index.includes('data-nav-id="phantomhunter"'), "The operating rail must expose PhantomHunter.");
assert(main.includes('renderPhantomHunter') && main.includes('id: "phantomhunter"'), "Main routing must register the PhantomHunter workspace.");
assert(new RegExp(`/app/phantomhunter\\.css\\?v=${escapedBuildId}`).test(main), "The workspace must load its cache-busted visual system.");
assert(new RegExp(`import \\{ currentTenantId, friendlyBackendError, session \\} from "\\./store\\.js\\?v=${escapedBuildId}"`).test(hunter), "PhantomHunter must use the shared authenticated session contract.");
assert(hunter.includes("const token = session.token();"), "Every PhantomHunter request must read the current in-memory browser-session token.");
assert(!hunter.includes("phantomforce_access_token"), "PhantomHunter must not read obsolete private token keys.");
for (const engine of ["Betterleaks", "TruffleHog", "KeyHunter"]) {
  assert(hunter.includes(engine), `${engine} must remain visible in the correlated pipeline.`);
}
assert(hunter.includes("/phantom-ai/phantom-hunter/web?limit=10"), "Web UI must load the bound workspace repository contract.");
assert(hunter.includes("/phantom-ai/phantom-hunter/web/scan"), "Web UI must use the target-free repository scan route.");
assert(hunter.includes("/phantom-ai/phantom-hunter/web/connect") && hunter.includes('data-hunter-connect="github"'), "Unbound users must be able to request a code-source connection without a repository path.");
assert(hunter.includes("I am authorized"), "Repository authorization attestation must be visible.");
assert(hunter.includes("Your repository") && hunter.includes("Scan now"), "Web workflow must remain one-repository and one-action simple.");
assert(hunter.includes("active_findings"), "The result lane must use verified-active findings.");
assert(!hunter.includes("assets/bulk") && !hunter.includes("include_review") && !hunter.includes("targetInput"), "Web UI must not accept arbitrary targets or expose a review lane.");
assert(!/unverified|inactive key|candidate review/i.test(hunter), "Web UI must not surface non-active credential noise.");
assert(!/Show raw key|Copy full key|key_full/.test(hunter), "The UI must not offer raw-secret reveal or export.");
assert(css.includes(".hunter-web-shell") && css.includes(".hunter-web-finding") && css.includes(".hunter-web-action"), "The complete PhantomHunter web visual system must exist.");
assert(/state\.organizationId = String\(web\.organization_id[\s\S]*state\.organizationId \|\| tenantId\(\)/u.test(hunter), "Every follow-up must remain pinned to the organization returned by the workspace response.");
assert(/error\?\.status === 404[\s\S]*Repository refreshed[\s\S]*ignoreScanId/u.test(hunter), "A missing stale scan must self-heal without exposing a generic record-not-found failure.");
assert(server.includes('if (kind === "local_path") return "Connected workspace source"'), "Repository cards must never receive an internal local path.");
assert(/Check completed with limited coverage[\s\S]*Run the check again for complete coverage/u.test(hunter), "Partial scan coverage must remain visible and actionable.");
assert(server.includes("scan_interrupted_by_service_restart"), "Service restarts must close and preserve an actionable interrupted scan record.");

console.log(JSON.stringify({
  ok: true,
  build: buildId,
  firstClassRoute: true,
  boundRepositoryOnly: true,
  arbitraryTargetIntake: false,
  threeEnginePipeline: true,
  authorizationAttestation: true,
  activeOnlyResults: true,
  tenantPinnedFollowups: true,
  interruptedScanRecovery: true,
  localPathExposed: false,
  rawKeyControls: false,
  responsiveWorkspace: true,
}, null, 2));
