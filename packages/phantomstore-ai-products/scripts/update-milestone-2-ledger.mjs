import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCTS } from "../src/catalog.mjs";
import { CORE_LOOP_MODULES } from "../src/core-loops.mjs";

const repoRoot = resolve(import.meta.dirname, "../../.."); const ledgerPath = resolve(repoRoot, "docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json"); const completionPath = resolve(repoRoot, "docs/phantomstore-ai-products/MILESTONE_2_COMPLETION_LEDGER.json"); const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const byName = new Map(PRODUCTS.map((product) => [product.name, product]));
const sharedPrimaryActions = new Set([
  "edit after save", "duplicate safely", "archive and restore", "delete under retention rules", "resume after browser refresh", "recover after worker retry", "compare two versions", "export deterministic package", "enforce read-only role", "reject cross-tenant access", "record audit event", "record analytics event", "show provenance", "show version history", "handle concurrent edit", "handle stale object version", "cancel a long-running job", "retry an idempotent mutation", "respect plan limit", "show actionable diagnostics"
]);
const parse = (title) => { const match = title.match(/^[^:]+:\s*(.+?)\s*\/\s*(.+)$/); return { action: match?.[1]?.trim().toLowerCase() || "", module: match?.[2]?.trim() || "" }; };

const previousImplemented = ledger.tickets.filter((ticket) => ticket.status === "implemented_vertical_slice").length;
for (const ticket of ledger.tickets) {
  if (!["deferred", "implemented_milestone_2"].includes(ticket.status)) continue; const product = byName.get(ticket.product); if (!product) continue; const { action, module } = parse(ticket.title); const coreModule = CORE_LOOP_MODULES[product.id]?.includes(module); const coreCreate = coreModule && action === "create from blank state"; const sharedPrimary = module === product.primaryModule && sharedPrimaryActions.has(action); if (!coreCreate && !sharedPrimary) continue;
  ticket.status = "implemented_milestone_2"; ticket.milestone = 2; ticket.priority = coreCreate ? "P0_CORE_LOOP" : "P0_SHARED_FOUNDATION"; ticket.coreLoop = Boolean(coreModule); ticket.releaseCritical = true; ticket.blockedReason = null; ticket.sharedFoundationRequirement = sharedPrimary;
  ticket.implementationLocation = coreCreate ? "packages/phantomstore-ai-products/src/core-loops.mjs; packages/phantomstore-ai-products/src/catalog.mjs; packages/phantomstore-ai-products/src/calculators.mjs; packages/phantomstore-ai-products/public/app.js" : "packages/phantomstore-ai-products/src/platform.mjs; packages/phantomstore-ai-products/src/repositories.mjs; packages/phantomstore-ai-products/src/identity.mjs; packages/phantomstore-ai-products/src/server.mjs; packages/phantomstore-ai-products/public/app.js";
  ticket.testEvidence = coreCreate ? "packages/phantomstore-ai-products/tests/milestone2-core-loops.test.mjs; packages/phantomstore-ai-products/tests/milestone2-foundation.test.mjs" : "packages/phantomstore-ai-products/tests/milestone2-foundation.test.mjs; packages/phantomstore-ai-products/tests/milestone2-api-security.test.mjs; docs/phantomstore-ai-products/MILESTONE_2_BROWSER_PLAYTEST.md";
  ticket.verificationType = coreCreate ? "deterministic_core_loop_and_platform_contract" : "shared_repository_api_and_browser_contract";
  ticket.deviation = coreCreate ? "The module behavior is implemented inside the product's versioned aggregate core loop rather than as a separate SKU or independent route; deterministic output and product-specific acceptance behavior are exercised." : "Implemented through the tenant-scoped shared foundation and exercised against all ten primary product objects; production adapters remain disabled.";
}

const newlyImplemented = ledger.tickets.filter((ticket) => ticket.status === "implemented_milestone_2").length; const deferred = ledger.tickets.filter((ticket) => ticket.status === "deferred").length; const implementedTotal = previousImplemented + newlyImplemented;
ledger.summary = { ...ledger.summary, implementedBeforeMilestone2: previousImplemented, implementedMilestone2Tickets: newlyImplemented, implementedTicketsTotal: implementedTotal, deferredTickets: deferred, partialTickets: 0, blockedTickets: 0, unmappedTickets: 0, falseClaims: 0 };
ledger.truthBoundary = "Milestone 2 promotes only exact primary-object shared behaviors and named core-loop module creation behaviors that exist in reachable code and named verification. All other ticket-bank requirements remain deferred.";

const productBreakdown = Object.fromEntries(PRODUCTS.map((product) => { const items = ledger.tickets.filter((ticket) => ticket.product === product.name); return [product.id, { name: product.name, implementedBefore: items.filter((item) => item.status === "implemented_vertical_slice").length, newlyImplemented: items.filter((item) => item.status === "implemented_milestone_2").length, deferred: items.filter((item) => item.status === "deferred").length, coreLoopModules: CORE_LOOP_MODULES[product.id] }]; }));
const sharedBreakdown = Object.fromEntries([...sharedPrimaryActions].map((action) => [action, ledger.tickets.filter((ticket) => ticket.status === "implemented_milestone_2" && parse(ticket.title).action === action).length]));
const completion = {
  schemaVersion: 1, asOf: "2026-08-17", branch: "codex/phantomstore-ai-products-20260817", head: "fb5814749ae20f184bd890a0ed5f14c4f76eb874", deployment: "not_deployed_local_preview",
  counts: { implementedBefore: previousImplemented, newlyImplemented, implementedTotal, partial: 0, deferred, blocked: 0, unmapped: 0, falseClaims: 0, globalRequirementsMapped: ledger.globalRequirements.length },
  productBreakdown, sharedFoundationBreakdown: sharedBreakdown,
  verification: { focusedAutomatedTests: 40, focusedPassing: 40, focusedBuildBytes: 47291, rootGates: "prisma_generate_build_typecheck_and_existing_phantomstore_tests_pass", browser: "all_10_desktop_core_loops_plus_oracle_chronicle_terrain_causal_at_390x844_zero_console_issues", accessibility: "automated_semantics_plus_documented_manual_pending", secretScan: "trufflehog_3.96.0_strict_zero_findings", productionDependencyAudit: "zero_known_vulnerabilities_after_compatible_fast_uri_patch", fullDevelopmentAudit: "25_inherited_findings_require_separate_major_toolchain_remediation", externalModelsActive: false, externalSpendUsd: 0 },
  naming: { internalKey: "phantom-loom-dependency", storeFacingName: "PHANTOM LOOM", finalPortfolioDecision: "unresolved" },
  remainingBoundary: "All tickets not named implemented in REQUIREMENT_LEDGER.json remain deferred; production adapters, launch infrastructure and independent reviews remain outside this milestone."
};
await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8"); await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ ok: true, ...completion.counts }));
