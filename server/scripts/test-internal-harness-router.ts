import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clientSafeInternalHarnessSummary,
  inspectInternalHarnessReadiness,
  selectInternalHarnessForTask,
} from "../src/phantom-ai/internal-harness-router.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const missing = await inspectInternalHarnessReadiness(
  {
    PHANTOM_PI_HARNESS_ENABLED: "false",
    PHANTOM_PI_COMMAND: "",
  },
  {
    checkedAt: "2026-07-06T00:00:00.000Z",
    candidatePaths: ["C:\\definitely-missing\\pi.cmd"],
  },
);

assert(missing.ready_for_internal_use === false, "Hidden harness should be disabled by default.");
assert(missing.customer_visible === false, "Internal harness must not be customer-visible.");
assert(missing.safety_flags.process_spawned === false, "Readiness must not spawn processes.");
assert(missing.safety_flags.network_check_performed === false, "Readiness must not perform network checks.");
assert(missing.safety_flags.package_installed === false, "Readiness must not install packages.");

const tempDir = await mkdtemp(join(tmpdir(), "phantom-harness-test-"));
const fakePi = join(tempDir, "pi.cmd");

try {
  await writeFile(fakePi, "@echo off\r\n", "utf8");
  const ready = await inspectInternalHarnessReadiness(
    {
      PHANTOM_PI_HARNESS_ENABLED: "true",
      PHANTOM_PI_COMMAND: fakePi,
    },
    {
      checkedAt: "2026-07-06T00:00:00.000Z",
      candidatePaths: [],
    },
  );

  assert(ready.ready_for_internal_use === true, "Configured hidden harness should report internal readiness.");
  assert(ready.hidden_infrastructure === true, "Harness must remain hidden infrastructure.");
  assert(
    ready.candidates.some((candidate) => candidate.id === "minimal_agent_harness" && candidate.configured),
    "Minimal harness candidate should be configured when explicitly enabled and present.",
  );
  assert(
    ready.candidates.every((candidate) => candidate.customer_visible === false),
    "No internal harness candidate should be customer-visible.",
  );

  const selection = selectInternalHarnessForTask(
    {
      taskType: "workflow_extension",
      userMessage: "Build a prompt template and context engineering helper for a terminal workflow.",
      sensitivityLevel: "low",
      approvalRequired: false,
    },
    ready,
  );
  assert(selection.selected === "minimal_agent_harness", "Low-risk harness work can select the hidden harness.");
  assert(selection.customer_visible_label === "Phantom Operator", "Selection must use Phantom-facing label.");
  assert(selection.raw_harness_name_exposed === false, "Selection must not expose raw harness name.");
  assert(selection.execution_enabled === false, "Selection is routing metadata only, not execution.");

  const highSensitivity = selectInternalHarnessForTask(
    {
      taskType: "security",
      userMessage: "Analyze password and credential material.",
      sensitivityLevel: "high",
      approvalRequired: true,
    },
    ready,
  );
  assert(highSensitivity.selected === "primary_operator", "High-sensitivity work must stay on the primary operator.");

  const clientSafe = clientSafeInternalHarnessSummary(ready);
  const clientPayload = JSON.stringify(clientSafe).toLowerCase();
  assert(!clientPayload.includes("pi"), "Client-safe summary must not mention the raw harness brand.");
  assert(clientSafe.raw_harness_name_exposed === false, "Client-safe summary must hide raw harness names.");
  assert(clientSafe.customer_visible === false, "Client-safe summary must not make harnesses visible.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        defaultReady: missing.ready_for_internal_use,
        configuredReady: ready.ready_for_internal_use,
        selected: selection.selected,
        customerVisibleLabel: selection.customer_visible_label,
        clientSafeMentionsRawBrand: clientPayload.includes("pi"),
        processSpawned: ready.safety_flags.process_spawned,
        networkCheckPerformed: ready.safety_flags.network_check_performed,
        packageInstalled: ready.safety_flags.package_installed,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}
