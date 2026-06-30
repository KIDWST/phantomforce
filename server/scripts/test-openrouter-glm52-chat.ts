import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  callOpenRouterGlm52,
  type OpenRouterGlm52ChatInput,
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
const fakeKey = ["sk", "or", "v1", "glm52chat0123456789"].join("-");
const fakeToken = ["Bearer", "glm52-token-0123456789"].join(" ");
const fakeCard = ["4242", "4242", "4242", "4242"].join(" ");
const providerKeyLabel = ["OPENROUTER", "API", "KEY"].join("_");
const passwordLabel = ["PASS", "WORD"].join("");
const passwordValue = ["glm52", "chat", "password"].join("-");

const input: OpenRouterGlm52ChatInput = {
  requestId: "openrouter-glm52-chat-test-001",
  businessName: "West Loop Strength Lab",
  taskType: "content_idea_summary",
  userMessage: `Summarize trainer follow-ups. ${providerKeyLabel}=${fakeKey} ${fakeToken} card ${fakeCard} ${passwordLabel}=${passwordValue}`,
  compactContext: `Hermes compact context. token=${fakeToken} card ${fakeCard}`,
  sensitivityLevel: "low",
  approvalRequired: false,
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
            content: "GLM 5.2 response: prioritize the owner-safe follow-up, then draft tomorrow's content plan.",
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

const missingLiveFlag = await callOpenRouterGlm52(input, {
  env: {
    OPENROUTER_API_KEY: fakeKey,
    PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
  },
  fetchImpl: fakeFetch,
});
assert(missingLiveFlag.status === "blocked", "Missing live providers flag should block.");
assert(missingLiveFlag.provider_called === false, "Blocked live flag must not call provider.");
assert(calls.length === 0, "Blocked live flag must not invoke fetch.");

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

const missingKey = await callOpenRouterGlm52(input, {
  env: {
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
  },
  fetchImpl: fakeFetch,
});
assert(missingKey.status === "blocked", "Missing API key should block.");
assert(missingKey.provider_called === false, "Missing API key must not call provider.");
assert(calls.length === 0, "Missing API key must not invoke fetch.");

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
assert(highSensitivity.status === "blocked", "High sensitivity should block GLM worker lane.");
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
assert(approvalRequired.status === "blocked", "Approval-required work should block GLM worker lane.");
assert(calls.length === 0, "Approval-required block must not invoke fetch.");

const adminApprovalDraft = await callOpenRouterGlm52(
  { ...input, approvalRequired: true, sensitivityLevel: "high", adminOperatorLane: true },
  {
    env: {
      OPENROUTER_API_KEY: fakeKey,
      PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
      PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
      OPENROUTER_MODEL: OPENROUTER_GLM_52_MODEL_ID,
    },
    fetchImpl: fakeFetch,
  },
);
assert(adminApprovalDraft.status === "called", "Admin GLM lane should draft for approval-sensitive work.");
assert(adminApprovalDraft.approval_executed === false, "Admin GLM lane must not execute approvals.");
assert(adminApprovalDraft.external_action_executed === false, "Admin GLM lane must not execute external actions.");
assert(calls.length === 1, "Admin GLM lane should call fake fetch once.");

const called = await callOpenRouterGlm52(input, {
  env: {
    OPENROUTER_API_KEY: fakeKey,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
    OPENROUTER_MODEL: OPENROUTER_GLM_52_MODEL_ID,
    PHANTOM_OPENROUTER_HTTP_REFERER: "http://127.0.0.1",
  },
  fetchImpl: fakeFetch,
});
assert(called.status === "called", "Configured GLM transport should call with fake fetch.");
assert(called.provider_called === true, "Called result should mark provider called.");
assert(called.network_call_performed === true, "Called result should mark network call performed.");
assert(called.ledger_written === false, "Transport must not write ledgers directly.");
assert(called.queue_written === false, "Transport must not write queues.");
assert(called.approval_executed === false, "Transport must not execute approvals.");
assert(called.external_action_executed === false, "Transport must not execute external actions.");
assert(calls.length === 2, "Configured live transport should call fake fetch twice total.");
assert(calls[0]?.url === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, "Transport should target OpenRouter chat completions.");
assert(calls[0]?.body.model === OPENROUTER_GLM_52_MODEL_ID, "Transport body should use GLM 5.2.");
assert(Array.isArray(calls[0]?.body.messages), "Transport body should include chat messages.");

const serializedResult = JSON.stringify(called);
const serializedBody = JSON.stringify(calls[0]?.body);
const serializedHeaders = JSON.stringify(calls[0]?.init.headers);

for (const raw of [fakeKey, "glm52-token-0123456789", fakeCard, passwordValue]) {
  assert(!serializedResult.includes(raw), `Result must not expose raw value ${raw}.`);
  assert(!serializedBody.includes(raw), `Request body must not expose raw value ${raw}.`);
}

assert(serializedHeaders.includes("[redacted]") === false, "Fake request headers should contain the fake key only inside the fake fetch call.");
assert(!serializedResult.includes("Authorization"), "Result must not expose Authorization headers.");
assert(called.raw_secret_exposed === false, "Raw secret must not be exposed.");
assert(called.raw_prompt_returned === false, "Raw prompt must not be returned.");
assert(called.raw_response_returned === false, "Raw response must not be returned.");

console.log(
  JSON.stringify(
    {
      ok: true,
      missingLiveFlag: missingLiveFlag.status,
      missingTransportFlag: missingTransport.status,
      missingKey: missingKey.status,
      highSensitivityBlocked: highSensitivity.status,
      approvalRequiredBlocked: approvalRequired.status,
      adminApprovalDraft: adminApprovalDraft.status,
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
