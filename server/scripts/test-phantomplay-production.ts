import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  discoverUnrealEditor,
  inspectPhantomPlayProduction,
  runPhantomPlayProductionAudit,
} from "../src/phantom-ai/phantomplay-production.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const repoRoot = resolve(import.meta.dirname, "../..");
const artifactRoot = await mkdtemp(resolve(tmpdir(), "phantomplay-production-"));
const probes = {
  phantomFlow: async () => ({
    online: false,
    installed: true,
    state: "offline",
    engine: "PhantomFlow Test Probe",
  }),
  unrealEditor: async () => ({
    ready: false,
    executable: null,
    version: null,
    reason: "unreal_editor_not_installed_in_test",
  }),
  unityEditor: async () => ({
    ready: false,
    executable: null,
    version: null,
    reason: "unity_editor_not_installed_in_test",
  }),
};

try {
  const fakeEngineRoot = resolve(artifactRoot, "alternate-drive", "UE_5.8");
  const fakeEditor = resolve(fakeEngineRoot, "Engine", "Binaries", "Win64", "UnrealEditor.exe");
  const fakeManifestRoot = resolve(artifactRoot, "Epic", "Manifests");
  await mkdir(dirname(fakeEditor), { recursive: true });
  await mkdir(fakeManifestRoot, { recursive: true });
  await writeFile(fakeEditor, "", "utf8");
  await writeFile(resolve(fakeManifestRoot, "UE_5.8.item"), JSON.stringify({
    InstallLocation: fakeEngineRoot,
    LaunchExecutable: "Engine/Binaries/Win64/UnrealEditor.exe",
    AppName: "UE_5.8",
    AppVersionString: "5.8.1-56057345+++UE5+Release-5.8-Windows",
    AppCategories: ["engines/ue5"],
  }), "utf8");
  const discoveredEditor = await discoverUnrealEditor(fakeManifestRoot);
  assert(discoveredEditor.ready, "Epic Launcher manifests must discover Unreal Engine outside C:\\Program Files.");
  assert(discoveredEditor.executable === fakeEditor, "Epic manifest discovery must return the declared UnrealEditor executable.");
  assert(discoveredEditor.version === "5.8.1", "Epic manifest discovery must report the installed engine version.");

  const baseline = await inspectPhantomPlayProduction(
    { projectId: "phantom-games-unreal", request: "Audit the flagship project, assets, dependencies, providers, and validation coverage." },
    { repoRoot, probes, now: "2026-08-11T12:00:00.000Z" },
  );

  assert(baseline.project.engine === "Unreal Engine 5.8.1", "The flagship Creative Bible must pin the installed Unreal Engine 5.8.1 release.");
  assert(baseline.project.engine_key === "unreal", "The flagship project must route through Unreal tools.");
  assert(baseline.tools.some((tool) => tool.id === "unreal.architect" && tool.health === "ready"), "Checked-in Unreal project evidence must make the Unreal Architect ready.");
  assert(baseline.tools.some((tool) => tool.id === "unreal.build-engineer" && tool.health === "blocked"), "Unreal builds must remain blocked without Unreal Editor.");
  assert(baseline.tools.some((tool) => tool.id === "unity.architect"), "Unity tooling must remain registered for unrelated Unity uploads.");
  assert(baseline.providers.some((provider) => provider.id === "phantomplay-runtime-adapters" && provider.health === "ready"), "The multi-engine runtime adapter must be discoverable.");
  assert(baseline.providers.some((provider) => provider.id === "unreal-project" && provider.health === "ready"), "The Unreal flagship project provider must be ready.");
  assert(baseline.providers.some((provider) => provider.id === "unity-project" && provider.health === "ready"), "The Unity compatibility provider must remain discoverable.");
  assert(baseline.providers.some((provider) => provider.id === "phantomflow" && provider.health === "blocked"), "Offline installed PhantomFlow must report blocked, not ready.");
  assert(baseline.assets.accepted_count === 4 && baseline.assets.blocked_count === 0, "Every Unreal asset record must exist with valid ownership evidence.");
  assert(baseline.assets.duplicate_paths.length === 0, "Asset registry must not contain duplicate paths.");
  assert(baseline.dependencies.engine === "unreal", "The dependency adapter must match the project engine.");
  assert(baseline.dependencies.packages.some((dependency) => dependency.id === "plugin:EnhancedInput"), "The Unreal descriptor plugins must be audited.");
  assert(baseline.dependencies.packages.every((dependency) => dependency.pinned), "Every Unreal dependency record must be tied to the declared engine association.");
  assert(baseline.plan.tasks.some((task) => task.capability === "engine_architecture" && task.tool_id === "unreal.architect"), "The task planner must select the Unreal architect for the flagship project.");
  assert(baseline.validation.graph_valid, "Baseline production task graph must be valid.");
  assert(baseline.validation.completion_claimed === false, "An audit must never claim production completion.");

  const unityCompatibility = await inspectPhantomPlayProduction(
    { projectId: "phantom-games-unity", request: "Audit this Unity compatibility project without changing the Unreal flagship assignment." },
    { repoRoot, probes, now: "2026-08-11T12:10:00.000Z" },
  );
  assert(unityCompatibility.project.engine_key === "unity", "Legacy and uploaded Unity projects must still select Unity tooling.");
  assert(unityCompatibility.plan.tasks.some((task) => task.capability === "engine_architecture" && task.tool_id === "unity.architect"), "The planner must select the Unity architect for a Unity project.");
  assert(unityCompatibility.dependencies.engine === "unity" && unityCompatibility.dependencies.packages.length > 0, "Unity package auditing must remain operational.");

  const flagship = await runPhantomPlayProductionAudit(
    {
      projectId: "phantom-games-unreal",
      request: "Create a massive nighttime battle. The outer wall collapses, a dragon emerges, Phantom Age begins, and the score must come from PhantomFlow. Build, visually inspect, playtest, and profile it.",
    },
    {
      repoRoot,
      artifactRoot,
      ownerScope: "test-workspace",
      requestId: "night-battle",
      probes,
      now: "2026-08-11T12:30:00.000Z",
    },
  );

  assert(flagship.plan.status === "blocked", "Unimplemented specialist capabilities must block the production plan.");
  assert(flagship.plan.missing_capabilities.includes("creature_factory"), "Dragon requests must expose the missing Creature Factory.");
  assert(flagship.plan.missing_capabilities.includes("destruction"), "Wall collapse must expose the missing Destruction capability.");
  assert(flagship.plan.music_routing?.provider === "phantomflow", "Primary music must route only through PhantomFlow.");
  assert(flagship.plan.music_routing?.engine_key === "unreal", "Music integration must carry the selected engine identity.");
  assert(flagship.plan.music_routing?.engine_generates_primary_music === false, "The game engine must not be presented as a primary music generator.");
  assert(flagship.creative_direction.music_brief?.provider === "phantomflow", "Creative direction must produce a structured PhantomFlow brief.");
  assert(flagship.validation.graph_valid, "Build requests must preserve a dependency-safe production task order.");
  assert(flagship.validation.game_launched === false, "No game launch may be fabricated by the audit.");
  assert(flagship.validation.visual_inspection_completed === false, "No visual QA may be fabricated by the audit.");
  assert(flagship.execution.external_generation_performed === false, "Audit must not pretend external generation ran.");
  assert(!flagship.execution.tools_executed.includes("unity.architect"), "An Unreal audit must never report executing the Unity architect.");
  assert(flagship.execution.engine_tools_inspected.includes("unreal.architect"), "The receipt must name the engine-specific architect it inspected.");
  assert(flagship.artifact.relative_path === "test-workspace/phantom-games-unreal/2026-08-11T12-30-00-000Z-night-battle.json", "Audit artifacts must be tenant and project scoped.");

  const artifactText = await readFile(resolve(artifactRoot, flagship.artifact.relative_path), "utf8");
  const persisted = JSON.parse(artifactText) as { execution?: { status?: string }; validation?: { audit_status?: string } };
  assert(persisted.execution?.status === "audit_receipt_written", "Persisted receipts must record actual execution status.");
  assert(persisted.validation?.audit_status === "completed_with_blockers", "Persisted receipts must retain visible blockers.");
  assert(!artifactText.includes("api_key") && !artifactText.includes("password"), "Audit receipts must not contain secret fields.");

  let traversalRejected = false;
  try {
    await inspectPhantomPlayProduction(
      { projectId: "../escape", request: "audit" },
      { repoRoot, probes },
    );
  } catch (error) {
    traversalRejected = error instanceof Error && error.message === "invalid_phantomplay_project_id";
  }
  assert(traversalRejected, "Project traversal identifiers must be rejected.");

  console.log(JSON.stringify({
    ok: true,
    flagshipProject: baseline.project.id,
    flagshipEngine: baseline.project.engine,
    unityCompatibilityProject: unityCompatibility.project.id,
    providers: baseline.providers.map((provider) => `${provider.id}:${provider.health}`),
    assetsAccepted: baseline.assets.accepted_count,
    dependenciesAudited: baseline.dependencies.packages.length,
    flagshipMissingCapabilities: flagship.plan.missing_capabilities,
    musicProvider: flagship.plan.music_routing?.provider,
    artifact: flagship.artifact.relative_path,
  }, null, 2));
} finally {
  await rm(artifactRoot, { recursive: true, force: true });
}
