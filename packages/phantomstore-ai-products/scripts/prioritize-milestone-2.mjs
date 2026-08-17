import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const ledgerPath = resolve(repoRoot, "docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json");
const artifactPath = resolve(repoRoot, "artifacts/phantomstore-ai-products/milestone-2-priority-map.json");
const markdownPath = resolve(repoRoot, "docs/phantomstore-ai-products/MILESTONE_2_PRIORITY_MAP.md");
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));

const coreModules = new Map(Object.entries({
  "PHANTOM ORACLE": ["Decision Canvas", "Assumption Ledger", "Scenario Graph", "Sensitivity Explorer", "Decision Journal", "Executive Brief Builder"],
  "PHANTOM CHRONICLE": ["Evidence Intake", "Metadata Inspector", "Timeline Builder", "Contradiction Desk", "Source Provenance", "Chronology Report"],
  "PHANTOM FOUNDRY": ["Schema Studio", "Scenario Recipe Builder", "Generator Fleet", "Coverage Matrix", "Deduplication Lab", "Dataset Versioning", "Benchmark Runner", "Export Registry"],
  "PHANTOM TWIN": ["Process Mapper", "Resource Catalog", "Queue Simulator", "Capacity Planner", "Bottleneck Radar", "What-if Sandbox", "Twin Calibration", "Scenario Export"],
  "PHANTOM DEALROOM": ["Deal Map", "Interest Matrix", "BATNA Builder", "Concession Ladder", "Package Composer", "Counterpart Simulator", "Rehearsal Room", "Commitment Ledger", "Meeting Debrief"],
  "PHANTOM BLUEPRINT": ["Requirements Compiler", "Architecture Canvas", "Component Registry", "Data Contract Studio", "API Designer", "Test Blueprint", "Change Impact Graph", "Spec Exporter"],
  "PHANTOM TERRAIN": ["Layer Catalog", "Site Scorer", "Constraint Overlay", "Candidate Compare", "Weight Sensitivity", "Data Freshness Monitor", "Export Composer"],
  "PHANTOM PROOF": ["Claim Decomposer", "Evidence Board", "Source Quality Lens", "Support/Oppose Matrix", "Citation Inspector", "Freshness Watch", "Circularity Detector", "Reviewer Workflow", "Proof Packet", "Export Studio"],
  "PHANTOM LOOM": ["Corpus Intake", "Commitment Extractor", "Dependency Graph", "Contradiction Radar", "Owner Map", "Deadline Mesh", "Change Impact", "Source Trace", "Revision Diff", "Dependency Brief"],
  "PHANTOM CAUSAL": ["Hypothesis Studio", "Causal DAG Builder", "Metric Registry", "Power Planner", "Pre-registration", "Analysis Notebook", "Sensitivity Checks", "Experiment Library", "Result Brief"]
}));

const sharedActionPatterns = [
  /edit after save/, /duplicate safely/, /archive and restore/, /delete under retention rules/, /resume after browser refresh/,
  /recover after worker retry/, /export deterministic package/, /enforce read-only role/, /reject cross-tenant access/,
  /record audit event/, /show provenance/, /show version history/, /handle concurrent edit/, /handle stale object version/,
  /cancel a long-running job/, /retry an idempotent mutation/, /respect plan limit/
];

function parts(ticket) {
  const match = ticket.title.match(/^[^:]+:\s*(.+?)\s*\/\s*(.+)$/);
  return { action: match?.[1]?.trim().toLowerCase() || "unparsed", module: match?.[2]?.trim() || "Unparsed" };
}

function classify(ticket) {
  const { action, module } = parts(ticket);
  const coreLoop = coreModules.get(ticket.product)?.includes(module) || false;
  let priority = "P2_ADVANCED";
  let dependencyClass = "PRODUCT_DOMAIN";
  let implementationOwner = `PRODUCT_${ticket.product.replace(/^PHANTOM /, "").replace(/\W+/g, "_")}`;
  let verificationType = "product_contract_and_browser";
  let sharedFoundationRequirement = false;

  if (ticket.status === "implemented_vertical_slice") {
    priority = "P0_CORE_LOOP";
  } else if (/keyboard only|screen reader semantics/.test(action)) {
    priority = "P1_ACCESSIBILITY"; dependencyClass = "ACCESSIBILITY"; implementationOwner = "UX_ACCESSIBILITY"; verificationType = "automated_semantics_and_manual_accessibility";
  } else if (/handle provider timeout|handle invalid ai schema/.test(action)) {
    priority = "P1_OPERATIONS"; dependencyClass = "AI_ANALYSIS_RELIABILITY"; implementationOwner = "PLATFORM_RELIABILITY"; verificationType = "failure_injection_contract"; sharedFoundationRequirement = true;
  } else if (/operate under slow network|record analytics event|show actionable diagnostics|generate support bundle safely/.test(action)) {
    priority = "P1_OPERATIONS"; dependencyClass = "OBSERVABILITY_OPERATIONS"; implementationOwner = "PLATFORM_RELIABILITY"; verificationType = "observability_and_browser_state"; sharedFoundationRequirement = true;
  } else if (sharedActionPatterns.some((pattern) => pattern.test(action))) {
    priority = "P0_SHARED_FOUNDATION"; sharedFoundationRequirement = true; implementationOwner = "SHARED_PLATFORM";
    if (/cross-tenant|read-only|delete|audit/.test(action)) { dependencyClass = "SECURITY_PRIVACY"; verificationType = "authorization_privacy_contract"; }
    else if (/worker|long-running job/.test(action)) { dependencyClass = "DURABLE_JOBS"; verificationType = "job_recovery_contract"; }
    else if (/export|provenance/.test(action)) { dependencyClass = "PROVENANCE_EXPORT"; verificationType = "export_schema_contract"; }
    else if (/concurrent|stale object|version history/.test(action)) { dependencyClass = "VERSION_CONCURRENCY"; verificationType = "concurrency_contract"; }
    else if (/plan limit/.test(action)) { dependencyClass = "ENTITLEMENTS"; verificationType = "entitlement_contract"; }
    else { dependencyClass = "PERSISTENCE_LIFECYCLE"; verificationType = "repository_contract"; }
  } else if (coreLoop) {
    priority = "P0_CORE_LOOP";
  } else if (/import from valid source|reject malformed import|search\/filter at scale|compare two versions/.test(action)) {
    priority = "P1_PRODUCT_COMPLETION";
  } else if (/create from blank state/.test(action)) {
    priority = "P1_PRODUCT_COMPLETION";
  } else {
    priority = "P3_OPTIONAL_OR_POST_LAUNCH";
  }

  const releaseCritical = priority.startsWith("P0_") || ["P1_SECURITY_PRIVACY", "P1_ACCESSIBILITY", "P1_OPERATIONS"].includes(priority);
  const blockedReason = ticket.status === "implemented_vertical_slice" ? null
    : priority.startsWith("P0_") ? "Milestone 2 candidate; remains deferred until reachable behavior and verification evidence exist."
      : "Sequenced after Milestone 2 core-loop and shared-foundation dependencies."
  return {
    milestone: ticket.status === "implemented_vertical_slice" ? 1 : priority.startsWith("P0_") ? 2 : "post_milestone_2",
    priority, dependencyClass, coreLoop, releaseCritical, implementationOwner, verificationType, blockedReason, sharedFoundationRequirement
  };
}

ledger.schemaVersion = Math.max(2, Number(ledger.schemaVersion) || 1);
ledger.tickets = ledger.tickets.map((ticket) => ({ ...ticket, ...classify(ticket) }));
ledger.summary.milestone2PrioritizedDeferredTickets = ledger.tickets.filter((ticket) => ticket.status === "deferred" && ticket.milestone === 2).length;

const countBy = (items, key) => Object.fromEntries([...new Set(items.map((item) => item[key]))].sort().map((value) => [value, items.filter((item) => item[key] === value).length]));
const deferred = ledger.tickets.filter((ticket) => ticket.status === "deferred");
const summary = {
  schemaVersion: 1,
  generatedAt: "2026-08-17T01:24:30.000-05:00",
  sourceLedger: "docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json",
  deferredCount: deferred.length,
  countsByProduct: countBy(deferred, "product"),
  countsByPriority: countBy(deferred, "priority"),
  countsByDependencyClass: countBy(deferred, "dependencyClass"),
  countsByReleaseCriticality: { releaseCritical: deferred.filter((item) => item.releaseCritical).length, notReleaseCritical: deferred.filter((item) => !item.releaseCritical).length },
  topSharedBlockers: Object.entries(countBy(deferred.filter((item) => item.sharedFoundationRequirement), "dependencyClass")).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([dependencyClass, count]) => ({ dependencyClass, count })),
  topProductSpecificBlockers: Object.entries(countBy(deferred.filter((item) => !item.sharedFoundationRequirement), "product")).sort((a, b) => b[1] - a[1]).map(([product, count]) => ({ product, count }))
};

const table = (record) => Object.entries(record).map(([key, value]) => `| ${key} | ${value} |`).join("\n");
const markdown = `# Milestone 2 Priority Map

Generated: 2026-08-17
Deferred tickets classified: ${summary.deferredCount}
Status transitions performed by this prioritization step: 0

This map sequences the existing deferred ticket bank. It does not mark any requirement implemented. Source prompt hashes, source lines, titles and prior evidence remain intact in the requirement ledger.

## By priority

| Priority | Count |
|---|---:|
${table(summary.countsByPriority)}

## By dependency class

| Dependency class | Count |
|---|---:|
${table(summary.countsByDependencyClass)}

## By product

| Product | Count |
|---|---:|
${table(summary.countsByProduct)}

## Release criticality

| Class | Count |
|---|---:|
| Release critical | ${summary.countsByReleaseCriticality.releaseCritical} |
| Not release critical | ${summary.countsByReleaseCriticality.notReleaseCritical} |

## Top shared blockers

${summary.topSharedBlockers.map((item) => `- ${item.dependencyClass}: ${item.count}`).join("\n")}

## Top product-specific blockers

${summary.topProductSpecificBlockers.map((item) => `- ${item.product}: ${item.count}`).join("\n")}

## Classification policy

- P0 shared foundation covers tenant-safe persistence/lifecycle, authorization, provenance/export, versioning/concurrency, durable jobs, entitlements and reusable failure behavior.
- P0 core loop covers modules explicitly named by the Milestone 2 execution contract.
- Accessibility and operations behaviors stay P1 release-critical until their required automated and manual evidence exists.
- Advanced and optional module behaviors remain post-Milestone 2.
`;

await mkdir(resolve(repoRoot, "artifacts/phantomstore-ai-products"), { recursive: true });
await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
await writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(markdownPath, markdown, "utf8");
console.log(JSON.stringify({ ok: true, ledgerPath, artifactPath, markdownPath, ...summary.countsByPriority }));
