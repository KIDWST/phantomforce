import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessApproval, AccessAuditEvent, AccessWorkflowAction } from "./access-workflow.js";
import type { ClientAccessRecord } from "./client-access-state.js";

export type AccessWorkflowSnapshot = {
  actions: AccessWorkflowAction[];
  approvals: AccessApproval[];
  auditEvents: AccessAuditEvent[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(moduleDir, "..", "..", "data");
const dataDir = process.env.PHANTOMFORCE_ACCESS_DATA_DIR || defaultDataDir;

const accessRecordsPath = join(dataDir, "client-access-records.json");
const accessWorkflowPath = join(dataDir, "client-access-workflow.json");
const snapshotsDir = join(dataDir, "snapshots");

function ensureDataDir() {
  mkdirSync(dataDir, { recursive: true });
}

function backupPath(path: string) {
  return `${path}.bak`;
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load access JSON store at ${path}. Restore from ${backupPath(path)} or a snapshot before continuing. ${message}`);
  }
}

function writeJson(path: string, data: unknown) {
  ensureDataDir();

  if (existsSync(path)) {
    copyFileSync(path, backupPath(path));
  }

  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function safeSnapshotLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64) || "snapshot";
}

export function loadClientAccessRecords(fallback: ClientAccessRecord[]) {
  return readJson<ClientAccessRecord[]>(accessRecordsPath) ?? fallback;
}

export function saveClientAccessRecords(records: ClientAccessRecord[]) {
  writeJson(accessRecordsPath, records);
}

export function loadAccessWorkflow() {
  return readJson<AccessWorkflowSnapshot>(accessWorkflowPath) ?? {
    actions: [],
    approvals: [],
    auditEvents: [],
  };
}

export function saveAccessWorkflow(snapshot: AccessWorkflowSnapshot) {
  writeJson(accessWorkflowPath, snapshot);
}

export function createAccessStorageSnapshot(label = "manual") {
  ensureDataDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = join(snapshotsDir, `${timestamp}-${safeSnapshotLabel(label)}`);
  mkdirSync(snapshotPath, { recursive: true });

  if (existsSync(accessRecordsPath)) {
    copyFileSync(accessRecordsPath, join(snapshotPath, "client-access-records.json"));
  }

  if (existsSync(accessWorkflowPath)) {
    copyFileSync(accessWorkflowPath, join(snapshotPath, "client-access-workflow.json"));
  }

  return {
    snapshotPath,
    accessRecordsSnapshotPath: join(snapshotPath, "client-access-records.json"),
    accessWorkflowSnapshotPath: join(snapshotPath, "client-access-workflow.json"),
  };
}

export function accessStoragePaths() {
  return {
    dataDir,
    snapshotsDir,
    accessRecordsPath,
    accessWorkflowPath,
    accessRecordsBackupPath: backupPath(accessRecordsPath),
    accessWorkflowBackupPath: backupPath(accessWorkflowPath),
  };
}
