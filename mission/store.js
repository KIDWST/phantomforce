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
