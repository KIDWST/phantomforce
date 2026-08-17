import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aiRuntimeProviderModel,
  getAiRuntimeConfig,
  saveAiRuntimeConfig,
} from "../src/phantom-ai/ai-runtime-config.js";
import { claudeModelArgs, resolveClaudeModel } from "../src/phantom-ai/providers/claude-cli-transport.js";
import { callLocalOllamaChat } from "../src/phantom-ai/providers/local-ollama-transport.js";
import { callOpenRouterGlm52 } from "../src/phantom-ai/providers/openrouter-live-transport.js";

const root = await mkdtemp(join(tmpdir(), "phantom-ai-runtime-test-"));

try {
  const initial = await getAiRuntimeConfig("org-a", "owner-a", root);
  assert.equal(initial.source, "default");
  assert.equal(initial.config.primary_provider_id, "local_ollama");
  assert.equal(initial.config.models.local_ollama, "local-auto");

  const saved = await saveAiRuntimeConfig({
    tenantId: "org-a",
    actor: "owner-a",
    root,
    expectedVersion: initial.config.version,
    input: {
      mode: "single",
      primary_provider_id: "claude_cli",
      allowed_provider_ids: ["claude_cli", "openrouter_glm"],
      models: {
        local_ollama: "qwen3:8b",
        codex_cli: "gpt-5.6-sol",
        claude_cli: "claude-sonnet",
        openrouter_glm: "openrouter-auto",
        chatgpt_bridge: "chatgpt-deep",
      },
      fallback_enabled: true,
    },
  });
  assert.equal(saved.config.version, 1);
  assert.equal(saved.config.mode, "single");
  assert.deepEqual(saved.config.allowed_provider_ids, ["claude_cli"]);
  assert.equal(saved.config.fallback_enabled, false);
  assert.equal(saved.config.models.claude_cli, "sonnet");
  assert.equal(saved.config.models.openrouter_glm, "openrouter/auto");
  assert.equal(aiRuntimeProviderModel(saved.config), "sonnet");

  const reread = await getAiRuntimeConfig("org-a", "owner-a", root);
  assert.equal(reread.source, "saved");
  assert.equal(reread.config.primary_provider_id, "claude_cli");
  assert.equal(reread.audit.length, 1);

  await assert.rejects(
    saveAiRuntimeConfig({
      tenantId: "org-a",
      actor: "owner-a",
      root,
      expectedVersion: 999,
      input: { mode: "single", primary_provider_id: "codex_cli", allowed_provider_ids: ["codex_cli"] },
    }),
    /changed from version 999/i,
  );

  const orgB = await getAiRuntimeConfig("org-b", "owner-b", root);
  assert.equal(orgB.source, "default");
  assert.equal(orgB.config.primary_provider_id, "local_ollama");

  const serialized = await readFile(join(root, "org-a.json"), "utf8");
  assert.doesNotMatch(serialized, /api[_-]?key|bearer|password|cookie|token/i);

  assert.equal(resolveClaudeModel("claude-opus"), "opus");
  assert.equal(resolveClaudeModel("claude-sonnet-4-20250514"), "claude-sonnet-4-20250514");
  assert.deepEqual(claudeModelArgs("default"), []);
  assert.deepEqual(claudeModelArgs("sonnet"), ["--model", "sonnet"]);

  let openRouterRequest: Record<string, unknown> = {};
  const openRouter = await callOpenRouterGlm52(
    {
      requestId: "runtime-openrouter-model",
      businessName: "PhantomForce",
      taskType: "page_outcome",
      userMessage: "Return one sentence.",
      compactContext: "No external action.",
      sensitivityLevel: "low",
      approvalRequired: false,
      adminOperatorLane: true,
    },
    {
      env: {
        PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
        PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
        OPENROUTER_API_KEY: "test-only-not-a-real-key",
        OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
      },
      fetchImpl: async (_url, init) => {
        openRouterRequest = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "Selected model answered." } }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } }),
          text: async () => "",
        };
      },
    },
  );
  assert.equal(openRouterRequest.model, "anthropic/claude-sonnet-4");
  assert.equal(openRouter.model_id, "anthropic/claude-sonnet-4");
  assert.equal(openRouter.status, "called");
  assert.equal(openRouter.output_text, "Selected model answered.");

  let localRequest: Record<string, unknown> = {};
  const localAuto = await callLocalOllamaChat(
    {
      requestId: "runtime-local-auto",
      businessName: "PhantomForce",
      taskType: "chat",
      userMessage: "Return one sentence.",
      compactContext: "General conversation.",
      sensitivityLevel: "low",
      approvalRequired: false,
      conversationMode: true,
    },
    {
      env: {
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        PHANTOM_OLLAMA_MODEL: "local-auto",
      },
      fetchImpl: async (url, init) => {
        if (init.method === "GET" && url.endsWith("/api/tags")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ models: [{ name: "qwen3-coder:30b" }, { name: "phantom:latest" }] }),
            text: async () => "",
          };
        }
        localRequest = JSON.parse(init.body || "{}");
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: "The automatic local model answered." } }),
          text: async () => "",
        };
      },
    },
  );
  assert.equal(localRequest.model, "phantom:latest");
  assert.equal(localAuto.requested_model_id, "local-auto");
  assert.equal(localAuto.model_id, "phantom:latest");
  assert.equal(localAuto.fallback_used, false);
  assert.equal(localAuto.status, "called");

  console.log("AI runtime configuration and model transport checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
