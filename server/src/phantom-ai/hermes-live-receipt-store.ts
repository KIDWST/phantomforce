import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText } from "./hermes-ledger.js";
import type {
  HermesLiveCallReceiptBlockedBooleans,
  HermesLiveCallReceiptContract,
  HermesLiveCallReceiptPersistedRecord,
  HermesLiveCallReceiptPersistenceResult,
  HermesLiveCallReceiptStoreReadResult,
} from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const MAX_RECEIPT_STORE_LIMIT = 50;

export const DEFAULT_HERMES_LIVE_RECEIPT_STORE_PATH = resolve(
  repoRoot,
  ".phantom",
  "hermes-live-receipts.jsonl",
);

const blockedBooleans: HermesLiveCallReceiptBlockedBooleans = {
  providerCalled: false,
  networkCallPerformed: false,
  ledgerWritten: false,
  queueWritten: false,
  approvalExecuted: false,
  readyForSend: false,
};

export function resolveHermesLiveReceiptStorePath(
  pathFromEnv = process.env.PHANTOM_HERMES_LIVE_RECEIPT_STORE_PATH,
) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_LIVE_RECEIPT_STORE_PATH;
}

export function normalizeHermesLiveReceiptStoreLimit(value: number | string | undefined, fallback = 25) {
  const parsedLimit = Number(value ?? fallback);
  return Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_RECEIPT_STORE_LIMIT)
    : fallback;
}

function isLocalDevReceiptStoreAllowed(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return (env.NODE_ENV ?? "development") !== "production";
}

function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    ) as T;
  }

  return value;
}

function createRecordId(contract: HermesLiveCallReceiptContract, persistedAt: string) {
  const digest = createHash("sha256")
    .update(`${contract.contract_id}:${contract.correlation_id}:${persistedAt}`)
    .digest("hex")
    .slice(0, 24);
  return `hermes-live-receipt-store-${digest}`;
}

function assertContractStillBlocked(contract: HermesLiveCallReceiptContract) {
  return (
    contract.providerCalled === false &&
    contract.networkCallPerformed === false &&
    contract.ledgerWritten === false &&
    contract.queueWritten === false &&
    contract.approvalExecuted === false &&
    contract.readyForSend === false &&
    contract.request_receipt.providerCalled === false &&
    contract.request_receipt.networkCallPerformed === false &&
    contract.request_receipt.ledgerWritten === false &&
    contract.request_receipt.queueWritten === false &&
    contract.request_receipt.approvalExecuted === false &&
    contract.request_receipt.readyForSend === false &&
    contract.response_receipt.providerCalled === false &&
    contract.response_receipt.networkCallPerformed === false &&
    contract.response_receipt.ledgerWritten === false &&
    contract.response_receipt.queueWritten === false &&
    contract.response_receipt.approvalExecuted === false &&
    contract.response_receipt.readyForSend === false
  );
}

export function createHermesLiveReceiptPersistedRecord(
  contract: HermesLiveCallReceiptContract,
  options: { persistedAt?: string } = {},
): HermesLiveCallReceiptPersistedRecord {
  if (!assertContractStillBlocked(contract)) {
    throw new Error("Hermes live receipt persistence requires a fully blocked contract.");
  }

  const redactedContract = redactValue(contract);
  const persistedAt = options.persistedAt ?? new Date().toISOString();

  return {
    ...blockedBooleans,
    record_id: createRecordId(redactedContract, persistedAt),
    persisted_at: persistedAt,
    store_kind: "local_dev_only_receipt_store",
    store_version: 1,
    contract_id: redactedContract.contract_id,
    correlation_id: redactedContract.correlation_id,
    provider: redactedContract.provider,
    endpoint_contract: redactedContract.endpoint_contract,
    live_smoke_preflight_id: redactedContract.live_smoke_preflight_id,
    budget_gate_status: redactedContract.budget_gate_status,
    approval_gate_status: redactedContract.approval_gate_status,
    request_receipt: redactedContract.request_receipt,
    response_receipt: redactedContract.response_receipt,
    redaction: redactedContract.redaction,
    ledger_write_mode: "not_written_receipt_store_only",
    queue_write_mode: "not_written_receipt_store_only",
    approval_execution_mode: "not_implemented",
    receipt_store_written: true,
    external_ledger_written: false,
    production_ledger_written: false,
    production_write_allowed: false,
    local_dev_only: true,
    safety_flags: {
      local_file_only: true,
      redacted: true,
      provider_called: false,
      network_call_performed: false,
      request_body_prepared: false,
      ready_for_send: false,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      production_write_allowed: false,
      raw_secret_exposed: false,
    },
  };
}

export async function persistHermesLiveReceiptPreview(
  contract: HermesLiveCallReceiptContract,
  options: {
    storePath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    persistedAt?: string;
  } = {},
): Promise<HermesLiveCallReceiptPersistenceResult> {
  const storePath = options.storePath ?? resolveHermesLiveReceiptStorePath();

  if (!isLocalDevReceiptStoreAllowed(options.env ?? process.env)) {
    return {
      ...blockedBooleans,
      persisted: false,
      reason: "production_write_blocked",
      store_path: storePath,
      record: null,
      external_ledger_written: false,
      production_ledger_written: false,
      production_write_allowed: false,
    };
  }

  const record = createHermesLiveReceiptPersistedRecord(contract, {
    persistedAt: options.persistedAt,
  });
  await mkdir(dirname(storePath), { recursive: true });
  await appendFile(storePath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    ...blockedBooleans,
    persisted: true,
    reason: "persisted_local_dev_only",
    store_path: storePath,
    record,
    external_ledger_written: false,
    production_ledger_written: false,
    production_write_allowed: false,
  };
}

function isHermesLiveReceiptPersistedRecord(value: unknown): value is HermesLiveCallReceiptPersistedRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HermesLiveCallReceiptPersistedRecord>;
  return (
    typeof record.record_id === "string" &&
    record.store_kind === "local_dev_only_receipt_store" &&
    record.local_dev_only === true &&
    record.receipt_store_written === true &&
    record.providerCalled === false &&
    record.networkCallPerformed === false &&
    record.ledgerWritten === false &&
    record.queueWritten === false &&
    record.approvalExecuted === false &&
    record.readyForSend === false &&
    record.request_receipt !== undefined &&
    record.response_receipt !== undefined
  );
}

export async function readHermesLiveReceiptStoreRecords(
  options: { storePath?: string; limit?: number | string } = {},
): Promise<HermesLiveCallReceiptStoreReadResult> {
  const storePath = options.storePath ?? resolveHermesLiveReceiptStorePath();
  const limit = normalizeHermesLiveReceiptStoreLimit(options.limit);

  try {
    const raw = await readFile(storePath, "utf8");
    const records: HermesLiveCallReceiptPersistedRecord[] = [];
    let malformedLines = 0;

    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const parsed = redactValue(JSON.parse(line));

        if (isHermesLiveReceiptPersistedRecord(parsed)) {
          records.push(parsed);
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }

    return {
      store_path: storePath,
      limit,
      records: records.slice(-limit),
      malformed_lines: malformedLines,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        store_path: storePath,
        limit,
        records: [],
        malformed_lines: 0,
      };
    }

    throw error;
  }
}
