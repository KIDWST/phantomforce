import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, "../../..");
const knowledgeIndexPath = "docs/phantomplay-production/knowledge-sources.json";

export const DEFAULT_PHANTOMPLAY_KNOWLEDGE_ARTIFACT_ROOT = resolve(
  process.env.PHANTOMPLAY_PRODUCTION_DATA_DIR || resolve(defaultRepoRoot, ".local", "phantomplay-production"),
  "knowledge",
);

type JsonRecord = Record<string, unknown>;

type KnowledgeKind =
  | "internal"
  | "documentation"
  | "profiling"
  | "repository-index"
  | "sample-project"
  | "research-paper"
  | "middleware"
  | "asset-library";

type TrustTier = "internal" | "official_unreal" | "official_unity" | "primary_research" | "trusted_community" | "official_vendor";

type KnowledgeSource = {
  id: string;
  title: string;
  kind: KnowledgeKind;
  owner: string;
  trust_tier: TrustTier;
  url: string;
  categories: string[];
  keywords: string[];
  engines: string[];
  engine_versions: string[];
  license: string;
  maintenance: string;
  summary: string;
  practical_use: string;
  caution: string;
  code_availability: string;
};

type KnowledgeIndex = {
  schema_version: string;
  last_verified: string;
  policy: {
    search_order: string[];
    official_engine_first: boolean;
    official_unity_first: boolean;
    automatic_downloads: boolean;
    automatic_code_execution: boolean;
    production_integration_requires_dependency_sandbox: boolean;
    github_stars_are_scoring_input: boolean;
  };
  sources: KnowledgeSource[];
};

export type RepositoryScoreFactors = {
  license: number;
  maintenance: number;
  documentation: number;
  code_quality: number;
  engine_compatibility?: number;
  unity_compatibility?: number;
  security: number;
  performance: number;
  relevance: number;
  integration_cost: number;
  lock_in_risk: number;
};

export type DiscoveryCandidate = {
  id: string;
  title: string;
  license: string;
  trustTier?: TrustTier;
  stars?: number;
  factors: RepositoryScoreFactors;
};

export type PhantomPlayKnowledgeOptions = {
  repoRoot?: string;
  artifactRoot?: string;
  now?: string;
  ownerScope?: string;
  requestId?: string;
  unrealEditorReady?: boolean;
  unityEditorReady?: boolean;
  externalToolPaths?: Partial<Record<"renderdoc" | "nvidia_nsight" | "amd_rgp", string>>;
};

export type PhantomPlayKnowledgeSearchInput = {
  projectId: string;
  query: string;
  kind?: KnowledgeKind;
  category?: string;
  limit?: number;
};

export type PhantomPlayKnowledgeDecisionInput = {
  projectId: string;
  request: string;
};

const sampleCoverageCategories = [
  "fps-controller",
  "third-person-character",
  "rts-selection",
  "strategy-camera",
  "shaders",
  "vfx-graph",
  "hdrp",
  "urp",
  "animation",
  "cinemachine",
  "timeline",
  "ai",
  "navmesh",
  "dots",
  "ecs",
  "multiplayer",
  "addressables",
  "ui-toolkit",
  "procedural-terrain",
  "world-streaming",
  "audio",
  "save-systems",
] as const;

const profilingSourceIds = [
  "unreal-insights",
  "unreal-performance-profiling",
  "unity-profiler",
  "unity-profile-analyzer",
  "unity-memory-profiler",
  "unity-frame-debugger",
  "unity-urp-rendering-debugger",
] as const;

const trustPriority: Record<TrustTier, number> = {
  internal: 5,
  official_unreal: 4,
  official_unity: 4,
  official_vendor: 3,
  primary_research: 2,
  trusted_community: 1,
};

type CanonicalRepositoryScoreFactors = Omit<RepositoryScoreFactors, "engine_compatibility" | "unity_compatibility"> & {
  engine_compatibility: number;
};

const scoreWeights: Record<keyof CanonicalRepositoryScoreFactors, number> = {
  license: 1.2,
  maintenance: 1,
  documentation: 0.9,
  code_quality: 0.9,
  engine_compatibility: 1.2,
  security: 1,
  performance: 1,
  relevance: 1.3,
  integration_cost: 0.8,
  lock_in_risk: 0.7,
};

function cleanText(value: unknown, maximum = 5000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function safeId(value: unknown, fallback = "local") {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || fallback;
}

function ensureProjectId(value: unknown) {
  const original = cleanText(value, 100);
  const normalized = safeId(original, "");
  if (!normalized || normalized !== original) throw new Error("invalid_phantomplay_project_id");
  return normalized;
}

function resolveInside(root: string, path: string) {
  if (!path || isAbsolute(path)) throw new Error("unsafe_phantomplay_knowledge_path");
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, path);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("unsafe_phantomplay_knowledge_path");
  }
  return target;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type ProjectProfile = {
  engine_key: string;
  engine: string;
  project_path: string | null;
};

async function loadProjectProfile(repoRoot: string, projectId: string): Promise<ProjectProfile> {
  const biblePath = resolveInside(repoRoot, `docs/phantomplay-production/creative-bibles/${projectId}.json`);
  if (!(await exists(biblePath))) return { engine_key: "generic", engine: "Unspecified engine", project_path: null };
  const parsed = JSON.parse(await readFile(biblePath, "utf8")) as JsonRecord;
  const engine = cleanText(parsed.engine, 120) || "Unspecified engine";
  const engineKey = cleanText(parsed.engine_key, 40).toLowerCase()
    || (/unreal/iu.test(engine) ? "unreal" : /unity/iu.test(engine) ? "unity" : "generic");
  const projectPath = cleanText(parsed.project_path, 300) || cleanText(parsed.unity_project_path, 300) || null;
  return { engine_key: engineKey, engine, project_path: projectPath };
}

function requiredString(source: JsonRecord, key: string) {
  const value = cleanText(source[key], 1200);
  if (!value) throw new Error(`missing_${key}`);
  return value;
}

function stringList(value: unknown, maximum = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, 300))
    .filter(Boolean)
    .slice(0, maximum);
}

function parseKnowledgeSource(raw: unknown): KnowledgeSource {
  const source = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
  const kind = requiredString(source, "kind") as KnowledgeKind;
  const trustTier = requiredString(source, "trust_tier") as TrustTier;
  const allowedKinds: KnowledgeKind[] = [
    "internal",
    "documentation",
    "profiling",
    "repository-index",
    "sample-project",
    "research-paper",
    "middleware",
    "asset-library",
  ];
  const allowedTrustTiers: TrustTier[] = ["internal", "official_unreal", "official_unity", "official_vendor", "primary_research", "trusted_community"];
  if (!allowedKinds.includes(kind)) throw new Error(`unsupported_knowledge_kind:${kind}`);
  if (!allowedTrustTiers.includes(trustTier)) throw new Error(`unsupported_knowledge_trust_tier:${trustTier}`);
  const legacyUnityVersions = stringList(source.unity_versions);
  const engineVersions = stringList(source.engine_versions).length
    ? stringList(source.engine_versions)
    : legacyUnityVersions;
  const declaredEngines = stringList(source.engines).map((engine) => engine.toLowerCase());
  const inferredEngines = trustTier === "official_unreal"
    ? ["unreal"]
    : trustTier === "official_unity"
      ? ["unity"]
      : legacyUnityVersions.length
        ? ["unity"]
      : engineVersions.some((version) => /engine-agnostic/iu.test(version))
        ? ["all"]
        : [];
  const parsed = {
    id: requiredString(source, "id"),
    title: requiredString(source, "title"),
    kind,
    owner: requiredString(source, "owner"),
    trust_tier: trustTier,
    url: requiredString(source, "url"),
    categories: stringList(source.categories),
    keywords: stringList(source.keywords),
    engines: declaredEngines.length ? declaredEngines : inferredEngines,
    engine_versions: engineVersions,
    license: requiredString(source, "license"),
    maintenance: requiredString(source, "maintenance"),
    summary: requiredString(source, "summary"),
    practical_use: requiredString(source, "practical_use"),
    caution: requiredString(source, "caution"),
    code_availability: requiredString(source, "code_availability"),
  };
  if (!parsed.categories.length || !parsed.keywords.length) throw new Error(`knowledge_source_not_searchable:${parsed.id}`);
  return parsed;
}

async function loadKnowledgeIndex(repoRoot: string): Promise<KnowledgeIndex> {
  const path = resolveInside(repoRoot, knowledgeIndexPath);
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_phantomplay_knowledge_index");
  const source = raw as JsonRecord;
  const policy = (source.policy && typeof source.policy === "object" ? source.policy : {}) as JsonRecord;
  const sources = (Array.isArray(source.sources) ? source.sources : []).map(parseKnowledgeSource);
  if (!sources.length) throw new Error("phantomplay_knowledge_index_empty");
  if (new Set(sources.map((item) => item.id)).size !== sources.length) throw new Error("duplicate_phantomplay_knowledge_source_id");
  return {
    schema_version: requiredString(source, "schema_version"),
    last_verified: requiredString(source, "last_verified"),
    policy: {
      search_order: stringList(policy.search_order),
      official_engine_first: policy.official_engine_first === true || policy.official_unity_first === true,
      official_unity_first: policy.official_unity_first === true,
      automatic_downloads: policy.automatic_downloads === true,
      automatic_code_execution: policy.automatic_code_execution === true,
      production_integration_requires_dependency_sandbox: policy.production_integration_requires_dependency_sandbox === true,
      github_stars_are_scoring_input: policy.github_stars_are_scoring_input === true,
    },
    sources,
  };
}

function clampScore(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(10, Math.max(0, numeric));
}

export function evaluateDiscoveryCandidate(candidate: DiscoveryCandidate) {
  const license = cleanText(candidate.license, 300);
  const factors: CanonicalRepositoryScoreFactors = {
    license: clampScore(candidate.factors.license),
    maintenance: clampScore(candidate.factors.maintenance),
    documentation: clampScore(candidate.factors.documentation),
    code_quality: clampScore(candidate.factors.code_quality),
    engine_compatibility: clampScore(candidate.factors.engine_compatibility ?? candidate.factors.unity_compatibility),
    security: clampScore(candidate.factors.security),
    performance: clampScore(candidate.factors.performance),
    relevance: clampScore(candidate.factors.relevance),
    integration_cost: clampScore(candidate.factors.integration_cost),
    lock_in_risk: clampScore(candidate.factors.lock_in_risk),
  };
  if (!license || /^(unknown|none|missing|unlicensed)$/iu.test(license)) {
    return {
      id: safeId(candidate.id, "candidate"),
      title: cleanText(candidate.title, 300),
      decision: "rejected",
      score: 0,
      hard_blockers: ["license_missing_or_unverified"],
      factors,
      stars_reported: Number.isFinite(candidate.stars) ? Number(candidate.stars) : null,
      stars_used_in_score: false,
      scoring_model: "weighted_engineering_value_v1",
    };
  }

  const normalizedFactors = {
    ...factors,
    integration_cost: 10 - factors.integration_cost,
    lock_in_risk: 10 - factors.lock_in_risk,
  };
  const weightedTotal = (Object.keys(scoreWeights) as Array<keyof CanonicalRepositoryScoreFactors>)
    .reduce((total, key) => total + normalizedFactors[key] * scoreWeights[key], 0);
  const weightTotal = Object.values(scoreWeights).reduce((total, value) => total + value, 0);
  const trustBonus = candidate.trustTier === "official_unity" || candidate.trustTier === "official_unreal"
    ? 0.25
    : candidate.trustTier === "internal"
      ? 0.2
      : 0;
  const score = Math.min(10, Number((weightedTotal / weightTotal + trustBonus).toFixed(2)));
  const hardBlockers = [
    ...(factors.engine_compatibility < 3 ? ["engine_compatibility_too_low"] : []),
    ...(factors.security < 3 ? ["security_evidence_too_weak"] : []),
  ];
  const decision = hardBlockers.length ? "rejected" : score >= 8 ? "shortlist" : score >= 6 ? "dependency_sandbox" : "rejected";
  return {
    id: safeId(candidate.id, "candidate"),
    title: cleanText(candidate.title, 300),
    decision,
    score,
    hard_blockers: hardBlockers,
    factors,
    normalized_factors: normalizedFactors,
    stars_reported: Number.isFinite(candidate.stars) ? Number(candidate.stars) : null,
    stars_used_in_score: false,
    scoring_model: "weighted_engineering_value_v1",
  };
}

function tokens(value: string) {
  const stopWords = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);
  return [...new Set(value.toLowerCase().split(/[^a-z0-9+#.-]+/u).filter((token) => token.length > 1 && !stopWords.has(token)))];
}

function sourceCandidateFactors(source: KnowledgeSource, relevance: number, engineKey: string): RepositoryScoreFactors {
  const openLicense = /\b(apache|mit|cc0|bsd)\b/iu.test(source.license);
  const requiresVerification = /verify|separate|terms|per-repository/iu.test(source.license);
  const current = /active|current|released|package-managed/iu.test(source.maintenance);
  const stale = /unmaintained|unknown/iu.test(source.maintenance);
  const official = source.trust_tier === "official_unity" || source.trust_tier === "official_unreal" || source.trust_tier === "internal";
  const packageOrLocal = /package|local|built-in/iu.test(source.code_availability);
  const declaredForEngine = !source.engines.length || source.engines.includes("all") || source.engines.includes(engineKey);
  const legacyUnityIncompatible = engineKey === "unity" && source.engine_versions.some((version) => /2018\./u.test(version));
  const currentEngineVersion = engineKey === "unity"
    ? source.engine_versions.some((version) => /6000|Unity 6/iu.test(version))
    : engineKey === "unreal"
      ? source.engine_versions.some((version) => /5\.|Unreal 5/iu.test(version))
      : declaredForEngine;
  return {
    license: openLicense ? 9 : requiresVerification ? 6 : 8,
    maintenance: current ? 9 : stale ? 3 : 6,
    documentation: source.kind === "documentation" || source.kind === "profiling" ? 10 : official ? 8 : 6,
    code_quality: source.kind === "research-paper" ? 6 : official ? 8 : 6,
    engine_compatibility: !declaredForEngine || legacyUnityIncompatible ? 2 : currentEngineVersion ? 9 : 6,
    security: official ? 8 : source.kind === "research-paper" ? 7 : 5,
    performance: source.categories.some((category) => /profil|performance|jobs|burst|crowd/u.test(category)) ? 9 : 6,
    relevance: Math.min(10, Math.max(1, relevance)),
    integration_cost: source.kind === "documentation" || source.kind === "research-paper" ? 3 : packageOrLocal ? 4 : 7,
    lock_in_risk: source.kind === "documentation" || source.kind === "research-paper" ? 2 : source.kind === "middleware" ? 7 : 4,
  };
}

function sourceRelevance(source: KnowledgeSource, queryTokens: string[]) {
  if (!queryTokens.length) return 1;
  const title = source.title.toLowerCase();
  const categories = source.categories.join(" ").toLowerCase();
  const keywords = source.keywords.join(" ").toLowerCase();
  const details = `${source.summary} ${source.practical_use}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 3;
    if (keywords.includes(token)) score += 2;
    if (categories.includes(token)) score += 1.5;
    if (details.includes(token)) score += 0.5;
  }
  return Number(score.toFixed(2));
}

function serializeSource(source: KnowledgeSource, relevance: number, engineKey: string) {
  const evaluation = evaluateDiscoveryCandidate({
    id: source.id,
    title: source.title,
    license: source.license,
    trustTier: source.trust_tier,
    factors: sourceCandidateFactors(source, Math.min(10, Math.max(1, relevance)), engineKey),
  });
  return {
    ...source,
    relevance,
    trust_priority: trustPriority[source.trust_tier],
    evaluation,
  };
}

function sampleCoverage(sources: KnowledgeSource[], engineKey = "generic") {
  const samples = sources.filter((source) => (source.kind === "sample-project" || source.kind === "internal")
    && (engineKey === "generic" || !source.engines.length || source.engines.includes("all") || source.engines.includes(engineKey)));
  const categories = sampleCoverageCategories.map((category) => {
    const sourceIds = samples.filter((source) => source.categories.includes(category)).map((source) => source.id);
    return { category, covered: sourceIds.length > 0, source_ids: sourceIds };
  });
  return {
    categories,
    covered_count: categories.filter((item) => item.covered).length,
    gap_count: categories.filter((item) => !item.covered).length,
    gaps: categories.filter((item) => !item.covered).map((item) => item.category),
  };
}

async function inspectUnityProfilingToolkit(
  repoRoot: string,
  options: PhantomPlayKnowledgeOptions,
  index: KnowledgeIndex,
  project: ProjectProfile,
) {
  if (!project.project_path) throw new Error("unity_project_path_missing");
  const manifestPath = resolveInside(repoRoot, `${project.project_path}/Packages/manifest.json`);
  const manifestRaw = JSON.parse(await readFile(manifestPath, "utf8")) as { dependencies?: Record<string, string> };
  const dependencies = manifestRaw.dependencies ?? {};
  const editorReady = options.unityEditorReady === true;
  const hasUrp = Boolean(dependencies["com.unity.render-pipelines.universal"]);
  const hasHdrp = Boolean(dependencies["com.unity.render-pipelines.high-definition"]);
  const externalDefaults = {
    renderdoc: "C:\\Program Files\\RenderDoc\\qrenderdoc.exe",
    nvidia_nsight: "C:\\Program Files\\NVIDIA Corporation\\Nsight Graphics\\Nsight.Graphics.exe",
    amd_rgp: "C:\\Program Files\\RadeonDeveloperToolSuite\\RadeonGpuProfiler.exe",
  };
  const externalPaths = { ...externalDefaults, ...(options.externalToolPaths ?? {}) };
  const external = await Promise.all(Object.entries(externalPaths).map(async ([id, path]) => ({
    id,
    path,
    installed: await exists(path),
    executed: false,
  })));
  const sourceById = new Map(index.sources.map((source) => [source.id, source]));
  const tools = [
    {
      id: "unity-profiler",
      status: editorReady ? "available" : "blocked",
      reason: editorReady ? null : "unity_editor_unavailable",
      package: "built-in",
    },
    {
      id: "unity-profile-analyzer",
      status: dependencies["com.unity.performance.profile-analyzer"] ? (editorReady ? "available" : "blocked") : "missing_package",
      reason: dependencies["com.unity.performance.profile-analyzer"] ? (editorReady ? null : "unity_editor_unavailable") : "package_not_pinned_in_manifest",
      package: dependencies["com.unity.performance.profile-analyzer"] ?? null,
    },
    {
      id: "unity-memory-profiler",
      status: dependencies["com.unity.memoryprofiler"] ? (editorReady ? "available" : "blocked") : "missing_package",
      reason: dependencies["com.unity.memoryprofiler"] ? (editorReady ? null : "unity_editor_unavailable") : "package_not_pinned_in_manifest",
      package: dependencies["com.unity.memoryprofiler"] ?? null,
    },
    {
      id: "unity-frame-debugger",
      status: editorReady ? "available" : "blocked",
      reason: editorReady ? null : "unity_editor_unavailable",
      package: "built-in",
    },
    {
      id: "unity-rendering-debugger",
      status: !hasUrp && !hasHdrp ? "not_configured" : editorReady ? "available" : "blocked",
      reason: !hasUrp && !hasHdrp ? "render_pipeline_not_selected" : editorReady ? null : "unity_editor_unavailable",
      package: hasUrp ? dependencies["com.unity.render-pipelines.universal"] : hasHdrp ? dependencies["com.unity.render-pipelines.high-definition"] : null,
    },
  ].map((tool) => ({
    ...tool,
    documentation: sourceById.get(tool.id === "unity-rendering-debugger" ? "unity-urp-rendering-debugger" : tool.id)?.url ?? null,
    capture_performed: false,
  }));
  return {
    manifest: relative(repoRoot, manifestPath).replace(/\\/gu, "/"),
    tools,
    external_gpu_tools: external,
    profile_capture_performed: false,
    limitation: "Availability inspection does not execute Unity or collect profiler data.",
  };
}

async function inspectUnrealProfilingToolkit(
  repoRoot: string,
  options: PhantomPlayKnowledgeOptions,
  index: KnowledgeIndex,
  project: ProjectProfile,
) {
  if (!project.project_path) throw new Error("unreal_project_path_missing");
  const projectRoot = resolveInside(repoRoot, project.project_path);
  const descriptors = (await readdir(projectRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".uproject"));
  if (descriptors.length !== 1) throw new Error("unreal_project_descriptor_missing_or_ambiguous");
  const descriptorPath = resolve(projectRoot, descriptors[0].name);
  const editorReady = options.unrealEditorReady === true;
  const sourceById = new Map(index.sources.map((source) => [source.id, source]));
  const tools = [
    { id: "unreal-insights", documentation_id: "unreal-insights", package: "built-in" },
    { id: "unreal-stat-commands", documentation_id: "unreal-performance-profiling", package: "built-in" },
    { id: "unreal-gpu-profiler", documentation_id: "unreal-performance-profiling", package: "built-in" },
    { id: "unreal-memory-insights", documentation_id: "unreal-insights", package: "built-in" },
  ].map((tool) => ({
    id: tool.id,
    status: editorReady ? "available" : "blocked",
    reason: editorReady ? null : "unreal_editor_unavailable",
    package: tool.package,
    documentation: sourceById.get(tool.documentation_id)?.url ?? null,
    capture_performed: false,
  }));
  const externalDefaults = {
    renderdoc: "C:\\Program Files\\RenderDoc\\qrenderdoc.exe",
    nvidia_nsight: "C:\\Program Files\\NVIDIA Corporation\\Nsight Graphics\\Nsight.Graphics.exe",
    amd_rgp: "C:\\Program Files\\RadeonDeveloperToolSuite\\RadeonGpuProfiler.exe",
  };
  const externalPaths = { ...externalDefaults, ...(options.externalToolPaths ?? {}) };
  const external = await Promise.all(Object.entries(externalPaths).map(async ([id, path]) => ({
    id,
    path,
    installed: await exists(path),
    executed: false,
  })));
  return {
    engine: "unreal",
    manifest: relative(repoRoot, descriptorPath).replace(/\\/gu, "/"),
    tools,
    external_gpu_tools: external,
    profile_capture_performed: false,
    limitation: "Availability inspection does not execute Unreal Editor, Unreal Insights, or an external GPU debugger.",
  };
}

async function inspectProfilingToolkit(
  repoRoot: string,
  options: PhantomPlayKnowledgeOptions,
  index: KnowledgeIndex,
  project: ProjectProfile,
) {
  if (project.engine_key === "unreal") return inspectUnrealProfilingToolkit(repoRoot, options, index, project);
  if (project.engine_key === "unity") return { engine: "unity", ...(await inspectUnityProfilingToolkit(repoRoot, options, index, project)) };
  return {
    engine: project.engine_key,
    manifest: project.project_path,
    tools: [],
    external_gpu_tools: [],
    profile_capture_performed: false,
    limitation: `No profiling availability adapter is configured for ${project.engine}.`,
  };
}

export function buildDependencySandbox(
  candidate: Pick<KnowledgeSource, "id" | "title" | "license" | "url">,
  engineKey = "generic",
) {
  const steps = [
    "inspect_license",
    "inspect_source",
    "inspect_package_manifest",
    "inspect_dependencies",
    "inspect_editor_scripts",
    "inspect_install_hooks",
    "inspect_network_behavior",
    `import_isolated_${safeId(engineKey, "generic")}_project`,
    "compile",
    "execute_relevant_demo",
    "profile",
    "determine_integration_value",
  ].map((step, index) => ({
    order: index + 1,
    step,
    status: step === "inspect_license" ? "evidence_available_not_reverified" : "pending",
  }));
  return {
    candidate: { id: candidate.id, title: candidate.title, source: candidate.url, declared_license: candidate.license },
    steps,
    completed_count: 0,
    production_integration_allowed: false,
    downloads_performed: false,
    code_executed: false,
  };
}

export async function searchPhantomPlayKnowledge(
  input: PhantomPlayKnowledgeSearchInput,
  options: PhantomPlayKnowledgeOptions = {},
) {
  const repoRoot = resolve(options.repoRoot || defaultRepoRoot);
  const projectId = ensureProjectId(input.projectId);
  const query = cleanText(input.query, 2000);
  if (query.length < 2) throw new Error("phantomplay_knowledge_query_required");
  const [index, project] = await Promise.all([
    loadKnowledgeIndex(repoRoot),
    loadProjectProfile(repoRoot, projectId),
  ]);
  const queryTokens = tokens(query);
  const category = cleanText(input.category, 100).toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 12));
  const ranked = index.sources
    .filter((source) => !input.kind || source.kind === input.kind)
    .filter((source) => !category || source.categories.some((candidate) => candidate.includes(category)))
    .map((source) => ({
      source,
      relevance: sourceRelevance(source, queryTokens)
        + (source.engines.includes(project.engine_key) || source.engines.includes("all") ? 0.75 : 0),
    }))
    .filter((item) => item.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance
      || trustPriority[right.source.trust_tier] - trustPriority[left.source.trust_tier]
      || left.source.title.localeCompare(right.source.title))
    .slice(0, limit)
    .map(({ source, relevance }) => serializeSource(source, relevance, project.engine_key));
  return {
    schema_version: index.schema_version,
    project_id: projectId,
    project_engine: project,
    query,
    filters: { kind: input.kind ?? null, category: category || null, limit },
    policy: index.policy,
    index: {
      path: knowledgeIndexPath,
      last_verified: index.last_verified,
      source_count: index.sources.length,
      sample_project_coverage: sampleCoverage(index.sources, project.engine_key),
    },
    results: ranked,
    live_refresh: {
      performed: false,
      network_accessed: false,
      reason: "curated_index_search_only",
    },
    side_effects: {
      downloads_performed: false,
      code_executed: false,
      production_dependencies_changed: false,
    },
  };
}

function paperSummary(source: KnowledgeSource, project: ProjectProfile) {
  return {
    paper: source.title,
    problem_solved: source.summary,
    method: source.practical_use,
    complexity: source.categories.includes("crowd-navigation") ? "Prototype and benchmark required; algorithmic and data-layout complexity is non-trivial." : "Experiment-specific.",
    practical_value: source.practical_use,
    engine_implementation_possibility: `Possible through a clean ${project.engine}-specific implementation after architecture and performance validation.`,
    license_code_availability: `${source.license}; ${source.code_availability}`,
    source: source.url,
  };
}

function buildArchitectureDecision(
  request: string,
  results: Awaited<ReturnType<typeof searchPhantomPlayKnowledge>>["results"],
  project: ProjectProfile,
) {
  const lower = request.toLowerCase();
  const isLargeNavigation = /(\b\d{3,}\b.*\b(unit|agent|troop)s?\b)|(rts.*navigation)|(large crowd)|(hundreds of units)/u.test(lower)
    && /(nav|path|move|crowd|unit|agent)/u.test(lower);
  if (isLargeNavigation) {
    const baseline = project.engine_key === "unreal"
      ? "Unreal Navigation System/NavMesh baseline"
      : project.engine_key === "unity"
        ? "Unity AI Navigation/NavMesh baseline"
        : `${project.engine} built-in navigation baseline`;
    const dataPath = project.engine_key === "unreal"
      ? "cache-friendly C++ data and Unreal task-graph jobs"
      : project.engine_key === "unity"
        ? "Jobs/Burst-compatible data"
        : "cache-friendly engine-native data";
    const scaleDecision = project.engine_key === "unreal"
      ? "before deciding whether Mass Entity or Mass AI is necessary"
      : project.engine_key === "unity"
        ? "before deciding whether ECS/DOTS is necessary"
        : "before selecting a specialized entity framework";
    const profiler = project.engine_key === "unreal"
      ? "Unreal Insights and the built-in stat/GPU profiling tools"
      : project.engine_key === "unity"
        ? "Unity Profiler and Profile Analyzer"
        : `${project.engine} profiling tools`;
    return {
      problem: "Large-formation RTS navigation with shared destinations, congestion, and local collision avoidance.",
      options_considered: [
        {
          option: baseline,
          value: "Fastest conventional baseline and useful for terrain reachability and obstacle comparisons.",
          risk: "Per-agent path queries and avoidance may not scale or produce formation behavior at the target count.",
        },
        {
          option: "Flow-field or dynamic-potential global navigation",
          value: "Many units can reuse destination-oriented navigation data.",
          risk: "Field updates, dynamic obstacles, multiple destinations, and memory layout require a careful prototype.",
        },
        {
          option: "Local avoidance such as ORCA-inspired steering",
          value: "Addresses near-agent and obstacle interactions around the global route.",
          risk: "Can oscillate or create congestion without formation and priority rules; implementation licensing must be reviewed separately.",
        },
        {
          option: project.engine_key === "unreal" ? "Unreal task graph with optional Mass Entity/Mass AI" : "Jobs/Burst and optional ECS/DOTS data layout",
          value: "Potentially improves throughput after behavior and data access are measurable.",
          risk: project.engine_key === "unreal"
            ? "Mass Entity and Mass AI are conditional, not automatic; migration cost is unjustified without profiling evidence."
            : "DOTS is conditional, not automatic; migration cost is unjustified without profiling evidence.",
        },
      ],
      decision: `Prototype a tiled flow-field global navigator with local avoidance and formation slots using ${dataPath}. Benchmark it against ${baseline} at 100, 250, 500, and 1000 units ${scaleDecision}.`,
      acceptance_metrics: [
        "Correct destination reachability around static and dynamic blockers.",
        "Stable formations without persistent deadlock or visible oscillation.",
        "CPU frame cost, GC allocations, field rebuild time, and memory recorded at 100/250/500/1000 units.",
        `Equivalent scenarios captured in ${profiler}.`,
      ],
      automatic_dependency_selection: false,
      evidence_source_ids: results.map((result) => result.id),
    };
  }
  return {
    problem: cleanText(request, 1200),
    options_considered: results.slice(0, 5).map((result) => ({
      option: result.title,
      value: result.practical_use,
      risk: result.caution,
    })),
    decision: results.length
      ? "Use the highest-trust relevant references to design a narrow prototype. Do not integrate external code until its dependency sandbox is complete and measured against the current PhantomPlay implementation."
      : "No indexed evidence is sufficient. Expand the curated research set before implementation rather than guessing.",
    acceptance_metrics: [
      `Compile in the isolated ${project.engine} project.`,
      "Exercise the intended gameplay path.",
      "Capture visual and performance evidence.",
      "Record licensing, dependency, and integration findings.",
    ],
    automatic_dependency_selection: false,
    evidence_source_ids: results.map((result) => result.id),
  };
}

export async function createPhantomPlayKnowledgeDecision(
  input: PhantomPlayKnowledgeDecisionInput,
  options: PhantomPlayKnowledgeOptions = {},
) {
  const repoRoot = resolve(options.repoRoot || defaultRepoRoot);
  const projectId = ensureProjectId(input.projectId);
  const request = cleanText(input.request, 5000);
  if (request.length < 2) throw new Error("phantomplay_knowledge_request_required");
  const index = await loadKnowledgeIndex(repoRoot);
  const project = await loadProjectProfile(repoRoot, projectId);
  const search = await searchPhantomPlayKnowledge({ projectId, query: request, limit: 20 }, { ...options, repoRoot });
  const profiling = await inspectProfilingToolkit(repoRoot, options, index, project);
  const research = search.results
    .filter((result) => result.kind === "research-paper")
    .map((result) => paperSummary(result, project));
  const externalCandidates = search.results.filter((result) => ["sample-project", "middleware", "asset-library"].includes(result.kind));
  return {
    schema_version: "1.0",
    created_at: options.now ?? new Date().toISOString(),
    project_id: projectId,
    project_engine: project,
    request,
    loop: [
      "understand",
      "search_existing_phantomplay_systems",
      "check_engine_documentation",
      "research_available_technology",
      "evaluate_open_source",
      "evaluate_middleware",
      "review_relevant_research",
      "choose_architecture",
      "implement",
      "profile",
      "play",
      "visually_inspect",
      "fix",
      "retest",
      "save_reusable_knowledge",
    ],
    search,
    architecture: buildArchitectureDecision(request, search.results, project),
    research,
    profiling,
    dependency_sandboxes: externalCandidates.slice(0, 5).map((candidate) => buildDependencySandbox(candidate, project.engine_key)),
    execution: {
      implementation_performed: false,
      profiling_performed: false,
      game_played: false,
      visual_inspection_performed: false,
      downloads_performed: false,
      external_code_executed: false,
      reason: "research_decision_only",
    },
  };
}

export async function runPhantomPlayKnowledgeDecision(
  input: PhantomPlayKnowledgeDecisionInput,
  options: PhantomPlayKnowledgeOptions = {},
) {
  const decision = await createPhantomPlayKnowledgeDecision(input, options);
  const artifactRoot = resolve(options.artifactRoot || DEFAULT_PHANTOMPLAY_KNOWLEDGE_ARTIFACT_ROOT);
  const ownerScope = safeId(options.ownerScope, "local");
  const projectId = ensureProjectId(input.projectId);
  const requestId = safeId(options.requestId || randomUUID(), "decision");
  const projectRoot = resolveInside(artifactRoot, `${ownerScope}/${projectId}`);
  await mkdir(projectRoot, { recursive: true });
  const timestamp = decision.created_at.replace(/[:.]/gu, "-");
  const relativePath = `${ownerScope}/${projectId}/${timestamp}-${requestId}.json`;
  const artifactPath = resolveInside(artifactRoot, relativePath);
  const receipt = {
    ...decision,
    receipt: {
      request_id: requestId,
      owner_scope: ownerScope,
      status: "knowledge_decision_written",
      artifact: relativePath,
    },
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const temporaryPath = `${artifactPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, "utf8");
  await rename(temporaryPath, artifactPath);
  return {
    ...receipt,
    artifact: {
      id: requestId,
      relative_path: relativePath,
      checksum_sha256: createHash("sha256").update(serialized).digest("hex"),
      size_bytes: Buffer.byteLength(serialized),
    },
  };
}

export async function getPhantomPlayKnowledgeIndexStatus(options: PhantomPlayKnowledgeOptions = {}) {
  const repoRoot = resolve(options.repoRoot || defaultRepoRoot);
  const index = await loadKnowledgeIndex(repoRoot);
  return {
    schema_version: index.schema_version,
    last_verified: index.last_verified,
    source_count: index.sources.length,
    kinds: Object.fromEntries([...new Set(index.sources.map((source) => source.kind))].sort().map((kind) => [kind, index.sources.filter((source) => source.kind === kind).length])),
    official_engine_sources: index.sources.filter((source) => source.trust_tier === "official_unreal" || source.trust_tier === "official_unity").length,
    official_unreal_sources: index.sources.filter((source) => source.trust_tier === "official_unreal").length,
    official_unity_sources: index.sources.filter((source) => source.trust_tier === "official_unity").length,
    profiling_source_ids: profilingSourceIds.filter((id) => index.sources.some((source) => source.id === id)),
    sample_project_coverage: sampleCoverage(index.sources),
    sample_project_coverage_by_engine: {
      unreal: sampleCoverage(index.sources, "unreal"),
      unity: sampleCoverage(index.sources, "unity"),
    },
    policy: index.policy,
    live_refresh: { configured: false, reason: "no_authenticated_github_or_research_provider_configured" },
  };
}
