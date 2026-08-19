import { currentTenantId, session } from "./store.js?v=phantom-live-20260817-162";

export const AI_PUBLIC_TO_BACKEND = Object.freeze({
  local: "local_ollama",
  private: "codex_cli",
  claude: "claude_cli",
  openrouter: "openrouter_glm",
  chatgpt: "chatgpt_bridge",
});

export const AI_BACKEND_TO_PUBLIC = Object.freeze(Object.fromEntries(
  Object.entries(AI_PUBLIC_TO_BACKEND).map(([publicId, backendId]) => [backendId, publicId]),
));

const BACKEND_DEFAULT_MODELS = Object.freeze({
  local_ollama: "local-auto",
  codex_cli: "gpt-5.5",
  claude_cli: "default",
  openrouter_glm: "openrouter/auto",
  chatgpt_bridge: "chatgpt-standard",
});

const runtimeState = {
  loaded: false,
  loading: false,
  saving: false,
  refreshing: false,
  error: null,
  source: "default",
  canManage: false,
  tenantId: "",
  config: null,
  providerManager: null,
  audit: [],
};

let pendingSave = Promise.resolve(null);
let pendingLoad = null;

function headers(json = false) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function modelFor(settings, publicId, backendId) {
  const selected = String(settings?.models?.[publicId] || "").trim();
  if (publicId === "private") {
    if (selected === "private-default") return "gpt-5.5";
    if (selected === "private-fast") return "gpt-5.5-instant";
    if (selected === "private-high") return "gpt-5.6-sol";
  }
  if (publicId === "claude") {
    if (selected === "claude-cli") return "default";
    if (selected === "claude-sonnet") return "sonnet";
    if (selected === "claude-opus") return "opus";
  }
  if (publicId === "openrouter" && selected === "openrouter-auto") return "openrouter/auto";
  return selected || BACKEND_DEFAULT_MODELS[backendId];
}

function selectedPublicProviders(settings) {
  const configured = Array.isArray(settings?.selectedProviders) && settings.selectedProviders.length
    ? settings.selectedProviders
    : [settings?.provider || "local"];
  const selected = [...new Set(configured.filter((id) => AI_PUBLIC_TO_BACKEND[id]))];
  if (settings?.providerMode === "smart") return Object.keys(AI_PUBLIC_TO_BACKEND);
  if (settings?.providerMode === "single") return [AI_PUBLIC_TO_BACKEND[settings?.provider] ? settings.provider : "local"];
  return selected.length ? selected : ["local"];
}

export function buildAiRuntimeConfig(settings = {}) {
  const publicProviders = selectedPublicProviders(settings);
  const primaryPublicId = publicProviders.includes(settings.provider) ? settings.provider : publicProviders[0];
  const primaryProviderId = AI_PUBLIC_TO_BACKEND[primaryPublicId] || "local_ollama";
  const models = Object.fromEntries(Object.entries(AI_PUBLIC_TO_BACKEND).map(([publicId, backendId]) => [
    backendId,
    modelFor(settings, publicId, backendId),
  ]));
  return {
    tenant_id: currentTenantId(),
    mode: ["single", "multiple", "smart"].includes(settings.providerMode) ? settings.providerMode : "smart",
    primary_provider_id: primaryProviderId,
    allowed_provider_ids: publicProviders.map((id) => AI_PUBLIC_TO_BACKEND[id]),
    models,
    fallback_enabled: settings.providerMode !== "single",
  };
}

export function buildAiRuntimeRequest(settings, surface) {
  const config = buildAiRuntimeConfig(settings);
  const primaryPublicId = AI_BACKEND_TO_PUBLIC[config.primary_provider_id] || "local";
  const laneByPublicId = {
    local: "local_ollama",
    private: "codex",
    claude: "claude_cli",
    openrouter: "glm_5_2",
    chatgpt: "chatgpt_bridge",
  };
  return {
    runtime_config: true,
    runtime_surface: String(surface || "unknown").slice(0, 80),
    provider: config.primary_provider_id === "openrouter_glm" ? "openrouter_glm" : "phantom",
    admin_model: laneByPublicId[primaryPublicId],
    model_lane: laneByPublicId[primaryPublicId],
    requested_model: config.models[config.primary_provider_id],
    allow_provider_fallback: config.fallback_enabled,
    allowed_providers: config.allowed_provider_ids,
  };
}

function applyPayload(payload) {
  runtimeState.loaded = true;
  runtimeState.loading = false;
  runtimeState.saving = false;
  runtimeState.refreshing = false;
  runtimeState.error = null;
  runtimeState.source = payload?.source || "default";
  runtimeState.canManage = Boolean(payload?.can_manage);
  runtimeState.tenantId = payload?.tenant_id || currentTenantId();
  runtimeState.config = payload?.config || null;
  runtimeState.providerManager = payload?.provider_manager || null;
  runtimeState.audit = Array.isArray(payload?.audit) ? payload.audit : runtimeState.audit;
  return payload;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload?.error === "string" ? payload.error : `AI brain request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function loadAiRuntimeConfig({ force = false } = {}) {
  const tenantId = currentTenantId();
  if (!force && runtimeState.loaded && runtimeState.tenantId === tenantId && !runtimeState.error) return Promise.resolve(runtimeState);
  if (runtimeState.loading && pendingLoad) return pendingLoad;
  runtimeState.loading = true;
  runtimeState.error = null;
  const operation = request(`/phantom-ai/runtime/config?tenant_id=${encodeURIComponent(tenantId)}`)
    .then(applyPayload)
    .catch((error) => {
      runtimeState.loaded = true;
      runtimeState.loading = false;
      runtimeState.error = error instanceof Error ? error.message : "AI brain settings could not be read.";
      throw error;
    });
  pendingLoad = operation;
  void operation.finally(() => {
    if (pendingLoad === operation) pendingLoad = null;
  }).catch(() => null);
  return operation;
}

export function persistAiRuntimeConfig(settings) {
  const config = buildAiRuntimeConfig(settings);
  runtimeState.saving = true;
  runtimeState.error = null;
  const save = async () => {
    const expectedVersion = runtimeState.tenantId === config.tenant_id && runtimeState.config?.version
      ? runtimeState.config.version
      : undefined;
    try {
      return applyPayload(await request("/phantom-ai/runtime/config", {
        method: "PUT",
        body: JSON.stringify({ ...config, ...(expectedVersion ? { expected_version: expectedVersion } : {}) }),
      }));
    } catch (error) {
      if (error?.status === 409) {
        await loadAiRuntimeConfig({ force: true });
        return applyPayload(await request("/phantom-ai/runtime/config", {
          method: "PUT",
          body: JSON.stringify({ ...config, expected_version: runtimeState.config?.version }),
        }));
      }
      runtimeState.saving = false;
      runtimeState.error = error instanceof Error ? error.message : "AI brain settings could not be saved.";
      throw error;
    }
  };
  pendingSave = pendingSave.catch(() => null).then(save);
  return pendingSave;
}

export async function waitForAiRuntimeSave() {
  try { await pendingSave; } catch { /* The request will surface the saved server state or provider error truthfully. */ }
}

export async function refreshAiRuntimeProviders() {
  runtimeState.refreshing = true;
  runtimeState.error = null;
  try {
    return applyPayload(await request("/phantom-ai/runtime/providers/refresh", {
      method: "POST",
      body: JSON.stringify({ tenant_id: currentTenantId() }),
    }));
  } catch (error) {
    runtimeState.refreshing = false;
    runtimeState.error = error instanceof Error ? error.message : "Provider health checks could not run.";
    throw error;
  }
}

export function getAiRuntimeState() {
  return {
    ...runtimeState,
    config: runtimeState.config ? { ...runtimeState.config, models: { ...runtimeState.config.models } } : null,
    providerManager: runtimeState.providerManager ? { ...runtimeState.providerManager, providers: [...(runtimeState.providerManager.providers || [])] } : null,
    audit: [...runtimeState.audit],
  };
}

export function settingsFromAiRuntimeConfig(settings, config) {
  if (!config) return settings;
  const publicProvider = AI_BACKEND_TO_PUBLIC[config.primary_provider_id] || settings.provider || "local";
  const selectedProviders = (config.allowed_provider_ids || []).map((id) => AI_BACKEND_TO_PUBLIC[id]).filter(Boolean);
  const models = { ...(settings.models || {}) };
  for (const [backendId, model] of Object.entries(config.models || {})) {
    const publicId = AI_BACKEND_TO_PUBLIC[backendId];
    if (publicId) models[publicId] = model;
  }
  return {
    ...settings,
    provider: publicProvider,
    providerMode: config.mode || settings.providerMode,
    selectedProviders: selectedProviders.length ? selectedProviders : [publicProvider],
    models,
  };
}
