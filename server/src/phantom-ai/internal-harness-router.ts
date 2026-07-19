import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactPersonalDataText } from "./hermes-ledger.js";
import type { SensitivityLevel } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const DEFAULT_PI_COMMAND_CANDIDATES = [
  resolve(repoRoot, "node_modules", ".bin", "pi.cmd"),
  resolve(repoRoot, "node_modules", ".bin", "pi"),
  resolve(homedir(), "AppData", "Roaming", "npm", "pi.cmd"),
  resolve(homedir(), ".npm-global", "bin", "pi"),
];

export type InternalHarnessId = "primary_operator" | "premium_reviewer" | "minimal_agent_harness";

export type InternalHarnessReadiness = {
  checked_at: string;
  user_facing_name: "Phantom Operator";
  hidden_infrastructure: true;
  customer_visible: false;
  ready_for_internal_use: boolean;
  preferred_public_label: "Phantom Operator";
  candidates: Array<{
    id: InternalHarnessId;
    label: string;
    enabled: boolean;
    installed: boolean;
    configured: boolean;
    command_source: "env_path" | "known_path" | "path_lookup_only" | "not_found" | "built_in";
    command_preview: string;
    allowed_mode: string;
    intended_use: string;
    blocked_actions: string[];
    customer_visible: false;
  }>;
  safety_flags: {
    readiness_only: true;
    process_spawned: false;
    network_check_performed: false;
    provider_called: false;
    external_action_performed: false;
    package_installed: false;
    credential_used: false;
    raw_secret_exposed: false;
    customer_visible: false;
    raw_harness_name_exposed_to_clients: false;
  };
};

export type InternalHarnessSelection = {
  selected: InternalHarnessId;
  customer_visible_label: "Phantom Operator";
  raw_harness_name_exposed: false;
  reason: string;
  execution_enabled: false;
  approval_required: boolean;
};

function envEnabled(value: string | undefined) {
  return value === "true";
}

function hasPathSeparator(value: string) {
  return /[\\/]/.test(value);
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function redactPath(path: string) {
  return redactPersonalDataText(path).replace(homedir(), "~").slice(0, 220);
}

async function resolvePiCommand(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  candidatePaths = DEFAULT_PI_COMMAND_CANDIDATES,
) {
  const configured = env.PHANTOM_PI_COMMAND?.trim();

  if (configured && hasPathSeparator(configured)) {
    return {
      installed: await pathExists(resolve(configured)),
      command_source: "env_path" as const,
      command_preview: redactPath(resolve(configured)),
    };
  }

  for (const candidate of candidatePaths) {
    if (await pathExists(candidate)) {
      return {
        installed: true,
        command_source: "known_path" as const,
        command_preview: redactPath(candidate),
      };
    }
  }

  if (configured) {
    return {
      installed: true,
      command_source: "path_lookup_only" as const,
      command_preview: redactPersonalDataText(configured).slice(0, 80),
    };
  }

  return {
    installed: false,
    command_source: "not_found" as const,
    command_preview: "not configured",
  };
}

const BASE_BLOCKED_ACTIONS = [
  "customer_visible_branding",
  "external_send",
  "social_post",
  "file_upload",
  "deploy",
  "payment_or_invoice",
  "credential_write",
  "background_daemon",
  "third_party_package_install",
  "production_mutation_without_receipt",
];

export async function inspectInternalHarnessReadiness(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: { checkedAt?: string; candidatePaths?: string[] } = {},
): Promise<InternalHarnessReadiness> {
  const pi = await resolvePiCommand(env, options.candidatePaths);
  const piEnabled = envEnabled(env.PHANTOM_PI_HARNESS_ENABLED);
  const readyForInternalUse = piEnabled && pi.installed;
  const checkedAt = options.checkedAt ?? new Date().toISOString();

  return {
    checked_at: checkedAt,
    user_facing_name: "Phantom Operator",
    hidden_infrastructure: true,
    customer_visible: false,
    ready_for_internal_use: readyForInternalUse,
    preferred_public_label: "Phantom Operator",
    candidates: [
      {
        id: "primary_operator",
        label: "Primary operator brain",
        enabled: true,
        installed: true,
        configured: true,
        command_source: "built_in",
        command_preview: "private operator lane",
        allowed_mode: "admin_internal_default",
        intended_use: "Default PhantomForce admin work, coding plans, artifact drafts, and operator answers.",
        blocked_actions: BASE_BLOCKED_ACTIONS,
        customer_visible: false,
      },
      {
        id: "premium_reviewer",
        label: "Premium reviewer brain",
        enabled: envEnabled(env.PHANTOM_CLAUDE_CLI_ENABLED) || Boolean(env.PHANTOM_CLAUDE_CLI_COMMAND?.trim()),
        installed: true,
        configured: envEnabled(env.PHANTOM_CLAUDE_CLI_ENABLED) || Boolean(env.PHANTOM_CLAUDE_CLI_COMMAND?.trim()),
        command_source: "built_in",
        command_preview: "private review lane",
        allowed_mode: "admin_internal_review_only",
        intended_use: "Second-opinion review for UI, copy, implementation plans, and risk checks.",
        blocked_actions: BASE_BLOCKED_ACTIONS,
        customer_visible: false,
      },
      {
        id: "minimal_agent_harness",
        label: "Hidden minimal harness",
        enabled: piEnabled,
        installed: pi.installed,
        configured: readyForInternalUse,
        command_source: pi.command_source,
        command_preview: pi.command_preview,
        allowed_mode: "hidden_optional_fallback",
        intended_use:
          "Optional invisible harness for prompt templates, context engineering, lightweight workflow experiments, and internal operator fallbacks.",
        blocked_actions: [
          ...BASE_BLOCKED_ACTIONS,
          "extension_install_without_review",
          "project_trust_bypass",
          "telemetry_or_update_check_without_wrapper",
          "raw_tool_name_display",
        ],
        customer_visible: false,
      },
    ],
    safety_flags: {
      readiness_only: true,
      process_spawned: false,
      network_check_performed: false,
      provider_called: false,
      external_action_performed: false,
      package_installed: false,
      credential_used: false,
      raw_secret_exposed: false,
      customer_visible: false,
      raw_harness_name_exposed_to_clients: false,
    },
  };
}

export function clientSafeInternalHarnessSummary(readiness: InternalHarnessReadiness) {
  return {
    user_facing_name: readiness.user_facing_name,
    ready: readiness.ready_for_internal_use,
    hidden_infrastructure: true,
    details_redacted: true,
    raw_harness_name_exposed: false,
    customer_visible: false,
    safety_flags: {
      external_action_performed: false,
      credential_used: false,
      raw_secret_exposed: false,
    },
  };
}

export function selectInternalHarnessForTask(
  input: {
    taskType?: string;
    userMessage: string;
    sensitivityLevel?: SensitivityLevel;
    approvalRequired?: boolean;
  },
  readiness: InternalHarnessReadiness,
): InternalHarnessSelection {
  const text = `${input.taskType ?? ""} ${input.userMessage}`.toLowerCase();
  const piCandidate = readiness.candidates.find((candidate) => candidate.id === "minimal_agent_harness");
  const lowRiskHarnessWork =
    /(prompt template|context engineering|agent harness|workflow extension|terminal workflow|session tree|compact|skill package|coding harness)/i.test(
      text,
    );
  const canUseMinimalHarness =
    Boolean(piCandidate?.configured) &&
    input.sensitivityLevel !== "high" &&
    input.approvalRequired !== true &&
    lowRiskHarnessWork;

  if (canUseMinimalHarness) {
    return {
      selected: "minimal_agent_harness",
      customer_visible_label: "Phantom Operator",
      raw_harness_name_exposed: false,
      reason: "A hidden internal harness can help with low-risk workflow/context scaffolding without surfacing tool branding.",
      execution_enabled: false,
      approval_required: false,
    };
  }

  return {
    selected: "primary_operator",
    customer_visible_label: "Phantom Operator",
    raw_harness_name_exposed: false,
    reason: "Default private operator lane remains the safest route for this request.",
    execution_enabled: false,
    approval_required: input.approvalRequired === true,
  };
}
