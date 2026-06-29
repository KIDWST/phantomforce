import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLiveSmokePreflightReport } from "../src/phantom-ai/live-smoke-preflight.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-live-smoke-preflight-"));
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const fakeKey = ["local", "test", "openrouter", "key", "masked", "boolean"].join("-");
const fakeSecret = ["secret", "probe", "value", "123456789"].join("-");
const fakeToken = ["token", "probe", "value", "123456789"].join("-");
const fakeCard = ["4111", "1111", "1111", "1111"].join(" ");

try {
  const source = readFileSync(new URL("../src/phantom-ai/live-smoke-preflight.ts", import.meta.url), "utf8");
  assert(!/\bfetch\s*\(/i.test(source), "Live smoke preflight must not add fetch calls.");
  assert(!/\bhttps?\.request\b/i.test(source), "Live smoke preflight must not add HTTP request calls.");
  assert(!/openrouter\.ai/i.test(source), "Live smoke preflight must not contain provider URLs.");

  const preview = previewModelRouterFoundation(
    {
      tenant_id: "demo-trainer",
      business_name: "West Loop Strength Lab",
      actor_user_id: "admin-jordan",
      actor_role: "platform_admin",
      request_id: "live-smoke-preflight-proof",
      task_type: "content_idea_summary",
      sensitivity_level: "low",
      user_request: `Summarize safe local trainer follow-ups. api_key=${fakeSecret} Bearer ${fakeToken} ${fakeCard}`,
      business_summary: "Owner-only local proof. No external actions.",
      module_data: [
        {
          module: "Tasks",
          summary: "Local proof data only.",
          items: [{ title: "Draft only", status: "preview", detail: "No external send." }],
        },
      ],
    },
    {
      env: {
        PHANTOM_MODEL_ROUTER_MODE: "openrouter",
        OPENROUTER_API_KEY: fakeKey,
        OPENROUTER_MODEL: "z-ai/glm-5.2",
        PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
        PHANTOM_HERMES_LEDGER_PATH: ledgerPath,
      },
    },
  );
  const preflight = await buildLiveSmokePreflightReport(preview, { ledgerPath });
  const preflightJson = JSON.stringify(preflight);

  assert(preflight.status === "blocked", "Live smoke preflight must stay blocked.");
  assert(preflight.live_smoke_allowed === false, "Live smoke preflight must not allow smoke tests.");
  assert(preflight.execution_disabled === true, "Live smoke preflight must keep execution disabled.");
  assert(preflight.provider_called === false, "Live smoke preflight must not call a provider.");
  assert(preflight.network_call_performed === false, "Live smoke preflight must not perform network calls.");
  assert(preflight.ledger_written === false, "Live smoke preflight must not write Hermes ledger.");
  assert(!existsSync(ledgerPath), "Live smoke preflight must not create a ledger file.");
  assert(preflight.queue_written === false, "Live smoke preflight must not write approval queue.");
  assert(preflight.approval_executed === false, "Live smoke preflight must not execute approval.");

  assert(preflight.budget_gate.ready_for_live === false, "Budget gate must not be ready for live.");
  assert(preflight.budget_gate.policy_route_allowed === false, "Budget policy route must not be allowed.");
  assert(preflight.budget_gate.reasons.length > 0, "Budget gate must explain live blockers.");
  assert(preflight.ledger_gate.ready_for_live === false, "Ledger gate must not be ready for live.");
  assert(preflight.ledger_gate.live_request_record_required, "Ledger gate must require live request receipt.");
  assert(preflight.ledger_gate.live_response_record_required, "Ledger gate must require live response receipt.");
  assert(preflight.ledger_gate.preflight_write_performed === false, "Ledger gate must not write during preflight.");
  assert(preflight.redaction_gate.obvious_secret_redaction_passed, "Redaction probe must pass for obvious secrets.");
  assert(preflight.redaction_gate.raw_secret_returned === false, "Redaction probe must not return raw obvious secrets.");
  assert(preflight.redaction_gate.ready_for_live_transport === false, "Redaction gate must not mark live transport ready.");
  assert(
    preflight.approval_execution_gate.approval_execution_implemented === false,
    "Approval execution must remain unimplemented.",
  );
  assert(preflight.approval_execution_gate.execute_endpoint_expected_status === 404, "Execute endpoint must remain 404.");
  assert(preflight.approval_execution_gate.live_action_allowed === false, "Approval gate must not allow live action.");
  assert(preflight.transport_gate.ready_for_live_transport === false, "Transport gate must not be ready.");
  assert(preflight.transport_gate.live_transport_configured === false, "Live transport must not be configured.");
  assert(preflight.transport_gate.live_transport_enabled === false, "Live transport must not be enabled.");
  assert(preflight.transport_gate.firewall_permits_call === false, "Firewall must not permit live calls.");
  assert(
    preflight.transport_gate.dry_run_envelope_ready_for_send === false,
    "Dry-run envelope must not be sendable.",
  );
  assert(preflight.transport_gate.network_payload_prepared === false, "No network payload should be prepared.");
  assert(preflight.required_before_live_smoke_test.length > 0, "Preflight must list future prerequisites.");
  assert(
    preflight.required_before_live_smoke_test.some((item) => /budget/i.test(item)),
    "Preflight prerequisites must include budget.",
  );
  assert(
    preflight.required_before_live_smoke_test.some((item) => /ledger|Hermes/i.test(item)),
    "Preflight prerequisites must include Hermes ledger.",
  );
  assert(
    preflight.required_before_live_smoke_test.some((item) => /redaction/i.test(item)),
    "Preflight prerequisites must include redaction.",
  );
  assert(
    preflight.required_before_live_smoke_test.some((item) => /approval execution/i.test(item)),
    "Preflight prerequisites must include approval execution.",
  );

  assert(!preflightJson.includes(fakeKey), "Preflight must not leak raw provider key.");
  assert(!preflightJson.includes(fakeSecret), "Preflight must not leak raw key-like probe.");
  assert(!preflightJson.includes(fakeToken), "Preflight must not leak raw token probe.");
  assert(!preflightJson.includes(fakeCard), "Preflight must not leak raw card-like probe.");
  assert(preflight.safety_flags.live_provider_call_allowed === false, "Safety flags must block provider calls.");
  assert(preflight.safety_flags.raw_secret_exposed === false, "Safety flags must report no raw secret exposure.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        preflightId: preflight.preflight_id,
        status: preflight.status,
        liveSmokeAllowed: preflight.live_smoke_allowed,
        budgetGate: preflight.budget_gate.status,
        ledgerGate: preflight.ledger_gate.status,
        redactionGate: preflight.redaction_gate.status,
        approvalExecutionGate: preflight.approval_execution_gate.status,
        transportGate: preflight.transport_gate.status,
        ledgerFileCreated: existsSync(ledgerPath),
        providerCalled: preflight.provider_called,
        networkCallPerformed: preflight.network_call_performed,
        secretsLeaked:
          preflightJson.includes(fakeKey) ||
          preflightJson.includes(fakeSecret) ||
          preflightJson.includes(fakeToken) ||
          preflightJson.includes(fakeCard),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
