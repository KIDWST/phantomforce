/* PhantomForce admin settings. Payment credential entry always stays in the
   Stripe-hosted Checkout/Portal; this app only requests a server-created URL. */

import { renderConnectionCenter } from "./connection-center.js?v=phantom-live-20260820-186";
import { renderCustomizationStudio } from "./customization.js?v=phantom-live-20260820-186";
import { renderClientSetupConsole } from "./clientsetup.js?v=phantom-live-20260820-186";
import { renderOrganizationPanel } from "./organization.js?v=phantom-live-20260820-186";
import { canManageActiveOrg, createStripeBillingPortal, createStripeCheckout, fetchCustomerPlanPreview, fetchEntitlementsSummary, fetchStripeBillingSummary, switchCustomerPlan } from "./orgs.js?v=phantom-live-20260820-186";
import { currentTenantId, ctx, isLiveAdminHost, isLocalDevHost, loadPhantomLoop, savePhantomLoop, LOOP_PROVIDERS, modelDisplayLabel, session, workspaceStorageGetItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260820-186";
import { DEFAULT_COMPANION_PREFS, clearCompanionPagePlacements, clearCompanionSessionHide, loadCompanionPrefs, resetCompanionPrefs, saveCompanionPrefs } from "./companion-preferences.js?v=phantom-live-20260820-186";
import {
  AI_BACKEND_TO_PUBLIC,
  getAiRuntimeState,
  getAiProviderModelCatalog,
  loadAiRuntimeConfig,
  loadAiRuntimeUsage,
  loadAiProviderModels,
  persistAiRuntimeConfig,
  removeAiProviderCredential,
  refreshAiRuntimeProviders,
  saveAiProviderCredential,
  settingsFromAiRuntimeConfig,
} from "./ai-runtime.js?v=phantom-live-20260820-186";

const AI_SETTINGS_KEY = "pf.operator.settings.v1";
const SETTINGS_TAB_KEY = "pf.settings.tab.v1";
const PHANTOMBOT_BRIDGE_PROMPT_KEY = "pf.phantombot.bridgePrompt.v1";
const MEDIA_LAB_CONFIG_KEY = "pf.medialab.v1";
const DEFAULT_MEDIA_CREDITS = 480;

const SETTINGS_TABS = [
  { id: "model", label: "Gateway & brain", category: "AI Brain" },
  { id: "loop", label: "Loop routing", category: "AI Brain" },
  { id: "chat", label: "Chat behavior", category: "AI Brain" },
  { id: "clientsetup", label: "Workspace setup", category: "Workspace" },
  { id: "organization", label: "Organization", category: "Workspace" },
  { id: "plan", label: "Plan & access", category: "Workspace" },
  { id: "workspace", label: "Workspace Studio", category: "Workspace" },
  { id: "modules", label: "Workspace Modules", category: "Workspace" },
  { id: "companion", label: "Companion", category: "Workspace" },
  { id: "media", label: "Connections", category: "Connections" },
  { id: "bridge", label: "Bridges", category: "Connections" },
];

const SETTINGS_CATEGORIES = ["AI Brain", "Workspace", "Connections"];
const SETTINGS_CONTEXT = {
  clientsetup: { title: "Workspace setup", note: "Configure the organization before lead, content, approval, and reporting work starts." },
  organization: { title: "Organization & access", note: "Manage employees, roles, invitations, and module access for this workspace." },
  plan: { title: "Plan & access", note: "Review workspace entitlement state without mixing it into the client pipeline." },
  bridge: { title: "Bridges", note: "Manage subscription-backed AI and creative connections without exposing provider credentials." },
  media: { title: "Connectors", note: "See active brain routes and connected business accounts first, then add anything else your workspace needs." },
};

function loadSettingsTab() {
  try {
    const saved = localStorage.getItem(SETTINGS_TAB_KEY);
    return SETTINGS_TABS.some((tab) => tab.id === saved) ? saved : SETTINGS_TABS[0].id;
  } catch {
    return SETTINGS_TABS[0].id;
  }
}

function saveSettingsTab(id) {
  try { localStorage.setItem(SETTINGS_TAB_KEY, id); } catch {}
}

const KIMI_OLLAMA_MODEL = "kimi-k3-hf:latest";
const KIMI_OLLAMA_ALIASES = new Set(["kimi-k3-hf", KIMI_OLLAMA_MODEL]);

const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek V4 Flash",
    short: "DS",
    role: "Fast organization-wide reasoning, planning, and platform control",
    models: ["deepseek-v4-flash"],
    allowCustomModel: true,
    recommended: true,
  },
  {
    id: "claude",
    name: "Claude",
    short: "CL",
    role: "Writing, strategy, and careful review",
    models: ["default", "sonnet", "opus"],
    allowCustomModel: true,
  },
  {
    id: "private",
    name: "Codex",
    short: "CX",
    role: "Codex CLI for code, files, debugging, and implementation",
    models: ["gpt-5.5", "gpt-5.6-sol", "gpt-5.5-instant"],
    allowCustomModel: true,
  },
  {
    id: "chatgpt",
    name: "ChatGPT Bridge",
    short: "CG",
    role: "User-owned ChatGPT Plus bridge for fast thinking, answers, and Hermes handoff.",
    models: ["chatgpt-instant", "chatgpt-standard", "chatgpt-deep"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    short: "OR",
    role: "Cloud model routing and flexible fallbacks",
    models: ["openrouter/auto", "z-ai/glm-5.2", "openrouter/free"],
    allowCustomModel: true,
  },
  {
    id: "local",
    name: "Phantom V1",
    short: "PC",
    role: "Installed Ollama models on this machine",
    models: ["local-auto"],
    allowCustomModel: true,
  },
];

const CREDENTIAL_PROVIDERS = [
  {
    providerId: "deepseek_api",
    publicId: "deepseek",
    mark: "DS",
    title: "DeepSeek",
    placeholder: "DeepSeek API key",
    note: "Direct DeepSeek models and provider-reported credit balance.",
  },
  {
    providerId: "openrouter_glm",
    publicId: "openrouter",
    mark: "OR",
    title: "OpenRouter",
    placeholder: "OpenRouter API key",
    note: "OpenRouter model catalogue, spend, and limit reporting.",
  },
];

let localModelStatus = {
  loaded: false,
  loading: false,
  error: null,
  baseUrl: "http://127.0.0.1:11434",
  models: [],
};

let ghostModeStatus = {
  loaded: false,
  loading: false,
  enabled: false,
  detail: "",
};

let agentAssistBridgeStatus = {
  loaded: false,
  loading: false,
  error: null,
  status: null,
};
let higgsfieldBridgeStatus = {
  loaded: false,
  loading: false,
  error: null,
  status: null,
};
let chatGptAccountMessage = "";
let bridgeBuilderMessage = "";

async function openChatGptAccountPage(action = "switch") {
  const url = action === "logout" ? "https://chatgpt.com/auth/logout" : "https://chatgpt.com/";
  try {
    if (window.PhantomBotDesktop?.openExternal) {
      const result = await window.PhantomBotDesktop.openExternal(url);
      if (result?.ok === false) throw new Error(result.error || "Could not open ChatGPT.");
    } else {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) throw new Error("Your browser blocked the ChatGPT window.");
    }
    chatGptAccountMessage = action === "logout"
      ? "ChatGPT sign-out opened. Return here, choose Switch / add account, then refresh the bridge."
      : "ChatGPT opened. Use its account menu to switch or add an account, then return and refresh the bridge.";
  } catch (error) {
    chatGptAccountMessage = error instanceof Error ? error.message : "Could not open ChatGPT account controls.";
  }
}

async function openExternalAccountPage(url, label) {
  try {
    if (window.PhantomBotDesktop?.openExternal) {
      const result = await window.PhantomBotDesktop.openExternal(url);
      if (result?.ok === false) throw new Error(result.error || `Could not open ${label}.`);
    } else {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) throw new Error(`Your browser blocked the ${label} window.`);
    }
    bridgeBuilderMessage = `${label} opened in a secure window.`;
  } catch (error) {
    bridgeBuilderMessage = error instanceof Error ? error.message : `Could not open ${label}.`;
  }
}

const KIMI_OLLAMA_MODEL_IS_OPT_IN = true;

const PROVIDER_MODES = [
  { id: "smart", name: "Phantom Hybrid", note: "Phantom routes across the allowed brain lanes and falls back when a lane is unavailable." },
  { id: "single", name: "Selected provider only", note: "Use only the provider you explicitly select." },
  { id: "multiple", name: "Multiple", note: "Choose the providers Phantom is allowed to use." },
];

function providerModels(provider) {
  if (provider.id === "openrouter") {
    const discovered = getAiProviderModelCatalog("openrouter_glm").models.map((model) => model.id).filter(Boolean);
    return [...new Set([...provider.models, ...discovered])];
  }
  if (provider.id !== "local") return provider.models;
  const installed = localModelStatus.models
    .map((model) => model.model || model.name)
    .filter(Boolean);
  return [...new Set(["local-auto", ...installed])];
}

const DEFAULT_MODELS = {
  deepseek: "deepseek-v4-flash",
  claude: "default",
  private: "gpt-5.5",
  chatgpt: "chatgpt-standard",
  openrouter: "openrouter/auto",
  local: "local-auto",
};

const DEFAULT_SETTINGS = {
  provider: "deepseek",
  providerMode: "smart",
  selectedProviders: PROVIDERS.map((provider) => provider.id),
  brainMode: "subscription",
  models: { ...DEFAULT_MODELS },
  phantomBot: {
    provider: "local",
    providerMode: "smart",
    selectedProviders: ["local", "chatgpt"],
    models: { ...DEFAULT_MODELS },
  },
  responseStyle: "operator",
  responseLength: "balanced",
  memoryMode: "business",
  contextDepth: "standard",
  autopilotScope: "safe_repeat",
  externalActionMode: "approval",
  receipts: true,
};

const esc = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function renderSettingsCategories(activeTab) {
  return `
    <nav class="set-category-nav" aria-label="Settings categories">
      ${SETTINGS_CATEGORIES.map((category) => {
        const items = SETTINGS_TABS.filter((item) => item.category === category);
        const hasActiveItem = items.some((item) => item.id === activeTab);
        return `
          <details class="set-category" ${hasActiveItem ? "open" : ""}>
            <summary>
              <span>${esc(category)}</span>
              <span>${items.length}</span>
            </summary>
            <div class="set-category-options">
              ${items.map((item) => `
                <button type="button" class="${item.id === activeTab ? "is-active" : ""}" role="tab" aria-selected="${item.id === activeTab}" data-set-tab="${esc(item.id)}">
                  ${esc(item.label)}
                </button>
              `).join("")}
            </div>
          </details>
        `;
      }).join("")}
    </nav>
  `;
}

function providerFor(id) {
  return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[0];
}

function cleanLocalProviderMessage(value) {
  const text = String(value || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/urlopen|winerror\s*10061|actively refused|econnrefused|connection refused|connectex|failed to fetch|fetch failed|target machine/i.test(text)) {
    return "Local brain is offline. Start Ollama/local model service, then re-read models.";
  }
  if (/aborterror|timed?\s*out|timeout|did not respond/i.test(text)) {
    return "Local brain did not answer in time. Re-read models after the local service settles.";
  }
  return text.slice(0, 160);
}

function normalizeRouteSettings(value, defaults) {
  const input = value && typeof value === "object" ? value : {};
  const migratedInputProvider = input.provider === "kimi" ? "local" : input.provider;
  const provider = PROVIDERS.some((item) => item.id === migratedInputProvider) ? migratedInputProvider : defaults.provider;
  const providerMode = PROVIDER_MODES.some((item) => item.id === input.providerMode) ? input.providerMode : defaults.providerMode;
  const models = { ...DEFAULT_MODELS, ...(defaults.models || {}), ...(input.models || {}) };
  if (input.provider === "kimi" || KIMI_OLLAMA_ALIASES.has(models.kimi)) models.local = KIMI_OLLAMA_MODEL;
  delete models.kimi;
  for (const option of PROVIDERS) {
    if (!providerModels(option).includes(models[option.id]) && !(option.allowCustomModel && typeof models[option.id] === "string" && models[option.id].trim())) {
      models[option.id] = option.models[0];
    }
  }
  const requestedProviders = Array.isArray(input.selectedProviders) ? input.selectedProviders.map((id) => id === "kimi" ? "local" : id) : defaults.selectedProviders;
  let selectedProviders = [...new Set(requestedProviders.filter((id) => PROVIDERS.some((providerOption) => providerOption.id === id)))];
  if (providerMode === "smart") selectedProviders = PROVIDERS.map((item) => item.id);
  if (providerMode === "single") selectedProviders = [provider];
  if (!selectedProviders.length) selectedProviders = [provider];
  if (providerMode === "multiple" && selectedProviders.length < 2) {
    selectedProviders.push(selectedProviders[0] === "claude" ? "private" : "claude");
  }
  const preferredProvider = selectedProviders.includes(provider) ? provider : selectedProviders[0];
  return {
    ...defaults,
    ...input,
    provider: preferredProvider,
    providerMode,
    selectedProviders,
    models,
  };
}

function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const platform = normalizeRouteSettings(input, DEFAULT_SETTINGS);
  const brainMode = ["local", "api", "subscription"].includes(input.brainMode) ? input.brainMode : DEFAULT_SETTINGS.brainMode;
  return {
    ...platform,
    brainMode,
    phantomBot: normalizeRouteSettings(input.phantomBot, DEFAULT_SETTINGS.phantomBot),
  };
}

function loadOperatorSettings() {
  try {
    return normalizeSettings(JSON.parse(workspaceStorageGetItem(AI_SETTINGS_KEY) || "{}"));
  } catch {
    return normalizeSettings({});
  }
}

function saveOperatorSettings(settings) {
  try { workspaceStorageSetItem(AI_SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))); } catch {}
}

export function getOperatorSettings() {
  return loadOperatorSettings();
}

export async function hydrateOperatorRuntimeSettings() {
  await loadAiRuntimeConfig();
  const runtime = getAiRuntimeState();
  if (runtime.source === "saved" && runtime.config) {
    saveOperatorSettings(settingsFromAiRuntimeConfig(loadOperatorSettings(), runtime.config));
  } else if (runtime.source === "default" && runtime.canManage) {
    // Persist even a first-run default so every prompt has one canonical,
    // organization-scoped runtime decision and an auditable execution receipt.
    await persistAiRuntimeConfig(loadOperatorSettings());
  }
  return getAiRuntimeState();
}

export function getOperatorInfrastructureStatus(surface = "platform") {
  const settings = loadOperatorSettings();
  const route = surface === "phantombot" ? settings.phantomBot : settings;
  const activeProvider = providerFor(route.provider);
  const activeModels = providerModels(activeProvider);
  const activeModel = route.models[activeProvider.id] || activeModels[0] || activeProvider.models[0] || "";
  const modelLabel = activeProvider.id === "local" ? localModelLabel(activeModel) : modelDisplayLabel(activeModel);
  const runtime = getAiRuntimeState();
  const allowedStates = (runtime.providerManager?.providers || []).filter((provider) => route.selectedProviders.includes(provider.display_id));
  const activeState = allowedStates.find((provider) => provider.display_id === route.provider);
  if (!activeProvider?.id || !activeModel) {
    return {
      label: "Choose model",
      detail: "Choose a model in Settings",
      tone: "error",
      configured: false,
    };
  }
  if (route.providerMode === "smart") {
    const online = allowedStates.filter((provider) => provider.status === "online");
    if (!online.length && allowedStates.length && allowedStates.every((provider) => provider.status === "offline")) {
      return {
        label: "AI brain unavailable",
        detail: "No enabled provider passed its health check",
        tone: "error",
        configured: false,
      };
    }
    return {
      label: online.length ? "Phantom Hybrid · Real" : "Phantom Hybrid · Checking",
      detail: online.length ? `${online.length} enabled provider${online.length === 1 ? "" : "s"} passed health checks` : "Provider health is not confirmed yet",
      tone: online.length ? "ok" : "warn",
      configured: Boolean(online.length),
    };
  }
  if (activeProvider.id === "local" && activeModel === "local-auto" && localModelStatus.loaded && !localModelStatus.models.length) {
    return {
      label: "Local needs model",
      detail: "Ollama reachable, no models found",
      tone: "error",
      configured: false,
    };
  }
  const activeTruth = activeState?.status === "online"
    ? "Real"
    : activeState?.truth_state === "configured"
      ? "Configured"
    : activeState?.status === "offline"
      ? "Unavailable"
      : "Checking";
  return {
    label: `${activeProvider.name} · ${activeTruth}`,
    detail: activeState?.status === "online"
      ? `Real · ${activeProvider.name} / ${modelLabel}`
      : activeState?.truth_state === "configured"
        ? `Configured · ${activeProvider.name} / ${modelLabel}`
        : activeState?.status === "offline"
          ? `Unavailable · ${activeState.detail || "Choose Connect or another provider"}`
          : `Checking · ${activeProvider.name} / ${modelLabel}`,
    tone: activeState?.status === "online" ? "ok" : activeState?.truth_state === "configured" ? "warn" : activeState?.status === "offline" || (activeProvider.id === "local" && localModelStatus.error) ? "error" : "warn",
    configured: activeState?.status === "online" || activeState?.truth_state === "configured",
  };
}

function optionList(options, selected) {
  return options.map((option) => `<option value="${esc(option.id || option)}" ${(option.id || option) === selected ? "selected" : ""}>${esc(option.label || option)}</option>`).join("");
}

const moduleAuthHeaders = (json = false) => {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
};

async function moduleApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...moduleAuthHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Workspace module request failed (${response.status}).`);
  return payload;
}

async function refreshAgentAssistBridge(el, opts, rerender = true) {
  if (agentAssistBridgeStatus.loading) return;
  agentAssistBridgeStatus = { ...agentAssistBridgeStatus, loading: true, error: null };
  try {
    const payload = await moduleApi("/phantom-ai/agent-assist/status");
    agentAssistBridgeStatus = {
      loaded: true,
      loading: false,
      error: null,
      status: payload?.status || null,
    };
  } catch (error) {
    agentAssistBridgeStatus = {
      ...agentAssistBridgeStatus,
      loaded: true,
      loading: false,
      error: error instanceof Error ? error.message : "Could not read ChatGPT bridge status.",
    };
  }
  if (rerender && el?.isConnected) renderOperatorSettings(el, opts);
}

async function refreshHiggsfieldBridge(el, opts, rerender = true) {
  if (higgsfieldBridgeStatus.loading) return;
  higgsfieldBridgeStatus = { ...higgsfieldBridgeStatus, loading: true, error: null };
  try {
    const payload = await moduleApi("/api/creative-engine/status");
    higgsfieldBridgeStatus = {
      loaded: true,
      loading: false,
      error: null,
      status: payload || null,
    };
  } catch (error) {
    higgsfieldBridgeStatus = {
      ...higgsfieldBridgeStatus,
      loaded: true,
      loading: false,
      error: error instanceof Error ? error.message : "Could not read the Higgsfield bridge status.",
    };
  }
  if (rerender && el?.isConnected) renderOperatorSettings(el, opts);
}

async function refreshBridgeStatuses(el, opts) {
  await Promise.all([
    refreshAgentAssistBridge(el, opts, false),
    refreshHiggsfieldBridge(el, opts, false),
  ]);
  if (el?.isConnected) renderOperatorSettings(el, opts);
}

export function getOperatorBrainMesh() {
  const settings = loadOperatorSettings();
  const overview = configuredConnectionOverview(settings);
  const chatGpt = agentAssistBridgeStatus.status || {};
  const higgsfield = higgsfieldBridgeStatus.status || {};
  const bridges = [
    {
      id: "bridge-chatgpt",
      name: "ChatGPT Plus Bridge",
      state: agentAssistBridgeStatus.loading
        ? "checking"
        : chatGpt.executable
          ? "connected"
          : agentAssistBridgeStatus.error
            ? "attention"
            : "setup",
      status: bridgeStatusLabel(chatGpt),
      detail: chatGpt.executable
        ? "Subscription reasoning lane is available to PhantomBot."
        : agentAssistBridgeStatus.error || "Connect an account to add subscription-backed reasoning.",
      settingsTab: "bridge",
    },
    {
      id: "bridge-higgsfield",
      name: "Higgsfield Bridge",
      state: higgsfieldBridgeStatus.loading
        ? "checking"
        : higgsfield.status === "connected"
          ? "connected"
          : higgsfieldBridgeStatus.error || higgsfield.status === "error"
            ? "attention"
            : "setup",
      status: higgsfieldStatusLabel(higgsfield),
      detail: higgsfield.status === "connected"
        ? higgsfield.message || "Creative production lane is available to Media Lab."
        : higgsfieldBridgeStatus.error || higgsfield.message || "Connect Higgsfield to add the creative production lane.",
      settingsTab: "bridge",
    },
  ];
  const nodes = [...overview.brainRoutes, ...bridges];
  const activeCount = nodes.filter((node) => node.state === "connected").length;
  const attentionCount = nodes.filter((node) => node.state === "attention").length;
  return {
    loaded: Boolean(agentAssistBridgeStatus.loaded && higgsfieldBridgeStatus.loaded),
    loading: Boolean(agentAssistBridgeStatus.loading || higgsfieldBridgeStatus.loading),
    activeCount,
    attentionCount,
    totalCount: nodes.length,
    routes: overview.brainRoutes,
    bridges,
    nodes,
  };
}

export async function hydrateOperatorBrainMesh() {
  const runtime = getAiRuntimeState();
  await Promise.all([
    !runtime.loaded && !runtime.loading
      ? hydrateOperatorRuntimeSettings().catch(() => null)
      : Promise.resolve(),
    refreshAgentAssistBridge(null, null, false),
    refreshHiggsfieldBridge(null, null, false),
  ]);
  return getOperatorBrainMesh();
}

function bridgeStatusLabel(status) {
  if (agentAssistBridgeStatus.loading) return "Checking";
  if (agentAssistBridgeStatus.error) return "Unavailable";
  if (status?.executable) return "Connected";
  return "Ready to connect";
}

function higgsfieldStatusLabel(status) {
  if (higgsfieldBridgeStatus.loading) return "Checking";
  if (higgsfieldBridgeStatus.error) return "Unavailable";
  if (status?.status === "connected") return "Connected";
  if (status?.status === "error") return "Needs attention";
  return "Ready to connect";
}

function runtimeProviderStatus(providerId) {
  const runtime = getAiRuntimeState();
  const provider = runtime.providerManager?.providers?.find((item) => item.display_id === providerId);
  if (!provider) return { state: runtime.loading ? "checking" : "unknown", label: runtime.loading ? "Checking" : "Not checked", detail: runtime.error || "Run a provider check to confirm availability." };
  if (provider.truth_state === "configured") return { state: "configured", label: "Configured", detail: provider.detail || "Credential is encrypted on the server; send a request to confirm it." };
  if (provider.truth_state === "degraded") return { state: "checking", label: "Degraded", detail: provider.detail || "The provider exists, but a real model response has not been confirmed." };
  if (provider.status === "online") return { state: "real", label: "Real", detail: provider.detail || "Health check passed." };
  if (provider.status === "offline") return { state: "unavailable", label: "Unavailable", detail: provider.detail || "Not authenticated or reachable." };
  return { state: "checking", label: "Checking", detail: provider.detail || "Health has not been confirmed yet." };
}

export function getOperatorBrainChoices() {
  const settings = loadOperatorSettings();
  const bot = settings.phantomBot;
  const activeProvider = providerFor(bot.provider);
  const explicitModel = bot.models[activeProvider.id] || providerModels(activeProvider)[0] || "";
  const current = bot.providerMode === "smart"
    ? { provider: "Phantom Hybrid", model: "Automatic routing", automatic: true }
    : bot.providerMode === "multiple"
      ? { provider: "Phantom Blend", model: `${bot.selectedProviders.length} providers`, automatic: false }
      : {
          provider: activeProvider.name,
          model: activeProvider.id === "local" ? localModelLabel(explicitModel) : modelDisplayLabel(explicitModel),
          automatic: false,
        };
  return {
    current,
    automatic: {
      selected: bot.providerMode === "smart",
      state: "checking",
      label: "PhantomBot Hybrid",
      detail: "PhantomBot uses its own model route and does not change the platform brain.",
    },
    providers: PROVIDERS.map((provider) => {
      const runtime = runtimeProviderStatus(provider.id);
      const selectedModel = bot.models[provider.id] || providerModels(provider)[0] || provider.models[0] || "";
      const models = [...new Set([selectedModel, ...providerModels(provider)].filter(Boolean))];
      return {
        id: provider.id,
        name: provider.name,
        short: provider.short,
        state: runtime.state,
        status: runtime.label,
        detail: runtime.detail,
        models: models.map((model) => ({
          id: model,
          label: provider.id === "local" ? localModelLabel(model) : modelDisplayLabel(model),
          selected: bot.providerMode === "single" && bot.provider === provider.id && selectedModel === model,
        })),
      };
    }),
  };
}

export async function setOperatorBrainChoice({ automatic = false, provider: providerId = "", model = "" } = {}) {
  const previous = loadOperatorSettings();
  let next;
  if (automatic) {
    next = normalizeSettings({
      ...previous,
      phantomBot: {
        ...previous.phantomBot,
        providerMode: "smart",
        selectedProviders: PROVIDERS.map((provider) => provider.id),
      },
    });
  } else {
    const provider = PROVIDERS.find((item) => item.id === providerId);
    const selectedModel = String(model || "").trim();
    const allowedModels = provider ? providerModels(provider) : [];
    if (!provider || !selectedModel || (!allowedModels.includes(selectedModel) && !provider.allowCustomModel)) {
      throw new Error("That model is not available in PhantomForce.");
    }
    next = normalizeSettings({
      ...previous,
      phantomBot: {
        ...previous.phantomBot,
        provider: provider.id,
        providerMode: "single",
        selectedProviders: [provider.id],
        models: { ...previous.phantomBot.models, [provider.id]: selectedModel },
      },
    });
  }
  saveOperatorSettings(next);
  try {
    await persistAiRuntimeConfig(next);
    return getOperatorBrainChoices();
  } catch (error) {
    saveOperatorSettings(previous);
    throw error;
  }
}

function renderProviderCards(route, routeId) {
  return PROVIDERS.map((provider) => {
    const runtime = runtimeProviderStatus(provider.id);
    return `
    <button class="set-model-card ${route.selectedProviders.includes(provider.id) ? "is-active" : ""} ${route.provider === provider.id ? "is-preferred" : ""} is-${runtime.state}" type="button" data-ai-route="${esc(routeId)}" data-ai-provider="${esc(provider.id)}" aria-pressed="${route.selectedProviders.includes(provider.id) ? "true" : "false"}">
      <span class="set-provider-mark">${esc(provider.short)}</span>
      <span class="set-provider-copy"><b>${esc(provider.name)} ${provider.recommended ? '<em class="set-recommended">Recommended</em>' : ""} <em class="set-runtime-state is-${runtime.state}">${esc(runtime.label)}</em></b><i>${esc(provider.id === "local" ? localProviderStatusText() : `${provider.role} · ${runtime.detail}`)}</i></span>
      <span class="set-provider-check">${route.selectedProviders.includes(provider.id) ? "✓" : "+"}</span>
    </button>`;
  }).join("");
}

function localProviderStatusText() {
  if (localModelStatus.loading) return "Checking Ollama on this machine...";
  if (localModelStatus.loaded && localModelStatus.models.length) {
    return `${localModelStatus.models.length} installed Ollama model${localModelStatus.models.length === 1 ? "" : "s"}`;
  }
  if (localModelStatus.loaded) return "No installed Ollama model passed the local check";
  if (localModelStatus.error) return cleanLocalProviderMessage(localModelStatus.error);
  return "Installed Ollama models on this machine";
}

function renderProviderModeCards(route, routeId) {
  return PROVIDER_MODES.map((mode) => `
    <button class="set-choice-card ${route.providerMode === mode.id ? "is-active" : ""}" type="button" data-ai-route="${esc(routeId)}" data-provider-mode="${mode.id}" aria-pressed="${route.providerMode === mode.id ? "true" : "false"}">
      <b>${esc(mode.name)}</b><i>${esc(mode.note)}</i>
    </button>`).join("");
}

function renderSelectedModelControls(route, routeId) {
  return route.selectedProviders.map((providerId) => {
    const provider = providerFor(providerId);
    const selectedModel = route.models[provider.id] || provider.models[0];
    const models = [...new Set([selectedModel, ...providerModels(provider)].filter(Boolean))];
    const control = `<select data-ai-route="${esc(routeId)}" data-ai-provider-model="${provider.id}" aria-label="${esc(provider.name)} model">
      ${models.map((model) => `<option value="${esc(model)}" ${model === selectedModel ? "selected" : ""}>${esc(providerModelLabel(provider.id, model))}</option>`).join("")}
    </select>`;
    return `<label class="set-control set-provider-model"><span>${esc(provider.name)} model</span>
      ${control}
      ${provider.id === "local" ? `<i>${esc(localProviderStatusText())}</i>` : provider.id === "openrouter" ? `<i>${esc(openRouterModelStatusText())}</i>` : ""}
    </label>`;
  }).join("");
}

function providerModelLabel(providerId, modelId) {
  if (providerId === "local") return localModelLabel(modelId);
  if (providerId === "openrouter") {
    const model = getAiProviderModelCatalog("openrouter_glm").models.find((item) => item.id === modelId);
    const context = Number(model?.context_length);
    return `${model?.name || modelDisplayLabel(modelId)}${Number.isFinite(context) && context > 0 ? ` · ${Math.round(context / 1000)}k context` : ""}`;
  }
  return modelDisplayLabel(modelId);
}

function openRouterModelStatusText() {
  const catalogue = getAiProviderModelCatalog("openrouter_glm");
  if (catalogue.loading) return "Reading the OpenRouter model catalogue...";
  if (catalogue.error) return catalogue.error;
  if (catalogue.loaded && catalogue.models.length) return `${catalogue.models.length} OpenRouter models available`;
  return "Load the live OpenRouter model catalogue";
}

function localModelLabel(modelId) {
  if (modelId === "local-auto") return localModelStatus.models.length ? "Auto - best installed Ollama model" : "Auto - read Ollama";
  if (KIMI_OLLAMA_ALIASES.has(modelId)) return "Kimi K3 (requires this exact model in Ollama)";
  const model = localModelStatus.models.find((item) => item.model === modelId || item.name === modelId);
  const suffix = [model?.parameter_size, model?.quantization_level].filter(Boolean).join(" ");
  return `${model?.display_name || modelId}${suffix ? ` (${suffix})` : ""}`;
}

async function refreshLocalModels(el, opts, rerender = true) {
  if (localModelStatus.loading) return;
  localModelStatus = { ...localModelStatus, loading: true, error: null };
  try {
    const payload = await moduleApi("/phantom-ai/local-models/status");
    const ollama = payload.ollama || {};
    localModelStatus = {
      loaded: true,
      loading: false,
      error: cleanLocalProviderMessage(ollama.error) || null,
      baseUrl: ollama.base_url || "http://127.0.0.1:11434",
      models: Array.isArray(ollama.installed_models) ? ollama.installed_models : [],
    };
  } catch (error) {
    localModelStatus = {
      ...localModelStatus,
      loaded: true,
      loading: false,
      error: cleanLocalProviderMessage(error instanceof Error ? error.message : "Could not read Ollama on this PC.") || "Could not read Ollama on this PC.",
      models: [],
    };
  }
  if (rerender && el?.isConnected) renderOperatorSettings(el, opts);
}

async function refreshGhostMode(el, opts, rerender = true) {
  if (ghostModeStatus.loading) return;
  ghostModeStatus = { ...ghostModeStatus, loading: true };
  try {
    const payload = await moduleApi("/api/ghost-mode/status");
    ghostModeStatus = { loaded: true, loading: false, enabled: Boolean(payload.enabled), detail: payload.detail || "" };
  } catch {
    ghostModeStatus = { ...ghostModeStatus, loaded: true, loading: false };
  }
  if (rerender && el?.isConnected) renderOperatorSettings(el, opts);
}

async function setGhostModeAndRender(el, opts, enabled) {
  ghostModeStatus = { ...ghostModeStatus, enabled, loading: true };
  renderOperatorSettings(el, opts);
  try {
    const payload = await moduleApi("/api/ghost-mode/set", { method: "POST", body: JSON.stringify({ enabled }) });
    ghostModeStatus = { loaded: true, loading: false, enabled: Boolean(payload.enabled), detail: payload.detail || "" };
  } catch {
    ghostModeStatus = { ...ghostModeStatus, loading: false };
  }
  if (el?.isConnected) renderOperatorSettings(el, opts);
}

function loopProviderName(id) {
  return LOOP_PROVIDERS.find((p) => p.id === id)?.name || id;
}

function renderSafetySummary(settings) {
  const loop = loadPhantomLoop();
  const externalLabel = {
    approval: "External actions ask first",
    blocked: "External actions blocked",
    owner_rules: "Use owner rules",
  }[settings.externalActionMode] || "External actions ask first";
  const routingLabel = settings.providerMode === "smart"
    ? "Hybrid"
    : settings.providerMode === "multiple"
      ? "Multiple providers"
      : settings.provider === "deepseek" || settings.provider === "openrouter"
        ? "Server API key"
        : settings.provider === "local"
          ? "Local"
          : settings.provider === "chatgpt"
            ? "Subscription bridge"
            : "Signed-in CLI";
  return `
    <div class="set-status-grid">
      <span><b>Loop</b><i>${loop.enabled ? esc(loopProviderName(loop.targetProvider)) : "Off"}</i></span>
      <span><b>Platform brain</b><i>${esc(routingLabel)} · ${esc(providerFor(settings.provider).name)}${settings.providerMode === "smart" ? " primary" : ""}</i></span>
      <span><b>PhantomBot</b><i>${esc(providerFor(settings.phantomBot.provider).name)}</i></span>
      <span><b>Autopilot</b><i>${settings.autopilotScope === "safe_repeat" ? "Safe repeat work only" : "Manual only"}</i></span>
      <span><b>Boundary</b><i>${esc(externalLabel)}</i></span>
    </div>`;
}

function saveMiniAndRender(el, opts, settings) {
  saveOperatorSettings(settings);
  void persistAiRuntimeConfig(settings)
    .then(() => { if (typeof opts.onChange === "function") opts.onChange(normalizeSettings(settings)); })
    .catch(() => { if (typeof opts.onChange === "function") opts.onChange(normalizeSettings(settings)); });
  renderOperatorMiniSettings(el, opts);
  /* confirmation lives in the panel so nothing can overwrite it */
  const saved = el.querySelector("[data-mini-saved]");
  if (saved) {
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 2400);
  }
}

export function renderOperatorMiniSettings(el, opts = {}) {
  if (!el) return;
  const settings = loadOperatorSettings();
  const bot = settings.phantomBot;
  const activeProvider = providerFor(bot.provider);
  const activeProviderModels = providerModels(activeProvider);
  const activeModel = bot.models[activeProvider.id] || activeProviderModels[0] || activeProvider.models[0];
  const loop = loadPhantomLoop();
  const brainLabel = bot.providerMode === "smart"
    ? "Phantom Hybrid"
    : bot.providerMode === "multiple"
      ? `${bot.selectedProviders.length} providers`
      : activeProvider.name;
  const loopModel = LOOP_PROVIDERS.find((p) => p.id === loop.targetProvider) || LOOP_PROVIDERS[0];

  el.innerHTML = `
    <div class="chat-mini-settings">
      <div class="chat-mini-heading">
        <b>Console settings</b>
        <span>Brain, loop, hands</span>
        <em class="chat-mini-saved" data-mini-saved hidden>Saved — applies to the next message</em>
      </div>
      <div class="chat-mini-summary">
        <span><b>Brain</b><i>${esc(brainLabel)} · ${bot.providerMode === "smart" ? "automatic fallback" : `${esc(activeProvider.name)} / ${esc(activeProvider.id === "local" ? localModelLabel(activeModel) : modelDisplayLabel(activeModel))}`}</i></span>
        <span><b>Loop</b><i>${loop.enabled ? esc(loopProviderName(loop.targetProvider)) : "Off"}</i></span>
        <span><b>Hands</b><i>${settings.externalActionMode === "owner_rules" ? "Autopilot rules" : settings.externalActionMode === "blocked" ? "Blocked" : "Approval gated"}</i></span>
      </div>
      <div class="chat-mini-fields">
        <label class="chat-mini-field"><span>AI routing</span>
          <select data-mini-provider>
            <option value="smart" ${bot.providerMode === "smart" ? "selected" : ""}>Phantom Hybrid</option>
            ${PROVIDERS.map((provider) => `<option value="${esc(provider.id)}" ${bot.providerMode === "single" && provider.id === bot.provider ? "selected" : ""}>${esc(provider.name)} only</option>`).join("")}
            <option value="multiple" ${bot.providerMode === "multiple" ? "selected" : ""}>Multiple providers</option>
          </select>
        </label>
        <label class="chat-mini-field chat-mini-wide"><span>Preferred model</span>
          <select data-mini-model ${bot.providerMode === "smart" ? "disabled" : ""}>${activeProviderModels.map((model) => `<option value="${esc(model)}" ${model === activeModel ? "selected" : ""}>${esc(activeProvider.id === "local" ? localModelLabel(model) : modelDisplayLabel(model))}</option>`).join("")}</select>
        </label>
      </div>
      <div class="chat-mini-loop">
        <label class="chat-mini-switch">
          <input type="checkbox" data-mini-loop-toggle ${loop.enabled ? "checked" : ""}/>
          <span><b>Phantom Loop</b><i>Route this reply through another model, then bring the answer back.</i></span>
        </label>
        ${loop.enabled ? `
        <div class="chat-mini-fields">
          <label class="chat-mini-field"><span>Loop through</span>
            <select data-mini-loop-provider>${LOOP_PROVIDERS.map((p) => `<option value="${esc(p.id)}" ${p.id === loop.targetProvider ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          </label>
          <label class="chat-mini-field"><span>Model</span>
            <select data-mini-loop-model>${loopModel.models.map((m) => `<option value="${esc(m)}" ${m === loop.targetModel ? "selected" : ""}>${esc(modelDisplayLabel(m))}</option>`).join("")}</select>
          </label>
          <label class="chat-mini-field"><span>Depth</span>
            <select data-mini-loop-depth>${optionList([
              { id: "one_pass", label: "1 pass" },
              { id: "two_pass", label: "2 passes" },
              { id: "auto", label: "Auto" },
            ], loop.depth)}</select>
          </label>
          <label class="chat-mini-field"><span>Approval</span>
            <select data-mini-loop-approval>${optionList([
              { id: "safe_auto", label: "Auto for safe reads" },
              { id: "ask_external", label: "Ask before external calls" },
              { id: "manual", label: "Manual every time" },
            ], loop.approvalMode)}</select>
          </label>
        </div>` : ""}
      </div>
      <div class="chat-mini-hands">
        <div class="chat-mini-subhead">
          <b>Hands / execution</b>
          <span>Termina and external work stay controlled.</span>
        </div>
        <div class="chat-mini-fields">
          <label class="chat-mini-field"><span>Action boundary</span>
            <select data-mini-ai-field="externalActionMode">${optionList([
              { id: "approval", label: "Approval before external actions" },
              { id: "blocked", label: "Block external actions" },
              { id: "owner_rules", label: "Approval or autopilot rules" },
            ], settings.externalActionMode)}</select>
          </label>
          <label class="chat-mini-field"><span>Autopilot scope</span>
            <select data-mini-ai-field="autopilotScope">${optionList([
              { id: "safe_repeat", label: "Safe repeat work only" },
              { id: "manual_only", label: "Manual until approved" },
            ], settings.autopilotScope)}</select>
          </label>
        </div>
      </div>
      <div class="chat-mini-actions">
        <button class="chat-mini-full" type="button" data-mini-full-settings>Advanced loop routing</button>
      </div>
    </div>`;

  const providerSelect = el.querySelector("[data-mini-provider]");
  if (providerSelect) providerSelect.onchange = () => {
    const value = providerSelect.value;
    if (value === "smart") {
      bot.providerMode = "smart";
      bot.selectedProviders = PROVIDERS.map((provider) => provider.id);
    } else if (value === "multiple") {
      bot.providerMode = "multiple";
      if (bot.selectedProviders.length < 2) bot.selectedProviders = [bot.provider, "local"].filter((id, index, list) => list.indexOf(id) === index);
    } else {
      bot.providerMode = "single";
      bot.provider = value;
      bot.selectedProviders = [value];
    }
    saveMiniAndRender(el, opts, settings);
  };

  const modelSelect = el.querySelector("[data-mini-model]");
  if (modelSelect) modelSelect.onchange = () => {
    bot.models[bot.provider] = modelSelect.value;
    saveMiniAndRender(el, opts, settings);
  };

  const saveLoop = (patch) => {
    savePhantomLoop({ ...loop, ...patch });
    renderOperatorMiniSettings(el, opts);
    if (typeof opts.onLoopChange === "function") opts.onLoopChange(loadPhantomLoop());
  };

  const loopToggle = el.querySelector("[data-mini-loop-toggle]");
  if (loopToggle) loopToggle.onchange = () => saveLoop({ enabled: loopToggle.checked });

  const loopProviderSelect = el.querySelector("[data-mini-loop-provider]");
  if (loopProviderSelect) loopProviderSelect.onchange = () => {
    const next = LOOP_PROVIDERS.find((p) => p.id === loopProviderSelect.value) || LOOP_PROVIDERS[0];
    saveLoop({ targetProvider: next.id, targetModel: next.models[0] });
  };

  const loopModelSelect = el.querySelector("[data-mini-loop-model]");
  if (loopModelSelect) loopModelSelect.onchange = () => saveLoop({ targetModel: loopModelSelect.value });

  const loopDepthSelect = el.querySelector("[data-mini-loop-depth]");
  if (loopDepthSelect) loopDepthSelect.onchange = () => saveLoop({ depth: loopDepthSelect.value });

  const loopApprovalSelect = el.querySelector("[data-mini-loop-approval]");
  if (loopApprovalSelect) loopApprovalSelect.onchange = () => saveLoop({ approvalMode: loopApprovalSelect.value });

  el.querySelectorAll("[data-mini-ai-field]").forEach((field) => {
    field.onchange = () => {
      settings[field.dataset.miniAiField] = field.value;
      saveMiniAndRender(el, opts, settings);
    };
  });

  const full = el.querySelector("[data-mini-full-settings]");
  if (full) full.onclick = () => {
    if (typeof opts.openSettings === "function") opts.openSettings();
  };

  if (bot.provider === "local" && bot.providerMode !== "smart" && !localModelStatus.loaded && !localModelStatus.loading) {
    refreshLocalModels(el, opts, false).then(() => {
      if (el?.isConnected) renderOperatorMiniSettings(el, opts);
    });
  }
}

const ROUTING_MODES = [
  { id: "phantom_to_external_to_phantom", label: "Phantom → external model → Phantom" },
  { id: "phantom_to_a_to_b_to_phantom", label: "Phantom → model A → model B → Phantom" },
  { id: "multi_model_compare", label: "Multi-model compare" },
  { id: "critic_refiner", label: "Critic / refiner loop" },
];

function renderLoopAdvancedSection() {
  const loop = loadPhantomLoop();
  const adv = loop.advanced;
  return `
    <div class="set-section">
      <div class="set-sec-head">
        <div>
          <h3>Phantom Loop — advanced routing</h3>
          <p class="set-note">Route a chat reply through another model, then bring the answer back to Phantom. This is chat-only — it never creates a task, build plan, or Site Studio action on its own.</p>
        </div>
        <label class="set-switch set-switch-large">
          <input type="checkbox" data-loop-toggle ${loop.enabled ? "checked" : ""}/><span></span>
        </label>
      </div>
      <div class="set-control-grid">
        <label class="set-control"><span>Default loop provider</span>
          <select data-loop-field="targetProvider">${optionList(LOOP_PROVIDERS.map((p) => ({ id: p.id, label: p.name })), loop.targetProvider)}</select>
        </label>
        <label class="set-control"><span>Routing mode</span>
          <select data-loop-adv-field="routingMode">${optionList(ROUTING_MODES, adv.routingMode)}</select>
        </label>
        <label class="set-control"><span>Max loop passes</span>
          <select data-loop-adv-field="maxPasses">${optionList([1, 2, 3, 4].map((n) => ({ id: String(n), label: `${n}` })), String(adv.maxPasses))}</select>
        </label>
        <label class="set-control"><span>Timeout</span>
          <select data-loop-adv-field="timeoutMs">${optionList([
            { id: "10000", label: "10 seconds" },
            { id: "20000", label: "20 seconds" },
            { id: "45000", label: "45 seconds" },
            { id: "90000", label: "90 seconds" },
          ], String(adv.timeoutMs))}</select>
        </label>
        <label class="set-control"><span>Max cost per loop</span>
          <select data-loop-cost>${optionList([
            { id: "", label: "No cap set" },
            { id: "0.25", label: "$0.25" },
            { id: "1", label: "$1.00" },
            { id: "5", label: "$5.00" },
          ], loop.maxCostPerResponse == null ? "" : String(loop.maxCostPerResponse))}</select>
        </label>
      </div>
      <p class="set-note" style="margin-top:10px">Allowed providers</p>
      <div class="set-check-grid">
        ${LOOP_PROVIDERS.map((p) => `<label class="set-inline set-inline-tight"><input type="checkbox" data-loop-allowed="${p.id}" ${adv.allowedProviders.includes(p.id) ? "checked" : ""}/> ${esc(p.name)}</label>`).join("")}
      </div>
      <label class="set-inline set-inline-tight"><input type="checkbox" data-loop-adv-toggle="sharePrivateContext" ${adv.sharePrivateContext ? "checked" : ""}/> Let external models see private business context</label>
      <label class="set-inline set-inline-tight"><input type="checkbox" data-loop-adv-toggle="allowToolCalls" ${adv.allowToolCalls ? "checked" : ""}/> Allow tool calls inside the loop</label>
      <label class="set-inline set-inline-tight"><input type="checkbox" data-loop-adv-toggle="proofLogging" ${adv.proofLogging ? "checked" : ""}/> Keep audit/proof logs for loop routing</label>
      <div class="set-rule-list">
        <span>External API calls, sends, publishes, and file/setting changes still always require approval</span>
        <span>Loop never bypasses the existing approval queue</span>
      </div>
    </div>`;
}

function renderGhostModeSection() {
  const on = ghostModeStatus.enabled;
  return `
    <div class="set-section">
      <div class="set-sec-head">
        <div>
          <h3>Ghost Mode</h3>
          <p class="set-note">${on
            ? "On: Ghost Mode keeps Phantom AI chat on the local model path for this PC. Cloud providers are never used, even as fallback."
            : "Off: Phantom Hybrid may use allowed cloud/operator lanes for better answer quality. Turn Ghost Mode on for a hard local-only boundary, at the cost of that quality."}</p>
        </div>
        <label class="set-switch set-switch-large">
          <input type="checkbox" data-ghost-mode-toggle ${on ? "checked" : ""} ${ghostModeStatus.loading ? "disabled" : ""}/><span></span>
        </label>
      </div>
    </div>`;
}

function renderAiRouteCard(routeId, route, title, note) {
  const mode = PROVIDER_MODES.find((item) => item.id === route.providerMode) || PROVIDER_MODES[0];
  return `
    <section class="set-route-card" data-route-card="${esc(routeId)}">
      <header class="set-route-head">
        <div><p class="set-eyebrow">${routeId === "platform" ? "Primary route" : "Independent chat route"}</p><h4>${esc(title)}</h4><p>${esc(note)}</p></div>
        <span class="set-route-current">${esc(providerFor(route.provider).name)}</span>
      </header>
      <div class="set-choice-grid">${renderProviderModeCards(route, routeId)}</div>
      <div class="set-selection-summary">
        <span><b>${esc(mode.name)}</b><i>${esc(mode.note)}</i></span>
        <em>${route.selectedProviders.length} provider${route.selectedProviders.length === 1 ? "" : "s"} enabled</em>
      </div>
      <div class="set-model-grid">${renderProviderCards(route, routeId)}</div>
      ${route.providerMode === "multiple" ? `
        <label class="set-control set-preferred-provider"><span>Try first</span>
          <select data-ai-route="${esc(routeId)}" data-ai-preferred>${route.selectedProviders.map((id) => `<option value="${id}" ${id === route.provider ? "selected" : ""}>${esc(providerFor(id).name)}</option>`).join("")}</select>
        </label>` : ""}
      <div class="set-control-grid set-provider-models">${renderSelectedModelControls(route, routeId)}</div>
    </section>`;
}

function formatProviderNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? new Intl.NumberFormat().format(Number(value))
    : "Not reported";
}

function formatProviderMoney(value, currency = "USD") {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "Not reported";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value));
  } catch {
    return `${currency || "USD"} ${Number(value).toFixed(2)}`;
  }
}

function providerAccountFor(runtime, providerId) {
  return runtime.usage?.data?.accounts?.find((account) => account.provider_id === providerId) || null;
}

function providerUsageFor(runtime, providerId) {
  return runtime.usage?.data?.usage?.providers?.find((usage) => usage.provider_id === providerId) || null;
}

function providerFinancialFacts(account, { loading = false } = {}) {
  if (!account) return [
    { label: "Money spent", value: loading ? "Checking" : "Not reported" },
    { label: "Money / credits left", value: loading ? "Checking" : "Not reported" },
  ];
  if (account.provider_id === "deepseek_api") {
    const balances = account.account?.balances || [];
    return [
      { label: "Money spent", value: "Not reported" },
      {
        label: "Credits left",
        value: balances.length
          ? balances.map((balance) => `${esc(balance.currency)} ${formatProviderNumber(balance.total)}`).join(" · ")
          : "Not reported",
      },
    ];
  }
  return [
    { label: "Money spent", value: formatProviderMoney(account.account?.spent_amount, account.account?.currency) },
    { label: "Money left", value: formatProviderMoney(account.account?.remaining_amount, account.account?.currency) },
  ];
}

function renderProviderCredentialSetup({ providerId, publicId, mark, title, placeholder, status, note }) {
  const configured = Boolean(status?.configured);
  return `
    <section class="set-provider-setup ${configured ? "is-configured" : ""}" data-provider-credential-card="${esc(providerId)}">
      <div class="set-provider-setup-copy">
        <span class="set-provider-mark">${esc(mark)}</span>
        <span>
          <b>${esc(title)}</b>
          <i>${configured ? `Connected ${esc(status.key_hint || "")}. ${esc(note)}` : `Add a key once. It is encrypted on the server and never returned to this browser. ${esc(note)}`}</i>
        </span>
      </div>
      <div class="set-provider-setup-actions">
        <input type="password" data-provider-api-key="${esc(providerId)}" placeholder="${esc(placeholder)}" autocomplete="new-password" spellcheck="false" aria-label="${esc(title)} API key"/>
        <button class="btn btn-primary" type="button" data-provider-save="${esc(providerId)}">${configured ? "Replace key" : `Connect ${esc(title)}`}</button>
        ${status?.removable ? `<button class="btn btn-quiet" type="button" data-provider-remove="${esc(providerId)}">Remove</button>` : ""}
        <button class="btn btn-quiet" type="button" data-provider-platform="${esc(publicId)}">Set as platform brain</button>
      </div>
      <p class="set-credential-message" data-provider-message="${esc(providerId)}"></p>
    </section>`;
}

function renderConfiguredProviderRow(runtime, provider) {
  const status = runtime.providerCredentials?.[provider.providerId] || {};
  const account = providerAccountFor(runtime, provider.providerId);
  const usage = providerUsageFor(runtime, provider.providerId);
  const health = account?.status || (runtime.usage?.loading ? "checking" : "unknown");
  const financialFacts = providerFinancialFacts(account, { loading: Boolean(runtime.usage?.loading) });
  return `
    <article class="set-configured-provider-row" data-configured-provider="${esc(provider.providerId)}">
      <div class="set-provider-identity">
        <span class="set-provider-mark">${esc(provider.mark)}</span>
        <span><b>${esc(provider.title)}</b><i>${esc(status.key_hint || "Configured")} · ${esc(status.source === "server_environment" ? "Server environment" : "Encrypted vault")}</i></span>
      </div>
      <span class="set-provider-health is-${esc(health)}"><i></i>${health === "up" ? "Up" : health === "down" ? "Down" : health === "checking" ? "Checking" : "Not checked"}</span>
      <dl class="set-provider-facts">
        <div><dt>Latency</dt><dd>${account ? `${formatProviderNumber(account.latency_ms)} ms` : "Not checked"}</dd></div>
        <div><dt>Last checked</dt><dd>${account?.last_checked_at ? esc(new Date(account.last_checked_at).toLocaleString()) : "Not checked"}</dd></div>
        <div><dt>Tokens</dt><dd>${formatProviderNumber(usage?.total_tokens)}</dd></div>
        ${financialFacts.map((fact) => `<div><dt>${esc(fact.label)}</dt><dd>${fact.value}</dd></div>`).join("")}
      </dl>
      <p class="set-provider-detail">${esc(account?.detail || "Run a provider check to verify this key and load account reporting.")}</p>
      <details class="set-provider-manage">
        <summary>Manage key</summary>
        <div class="set-provider-setup-actions">
          <input type="password" data-provider-api-key="${esc(provider.providerId)}" placeholder="${esc(provider.placeholder)}" autocomplete="new-password" spellcheck="false" aria-label="${esc(provider.title)} API key"/>
          <button class="btn btn-primary" type="button" data-provider-save="${esc(provider.providerId)}">Replace key</button>
          ${status.removable ? `<button class="btn btn-quiet" type="button" data-provider-remove="${esc(provider.providerId)}">Remove</button>` : ""}
          <button class="btn btn-quiet" type="button" data-provider-platform="${esc(provider.publicId)}">Set as platform brain</button>
        </div>
        <p class="set-credential-message" data-provider-message="${esc(provider.providerId)}"></p>
      </details>
    </article>`;
}

function renderConfiguredProviders(runtime) {
  const configured = CREDENTIAL_PROVIDERS.filter((provider) => runtime.providerCredentials?.[provider.providerId]?.configured);
  return `
    <section class="set-provider-dashboard">
      <header class="set-subsection-head">
        <div><p class="set-eyebrow">Active credentials</p><h4>Configured API keys</h4><p>Only keys currently configured for this organization appear here.</p></div>
        <span>${configured.length} active</span>
      </header>
      <div class="set-configured-provider-list">
        ${configured.length
          ? configured.map((provider) => renderConfiguredProviderRow(runtime, provider)).join("")
          : `<p class="set-empty-state">No API keys are configured. Local and subscription-backed routes remain separate.</p>`}
      </div>
    </section>`;
}

function renderProviderManager(runtime) {
  const available = CREDENTIAL_PROVIDERS.filter((provider) => !runtime.providerCredentials?.[provider.providerId]?.configured);
  return `
    <details class="set-provider-manager">
      <summary><span><b>Add or manage API keys</b><i>${available.length ? `${available.length} provider${available.length === 1 ? "" : "s"} available to connect` : "All supported API providers are configured"}</i></span></summary>
      <div class="set-provider-manager-grid">
        ${available.length ? available.map((provider) => renderProviderCredentialSetup({
          ...provider,
          status: runtime.providerCredentials?.[provider.providerId] || {},
        })).join("") : `<p class="set-empty-state">Use Manage key on a configured provider to replace or remove it.</p>`}
      </div>
    </details>`;
}

function renderUsageAnalytics(runtime) {
  const analytics = runtime.usage?.data;
  const usage = analytics?.usage;
  const totals = usage?.totals || {};
  const rows = usage?.providers || [];
  const range = runtime.usage?.range || "30d";
  return `
    <section class="set-usage-panel">
      <header class="set-usage-toolbar">
        <div><p class="set-eyebrow">Provider analytics</p><h4>Tokens, requests, and provider balance</h4><p>Token counts come from model responses. Money and credit values appear only when the provider reports them.</p></div>
        <div class="set-usage-range" aria-label="Usage range">
          ${["7d", "30d", "90d"].map((id) => `<button type="button" class="${range === id ? "is-active" : ""}" data-ai-usage-range="${id}">${id}</button>`).join("")}
        </div>
      </header>
      ${runtime.usage?.error ? `<p class="set-provider-error">${esc(runtime.usage.error)}</p>` : ""}
      <div class="set-usage-grid">
        <div class="set-usage-metric"><span>Requests</span><b>${runtime.usage?.loading && !analytics ? "Checking" : formatProviderNumber(totals.attempts)}</b></div>
        <div class="set-usage-metric"><span>Successful</span><b>${runtime.usage?.loading && !analytics ? "Checking" : formatProviderNumber(totals.successful_requests)}</b></div>
        <div class="set-usage-metric"><span>Input tokens</span><b>${runtime.usage?.loading && !analytics ? "Checking" : formatProviderNumber(totals.prompt_tokens)}</b></div>
        <div class="set-usage-metric"><span>Output tokens</span><b>${runtime.usage?.loading && !analytics ? "Checking" : formatProviderNumber(totals.completion_tokens)}</b></div>
        <div class="set-usage-metric"><span>Total tokens</span><b>${runtime.usage?.loading && !analytics ? "Checking" : formatProviderNumber(totals.total_tokens)}</b></div>
      </div>
      <div class="set-usage-table-wrap">
        <table class="set-usage-table">
          <thead><tr><th>Provider</th><th>Requests</th><th>Input</th><th>Output</th><th>Total</th><th>Spent</th><th>Money / credits left</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((row) => {
              const meta = CREDENTIAL_PROVIDERS.find((provider) => provider.providerId === row.provider_id);
              const account = providerAccountFor(runtime, row.provider_id);
              const facts = providerFinancialFacts(account, { loading: Boolean(runtime.usage?.loading) });
              return `<tr><td>${esc(meta?.title || providerFor(AI_BACKEND_TO_PUBLIC[row.provider_id] || "local").name)}</td><td>${formatProviderNumber(row.attempts)}</td><td>${formatProviderNumber(row.prompt_tokens)}</td><td>${formatProviderNumber(row.completion_tokens)}</td><td>${formatProviderNumber(row.total_tokens)}</td><td>${facts[0].value}</td><td>${facts[1].value}</td></tr>`;
            }).join("") : `<tr><td colspan="7">No provider calls have been recorded in this period.</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="set-footnote">No prompts, responses, or raw keys are stored in usage analytics. “Not reported” means the provider does not expose that value through the connected account endpoint.</p>
    </section>`;
}

function renderGatewayLoopControls() {
  const loop = loadPhantomLoop();
  const provider = LOOP_PROVIDERS.find((item) => item.id === loop.targetProvider) || LOOP_PROVIDERS[0];
  return `
    <section class="set-gateway-loop">
      <div class="set-gateway-loop-copy">
        <p class="set-eyebrow">Optional second pass</p>
        <h4>Phantom Loop</h4>
        <p>Send a draft through another selected model for critique or refinement. The loop never replaces the Platform brain or PhantomBot model.</p>
      </div>
      <label class="set-switch set-switch-large" title="Toggle Phantom Loop">
        <input type="checkbox" data-loop-toggle ${loop.enabled ? "checked" : ""}/><span></span>
      </label>
      <div class="set-control-grid">
        <label class="set-control"><span>Loop provider</span>
          <select data-loop-field="targetProvider">${optionList(LOOP_PROVIDERS.map((item) => ({ id: item.id, label: item.name })), loop.targetProvider)}</select>
        </label>
        <label class="set-control"><span>Loop model</span>
          <select data-loop-field="targetModel">${optionList(provider.models.map((model) => ({ id: model, label: modelDisplayLabel(model) })), loop.targetModel)}</select>
        </label>
        <label class="set-control"><span>Depth</span>
          <select data-loop-field="depth">${optionList([
            { id: "one_pass", label: "One pass" },
            { id: "two_pass", label: "Two passes" },
            { id: "auto", label: "Automatic" },
          ], loop.depth)}</select>
        </label>
      </div>
      <button class="btn btn-quiet" type="button" data-open-loop-settings>Advanced loop controls</button>
    </section>`;
}

function renderModelTab(settings) {
  const runtime = getAiRuntimeState();
  const openRouterCredential = runtime.providerCredentials?.openrouter_glm || {};
  const openRouterCatalogue = getAiProviderModelCatalog("openrouter_glm");
  const persistenceLabel = runtime.saving
    ? "Saving organization brain…"
    : runtime.error
      ? `Degraded: ${runtime.error}`
      : runtime.config?.version
        ? `Saved for this organization · version ${runtime.config.version}`
        : runtime.loading
          ? "Loading organization brain…"
          : "Local choice ready to sync";
  return `
      ${renderGhostModeSection()}
      <div class="set-section set-ai-control-center">
        <div class="set-sec-head">
          <div>
            <p class="set-eyebrow">Gateway control center</p>
            <h3>Choose exactly what powers PhantomForce</h3>
            <p class="set-note">The platform brain controls pages, planning, workspace intelligence, and automations. PhantomBot has its own model choice, so changing chat never silently changes the rest of the business.</p>
          </div>
        </div>
        <div class="set-selection-summary set-runtime-summary">
          <span><b>Runtime truth</b><i>${esc(persistenceLabel)}</i></span>
          <button class="btn btn-quiet" type="button" data-ai-runtime-refresh ${runtime.refreshing ? "disabled" : ""}>${runtime.refreshing ? "Checking…" : "Check providers now"}</button>
        </div>
        ${renderConfiguredProviders(runtime)}
        ${renderUsageAnalytics(runtime)}
        ${renderProviderManager(runtime)}
        ${openRouterCredential.configured ? `<div class="set-model-catalogue-bar">
          <span><b>OpenRouter model catalogue</b><i>${esc(openRouterModelStatusText())}</i></span>
          <button class="btn btn-quiet" type="button" data-openrouter-model-refresh ${openRouterCatalogue.loading ? "disabled" : ""}>${openRouterCatalogue.loading ? "Loading models..." : "Refresh model list"}</button>
        </div>` : ""}
        <div class="set-route-grid">
          ${renderAiRouteCard("platform", settings, "Platform brain", "Controls every AI-assisted page, planning flow, automation draft, workspace decision, and Prompt the Outcome request.")}
          ${renderAiRouteCard("phantombot", settings.phantomBot, "PhantomBot", "Controls PhantomBot conversations only. It can use a faster, local, subscription, or API model without changing the platform brain.")}
        </div>
        ${renderGatewayLoopControls()}
        ${settings.selectedProviders.includes("local") || settings.phantomBot.selectedProviders.includes("local") ? `
          <div class="set-rule-list">
            <span>Local uses Ollama on this machine (${esc(localModelStatus.baseUrl)}). A named model is usable only when Ollama reports it as installed.</span>
            <span>${esc(localProviderStatusText())}</span>
            <button class="btn btn-quiet" type="button" data-local-model-refresh>Re-read Ollama models</button>
          </div>` : ""}
        <div class="set-control-grid set-response-controls">
          <label class="set-control"><span>Response style</span>
            <select data-ai-field="responseStyle">${optionList([
              { id: "operator", label: "Operator - direct and decisive" },
              { id: "coach", label: "Coach - explain the move" },
              { id: "technical", label: "Technical - implementation detail" },
              { id: "sales", label: "Growth - revenue-aware" },
            ], settings.responseStyle)}</select>
          </label>
          <label class="set-control"><span>Response length</span>
            <select data-ai-field="responseLength">${optionList([
              { id: "short", label: "Short" },
              { id: "balanced", label: "Balanced" },
              { id: "deep", label: "Deep" },
            ], settings.responseLength)}</select>
          </label>
        </div>
        <p class="set-footnote">Configured means a credential is safely stored. Real means a provider health check or model request passed. Hybrid and Multiple may use another enabled provider and record that fallback; provider-only never switches silently.</p>
      </div>`;
}

function renderChatBehaviorTab(settings) {
  return `
      <div class="set-section">
        <div class="set-sec-head">
          <div>
            <h3>Chat behavior</h3>
            <p class="set-note">Basic chatbot controls for memory, context depth, and how much Phantom should carry between commands.</p>
          </div>
        </div>
        <div class="set-control-grid">
          <label class="set-control"><span>Memory</span>
            <select data-ai-field="memoryMode">${optionList([
              { id: "session", label: "This session only" },
              { id: "business", label: "Business memory" },
              { id: "pinned", label: "Pinned facts first" },
            ], settings.memoryMode)}</select>
          </label>
          <label class="set-control"><span>Context depth</span>
            <select data-ai-field="contextDepth">${optionList([
              { id: "light", label: "Light" },
              { id: "standard", label: "Standard" },
              { id: "deep", label: "Deep" },
            ], settings.contextDepth)}</select>
          </label>
          <label class="set-control"><span>External actions</span>
            <select data-ai-field="externalActionMode">${optionList([
              { id: "approval", label: "Ask before external actions" },
              { id: "blocked", label: "Block external actions" },
              { id: "owner_rules", label: "Use owner rules" },
            ], settings.externalActionMode)}</select>
          </label>
          <label class="set-control"><span>Autopilot scope</span>
            <select data-ai-field="autopilotScope">${optionList([
              { id: "safe_repeat", label: "Safe repeat work only" },
              { id: "manual_only", label: "Manual until approved" },
            ], settings.autopilotScope)}</select>
          </label>
        </div>
        <label class="set-inline set-inline-tight"><input type="checkbox" data-ai-toggle="receipts" ${settings.receipts ? "checked" : ""}/> Keep receipts for important actions</label>
        <div class="set-rule-list">
          <span>No public demo sends</span>
          <span>No uploads without a connected lane</span>
          <span>No charges without owner rules</span>
          <span>Autopilot is for safe repeat work</span>
        </div>
        <div class="record-actions">
          <button class="btn btn-quiet" type="button" data-ai-reset>Reset safe defaults</button>
        </div>
      </div>`;
}

function mediaCreditSnapshot() {
  let saved = {};
  try { saved = JSON.parse(workspaceStorageGetItem(MEDIA_LAB_CONFIG_KEY) || "{}"); } catch {}
  const remainingValue = Number(saved.credits);
  const remaining = Number.isFinite(remainingValue) && remainingValue >= 0 ? remainingValue : DEFAULT_MEDIA_CREDITS;
  return {
    remaining,
    used: Math.max(0, DEFAULT_MEDIA_CREDITS - remaining),
  };
}

function routeConnectionSummary(route, title, surface) {
  const infrastructure = getOperatorInfrastructureStatus(surface);
  const provider = providerFor(route.provider);
  const model = route.models?.[provider.id] || provider.models?.[0] || "";
  const routeLabel = route.providerMode === "smart"
    ? "Phantom Hybrid · automatic routing"
    : route.providerMode === "multiple"
      ? `${route.selectedProviders.length} connected routes`
      : `${provider.name} · ${provider.id === "local" ? localModelLabel(model) : modelDisplayLabel(model)}`;
  return {
    id: surface,
    name: title,
    state: infrastructure.configured ? "connected" : infrastructure.tone === "error" ? "attention" : "checking",
    status: infrastructure.configured ? "Active" : infrastructure.tone === "error" ? "Needs attention" : "Checking",
    detail: routeLabel,
    message: infrastructure.detail,
    settingsTab: "model",
  };
}

function configuredConnectionOverview(settings) {
  const runtime = getAiRuntimeState();
  const connections = CREDENTIAL_PROVIDERS.flatMap((provider) => {
    const credential = runtime.providerCredentials?.[provider.providerId];
    if (!credential?.configured) return [];
    const account = providerAccountFor(runtime, provider.providerId);
    const state = account?.status === "up" ? "connected" : account?.status === "down" ? "attention" : "checking";
    return [{
      id: `provider-${provider.providerId}`,
      name: `${provider.title} API`,
      state,
      status: state === "connected" ? "Active" : state === "attention" ? "Down" : "Configured",
      detail: account?.detail || "Encrypted organization credential",
      message: credential.key_hint || "Configured",
      settingsTab: "model",
    }];
  });
  const chatGpt = agentAssistBridgeStatus.status || {};
  if (chatGpt.executable) {
    connections.push({
      id: "bridge-chatgpt",
      name: "ChatGPT Plus Bridge",
      state: "connected",
      status: "Active",
      detail: "Subscription-backed reasoning and image lane",
      message: "Connected without storing your ChatGPT password",
      settingsTab: "bridge",
    });
  }
  const higgsfield = higgsfieldBridgeStatus.status || {};
  if (higgsfield.status === "connected") {
    connections.push({
      id: "bridge-higgsfield",
      name: "Higgsfield Bridge",
      state: "connected",
      status: "Active",
      detail: "Media Lab video and creative production lane",
      message: higgsfield.message || "Connected through the secure creative engine",
      settingsTab: "bridge",
    });
  }
  return {
    brainRoutes: [
      routeConnectionSummary(settings, "PhantomForce brain", "platform"),
      routeConnectionSummary(settings.phantomBot, "PhantomBot brain", "phantombot"),
    ],
    configuredConnections: connections,
  };
}

function renderBridgeRouteMap(settings) {
  const routes = configuredConnectionOverview(settings).brainRoutes;
  return `<section class="set-bridge-route-map" aria-label="Brain routes">
    ${routes.map((route) => `<article class="set-bridge-route is-${esc(route.state)}">
      <span class="set-connect-live-dot" aria-hidden="true"></span>
      <div><p class="set-eyebrow">${esc(route.name)}</p><h4>${esc(route.detail)}</h4><p>${esc(route.message)}</p></div>
      <button class="btn btn-quiet" type="button" data-open-settings-tab="model">Change brain</button>
    </article>`).join("")}
  </section>`;
}

function renderBridgesTab(settings) {
  const runtime = getAiRuntimeState();
  const chatGpt = agentAssistBridgeStatus.status || {};
  const chatGptError = agentAssistBridgeStatus.error;
  const chatGptSetupRequired = chatGpt.setup_required !== false;
  const chatGptUsage = providerUsageFor(runtime, "chatgpt_bridge") || {};
  const higgsfield = higgsfieldBridgeStatus.status || {};
  const higgsfieldError = higgsfieldBridgeStatus.error;
  const higgsfieldConnected = higgsfield.status === "connected";
  const mediaCredits = mediaCreditSnapshot();
  return `
    <div class="set-bridges-center">
      <section class="set-section set-bridges-hero">
        <div>
          <p class="set-eyebrow">Bridge control center</p>
          <h3>Your AI and creative bridges</h3>
          <p class="set-note">Connect subscription-backed services once, see exactly what they power, and keep usage visible. A bridge is marked active only after its real status route confirms it.</p>
        </div>
        <button class="btn btn-quiet" type="button" data-bridge-refresh ${(agentAssistBridgeStatus.loading || higgsfieldBridgeStatus.loading) ? "disabled" : ""}>${(agentAssistBridgeStatus.loading || higgsfieldBridgeStatus.loading) ? "Checking…" : "Refresh all"}</button>
      </section>

      ${renderBridgeRouteMap(settings)}

      <section class="set-bridge-product-grid">
        <article class="set-bridge-product ${chatGpt.executable ? "is-active" : "is-attention"}" data-bridge-card="chatgpt">
          <header>
            <span class="set-bridge-logo is-chatgpt" aria-hidden="true">CG</span>
            <div><p class="set-eyebrow">Subscription bridge</p><h3>ChatGPT Plus Bridge</h3></div>
            <span class="set-bridge-state ${chatGpt.executable ? "is-active" : "is-attention"}"><i></i>${esc(bridgeStatusLabel(chatGpt))}</span>
          </header>
          <p>Provides subscription-backed answers, supervision, and the still-image lane without asking customers for a developer API key.</p>
          <dl class="set-bridge-metrics">
            <div><dt>Requests tracked</dt><dd>${formatProviderNumber(chatGptUsage.attempts)}</dd></div>
            <div><dt>Tokens tracked</dt><dd>${formatProviderNumber(chatGptUsage.total_tokens)}</dd></div>
            <div><dt>Usage remaining</dt><dd>Not reported by ChatGPT</dd></div>
            <div><dt>Credentials</dt><dd>Managed by ChatGPT</dd></div>
          </dl>
          ${chatGptError ? `<p class="set-provider-error">${esc(chatGptError)}</p>` : ""}
          <div class="set-bridge-note ${chatGptSetupRequired ? "is-warning" : "is-ready"}">
            <b>${chatGptSetupRequired ? "Connect your ChatGPT account" : "Connected and ready"}</b>
            <span>${chatGptSetupRequired ? "Open ChatGPT, sign in or switch accounts, then return and refresh this bridge." : "PhantomForce can use this account anywhere the ChatGPT bridge is selected."}</span>
          </div>
          <div class="record-actions">
            <button class="btn btn-primary" type="button" data-chatgpt-account="switch">Connect / switch account</button>
            <button class="btn btn-quiet" type="button" data-chatgpt-account="logout">Log out of ChatGPT</button>
          </div>
          ${chatGptAccountMessage ? `<span class="set-status-pill">${esc(chatGptAccountMessage)}</span>` : ""}
        </article>

        <article class="set-bridge-product ${higgsfieldConnected ? "is-active" : "is-attention"}" data-bridge-card="higgsfield">
          <header>
            <span class="set-bridge-logo is-higgsfield" aria-hidden="true">HF</span>
            <div><p class="set-eyebrow">Creative bridge</p><h3>Higgsfield Bridge</h3></div>
            <span class="set-bridge-state ${higgsfieldConnected ? "is-active" : "is-attention"}"><i></i>${esc(higgsfieldStatusLabel(higgsfield))}</span>
          </header>
          <p>Connects Media Lab to Higgsfield for premium motion and creative production. Draft checks never spend credits; paid renders still require approval.</p>
          <dl class="set-bridge-metrics">
            <div><dt>Credits used</dt><dd>${formatProviderNumber(mediaCredits.used)}</dd></div>
            <div><dt>Credits remaining</dt><dd>${formatProviderNumber(mediaCredits.remaining)}</dd></div>
            <div><dt>Transport</dt><dd>${esc(higgsfield.transport === "hermes_mcp" ? "Secure bridge" : higgsfield.transport === "cli_fallback" ? "Owner render lane" : "Checking")}</dd></div>
            <div><dt>Paid renders</dt><dd>Approval required</dd></div>
          </dl>
          <p class="set-bridge-credit-note">Workspace production credits are deducted only after Media Lab receives a live provider asset. Higgsfield account billing remains provider-managed.</p>
          ${higgsfieldError ? `<p class="set-provider-error">${esc(higgsfieldError)}</p>` : ""}
          <div class="set-bridge-note ${higgsfieldConnected ? "is-ready" : "is-warning"}">
            <b>${higgsfieldConnected ? "Creative bridge ready" : "Higgsfield needs attention"}</b>
            <span>${esc(higgsfield.message || "Open Higgsfield to sign in, then return and refresh the creative bridge.")}</span>
          </div>
          <div class="record-actions">
            <button class="btn btn-primary" type="button" data-open-media-lab>Open Media Lab</button>
            <button class="btn btn-quiet" type="button" data-open-higgsfield>Manage Higgsfield account</button>
          </div>
        </article>
      </section>

      <section class="set-section set-bridge-builder">
        <div class="set-sec-head">
          <div><p class="set-eyebrow">New bridge</p><h3>Add another service</h3><p class="set-note">Use PhantomBot for a guided setup or open a manual recipe. New connections stay in setup until a real health check confirms them.</p></div>
        </div>
        <form class="set-bridge-ai-form" data-bridge-ai-form>
          <label class="set-control"><span>Service</span><input type="text" data-bridge-service placeholder="Example: Notion, Drive, Slack" maxlength="80" required/></label>
          <label class="set-control"><span>What should it power?</span><input type="text" data-bridge-purpose placeholder="Example: approved publishing and asset sync" maxlength="180"/></label>
          <button class="btn btn-primary" type="submit">Build with PhantomBot</button>
        </form>
        <div class="set-bridge-manual-grid">
          <article><span>01</span><div><b>ChatGPT Plus</b><i>Sign in, switch accounts, and verify the existing subscription bridge.</i></div><button class="btn btn-quiet" type="button" data-chatgpt-account="switch">Configure</button></article>
          <article><span>02</span><div><b>Higgsfield</b><i>Open the creative account, then verify the secure Media Lab bridge.</i></div><button class="btn btn-quiet" type="button" data-open-higgsfield>Configure</button></article>
          <article><span>03</span><div><b>Custom service</b><i>Prepare a secure connector brief without storing credentials in the browser.</i></div><button class="btn btn-quiet" type="button" data-bridge-custom-manual>Manual checklist</button></article>
        </div>
        ${bridgeBuilderMessage ? `<p class="set-status-pill" data-bridge-builder-message>${esc(bridgeBuilderMessage)}</p>` : ""}
      </section>
    </div>`;
}

function renderCompanionTab() {
  const companion = loadCompanionPrefs();
  return `
    <div class="set-section">
      <div class="set-section-head">
        <div>
          <p class="set-eyebrow">Living Phantom</p>
          <h3>Companion controls</h3>
          <p class="set-note">The Phantom can be dragged, resized, and remembered independently on each page. Automatic wandering is optional, so it stays easy to grab and control.</p>
        </div>
        <button class="btn btn-quiet" type="button" data-companion-reset>Reset companion</button>
      </div>
      <div class="set-grid set-grid-two">
        <label class="set-inline"><input type="checkbox" data-companion-toggle="enabled" ${companion.enabled ? "checked" : ""}/> Enable companion</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="visible" ${companion.visible ? "checked" : ""}/> Visible</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="startDocked" ${companion.startDocked ? "checked" : ""}/> Start docked</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="roamingEnabled" ${companion.roamingEnabled ? "checked" : ""}/> Free movement</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="autoWander" ${companion.autoWander ? "checked" : ""}/> Wander around page</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="rememberPagePositions" ${companion.rememberPagePositions ? "checked" : ""}/> Remember per page</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="speechEnabled" ${companion.speechEnabled ? "checked" : ""}/> Speech bubbles</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="notificationReactions" ${companion.notificationReactions ? "checked" : ""}/> Notification reactions</label>
        <label class="set-field">
          <span>Motion</span>
          <select data-companion-field="motionLevel">${optionList([
            { id: "full", label: "Full motion" },
            { id: "subtle", label: "Subtle motion" },
            { id: "reduced", label: "Reduced motion" },
            { id: "none", label: "No idle motion" },
          ], companion.motionLevel)}</select>
        </label>
        <label class="set-field">
          <span>Size</span>
          <select data-companion-field="size">${optionList([
            { id: "compact", label: "Compact" },
            { id: "standard", label: "Standard" },
            { id: "large", label: "Large" },
          ], companion.size)}</select>
        </label>
        <label class="set-field">
          <span>Home dock</span>
          <select data-companion-field="dockLocation">${optionList([
            { id: "bottom-left", label: "Bottom left" },
            { id: "bottom-right", label: "Bottom right" },
            { id: "sidebar", label: "Sidebar" },
          ], companion.dockLocation)}</select>
        </label>
        <label class="set-field">
          <span>Personality</span>
          <select data-companion-field="personality">${optionList([
            { id: "professional", label: "Professional" },
            { id: "friendly", label: "Friendly" },
            { id: "playful", label: "Playful" },
            { id: "quiet", label: "Quiet" },
          ], companion.personality)}</select>
        </label>
        <label class="set-field">
          <span>Idle frequency</span>
          <select data-companion-field="idleFrequency">${optionList([
            { id: "low", label: "Low" },
            { id: "normal", label: "Normal" },
            { id: "off", label: "Off" },
          ], companion.idleFrequency)}</select>
        </label>
        <label class="set-field">
          <span>Greeting</span>
          <select data-companion-field="greetingFrequency">${optionList([
            { id: "session", label: "Once per session" },
            { id: "daily", label: "Once per day" },
            { id: "off", label: "Off" },
          ], companion.greetingFrequency)}</select>
        </label>
      </div>
      <div class="set-actions-row">
        <button class="btn btn-quiet" type="button" data-companion-clear-hide>Show again this session</button>
        <button class="btn btn-quiet" type="button" data-companion-reset-placements>Reset page positions</button>
        <button class="btn btn-quiet" type="button" data-companion-quiet>Quiet docked mode</button>
        <button class="btn btn-quiet" type="button" data-companion-disable>Disable companion</button>
      </div>
      <p class="set-note">Drag Phantom to place him, use the corner grip to resize, or right-click him for quick controls. Essential notifications still stay in the normal notification menu if the companion is hidden or disabled.</p>
    </div>`;
}

const PLAN_FEATURE_LABELS = {
  chat: "AI chat",
  mediaLab: "Media Lab",
  websites: "Website builder",
  websitePublishing: "Website publishing",
  competitorIntelligence: "Customer intelligence",
  advancedWorkflows: "Advanced automations",
  phantomPlay: "PhantomPlay",
};

const PLAN_LIMIT_LABELS = {
  seats: "Seats",
  businesses: "Businesses",
  mediaCreditsPerMonth: "Media credits/mo",
  chatRequestsPerDay: "Chat/day",
  agentRunsPerDay: "Agent runs/day",
  storageMb: "Storage",
  sitesPerOrg: "Sites",
  competitorProfiles: "Competitors",
};

function formatPlanLimit(key, value) {
  const amount = Number(value);
  if (key === "storageMb" && Number.isFinite(amount)) return amount >= 1024 ? `${Math.round(amount / 1024)} GB` : `${amount} MB`;
  if (Number.isFinite(amount) && amount >= 100000) return "Unlimited";
  return String(value ?? "0");
}

function renderPlanCard(plan, currentKey, options = {}) {
  const { localCustomer = false, canManage = false, billing = null, interval = "month" } = options;
  const current = plan.key === currentKey;
  const limits = Object.entries(PLAN_LIMIT_LABELS)
    .slice(0, 6)
    .map(([key, label]) => `<span><b>${esc(label)}</b><i>${esc(formatPlanLimit(key, plan.limits?.[key]))}</i></span>`)
    .join("");
  const features = Object.entries(PLAN_FEATURE_LABELS)
    .map(([key, label]) => `<span class="set-chip ${plan.features?.[key] === false ? "is-off" : "is-on"}">${plan.features?.[key] === false ? "Locked" : "Included"} · ${esc(label)}</span>`)
    .join("");
  return `
    <article class="set-choice-card set-plan-card ${current ? "is-selected" : ""}">
      <div class="set-card-head"><span>${esc(plan.name || plan.key)}</span><b>${current ? "Current" : "Available"}</b></div>
      <p>${esc(plan.description || "Customer operating tier")}</p>
      <div class="set-status-grid set-context-grid">${limits}</div>
      <div class="set-chip-row">${features}</div>
      ${localCustomer ? `<button type="button" class="btn ${current ? "btn-quiet" : "btn-primary"}" data-plan-switch="${esc(plan.key)}" ${current ? "disabled" : ""}>${current ? "Using this tier" : `Switch to ${esc(plan.name || plan.key)}`}</button>` : ""}
      ${!localCustomer && canManage && !current && billing?.checkoutEnabled && !billing?.hasOpenSubscription && plan.key !== "free" && plan.intervals?.[interval]
        ? `<button type="button" class="btn btn-primary" data-billing-checkout="${esc(plan.key)}">Continue to secure checkout</button>`
        : ""}
      ${!localCustomer && !current && billing?.checkoutEnabled && !billing?.hasOpenSubscription && plan.key !== "free" && !plan.intervals?.[interval]
        ? `<span class="set-note">This billing interval is unavailable right now.</span>`
        : ""}
    </article>`;
}

async function renderPlanAccessTab(el, opts = {}) {
  const localCustomer = Boolean(ctx.session?.localCustomer);
  const billingInterval = opts.billingInterval === "year" ? "year" : "month";
  el.innerHTML = `<div class="set-section"><div class="cust-empty"><b>Loading plan access...</b><span>Checking this workspace.</span></div></div>`;
  try {
    const [summary, billing] = await Promise.all([
      localCustomer ? fetchCustomerPlanPreview() : fetchEntitlementsSummary(),
      localCustomer ? Promise.resolve(null) : fetchStripeBillingSummary(),
    ]);
    const entitlements = summary?.entitlements || null;
    if (!entitlements) {
      el.innerHTML = `<div class="set-section"><div class="cust-empty"><b>Plan access is unavailable.</b><span>Reconnect the workspace, then reopen this tab.</span></div></div>`;
      return;
    }
    const entitlementPlans = Array.isArray(summary.plans) && summary.plans.length
      ? summary.plans
      : [{ key: entitlements.planKey, name: entitlements.planName, description: entitlements.note, features: entitlements.features, limits: entitlements.limits }];
    const plans = !localCustomer && Array.isArray(billing?.checkoutPlans) && billing.checkoutPlans.length
      ? entitlementPlans.map((plan) => ({ ...plan, intervals: billing.checkoutPlans.find((item) => item.key === plan.key)?.intervals || {} }))
      : entitlementPlans;
    const canManagePlan = localCustomer || canManageActiveOrg();
    const returnState = new URLSearchParams(location.search).get("billing");
    const billingMessage = returnState === "success"
      ? "Checkout returned successfully. PhantomForce will update access only after the signed Stripe webhook verifies the payment."
      : returnState === "cancelled"
        ? "Checkout was cancelled. No plan or access change was made."
        : "";
    const billingModeLabel = localCustomer
      ? "Safe simulator"
      : billing?.productionReady
        ? "Stripe verified"
        : "Connect payments";
    const planDescription = localCustomer
      ? "Switch Basic, Pro, and Elite instantly. Workspace type is configured separately, and this local simulator never charges a payment method."
      : !canManagePlan
        ? "This workspace plan and billing are managed by an owner or admin."
        : billing?.productionReady
          ? "Choose a plan with Stripe Checkout. Card, Apple Pay, and eligible PayPal options appear securely at checkout; access changes only after Stripe verifies payment."
          : "Secure checkout is not connected yet. Your current access remains unchanged; choose Connect for Stripe in Connections. No payment credentials are entered here.";
    el.innerHTML = `
      <div class="set-section">
        <div class="set-section-head">
          <div><p class="set-eyebrow">Plan & access</p><h3>${esc(entitlements.planName || entitlements.planKey || "Current tier")}</h3><p class="set-note">${esc(planDescription)}</p></div>
          <span class="set-status-pill ${entitlements.canWrite === false ? "" : "is-on"}">${entitlements.canWrite === false ? "View only" : "Write access"}</span>
        </div>
        <p class="set-note" data-plan-message>${esc(billingMessage)}</p>
      </div>
      ${!localCustomer ? `
        <div class="set-section">
          <div class="set-card-head"><span>Secure billing</span><b>${esc(billingModeLabel)}</b></div>
          <p class="set-note">${esc(billing?.reason || "Billing state is unavailable. Reconnect the workspace and try again.")}</p>
          <div class="set-chip-row">${(billing?.paymentMethods?.supported || ["Card", "Apple Pay when eligible", "PayPal when eligible"]).map((method) => `<span class="set-chip is-on">${esc(method)}</span>`).join("")}</div>
          ${canManagePlan && billing?.customerOnFile ? `<button type="button" class="btn btn-quiet" data-billing-portal>Manage payment method, invoices & subscription</button>` : ""}
          ${canManagePlan && billing?.customerOnFile && billing?.portalUsesDashboardDefault ? `<p class="set-note">Billing uses Stripe’s Dashboard-managed customer portal configuration.</p>` : ""}
        </div>` : ""}
      <div class="set-section">
        <div class="set-card-head"><span>Tier controls</span><b>${localCustomer ? "Simulator" : canManagePlan ? "Secure checkout" : "Read-only"}</b></div>
        ${!localCustomer && canManagePlan && billing?.checkoutEnabled && !billing?.hasOpenSubscription ? `<div class="set-chip-row"><button type="button" class="btn ${billingInterval === "month" ? "btn-primary" : "btn-quiet"}" data-billing-interval="month">Monthly</button><button type="button" class="btn ${billingInterval === "year" ? "btn-primary" : "btn-quiet"}" data-billing-interval="year">Annual</button></div>` : ""}
        <div class="set-choice-grid set-plan-grid">${plans.map((plan) => renderPlanCard(plan, entitlements.planKey, { localCustomer, canManage: canManagePlan, billing, interval: billingInterval })).join("")}</div>
      </div>`;
    const message = el.querySelector("[data-plan-message]");
    el.querySelectorAll("[data-plan-switch]").forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        if (message) message.textContent = `Switching to ${button.textContent.replace(/^Switch to\s+/u, "")}...`;
        const result = await switchCustomerPlan(button.dataset.planSwitch);
        if (!result.ok) {
          button.disabled = false;
          if (message) message.textContent = `Plan switch failed: ${result.error || "server refused the change"}.`;
          return;
        }
        const current = session.get?.() || {};
        session.set?.({ ...current, canWrite: result.entitlements?.canWrite });
        if (ctx.session) ctx.session = { ...ctx.session, canWrite: result.entitlements?.canWrite };
        if (typeof opts.onWorkspaceApplied === "function") opts.onWorkspaceApplied(result.entitlements);
        await renderPlanAccessTab(el, opts);
      };
    });
    el.querySelectorAll("[data-billing-interval]").forEach((button) => {
      button.onclick = () => renderPlanAccessTab(el, { ...opts, billingInterval: button.dataset.billingInterval });
    });
    el.querySelectorAll("[data-billing-checkout]").forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        if (message) message.textContent = "Opening secure Stripe Checkout…";
        const result = await createStripeCheckout(button.dataset.billingCheckout, billingInterval);
        if (!result.ok || !result.checkoutUrl) {
          button.disabled = false;
          if (message) message.textContent = result.error === "billing_portal_required" ? "This workspace already has a subscription. Use the billing portal to manage it." : `Checkout could not start: ${result.message || result.error || "server refused the request"}.`;
          return;
        }
        location.assign(result.checkoutUrl);
      };
    });
    const portalButton = el.querySelector("[data-billing-portal]");
    if (portalButton) {
      portalButton.onclick = async () => {
        portalButton.disabled = true;
        if (message) message.textContent = "Opening the secure Stripe billing portal…";
        const result = await createStripeBillingPortal();
        if (!result.ok || !result.portalUrl) {
          portalButton.disabled = false;
          if (message) message.textContent = `Billing portal could not start: ${result.message || result.error || "server refused the request"}.`;
          return;
        }
        location.assign(result.portalUrl);
      };
    }
  } catch (error) {
    el.innerHTML = `<div class="set-section"><div class="cust-empty"><b>Plan access could not load.</b><span>${esc(error instanceof Error ? error.message : "Check the workspace connection and try again.")}</span></div></div>`;
  }
}

function selectedMemberHelp(module) {
  const ids = module.allowedMemberIds || [];
  return ids.length ? `${ids.length} selected` : "No selected members yet";
}

async function renderWorkspaceModulesTab(el, opts = {}) {
  if (!el) return;
  el.innerHTML = `<div class="set-section"><p class="set-note">Loading workspace modules...</p></div>`;
  try {
    const payload = await moduleApi(`/phantom-ai/customization/workspace-modules?tenant_id=${encodeURIComponent(currentTenantId())}`);
    const module = payload.modules?.find((item) => item.id === "phantomplay") || {
      id: "phantomplay",
      label: "PhantomPlay",
      enabled: false,
      accessMode: "owner_only",
      allowedMemberIds: [],
      activityEnabled: false,
      challengesEnabled: false,
    };
    const internalAdminSurface = isLiveAdminHost() || (isLocalDevHost() && ctx.session?.role === "admin");
    const canManage = payload.can_manage === true;
    const enabled = internalAdminSurface ? true : module.enabled === true;
    el.innerHTML = `
      <div class="set-section">
        <div class="set-section-head">
          <div>
            <p class="set-eyebrow">Workspace Modules</p>
            <h3>${internalAdminSurface ? "Internal modules are always available here." : "Optional modules stay out of the way until enabled."}</h3>
            <p class="set-note">${internalAdminSurface ? "This is the PhantomForce builder layer. PhantomPlay and internal admin tools cannot be hidden from the admin host." : "Core business tools remain prioritized. Optional modules can be enabled per organization without changing PhantomForce operations."}</p>
          </div>
          <span class="set-status-pill ${enabled ? "is-on" : ""}">${enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <article class="set-module-card">
          <div class="set-module-card-main">
            <span class="set-provider-mark">PP</span>
            <div>
              <p class="set-eyebrow">Optional module</p>
              <h3>PhantomPlay</h3>
              <p class="set-note">Give your team an optional place to recharge, compete, and participate in workspace activities. PhantomPlay remains completely separate from core business operations.</p>
              <p class="set-note">Disabling it does not affect Clients, Accounting, Automations, Approvals, Workforce, Analytics, or any core PhantomForce feature.</p>
            </div>
          </div>
          <div class="set-grid set-grid-two">
            <label class="set-inline"><input type="checkbox" data-module-enabled ${enabled ? "checked" : ""} ${canManage && !internalAdminSurface ? "" : "disabled"}/> PhantomPlay available${internalAdminSurface ? " · locked on" : ""}</label>
            <label class="set-field">
              <span>Access</span>
              <select data-module-access ${canManage && enabled ? "" : "disabled"}>
                <option value="owner_only" ${module.accessMode === "owner_only" ? "selected" : ""}>Owner only</option>
                <option value="selected_members" ${module.accessMode === "selected_members" ? "selected" : ""}>Selected members</option>
                <option value="entire_organization" ${module.accessMode === "entire_organization" ? "selected" : ""}>Entire organization</option>
              </select>
            </label>
            <label class="set-inline"><input type="checkbox" data-module-activity ${module.activityEnabled ? "checked" : ""} ${canManage && enabled ? "" : "disabled"}/> Workspace activity</label>
            <label class="set-inline"><input type="checkbox" data-module-challenges ${module.challengesEnabled ? "checked" : ""} ${canManage && enabled ? "" : "disabled"}/> Team challenges</label>
          </div>
          <label class="set-field ${module.accessMode === "selected_members" ? "" : "is-muted"}">
            <span>Selected member IDs</span>
            <textarea data-module-member-ids rows="3" ${canManage && enabled && module.accessMode === "selected_members" ? "" : "disabled"} placeholder="Paste user IDs, emails, or auth IDs, one per line.">${esc((module.allowedMemberIds || []).join("\n"))}</textarea>
            <i>${esc(selectedMemberHelp(module))}</i>
          </label>
          <div class="set-actions-row">
            ${internalAdminSurface ? `<button class="btn btn-primary" type="button" disabled>Locked on for admin</button>` : `<button class="btn btn-primary" type="button" data-module-save ${canManage ? "" : "disabled"}>${enabled ? "Save module access" : "Enable PhantomPlay"}</button>`}
            ${enabled && !internalAdminSurface ? `<button class="btn btn-quiet" type="button" data-module-disable ${canManage ? "" : "disabled"}>Disable PhantomPlay</button>` : ""}
          </div>
          <p class="set-note" data-module-message>${canManage ? "" : "Only organization owners and workspace administrators can configure this module."}</p>
        </article>
      </div>`;

    const message = el.querySelector("[data-module-message]");
    const readDraft = () => {
      const accessMode = el.querySelector("[data-module-access]")?.value || "owner_only";
      return {
        tenant_id: currentTenantId(),
        module_id: "phantomplay",
        enabled: el.querySelector("[data-module-enabled]")?.checked === true,
        accessMode,
        allowedMemberIds: String(el.querySelector("[data-module-member-ids]")?.value || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean),
        activityEnabled: el.querySelector("[data-module-activity]")?.checked === true,
        challengesEnabled: el.querySelector("[data-module-challenges]")?.checked === true,
      };
    };
    const syncControls = () => {
      const enabledNow = el.querySelector("[data-module-enabled]")?.checked === true;
      const access = el.querySelector("[data-module-access]");
      const activity = el.querySelector("[data-module-activity]");
      const challenges = el.querySelector("[data-module-challenges]");
      const memberBox = el.querySelector("[data-module-member-ids]");
      const memberWrap = memberBox?.closest(".set-field");
      const selectedMode = access?.value || "owner_only";
      if (access) access.disabled = !(canManage && enabledNow) || internalAdminSurface;
      if (activity) activity.disabled = !(canManage && enabledNow);
      if (challenges) challenges.disabled = !(canManage && enabledNow);
      if (memberBox) memberBox.disabled = !(canManage && enabledNow && selectedMode === "selected_members") || internalAdminSurface;
      memberWrap?.classList.toggle("is-muted", selectedMode !== "selected_members");
      const save = el.querySelector("[data-module-save]");
      if (save) save.textContent = enabledNow ? (module.enabled === true ? "Save module access" : "Enable PhantomPlay") : "Save module access";
    };
    const saveDraft = async (draft) => {
      if (!draft.enabled && !window.confirm("Disabling PhantomPlay hides it from your workspace. Existing progress and settings will be preserved.")) return;
      if (draft.enabled && module.enabled !== true && !window.confirm("Enable PhantomPlay for the selected workspace members?")) return;
      if (message) message.textContent = "Saving module access...";
      await moduleApi("/phantom-ai/customization/workspace-modules", { method: "PATCH", body: JSON.stringify(draft) });
      if (message) message.textContent = draft.enabled ? "PhantomPlay is now available to the selected workspace members." : "PhantomPlay is hidden. Progress and settings were preserved.";
      if (typeof opts.onWorkspaceApplied === "function") opts.onWorkspaceApplied();
      await renderWorkspaceModulesTab(el, opts);
    };
    el.querySelector("[data-module-access]")?.addEventListener("change", () => {
      syncControls();
    });
    el.querySelector("[data-module-enabled]")?.addEventListener("change", syncControls);
    syncControls();
    el.querySelector("[data-module-save]")?.addEventListener("click", () => saveDraft(readDraft()).catch((error) => { if (message) message.textContent = error.message; }));
    el.querySelector("[data-module-disable]")?.addEventListener("click", () => saveDraft({ ...readDraft(), enabled: false }).catch((error) => { if (message) message.textContent = error.message; }));
  } catch (error) {
    el.innerHTML = `<div class="set-section"><div class="cust-empty"><b>Workspace modules could not load.</b><span>${esc(error instanceof Error ? error.message : "Check the workspace connection and try again.")}</span></div></div>`;
  }
}

export function renderOperatorSettings(el, opts = {}) {
  const settings = loadOperatorSettings();
  const activeProvider = providerFor(settings.provider);
  const activeModel = settings.models[activeProvider.id] || activeProvider.models[0];
  const mediaMountId = `media-settings-${Math.random().toString(36).slice(2)}`;
  const clientSetupMountId = `client-setup-settings-${Math.random().toString(36).slice(2)}`;
  const workspaceMountId = `workspace-studio-${Math.random().toString(36).slice(2)}`;
  const modulesMountId = `workspace-modules-${Math.random().toString(36).slice(2)}`;
  const organizationMountId = `organization-${Math.random().toString(36).slice(2)}`;
  const planMountId = `plan-access-${Math.random().toString(36).slice(2)}`;
  const initialTab = opts.initialTab && SETTINGS_TABS.some((tab) => tab.id === opts.initialTab) ? opts.initialTab : null;
  const activeTab = initialTab || loadSettingsTab();
  const activeContext = SETTINGS_CONTEXT[activeTab];
  const hero = activeTab === "model"
    ? {
        eyebrow: "Platform gateway",
        title: "PhantomForce Brain & Gateway",
        note: "Connect provider keys, choose the organization-wide Platform brain, choose PhantomBot separately, and control optional loop routing from one place.",
      }
    : activeTab === "bridge" || activeTab === "media"
      ? {
          eyebrow: "Connected workspace",
          title: "Bridges & Connectors",
          note: "See what is active first, understand which brain each route powers, and connect new services without exposing provider credentials.",
        }
      : {
        eyebrow: "Operator brain",
        title: "Phantom Console settings",
        note: "Phantom AI is the chatbot. Phantom Console is the operating layer around it: organization-wide model routing, Phantom Loop, memory depth, Termina hands, and the approval/autopilot boundary. Provider credentials stay encrypted on the server.",
      };
  if (initialTab) saveSettingsTab(initialTab);

  const TAB_CONTENT = {
    model: () => renderModelTab(settings, activeProvider, activeModel),
    loop: () => renderLoopAdvancedSection(),
    chat: () => renderChatBehaviorTab(settings),
    bridge: () => renderBridgesTab(settings),
    clientsetup: () => `<div id="${clientSetupMountId}" class="set-client-setup-mount"></div>`,
    organization: () => `<div id="${organizationMountId}" class="set-workspace-mount"></div>`,
    plan: () => `<div id="${planMountId}" class="set-workspace-mount"></div>`,
    workspace: () => `<div id="${workspaceMountId}" class="set-workspace-mount"></div>`,
    modules: () => `<div id="${modulesMountId}" class="set-workspace-mount"></div>`,
    companion: () => renderCompanionTab(),
    media: () => `<div id="${mediaMountId}"></div>`,
  };

  el.innerHTML = `
    <div class="settings settings-operator">
      <div class="set-section set-ai-hero">
        <div>
          <p class="set-eyebrow">${esc(hero.eyebrow)}</p>
          <h3>${esc(hero.title)}</h3>
          <p class="set-note">${esc(hero.note)}</p>
        </div>
        ${renderSafetySummary(settings)}
      </div>

      <div class="set-settings-layout">
        ${renderSettingsCategories(activeTab)}
        <div class="set-tab-panel" data-set-panel role="tabpanel">
          ${activeContext ? `<div class="set-panel-heading"><p class="set-eyebrow">Workspace settings</p><h3>${esc(activeContext.title)}</h3><p class="set-note">${esc(activeContext.note)}</p></div>` : ""}
          ${(TAB_CONTENT[activeTab] || TAB_CONTENT.model)()}
        </div>
      </div>
    </div>`;

  el.querySelectorAll("[data-set-tab]").forEach((button) => {
    button.onclick = () => {
      saveSettingsTab(button.dataset.setTab);
      renderOperatorSettings(el, opts);
    };
  });

  const saveAndRender = () => {
    saveOperatorSettings(settings);
    void persistAiRuntimeConfig(settings)
      .then(() => { if (el.isConnected && loadSettingsTab() === "model") renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected && loadSettingsTab() === "model") renderOperatorSettings(el, opts); });
    renderOperatorSettings(el, opts);
  };
  const routeForElement = (element) => element?.dataset?.aiRoute === "phantombot" ? settings.phantomBot : settings;

  el.querySelectorAll("[data-ai-provider]").forEach((button) => {
    button.onclick = () => {
      const route = routeForElement(button);
      const id = button.dataset.aiProvider || DEFAULT_SETTINGS.provider;
      if (route.providerMode === "smart") return;
      if (route.providerMode === "single") {
        route.provider = id;
        route.selectedProviders = [id];
      } else if (route.selectedProviders.includes(id)) {
        if (route.selectedProviders.length <= 2) return;
        route.selectedProviders = route.selectedProviders.filter((providerId) => providerId !== id);
        if (route.provider === id) route.provider = route.selectedProviders[0];
      } else {
        route.selectedProviders = [...route.selectedProviders, id];
      }
      saveAndRender();
    };
  });

  el.querySelectorAll("[data-provider-mode]").forEach((button) => {
    button.onclick = () => {
      const route = routeForElement(button);
      route.providerMode = button.dataset.providerMode || "smart";
      if (route.providerMode === "smart") route.selectedProviders = PROVIDERS.map((provider) => provider.id);
      if (route.providerMode === "single") route.selectedProviders = [route.provider];
      if (route.providerMode === "multiple" && route.selectedProviders.length < 2) {
        route.selectedProviders = [route.provider, route.provider === "deepseek" ? "local" : "deepseek"];
      }
      saveAndRender();
    };
  });

  el.querySelectorAll("[data-ai-provider-model]").forEach((select) => {
    const commitModel = () => {
      const route = routeForElement(select);
      route.models[select.dataset.aiProviderModel] = select.value;
      saveAndRender();
    };
    select.onchange = commitModel;
  });

  el.querySelectorAll("[data-ai-preferred]").forEach((preferred) => {
    preferred.onchange = () => {
      routeForElement(preferred).provider = preferred.value;
      saveAndRender();
    };
  });

  el.querySelectorAll("[data-provider-save]").forEach((button) => {
    button.onclick = async () => {
      const providerId = button.dataset.providerSave;
      const input = el.querySelector(`[data-provider-api-key="${providerId}"]`);
      const message = el.querySelector(`[data-provider-message="${providerId}"]`);
      const apiKey = String(input?.value || "").trim();
      if (!apiKey) {
        if (message) message.textContent = "Enter the API key first.";
        input?.focus();
        return;
      }
      button.disabled = true;
      if (message) message.textContent = "Encrypting and saving on the server...";
      try {
        await saveAiProviderCredential(providerId, apiKey);
        if (providerId === "openrouter_glm") await loadAiProviderModels("openrouter_glm", { force: true }).catch(() => null);
        if (input) input.value = "";
        if (el.isConnected) renderOperatorSettings(el, opts);
      } catch (error) {
        button.disabled = false;
        if (message) message.textContent = error instanceof Error ? error.message : "The provider could not be connected.";
      }
    };
  });
  el.querySelectorAll("[data-provider-remove]").forEach((button) => {
    button.onclick = async () => {
      const providerId = button.dataset.providerRemove;
      const message = el.querySelector(`[data-provider-message="${providerId}"]`);
      button.disabled = true;
      try {
        await removeAiProviderCredential(providerId);
        if (el.isConnected) renderOperatorSettings(el, opts);
      } catch (error) {
        button.disabled = false;
        if (message) message.textContent = error instanceof Error ? error.message : "The provider could not be disconnected.";
      }
    };
  });
  el.querySelectorAll("[data-provider-platform]").forEach((button) => {
    button.onclick = () => {
      const providerId = button.dataset.providerPlatform;
      settings.provider = providerId;
      settings.providerMode = "single";
      settings.selectedProviders = [providerId];
      saveAndRender();
    };
  });

  const openRouterModelRefresh = el.querySelector("[data-openrouter-model-refresh]");
  if (openRouterModelRefresh) openRouterModelRefresh.onclick = () => {
    void loadAiProviderModels("openrouter_glm", { force: true })
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
    renderOperatorSettings(el, opts);
  };

  const localRefresh = el.querySelector("[data-local-model-refresh]");
  if (localRefresh) localRefresh.onclick = () => refreshLocalModels(el, opts);

  const runtimeRefresh = el.querySelector("[data-ai-runtime-refresh]");
  if (runtimeRefresh) runtimeRefresh.onclick = () => {
    void refreshAiRuntimeProviders()
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
    renderOperatorSettings(el, opts);
  };

  el.querySelectorAll("[data-ai-usage-range]").forEach((button) => {
    button.onclick = () => {
      const range = button.dataset.aiUsageRange || "30d";
      void loadAiRuntimeUsage({ range, force: true })
        .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
        .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
      renderOperatorSettings(el, opts);
    };
  });

  const bridgeRefresh = el.querySelector("[data-bridge-refresh]");
  if (bridgeRefresh) bridgeRefresh.onclick = () => refreshBridgeStatuses(el, opts);
  el.querySelectorAll("[data-chatgpt-account]").forEach((button) => {
    button.onclick = async () => {
      await openChatGptAccountPage(button.dataset.chatgptAccount);
      if (el.isConnected) renderOperatorSettings(el, opts);
    };
  });
  el.querySelectorAll("[data-open-settings-tab]").forEach((button) => {
    button.onclick = () => {
      saveSettingsTab(button.dataset.openSettingsTab || "model");
      renderOperatorSettings(el, opts);
    };
  });
  el.querySelectorAll("[data-open-higgsfield]").forEach((button) => {
    button.onclick = async () => {
      await openExternalAccountPage("https://higgsfield.ai/", "Higgsfield");
      if (el.isConnected) renderOperatorSettings(el, opts);
    };
  });
  el.querySelectorAll("[data-open-media-lab]").forEach((button) => {
    button.onclick = () => {
      window.location.hash = "#page/media";
      try { window.dispatchEvent(new HashChangeEvent("hashchange")); } catch {}
    };
  });
  el.querySelector("[data-bridge-custom-manual]")?.addEventListener("click", () => {
    bridgeBuilderMessage = "Manual checklist: name the service and purpose, confirm its secure sign-in method, define read/write permissions, connect through the server broker, then keep it in setup until a real health check passes.";
    renderOperatorSettings(el, opts);
  });
  el.querySelector("[data-bridge-ai-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const service = String(el.querySelector("[data-bridge-service]")?.value || "").trim();
    const purpose = String(el.querySelector("[data-bridge-purpose]")?.value || "").trim();
    if (!service) return;
    const prompt = `Help me configure a secure PhantomForce bridge for ${service}. ${purpose ? `It should power: ${purpose}. ` : ""}Use the existing connector and server-broker boundaries. Do not place credentials in browser storage. Keep the bridge in setup until a real authenticated health check proves it is active. Show me the simplest consumer-facing steps and implement only actions I approve.`;
    workspaceStorageSetItem(PHANTOMBOT_BRIDGE_PROMPT_KEY, prompt);
    window.location.hash = "#page/phantombot";
    try { window.dispatchEvent(new HashChangeEvent("hashchange")); } catch {}
  });

  el.querySelectorAll("[data-ai-field]").forEach((field) => {
    field.onchange = () => {
      settings[field.dataset.aiField] = field.value;
      saveAndRender();
    };
  });

  el.querySelectorAll("[data-ai-toggle]").forEach((input) => {
    input.onchange = () => {
      settings[input.dataset.aiToggle] = input.checked;
      saveAndRender();
    };
  });

  const reset = el.querySelector("[data-ai-reset]");
  if (reset) reset.onclick = () => {
    saveOperatorSettings(DEFAULT_SETTINGS);
    void persistAiRuntimeConfig(DEFAULT_SETTINGS)
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
    renderOperatorSettings(el, opts);
  };

  const saveCompanionAndRender = (patch) => {
    const next = { ...DEFAULT_COMPANION_PREFS, ...loadCompanionPrefs(), ...(patch || {}) };
    if (patch?.roamingEnabled) next.startDocked = false;
    if (patch?.autoWander) {
      next.roamingEnabled = true;
      next.startDocked = false;
    }
    if (patch?.startDocked) {
      next.roamingEnabled = false;
      next.autoWander = false;
    }
    saveCompanionPrefs(next);
    renderOperatorSettings(el, opts);
  };

  el.querySelectorAll("[data-companion-toggle]").forEach((input) => {
    input.onchange = () => saveCompanionAndRender({ [input.dataset.companionToggle]: input.checked });
  });

  el.querySelectorAll("[data-companion-field]").forEach((field) => {
    field.onchange = () => saveCompanionAndRender({ [field.dataset.companionField]: field.value });
  });

  const companionReset = el.querySelector("[data-companion-reset]");
  if (companionReset) companionReset.onclick = () => {
    resetCompanionPrefs();
    renderOperatorSettings(el, opts);
  };
  const companionClearHide = el.querySelector("[data-companion-clear-hide]");
  if (companionClearHide) companionClearHide.onclick = () => {
    clearCompanionSessionHide();
    renderOperatorSettings(el, opts);
  };
  const companionResetPlacements = el.querySelector("[data-companion-reset-placements]");
  if (companionResetPlacements) companionResetPlacements.onclick = () => {
    clearCompanionPagePlacements();
    renderOperatorSettings(el, opts);
  };
  const companionQuiet = el.querySelector("[data-companion-quiet]");
  if (companionQuiet) companionQuiet.onclick = () => saveCompanionAndRender({
    enabled: true,
    visible: true,
    startDocked: true,
    roamingEnabled: false,
    autoWander: false,
    dockLocation: "sidebar",
    motionLevel: "reduced",
    personality: "quiet",
    speechEnabled: false,
    idleFrequency: "off",
  });
  const companionDisable = el.querySelector("[data-companion-disable]");
  if (companionDisable) companionDisable.onclick = () => saveCompanionAndRender({ enabled: false });

  const loop = loadPhantomLoop();
  const saveLoopAndRender = (patch, advPatch) => {
    savePhantomLoop({ ...loop, ...patch, advanced: { ...loop.advanced, ...(advPatch || {}) } });
    renderOperatorSettings(el, opts);
  };

  const loopToggle = el.querySelector("[data-loop-toggle]");
  if (loopToggle) loopToggle.onchange = () => saveLoopAndRender({ enabled: loopToggle.checked });

  const openLoopSettings = el.querySelector("[data-open-loop-settings]");
  if (openLoopSettings) openLoopSettings.onclick = () => {
    saveSettingsTab("loop");
    renderOperatorSettings(el, opts);
  };

  const ghostModeToggle = el.querySelector("[data-ghost-mode-toggle]");
  if (ghostModeToggle) ghostModeToggle.onchange = () => setGhostModeAndRender(el, opts, ghostModeToggle.checked);
  if (!ghostModeStatus.loaded && !ghostModeStatus.loading) refreshGhostMode(el, opts);

  el.querySelectorAll("[data-loop-field]").forEach((field) => {
    field.onchange = () => {
      if (field.dataset.loopField === "targetProvider") {
        const nextProvider = LOOP_PROVIDERS.find((provider) => provider.id === field.value) || LOOP_PROVIDERS[0];
        saveLoopAndRender({ targetProvider: nextProvider.id, targetModel: nextProvider.models[0] });
        return;
      }
      saveLoopAndRender({ [field.dataset.loopField]: field.value });
    };
  });

  const costSelect = el.querySelector("[data-loop-cost]");
  if (costSelect) costSelect.onchange = () => saveLoopAndRender({ maxCostPerResponse: costSelect.value ? Number(costSelect.value) : null });

  el.querySelectorAll("[data-loop-adv-field]").forEach((field) => {
    field.onchange = () => {
      const key = field.dataset.loopAdvField;
      const value = key === "maxPasses" || key === "timeoutMs" ? Number(field.value) : field.value;
      saveLoopAndRender(null, { [key]: value });
    };
  });

  el.querySelectorAll("[data-loop-adv-toggle]").forEach((input) => {
    input.onchange = () => saveLoopAndRender(null, { [input.dataset.loopAdvToggle]: input.checked });
  });

  el.querySelectorAll("[data-loop-allowed]").forEach((input) => {
    input.onchange = () => {
      const id = input.dataset.loopAllowed;
      const set = new Set(loop.advanced.allowedProviders);
      if (input.checked) set.add(id); else set.delete(id);
      saveLoopAndRender(null, { allowedProviders: [...set] });
    };
  });

  const mediaMount = el.querySelector(`#${mediaMountId}`);
  if (mediaMount) {
    const connectionOverview = configuredConnectionOverview(settings);
    renderConnectionCenter(mediaMount, {
      ...opts,
      ...connectionOverview,
      onOpenSettingsTab: (tab) => {
        saveSettingsTab(tab);
        renderOperatorSettings(el, opts);
      },
    });
  }

  const clientSetupMount = el.querySelector(`#${clientSetupMountId}`);
  if (clientSetupMount) renderClientSetupConsole(clientSetupMount);

  const workspaceMount = el.querySelector(`#${workspaceMountId}`);
  if (workspaceMount) {
    renderCustomizationStudio(workspaceMount, {
      ...opts,
      onApplied: (config) => {
        if (typeof opts.onWorkspaceApplied === "function") {
          opts.onWorkspaceApplied(config);
        }
      },
    });
  }

  const modulesMount = el.querySelector(`#${modulesMountId}`);
  if (modulesMount) renderWorkspaceModulesTab(modulesMount, opts);

  const organizationMount = el.querySelector(`#${organizationMountId}`);
  if (organizationMount) renderOrganizationPanel(organizationMount, opts);

  const planMount = el.querySelector(`#${planMountId}`);
  if (planMount) renderPlanAccessTab(planMount, opts);

  if (activeTab === "model" && settings.selectedProviders.includes("local") && !localModelStatus.loaded && !localModelStatus.loading) {
    refreshLocalModels(el, opts);
  }
  const runtime = getAiRuntimeState();
  if (activeTab === "model" && !runtime.loaded && !runtime.loading) {
    void hydrateOperatorRuntimeSettings()
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
  }
  if (activeTab === "model" && runtime.loaded && !runtime.usage.loaded && !runtime.usage.loading) {
    void loadAiRuntimeUsage()
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
  }
  const openRouterCatalogue = getAiProviderModelCatalog("openrouter_glm");
  const openRouterConfigured = Boolean(runtime.providerCredentials?.openrouter_glm?.configured);
  if (activeTab === "model" && openRouterConfigured && !openRouterCatalogue.loaded && !openRouterCatalogue.loading) {
    void loadAiProviderModels("openrouter_glm")
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
  }
  if ((activeTab === "bridge" || activeTab === "media")
      && ((!agentAssistBridgeStatus.loaded && !agentAssistBridgeStatus.loading)
        || (!higgsfieldBridgeStatus.loaded && !higgsfieldBridgeStatus.loading))) {
    void refreshBridgeStatuses(el, opts);
  }
  if (activeTab === "media" && !runtime.loaded && !runtime.loading) {
    void hydrateOperatorRuntimeSettings()
      .then(() => { if (el.isConnected) renderOperatorSettings(el, opts); })
      .catch(() => { if (el.isConnected) renderOperatorSettings(el, opts); });
  }
}
