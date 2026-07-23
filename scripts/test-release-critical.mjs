import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
const checks = [
  "build",
  "typecheck",
  "test:change-memory",
  "test:dashboard-chat",
  "test:command-surface",
  "test:auth-boundaries",
  "test:customer-plan-switching",
  "test:competitor-intelligence",
  "test:client-setup-audit",
  "test:workspace-site-builder",
  "test:organization-settings",
  "test:organization-record-isolation",
  "test:medialab-editor",
  "test:videocut-editor",
  "test:topbar-media",
  "test:workspace-mobile-integrity",
  "test:product-grammar",
  "test:crm-pipeline",
  "test:crm-lifecycle",
  "test:proposal-pipeline",
  "test:proposal-lifecycle",
  "test:finance-ledger",
  "test:commerce-order-lifecycle",
  "test:workspace-approvals",
  "test:agent-run-lifecycle",
  "test:managed-growth-report",
  "test:phantomplay",
];

for (const check of checks) {
  console.log(`\n=== RELEASE CHECK: ${check} ===`);
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run ${check}`]
    : ["run", check];
  const result = spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nRELEASE GATE FAILED: ${check}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nRELEASE GATE PASSED: ${checks.length}/${checks.length} critical checks.`);
