import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_RE = /phantom-live-\d{8}-\d+/g;
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"]);
const LIVE_URLS = [
  "http://127.0.0.1:5177/",
  "http://127.0.0.1:5190/",
  "https://admin.phantomforce.online/"
];
const ALLOWED_STAGE_PATHS = [
  "app",
  "server",
  "scripts",
  "ops",
  "packages",
  "docs",
  "CLAUDE.md",
  "package.json",
  "package-lock.json",
  "README.md"
];

function fail(message) {
  console.error(`\nLIVE ADMIN SHIP FAILED: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const rendered = [command, ...args].join(" ");
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${rendered}${output ? `\n${output}` : ""}`);
  }
  return (result.stdout || "").trim();
}

function git(args, options) {
  return run("git", args, options);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const getValue = (name) => {
    const eq = args.find((arg) => arg.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1] || "";
    return "";
  };
  return {
    commit: getValue("--commit"),
    verifyOnly: args.includes("--verify-only")
  };
}

function listTextFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTextFiles(full));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function getLocalBuildId() {
  const indexPath = path.join(ROOT, "app", "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const match = html.match(BUILD_RE);
  if (!match?.[0]) fail("app/index.html does not contain a phantom-live build id.");
  return match[0];
}

function nextBuildId(current) {
  const match = current.match(/^phantom-live-(\d{8})-(\d+)$/);
  if (!match) fail(`Bad build id format: ${current}`);
  return `phantom-live-${match[1]}-${Number(match[2]) + 1}`;
}

function bumpAppBuild() {
  const current = getLocalBuildId();
  const next = nextBuildId(current);
  const touched = setAppBuild(next);
  if (touched === 0) fail("No app files had a build id to bump.");
  console.log(`\nBuild bumped: ${current} -> ${next} (${touched} app files)`);
  return next;
}

function setAppBuild(build) {
  let touched = 0;
  for (const file of listTextFiles(path.join(ROOT, "app"))) {
    const before = fs.readFileSync(file, "utf8");
    const after = before.replace(BUILD_RE, build);
    if (after !== before) {
      fs.writeFileSync(file, after);
      touched += 1;
    }
  }
  return touched;
}

function assertOnMainAndCurrent() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  if (branch !== "main") fail(`not on main branch; current branch is ${branch}`);
  git(["fetch", "--quiet", "origin", "main"]);
  const behind = Number(git(["rev-list", "--count", "HEAD..origin/main"], { capture: true }) || "0");
  if (behind > 0) fail(`local main is ${behind} commit(s) behind origin/main. Pull/rebase before shipping.`);
}

function statusPorcelain() {
  return git(["status", "--porcelain"], { capture: true });
}

function stageAllowedChanges() {
  const pathsToStage = ALLOWED_STAGE_PATHS.filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  git(["add", "--", ...pathsToStage]);
  const staged = git(["diff", "--cached", "--name-only"], { capture: true });
  if (!staged) fail("nothing staged to commit after build bump.");
  console.log(`\nStaged files:\n${staged}`);
}

async function fetchBuild(url, expectedBuild) {
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.text();
  const match = body.match(BUILD_RE);
  return {
    url,
    status: response.status,
    build: match?.[0] || "",
    ok: response.status === 200 && match?.[0] === expectedBuild
  };
}

async function verifyLiveBuild(expectedBuild) {
  console.log(`\nVerifying live admin build ${expectedBuild}...`);
  const results = await Promise.all(LIVE_URLS.map((url) => fetchBuild(url, expectedBuild)));
  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"} ${result.status} ${result.build || "NO_BUILD"} ${result.url}`);
  }
  const bad = results.filter((result) => !result.ok);
  if (bad.length) {
    fail(`live URL(s) did not serve ${expectedBuild}: ${bad.map((result) => `${result.url}=${result.status}/${result.build || "NO_BUILD"}`).join(", ")}`);
  }
}

async function main() {
  const { commit, verifyOnly } = parseArgs();
  if (verifyOnly) {
    await verifyLiveBuild(getLocalBuildId());
    console.log("\nLIVE ADMIN VERIFY PASSED");
    return;
  }

  if (!commit.trim()) {
    fail("missing required commit message. Use: npm run ship:live-admin -- --commit \"your message\"");
  }

  assertOnMainAndCurrent();
  if (!statusPorcelain()) {
    fail("working tree is clean. Make the change first, then ship it.");
  }

  const build = bumpAppBuild();
  stageAllowedChanges();
  git(["diff", "--cached", "--check"]);
  run(process.execPath, ["scripts/test-claude-live-ship.mjs"]);
  run(process.execPath, ["scripts/test-auth-boundaries.mjs"]);
  run(process.execPath, ["scripts/test-page-worker.mjs"]);
  run(process.execPath, ["scripts/test-vespergate-world.mjs"]);
  const lateBuildFixes = setAppBuild(build);
  if (lateBuildFixes) console.log(`\nNormalized ${lateBuildFixes} late app file(s) back to ${build}`);
  stageAllowedChanges();
  git(["diff", "--cached", "--check"]);
  const unstaged = git(["diff", "--name-only"], { capture: true });
  if (unstaged) fail(`unstaged tracked changes remain after final staging:\n${unstaged}`);
  git(["commit", "-m", commit.trim()]);
  const trackedDirty = git(["status", "--porcelain", "--untracked-files=no"], { capture: true });
  if (trackedDirty) fail(`tracked files changed during/after commit:\n${trackedDirty}`);
  git(["push", "origin", "main"]);
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join("ops", "admin-live", "Sync-AdminMain.ps1"),
    "-RepoRoot",
    ROOT,
    "-Port",
    "5177",
    "-HermesPort",
    "5190"
  ]);
  await verifyLiveBuild(build);
  const head = git(["rev-parse", "--short", "HEAD"], { capture: true });
  console.log(`\nLIVE ADMIN SHIP PASSED ${head} ${build}`);
}

main().catch((error) => fail(error?.message || String(error)));
