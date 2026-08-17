import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  buildDependencySandbox,
  createPhantomPlayKnowledgeDecision,
  evaluateDiscoveryCandidate,
  getPhantomPlayKnowledgeIndexStatus,
  runPhantomPlayKnowledgeDecision,
  searchPhantomPlayKnowledge,
} from "../src/phantom-ai/phantomplay-discovery.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const repoRoot = resolve(import.meta.dirname, "../..");
const artifactRoot = await mkdtemp(resolve(tmpdir(), "phantomplay-knowledge-"));
const sharedFactors = {
  license: 9,
  maintenance: 8,
  documentation: 8,
  code_quality: 8,
  engine_compatibility: 8,
  security: 8,
  performance: 8,
  relevance: 9,
  integration_cost: 4,
  lock_in_risk: 3,
};

try {
  const status = await getPhantomPlayKnowledgeIndexStatus({ repoRoot });
  assert(status.source_count >= 29, "The curated index must contain substantial Unreal, Unity, research, middleware, and asset evidence.");
  assert(status.official_unreal_sources >= 8, "Official Unreal sources must be first-class in the index.");
  assert(status.official_unity_sources >= 10, "Official Unity sources must remain first-class for Unity uploads.");
  assert(status.policy.official_engine_first === true, "The search policy must prefer official sources for the selected engine.");
  assert(status.policy.automatic_downloads === false, "Knowledge lookup must not download dependencies automatically.");
  assert(status.policy.automatic_code_execution === false, "Knowledge lookup must not execute external code automatically.");
  assert(status.sample_project_coverage_by_engine.unreal.gap_count > 0, "Unreal sample coverage gaps must remain visible instead of being fabricated as complete.");

  const unrealInputSearch = await searchPhantomPlayKnowledge(
    { projectId: "phantom-games-unreal", query: "Unreal Enhanced Input controller rebinding", limit: 8 },
    { repoRoot },
  );
  assert(unrealInputSearch.project_engine.engine_key === "unreal", "Flagship knowledge search must resolve the Unreal project identity.");
  assert(unrealInputSearch.results[0]?.id === "unreal-enhanced-input", "A directly relevant official Unreal source must outrank unrelated material.");
  assert(unrealInputSearch.results[0]?.trust_tier === "official_unreal", "Official Unreal trust evidence must be preserved.");
  assert(unrealInputSearch.live_refresh.performed === false && unrealInputSearch.side_effects.downloads_performed === false, "Local search must report that no live fetch or download occurred.");

  const unityInputSearch = await searchPhantomPlayKnowledge(
    { projectId: "phantom-games-unity", query: "Unity Input System controller rebinding", limit: 8 },
    { repoRoot },
  );
  assert(unityInputSearch.project_engine.engine_key === "unity", "Unity compatibility search must resolve the Unity project identity.");
  assert(unityInputSearch.results[0]?.id === "unity-input-system", "The Unity knowledge route must remain intact.");
  assert(unityInputSearch.results[0]?.trust_tier === "official_unity", "Official Unity trust evidence must remain intact.");

  const lowStars = evaluateDiscoveryCandidate({
    id: "same-engineering-value-low-stars",
    title: "Low stars",
    license: "MIT",
    stars: 5,
    factors: sharedFactors,
  });
  const highStars = evaluateDiscoveryCandidate({
    id: "same-engineering-value-high-stars",
    title: "High stars",
    license: "MIT",
    stars: 50000,
    factors: sharedFactors,
  });
  assert(lowStars.score === highStars.score, "GitHub star count must not influence engineering score.");
  assert(lowStars.stars_used_in_score === false && highStars.stars_used_in_score === false, "Scoring receipts must state that stars were ignored.");

  const legacyFactorAlias = evaluateDiscoveryCandidate({
    id: "legacy-unity-factor-alias",
    title: "Legacy score payload",
    license: "MIT",
    factors: { ...sharedFactors, engine_compatibility: undefined, unity_compatibility: 8 },
  });
  assert(legacyFactorAlias.factors.engine_compatibility === 8, "Legacy unity_compatibility score payloads must remain readable.");

  const unlicensed = evaluateDiscoveryCandidate({
    id: "unlicensed",
    title: "Unlicensed candidate",
    license: "unknown",
    factors: sharedFactors,
  });
  assert(unlicensed.decision === "rejected" && unlicensed.hard_blockers.includes("license_missing_or_unverified"), "Missing licenses must hard-block candidates.");

  const decision = await createPhantomPlayKnowledgeDecision(
    { projectId: "phantom-games-unreal", request: "Design and benchmark navigation for 500 RTS units with local avoidance." },
    { repoRoot, now: "2026-08-11T15:00:00.000Z", unrealEditorReady: false },
  );
  assert(decision.architecture.decision.includes("tiled flow-field"), "Large RTS navigation must produce a flow-field prototype decision.");
  assert(decision.architecture.decision.includes("Unreal task-graph"), "Unreal navigation decisions must include an engine-native parallel data path.");
  assert(decision.architecture.decision.includes("Unreal Navigation System/NavMesh baseline"), "Custom navigation must be benchmarked against the official Unreal baseline.");
  assert(decision.architecture.decision.includes("Mass Entity or Mass AI"), "Mass frameworks must remain conditional on profiling evidence.");
  assert(decision.architecture.automatic_dependency_selection === false, "Research must not auto-select a dependency.");
  assert(decision.research.some((paper) => paper.paper === "Continuum Crowds"), "Research Scout must surface the primary crowd-navigation paper.");
  assert(decision.profiling.engine === "unreal", "Profiling availability must match the project engine.");
  assert(decision.profiling.tools.some((tool) => tool.id === "unreal-insights" && tool.status === "blocked"), "Missing Unreal Editor must keep Unreal Insights visibly blocked.");
  assert(decision.execution.implementation_performed === false && decision.execution.profiling_performed === false, "A research decision must not claim implementation or profiling.");

  const unityDecision = await createPhantomPlayKnowledgeDecision(
    { projectId: "phantom-games-unity", request: "Inspect Unity profiler readiness." },
    { repoRoot, now: "2026-08-11T15:10:00.000Z", unityEditorReady: false },
  );
  assert(unityDecision.profiling.engine === "unity", "Unity profiling inspection must remain available.");
  assert(unityDecision.profiling.tools.some((tool) => tool.id === "unity-profiler" && tool.status === "blocked"), "Unity Editor absence must remain visible.");

  const sandbox = buildDependencySandbox({
    id: "example",
    title: "Example dependency",
    license: "MIT",
    url: "https://example.invalid/source",
  }, "unreal");
  assert(sandbox.steps.length === 12, "Dependency sandbox must enforce every required inspection step.");
  assert(sandbox.steps.some((step) => step.step === "import_isolated_unreal_project"), "Dependency sandbox imports must use the selected engine.");
  assert(sandbox.completed_count === 0 && sandbox.production_integration_allowed === false, "A generated sandbox plan must not authorize integration.");

  const receipt = await runPhantomPlayKnowledgeDecision(
    { projectId: "phantom-games-unreal", request: "Design and benchmark navigation for 500 RTS units with local avoidance." },
    {
      repoRoot,
      artifactRoot,
      ownerScope: "test-workspace",
      requestId: "rts-navigation",
      now: "2026-08-11T15:30:00.000Z",
      unrealEditorReady: false,
    },
  );
  assert(receipt.artifact.relative_path === "test-workspace/phantom-games-unreal/2026-08-11T15-30-00-000Z-rts-navigation.json", "Knowledge receipts must be tenant and project scoped.");
  const persistedText = await readFile(resolve(artifactRoot, receipt.artifact.relative_path), "utf8");
  const persisted = JSON.parse(persistedText) as { receipt?: { status?: string }; execution?: { external_code_executed?: boolean } };
  assert(persisted.receipt?.status === "knowledge_decision_written", "Persisted knowledge receipts must record real write completion.");
  assert(persisted.execution?.external_code_executed === false, "Persisted receipts must preserve the no-execution boundary.");
  assert(!persistedText.includes("api_key") && !persistedText.includes("password"), "Knowledge receipts must not contain secret fields.");

  let traversalRejected = false;
  try {
    await searchPhantomPlayKnowledge({ projectId: "../escape", query: "unreal insights" }, { repoRoot });
  } catch (error) {
    traversalRejected = error instanceof Error && error.message === "invalid_phantomplay_project_id";
  }
  assert(traversalRejected, "Knowledge search must reject project traversal identifiers.");

  console.log(JSON.stringify({
    ok: true,
    sources: status.source_count,
    officialUnrealSources: status.official_unreal_sources,
    officialUnitySources: status.official_unity_sources,
    unrealSampleCoverage: `${status.sample_project_coverage_by_engine.unreal.covered_count}/${status.sample_project_coverage_by_engine.unreal.categories.length}`,
    topUnrealInputResult: unrealInputSearch.results[0]?.id,
    topUnityInputResult: unityInputSearch.results[0]?.id,
    crowdDecision: decision.architecture.decision,
    researchPapers: decision.research.map((paper) => paper.paper),
    profiling: decision.profiling.tools.map((tool) => `${tool.id}:${tool.status}`),
    receipt: receipt.artifact.relative_path,
  }, null, 2));
} finally {
  await rm(artifactRoot, { recursive: true, force: true });
}
