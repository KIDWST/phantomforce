import assert from "node:assert/strict";

import { callLocalOllamaChat } from "../src/phantom-ai/providers/local-ollama-transport.js";

const baseInput = {
  requestId: "local-ollama-test",
  businessName: "PhantomForce",
  taskType: "content_idea_summary",
  userMessage: "Give me a one-line priority.",
  compactContext: "No external sends. Draft only.",
  sensitivityLevel: "low" as const,
  approvalRequired: false,
  adminOperatorLane: true,
};

const called = await callLocalOllamaChat(baseInput, {
  env: {
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    PHANTOM_LOCAL_GLM_MODEL: "hf.co/unsloth/GLM-5.2-GGUF:UD-IQ1_S",
    PHANTOM_OLLAMA_FALLBACK_MODEL: "qwen2.5:14b",
  },
  fetchImpl: async (url, init) => {
    if (url === "http://127.0.0.1:11434/api/tags") {
      assert.equal(init.method, "GET");
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "qwen2.5:14b", model: "qwen2.5:14b" }] }),
        text: async () => "",
      };
    }
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body ?? "{}") as { model: string; stream: boolean };
    assert.equal(body.model, "qwen2.5:14b");
    assert.equal(body.stream, false);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: { role: "assistant", content: "Follow up on the warmest lead first." },
        prompt_eval_count: 12,
        eval_count: 9,
      }),
      text: async () => "",
    };
  },
});

assert.equal(called.status, "called");
assert.equal(called.provider_id, "local_ollama");
assert.equal(called.model_id, "qwen2.5:14b");
assert.equal(called.requested_model_id, "hf.co/unsloth/GLM-5.2-GGUF:UD-IQ1_S");
assert.equal(called.fallback_model_id, "qwen2.5:14b");
assert.equal(called.fallback_used, true);
assert.equal(called.provider_called, true);
assert.equal(called.external_provider_called, false);
assert.equal(called.output_text, "Follow up on the warmest lead first.");
assert.deepEqual(called.usage, { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 });

let conversationBody: Record<string, any> = {};
const conversation = await callLocalOllamaChat(
  {
    ...baseInput,
    taskType: "question",
    userMessage: "Why is the sky blue?",
    compactContext: "Fast casual chat. Recent conversation: none.",
    conversationMode: true,
    maxTokens: 80,
  },
  {
    env: {
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      PHANTOM_OLLAMA_MODEL: "qwen2.5:7b",
    },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/tags")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: "qwen2.5:7b", model: "qwen2.5:7b" }] }),
          text: async () => "",
        };
      }
      conversationBody = JSON.parse(init.body ?? "{}");
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { role: "assistant", content: "Blue light scatters more strongly in the atmosphere." } }),
        text: async () => "",
      };
    },
  },
);

assert.equal(conversation.status, "called");
assert.equal(conversation.model_id, "qwen2.5:7b");
assert.equal(conversationBody.keep_alive, "24h");
assert.equal(conversationBody.options.num_predict, 80);
assert.equal(conversationBody.options.num_ctx, 2048);
assert.match(conversationBody.messages[0].content, /general-purpose assistant/i);
assert.match(conversationBody.messages[0].content, /preserve named subjects/i);
assert.match(conversationBody.messages[0].content, /exact output constraints/i);
assert.match(conversationBody.messages[0].content, /playful conversational choice/i);
assert.doesNotMatch(conversationBody.messages[0].content, /business operator|ChicagoShots|action lanes/i);
assert.doesNotMatch(conversationBody.messages[1].content, /Execution mode|action cards|backend ops/i);
assert.match(conversationBody.messages[1].content, /Why is the sky blue/);

const remoteBlocked = await callLocalOllamaChat(baseInput, {
  env: {
    OLLAMA_BASE_URL: "https://example.com",
    PHANTOM_OLLAMA_MODEL: "qwen3:14b",
  },
  fetchImpl: async () => {
    throw new Error("remote fetch should be blocked before transport");
  },
});

assert.equal(remoteBlocked.status, "blocked");
assert.equal(remoteBlocked.provider_called, false);
assert.equal(remoteBlocked.network_call_performed, false);
assert.match(remoteBlocked.blocked_reason ?? "", /localhost/);

const refused = await callLocalOllamaChat(baseInput, {
  env: {
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    PHANTOM_OLLAMA_MODEL: "qwen2.5:14b",
  },
  fetchImpl: async (url) => {
    if (url === "http://127.0.0.1:11434/api/tags") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "qwen2.5:14b", model: "qwen2.5:14b" }] }),
        text: async () => "",
      };
    }
    throw new Error("<urlopen error [WinError 10061] No connection could be made because the target machine actively refused it>");
  },
});

assert.equal(refused.status, "error");
assert.equal(refused.error_message, "Local brain is offline. Start Ollama/local model service or switch Phantom to another brain lane.");
assert.equal(refused.output_text, "Local brain is offline. Start the local model service or switch Phantom to another brain lane.");
assert.doesNotMatch(JSON.stringify(refused), /urlopen|WinError|10061|actively refused/i);

console.log(
  JSON.stringify(
    {
      localCalled: called.status,
      modelUsed: called.model_id,
      fallbackUsed: called.fallback_used,
      remoteBlocked: remoteBlocked.status,
      refusalSanitized: refused.status,
      conversationMode: conversation.status,
      externalProviderCalled: called.external_provider_called,
    },
    null,
    2,
  ),
);
