import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const pkg = JSON.parse(read("package.json"));
const claude = read("CLAUDE.md");
const ship = read("scripts/ship-live-admin.mjs");
const liveSourceDoctor = read("ops/admin-live/Test-LiveAdminSource.ps1");

assert(pkg.scripts["ship:live-admin"] === "node scripts/ship-live-admin.mjs", "package.json must expose ship:live-admin.");
assert(pkg.scripts["verify:live-admin"] === "node scripts/ship-live-admin.mjs --verify-only", "package.json must expose verify:live-admin.");
assert(claude.includes("G:\\Codex\\Documents\\Codex\\deployments\\phantomforce-live"), "CLAUDE.md must name the migrated canonical deployment checkout.");
assert(claude.includes("serve/sync only") && claude.includes("not the deployment"), "Agent guidance must separate editing from serving.");
assert(!claude.includes("C:\\Users\\jorda\\Documents\\Codex\\worktrees\\phantomforce-live-social-analytics-20260712"), "CLAUDE.md must not point Claude at the stale social-analytics worktree.");
assert(claude.includes("npm run ship:live-admin -- --commit"), "CLAUDE.md must force the ship command.");
assert(claude.includes("LIVE ADMIN SHIP PASSED"), "CLAUDE.md must prohibit success claims without the pass banner.");
assert(ship.includes("phantom-live-\\d{8}-\\d+"), "ship script must bump/cache-check phantom-live build ids.");
assert(ship.includes("https://admin.phantomforce.online/"), "ship script must verify the public admin domain.");
assert(ship.includes("http://127.0.0.1:5177/"), "ship script must verify the local admin UI.");
assert(ship.includes("http://127.0.0.1:5190/"), "ship script must verify the local Hermes/API UI route.");
assert(ship.includes("git([\"commit\""), "ship script must commit.");
assert(ship.includes("git([\"push\", \"origin\", \"main\"]"), "ship script must push origin/main.");
assert(ship.includes("assertDeploymentReady();"), "Shipping must reject dirty or mismatched deployment checkouts before pushing.");
assert(ship.includes("scripts/test-release-critical.mjs"), "Shipping must run the entire critical release suite before committing or pushing.");
assert(ship.includes('process.platform === "win32" && DEPLOY_ROOT === ROOT'), "Windows releases cannot be redirected to an editing checkout.");
assert(ship.includes("DEPLOY_ROOT,") && ship.includes("path.resolve(health.root"), "Shipping must sync and verify the dedicated deployment, not its editing clone.");
assert(read("ops/admin-live/Sync-AdminMain.ps1").includes("$runningRoot -ne $RepoRoot"), "Equal server hashes cannot conceal an incorrect serving root.");
assert(read("ops/admin-live/Sync-AdminMain.ps1").includes("& $canonicalSync -RepoRoot $canonicalLiveRoot"), "Retired watchers must redirect production sync to the dedicated deployment.");
for (const launcher of ["Start-AdminLive.ps1", "Start-Hermes.ps1"]) {
  assert(read(`ops/admin-live/${launcher}`).includes("if ($repo -ne $canonicalLiveRoot)"), `${launcher} must reject production starts from editing roots before stopping listeners.`);
}
assert(liveSourceDoctor.includes("Wait-Job -Job $processInspectionJob -Timeout 15"), "live-source doctor must time-box Windows process inventory.");
assert(liveSourceDoctor.includes("Windows process inventory did not answer within 15 seconds"), "live-source doctor must report an honest process-inventory timeout.");
assert(liveSourceDoctor.includes("schtasks.exe /Query /TN $TaskName /XML"), "live-source doctor must avoid the blocking ScheduledTasks CIM provider.");
assert(!liveSourceDoctor.includes("Get-ScheduledTask"), "live-source doctor must not use the blocking ScheduledTasks CIM provider.");

if (process.platform === "win32" && fs.existsSync("G:\\Codex\\Documents\\Codex\\deployments\\phantomforce-live\\.git")) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pf-production-root-guard-"));
  try {
    for (const [launcher, port, service] of [["Start-AdminLive.ps1", "5177", "UI"], ["Start-Hermes.ps1", "5190", "API"]]) {
      const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "ops/admin-live", launcher), "-RepoRoot", fixtureRoot, "-Port", port, "-StopExisting"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
      assert(!result.error, `${launcher} negative-root check must finish without a timeout.`);
      assert(result.status !== 0, `${launcher} must reject an editing/fixture root on a production port.`);
      assert(`${result.stdout || ""}\n${result.stderr || ""}`.includes(`Production ${service} must use the dedicated deployment checkout`), `${launcher} must fail at its root guard, before dependency checks or listener changes.`);
    }
  } finally {
    // This is the empty directory created above, never a user/project folder.
    fs.rmdirSync(fixtureRoot);
  }
}
console.log("Claude live ship guard OK; production launchers reject fixture roots before touching listeners.");
