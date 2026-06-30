import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  callOpenRouterGlm52,
  type OpenRouterLiveChatInput,
} from "../src/phantom-ai/providers/openrouter-live-transport.js";
import {
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_GLM_52_MODEL_ID,
} from "../src/phantom-ai/providers/openrouter-adapter.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../..");
const source = await readFile(resolve(repoRoot, "server/src/phantom-ai/providers/openrouter-live-transport.ts"), "utf8");
const fakeKey = ["sk", "or", "v1", "livechat0123456789"].join("-");
const fakeToken = ["Bearer", "livechat-token-0123456789"].join(" ");
const fakeCard = ["4242", "4242", "4242", "4242"].join(" ");
const providerKeyLabel = ["OPENROUTER", "API", "KEY"].join("_");
const passwordLabel = ["PASS", "WORD"].join("");
const passwordValue = ["live", "chat", "password"].join("-");

const input: OpenRouterLiveChatInput = {
  requestId: "openrouter-live-chat-test-001",
  userMessage: `Summarize trainer follow-ups. ${providerKeyLabel}=${fakeKey} ${fakeToken} card ${fakeCard} ${passwordLabel}=${passwordValue}`,
  compactContext: `Hermes compact context. token=${fakeToken} card ${fakeCard}`,
  sensitivityLevel: "low",
  approvalRequired: false,
  estimatedTokens: 1000,
  maxTokens: 300,
};

assert(source.includes("fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT"), "Live transport should use injected fetch.");
assert(!new RegExp(["ax", "ios"].join(""), "i").test(source), "Live transport must not add third-party HTTP clients.");
assert(!/\bhttps?\s*\.\s*request\b/i.test(source), "Live transport must not add raw HTTP request clients.");
assert(!/OPENROUTER_API_KEY.*return/i.test(source), "Live transport must not return raw API keys.");

let calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
const fakeFetch: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  calls.push({ url: String(url), init: init ?? {}, body });
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: "GLM 5.2 response: prioritize Carlos follow-up, then draft tomorrow's content plan.",
          },
        },
      ],
      usage: {
        prompt_tokens: 111,
        completion_tokens: 22,
        total_tokens: 133,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

const missingTransport = await callOpenRouterGlm52(input, {
  env: {
    OPENROUTER_API_KEY: fakeKey,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
  },
  fetchImpl: fakeFetch,
});
assert(missingTransport.status === "blocked", "Missing transport flag should block.");
assert(missingTransport.provider_called === false, "Blocked transport must not call provider.");
assert(calls.length === 0, "Blocked transport must not invoke fetch.");

const highSensitivity = await callOpenRouterGlm52(
  { ...input, sensitivityLevel: "high" },
  {
    env: {
      OPENROUTER_API_KEY: fakeKey,
      PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
      PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
    },
    fetchImpl: fakeFetch,
  },
);
assert(highSensitivity.status === "blocked", "High sensitivity should block OpenRouter.");
assert(calls.length === 0, "High-sensitivity block must not invoke fetch.");

const approvalRequired = await callOpenRouterGlm52(
  { ...input, approvalRequired: true },
  {
    env: {
      OPENROUTER_API_KEY: fakeKey,
      PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
      PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
    },
    fetchImpl: fakeFetch,
  },
);
assert(approvalRequired.status === "blocked", "Approval-required work should block OpenRouter.");
assert(calls.length === 0, "Approval-required block must not invoke fetch.");

const called = await callOpenRouterGlm52(input, {
  env: {
    OPENROUTER_API_KEY: fakeKey,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
    OPENROUTER_MODEL: OPENROUTER_GLM_52_MODEL_ID,
  },
  fetchImpl: fakeFetch,
});
assert(called.status === "called", "Configured GLM transport should call with fake fetch.");
assert(called.provider_called === true, "Called result should mark provider called.");
assert(called.network_call_performed === true, "Called result should mark network call performed.");
assert(calls.length === 1, "Configured live transport should call fake fetch once.");
assert(calls[0]?.url === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, "Transport should target OpenRouter chat completions.");
assert(calls[0]?.body.model === OPENROUTER_GLM_52_MODEL_ID, "Transport body should use GLM 5.2.");
assert(Array.isArray(calls[0]?.body.messages), "Transport body should include chat messages.");

const serializedResult = JSON.stringify(called);
const serializedBody = JSON.stringify(calls[0]?.body);

for (const raw of [fakeKey, "livechat-token-0123456789", fakeCard, passwordValue]) {
  assert(!serializedResult.includes(raw), `Result must not expose raw value ${raw}.`);
  assert(!serializedBody.includes(raw), `Request body must not expose raw value ${raw}.`);
}

assert(!serializedResult.includes("Authorization"), "Result must not expose Authorization headers.");
assert(called.raw_api_key_returned === false, "Raw API key must not be returned.");
assert(called.raw_prompt_returned === false, "Raw prompt must not be returned.");
assert(called.raw_response_returned === false, "Raw response must not be returned.");
assert(called.safety_flags.queue_written === false, "Transport must not write queues.");
assert(called.safety_flags.approval_executed === false, "Transport must not execute approvals.");
assert(called.safety_flags.external_action_executed === false, "Transport must not execute external actions.");

console.log(
  JSON.stringify(
    {
      ok: true,
      blockedWithoutTransportFlag: missingTransport.status,
      highSensitivityBlocked: highSensitivity.status,
      approvalRequiredBlocked: approvalRequired.status,
      calledStatus: called.status,
      providerCalled: called.provider_called,
      networkCallPerformed: called.network_call_performed,
      endpoint: calls[0]?.url,
      model: calls[0]?.body.model,
      usage: called.usage,
      secretsLeaked:
        serializedResult.includes(fakeKey) ||
        serializedResult.includes(fakeCard) ||
        serializedResult.includes(passwordValue) ||
        serializedBody.includes(fakeKey) ||
        serializedBody.includes(fakeCard) ||
        serializedBody.includes(passwordValue),
    },
    null,
    2,
  ),
);
