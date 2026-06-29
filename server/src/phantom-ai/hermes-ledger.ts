import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HermesLedgerRecord } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export const DEFAULT_HERMES_LEDGER_PATH = resolve(repoRoot, ".phantom", "hermes-ledger.jsonl");

export function resolveHermesLedgerPath(pathFromEnv = process.env.PHANTOM_HERMES_LEDGER_PATH) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_LEDGER_PATH;
}

export async function appendHermesLedgerRecord(
  record: HermesLedgerRecord,
  options: { ledgerPath?: string } = {},
) {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();
  await mkdir(dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  return { ledgerPath, record };
}

export async function readHermesLedgerRecords(
  options: { ledgerPath?: string; limit?: number } = {},
): Promise<HermesLedgerRecord[]> {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();
  const limit = options.limit ?? 50;

  try {
    const raw = await readFile(ledgerPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as HermesLedgerRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function getHermesLedgerStatus(options: { ledgerPath?: string } = {}) {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();

  try {
    const fileStat = await stat(ledgerPath);
    return {
      enabled: true,
      exists: true,
      ledgerPath,
      bytes: fileStat.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: true,
        exists: false,
        ledgerPath,
        bytes: 0,
      };
    }
    throw error;
  }
}

