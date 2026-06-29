import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { compileHermesContext } from "../src/phantom-ai/context-compiler.js";
import { readHermesLedgerRecords } from "../src/phantom-ai/hermes-ledger.js";
import { DEFAULT_OPENROUTER_MODEL, getProviderSetupStatus, runModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ContextModuleData, ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), "phantom-hermes-"));
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");

try {
  const moduleData: ContextModuleData[] = [
    {
      module: "Content",
      summary: "Demo content queue for a personal-training owner workspace.",
      items: [
        { title: "Founder's 20-minute lift", status: "recommended", detail: "Low-risk content idea." },
        { title: "Friday wins roundup", status: "approval", detail: "Requires consent before posting." },
      ],
    },
    {
      module: "Offers",
      summary: "Draft pricing and package options.",
      items: [{ title: "$497/mo hybrid coaching", status: "draft", detail: "Billing is not live." }],
    },
  ];

  const request: ModelRouterRequest = {
    tenant_id: "demo-trainer",
    business_name: "West Loop Strength Lab",
    actor_user_id: "demo-owner",
    actor_role: "business_owner",
    request_id: "test-router-001",
    task_type: "content_idea_summary",
    sensitivity_level: "low",
    user_request: "Summarize the best content ideas for this week without posting anything.",
    business_summary: "Owner-only personal training simulation. Employees disabled. External actions approval-only.",
    module_data: moduleData,
  };

  const contextPacket = compileHermesContext({
    tenant_id: request.tenant_id,
    business_name: request.business_name,
    request_id: request.request_id,
    task_type: request.task_type,
    sensitivity_level: "low",
    provider_route: "mock",
    user_request: request.user_request,
    business_summary: request.business_summary,
    module_data: moduleData,
    relevant_rules: ["Use Phantom AI product language.", "No external sends/posts/uploads."],
    approval_restrictions: ["Posts and sends require approval."],
  });

  assert(contextPacket.context_chars > 0, "Context packet should have content.");
  assert(contextPacket.estimated_tokens > 0, "Context packet should estimate tokens.");
  assert(contextPacket.raw_context_chars >= contextPacket.context_chars, "Compiler should avoid expanding context.");

  const mockResult = await runModelRouterFoundation(request, {
    ledgerPath,
    env: {
      PHANTOM_MODEL_ROUTER_MODE: "mock",
      OPENROUTER_MODEL: DEFAULT_OPENROUTER_MODEL,
    },
  });

  assert(mockResult.decision.provider_route === "mock", "Default route should remain mock without provider config.");
  assert(mockResult.ledger_record.estimated_cost_usd === 0, "Mock route should record zero estimated cost.");

  const highSensitivityResult = await runModelRouterFoundation(
    {
      ...request,
      request_id: "test-router-002",
      task_type: "billing_summary",
      sensitivity_level: "high",
      user_request: "Summarize payment card and private health notes.",
    },
    {
      ledgerPath,
      env: {
        PHANTOM_MODEL_ROUTER_MODE: "openrouter",
        OPENROUTER_API_KEY: "configured-for-status-only",
        OPENROUTER_MODEL: DEFAULT_OPENROUTER_MODEL,
      },
    },
  );

  assert(
    highSensitivityResult.decision.provider_route === "mock",
    "High-sensitivity data must not route to OpenRouter GLM by default.",
  );
  assert(
    highSensitivityResult.ledger_record.risks.some((risk) => risk.includes("High-sensitivity")),
    "High-sensitivity risk should be recorded.",
  );

  const openRouterStatus = getProviderSetupStatus({
    PHANTOM_MODEL_ROUTER_MODE: "openrouter",
    OPENROUTER_API_KEY: "configured-for-status-only",
    OPENROUTER_MODEL: DEFAULT_OPENROUTER_MODEL,
  });

  assert(openRouterStatus.openrouter_glm.configured, "OpenRouter status should read configured from env.");
  assert(openRouterStatus.openrouter_glm.model_id === DEFAULT_OPENROUTER_MODEL, "OpenRouter model id should match default.");

  const records = await readHermesLedgerRecords({ ledgerPath, limit: 10 });
  assert(records.length === 2, "Hermes ledger should contain both router records.");
  assert(records.every((record) => record.tenant_id === "demo-trainer"), "Tenant id should be recorded.");
  assert(records.every((record) => record.context_chars > 0), "Context size should be recorded.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        ledgerPath,
        records: records.length,
        mockRoute: mockResult.decision.provider_route,
        highSensitivityRoute: highSensitivityResult.decision.provider_route,
        contextChars: contextPacket.context_chars,
        rawContextChars: contextPacket.raw_context_chars,
        openRouterModel: openRouterStatus.openrouter_glm.model_id,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

