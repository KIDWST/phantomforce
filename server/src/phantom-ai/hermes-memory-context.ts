import { compileHermesContext } from "./context-compiler.js";
import { redactSensitiveText } from "./hermes-ledger.js";
import { recallHermesMemory } from "./hermes-memory-recall.js";
import type { HermesMemoryItem, HermesMemoryRecallScope } from "./hermes-memory-recall.js";
import type { ContextModuleData, HermesContextPacket, ProviderRoute, SensitivityLevel } from "./types.js";

// Phase 1b: wire Hermes per-user memory recall into PhantomAI context
// preparation. Before any future AI response is prepared, PhantomAI compiles
// the current request context AND recalls the tenant/user/task memory from the
// Hermes ledger, producing a memory-augmented context preview.
//
// Hard boundaries (same dry-run/local ladder):
// - READ ONLY memory: recall never writes; context compile is pure.
// - NO provider request body, NO transport, NO network client, NO live call.
// - REDACTED + BOUNDED + tenant-scoped at every step.
// - OpenRouter/GLM transport stays blocked (flags below are hard literals).

const MAX_MEMORY_SECTION_CHARS = 2400;
const MAX_AUGMENTED_CONTEXT_CHARS = 6000;

export type HermesMemoryContextInput = {
  tenant_id: string;
  business_name: string;
  actor_user_id: string;
  request_id: string;
  task_type: string;
  sensitivity_level: SensitivityLevel;
  provider_route?: ProviderRoute;
  user_request: string;
  business_summary: string;
  module_data: ContextModuleData[];
  relevant_rules?: string[];
  approval_restrictions?: string[];
};

export type HermesMemoryContextPreview = {
  prepared_at: string;
  scope: HermesMemoryRecallScope;
  base_context: {
    tenant_id: string;
    task_type: string;
    sensitivity_level: SensitivityLevel;
    user_request_summary: string;
    compact_context: string;
    context_chars: number;
    estimated_tokens: number;
  };
  memory: {
    ledger_path: string;
    scanned_records: number;
    matched_records: number;
    recalled_count: number;
    has_memory: boolean;
    compact_memory: string;
    items: HermesMemoryItem[];
  };
  augmented_context_preview: string;
  augmented_context_chars: number;
  redaction: {
    redacted: true;
    raw_secret_exposed: false;
    raw_prompt_returned: false;
    raw_memory_returned: false;
  };
  // PhantomAI prepared memory-augmented context only. It did NOT build a
  // provider request. These flags keep OpenRouter/GLM transport blocked.
  provider_request_body_created: false;
  safety_flags: {
    memory_read_only: true;
    local_file_only: true;
    redacted: true;
    tenant_scoped: true;
    bounded: true;
    provider_request_body_created: false;
    provider_transport_allowed: false;
    network_client_implemented: false;
    provider_called: false;
    network_call_performed: false;
    live_call_allowed: false;
    execution_disabled: true;
    ready_for_send: false;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
    production_ledger_write: false;
    raw_secret_exposed: false;
  };
};

function buildAugmentedContext(base: HermesContextPacket, compactMemory: string): string {
  const memorySection = redactSensitiveText(compactMemory).slice(0, MAX_MEMORY_SECTION_CHARS);
  const combined = [
    base.compact_context,
    "",
    "Recalled Hermes memory (per-user, redacted):",
    memorySection,
  ].join("\n");
  return redactSensitiveText(combined).slice(0, MAX_AUGMENTED_CONTEXT_CHARS);
}

export async function buildHermesMemoryContextPreview(
  input: HermesMemoryContextInput,
  options: { ledgerPath?: string; recallLimit?: number | string; now?: string } = {},
): Promise<HermesMemoryContextPreview> {
  const preparedAt = options.now ?? new Date().toISOString();

  const recall = await recallHermesMemory({
    tenantId: input.tenant_id,
    actorUserId: input.actor_user_id,
    taskType: input.task_type,
    limit: options.recallLimit,
    ledgerPath: options.ledgerPath,
    now: preparedAt,
  });

  const base = compileHermesContext({
    tenant_id: input.tenant_id,
    business_name: input.business_name,
    request_id: input.request_id,
    task_type: input.task_type,
    sensitivity_level: input.sensitivity_level,
    provider_route: input.provider_route ?? "mock",
    user_request: input.user_request,
    business_summary: input.business_summary,
    module_data: input.module_data,
    relevant_rules: input.relevant_rules ?? [],
    approval_restrictions: input.approval_restrictions ?? [],
  });

  const augmentedContext = buildAugmentedContext(base, recall.compact_memory);

  return {
    prepared_at: preparedAt,
    scope: recall.scope,
    base_context: {
      tenant_id: base.tenant_id,
      task_type: base.task_type,
      sensitivity_level: base.sensitivity_level,
      user_request_summary: base.user_request_summary,
      compact_context: base.compact_context,
      context_chars: base.context_chars,
      estimated_tokens: base.estimated_tokens,
    },
    memory: {
      ledger_path: recall.ledger_path,
      scanned_records: recall.scanned_records,
      matched_records: recall.matched_records,
      recalled_count: recall.returned_records,
      has_memory: recall.has_memory,
      compact_memory: recall.compact_memory,
      items: recall.items,
    },
    augmented_context_preview: augmentedContext,
    augmented_context_chars: augmentedContext.length,
    redaction: {
      redacted: true,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_memory_returned: false,
    },
    provider_request_body_created: false,
    safety_flags: {
      memory_read_only: true,
      local_file_only: true,
      redacted: true,
      tenant_scoped: true,
      bounded: true,
      provider_request_body_created: false,
      provider_transport_allowed: false,
      network_client_implemented: false,
      provider_called: false,
      network_call_performed: false,
      live_call_allowed: false,
      execution_disabled: true,
      ready_for_send: false,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      production_ledger_write: false,
      raw_secret_exposed: false,
    },
  };
}
