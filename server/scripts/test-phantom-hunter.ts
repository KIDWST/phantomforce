import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const parse = <T>(payload: string) => JSON.parse(payload) as T;
const execFileAsync = promisify(execFile);
const fixtureRoot = await mkdtemp(join(tmpdir(), "phantomhunter-web-test-"));
const repositoryRoot = join(fixtureRoot, "authorized-workspace-repository");
const syntheticCredential = `ghp_${"Z9aB7cD5eF3gH1jK8mN6pQ4rS2tV0wX"}`;
await mkdir(repositoryRoot, { recursive: true });
await writeFile(join(repositoryRoot, "runtime.env"), `GITHUB_TOKEN=${syntheticCredential}\n`, "utf8");
await execFileAsync("git", ["init", "--quiet", repositoryRoot]);
await execFileAsync("git", ["-C", repositoryRoot, "add", "runtime.env"]);
await execFileAsync("git", ["-C", repositoryRoot, "-c", "user.name=PhantomHunter Test", "-c", "user.email=phantomhunter@example.invalid", "commit", "--quiet", "-m", "fixture"]);

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_HUNTER_DATA_DIR = join(fixtureRoot, "state");
process.env.PHANTOMFORCE_CONNECTION_REQUESTS_PATH = join(fixtureRoot, "connection-requests.json");
process.env.PHANTOM_HUNTER_WEB_REPOSITORIES_JSON = JSON.stringify({
  "hunter-org-a": { target: repositoryRoot, label: "Authorized workspace repository", kind: "local_path" },
});

const { app } = await import("../src/index.js");
const {
  localGitUri,
  parseBetterleaksOutput,
  parseKeyHunterVerificationOutput,
  parseTrufflehogOutput,
  resetPhantomHunterStateForTests,
} = await import("../src/phantom-ai/phantom-hunter.js");

type Login = { token: string };

async function demoToken(sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId }),
  });
  assert(response.statusCode === 200, `${sessionId} demo login must succeed.`);
  return parse<Login>(response.payload).token;
}

try {
  const unauthenticated = await app.inject({ method: "GET", url: "/phantom-ai/phantom-hunter/web" });
  assert(unauthenticated.statusCode === 401, "The web repository route must require authentication.");
  const adminToken = await demoToken("admin-jordan");
  const clientToken = await demoToken("client-sports-demo");

  const status = await app.inject({
    method: "GET",
    url: "/phantom-ai/phantom-hunter/status?tenant_id=hunter-org-a",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const statusBody = parse<any>(status.payload);
  assert(status.statusCode === 200 && statusBody.hunter.status === "ready", "All three local engines must be ready.");
  assert(statusBody.access.surface === "bound_repository_only", "The browser contract must be repository-only.");
  assert(statusBody.access.arbitrary_targets === false && statusBody.access.can_intake === false, "The browser must prohibit arbitrary targets.");
  assert(statusBody.web.connected === true, "The configured workspace repository must connect automatically.");

  const parserSecret = `sk-proj-${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4"}`;
  assert(parseBetterleaksOutput(JSON.stringify([{
    RuleID: "openai-api-key", Description: "OpenAI API key", Secret: parserSecret,
    StartLine: 4, Attributes: { path: "server/runtime.env" },
  }]))[0]?.provider === "openai", "Betterleaks discovery output must normalize.");
  assert(parseTrufflehogOutput(JSON.stringify({
    DetectorName: "OpenAI", Raw: parserSecret, Verified: false,
    SourceMetadata: { Data: { Filesystem: { file: "server/runtime.env", line: 4 } } },
  }))[0]?.provider === "openai", "TruffleHog discovery output must normalize.");
  assert(parseKeyHunterVerificationOutput(JSON.stringify([{
    provider: "openai", key: parserSecret, is_active: true, verified_at: new Date().toISOString(),
    error_message: null, file_path: "server/runtime.env",
  }]))[0]?.engine === "keyhunter", "KeyHunter verification output must normalize.");

  const workspace = await app.inject({
    method: "GET",
    url: "/phantom-ai/phantom-hunter/web?tenant_id=hunter-org-a",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const workspaceBody = parse<any>(workspace.payload);
  assert(workspace.statusCode === 200 && workspaceBody.repository.connected, "Web must expose one bound repository.");
  assert(workspaceBody.repository.accepts_arbitrary_targets === false, "Web repository response must explicitly reject arbitrary targets.");
  assert(!workspace.payload.includes(repositoryRoot), "The server must not expose a full local repository path.");
  assert(workspaceBody.repository.repository.target_display === "Connected workspace source", "The web repository card must not expose a shortened local path.");
  if (process.platform === "win32") {
    assert(/^file:\/\/[A-Za-z]:\//u.test(localGitUri(repositoryRoot)), "Windows history scans must use TruffleHog's working file://C:/ repository form.");
  }

  const connectRequest = await app.inject({
    method: "POST",
    url: "/phantom-ai/phantom-hunter/web/connect?tenant_id=hunter-org-unbound",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ provider: "github", tenant_id: "hunter-org-unbound" }),
  });
  const connectRequestBody = parse<any>(connectRequest.payload);
  assert(connectRequest.statusCode === 202 && connectRequestBody.state === "requested", "An unbound workspace must be able to request a provider connection without supplying a path.");
  assert(connectRequestBody.secrets_exposed === false && !connectRequest.payload.toLowerCase().includes("token"), "Connection requests must remain credential-free.");

  const blockedIntake = await app.inject({
    method: "POST",
    url: "/phantom-ai/phantom-hunter/assets/bulk",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ assets: [{ target: "https://example.com", kind: "web_app" }] }),
  });
  assert(blockedIntake.statusCode === 410 && blockedIntake.payload.includes("desktop_only"), "Arbitrary target intake must be desktop-only.");

  const blockedCustomScan = await app.inject({
    method: "POST",
    url: "/phantom-ai/phantom-hunter/scans",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ asset_ids: [workspaceBody.repository.repository.id] }),
  });
  assert(blockedCustomScan.statusCode === 410, "Custom browser scan requests must be disabled.");

  const noAttestation = await app.inject({
    method: "POST",
    url: "/phantom-ai/phantom-hunter/web/scan",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ tenant_id: "hunter-org-a" }),
  });
  assert(noAttestation.statusCode === 400, "The one-button scan must still require authorization attestation.");

  const started = await app.inject({
    method: "POST",
    url: "/phantom-ai/phantom-hunter/web/scan",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ tenant_id: "hunter-org-a", authorization_attested: true, target: "https://attacker.example" }),
  });
  assert(started.statusCode === 202, "The bound-repository scan must queue.");
  const scanId = parse<any>(started.payload).scan.id;
  let finalScan: any = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/phantom-ai/phantom-hunter/scans/${scanId}?tenant_id=hunter-org-a&include_review=true`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(response.statusCode === 200 && !response.payload.includes(syntheticCredential), "Polling must remain scoped and raw-free.");
    finalScan = parse<any>(response.payload).scan;
    assert(finalScan.findings.every((finding: any) => finding.verification_status === "active"), "Every browser-visible finding must be active.");
    if (["completed", "partial", "failed", "cancelled"].includes(finalScan.status)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  assert(finalScan && ["completed", "partial"].includes(finalScan.status), "The real three-engine bound-repository scan must finish.");
  assert(finalScan.engine_runs.some((run: any) => run.engine === "betterleaks" && run.status === "completed"), "Betterleaks must execute.");
  assert(finalScan.engine_runs.some((run: any) => run.engine === "trufflehog" && run.status === "completed"), "TruffleHog must execute.");
  assert(finalScan.engine_runs.some((run: any) => run.engine === "keyhunter" && run.status === "completed"), "KeyHunter must execute.");
  assert(finalScan.summary.verified_active === 0, "The synthetic invalid credential must never reach the active-only result surface.");

  const clientCrossTenant = await app.inject({
    method: "GET",
    url: "/phantom-ai/phantom-hunter/web?tenant_id=hunter-org-a",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientCrossTenant.statusCode === 403, "Client sessions must not cross organization boundaries.");

  const exported = await app.inject({
    method: "GET",
    url: `/phantom-ai/phantom-hunter/scans/${scanId}/export.csv?tenant_id=hunter-org-a`,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(exported.statusCode === 200 && exported.headers["x-phantomhunter-raw-secrets"] === "false", "CSV export must be masked and active-only.");
  assert(!exported.payload.includes(syntheticCredential), "CSV export must not expose raw credentials.");

  const tenantStateDirs = await readdir(join(fixtureRoot, "state"));
  const stateFiles = tenantStateDirs.map((directory) => join(fixtureRoot, "state", directory, "state.json"));
  const stateRecords = await Promise.all(stateFiles.map(async (file) => ({ file, content: await readFile(file, "utf8") })));
  const ownerStateRecord = stateRecords.find((record) => record.content.includes("hunter-org-a")) || stateRecords[0];
  assert(ownerStateRecord, "The organization scan state must be durable.");
  const stateFile = ownerStateRecord.file;
  const durableState = parse<any>(ownerStateRecord.content);
  const interruptedId = "11111111-2222-4333-8444-555555555555";
  durableState.scans.unshift({
    ...durableState.scans[0],
    id: interruptedId,
    status: "running",
    completed_at: null,
    errors: [],
    progress: { ...durableState.scans[0].progress, current_asset_id: durableState.scans[0].asset_ids[0] },
    engine_runs: durableState.scans[0].engine_runs.map((run: any, index: number) => ({
      ...run,
      status: index === 0 ? "running" : "queued",
      completed_at: null,
      note: null,
    })),
  });
  await writeFile(stateFile, `${JSON.stringify(durableState, null, 2)}\n`, "utf8");
  resetPhantomHunterStateForTests();
  const recoveredWorkspace = await app.inject({
    method: "GET",
    url: "/phantom-ai/phantom-hunter/web?tenant_id=hunter-org-a",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const recoveredScan = parse<any>(recoveredWorkspace.payload).scans.find((scan: any) => scan.id === interruptedId);
  assert(recoveredWorkspace.statusCode === 200 && recoveredScan?.status === "failed", "A service restart must close an orphaned running scan instead of leaving it spinning.");
  assert(recoveredScan.errors.some((error: any) => error.code === "scan_interrupted_by_service_restart"), "Interrupted recovery must remain diagnosable.");
  const recoveredDetail = await app.inject({
    method: "GET",
    url: `/phantom-ai/phantom-hunter/scans/${interruptedId}?tenant_id=hunter-org-a`,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(recoveredDetail.statusCode === 200, "Every scan returned by the workspace list must remain resolvable by its detail route.");

  const persistedState = await Promise.all(tenantStateDirs.map((directory) => readFile(join(fixtureRoot, "state", directory, "state.json"), "utf8")));
  assert(persistedState.every((content) => !content.includes(syntheticCredential)), "Durable tenant state must never contain raw credentials.");
  assert(persistedState.every((content) => !content.includes('"verification_status": "unverified"') && !content.includes('"verification_status": "inactive"')), "Durable web state must retain active findings only.");

  console.log(JSON.stringify({
    ok: true,
    webSurface: "bound_repository_only",
    arbitraryTargetIntake: false,
    enginesReady: statusBody.hunter.tools.map((tool: any) => `${tool.id}:${tool.version}`),
    tenantIsolation: true,
    activeOnlyResults: true,
    interruptedScanRecovery: true,
    listDetailCoherence: true,
    rawSecretsReturned: false,
    rawSecretsPersisted: false,
    maskedExport: true,
  }, null, 2));
} finally {
  await app.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
