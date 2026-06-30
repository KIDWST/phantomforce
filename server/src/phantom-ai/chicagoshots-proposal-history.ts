import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText } from "./hermes-ledger.js";
import type { ChicagoShotsLeadIntakePreview } from "./ops-workflow.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const MAX_HISTORY_LIMIT = 50;
const MAX_MARKDOWN_CHARS = 18_000;
const MAX_SUMMARY_CHARS = 1_200;

export const DEFAULT_CHICAGOSHOTS_PROPOSAL_HISTORY_PATH = resolve(
  repoRoot,
  ".phantom",
  "chicagoshots-proposal-history.jsonl",
);

export type ChicagoShotsProposalHistorySafetyFlags = {
  local_only: true;
  admin_only: true;
  external_send: false;
  provider_called: false;
  n8n_executed: false;
  approval_executed: false;
  queue_written: false;
  production_ledger_write: false;
  payment_request_created: false;
  invoice_created: false;
  raw_secret_exposed: false;
};

export type ChicagoShotsProposalHistoryRecord = {
  id: string;
  created_at: string;
  store_kind: "local_admin_only_chicagoshots_proposal_history";
  store_version: 1;
  source_preview_id: string;
  client_name: string;
  event_type: string;
  package: string;
  recommended_price_range: string;
  delivery_timeline: string;
  follow_up_channel: string;
  quote_draft: ChicagoShotsLeadIntakePreview["quote_draft"];
  proposal_summary: string;
  exported_markdown: string;
  safety_flags: ChicagoShotsProposalHistorySafetyFlags;
  local_dev_only: true;
  production_write_allowed: false;
};

export type ChicagoShotsProposalHistoryPersistenceResult = {
  persisted: boolean;
  reason: "persisted_local_admin_only" | "production_write_blocked";
  store_path: string;
  record: ChicagoShotsProposalHistoryRecord | null;
  safety_flags: ChicagoShotsProposalHistorySafetyFlags;
};

export type ChicagoShotsProposalHistoryReadResult = {
  store_path: string;
  limit: number;
  records: ChicagoShotsProposalHistoryRecord[];
  malformed_lines: number;
};

export type ChicagoShotsProposalHistoryStatus = {
  enabled: true;
  exists: boolean;
  store_path: string;
  bytes: number;
  local_dev_only: true;
  admin_only: true;
  production_write_allowed: false;
};

export function resolveChicagoShotsProposalHistoryPath(
  pathFromEnv = process.env.PHANTOM_CHICAGOSHOTS_PROPOSAL_HISTORY_PATH,
) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_CHICAGOSHOTS_PROPOSAL_HISTORY_PATH;
}

export function normalizeChicagoShotsProposalHistoryLimit(value: number | string | undefined, fallback = 10) {
  const parsedLimit = Number(value ?? fallback);
  return Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_HISTORY_LIMIT)
    : fallback;
}

function isLocalProposalHistoryWriteAllowed(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return (env.NODE_ENV ?? "development") !== "production";
}

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? redactSensitiveText(value.replace(/\s+/g, " ").trim()).slice(0, max) : "";
}

function cleanMultiline(value: unknown, max: number) {
  return typeof value === "string" ? redactSensitiveText(value).trim().slice(0, max) : "";
}

function safetyFlags(): ChicagoShotsProposalHistorySafetyFlags {
  return {
    local_only: true,
    admin_only: true,
    external_send: false,
    provider_called: false,
    n8n_executed: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    payment_request_created: false,
    invoice_created: false,
    raw_secret_exposed: false,
  };
}

function assertPacketStillSafe(packet: ChicagoShotsLeadIntakePreview) {
  const flags = packet.safety_flags;
  return (
    packet.quote_draft.would_send === false &&
    packet.quote_draft.payment_request_created === false &&
    packet.quote_draft.invoice_created === false &&
    packet.follow_up_draft.would_send === false &&
    packet.approval_preview.execution_disabled === true &&
    packet.approval_preview.requires_approval_before_send === true &&
    flags.provider_called === false &&
    flags.network_call_performed === false &&
    flags.external_send === false &&
    flags.would_send === false &&
    flags.approval_executed === false &&
    flags.queue_written === false &&
    flags.production_ledger_write === false &&
    flags.raw_secret_exposed === false
  );
}

function createHistoryId(packet: ChicagoShotsLeadIntakePreview) {
  const digest = createHash("sha256")
    .update(`${packet.preview_id}:${packet.normalized_lead.tenant_id}:${packet.prepared_at}`)
    .digest("hex")
    .slice(0, 24);
  return `chicagoshots-proposal-${digest}`;
}

function redactQuoteDraft(
  quoteDraft: ChicagoShotsLeadIntakePreview["quote_draft"],
): ChicagoShotsLeadIntakePreview["quote_draft"] {
  return {
    title: clean(quoteDraft.title),
    summary: clean(quoteDraft.summary, MAX_SUMMARY_CHARS),
    line_items: quoteDraft.line_items.map((item) => clean(item, 360)),
    recommended_price_range: clean(quoteDraft.recommended_price_range, 120),
    payment_terms_note: clean(quoteDraft.payment_terms_note, 360),
    delivery_timeline: clean(quoteDraft.delivery_timeline, 360),
    upsell_options: quoteDraft.upsell_options.map((item) => clean(item, 160)),
    assumptions: quoteDraft.assumptions.map((item) => clean(item, 360)),
    would_send: false,
    payment_request_created: false,
    invoice_created: false,
  };
}

export function createChicagoShotsProposalHistoryRecord(input: {
  packet: ChicagoShotsLeadIntakePreview;
  proposalSummary: string;
  exportedMarkdown: string;
  createdAt?: string;
}): ChicagoShotsProposalHistoryRecord {
  if (!assertPacketStillSafe(input.packet)) {
    throw new Error("ChicagoShots proposal history only accepts fully blocked preview packets.");
  }

  const createdAt = input.createdAt ?? input.packet.prepared_at;
  const proposalSummary =
    cleanMultiline(input.proposalSummary, MAX_SUMMARY_CHARS) ||
    clean(input.packet.quote_draft.summary, MAX_SUMMARY_CHARS);
  const exportedMarkdown = cleanMultiline(input.exportedMarkdown, MAX_MARKDOWN_CHARS);

  if (!exportedMarkdown) {
    throw new Error("ChicagoShots proposal history requires exported markdown.");
  }

  return {
    id: createHistoryId(input.packet),
    created_at: createdAt,
    store_kind: "local_admin_only_chicagoshots_proposal_history",
    store_version: 1,
    source_preview_id: input.packet.preview_id,
    client_name: clean(input.packet.normalized_lead.client_name) || "New ChicagoShots lead",
    event_type: clean(input.packet.normalized_lead.event_type || input.packet.normalized_lead.requested_service),
    package: clean(input.packet.recommended_service_package.name) || "General Inquiry",
    recommended_price_range: clean(input.packet.recommended_price_range, 160),
    delivery_timeline: clean(input.packet.delivery_timeline, 360),
    follow_up_channel: clean(input.packet.follow_up_draft.channel_hint, 80),
    quote_draft: redactQuoteDraft(input.packet.quote_draft),
    proposal_summary: proposalSummary,
    exported_markdown: exportedMarkdown,
    safety_flags: safetyFlags(),
    local_dev_only: true,
    production_write_allowed: false,
  };
}

function isChicagoShotsProposalHistoryRecord(value: unknown): value is ChicagoShotsProposalHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ChicagoShotsProposalHistoryRecord>;
  const flags = record.safety_flags as Partial<ChicagoShotsProposalHistorySafetyFlags> | undefined;

  return (
    typeof record.id === "string" &&
    typeof record.created_at === "string" &&
    record.store_kind === "local_admin_only_chicagoshots_proposal_history" &&
    record.local_dev_only === true &&
    record.production_write_allowed === false &&
    typeof record.client_name === "string" &&
    typeof record.package === "string" &&
    typeof record.exported_markdown === "string" &&
    flags?.external_send === false &&
    flags.provider_called === false &&
    flags.n8n_executed === false &&
    flags.approval_executed === false &&
    flags.queue_written === false &&
    flags.production_ledger_write === false &&
    flags.payment_request_created === false &&
    flags.invoice_created === false
  );
}

export async function persistChicagoShotsProposalHistoryRecord(
  record: ChicagoShotsProposalHistoryRecord,
  options: {
    storePath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  } = {},
): Promise<ChicagoShotsProposalHistoryPersistenceResult> {
  const storePath = options.storePath ?? resolveChicagoShotsProposalHistoryPath();
  const flags = safetyFlags();

  if (!isLocalProposalHistoryWriteAllowed(options.env ?? process.env)) {
    return {
      persisted: false,
      reason: "production_write_blocked",
      store_path: storePath,
      record: null,
      safety_flags: flags,
    };
  }

  await mkdir(dirname(storePath), { recursive: true });
  await appendFile(storePath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    persisted: true,
    reason: "persisted_local_admin_only",
    store_path: storePath,
    record,
    safety_flags: flags,
  };
}

export async function readChicagoShotsProposalHistoryRecords(
  options: { storePath?: string; limit?: number | string } = {},
): Promise<ChicagoShotsProposalHistoryReadResult> {
  const storePath = options.storePath ?? resolveChicagoShotsProposalHistoryPath();
  const limit = normalizeChicagoShotsProposalHistoryLimit(options.limit);

  try {
    const raw = await readFile(storePath, "utf8");
    const byId = new Map<string, ChicagoShotsProposalHistoryRecord>();
    let malformedLines = 0;

    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as unknown;

        if (isChicagoShotsProposalHistoryRecord(parsed)) {
          byId.set(parsed.id, parsed);
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }

    const records = Array.from(byId.values())
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(-limit)
      .reverse();

    return {
      store_path: storePath,
      limit,
      records,
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

export async function readChicagoShotsProposalHistoryRecordById(
  id: string,
  options: { storePath?: string } = {},
) {
  const history = await readChicagoShotsProposalHistoryRecords({
    storePath: options.storePath,
    limit: MAX_HISTORY_LIMIT,
  });

  return history.records.find((record) => record.id === id) ?? null;
}

export async function getChicagoShotsProposalHistoryStatus(options: { storePath?: string } = {}) {
  const storePath = options.storePath ?? resolveChicagoShotsProposalHistoryPath();

  try {
    const fileStat = await stat(storePath);
    return {
      enabled: true,
      exists: true,
      store_path: storePath,
      bytes: fileStat.size,
      local_dev_only: true,
      admin_only: true,
      production_write_allowed: false,
    } satisfies ChicagoShotsProposalHistoryStatus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: true,
        exists: false,
        store_path: storePath,
        bytes: 0,
        local_dev_only: true,
        admin_only: true,
        production_write_allowed: false,
      } satisfies ChicagoShotsProposalHistoryStatus;
    }

    throw error;
  }
}
