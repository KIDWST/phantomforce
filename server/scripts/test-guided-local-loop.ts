import { strict as assert } from "node:assert";

import {
  backendProviderForLoopProvider,
  isForbiddenConsumerChatSupervisor,
  normalizeGuidedLoopConfig,
  runGuidedLocalSupervisorLoop,
  type GuidedLoopChatContext,
} from "../src/phantom-ai/guided-local-loop.js";
import type { AdminProviderId } from "../src/phantom-ai/admin-provider-manager.js";

assert.equal(backendProviderForLoopProvider("openai"), "codex_cli");
assert.equal(backendProviderForLoopProvider("claude"), "claude_cli");
assert.equal(backendProviderForLoopProvider("glm"), "openrouter_glm");
assert.equal(isForbiddenConsumerChatSupervisor("chatgpt_browser"), true);
assert.equal(isForbiddenConsumerChatSupervisor("consumer_chatgpt"), true);

const config = normalizeGuidedLoopConfig(
  {
    enabled: true,
    target_provider: "openai",
    target_model: "gpt-5.5",
    max_passes: 3,
    share_private_context: false,
    allow_tool_calls: true,
    proof_logging: true,
  },
  { requestedProviderId: "local_ollama", defaultSupervisorProviderId: "codex_cli" },
);

assert.ok(config, "guided loop config should normalize");
assert.equal(config.supervisor_provider_id, "codex_cli");
assert.equal(config.allow_tool_calls, false, "tool calls must stay disabled inside guided local loops");
assert.equal(config.consumer_chatgpt_browser_automation, false);

const ctx: GuidedLoopChatContext = {
  requestId: "loop-test",
  businessName: "PhantomForce",
  taskType: "strategy",
  userMessage: "Help me improve PhantomBot local mode.",
  compactContext: "Private command center context.",
  sensitivityLevel: "medium",
  approvalRequired: false,
  executionMode: "approval",
  routeTier: "deep",
};

const calls: Array<{ providerId: AdminProviderId; userMessage: string; compactContext: string }> = [];
const run = await runGuidedLocalSupervisorLoop(config, ctx, async (providerId, nextCtx) => {
  calls.push({ providerId, userMessage: nextCtx.userMessage, compactContext: nextCtx.compactContext });
  const output =
    calls.length === 1
      ? "Local draft with rough but private reasoning."
      : calls.length === 2
        ? "Supervisor says: tighten the product answer and keep approval gates."
        : "Final local answer after supervisor guidance.";
  return {
    provider_id: providerId,
    model_id: providerId,
    status: "called",
    output_text: output,
    provider_called: true,
    network_call_performed: true,
    request_body_prepared: true,
  };
});

assert.deepEqual(calls.map((call) => call.providerId), ["local_ollama", "codex_cli", "local_ollama"]);
assert.equal(run.guidedLoop.status, "completed");
assert.equal(run.guidedLoop.safety_flags.consumer_chatgpt_browser_automation_blocked, true);
assert.equal(run.guidedLoop.safety_flags.external_action_executed, false);
assert.equal(run.result.output_text, "Final local answer after supervisor guidance.");
assert.match(calls[1].compactContext, /Private workspace context is intentionally withheld/);
assert.doesNotMatch(calls[1].compactContext, /Private command center context/);

const autoConfig = normalizeGuidedLoopConfig(null, {
  requestedProviderId: "local_ollama",
  defaultSupervisorProviderId: "claude_cli",
  localAutoSupervisor: true,
});
assert.ok(autoConfig);
assert.equal(autoConfig.source, "local_auto_supervisor");
assert.equal(autoConfig.supervisor_provider_id, "claude_cli");

console.log("Guided local supervisor loop checks passed.");
