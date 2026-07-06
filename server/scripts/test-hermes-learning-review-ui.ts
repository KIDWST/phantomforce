import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const workspaces = readProjectFile("apps/web/public/app/js/workspaces.js");
const css = readProjectFile("apps/web/public/app/phantom.css");
const indexHtml = readProjectFile("apps/web/public/app/index.html");
const mainJs = readProjectFile("apps/web/public/app/js/main.js");

const requiredWorkspaceTokens = [
  "Hermes Training",
  "Training review desk",
  "ensureAdminLearningToken",
  'const LEARNING_API = "/phantom-ai/hermes/learning-dataset"',
  'learningRequest("/status")',
  'learningRequest("/history?limit=20")',
  'learningRequest("/save-example"',
  'learningRequest("/export-preview"',
  "data-learning-refresh",
  "data-learning-export",
  "data-learning-manual",
  "data-learning-approve",
  "data-learning-correct",
  "data-learning-reject",
  "Export approved",
  "Save approved example",
];

for (const token of requiredWorkspaceTokens) {
  assert(workspaces.includes(token), `Hermes learning review UI should include ${token}.`);
}

assert(
  /isAdmin\(\)\s*\?\s*`<button class="memory-tab/.test(workspaces),
  "Hermes Training tab should be visible only to admin sessions.",
);
assert(
  /memoryUi\.tab === "learning" && isAdmin\(\)/.test(workspaces),
  "Hermes learning review should require admin tab state.",
);
assert(
  workspaces.includes("No provider call") &&
    workspaces.includes("No send") &&
    workspaces.includes("No queue write"),
  "Hermes learning review should show blocked external-action safety flags.",
);

const requiredCssTokens = [
  ".memory-tabs",
  ".memory-tab.is-active",
  ".learning-shell",
  ".learning-head",
  ".learning-manual",
  ".learning-grid",
  ".learning-export",
];

for (const token of requiredCssTokens) {
  assert(css.includes(token), `Hermes learning review CSS should include ${token}.`);
}

const buildId = "phantom-live-20260706-27";
assert(indexHtml.includes(`window.PHANTOM_BUILD = "${buildId}"`), "Index should expose the current build id.");
assert(indexHtml.includes(`content="${buildId}"`), "Index phantom-build meta tag should be bumped.");
assert(indexHtml.includes(`/app/js/main.js?v=${buildId}`), "Index should load the bumped main module.");
assert(mainJs.includes(`./workspaces.js?v=${buildId}`), "Main module should load the bumped workspace bundle.");
assert(mainJs.includes(`const POSE_VERSION = "${buildId}"`), "Pose asset cache should be bumped.");

const forbiddenPublicTokens = [
  "/phantom-ai/approvals/execute",
  "OPENROUTER_API_KEY",
  "sk-or-v1-",
  "sk-proj-",
  "provider_called: true",
  "network_call_performed: true",
  "queue_written: true",
  "production_ledger_written: true",
  "external_action_executed: true",
];

for (const token of forbiddenPublicTokens) {
  assert(!workspaces.includes(token), `Workspace UI must not include forbidden token ${token}.`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      adminOnlyTab: true,
      reviewActions: ["refresh", "approve", "correct", "reject", "manual-save", "export-preview"],
      buildId,
      providerCallAdded: false,
      queueWriteAdded: false,
      approvalExecutionAdded: false,
      externalActionAdded: false,
    },
    null,
    2,
  ),
);
