import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getPhantomFlowStatus } from "./phantomflow.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, "../../..");
const productionConfigRoot = "docs/phantomplay-production";

export const DEFAULT_PHANTOMPLAY_PRODUCTION_ARTIFACT_ROOT = resolve(
  process.env.PHANTOMPLAY_PRODUCTION_DATA_DIR || resolve(defaultRepoRoot, ".local", "phantomplay-production"),
);

type JsonRecord = Record<string, unknown>;
type ProviderProbeKind = "filesystem" | "evidence_paths" | "unreal_editor" | "unity_editor" | "phantomflow";
type ProviderHealth = "ready" | "blocked" | "missing";
type ToolHealth = "ready" | "blocked" | "missing";

type ToolDefinition = {
  id: string;
  display_name: string;
  capabilities: string[];
  execution_mode: string;
  implementation_evidence: string[];
  required_providers: string[];
  supported_engines: string[];
  outputs: string[];
};

type ProviderDefinition = {
  id: string;
  display_name: string;
  probe: ProviderProbeKind;
  capabilities: string[];
  evidence_paths: string[];
};

type CreativeBible = {
  schema_version: string;
  project_id: string;
  title: string;
  engine: string;
  engine_key: string;
  project_path: string;
  games: string[];
  design_pillars: string[];
  visual_direction: string[];
  audio_direction: {
    primary_music_provider: string;
    engine_role: string;
    rule: string;
  };
  quality_gates: string[];
  performance_targets: Record<string, unknown>;
  source_records: string[];
};

type AssetDefinition = {
  id: string;
  kind: string;
  path: string;
  source: string;
  source_url: string;
  license: string;
  commercial_use: boolean;
  ownership: "internal" | "external";
  license_evidence: string[];
  license_token: string;
};

type DependencyLedgerRecord = {
  package_prefix: string;
  source: string;
  license: string;
  commercial_use: string;
  decision: string;
  evidence: string;
  note: string;
};

export type PhantomPlayProductionProbeOverrides = {
  phantomFlow?: () => Promise<{
    online: boolean;
    installed: boolean;
    state: string;
    engine?: string;
  }>;
  unityEditor?: () => Promise<{
    ready: boolean;
    executable?: string | null;
    version?: string | null;
    reason?: string | null;
  }>;
  unrealEditor?: () => Promise<{
    ready: boolean;
    executable?: string | null;
    version?: string | null;
    reason?: string | null;
  }>;
};

export type PhantomPlayProductionOptions = {
  repoRoot?: string;
  artifactRoot?: string;
  now?: string;
  ownerScope?: string;
  requestId?: string;
  probes?: PhantomPlayProductionProbeOverrides;
};

export type PhantomPlayProductionInput = {
  projectId: string;
  request: string;
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
  if (!path || isAbsolute(path)) throw new Error("unsafe_phantomplay_production_path");
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, path);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("unsafe_phantomplay_production_path");
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

async function readJson(path: string): Promise<JsonRecord> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`invalid_json_object:${path}`);
  return parsed as JsonRecord;
}

function stringList(value: unknown, maximum = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, 240))
    .filter(Boolean)
    .slice(0, maximum);
}

function requiredString(source: JsonRecord, key: string) {
  const value = cleanText(source[key], 300);
  if (!value) throw new Error(`missing_${key}`);
  return value;
}

function parseTool(raw: unknown): ToolDefinition {
  const source = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
  const tool: ToolDefinition = {
    id: requiredString(source, "id"),
    display_name: requiredString(source, "display_name"),
    capabilities: stringList(source.capabilities),
    execution_mode: requiredString(source, "execution_mode"),
    implementation_evidence: stringList(source.implementation_evidence),
    required_providers: stringList(source.required_providers),
    supported_engines: stringList(source.supported_engines),
    outputs: stringList(source.outputs),
  };
  if (!tool.capabilities.length) throw new Error(`tool_missing_capability:${tool.id}`);
  if (!tool.implementation_evidence.length) throw new Error(`tool_missing_evidence:${tool.id}`);
  return tool;
}

function parseProvider(raw: unknown): ProviderDefinition {
  const source = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
  const probe = requiredString(source, "probe") as ProviderProbeKind;
  if (!["filesystem", "evidence_paths", "unreal_editor", "unity_editor", "phantomflow"].includes(probe)) {
    throw new Error(`unsupported_provider_probe:${probe}`);
  }
  return {
    id: requiredString(source, "id"),
    display_name: requiredString(source, "display_name"),
    probe,
    capabilities: stringList(source.capabilities),
    evidence_paths: stringList(source.evidence_paths),
  };
}

async function loadToolDefinitions(repoRoot: string) {
  const source = await readJson(resolveInside(repoRoot, `${productionConfigRoot}/tool-registry.json`));
  const tools = Array.isArray(source.tools) ? source.tools.map(parseTool) : [];
  if (!tools.length) throw new Error("phantomplay_production_tool_registry_empty");
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) throw new Error("duplicate_phantomplay_tool_id");
  return { schema_version: cleanText(source.schema_version, 40), tools };
}

async function loadProviderDefinitions(repoRoot: string) {
  const source = await readJson(resolveInside(repoRoot, `${productionConfigRoot}/provider-registry.json`));
  const providers = Array.isArray(source.providers) ? source.providers.map(parseProvider) : [];
  if (!providers.length) throw new Error("phantomplay_production_provider_registry_empty");
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new Error("duplicate_phantomplay_provider_id");
  return { schema_version: cleanText(source.schema_version, 40), providers };
}

function parseCreativeBible(source: JsonRecord, projectId: string): CreativeBible {
  const audio = (source.audio_direction && typeof source.audio_direction === "object"
    ? source.audio_direction
    : {}) as JsonRecord;
  const engine = requiredString(source, "engine");
  const engineKey = cleanText(source.engine_key, 40)
    || (/unreal/iu.test(engine) ? "unreal" : /unity/iu.test(engine) ? "unity" : "native");
  const projectPath = cleanText(source.project_path, 300) || cleanText(source.unity_project_path, 300);
  const engineRole = cleanText(audio.engine_role, 300) || cleanText(audio.unity_role, 300);
  if (!projectPath) throw new Error("missing_project_path");
  if (!engineRole) throw new Error("missing_engine_role");
  const bible: CreativeBible = {
    schema_version: requiredString(source, "schema_version"),
    project_id: requiredString(source, "project_id"),
    title: requiredString(source, "title"),
    engine,
    engine_key: engineKey,
    project_path: projectPath,
    games: stringList(source.games),
    design_pillars: stringList(source.design_pillars),
    visual_direction: stringList(source.visual_direction),
    audio_direction: {
      primary_music_provider: requiredString(audio, "primary_music_provider"),
      engine_role: engineRole,
      rule: requiredString(audio, "rule"),
    },
    quality_gates: stringList(source.quality_gates),
    performance_targets: (source.performance_targets && typeof source.performance_targets === "object"
      ? source.performance_targets
      : {}) as Record<string, unknown>,
    source_records: stringList(source.source_records),
  };
  if (bible.project_id !== projectId) throw new Error("creative_bible_project_mismatch");
  if (!bible.design_pillars.length || !bible.quality_gates.length) throw new Error("creative_bible_incomplete");
  if (bible.audio_direction.primary_music_provider !== "phantomflow") throw new Error("primary_music_provider_must_be_phantomflow");
  return bible;
}

async function loadCreativeBible(repoRoot: string, projectId: string) {
  const path = resolveInside(repoRoot, `${productionConfigRoot}/creative-bibles/${projectId}.json`);
  return { path, bible: parseCreativeBible(await readJson(path), projectId) };
}

function parseAsset(raw: unknown): AssetDefinition {
  const source = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
  const ownership = requiredString(source, "ownership");
  if (ownership !== "internal" && ownership !== "external") throw new Error("invalid_asset_ownership");
  return {
    id: requiredString(source, "id"),
    kind: requiredString(source, "kind"),
    path: requiredString(source, "path"),
    source: requiredString(source, "source"),
    source_url: cleanText(source.source_url, 1000),
    license: requiredString(source, "license"),
    commercial_use: source.commercial_use === true,
    ownership,
    license_evidence: stringList(source.license_evidence),
    license_token: cleanText(source.license_token, 120),
  };
}

async function loadAssetDefinitions(repoRoot: string, projectId: string) {
  const path = resolveInside(repoRoot, `${productionConfigRoot}/asset-registries/${projectId}.json`);
  const source = await readJson(path);
  if (requiredString(source, "project_id") !== projectId) throw new Error("asset_registry_project_mismatch");
  const assets = Array.isArray(source.assets) ? source.assets.map(parseAsset) : [];
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error("duplicate_asset_id");
  return { path, assets };
}

async function loadDependencyLedger(repoRoot: string) {
  const path = resolveInside(repoRoot, `${productionConfigRoot}/dependency-ledger.json`);
  const source = await readJson(path);
  const records = (Array.isArray(source.records) ? source.records : []).map((raw): DependencyLedgerRecord => {
    const record = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
    return {
      package_prefix: requiredString(record, "package_prefix"),
      source: requiredString(record, "source"),
      license: requiredString(record, "license"),
      commercial_use: requiredString(record, "commercial_use"),
      decision: requiredString(record, "decision"),
      evidence: requiredString(record, "evidence"),
      note: requiredString(record, "note"),
    };
  });
  return { path, records };
}

async function discoverUnityEditor() {
  const candidates = new Set<string>();
  if (process.env.UNITY_EDITOR_PATH) candidates.add(resolve(process.env.UNITY_EDITOR_PATH));
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const hubRoot = resolve(programFiles, "Unity", "Hub", "Editor");
  try {
    const versions = await readdir(hubRoot, { withFileTypes: true });
    for (const version of versions) {
      if (version.isDirectory()) candidates.add(resolve(hubRoot, version.name, "Editor", "Unity.exe"));
    }
  } catch {}
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      const match = candidate.match(/[\\/]Editor[\\/]([^\\/]+)[\\/]Editor[\\/]Unity\.exe$/iu);
      return { ready: true, executable: candidate, version: match?.[1] ?? null, reason: null };
    }
  }
  return { ready: false, executable: null, version: null, reason: "unity_editor_not_installed" };
}

export async function discoverUnrealEditor(
  epicManifestRoot = resolve(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests"),
) {
  const candidates = new Map<string, string | null>();
  const addCandidate = (candidate: string, version: string | null = null) => {
    if (!candidates.has(candidate)) candidates.set(candidate, version);
  };
  for (const environmentPath of [process.env.PHANTOMPLAY_UNREAL_EDITOR, process.env.UNREAL_EDITOR_PATH]) {
    if (environmentPath) addCandidate(resolve(environmentPath));
  }
  if (process.env.UNREAL_ENGINE_ROOT) {
    const engineRoot = resolve(process.env.UNREAL_ENGINE_ROOT);
    addCandidate(engineRoot.toLowerCase().endsWith("unrealeditor.exe")
      ? engineRoot
      : resolve(engineRoot, "Engine", "Binaries", "Win64", "UnrealEditor.exe"));
  }
  try {
    const manifests = await readdir(epicManifestRoot, { withFileTypes: true });
    for (const manifest of manifests) {
      if (!manifest.isFile() || !manifest.name.toLowerCase().endsWith(".item")) continue;
      try {
        const record = JSON.parse(await readFile(resolve(epicManifestRoot, manifest.name), "utf8")) as JsonRecord;
        const installLocation = typeof record.InstallLocation === "string" ? record.InstallLocation : null;
        const launchExecutable = typeof record.LaunchExecutable === "string" ? record.LaunchExecutable : null;
        const appName = typeof record.AppName === "string" ? record.AppName : "";
        const categories = Array.isArray(record.AppCategories)
          ? record.AppCategories.filter((category): category is string => typeof category === "string")
          : [];
        const isUnrealEngine = /^UE_/iu.test(appName)
          || categories.some((category) => category.toLowerCase() === "engines/ue5")
          || Boolean(launchExecutable && /UnrealEditor\.exe$/iu.test(launchExecutable));
        if (!installLocation || !isUnrealEngine) continue;
        const executable = launchExecutable && /UnrealEditor\.exe$/iu.test(launchExecutable)
          ? resolve(installLocation, launchExecutable)
          : resolve(installLocation, "Engine", "Binaries", "Win64", "UnrealEditor.exe");
        const appVersion = typeof record.AppVersionString === "string"
          ? record.AppVersionString.match(/\d+\.\d+(?:\.\d+)?/u)?.[0] ?? null
          : null;
        addCandidate(executable, appVersion);
      } catch {}
    }
  } catch {}
  const epicRoot = resolve(process.env.ProgramFiles || "C:\\Program Files", "Epic Games");
  try {
    const installs = await readdir(epicRoot, { withFileTypes: true });
    for (const install of installs) {
      if (install.isDirectory() && /^UE_/u.test(install.name)) {
        addCandidate(resolve(epicRoot, install.name, "Engine", "Binaries", "Win64", "UnrealEditor.exe"));
      }
    }
  } catch {}
  for (const [candidate, declaredVersion] of candidates) {
    if (await exists(candidate)) {
      const match = candidate.match(/[\\/]UE_([^\\/]+)[\\/]/iu);
      return { ready: true, executable: candidate, version: declaredVersion ?? match?.[1] ?? null, reason: null };
    }
  }
  return { ready: false, executable: null, version: null, reason: "unreal_editor_not_installed" };
}

async function inspectProvider(
  provider: ProviderDefinition,
  repoRoot: string,
  probes: PhantomPlayProductionProbeOverrides,
) {
  const inspectedAt = new Date().toISOString();
  if (provider.probe === "filesystem") {
    const ready = await exists(repoRoot);
    return {
      id: provider.id,
      display_name: provider.display_name,
      health: (ready ? "ready" : "missing") as ProviderHealth,
      capabilities: provider.capabilities,
      evidence: ready ? ["repository_root_accessible"] : [],
      reason: ready ? null : "repository_root_missing",
      inspected_at: inspectedAt,
    };
  }

  if (provider.probe === "evidence_paths") {
    const checks = await Promise.all(provider.evidence_paths.map(async (path) => ({ path, exists: await exists(resolveInside(repoRoot, path)) })));
    const ready = checks.length > 0 && checks.every((check) => check.exists);
    return {
      id: provider.id,
      display_name: provider.display_name,
      health: (ready ? "ready" : "missing") as ProviderHealth,
      capabilities: provider.capabilities,
      evidence: checks,
      reason: ready ? null : "required_project_evidence_missing",
      inspected_at: inspectedAt,
    };
  }

  if (provider.probe === "unity_editor") {
    const result = probes.unityEditor ? await probes.unityEditor() : await discoverUnityEditor();
    return {
      id: provider.id,
      display_name: provider.display_name,
      health: (result.ready ? "ready" : "blocked") as ProviderHealth,
      capabilities: provider.capabilities,
      evidence: result.executable ? [{ executable: result.executable, version: result.version ?? null }] : [],
      reason: result.ready ? null : result.reason || "unity_editor_unavailable",
      inspected_at: inspectedAt,
    };
  }

  if (provider.probe === "unreal_editor") {
    const result = probes.unrealEditor ? await probes.unrealEditor() : await discoverUnrealEditor();
    return {
      id: provider.id,
      display_name: provider.display_name,
      health: (result.ready ? "ready" : "blocked") as ProviderHealth,
      capabilities: provider.capabilities,
      evidence: result.executable ? [{ executable: result.executable, version: result.version ?? null }] : [],
      reason: result.ready ? null : result.reason || "unreal_editor_unavailable",
      inspected_at: inspectedAt,
    };
  }

  const status = probes.phantomFlow ? await probes.phantomFlow() : await getPhantomFlowStatus();
  return {
    id: provider.id,
    display_name: provider.display_name,
    health: (status.online ? "ready" : status.installed ? "blocked" : "missing") as ProviderHealth,
    capabilities: provider.capabilities,
    evidence: [{ installed: status.installed, online: status.online, state: status.state, engine: status.engine ?? "PhantomFlow" }],
    reason: status.online ? null : status.installed ? "phantomflow_engine_offline" : "phantomflow_not_installed",
    inspected_at: inspectedAt,
  };
}

async function inspectTools(
  tools: ToolDefinition[],
  providers: Awaited<ReturnType<typeof inspectProvider>>[],
  repoRoot: string,
) {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return Promise.all(tools.map(async (tool) => {
    const evidence = await Promise.all(tool.implementation_evidence.map(async (path) => ({ path, exists: await exists(resolveInside(repoRoot, path)) })));
    const missingEvidence = evidence.filter((item) => !item.exists).map((item) => item.path);
    const blockedProviders = tool.required_providers
      .map((id) => providersById.get(id))
      .filter((provider) => !provider || provider.health !== "ready")
      .map((provider) => ({ id: provider?.id ?? "unknown", health: provider?.health ?? "missing", reason: provider?.reason ?? "provider_not_registered" }));
    const health: ToolHealth = missingEvidence.length ? "missing" : blockedProviders.length ? "blocked" : "ready";
    return {
      id: tool.id,
      display_name: tool.display_name,
      health,
      capabilities: tool.capabilities,
      execution_mode: tool.execution_mode,
      supported_engines: tool.supported_engines,
      outputs: tool.outputs,
      evidence,
      blocked_providers: blockedProviders,
      reason: missingEvidence.length ? "implementation_evidence_missing" : blockedProviders.length ? "required_provider_unavailable" : null,
    };
  }));
}

async function inventoryPath(path: string, fileLimit = 5000) {
  const targetStats = await stat(path);
  if (targetStats.isFile()) {
    const bytes = await readFile(path);
    return {
      file_count: 1,
      size_bytes: bytes.length,
      checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
      truncated: false,
    };
  }
  let fileCount = 0;
  let sizeBytes = 0;
  let truncated = false;
  const stack = [path];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() && !entry.name.endsWith(".meta")) {
        fileCount += 1;
        sizeBytes += (await stat(child)).size;
        if (fileCount >= fileLimit) {
          truncated = true;
          stack.length = 0;
          break;
        }
      }
    }
  }
  return { file_count: fileCount, size_bytes: sizeBytes, checksum_sha256: null, truncated };
}

async function auditAssets(repoRoot: string, bible: CreativeBible, definitions: AssetDefinition[]) {
  const projectRoot = resolveInside(repoRoot, bible.project_path);
  const seenPaths = new Map<string, string>();
  const duplicatePaths: Array<{ path: string; asset_ids: string[] }> = [];
  const assets = [];
  for (const definition of definitions) {
    const assetPath = resolveInside(projectRoot, definition.path);
    const normalizedPath = assetPath.toLowerCase();
    const prior = seenPaths.get(normalizedPath);
    if (prior) duplicatePaths.push({ path: definition.path, asset_ids: [prior, definition.id] });
    else seenPaths.set(normalizedPath, definition.id);
    const present = await exists(assetPath);
    const licenseChecks = await Promise.all(definition.license_evidence.map(async (licensePath) => {
      // License receipts are repository records and can belong to a migration
      // source outside the active engine project. Keep asset payloads scoped to
      // projectRoot, but resolve their evidence from the audited repository.
      const absolute = resolveInside(repoRoot, licensePath);
      if (!(await exists(absolute))) return { path: licensePath, exists: false, token_found: false };
      const text = await readFile(absolute, "utf8");
      return { path: licensePath, exists: true, token_found: !definition.license_token || text.includes(definition.license_token) };
    }));
    const licenseValid = definition.ownership === "internal"
      ? definition.license === "PhantomForce internal"
      : licenseChecks.length > 0 && licenseChecks.every((check) => check.exists && check.token_found);
    const inventory = present ? await inventoryPath(assetPath) : null;
    assets.push({
      id: definition.id,
      kind: definition.kind,
      path: definition.path,
      source: definition.source,
      source_url: definition.source_url,
      license: definition.license,
      commercial_use: definition.commercial_use,
      ownership: definition.ownership,
      present,
      license_valid: licenseValid,
      license_evidence: licenseChecks,
      inventory,
      decision: present && licenseValid && definition.commercial_use ? "accepted" : "blocked",
      blockers: [
        ...(present ? [] : ["asset_missing"]),
        ...(licenseValid ? [] : ["license_evidence_invalid"]),
        ...(definition.commercial_use ? [] : ["commercial_use_not_allowed"]),
      ],
    });
  }
  return {
    assets,
    accepted_count: assets.filter((asset) => asset.decision === "accepted").length,
    blocked_count: assets.filter((asset) => asset.decision === "blocked").length,
    duplicate_paths: duplicatePaths,
  };
}

async function auditUnityDependencies(repoRoot: string, bible: CreativeBible, ledger: DependencyLedgerRecord[]) {
  const unityRoot = resolveInside(repoRoot, bible.project_path);
  const manifestPath = resolveInside(unityRoot, "Packages/manifest.json");
  const manifest = await readJson(manifestPath);
  const dependencies = (manifest.dependencies && typeof manifest.dependencies === "object" ? manifest.dependencies : {}) as Record<string, unknown>;
  const packages = Object.entries(dependencies).map(([id, rawVersion]) => {
    const version = cleanText(rawVersion, 300);
    const record = ledger.find((item) => id.startsWith(item.package_prefix));
    const pinned = Boolean(version) && !/[\s*^~><]/u.test(version);
    const evidencePath = record ? resolveInside(unityRoot, record.evidence) : null;
    return {
      id,
      version,
      pinned,
      source: record?.source ?? "unknown",
      license: record?.license ?? "unverified",
      commercial_use: record?.commercial_use ?? "unverified",
      decision: record && pinned ? record.decision : "review_required",
      evidence: record ? { path: record.evidence, present: false } : null,
      note: record?.note ?? "No dependency-ledger match exists.",
      evidence_path: evidencePath,
    };
  });
  for (const item of packages) {
    if (item.evidence && item.evidence_path) item.evidence.present = await exists(item.evidence_path);
    delete (item as { evidence_path?: string | null }).evidence_path;
  }
  return {
    manifest: relative(repoRoot, manifestPath).replace(/\\/gu, "/"),
    packages,
    accepted_with_terms_count: packages.filter((item) => item.decision === "accepted_with_terms").length,
    review_required_count: packages.filter((item) => item.decision === "review_required").length,
    security_scan: "not_run_offline",
    security_limitations: [
      "No online vulnerability database was queried during this local audit.",
      "Official Unity package license text is not vendored; active Unity terms remain a release requirement."
    ],
  };
}

async function findFiles(root: string, suffix: string, fileLimit = 250) {
  const matches: string[] = [];
  const stack = [root];
  while (stack.length && matches.length < fileLimit) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() && entry.name.endsWith(suffix)) matches.push(child);
    }
  }
  return matches;
}

async function auditUnrealDependencies(repoRoot: string, bible: CreativeBible) {
  const projectRoot = resolveInside(repoRoot, bible.project_path);
  const descriptors = (await readdir(projectRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".uproject"));
  if (descriptors.length !== 1) throw new Error("unreal_project_descriptor_missing_or_ambiguous");
  const descriptorPath = resolve(projectRoot, descriptors[0].name);
  const descriptor = await readJson(descriptorPath);
  const engineAssociation = cleanText(descriptor.EngineAssociation, 80);
  const modules = Array.isArray(descriptor.Modules) ? descriptor.Modules : [];
  const plugins = Array.isArray(descriptor.Plugins) ? descriptor.Plugins : [];
  const buildFiles = await findFiles(resolveInside(projectRoot, "Source"), ".Build.cs");
  const buildModules = new Set<string>();
  for (const buildFile of buildFiles) {
    const source = await readFile(buildFile, "utf8");
    for (const match of source.matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/gu)) buildModules.add(match[1]);
  }
  const packages = [
    {
      id: "unreal-engine",
      version: engineAssociation || "unversioned",
      pinned: Boolean(engineAssociation),
      source: "Epic Games Unreal Engine",
      license: "Unreal Engine EULA",
      commercial_use: "subject_to_active_unreal_engine_terms",
      decision: engineAssociation ? "accepted_with_terms" : "review_required",
      evidence: { path: relative(projectRoot, descriptorPath).replace(/\\/gu, "/"), present: true },
      note: "Engine source and editor binaries are external to this repository.",
    },
    ...modules.map((raw) => {
      const module = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
      return {
        id: `module:${cleanText(module.Name, 120) || "unnamed"}`,
        version: engineAssociation || "engine-bundled",
        pinned: Boolean(engineAssociation),
        source: "PhantomForce Unreal project descriptor",
        license: "PhantomForce internal / Unreal Engine EULA",
        commercial_use: "subject_to_active_unreal_engine_terms",
        decision: engineAssociation ? "accepted_with_terms" : "review_required",
        evidence: { path: relative(projectRoot, descriptorPath).replace(/\\/gu, "/"), present: true },
        note: `Runtime module type: ${cleanText(module.Type, 80) || "unspecified"}.`,
      };
    }),
    ...plugins.map((raw) => {
      const plugin = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
      return {
        id: `plugin:${cleanText(plugin.Name, 120) || "unnamed"}`,
        version: engineAssociation || "engine-bundled",
        pinned: Boolean(engineAssociation),
        source: "Unreal Engine plugin",
        license: "Unreal Engine EULA / plugin-specific terms",
        commercial_use: "verify_plugin_terms_before_release",
        decision: engineAssociation ? "accepted_with_terms" : "review_required",
        evidence: { path: relative(projectRoot, descriptorPath).replace(/\\/gu, "/"), present: true },
        note: `Enabled: ${plugin.Enabled === true}.`,
      };
    }),
    ...[...buildModules].sort().map((module) => ({
      id: `engine-module:${module}`,
      version: engineAssociation || "engine-bundled",
      pinned: Boolean(engineAssociation),
      source: "Unreal Build Tool module dependency",
      license: "Unreal Engine EULA",
      commercial_use: "subject_to_active_unreal_engine_terms",
      decision: engineAssociation ? "accepted_with_terms" : "review_required",
      evidence: { path: buildFiles.map((path) => relative(projectRoot, path).replace(/\\/gu, "/")), present: true },
      note: "Declared in a checked-in ModuleRules file.",
    })),
  ];
  return {
    engine: "unreal",
    manifest: relative(repoRoot, descriptorPath).replace(/\\/gu, "/"),
    project_files: buildFiles.map((path) => relative(repoRoot, path).replace(/\\/gu, "/")),
    packages,
    accepted_with_terms_count: packages.filter((item) => item.decision === "accepted_with_terms").length,
    review_required_count: packages.filter((item) => item.decision === "review_required").length,
    security_scan: "not_run_offline",
    security_limitations: [
      "No online vulnerability database or Unreal Marketplace entitlement service was queried.",
      "Unreal Engine, bundled plugin, and third-party plugin terms must be rechecked before release.",
    ],
  };
}

async function auditDependencies(repoRoot: string, bible: CreativeBible, ledger: DependencyLedgerRecord[]) {
  if (bible.engine_key === "unity") return { engine: "unity", ...(await auditUnityDependencies(repoRoot, bible, ledger)) };
  if (bible.engine_key === "unreal") return auditUnrealDependencies(repoRoot, bible);
  return {
    engine: bible.engine_key,
    manifest: bible.project_path,
    packages: [],
    accepted_with_terms_count: 0,
    review_required_count: 1,
    security_scan: "not_run_offline",
    security_limitations: [`No dependency audit adapter is configured for ${bible.engine_key}.`],
  };
}

const capabilityOrder = [
  "creative_direction",
  "task_planning",
  "engine_architecture",
  "game_design",
  "procedural_world",
  "level_design",
  "gameplay_systems",
  "game_ai",
  "creature_factory",
  "animation",
  "shader_architecture",
  "material_generation",
  "vfx",
  "lighting",
  "combat_feel",
  "destruction",
  "phantomflow_music",
  "adaptive_music",
  "sfx",
  "creature_voice",
  "cinematics",
  "asset_registry",
  "dependency_audit",
  "visual_qa",
  "gameplay_qa",
  "performance",
  "validation",
  "build_engineering"
] as const;

type PlannedCapability = typeof capabilityOrder[number];

const capabilityDependencies: Partial<Record<PlannedCapability, PlannedCapability[]>> = {
  task_planning: ["creative_direction"],
  engine_architecture: ["creative_direction"],
  game_design: ["creative_direction"],
  procedural_world: ["engine_architecture", "game_design"],
  level_design: ["procedural_world", "game_design"],
  gameplay_systems: ["engine_architecture", "game_design"],
  game_ai: ["gameplay_systems"],
  creature_factory: ["creative_direction", "engine_architecture"],
  animation: ["creature_factory", "engine_architecture"],
  shader_architecture: ["creative_direction", "engine_architecture"],
  material_generation: ["shader_architecture"],
  vfx: ["shader_architecture", "gameplay_systems"],
  lighting: ["creative_direction", "engine_architecture"],
  combat_feel: ["gameplay_systems", "vfx"],
  destruction: ["gameplay_systems", "vfx"],
  phantomflow_music: ["creative_direction"],
  adaptive_music: ["phantomflow_music", "engine_architecture"],
  sfx: ["creative_direction", "gameplay_systems"],
  creature_voice: ["creature_factory"],
  cinematics: ["animation", "lighting", "vfx"],
  asset_registry: ["engine_architecture"],
  dependency_audit: ["engine_architecture"],
  visual_qa: ["lighting", "vfx"],
  gameplay_qa: ["gameplay_systems", "game_ai"],
  performance: ["gameplay_qa", "visual_qa"],
  build_engineering: ["validation"],
};

function requestedCapabilities(request: string) {
  const lower = request.toLowerCase();
  const selected = new Set<PlannedCapability>([
    "creative_direction",
    "task_planning",
    "engine_architecture",
    "asset_registry",
    "dependency_audit",
  ]);
  if (/design|progression|economy|upgrade|technology|faction|quest/u.test(lower)) selected.add("game_design");
  if (/world|map|terrain|river|forest|city|castle|village|dungeon/u.test(lower)) {
    selected.add("game_design");
    selected.add("procedural_world");
    selected.add("level_design");
  }
  if (/battle|combat|attack|weapon|siege|enemy|army|unit/u.test(lower)) {
    selected.add("game_design");
    selected.add("gameplay_systems");
    selected.add("game_ai");
    selected.add("vfx");
    selected.add("combat_feel");
    selected.add("sfx");
    selected.add("gameplay_qa");
  }
  if (/dragon|monster|creature|demon|beast/u.test(lower)) {
    selected.add("creature_factory");
    selected.add("animation");
    selected.add("shader_architecture");
    selected.add("material_generation");
    selected.add("creature_voice");
  }
  if (/night|lighting|weather|fog|atmosphere|cinematic/u.test(lower)) selected.add("lighting");
  if (/destroy|collapse|breakthrough|fracture|debris/u.test(lower)) selected.add("destruction");
  if (/music|score|theme|soundtrack|phantom age|boss/u.test(lower)) {
    selected.add("phantomflow_music");
    selected.add("adaptive_music");
  }
  if (/cinematic|cutscene|trailer|establishing shot/u.test(lower)) selected.add("cinematics");
  if (/shader|magic|corruption|phantom energy|hologram|portal/u.test(lower)) selected.add("shader_architecture");
  if (/visual|render|screenshot|lighting|vfx|shader/u.test(lower)) selected.add("visual_qa");
  if (/profile|performance|optimi|fps|frame time|draw call/u.test(lower)) selected.add("performance");
  if (/build|ship|release|windows player|package/u.test(lower)) selected.add("build_engineering");
  selected.add("validation");

  let changed = true;
  while (changed) {
    changed = false;
    for (const capability of [...selected]) {
      for (const dependency of capabilityDependencies[capability] ?? []) {
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }
  return capabilityOrder.filter((capability) => selected.has(capability));
}

function buildCreativeDirection(request: string, bible: CreativeBible) {
  const lower = request.toLowerCase();
  const requirements = [
    `Preserve the project identity: ${bible.design_pillars.join(" ")}`,
    `Integrate every output into the declared ${bible.engine} project before validation.`,
    "Keep failures and unavailable providers visible instead of substituting placeholders."
  ];
  if (/battle|combat|siege/u.test(lower)) requirements.push("Define combat pacing, tactical AI, readable attacks, impact feedback, and a playable victory/failure loop.");
  if (/night|fog|weather/u.test(lower)) requirements.push("Create intentional nighttime readability using motivated light, bounded fog, silhouettes, and exposure validation.");
  if (/dragon|creature/u.test(lower)) requirements.push("Treat the creature as a complete gameplay package: model, rig, animation, materials, shaders, VFX, sound, behavior, and reactions.");
  if (/destroy|breakthrough|collapse/u.test(lower)) requirements.push("Connect staged destruction, collision changes, debris limits, AI response, and persistent damage state to gameplay events.");
  const needsMusic = /music|score|theme|soundtrack|phantom age|boss|cinematic/u.test(lower);
  return {
    requirements,
    music_brief: needsMusic ? {
      provider: "phantomflow",
      game: bible.title,
      scene: cleanText(request, 800),
      emotion: /phantom age/u.test(lower) ? "awe, forbidden power, fear, and triumph" : "tension, scale, momentum, and consequence",
      bpm: /battle|siege/u.test(lower) ? 105 : 92,
      key: "D minor",
      instrumentation: "low strings, horns, low brass, frame drums, taiko, and choir where dramatically justified",
      structure: "restrained opening, escalating layers, gameplay-synchronized climax, and a resolved ending",
      loop_requirement: true,
      requested_stems: ["ambience", "percussion", "orchestra", "choir", "climax"],
      engine_key: bible.engine_key,
      engine_role: bible.audio_direction.engine_role,
      engine_generates_primary_music: false,
    } : null,
  };
}

function buildTaskPlan(
  request: string,
  tools: Awaited<ReturnType<typeof inspectTools>>,
  engineKey: string,
) {
  const capabilities = requestedCapabilities(request);
  const tasks = capabilities.map((capability, index) => {
    const tool = tools.find((candidate) => candidate.capabilities.includes(capability)
      && (candidate.supported_engines.includes(engineKey) || candidate.supported_engines.includes("all")));
    const dependencies = (capabilityDependencies[capability] ?? []).filter((dependency) => capabilities.includes(dependency));
    const blockers = tool
      ? tool.health === "ready"
        ? []
        : [{ code: tool.reason || "tool_unavailable", detail: tool.blocked_providers }]
      : [{ code: "capability_not_implemented", detail: capability }];
    return {
      id: `task-${String(index + 1).padStart(2, "0")}`,
      capability,
      tool_id: tool?.id ?? null,
      depends_on_capabilities: dependencies,
      status: blockers.length ? "blocked" : "ready",
      blockers,
    };
  });
  const taskIdByCapability = new Map(tasks.map((task) => [task.capability, task.id]));
  const materialized = tasks.map((task) => ({
    ...task,
    depends_on: task.depends_on_capabilities.map((capability) => taskIdByCapability.get(capability)).filter(Boolean),
  }));
  return {
    status: materialized.some((task) => task.status === "blocked") ? "blocked" : "ready",
    tasks: materialized,
    missing_capabilities: materialized.filter((task) => task.blockers.some((blocker) => blocker.code === "capability_not_implemented")).map((task) => task.capability),
    blocked_tool_ids: materialized.filter((task) => task.tool_id && task.status === "blocked").map((task) => task.tool_id),
    music_routing: capabilities.includes("phantomflow_music") ? {
      provider: "phantomflow",
      tool_id: "phantomflow.music-bridge",
      engine_key: engineKey,
      engine_generates_primary_music: false,
    } : null,
  };
}

function validateTaskGraph(plan: ReturnType<typeof buildTaskPlan>) {
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const unknownDependencies = plan.tasks.flatMap((task) => task.depends_on.filter((dependency) => !taskIds.has(String(dependency))));
  const positions = new Map(plan.tasks.map((task, index) => [task.id, index]));
  const forwardDependencies = plan.tasks.flatMap((task) => task.depends_on.filter((dependency) => (positions.get(String(dependency)) ?? -1) >= (positions.get(task.id) ?? 0)));
  return {
    graph_valid: unknownDependencies.length === 0 && forwardDependencies.length === 0,
    unknown_dependencies: unknownDependencies,
    forward_dependencies: forwardDependencies,
    ready_task_count: plan.tasks.filter((task) => task.status === "ready").length,
    blocked_task_count: plan.tasks.filter((task) => task.status === "blocked").length,
    completion_claimed: false,
  };
}

export async function inspectPhantomPlayProduction(
  input: PhantomPlayProductionInput,
  options: PhantomPlayProductionOptions = {},
) {
  const repoRoot = resolve(options.repoRoot || defaultRepoRoot);
  const projectId = ensureProjectId(input.projectId);
  const request = cleanText(input.request, 5000);
  if (request.length < 2) throw new Error("phantomplay_production_request_required");
  const inspectedAt = options.now ?? new Date().toISOString();
  const [toolRegistry, providerRegistry, creativeBibleRecord, assetRegistry, dependencyLedger] = await Promise.all([
    loadToolDefinitions(repoRoot),
    loadProviderDefinitions(repoRoot),
    loadCreativeBible(repoRoot, projectId),
    loadAssetDefinitions(repoRoot, projectId),
    loadDependencyLedger(repoRoot),
  ]);
  const providers = await Promise.all(providerRegistry.providers.map((provider) => inspectProvider(provider, repoRoot, options.probes ?? {})));
  const tools = await inspectTools(toolRegistry.tools, providers, repoRoot);
  const [assets, dependencies] = await Promise.all([
    auditAssets(repoRoot, creativeBibleRecord.bible, assetRegistry.assets),
    auditDependencies(repoRoot, creativeBibleRecord.bible, dependencyLedger.records),
  ]);
  const creativeDirection = buildCreativeDirection(request, creativeBibleRecord.bible);
  const plan = buildTaskPlan(request, tools, creativeBibleRecord.bible.engine_key);
  const graphValidation = validateTaskGraph(plan);
  const blockers = [
    ...plan.missing_capabilities.map((capability) => ({ code: "capability_not_implemented", capability })),
    ...plan.blocked_tool_ids.map((toolId) => ({ code: "tool_blocked", tool_id: toolId })),
    ...(assets.blocked_count ? [{ code: "asset_audit_blocked", count: assets.blocked_count }] : []),
    ...(dependencies.review_required_count ? [{ code: "dependency_review_required", count: dependencies.review_required_count }] : []),
    ...(graphValidation.graph_valid ? [] : [{ code: "task_graph_invalid" }]),
  ];
  return {
    schema_version: "1.0",
    inspected_at: inspectedAt,
    project: {
      id: projectId,
      title: creativeBibleRecord.bible.title,
      engine: creativeBibleRecord.bible.engine,
      engine_key: creativeBibleRecord.bible.engine_key,
      project_path: creativeBibleRecord.bible.project_path,
      games: creativeBibleRecord.bible.games,
      creative_bible: relative(repoRoot, creativeBibleRecord.path).replace(/\\/gu, "/"),
    },
    request,
    creative_direction: creativeDirection,
    registries: {
      tools: { schema_version: toolRegistry.schema_version, count: tools.length },
      providers: { schema_version: providerRegistry.schema_version, count: providers.length },
      assets: { count: assetRegistry.assets.length },
      dependencies: { count: dependencyLedger.records.length },
    },
    providers,
    tools,
    assets,
    dependencies,
    plan,
    validation: {
      ...graphValidation,
      blocker_count: blockers.length,
      blockers,
      audit_status: blockers.length ? "completed_with_blockers" : "completed",
      generated_assets_integrated: false,
      game_launched: false,
      gameplay_exercised: false,
      visual_inspection_completed: false,
      performance_profile_completed: false,
      build_produced: false,
    },
  };
}

export async function runPhantomPlayProductionAudit(
  input: PhantomPlayProductionInput,
  options: PhantomPlayProductionOptions = {},
) {
  const audit = await inspectPhantomPlayProduction(input, options);
  const artifactRoot = resolve(options.artifactRoot || DEFAULT_PHANTOMPLAY_PRODUCTION_ARTIFACT_ROOT);
  const ownerScope = safeId(options.ownerScope, "local");
  const projectId = ensureProjectId(input.projectId);
  const requestId = safeId(options.requestId || randomUUID(), "audit");
  const projectRoot = resolveInside(artifactRoot, `${ownerScope}/${projectId}`);
  await mkdir(projectRoot, { recursive: true });
  const timestamp = audit.inspected_at.replace(/[:.]/gu, "-");
  const fileName = `${timestamp}-${requestId}.json`;
  const artifactPath = resolveInside(projectRoot, fileName);
  const relativeArtifactPath = relative(artifactRoot, artifactPath).replace(/\\/gu, "/");
  const receipt = {
    ...audit,
    execution: {
      request_id: requestId,
      owner_scope: ownerScope,
      status: "audit_receipt_written",
      artifact: relativeArtifactPath,
      tools_executed: [
        "phantomplay.creative-director",
        "phantomplay.task-planner",
        "phantomplay.asset-registry",
        "phantomplay.dependency-auditor",
        "phantomplay.validation-engine"
      ],
      engine_tools_inspected: [...new Set(audit.plan.tasks
        .filter((task) => task.tool_id && task.capability === "engine_architecture")
        .map((task) => task.tool_id))],
      external_generation_performed: false,
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
      relative_path: relativeArtifactPath,
      checksum_sha256: createHash("sha256").update(serialized).digest("hex"),
      size_bytes: Buffer.byteLength(serialized),
    },
  };
}
