import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(await readFile(
  resolve(repoRoot, "docs/tooling-spine/phantom-capability-registry.json"),
  "utf8",
)) as { statusVocabulary: string[]; entries: Array<Record<string, unknown>> };
const required = [
  "id", "name", "kind", "project", "canonicalLocation", "purpose", "entryPoint",
  "status", "inputs", "outputs", "requiredEnvironmentVariables", "permissions",
  "approvalClass", "tests", "runtimeWiring", "dependencies", "securityConsiderations",
  "knownLimitations", "hermesAvailability", "phantomForceAvailability", "terminaInvolvement",
];
assert.ok(registry.entries.length >= 12);
assert.equal(new Set(registry.entries.map((row) => row.id)).size, registry.entries.length);
for (const row of registry.entries) {
  for (const field of required) assert.ok(field in row, `${String(row.id)} missing ${field}`);
  assert.ok(registry.statusVocabulary.includes(String(row.status)), `${String(row.id)} has invalid status`);
}
const serialized = JSON.stringify(registry);
assert.doesNotMatch(serialized, /(?:api[_-]?key|token|secret)"?\s*:\s*"(?!unknown|none)[^"]{8,}"/i);
const totals = Object.fromEntries(registry.statusVocabulary.map((status) => [
  status,
  registry.entries.filter((row) => row.status === status).length,
]));
console.log(JSON.stringify({ ok: true, entries: registry.entries.length, totals }));
