import { currentTenantId, session } from "./store.js?v=phantom-live-20260819-167";

export const AI_PUBLIC_TO_BACKEND = Object.freeze({
  deepseek: "deepseek_api",
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
  deepseek_api: "deepseek-v4-flash",
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
  providerCredentials: null,
  audit: [],
};

const providerModelCatalogs = {
  openrouter_glm: {
    loaded: false,
    loading: false,
    error: null,
    configured: false,
    dynamic: false,
    models: [],
  },
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

function modelFor(route, publicId, backendId) {
  const selected = String(route?.models?.[publicId] || "").trim();
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

function selectedPublicProviders(route) {
  const configured = Array.isArray(route?.selectedProviders) && route.selectedProviders.length
    ? route.selectedProviders
    : [route?.provider || "local"];
  const selected = [...new Set(configured.filter((id) => AI_PUBLIC_TO_BACKEND[id]))];
  if (route?.providerMode === "smart") return Object.keys(AI_PUBLIC_TO_BACKEND);
  if (route?.providerMode === "single") return [AI_PUBLIC_TO_BACKEND[route?.provider] ? route.provider : "local"];
  return selected.length ? selected : ["local"];
}

function buildRouteConfig(route = {}) {
  const publicProviders = selectedPublicProviders(route);
  const primaryPublicId = publicProviders.includes(route.provider) ? route.provider : publicProviders[0];
  const primaryProviderId = AI_PUBLIC_TO_BACKEND[primaryPublicId] || "local_ollama";
  const models = Object.fromEntries(Object.entries(AI_PUBLIC_TO_BACKEND).map(([publicId, backendId]) => [
    backendId,
    modelFor(route, publicId, backendId),
  ]));
  return {
    mode: ["single", "multiple", "smart"].includes(route.providerMode) ? route.providerMode : "smart",
    primary_provider_id: primaryProviderId,
    allowed_provider_ids: publicProviders.map((id) => AI_PUBLIC_TO_BACKEND[id]),
    models,
    fallback_enabled: route.providerMode !== "single",
  };
}

export function buildAiRuntimeConfig(settings = {}) {
  return {
    tenant_id: currentTenantId(),
    ...buildRouteConfig(settings),
    phantom_bot: buildRouteConfig(settings.phantomBot || settings),
  };
}

function routeForSurface(config, surface) {
  const normalized = String(surface || "").trim().toLowerCase();
  return normalized === "phantombot" || normalized.startsWith("phantombot:")
    ? config.phantom_bot
    : config;
}

export function buildAiRuntimeRequest(settings, surface) {
  const config = buildAiRuntimeConfig(settings);
  const route = routeForSurface(config, surface);
  const primaryPublicId = AI_BACKEND_TO_PUBLIC[route.primary_provider_id] || "local";
  const laneByPublicId = {
    deepseek: "deepseek_v4",
    local: "local_ollama",
    private: "codex",
    claude: "claude_cli",
    openrouter: "glm_5_2",
    chatgpt: "chatgpt_bridge",
  };
  return {
    runtime_config: true,
    runtime_surface: String(surface || "unknown").slice(0, 80),
    provider: route.primary_provider_id === "openrouter_glm" ? "openrouter_glm" : "phantom",
    admin_model: laneByPublicId[primaryPublicId],
    model_lane: laneByPublicId[primaryPublicId],
    requested_model: route.models[route.primary_provider_id],
    allow_provider_fallback: route.fallback_enabled,
    allowed_providers: route.allowed_provider_ids,
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
  runtimeState.providerCredentials = payload?.provider_credentials || runtimeState.providerCredentials;
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

export async function saveAiProviderCredential(providerId, apiKey) {
  const payload = await request("/phantom-ai/runtime/credentials", {
    method: "PUT",
    body: JSON.stringify({ tenant_id: currentTenantId(), provider_id: providerId, api_key: apiKey }),
  });
  await loadAiRuntimeConfig({ force: true });
  return payload;
}

export async function removeAiProviderCredential(providerId) {
  const payload = await request("/phantom-ai/runtime/credentials", {
    method: "DELETE",
    body: JSON.stringify({ tenant_id: currentTenantId(), provider_id: providerId }),
  });
  await loadAiRuntimeConfig({ force: true });
  return payload;
}

export function getAiProviderModelCatalog(providerId) {
  const state = providerModelCatalogs[providerId];
  return state
    ? { ...state, models: state.models.map((model) => ({ ...model, pricing: { ...(model.pricing || {}) } })) }
    : { loaded: false, loading: false, error: "This provider does not publish a model catalogue.", configured: false, dynamic: false, models: [] };
}

export async function loadAiProviderModels(providerId, { force = false } = {}) {
  const state = providerModelCatalogs[providerId];
  if (!state) throw new Error("This provider does not publish a model catalogue.");
  if (state.loading) return getAiProviderModelCatalog(providerId);
  if (!force && state.loaded && !state.error) return getAiProviderModelCatalog(providerId);
  state.loading = true;
  state.error = null;
  try {
    const payload = await request(`/phantom-ai/runtime/models?tenant_id=${encodeURIComponent(currentTenantId())}&provider_id=${encodeURIComponent(providerId)}`);
    state.loaded = true;
    state.loading = false;
    state.configured = Boolean(payload.configured);
    state.dynamic = Boolean(payload.dynamic);
    state.models = Array.isArray(payload.models) ? payload.models.filter((model) => model && typeof model.id === "string") : [];
    return getAiProviderModelCatalog(providerId);
  } catch (error) {
    state.loaded = true;
    state.loading = false;
    state.error = error instanceof Error ? error.message : "Provider models could not be loaded.";
    throw error;
  }
}

export function getAiRuntimeState() {
  return {
    ...runtimeState,
    config: runtimeState.config ? {
      ...runtimeState.config,
      models: { ...runtimeState.config.models },
      phantom_bot: runtimeState.config.phantom_bot ? {
        ...runtimeState.config.phantom_bot,
        models: { ...runtimeState.config.phantom_bot.models },
        allowed_provider_ids: [...(runtimeState.config.phantom_bot.allowed_provider_ids || [])],
      } : null,
    } : null,
    providerManager: runtimeState.providerManager ? { ...runtimeState.providerManager, providers: [...(runtimeState.providerManager.providers || [])] } : null,
    providerCredentials: runtimeState.providerCredentials ? { ...runtimeState.providerCredentials } : null,
    audit: [...runtimeState.audit],
  };
}

export function settingsFromAiRuntimeConfig(settings, config) {
  if (!config) return settings;
  const applyRoute = (current, route) => {
    const publicProvider = AI_BACKEND_TO_PUBLIC[route?.primary_provider_id] || current?.provider || "local";
    const selectedProviders = (route?.allowed_provider_ids || []).map((id) => AI_BACKEND_TO_PUBLIC[id]).filter(Boolean);
    const models = { ...(current?.models || {}) };
    for (const [backendId, model] of Object.entries(route?.models || {})) {
      const publicId = AI_BACKEND_TO_PUBLIC[backendId];
      if (publicId) models[publicId] = model;
    }
    return {
      ...current,
      provider: publicProvider,
      providerMode: route?.mode || current?.providerMode,
      selectedProviders: selectedProviders.length ? selectedProviders : [publicProvider],
      models,
    };
  };
  const platform = applyRoute(settings, config);
  return {
    ...platform,
    phantomBot: applyRoute(settings.phantomBot || settings, config.phantom_bot || config),
  };
}
