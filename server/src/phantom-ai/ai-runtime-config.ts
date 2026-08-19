import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AI_RUNTIME_PROVIDER_IDS = [
  "deepseek_api",
  "local_ollama",
  "codex_cli",
  "claude_cli",
  "openrouter_glm",
  "chatgpt_bridge",
] as const;

export type AiRuntimeProviderId = (typeof AI_RUNTIME_PROVIDER_IDS)[number];
export type AiRuntimeMode = "single" | "multiple" | "smart";

export type AiRuntimeRouteConfig = {
  mode: AiRuntimeMode;
  primary_provider_id: AiRuntimeProviderId;
  allowed_provider_ids: AiRuntimeProviderId[];
  models: Record<AiRuntimeProviderId, string>;
  fallback_enabled: boolean;
};

export type AiRuntimeConfig = AiRuntimeRouteConfig & {
  tenant_id: string;
  version: number;
  phantom_bot: AiRuntimeRouteConfig;
  updated_at: string;
  updated_by: string;
};

export type AiRuntimeAuditEntry = {
  id: string;
  tenant_id: string;
  actor: string;
  event_type: "created" | "updated";
  version: number;
  summary: string;
  created_at: string;
};

type AiRuntimeDocument = {
  current: AiRuntimeConfig;
  audit: AiRuntimeAuditEntry[];
};

export type AiRuntimeConfigInput = Partial<AiRuntimeRouteConfig> & {
  phantom_bot?: Partial<AiRuntimeRouteConfig>;
};

const DEFAULT_MODELS: Record<AiRuntimeProviderId, string> = {
  deepseek_api: "deepseek-v4-flash",
  local_ollama: "local-auto",
  codex_cli: "gpt-5.5",
  claude_cli: "default",
  openrouter_glm: "openrouter/auto",
  chatgpt_bridge: "chatgpt-standard",
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/ai-runtime");
const locks = new Map<string, Promise<unknown>>();

function safeTenantId(tenantId: string) {
  return tenantId.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function isProviderId(value: unknown): value is AiRuntimeProviderId {
  return typeof value === "string" && (AI_RUNTIME_PROVIDER_IDS as readonly string[]).includes(value);
}

function normalizeModel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  if (!model || model.length > 100 || !/^[\w./:@+~-]+$/.test(model)) return fallback;
  return model;
}

function normalizeProviderModel(providerId: AiRuntimeProviderId, value: unknown) {
  const model = normalizeModel(value, DEFAULT_MODELS[providerId]);
  if (providerId === "codex_cli") {
    if (model === "private-default") return "gpt-5.5";
    if (model === "private-fast") return "gpt-5.5-instant";
    if (model === "private-high") return "gpt-5.6-sol";
  }
  if (providerId === "claude_cli") {
    if (model === "claude-cli") return "default";
    if (model === "claude-sonnet") return "sonnet";
    if (model === "claude-opus") return "opus";
  }
  if (providerId === "openrouter_glm" && model === "openrouter-auto") return "openrouter/auto";
  return model;
}

export function defaultAiRuntimeConfig(tenantId: string, actor = "system"): AiRuntimeConfig {
  const platformRoute: AiRuntimeRouteConfig = {
    mode: "smart",
    primary_provider_id: "deepseek_api",
    allowed_provider_ids: [...AI_RUNTIME_PROVIDER_IDS],
    models: { ...DEFAULT_MODELS },
    fallback_enabled: true,
  };
  return {
    tenant_id: safeTenantId(tenantId),
    version: 1,
    ...platformRoute,
    phantom_bot: {
      mode: "smart",
      primary_provider_id: "local_ollama",
      allowed_provider_ids: ["local_ollama", "chatgpt_bridge"],
      models: { ...DEFAULT_MODELS },
      fallback_enabled: true,
    },
    updated_at: new Date().toISOString(),
    updated_by: actor.slice(0, 120) || "system",
  };
}

function normalizeRoute(
  input: Partial<AiRuntimeRouteConfig> | undefined,
  base: AiRuntimeRouteConfig,
): AiRuntimeRouteConfig {
  const mode: AiRuntimeMode = input?.mode === "single" || input?.mode === "multiple" || input?.mode === "smart"
    ? input.mode
    : base.mode;
  const primaryProviderId = isProviderId(input?.primary_provider_id)
    ? input.primary_provider_id
    : base.primary_provider_id;
  const requestedAllowed = Array.isArray(input?.allowed_provider_ids)
    ? Array.from(new Set(input.allowed_provider_ids.filter(isProviderId)))
    : base.allowed_provider_ids.filter(isProviderId);
  let allowedProviderIds = requestedAllowed.length ? requestedAllowed : [primaryProviderId];
  if (!allowedProviderIds.includes(primaryProviderId)) allowedProviderIds = [primaryProviderId, ...allowedProviderIds];
  if (mode === "single") allowedProviderIds = [primaryProviderId];
  const models = Object.fromEntries(AI_RUNTIME_PROVIDER_IDS.map((providerId) => [
    providerId,
    normalizeProviderModel(providerId, input?.models?.[providerId] ?? base.models?.[providerId]),
  ])) as Record<AiRuntimeProviderId, string>;
  return {
    mode,
    primary_provider_id: primaryProviderId,
    allowed_provider_ids: allowedProviderIds,
    models,
    fallback_enabled: mode !== "single" && input?.fallback_enabled !== false,
  };
}

export function normalizeAiRuntimeConfig(
  tenantId: string,
  actor: string,
  input: AiRuntimeConfigInput = {},
  previous?: AiRuntimeConfig,
): AiRuntimeConfig {
  const base = previous ?? defaultAiRuntimeConfig(tenantId, actor);
  const platformRoute = normalizeRoute(input, base);
  const defaultPhantomBot = defaultAiRuntimeConfig(tenantId, actor).phantom_bot;
  const basePhantomBot = base.phantom_bot
    ? normalizeRoute(base.phantom_bot, defaultPhantomBot)
    : defaultPhantomBot;
  return {
    tenant_id: safeTenantId(tenantId),
    version: previous ? previous.version + 1 : base.version,
    ...platformRoute,
    phantom_bot: normalizeRoute(input.phantom_bot, basePhantomBot),
    updated_at: new Date().toISOString(),
    updated_by: actor.slice(0, 120) || "system",
  };
}

export function aiRuntimeRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_AI_RUNTIME_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(aiRuntimeRoot(root), `${safeTenantId(tenantId)}.json`);
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  const key = safeTenantId(tenantId);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

export async function readAiRuntimeDocument(tenantId: string, root?: string): Promise<AiRuntimeDocument | null> {
  try {
    const parsed = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as AiRuntimeDocument;
    if (!parsed?.current || parsed.current.tenant_id !== safeTenantId(tenantId)) return null;
    const hydrated = normalizeAiRuntimeConfig(
      tenantId,
      parsed.current.updated_by || "system",
      parsed.current as AiRuntimeConfigInput,
    );
    return {
      ...parsed,
      current: {
        ...hydrated,
        version: parsed.current.version,
        updated_at: parsed.current.updated_at,
        updated_by: parsed.current.updated_by,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function getAiRuntimeConfig(tenantId: string, actor = "system", root?: string) {
  const document = await readAiRuntimeDocument(tenantId, root);
  return {
    config: document?.current ?? defaultAiRuntimeConfig(tenantId, actor),
    audit: document?.audit ?? [],
    source: document ? "saved" as const : "default" as const,
  };
}

export async function saveAiRuntimeConfig(options: {
  tenantId: string;
  actor: string;
  input: AiRuntimeConfigInput;
  expectedVersion?: number;
  root?: string;
}) {
  return withTenantLock(options.tenantId, async () => {
    const existing = await readAiRuntimeDocument(options.tenantId, options.root);
    if (existing && options.expectedVersion !== undefined && existing.current.version !== options.expectedVersion) {
      throw Object.assign(new Error(`AI runtime configuration changed from version ${options.expectedVersion} to ${existing.current.version}. Refresh and try again.`), {
        statusCode: 409,
        code: "AI_RUNTIME_VERSION_CONFLICT",
      });
    }
    const current = normalizeAiRuntimeConfig(options.tenantId, options.actor, options.input, existing?.current);
    const auditEntry: AiRuntimeAuditEntry = {
      id: randomUUID(),
      tenant_id: current.tenant_id,
      actor: options.actor.slice(0, 120) || "system",
      event_type: existing ? "updated" : "created",
      version: current.version,
      summary: `Platform ${current.mode}/${current.primary_provider_id}; PhantomBot ${current.phantom_bot.mode}/${current.phantom_bot.primary_provider_id}.`,
      created_at: current.updated_at,
    };
    const document: AiRuntimeDocument = {
      current,
      audit: [...(existing?.audit ?? []), auditEntry].slice(-200),
    };
    const path = documentPath(options.tenantId, options.root);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
    return { config: current, audit_entry: auditEntry, path, source: "saved" as const };
  });
}

export function aiRuntimeRouteForSurface(config: AiRuntimeConfig, surface: unknown): AiRuntimeRouteConfig {
  const normalized = typeof surface === "string" ? surface.trim().toLowerCase() : "";
  return normalized === "phantombot" || normalized.startsWith("phantombot:")
    ? config.phantom_bot
    : config;
}

export function aiRuntimeProviderModel(route: AiRuntimeRouteConfig, providerId = route.primary_provider_id) {
  return route.models[providerId] || DEFAULT_MODELS[providerId];
}
