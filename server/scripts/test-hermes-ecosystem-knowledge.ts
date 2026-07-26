import assert from "node:assert/strict";

import {
  composeHermesEcosystemContext,
  HERMES_ECOSYSTEM_RECORDS,
  selectHermesEcosystemRecords,
} from "../src/phantom-ai/hermes-ecosystem-knowledge.js";

assert.ok(HERMES_ECOSYSTEM_RECORDS.length >= 7);
const orientation = composeHermesEcosystemContext(
  "Which PhantomForce copy is canonical and deployed? How does PhantomBot supervise PhantomForce, how does Hermes ACP connect, who owns approvals, and what is Termina's role?",
  "phantombot",
);
assert.match(orientation, /github\.com\/KIDWST\/phantomforce/);
assert.match(orientation, /deployments\\phantomforce-live/);
assert.match(orientation, /Hermes plans; PhantomForce validates and executes/);
assert.match(orientation, /Termina performs decomposed missions after PhantomForce approval/);
assert.match(orientation, /Environment names \(never values\)/);
assert.doesNotMatch(orientation, /(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/i);
assert.ok(selectHermesEcosystemRecords("OpenRouter Ollama provider routing").some((row) => row.id === "providers"));
assert.ok(selectHermesEcosystemRecords("PhantomPlay PhantomStore").some((row) => row.id === "phantomplay-store"));
for (const record of HERMES_ECOSYSTEM_RECORDS) {
  assert.ok(record.evidence.length > 0, `${record.id} needs evidence`);
  assert.ok(record.entryPoints.length > 0, `${record.id} needs entry points`);
  assert.ok(record.boundaries.length > 0, `${record.id} needs boundaries`);
}

console.log(JSON.stringify({
  ok: true,
  records: HERMES_ECOSYSTEM_RECORDS.length,
  canonicalOrientation: true,
  evidenceRequired: true,
  environmentValuesExcluded: true,
}));
