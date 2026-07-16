#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LEDGER = "docs/quality/CHANGE_MEMORY.json";

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    ledger: DEFAULT_LEDGER,
    live: false,
    adminPort: 5177,
    hermesPort: 5190,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo-root") options.repoRoot = argv[++i];
    else if (arg === "--ledger") options.ledger = argv[++i];
    else if (arg === "--live") options.live = true;
    else if (arg === "--admin-port") options.adminPort = Number(argv[++i]);
    else if (arg === "--hermes-port") options.hermesPort = Number(argv[++i]);
    else if (arg === "--json") options.json = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node scripts/guard-change-memory.mjs [--repo-root .] [--ledger docs/quality/CHANGE_MEMORY.json] [--live] [--admin-port 5177] [--hermes-port 5190] [--json]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizePath(value) {
  return path.resolve(String(value || ""));
}

function samePath(left, right) {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function resolveInside(root, relativeFile) {
  if (!relativeFile || typeof relativeFile !== "string") {
    throw new Error("Change memory pattern is missing a file.");
  }
  const resolved = path.resolve(root, relativeFile);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const comparableResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const comparableRootWithSep = process.platform === "win32" ? rootWithSep.toLowerCase() : rootWithSep;
  if (comparableResolved !== comparableRoot && !comparableResolved.startsWith(comparableRootWithSep)) {
    throw new Error(`Change memory file escapes repo root: ${relativeFile}`);
  }
  return resolved;
}

function regexFromPattern(item) {
  if (!item || typeof item.pattern !== "string") {
    throw new Error("Change memory pattern is missing a regex pattern.");
  }
  return new RegExp(item.pattern, item.flags || "m");
}

function firstMatchLine(text, regex) {
  const match = text.match(regex);
  if (!match) return "";
  const index = match.index ?? 0;
  const before = text.slice(0, index);
  const lineNumber = before.split(/\r?\n/u).length;
  const line = text.slice(index).split(/\r?\n/u)[0].trim().slice(0, 160);
  return `line ${lineNumber}: ${line}`;
}

function checkFilePatterns({ repoRoot, rules }) {
  const failures = [];
  const warnings = [];
  let checked = 0;

  for (const rule of rules) {
    const status = rule.status || "active";
    if (!["active", "removed"].includes(status)) {
      failures.push(`${rule.id || "unknown"}: invalid status '${status}'`);
      continue;
    }

    const required = Array.isArray(rule.requiredPatterns) ? rule.requiredPatterns : [];
    const forbidden = Array.isArray(rule.forbiddenPatterns) ? rule.forbiddenPatterns : [];

    if (status === "removed" && required.length) {
      warnings.push(`${rule.id}: removed rule has requiredPatterns; they were ignored.`);
    }

    if (status !== "removed") {
      for (const item of required) {
        checked += 1;
        const file = resolveInside(repoRoot, item.file);
        const label = item.description || item.pattern;
        if (!fs.existsSync(file)) {
          failures.push(`${rule.id}: required file missing: ${item.file} (${label})`);
          continue;
        }
        const text = fs.readFileSync(file, "utf8");
        const regex = regexFromPattern(item);
        if (!regex.test(text)) {
          failures.push(`${rule.id}: missing required pattern in ${item.file}: ${label}`);
        }
      }
    }

    for (const item of forbidden) {
      checked += 1;
      const file = resolveInside(repoRoot, item.file);
      const label = item.description || item.pattern;
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      const regex = regexFromPattern(item);
      if (regex.test(text)) {
        failures.push(`${rule.id}: forbidden pattern returned in ${item.file}: ${label} (${firstMatchLine(text, regex)})`);
      }
    }
  }

  return { failures, warnings, checked };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function headCommit(repoRoot) {
  return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function checkLive({ repoRoot, rules, adminPort, hermesPort }) {
  const failures = [];
  let checked = 0;
  const liveChecks = rules.flatMap((rule) => (Array.isArray(rule.liveChecks) ? rule.liveChecks.map((check) => ({ ...check, ruleId: rule.id })) : []));
  if (!liveChecks.length) return { failures, checked };

  let adminHealth = null;
  let hermesHealth = null;
  let head = null;

  async function getAdminHealth() {
    if (!adminHealth) adminHealth = await fetchJson(`http://127.0.0.1:${adminPort}/health`);
    return adminHealth;
  }

  async function getHermesHealth() {
    if (!hermesHealth) hermesHealth = await fetchJson(`http://127.0.0.1:${hermesPort}/health`);
    return hermesHealth;
  }

  for (const check of liveChecks) {
    checked += 1;
    try {
      if (check.kind === "adminRootEqualsRepoRoot") {
        const health = await getAdminHealth();
        const root = health.root || health.repo_root || "";
        if (!root || !samePath(root, repoRoot)) {
          failures.push(`${check.ruleId}: live admin root is '${root || "missing"}', expected '${repoRoot}'`);
        }
      } else if (check.kind === "adminRootNotMatching") {
        const health = await getAdminHealth();
        const root = String(health.root || health.repo_root || "");
        const regex = new RegExp(check.pattern, check.flags || "i");
        if (regex.test(root)) {
          failures.push(`${check.ruleId}: live admin root matches forbidden stale root '${root}'`);
        }
      } else if (check.kind === "hermesCommitEqualsHead") {
        const health = await getHermesHealth();
        head = head || headCommit(repoRoot);
        const commit = String(health.commit || "");
        if (commit !== head) {
          failures.push(`${check.ruleId}: Hermes commit is '${commit || "missing"}', expected '${head}'`);
        }
      } else {
        failures.push(`${check.ruleId}: unknown live check '${check.kind}'`);
      }
    } catch (error) {
      failures.push(`${check.ruleId}: live check '${check.kind}' failed: ${error.message}`);
    }
  }

  return { failures, checked };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot);
  const ledgerPath = path.isAbsolute(options.ledger) ? options.ledger : path.resolve(repoRoot, options.ledger);
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`Missing change memory ledger: ${ledgerPath}`);
  }

  const ledger = readJson(ledgerPath);
  const rules = Array.isArray(ledger.rules) ? ledger.rules : [];
  if (!rules.length) throw new Error("Change memory ledger has no rules.");

  const fileResult = checkFilePatterns({ repoRoot, rules });
  const liveResult = options.live ? await checkLive({ repoRoot, rules, adminPort: options.adminPort, hermesPort: options.hermesPort }) : { failures: [], checked: 0 };
  const failures = [...fileResult.failures, ...liveResult.failures];
  const warnings = [...fileResult.warnings];
  const checked = fileResult.checked + liveResult.checked;

  const result = {
    ok: failures.length === 0,
    ledger: path.relative(repoRoot, ledgerPath).replaceAll("\\", "/"),
    checked,
    warnings,
    failures,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (failures.length) {
    console.error(`Change memory guard failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
    for (const failure of failures) console.error(`- ${failure}`);
    for (const warning of warnings) console.error(`warning: ${warning}`);
  } else {
    console.log(`Change memory guard passed (${checked} check${checked === 1 ? "" : "s"}).`);
    for (const warning of warnings) console.log(`warning: ${warning}`);
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`Change memory guard crashed: ${error.message}`);
  process.exit(2);
});
