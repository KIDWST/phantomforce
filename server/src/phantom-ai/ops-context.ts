import { getProviderSetupStatus } from "./model-router.js";
import { buildToolLanePreview } from "./tool-lane.js";
import { recallHermesInteractionMemory } from "./hermes-interaction-recall.js";
import {
  getChicagoShotsProposalHistoryStatus,
  readChicagoShotsProposalHistoryRecordById,
  readChicagoShotsProposalHistoryRecords,
} from "./chicagoshots-proposal-history.js";

// Phantom AI dashboard context brain.
//
// One read-only, role-aware call that gives the embedded dashboard assistant
// everything it needs to be context-aware in a single round-trip: the active
// module, the safety state, the operator's ChicagoShots proposal history +
// selected packet, tenant memory, and (admin only) provider/tool-lane internals.
//
// This makes Phantom AI feel embedded (the dashboard brain knows where you are
// and what you're working on) and fast (one call instead of many).
//
// Hard boundaries:
// - READ ONLY. Composes existing readers; writes nothing.
// - No provider/GLM call, no n8n execution, no external send, no payment/invoice,
//   no approval execution, no queue/ledger write, no credentials.
// - Role-aware: standard/client sessions never receive admin/provider/debug
//   internals (provider setup, tool-lane/n8n status, business proposal records).

const DEFAULT_TENANT = "chicagoshots";

// The embedded operator actions the assistant can offer. Descriptors only -- the
// UI/assistant uses these to know its capabilities and which dashboard card to
// render. Every action is local/deterministic, dry-run, and approval-gated.
export const EMBEDDED_OPS_ACTIONS = [
  {
    id: "draft_follow_up",
    label: "Draft follow-up",
    endpoint: "/phantom-ai/ops/chicagoshots/lead-intake/preview",
    renders: "follow_up_draft_card",
    dry_run: true,
    approval_gated: true,
  },
  {
    id: "generate_proposal",
    label: "Generate proposal",
    endpoint: "/phantom-ai/ops/chicagoshots/lead-intake/preview",
    renders: "proposal_draft_card",
    dry_run: true,
    approval_gated: true,
  },
  {
    id: "explain_package",
    label: "Explain package recommendation",
    endpoint: "/phantom-ai/ops/chicagoshots/lead-intake/preview",
    renders: "explanation_card",
    dry_run: true,
    approval_gated: false,
  },
  {
    id: "summarize_packet",
    label: "Summarize saved packet",
    endpoint: "/phantom-ai/ops/chicagoshots/proposal-history",
    renders: "summary_card",
    dry_run: true,
    approval_gated: false,
  },
  {
    id: "suggest_next_action",
    label: "Suggest next action",
    endpoint: "/phantom-ai/ops/chicagoshots/proposal-history",
    renders: "next_action_card",
    dry_run: true,
    approval_gated: false,
  },
] as const;

function safetyState() {
  return {
    mode: "local_deterministic_preview",
    read_only: true,
    provider_called: false,
    glm_live_call: false,
    n8n_execution: false,
    external_send: false,
    email_or_social_send: false,
    payment_request: false,
    invoice_created: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_write: false,
    credentials_used: false,
    approvals_execute_endpoint: "absent",
  } as const;
}

function assistantPosture() {
  return {
    embedded: true,
    separate_app: false,
    context_aware: true,
    available: true,
    approval_gated: true,
    draft_mode: "local_deterministic",
  } as const;
}

export type OpsDashboardContext = Awaited<ReturnType<typeof buildOpsDashboardContext>>;

export async function buildOpsDashboardContext(options: {
  isAdmin: boolean;
  tenantId?: string | null;
  actorUserId?: string | null;
  module?: string | null;
  packetId?: string | null;
  now?: string;
  proposalHistoryPath?: string;
  interactionStorePath?: string;
}) {
  const generatedAt = options.now ?? new Date().toISOString();
  const tenantId = (options.tenantId && options.tenantId.trim()) || DEFAULT_TENANT;
  const actorUserId = options.actorUserId?.trim() ? options.actorUserId.trim() : null;
  const currentModule = options.module?.trim() ? options.module.trim().slice(0, 60) : "dashboard";

  // Base context: safe for every authenticated session (no business data,
  // no provider/debug internals).
  const base = {
    ok: true,
    read_only: true,
    generated_at: generatedAt,
    role: options.isAdmin ? "admin" : "standard",
    admin_internals_included: options.isAdmin,
    current_module: currentModule,
    assistant: assistantPosture(),
    safety_state: safetyState(),
    available_actions: EMBEDDED_OPS_ACTIONS.map((action) => ({ ...action })),
  };

  if (!options.isAdmin) {
    // Standard/client sessions get the embedded assistant shell only -- no
    // operator business records, no provider/tool-lane/debug internals.
    return {
      ...base,
      redacted_for_role: true,
      chicagoshots: null,
      memory: null,
      provider: null,
      tool_lane: null,
    };
  }

  // Admin/operator context: compose the operator's real working state.
  const [historyStatus, historyRecords, memory, toolLane] = await Promise.all([
    getChicagoShotsProposalHistoryStatus({ storePath: options.proposalHistoryPath }),
    readChicagoShotsProposalHistoryRecords({ storePath: options.proposalHistoryPath, limit: 5 }),
    recallHermesInteractionMemory({
      tenantId,
      actorUserId,
      storePath: options.interactionStorePath,
      now: generatedAt,
      limit: 5,
    }),
    buildToolLanePreview({ toolId: "n8n" }),
  ]);

  let selectedPacket: unknown = null;
  if (options.packetId?.trim()) {
    const found = await readChicagoShotsProposalHistoryRecordById(options.packetId.trim(), {
      storePath: options.proposalHistoryPath,
    });
    selectedPacket = found ?? null;
  }

  const providerStatus = getProviderSetupStatus();

  return {
    ...base,
    redacted_for_role: false,
    chicagoshots: {
      proposal_history: {
        enabled: historyStatus.enabled,
        exists: historyStatus.exists,
        record_count: historyRecords.records.length,
        recent: historyRecords.records.map((record) => ({
          id: (record as { id?: string }).id ?? "",
          status: (record as { status?: string }).status ?? null,
        })),
      },
      selected_packet: selectedPacket,
    },
    memory: {
      source: "hermes_interaction_memory_store",
      tenant_id: tenantId,
      recalled_count: memory.returned_records,
      has_memory: memory.has_memory,
      compact_memory: memory.compact_memory,
    },
    provider: {
      hermes_status: providerStatus.hermes.status,
      glm_status: providerStatus.openrouter_glm.live_call_ready ? "ready" : "gated_or_off",
      glm_live_call_ready: providerStatus.openrouter_glm.live_call_ready,
      glm_configured: providerStatus.openrouter_glm.configured,
    },
    tool_lane: {
      status: toolLane.status,
      execution_disabled: toolLane.execution_disabled,
      n8n_running: toolLane.n8n_status?.n8n_running ?? false,
      n8n_local_url: toolLane.n8n_status?.n8n_local_url ?? null,
    },
  };
}
