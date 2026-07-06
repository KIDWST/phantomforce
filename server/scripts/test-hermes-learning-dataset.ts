import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHermesLearningDatasetExample,
  persistHermesLearningDatasetExample,
} from "../src/phantom-ai/hermes-learning-dataset.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-learning-"));
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const memoryPath = join(tempDir, "hermes-interaction-memory.jsonl");
const datasetPath = join(tempDir, "hermes-learning-examples.jsonl");

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_HERMES_LEDGER_PATH = ledgerPath;
process.env.PHANTOM_HERMES_INTERACTION_MEMORY_STORE_PATH = memoryPath;
process.env.PHANTOM_HERMES_LEARNING_DATASET_PATH = datasetPath;

const fakeApiKey = ["sk", "hermeslearning", "0123456789abcdef"].join("-");
const fakeToken = ["tok", "hermeslearning", "0123456789"].join("-");

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type LearningPersistence = {
  persisted: boolean;
  reason: string;
  dataset_path: string;
  example: {
    example_id: string;
    tenant_id: string;
    actor_user_id: string | null;
    prompt_summary: string;
    assistant_response_summary: string;
    quality_label: string;
    approved_for_finetune: boolean;
    source_safety: {
      source_provider_called: boolean;
      source_network_call_performed: boolean;
    };
    safety_flags: {
      provider_called: boolean;
      network_call_performed: boolean;
      queue_written: boolean;
      approval_executed: boolean;
      production_ledger_written: boolean;
      external_action_executed: boolean;
      review_required_before_finetune: boolean;
    };
  };
};

type ChatResponse = {
  ok: boolean;
  learning_dataset: LearningPersistence;
  provider_request_body_created: boolean;
  live_provider_called: boolean;
  network_call_performed: boolean;
  approval_executed: boolean;
  queue_written: boolean;
  external_action_executed: boolean;
};

type SaveExampleResponse = {
  ok: boolean;
  persistence: LearningPersistence;
};

type HistoryResponse = {
  ok: boolean;
  dataset: {
    bytes: number;
    returned_count: number;
    local_dev_only: boolean;
    production_write_allowed: boolean;
  };
  examples: Array<{
    example_id: string;
    quality_label: string;
    approved_for_finetune: boolean;
  }>;
};

type ExportResponse = {
  ok: boolean;
  export_preview: {
    exported_examples: number;
    include_unreviewed: boolean;
    jsonl_preview: string;
    safety_flags: {
      approved_examples_only: boolean;
      provider_called: boolean;
      network_call_performed: boolean;
      queue_written: boolean;
      approval_executed: boolean;
      external_action_executed: boolean;
      production_ledger_written: boolean;
    };
  };
};

async function login(sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId }),
  });
  assert(response.statusCode === 200, `${sessionId} login should succeed.`);
  return parseJson<LoginResponse>(response.payload).token;
}

try {
  const source = readFileSync(
    new URL("../src/phantom-ai/hermes-learning-dataset.ts", import.meta.url),
    "utf8",
  );
  assert(!/\bfetch\s*\(/i.test(source), "Learning dataset must not call fetch.");
  assert(!/\bhttps?\.request\b/i.test(source), "Learning dataset must not make HTTP requests.");
  assert(!/\baxios\s*\(/i.test(source), "Learning dataset must not use axios.");
  assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Learning dataset must not write approval queue.");
  assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Learning dataset must not write approval transitions.");
  assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Learning dataset must not write Hermes ledger.");

  const adminToken = await login("admin-jordan");
  const clientToken = await login("client-sports-demo");

  const unauthStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/hermes/learning-dataset/status",
  });
  assert(unauthStatus.statusCode === 401, "Unauthenticated learning status should be blocked.");

  const clientSave = await app.inject({
    method: "POST",
    url: "/phantom-ai/hermes/learning-dataset/save-example",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientToken}`,
    },
    payload: JSON.stringify({
      prompt_summary: "client should not save admin training examples",
      assistant_response_summary: "blocked",
    }),
  });
  assert(clientSave.statusCode === 403, "Client learning save should be admin-only.");

  const chat = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientToken}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      request_id: "hermes-learning-auto-capture",
      task_type: "training_dataset_probe",
      business_name: "PhantomForce",
      message: `Remember the preferred answer style. api_key=${fakeApiKey} Bearer ${fakeToken}`,
    }),
  });
  assert(chat.statusCode === 200, "Admin PhantomAI chat should respond.");
  const chatBody = parseJson<ChatResponse>(chat.payload);
  assert(chatBody.learning_dataset.persisted === true, "PhantomAI chat should auto-capture a learning example.");
  assert(chatBody.learning_dataset.reason === "persisted_local_dev_only", "Learning capture should be local/dev only.");
  assert(chatBody.learning_dataset.example.quality_label === "unreviewed", "Auto-capture should require review.");
  assert(chatBody.learning_dataset.example.approved_for_finetune === false, "Auto-capture should not be fine-tune approved.");
  assert(
    chatBody.learning_dataset.example.safety_flags.review_required_before_finetune === true,
    "Auto-capture must require review before fine-tune export.",
  );
  assert(chatBody.provider_request_body_created === false, "Default PhantomAI path must not create provider request body.");
  assert(chatBody.live_provider_called === false, "Default PhantomAI path must not call live providers.");
  assert(chatBody.network_call_performed === false, "Default PhantomAI path must not perform network calls.");
  assert(chatBody.approval_executed === false, "Default PhantomAI path must not execute approvals.");
  assert(chatBody.queue_written === false, "Default PhantomAI path must not write queues.");
  assert(chatBody.external_action_executed === false, "Default PhantomAI path must not execute external actions.");

  const approvedSave = await app.inject({
    method: "POST",
    url: "/phantom-ai/hermes/learning-dataset/save-example",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({
      tenant_id: "phantomforce-owner",
      actor_user_id: "admin-jordan",
      task_type: "codex_style_example",
      source_tool: "codex",
      prompt_summary: "Jordan asks whether Hermes can learn from operator work.",
      assistant_response_summary: "Explain memory now, dataset next, model training later.",
      ideal_response_summary: "Say yes, but keep it local, redacted, reviewed, and export only approved examples.",
      quality_label: "approved",
      rating: 5,
      tags: ["operator-style", "learning-lane"],
      approved_for_finetune: true,
    }),
  });
  assert(approvedSave.statusCode === 200, "Admin should save manual approved training example.");
  const approvedBody = parseJson<SaveExampleResponse>(approvedSave.payload);
  assert(approvedBody.persistence.persisted === true, "Manual approved example should persist.");
  assert(approvedBody.persistence.example.approved_for_finetune === true, "Approved example should be exportable.");
  assert(
    approvedBody.persistence.example.safety_flags.review_required_before_finetune === false,
    "Approved example should not require another review before export.",
  );

  assert(existsSync(datasetPath), "Learning dataset file should exist.");
  const serialized = readFileSync(datasetPath, "utf8");
  assert(!serialized.includes(fakeApiKey), "Learning dataset must not store raw fake API key.");
  assert(!serialized.includes(fakeToken), "Learning dataset must not store raw fake token.");
  assert(!JSON.stringify(chatBody).includes(fakeApiKey), "Learning response must not return raw fake API key.");
  assert(!JSON.stringify(chatBody).includes(fakeToken), "Learning response must not return raw fake token.");

  const history = await app.inject({
    method: "GET",
    url: "/phantom-ai/hermes/learning-dataset/history?limit=20",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(history.statusCode === 200, "Admin history should respond.");
  const historyBody = parseJson<HistoryResponse>(history.payload);
  assert(historyBody.dataset.bytes > 0, "Learning dataset status should report bytes.");
  assert(historyBody.dataset.local_dev_only === true, "Dataset must be local/dev only.");
  assert(historyBody.dataset.production_write_allowed === false, "Dataset production writes must be blocked.");
  assert(historyBody.examples.length >= 2, "History should include auto and manual examples.");

  const exportApproved = await app.inject({
    method: "POST",
    url: "/phantom-ai/hermes/learning-dataset/export-preview",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({ tenant_id: "phantomforce-owner", limit: 20 }),
  });
  assert(exportApproved.statusCode === 200, "Approved export preview should respond.");
  const exportApprovedBody = parseJson<ExportResponse>(exportApproved.payload);
  assert(exportApprovedBody.export_preview.exported_examples === 1, "Default export should include only approved examples.");
  assert(exportApprovedBody.export_preview.include_unreviewed === false, "Default export must exclude unreviewed examples.");
  assert(
    exportApprovedBody.export_preview.safety_flags.approved_examples_only === true,
    "Default export should be approved-only.",
  );
  assert(exportApprovedBody.export_preview.safety_flags.provider_called === false, "Export must not call provider.");
  assert(exportApprovedBody.export_preview.safety_flags.network_call_performed === false, "Export must not call network.");
  assert(exportApprovedBody.export_preview.safety_flags.queue_written === false, "Export must not write queue.");
  assert(exportApprovedBody.export_preview.safety_flags.approval_executed === false, "Export must not execute approval.");
  assert(
    exportApprovedBody.export_preview.safety_flags.external_action_executed === false,
    "Export must not execute external actions.",
  );
  assert(
    exportApprovedBody.export_preview.safety_flags.production_ledger_written === false,
    "Export must not write production ledger.",
  );
  assert(
    exportApprovedBody.export_preview.jsonl_preview.includes("You are PhantomAI"),
    "Export preview should use chat-message fine-tune shape.",
  );

  const exportWithUnreviewed = await app.inject({
    method: "POST",
    url: "/phantom-ai/hermes/learning-dataset/export-preview",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({ tenant_id: "client-sports-demo", limit: 20, include_unreviewed: true }),
  });
  assert(exportWithUnreviewed.statusCode === 200, "Unreviewed export preview should respond.");
  const exportWithUnreviewedBody = parseJson<ExportResponse>(exportWithUnreviewed.payload);
  assert(
    exportWithUnreviewedBody.export_preview.exported_examples >= 1,
    "Explicit unreviewed export preview should include the client-scoped unreviewed example.",
  );
  assert(
    exportWithUnreviewedBody.export_preview.safety_flags.approved_examples_only === false,
    "Explicit unreviewed export should disclose that approval-only gate is off.",
  );

  const productionExample = buildHermesLearningDatasetExample({
    tenant_id: "phantomforce-owner",
    actor_user_id: "admin-jordan",
    prompt_summary: "production write must fail",
    assistant_response_summary: "blocked",
  });
  const productionBlocked = await persistHermesLearningDatasetExample(productionExample, {
    datasetPath: join(tempDir, "production-blocked.jsonl"),
    env: { NODE_ENV: "production" },
  });
  assert(productionBlocked.persisted === false, "Production learning dataset write should be blocked.");
  assert(productionBlocked.reason === "production_write_blocked", "Production block reason should be explicit.");

  const executeRoute = await app.inject({
    method: "POST",
    url: "/phantom-ai/approvals/execute",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(executeRoute.statusCode === 404, "/phantom-ai/approvals/execute must remain absent.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        datasetPath,
        autoCaptured: chatBody.learning_dataset.persisted,
        manualApproved: approvedBody.persistence.example.approved_for_finetune,
        historyCount: historyBody.examples.length,
        approvedExportCount: exportApprovedBody.export_preview.exported_examples,
        unreviewedExportCount: exportWithUnreviewedBody.export_preview.exported_examples,
        productionBlocked: !productionBlocked.persisted,
        providerCalled: chatBody.live_provider_called || exportApprovedBody.export_preview.safety_flags.provider_called,
        networkCallPerformed:
          chatBody.network_call_performed || exportApprovedBody.export_preview.safety_flags.network_call_performed,
        queueWritten: chatBody.queue_written || exportApprovedBody.export_preview.safety_flags.queue_written,
        approvalExecuted: chatBody.approval_executed || exportApprovedBody.export_preview.safety_flags.approval_executed,
        externalActionExecuted:
          chatBody.external_action_executed || exportApprovedBody.export_preview.safety_flags.external_action_executed,
        secretsLeaked: serialized.includes(fakeApiKey) || serialized.includes(fakeToken),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
