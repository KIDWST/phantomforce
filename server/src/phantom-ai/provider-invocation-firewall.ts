import { createHash } from "node:crypto";

import { redactSensitiveText } from "./hermes-ledger.js";
import {
  buildOpenRouterGlmAdapterDryRunPreview,
  OPENROUTER_GLM_PROVIDER_ID,
} from "./providers/openrouter-adapter.js";
import type {
  ProviderInvocationFirewallInput,
  ProviderInvocationFirewallResult,
  ProviderReadinessRoute,
  ProviderReadinessRouteId,
  ProviderRoute,
} from "./types.js";

const MAX_CONTEXT_SUMMARY_CHARS = 1200;

function routeToReadinessRouteId(route: ProviderRoute): ProviderReadinessRouteId | null {
  if (route === "mock" || route === "openrouter_glm" || route === "claude" || route === "local") return route;
  return null;
}

function createInvocationId(input: ProviderInvocationFirewallInput) {
  const digest = createHash("sha256")
    .update(
      [
        input.requested_provider_id,
        input.requested_route,
        input.requested_model_id,
        input.estimated_tokens,
        input.approval_request.approval_id,
        input.policy_result.route_status,
        input.readiness_result.checked_at,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);

  return `inv-${digest}`;
}

function uniqRedacted(values: string[]) {
  return Array.from(new Set(values.map((value) => redactSensitiveText(value)).filter(Boolean)));
}

function findReadinessRoute(input: ProviderInvocationFirewallInput): ProviderReadinessRoute | null {
  const readinessId = routeToReadinessRouteId(input.requested_route);
  if (!readinessId) return null;
  return input.readiness_result.routes.find((route) => route.id === readinessId) ?? null;
}

function getBlockedReasons(input: ProviderInvocationFirewallInput, readinessRoute: ProviderReadinessRoute | null) {
  const reasons: string[] = [];

  if (!input.policy_result.route_allowed) {
    reasons.push("Provider policy route_allowed is false.");
  }

  if (!readinessRoute) {
    reasons.push("Provider readiness route is missing.");
  } else {
    if (!readinessRoute.configured) {
      reasons.push("Provider readiness is missing required configuration.");
    }

    if (!readinessRoute.enabled) {
      reasons.push("Provider readiness route is not enabled for live calls.");
    }

    if (!readinessRoute.live_call_allowed) {
      reasons.push("Provider readiness live_call_allowed is false.");
    }
  }

  if (input.approval_request.status !== "preview-only" || input.approval_request.execution_disabled) {
    reasons.push("Approval preview is not executable and approval execution is not implemented.");
  }

  reasons.push("Provider invocation firewall is dry-run only in this patch.");

  return uniqRedacted(reasons);
}

function buildRequiredBeforeLive(
  input: ProviderInvocationFirewallInput,
  readinessRoute: ProviderReadinessRoute | null,
  blockedReasons: string[],
) {
  return uniqRedacted([
    ...blockedReasons,
    ...input.policy_result.required_before_live_calls,
    ...input.readiness_result.required_before_live,
    ...(readinessRoute?.required_before_live ?? []),
    "Add a separate reviewed live provider implementation after this firewall boundary.",
    "Keep endpoint and UI access admin-only before exposing any provider debug metadata.",
    "Prove no approval execution, billing, upload, post, delete, deploy, or external provider call can run.",
  ]);
}

export function evaluateProviderInvocationFirewall(
  input: ProviderInvocationFirewallInput,
): ProviderInvocationFirewallResult {
  const readinessRoute = findReadinessRoute(input);
  const blockedReasons = getBlockedReasons(input, readinessRoute);
  const contextSummary = redactSensitiveText(input.redacted_context_summary).slice(0, MAX_CONTEXT_SUMMARY_CHARS);
  const requiredBeforeLive = buildRequiredBeforeLive(input, readinessRoute, blockedReasons);
  const readinessConfigured = Boolean(readinessRoute?.configured);
  const openRouterAdapter =
    input.requested_route === OPENROUTER_GLM_PROVIDER_ID
      ? buildOpenRouterGlmAdapterDryRunPreview({
          requestId: input.approval_request.tenant_context.request_id,
          redactedPromptSummary: contextSummary,
          estimatedTokens: input.estimated_tokens,
          estimatedCostUsd: input.estimated_cost_usd,
          providerPolicy: input.policy_result,
          readinessRoute,
          firewallBlockedReasons: blockedReasons,
          firewallRequiredBeforeLive: requiredBeforeLive,
        })
      : null;

  return {
    invocation_id: createInvocationId(input),
    status: "blocked",
    requested_provider_id: redactSensitiveText(input.requested_provider_id),
    requested_route: input.requested_route,
    requested_model_id: redactSensitiveText(input.requested_model_id),
    redacted_context_summary: contextSummary,
    estimated_tokens: Math.max(0, Math.ceil(input.estimated_tokens)),
    estimated_cost_usd: input.estimated_cost_usd === null ? null : Math.max(0, input.estimated_cost_usd),
    action_classification: input.action_classification,
    policy_result: input.policy_result,
    readiness_result: input.readiness_result,
    readiness_route: readinessRoute,
    approval_requirement: {
      approval_required: input.policy_result.approval_required || input.approval_request.status !== "preview-only",
      approval_status: input.approval_request.status,
      risk_level: input.approval_request.risk_level,
      reason: redactSensitiveText(input.approval_request.approval_reason),
    },
    live_call_allowed: false,
    execution_disabled: true,
    blocked_reason: blockedReasons[0] ?? "Provider invocation firewall blocked this preview.",
    blocked_reasons: blockedReasons,
    required_before_live: requiredBeforeLive,
    dry_run_result: {
      provider_called: false,
      network_call_performed: false,
      output_text: "Provider invocation blocked by PhantomForce firewall. No live call was made.",
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
    },
    openrouter_adapter: openRouterAdapter,
    client_safe_summary: "Phantom AI previewed this request safely. No external AI call or live action was taken.",
    admin_debug_summary: redactSensitiveText(
      `Invocation ${input.requested_route}/${input.requested_model_id} blocked. Policy allowed=false; readiness configured=${readinessConfigured}; approval=${input.approval_request.status}.`,
    ),
    safety_flags: {
      live_call_allowed: false,
      execution_disabled: true,
      provider_called: false,
      network_call_performed: false,
      route_allowed: false,
      readiness_configured: readinessConfigured,
      readiness_live_call_allowed: false,
      approval_required: input.policy_result.approval_required || input.approval_request.status !== "preview-only",
      approval_execution_implemented: false,
      raw_secret_exposed: false,
      raw_context_stored: false,
      raw_context_returned: false,
      secrets_stored: false,
      ledger_written: false,
      queue_written: false,
      dry_run_only: true,
      admin_only: true,
    },
  };
}
