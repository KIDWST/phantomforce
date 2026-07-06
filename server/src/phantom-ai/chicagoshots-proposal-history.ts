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
const PROPOSAL_STATUSES = ["draft", "sent_manually", "follow_up_needed", "won", "lost"] as const;

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

export type ChicagoShotsProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ChicagoShotsProposalPriorityLabel =
  | "send_now"
  | "follow_up_now"
  | "watch_reply"
  | "delivery_ready"
  | "closed_lost";

export type ChicagoShotsProposalStatusCounts = Record<ChicagoShotsProposalStatus, number> & {
  total: number;
};

export type ChicagoShotsProposalHistoryRecord = {
  id: string;
  created_at: string;
  status: ChicagoShotsProposalStatus;
  status_updated_at: string;
  proposal_priority_score: number;
  proposal_priority_label: ChicagoShotsProposalPriorityLabel;
  proposal_next_action: string;
  proposal_next_action_detail: string;
  proposal_follow_up_timing: string;
  store_kind: "local_admin_only_chicagoshots_proposal_history";
  store_version: 1;
  source_preview_id: string;
  client_name: string;
  event_type: string;
  package: string;
  recommended_package: string;
  recommended_price_range: string;
  delivery_timeline: string;
  follow_up_channel: string;
  quote_draft: ChicagoShotsLeadIntakePreview["quote_draft"];
  client_ready_proposal: string;
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
  status_counts: ChicagoShotsProposalStatusCounts;
  total_count: number;
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

export function normalizeChicagoShotsProposalStatus(value: unknown): ChicagoShotsProposalStatus | null {
  return typeof value === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(value)
    ? (value as ChicagoShotsProposalStatus)
    : null;
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

function emptyStatusCounts(): ChicagoShotsProposalStatusCounts {
  return {
    total: 0,
    draft: 0,
    sent_manually: 0,
    follow_up_needed: 0,
    won: 0,
    lost: 0,
  };
}

function countStatuses(records: ChicagoShotsProposalHistoryRecord[]): ChicagoShotsProposalStatusCounts {
  const counts = emptyStatusCounts();

  for (const record of records) {
    counts.total += 1;
    counts[record.status] += 1;
  }

  return counts;
}

function parseHighestDollarValue(value: string) {
  return Math.max(
    0,
    ...Array.from(value.matchAll(/\$?\s*([0-9][0-9,]*)/g)).map((match) =>
      Number.parseInt(match[1].replace(/,/g, ""), 10),
    ),
  );
}

function buildProposalSalesIntelligence(input: {
  status: ChicagoShotsProposalStatus;
  clientName: string;
  packageName: string;
  recommendedPriceRange: string;
  followUpChannel: string;
}) {
  const priceCeiling = parseHighestDollarValue(input.recommendedPriceRange);
  const priceBoost = priceCeiling >= 2500 ? 10 : priceCeiling >= 1500 ? 6 : priceCeiling >= 750 ? 3 : 0;
  const channel = input.followUpChannel || "manual channel";

  if (input.status === "follow_up_needed") {
    return {
      proposal_priority_score: 90 + priceBoost,
      proposal_priority_label: "follow_up_now" as const,
      proposal_next_action: "Manual follow-up now",
      proposal_next_action_detail: `Use the saved proposal packet to follow up with ${input.clientName} on ${channel}.`,
      proposal_follow_up_timing: "today",
    };
  }

  if (input.status === "sent_manually") {
    return {
      proposal_priority_score: 78 + priceBoost,
      proposal_priority_label: "watch_reply" as const,
      proposal_next_action: "Watch reply window",
      proposal_next_action_detail: `If ${input.clientName} has not answered, mark follow-up needed and prepare the manual follow-up.`,
      proposal_follow_up_timing: "next business day",
    };
  }

  if (input.status === "draft") {
    return {
      proposal_priority_score: 66 + priceBoost,
      proposal_priority_label: "send_now" as const,
      proposal_next_action: "Review and send manually",
      proposal_next_action_detail: `Review the ${input.packageName} proposal, then mark sent manually after Jordan sends it outside the app.`,
      proposal_follow_up_timing: "after manual send",
    };
  }

  if (input.status === "won") {
    return {
      proposal_priority_score: 35 + priceBoost,
      proposal_priority_label: "delivery_ready" as const,
      proposal_next_action: "Schedule delivery kickoff",
      proposal_next_action_detail: `Confirm shoot date, deliverables, and handoff plan for ${input.clientName}.`,
      proposal_follow_up_timing: "delivery planning",
    };
  }

  return {
    proposal_priority_score: 5,
    proposal_priority_label: "closed_lost" as const,
    proposal_next_action: "Archive lesson",
    proposal_next_action_detail: `Capture why ${input.clientName} did not move forward and keep the packet for future reference.`,
    proposal_follow_up_timing: "closed",
  };
}

function withProposalSalesIntelligence(
  record: Omit<
    ChicagoShotsProposalHistoryRecord,
    | "proposal_priority_score"
    | "proposal_priority_label"
    | "proposal_next_action"
    | "proposal_next_action_detail"
    | "proposal_follow_up_timing"
  >,
): ChicagoShotsProposalHistoryRecord {
  return {
    ...record,
    ...buildProposalSalesIntelligence({
      status: record.status,
      clientName: record.client_name,
      packageName: record.package,
      recommendedPriceRange: record.recommended_price_range,
      followUpChannel: record.follow_up_channel,
    }),
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
  clientReadyProposal?: string;
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
  const clientReadyProposal = cleanMultiline(
    input.clientReadyProposal || input.exportedMarkdown,
    MAX_MARKDOWN_CHARS,
  );
  const exportedMarkdown = cleanMultiline(input.exportedMarkdown, MAX_MARKDOWN_CHARS);

  if (!clientReadyProposal) {
    throw new Error("ChicagoShots proposal history requires a client-ready proposal.");
  }

  if (!exportedMarkdown) {
    throw new Error("ChicagoShots proposal history requires exported markdown.");
  }

  const recommendedPackage = clean(input.packet.recommended_service_package.name) || "General Inquiry";

  return withProposalSalesIntelligence({
    id: createHistoryId(input.packet),
    created_at: createdAt,
    status: "draft",
    status_updated_at: createdAt,
    store_kind: "local_admin_only_chicagoshots_proposal_history",
    store_version: 1,
    source_preview_id: input.packet.preview_id,
    client_name: clean(input.packet.normalized_lead.client_name) || "New ChicagoShots lead",
    event_type: clean(input.packet.normalized_lead.event_type || input.packet.normalized_lead.requested_service),
    package: recommendedPackage,
    recommended_package: recommendedPackage,
    recommended_price_range: clean(input.packet.recommended_price_range, 160),
    delivery_timeline: clean(input.packet.delivery_timeline, 360),
    follow_up_channel: clean(input.packet.follow_up_draft.channel_hint, 80),
    quote_draft: redactQuoteDraft(input.packet.quote_draft),
    client_ready_proposal: clientReadyProposal,
    proposal_summary: proposalSummary,
    exported_markdown: exportedMarkdown,
    safety_flags: safetyFlags(),
    local_dev_only: true,
    production_write_allowed: false,
  });
}

function normalizeStoredProposalHistoryRecord(value: unknown): ChicagoShotsProposalHistoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ChicagoShotsProposalHistoryRecord>;
  const flags = record.safety_flags as Partial<ChicagoShotsProposalHistorySafetyFlags> | undefined;
  const status = normalizeChicagoShotsProposalStatus(record.status) ?? "draft";
  const statusUpdatedAt =
    typeof record.status_updated_at === "string" && record.status_updated_at.trim()
      ? record.status_updated_at
      : typeof record.created_at === "string"
        ? record.created_at
        : "";
  const recommendedPackage =
    typeof record.recommended_package === "string" && record.recommended_package.trim()
      ? record.recommended_package
      : record.package;
  const clientReadyProposal =
    typeof record.client_ready_proposal === "string" && record.client_ready_proposal.trim()
      ? record.client_ready_proposal
      : record.exported_markdown;

  if (
    typeof record.id === "string" &&
    typeof record.created_at === "string" &&
    record.store_kind === "local_admin_only_chicagoshots_proposal_history" &&
    record.local_dev_only === true &&
    record.production_write_allowed === false &&
    typeof record.client_name === "string" &&
    typeof record.package === "string" &&
    typeof recommendedPackage === "string" &&
    typeof clientReadyProposal === "string" &&
    typeof record.exported_markdown === "string" &&
    flags?.external_send === false &&
    flags.provider_called === false &&
    flags.n8n_executed === false &&
    flags.approval_executed === false &&
    flags.queue_written === false &&
    flags.production_ledger_write === false &&
    flags.payment_request_created === false &&
    flags.invoice_created === false
  ) {
    return withProposalSalesIntelligence({
      ...record,
      status,
      status_updated_at: statusUpdatedAt,
      recommended_package: recommendedPackage,
      client_ready_proposal: clientReadyProposal,
      safety_flags: safetyFlags(),
      local_dev_only: true,
      production_write_allowed: false,
    } as Omit<
      ChicagoShotsProposalHistoryRecord,
      | "proposal_priority_score"
      | "proposal_priority_label"
      | "proposal_next_action"
      | "proposal_next_action_detail"
      | "proposal_follow_up_timing"
    >);
  }

  return null;
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

        const normalizedRecord = normalizeStoredProposalHistoryRecord(parsed);

        if (normalizedRecord) {
          byId.set(normalizedRecord.id, normalizedRecord);
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }

    const allRecords = Array.from(byId.values()).sort(
      (left, right) =>
        right.proposal_priority_score - left.proposal_priority_score ||
        right.status_updated_at.localeCompare(left.status_updated_at) ||
        right.created_at.localeCompare(left.created_at),
    );
    const statusCounts = countStatuses(allRecords);
    const records = allRecords.slice(0, limit);

    return {
      store_path: storePath,
      limit,
      records,
      status_counts: statusCounts,
      total_count: allRecords.length,
      malformed_lines: malformedLines,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        store_path: storePath,
        limit,
        records: [],
        status_counts: emptyStatusCounts(),
        total_count: 0,
        malformed_lines: 0,
      };
    }

    throw error;
  }
}

export async function updateChicagoShotsProposalHistoryRecordStatus(
  id: string,
  status: ChicagoShotsProposalStatus,
  options: {
    storePath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    updatedAt?: string;
  } = {},
) {
  const current = await readChicagoShotsProposalHistoryRecordById(id, { storePath: options.storePath });

  if (!current) {
    return {
      found: false,
      persistence: null,
      record: null,
    };
  }

  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const updated = withProposalSalesIntelligence({
    ...current,
    status,
    status_updated_at: updatedAt,
    safety_flags: safetyFlags(),
    local_dev_only: true,
    production_write_allowed: false,
  });
  const persistence = await persistChicagoShotsProposalHistoryRecord(updated, {
    storePath: options.storePath,
    env: options.env,
  });

  return {
    found: true,
    persistence,
    record: persistence.record,
  };
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
