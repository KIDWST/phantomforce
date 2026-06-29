import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOpenRouterGlmAdapterDryRunPreview,
  OPENROUTER_GLM_52_MODEL_ID,
  OPENROUTER_GLM_PROVIDER_ID,
} from "../src/phantom-ai/providers/openrouter-adapter.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../..");
const adapterSourcePath = resolve(repoRoot, "server/src/phantom-ai/providers/openrouter-adapter.ts");
const providerKeyEnvName = ["OPENROUTER", "API", "KEY"].join("_");
const fakeProviderKey = ["sk", "or", "v1", "adaptertest0123456789"].join("-");
const sensitiveName = ["PASS", "WORD"].join("");
const sensitiveValue = ["do", "not", "show", "me"].join("-");
const cardLikeValue = ["4242", "4242", "4242", "4242"].join(" ");

const request: ModelRouterRequest = {
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "openrouter-adapter-test-001",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: "Summarize low-risk trainer content ideas for owner review.",
  business_summary: "Owner-only personal training simulation. External actions approval-only.",
  module_data: [
    {
      module: "Content",
      summary: "Demo content queue for safe review.",
      items: [{ title: "Trainer recap", status: "draft", detail: "No posting or upload." }],
    },
  ],
};

const source = await readFile(adapterSourcePath, "utf8");

assert(!/\bfetch\s*\(/.test(source), "OpenRouter adapter skeleton must not contain fetch calls.");
assert(!/\bhttps?\s*\.\s*request\b/.test(source), "OpenRouter adapter skeleton must not contain HTTP request calls.");
assert(!/openrouter\.ai/i.test(source), "OpenRouter adapter skeleton must not contain a provider URL.");
assert(!/axios\s*\(/i.test(source), "OpenRouter adapter skeleton must not contain axios calls.");
assert(!/undici/i.test(source), "OpenRouter adapter skeleton must not import undici.");

const routedPreview = previewModelRouterFoundation(request, {
  env: {
    PHANTOM_MODEL_ROUTER_MODE: "openrouter",
    [providerKeyEnvName]: fakeProviderKey,
    OPENROUTER_MODEL: OPENROUTER_GLM_52_MODEL_ID,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
  },
});
const firewall = routedPreview.provider_invocation;
const adapter = firewall.openrouter_adapter;

assert(routedPreview.decision.provider_route === "openrouter_glm", "Configured low-risk preview should select OpenRouter route.");
assert(!routedPreview.provider_policy.route_allowed, "Provider policy must keep route_allowed false.");
assert(firewall.live_call_allowed === false, "Provider invocation firewall must keep live calls disabled.");
assert(firewall.execution_disabled === true, "Provider invocation firewall must keep execution disabled.");
assert(adapter !== null, "OpenRouter route should include adapter dry-run metadata.");
assert(adapter.provider_id === OPENROUTER_GLM_PROVIDER_ID, "Adapter provider id should be OpenRouter GLM.");
assert(adapter.model_id === OPENROUTER_GLM_52_MODEL_ID, "Adapter model id should be GLM 5.2.");
assert(adapter.adapter_status === "blocked_dry_run", "Adapter must be blocked dry-run only.");
assert(adapter.live_call_allowed === false, "Adapter must never allow live calls.");
assert(adapter.execution_disabled === true, "Adapter execution must remain disabled.");
assert(adapter.dry_run_response.provider_called === false, "Adapter must not call provider.");
assert(adapter.dry_run_response.network_call_performed === false, "Adapter must not call network.");
assert(adapter.dry_run_response.http_request_prepared === false, "Adapter must not prepare HTTP request.");
assert(adapter.dry_run_response.raw_response === null, "Adapter must not return raw provider response.");
assert(adapter.safety_flags.policy_route_allowed === false, "Adapter safety flags must preserve route_allowed false.");
assert(adapter.safety_flags.readiness_live_call_allowed === false, "Adapter readiness live call flag must be false.");
assert(adapter.required_before_live.length > 0, "Adapter must list prerequisites before live use.");
assert(!/openrouter|glm|z-ai/i.test(adapter.client_safe_summary), "Client-safe adapter summary must not expose provider internals.");

const serializedAdapter = JSON.stringify(adapter);
assert(!serializedAdapter.includes(fakeProviderKey), "Adapter must not expose raw provider key.");

const secretAdapter = buildOpenRouterGlmAdapterDryRunPreview({
  requestId: "openrouter-adapter-test-002",
  redactedPromptSummary: `Preview only. ${sensitiveName}=${sensitiveValue} card ${cardLikeValue}.`,
  estimatedTokens: 800,
  estimatedCostUsd: null,
  providerPolicy: routedPreview.provider_policy,
  readinessRoute: firewall.readiness_route,
  firewallBlockedReasons: firewall.blocked_reasons,
  firewallRequiredBeforeLive: firewall.required_before_live,
});
const serializedSecretAdapter = JSON.stringify(secretAdapter);

assert(!serializedSecretAdapter.includes(sensitiveValue), "Adapter must redact secret-like prompt values.");
assert(!serializedSecretAdapter.includes(cardLikeValue), "Adapter must redact card-like prompt values.");
assert(secretAdapter.dry_run_response.provider_called === false, "Direct adapter preview must not call provider.");
assert(secretAdapter.dry_run_response.network_call_performed === false, "Direct adapter preview must not call network.");

console.log(
  JSON.stringify(
    {
      ok: true,
      route: routedPreview.decision.provider_route,
      modelId: adapter.model_id,
      adapterStatus: adapter.adapter_status,
      liveCallAllowed: adapter.live_call_allowed,
      providerCalled: adapter.dry_run_response.provider_called,
      networkCallPerformed: adapter.dry_run_response.network_call_performed,
      httpRequestPrepared: adapter.dry_run_response.http_request_prepared,
      policyRouteAllowed: routedPreview.provider_policy.route_allowed,
      secretsLeaked:
        serializedAdapter.includes(fakeProviderKey) ||
        serializedSecretAdapter.includes(sensitiveValue) ||
        serializedSecretAdapter.includes(cardLikeValue),
      sourceContainsTransport:
        /\bfetch\s*\(/.test(source) ||
        /\bhttps?\s*\.\s*request\b/.test(source) ||
        /openrouter\.ai/i.test(source),
    },
    null,
    2,
  ),
);
