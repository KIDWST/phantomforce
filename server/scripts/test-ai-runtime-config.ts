import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aiRuntimeRouteForSurface,
  aiRuntimeProviderModel,
  getAiRuntimeConfig,
  saveAiRuntimeConfig,
} from "../src/phantom-ai/ai-runtime-config.js";
import {
  deleteAiProviderCredential,
  getAiProviderCredential,
  getAiProviderCredentialStatus,
  saveAiProviderCredential,
} from "../src/phantom-ai/ai-provider-credentials.js";
import { claudeModelArgs, resolveClaudeModel } from "../src/phantom-ai/providers/claude-cli-transport.js";
import { callDeepSeekV4Flash } from "../src/phantom-ai/providers/deepseek-v4-transport.js";
import { callLocalOllamaChat } from "../src/phantom-ai/providers/local-ollama-transport.js";
import {
  OPENROUTER_KEY_VALIDATION_TIMEOUT_MS,
  validateOpenRouterCredential,
} from "../src/phantom-ai/providers/openrouter-credential-validation.js";
import { callOpenRouterGlm52 } from "../src/phantom-ai/providers/openrouter-live-transport.js";
import {
  fetchOpenRouterModels,
  OPENROUTER_MODELS_TIMEOUT_MS,
  parseOpenRouterModels,
} from "../src/phantom-ai/providers/openrouter-models.js";

const root = await mkdtemp(join(tmpdir(), "phantom-ai-runtime-test-"));
const credentialRoot = await mkdtemp(join(tmpdir(), "phantom-ai-credentials-test-"));
const credentialEnv = { PHANTOMFORCE_AI_CREDENTIALS_SECRET: "test-only-credential-encryption-secret" };

try {
  const initial = await getAiRuntimeConfig("org-a", "owner-a", root);
  assert.equal(initial.source, "default");
  assert.equal(initial.config.primary_provider_id, "deepseek_api");
  assert.equal(initial.config.models.deepseek_api, "deepseek-v4-flash");
  assert.equal(initial.config.phantom_bot.primary_provider_id, "local_ollama");
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
        deepseek_api: "deepseek-v4-flash",
        local_ollama: "qwen3:8b",
        codex_cli: "gpt-5.6-sol",
        claude_cli: "claude-sonnet",
        openrouter_glm: "openrouter-auto",
        chatgpt_bridge: "chatgpt-deep",
      },
      fallback_enabled: true,
      phantom_bot: {
        mode: "single",
        primary_provider_id: "local_ollama",
        allowed_provider_ids: ["local_ollama"],
        models: {
          deepseek_api: "deepseek-v4-flash",
          local_ollama: "phantom-v1:latest",
          codex_cli: "gpt-5.5",
          claude_cli: "default",
          openrouter_glm: "openrouter/auto",
          chatgpt_bridge: "chatgpt-standard",
        },
        fallback_enabled: false,
      },
    },
  });
  assert.equal(saved.config.version, 1);
  assert.equal(saved.config.mode, "single");
  assert.deepEqual(saved.config.allowed_provider_ids, ["claude_cli"]);
  assert.equal(saved.config.fallback_enabled, false);
  assert.equal(saved.config.models.claude_cli, "sonnet");
  assert.equal(saved.config.models.openrouter_glm, "openrouter/auto");
  assert.equal(aiRuntimeProviderModel(saved.config), "sonnet");
  assert.equal(saved.config.phantom_bot.primary_provider_id, "local_ollama");
  assert.equal(aiRuntimeProviderModel(aiRuntimeRouteForSurface(saved.config, "phantombot")), "phantom-v1:latest");
  assert.equal(aiRuntimeRouteForSurface(saved.config, "page_outcome:analytics").primary_provider_id, "claude_cli");

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
  assert.equal(orgB.config.primary_provider_id, "deepseek_api");
  assert.equal(orgB.config.phantom_bot.primary_provider_id, "local_ollama");

  const serialized = await readFile(join(root, "org-a.json"), "utf8");
  assert.doesNotMatch(serialized, /api[_-]?key|bearer|password|cookie|token/i);

  assert.equal(resolveClaudeModel("claude-opus"), "opus");
  assert.equal(resolveClaudeModel("claude-sonnet-4-20250514"), "claude-sonnet-4-20250514");
  assert.deepEqual(claudeModelArgs("default"), []);
  assert.deepEqual(claudeModelArgs("sonnet"), ["--model", "sonnet"]);

  let openRouterRequest: Record<string, unknown> = {};
  let openRouterAuthorization = "";
  const rawOpenRouterCredential = "sk-or-test-openrouter-1234567890";
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
      credential: rawOpenRouterCredential,
      modelId: "anthropic/claude-sonnet-4",
      env: {
        PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
        PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
      },
      fetchImpl: async (_url, init) => {
        openRouterAuthorization = init.headers.Authorization;
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
  assert.equal(openRouterAuthorization, `Bearer ${rawOpenRouterCredential}`);
  assert.equal(openRouterRequest.model, "anthropic/claude-sonnet-4");
  assert.equal(openRouter.model_id, "anthropic/claude-sonnet-4");
  assert.equal(openRouter.status, "called");
  assert.equal(openRouter.output_text, "Selected model answered.");

  const rawCredential = "sk-test-deepseek-1234567890";
  const credentialStatus = await saveAiProviderCredential({
    tenantId: "org-a",
    providerId: "deepseek_api",
    credential: rawCredential,
    actor: "owner-a",
    root: credentialRoot,
    env: credentialEnv,
  });
  assert.equal(credentialStatus.configured, true);
  assert.equal(credentialStatus.secret_returned, false);
  assert.equal(await getAiProviderCredential("org-a", "deepseek_api", { root: credentialRoot, env: credentialEnv }), rawCredential);
  const openRouterCredentialStatus = await saveAiProviderCredential({
    tenantId: "org-a",
    providerId: "openrouter_glm",
    credential: rawOpenRouterCredential,
    actor: "owner-a",
    root: credentialRoot,
    env: credentialEnv,
  });
  assert.equal(openRouterCredentialStatus.configured, true);
  assert.equal(await getAiProviderCredential("org-a", "openrouter_glm", { root: credentialRoot, env: credentialEnv }), rawOpenRouterCredential);
  const encryptedDocument = await readFile(join(credentialRoot, "org-a.json"), "utf8");
  assert.doesNotMatch(encryptedDocument, new RegExp(rawCredential, "u"));
  assert.doesNotMatch(encryptedDocument, new RegExp(rawOpenRouterCredential, "u"));

  const parsedOpenRouterModels = parseOpenRouterModels({
    data: [
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", context_length: 163840, pricing: { prompt: "0.0000002", completion: "0.0000004" } },
      { id: "deepseek/deepseek-v4-flash", name: "Duplicate" },
      { id: "invalid model id", name: "Invalid" },
    ],
  });
  assert.equal(parsedOpenRouterModels.length, 1);
  assert.equal(parsedOpenRouterModels[0]?.context_length, 163840);
  let modelCatalogueAuthorization = "";
  const openRouterModels = await fetchOpenRouterModels({
    credential: rawOpenRouterCredential,
    fetchImpl: async (_url, init) => {
      modelCatalogueAuthorization = init.headers.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", context_length: 163840 }] }),
      };
    },
  });
  assert.equal(modelCatalogueAuthorization, `Bearer ${rawOpenRouterCredential}`);
  assert.equal(openRouterModels[0]?.id, "deepseek/deepseek-v4-flash");
  assert.equal(OPENROUTER_KEY_VALIDATION_TIMEOUT_MS, 20_000);
  assert.equal(OPENROUTER_MODELS_TIMEOUT_MS, 20_000);

  const validOpenRouterCredential = await validateOpenRouterCredential(rawOpenRouterCredential, {
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(validOpenRouterCredential.valid, true);

  const rejectedOpenRouterCredential = await validateOpenRouterCredential(rawOpenRouterCredential, {
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(rejectedOpenRouterCredential.valid, false);
  assert.equal(rejectedOpenRouterCredential.statusCode, 401);
  assert.equal(rejectedOpenRouterCredential.code, "api_key_invalid");

  const unavailableOpenRouterCredential = await validateOpenRouterCredential(rawOpenRouterCredential, {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(unavailableOpenRouterCredential.valid, false);
  assert.equal(unavailableOpenRouterCredential.statusCode, 502);
  assert.equal(unavailableOpenRouterCredential.code, "api_key_validation_unavailable");

  const abortedOpenRouterCredential = await validateOpenRouterCredential(rawOpenRouterCredential, {
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  assert.equal(abortedOpenRouterCredential.valid, false);
  assert.equal(abortedOpenRouterCredential.statusCode, 502);
  assert.match(abortedOpenRouterCredential.error || "", /timed out/iu);

  let deepSeekRequest: Record<string, unknown> = {};
  let deepSeekAuthorization = "";
  const deepSeek = await callDeepSeekV4Flash(
    {
      requestId: "runtime-deepseek-model",
      businessName: "PhantomForce",
      taskType: "page_outcome",
      userMessage: "Return one sentence.",
      compactContext: "No external action.",
      sensitivityLevel: "low",
      approvalRequired: false,
      adminOperatorLane: true,
    },
    {
      credential: rawCredential,
      modelId: "deepseek-v4-flash",
      fetchImpl: async (_url, init) => {
        deepSeekAuthorization = init.headers.Authorization;
        deepSeekRequest = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "DeepSeek answered." } }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }),
          text: async () => "",
        };
      },
    },
  );
  assert.equal(deepSeekAuthorization, `Bearer ${rawCredential}`);
  assert.equal(deepSeekRequest.model, "deepseek-v4-flash");
  assert.equal(deepSeek.model_id, "deepseek-v4-flash");
  assert.equal(deepSeek.status, "called");
  assert.equal(deepSeek.output_text, "DeepSeek answered.");
  assert.equal(deepSeek.raw_secret_exposed, false);
  await deleteAiProviderCredential("org-a", "deepseek_api", { root: credentialRoot, env: credentialEnv });
  assert.equal((await getAiProviderCredentialStatus("org-a", { root: credentialRoot, env: credentialEnv })).deepseek_api.configured, false);
  await deleteAiProviderCredential("org-a", "openrouter_glm", { root: credentialRoot, env: credentialEnv });
  assert.equal((await getAiProviderCredentialStatus("org-a", { root: credentialRoot, env: credentialEnv })).openrouter_glm.configured, false);

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
  await rm(credentialRoot, { recursive: true, force: true });
}
