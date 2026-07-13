// Plain-file mission persistence: .termina/missions/<id>/{mission.json,
// ledger.jsonl, report.md}. No database — missions are inspectable directly
// on disk, matching the "preserve proof of what each worker actually
// completed" requirement.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function missionsRoot(appDir) {
  return path.join(appDir, ".termina", "missions");
}

export function missionDir(appDir, id) {
  return path.join(missionsRoot(appDir), id);
}

export function createMissionDir(appDir, id) {
  const dir = missionDir(appDir, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeMissionSync(appDir, id, data) {
  const dir = createMissionDir(appDir, id);
  writeFileSync(path.join(dir, "mission.json"), JSON.stringify(data, null, 2), "utf8");
}

export async function writeMission(appDir, id, data) {
  const dir = createMissionDir(appDir, id);
  await writeFile(path.join(dir, "mission.json"), JSON.stringify(data, null, 2), "utf8");
}

export function readMission(appDir, id) {
  const file = path.join(missionDir(appDir, id), "mission.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function listMissionIds(appDir) {
  const root = missionsRoot(appDir);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export async function appendLedger(appDir, id, event) {
  const dir = createMissionDir(appDir, id);
  const line = JSON.stringify({ ts: Date.now(), ...event });
  await appendFile(path.join(dir, "ledger.jsonl"), line + "\n", "utf8");
}

export function readLedger(appDir, id) {
  const file = path.join(missionDir(appDir, id), "ledger.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function writeReport(appDir, id, markdown) {
  const dir = createMissionDir(appDir, id);
  await writeFile(path.join(dir, "report.md"), markdown, "utf8");
}

export function readReport(appDir, id) {
  const file = path.join(missionDir(appDir, id), "report.md");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export async function writeReportJson(appDir, id, report) {
  const dir = createMissionDir(appDir, id);
  await writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
}

export function readReportJson(appDir, id) {
  const file = path.join(missionDir(appDir, id), "report.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Same read-modify-write-with-per-file-lock shape as writeTokens above —
// concurrent Approve/Skip clicks on different steps are just as possible as
// concurrent worker token polls.
const reportApprovalWriteLocks = new Map();
export async function writeReportApproval(appDir, id, stepId, decision) {
  const dir = createMissionDir(appDir, id);
  const file = path.join(dir, "report-approvals.json");
  const prev = reportApprovalWriteLocks.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    let all = {};
    if (existsSync(file)) {
      try {
        all = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        all = {};
      }
    }
    all[stepId] = decision;
    await writeFile(file, JSON.stringify(all, null, 2), "utf8");
    return all;
  });
  reportApprovalWriteLocks.set(file, run);
  try {
    return await run;
  } finally {
    if (reportApprovalWriteLocks.get(file) === run) reportApprovalWriteLocks.delete(file);
  }
}

export function readReportApprovals(appDir, id) {
  const file = path.join(missionDir(appDir, id), "report-approvals.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// tokens.json holds current per-worker totals (overwritten each poll, not
// append-only — it's a rollup, not an event log); tokens-history.jsonl
// appends one cost sample per poll so the Mission DVR timeline can render a
// cost-over-time sparkline.
//
// writeTokens is a read-modify-write on the whole rollup, so concurrent calls
// (five mission workers polling at once) would otherwise interleave and clobber
// each other's entries. Serialize per-file with a promise chain so each
// read→merge→write runs to completion before the next begins.
const tokenWriteLocks = new Map();
export async function writeTokens(appDir, missionId, workerId, usage) {
  const dir = createMissionDir(appDir, missionId);
  const file = path.join(dir, "tokens.json");
  const prev = tokenWriteLocks.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    let all = {};
    if (existsSync(file)) {
      try {
        all = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        all = {};
      }
    }
    all[workerId] = { ...usage, updatedAt: Date.now() };
    await writeFile(file, JSON.stringify(all, null, 2), "utf8");
    await appendFile(path.join(dir, "tokens-history.jsonl"), JSON.stringify({ ts: Date.now(), workerId, costUsd: usage.costUsd }) + "\n", "utf8");
  });
  tokenWriteLocks.set(file, run);
  try {
    await run;
  } finally {
    if (tokenWriteLocks.get(file) === run) tokenWriteLocks.delete(file);
  }
}

export function readTokens(appDir, missionId) {
  const file = path.join(missionDir(appDir, missionId), "tokens.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function readTokenHistory(appDir, missionId) {
  const file = path.join(missionDir(appDir, missionId), "tokens-history.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
