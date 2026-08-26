import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { redactSensitiveText } from "./hermes-ledger.js";

const DEFAULT_HERMES_API_URL = "http://127.0.0.1:8642";
const DEFAULT_TIMEOUT_MS = 20_000;
const CHAT_TIMEOUT_MS = 300_000;
const INVENTORY_CACHE_MS = 60_000;

type FetchLike = typeof fetch;

type HermesRequestOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  acceptedStatuses?: number[];
};

export type HermesBackendModel = {
  id: string;
  label: string;
  featured: boolean;
  reasoning: boolean;
  can_disable_reasoning: boolean;
  fast: boolean;
};

export type HermesBackendProvider = {
  id: string;
  name: string;
  active: boolean;
  authenticated: boolean;
  source: string;
  total_models: number;
  models: HermesBackendModel[];
};

export type HermesBackendToolset = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
};

export type HermesBackendInventory = {
  online: boolean;
  platform: string;
  version: string;
  current_provider: string;
  current_model: string;
  providers: HermesBackendProvider[];
  toolsets: HermesBackendToolset[];
  tools_available: number;
  skills: { count: number; names: string[] };
  features: string[];
  refreshed_at: string;
  secret_returned: false;
  error?: string;
};

export type HermesBackendChatInput = {
  tenantId: string;
  actorId: string;
  taskId: string;
  prompt: string;
  providerId?: string;
  modelId?: string;
  effort?: "instant" | "reasoning" | "deep";
};

export type HermesBackendChatResult = {
  session_id: string;
  say: string;
  runtime: Record<string, unknown>;
  usage: Record<string, unknown>;
  provider_id: string;
  model_id: string;
  source: "hermes_backend";
  secret_returned: false;
};

export type HermesBackendStreamEvent = {
  event: "run.started" | "reasoning" | "assistant.delta" | "tool.started" | "tool.completed" | "tool.failed" | "assistant.completed" | "run.completed" | "error" | "done";
  data: Record<string, unknown>;
};

type HermesPreparedChat = {
  sessionId: string;
  provider: HermesBackendProvider | null;
  modelId: string;
  selectedRuntime: Record<string, unknown>;
  inventory: HermesBackendInventory;
};

let cachedInventory: { expiresAt: number; value: HermesBackendInventory } | null = null;

function clean(value: unknown, max = 240) {
  return redactSensitiveText(String(value ?? "").replace(/[\r\n\u0000]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, max);
}

function modelLabel(modelId: string) {
  const tail = modelId.split("/").pop() || modelId;
  return tail
    .replace(/[-_]+/g, " ")
    .replace(/\bglm\b/i, "GLM")
    .replace(/\bgpt\b/i, "GPT")
    .replace(/\bai\b/i, "AI")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function envFileCandidates(env: NodeJS.ProcessEnv) {
  const configured = env.PHANTOMBOT_HERMES_ENV_PATH?.trim();
  const localAppData = env.LOCALAPPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim() || env.HOME?.trim();
  return [
    configured,
    localAppData ? join(localAppData, "hermes", ".env") : "",
    userProfile ? join(userProfile, ".hermes", ".env") : "",
  ].filter((value): value is string => Boolean(value));
}

function parseEnvValue(source: string, key: string) {
  const line = source.split(/\r?\n/u).find((candidate) => candidate.trimStart().startsWith(`${key}=`));
  if (!line) return "";
  const raw = line.slice(line.indexOf("=") + 1).trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

async function hermesApiKey(env: NodeJS.ProcessEnv) {
  const configured = env.PHANTOMBOT_HERMES_API_KEY?.trim() || env.HERMES_API_SERVER_KEY?.trim();
  if (configured) return configured;
  for (const candidate of envFileCandidates(env)) {
    try {
      const value = parseEnvValue(await readFile(resolve(candidate), "utf8"), "API_SERVER_KEY");
      if (value) return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
  }
  return "";
}

function hermesBaseUrl(env: NodeJS.ProcessEnv) {
  const raw = env.PHANTOMBOT_HERMES_API_URL?.trim() || DEFAULT_HERMES_API_URL;
  const parsed = new URL(raw);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  const remoteHttpsAllowed = env.PHANTOMBOT_HERMES_ALLOW_REMOTE_HTTPS === "true" && parsed.protocol === "https:";
  if (!loopback && !remoteHttpsAllowed) {
    throw new Error("Hermes backend URL must be loopback or an explicitly allowed HTTPS endpoint.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Hermes backend URL is invalid.");
  return parsed.toString().replace(/\/+$/u, "");
}

async function hermesRequest(path: string, options: HermesRequestOptions = {}) {
  const env = options.env ?? process.env;
  const apiKey = await hermesApiKey(env);
  if (!apiKey) throw new Error("Hermes API authentication is not configured on this host.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${hermesBaseUrl(env)}${path}`, {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok && !(options.acceptedStatuses ?? []).includes(response.status)) {
      const nested = payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>).message
        : payload.error;
      throw Object.assign(new Error(clean(nested || `Hermes backend request failed (${response.status}).`, 500)), { status: response.status });
    }
    return { status: response.status, payload };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("Hermes backend did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeProvider(raw: unknown): HermesBackendProvider | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id = clean(source.slug || source.id, 80).toLowerCase();
  if (!id) return null;
  const models = Array.isArray(source.models)
    ? source.models.map((value) => clean(value, 160)).filter(Boolean)
    : [];
  const capabilities = source.capabilities && typeof source.capabilities === "object"
    ? source.capabilities as Record<string, Record<string, unknown>>
    : {};
  const featured = new Set(Array.isArray(source.featured_models)
    ? source.featured_models.map((value) => clean(value, 160)).filter(Boolean)
    : []);
  return {
    id,
    name: clean(source.name || id, 100),
    active: Boolean(source.is_current),
    authenticated: Boolean(source.authenticated),
    source: clean(source.source || "Hermes", 80),
    total_models: Number.isFinite(Number(source.total_models)) ? Number(source.total_models) : models.length,
    models: models.map((model) => ({
      id: model,
      label: modelLabel(model),
      featured: featured.has(model),
      reasoning: Boolean(capabilities[model]?.reasoning),
      can_disable_reasoning: Boolean(capabilities[model]?.can_disable_reasoning),
      fast: Boolean(capabilities[model]?.fast),
    })),
  };
}

function normalizeToolset(raw: unknown): HermesBackendToolset | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id = clean(source.name || source.id, 80).toLowerCase();
  if (!id) return null;
  return {
    id,
    label: clean(source.label || id, 120),
    description: clean(source.description, 240),
    enabled: Boolean(source.enabled),
    configured: Boolean(source.configured),
    tools: Array.isArray(source.tools) ? source.tools.map((value) => clean(value, 100)).filter(Boolean) : [],
  };
}

export async function getHermesBackendInventory(options: { force?: boolean; env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike } = {}): Promise<HermesBackendInventory> {
  if (!options.force && !options.env && !options.fetchImpl && cachedInventory && cachedInventory.expiresAt > Date.now()) {
    return structuredClone(cachedInventory.value);
  }
  const requestOptions = { env: options.env, fetchImpl: options.fetchImpl };
  try {
    const [health, modelOptions, toolsets, skills, capabilities] = await Promise.all([
      hermesRequest("/health", requestOptions),
      hermesRequest(`/api/model/options${options.force ? "?refresh=true" : ""}`, requestOptions),
      hermesRequest("/v1/toolsets", requestOptions),
      hermesRequest("/v1/skills", requestOptions),
      hermesRequest("/v1/capabilities", requestOptions),
    ]);
    const rawProviders = Array.isArray(modelOptions.payload.providers) ? modelOptions.payload.providers : [];
    const providers = rawProviders.map(normalizeProvider).filter((value): value is HermesBackendProvider => Boolean(value));
    providers.sort((left, right) => Number(right.authenticated) - Number(left.authenticated) || Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
    const rawToolsets = Array.isArray(toolsets.payload.data) ? toolsets.payload.data : [];
    const normalizedToolsets = rawToolsets.map(normalizeToolset).filter((value): value is HermesBackendToolset => Boolean(value));
    normalizedToolsets.sort((left, right) => Number(right.enabled && right.configured) - Number(left.enabled && left.configured) || left.label.localeCompare(right.label));
    const rawSkills = Array.isArray(skills.payload.data) ? skills.payload.data : [];
    const features = capabilities.payload.features && typeof capabilities.payload.features === "object"
      ? Object.entries(capabilities.payload.features as Record<string, unknown>).filter(([, enabled]) => enabled === true).map(([name]) => name)
      : [];
    const inventory: HermesBackendInventory = {
      online: true,
      platform: clean(health.payload.platform || capabilities.payload.platform || "hermes-agent", 80),
      version: clean(health.payload.version, 80),
      current_provider: clean(modelOptions.payload.provider, 80),
      current_model: clean(modelOptions.payload.model, 160),
      providers,
      toolsets: normalizedToolsets,
      tools_available: new Set(normalizedToolsets.filter((item) => item.enabled && item.configured).flatMap((item) => item.tools)).size,
      skills: {
        count: rawSkills.length,
        names: rawSkills.map((item) => clean((item as Record<string, unknown>)?.name, 100)).filter(Boolean).slice(0, 120),
      },
      features,
      refreshed_at: new Date().toISOString(),
      secret_returned: false,
    };
    if (!options.env && !options.fetchImpl) cachedInventory = { expiresAt: Date.now() + INVENTORY_CACHE_MS, value: inventory };
    return structuredClone(inventory);
  } catch (error) {
    return {
      online: false,
      platform: "hermes-agent",
      version: "",
      current_provider: "",
      current_model: "",
      providers: [],
      toolsets: [],
      tools_available: 0,
      skills: { count: 0, names: [] },
      features: [],
      refreshed_at: new Date().toISOString(),
      secret_returned: false,
      error: clean(error instanceof Error ? error.message : "Hermes backend is unavailable.", 500),
    };
  }
}

function stableSessionId(input: HermesBackendChatInput) {
  const fingerprint = [input.tenantId, input.actorId, input.taskId].map((value) => clean(value, 160)).join("\u001f");
  return `phantombot_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}`;
}

function modelOptions(effort: HermesBackendChatInput["effort"]) {
  if (effort === "instant") return { reasoning: { enabled: true, effort: "low" } };
  if (effort === "deep") return { reasoning: { enabled: true, effort: "high" } };
  return { reasoning: { enabled: true, effort: "medium" } };
}

async function prepareHermesBackendChat(input: HermesBackendChatInput, options: { env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike } = {}): Promise<HermesPreparedChat> {
  const prompt = String(input.prompt ?? "").replace(/\u0000/g, "").trim();
  if (!prompt) throw Object.assign(new Error("A PhantomBot prompt is required."), { status: 400 });
  const inventory = await getHermesBackendInventory({ env: options.env, fetchImpl: options.fetchImpl });
  if (!inventory.online) throw Object.assign(new Error(inventory.error || "Hermes backend is unavailable."), { status: 503 });

  const providerId = clean(input.providerId, 80).toLowerCase();
  const modelId = clean(input.modelId, 160);
  const provider = providerId ? inventory.providers.find((item) => item.id === providerId && item.authenticated) ?? null : null;
  if ((providerId || modelId) && (!provider || !modelId || !provider.models.some((model) => model.id === modelId))) {
    throw Object.assign(new Error("That model is not available through the active Hermes backend."), { status: 409 });
  }

  const sessionId = stableSessionId(input);
  const selectedRuntime = provider && modelId ? {
    provider: provider.id,
    model: modelId,
    require_model_lock: true,
    model_options: modelOptions(input.effort),
  } : {};
  const create = await hermesRequest("/api/sessions", {
    ...options,
    method: "POST",
    acceptedStatuses: [409],
    body: {
      id: sessionId,
      source: "phantomforce_phantombot",
      title: `PhantomBot ${sessionId.slice(-16)}`,
      system_prompt: "You are PhantomBot, the PhantomForce interface to this Hermes backend. Use Hermes memory, skills, tools, web access, browser, files, terminal, and delegation when useful and configured. Be direct, truthful, and outcome focused. Preserve Hermes approval gates for consequential actions.",
      ...selectedRuntime,
    },
  });
  if (create.status === 409 && provider && modelId) {
    await hermesRequest(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
      ...options,
      method: "POST",
      body: selectedRuntime,
    });
  }
  return { sessionId, provider, modelId, selectedRuntime, inventory };
}

function safeRuntime(value: unknown) {
  const runtime = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    provider: clean(runtime.provider, 80),
    model: clean(runtime.model, 160),
    model_lock: clean(runtime.model_lock, 40),
    route_source: clean(runtime.route_source, 80),
  };
}

function safeUsage(value: unknown) {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const allowed = ["input_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "api_calls", "cost_usd"];
  return Object.fromEntries(allowed.flatMap((key) => {
    const amount = Number(usage[key]);
    return Number.isFinite(amount) && amount >= 0 ? [[key, amount]] : [];
  }));
}

function normalizeHermesStreamEvent(event: string, payload: Record<string, unknown>): HermesBackendStreamEvent | null {
  const base = {
    session_id: clean(payload.session_id, 180),
    run_id: clean(payload.run_id, 180),
    seq: Number.isFinite(Number(payload.seq)) ? Number(payload.seq) : 0,
  };
  if (event === "run.started") return { event, data: { ...base, runtime: safeRuntime(payload.runtime) } };
  if (event === "tool.progress") return { event: "reasoning", data: { ...base, stage: "Hermes reasoning" } };
  if (event === "assistant.delta") {
    const delta = String(payload.delta ?? "").slice(0, 64_000);
    return delta ? { event, data: { ...base, delta } } : null;
  }
  if (event === "tool.started" || event === "tool.completed" || event === "tool.failed") {
    return {
      event,
      data: {
        ...base,
        tool_name: clean(payload.tool_name || "Hermes tool", 100),
        preview: clean(payload.preview || (event === "tool.started" ? "Running" : event === "tool.completed" ? "Complete" : "Failed"), 220),
      },
    };
  }
  if (event === "assistant.completed") {
    return {
      event,
      data: {
        ...base,
        content: redactSensitiveText(String(payload.content ?? "")).slice(0, 128_000),
        runtime: safeRuntime(payload.runtime),
        interrupted: Boolean(payload.interrupted),
      },
    };
  }
  if (event === "run.completed") {
    return {
      event,
      data: {
        ...base,
        usage: safeUsage(payload.usage),
        runtime: safeRuntime(payload.runtime),
        pending_steer: clean(payload.pending_steer, 500),
      },
    };
  }
  if (event === "error") return { event, data: { ...base, message: clean(payload.message || "Hermes could not complete this run.", 500) } };
  if (event === "done") return { event, data: base };
  return null;
}

function parseSseFrame(frame: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    const payload = JSON.parse(data.join("\n")) as Record<string, unknown>;
    return normalizeHermesStreamEvent(event, payload);
  } catch {
    return null;
  }
}

export async function runHermesBackendChatStream(
  input: HermesBackendChatInput,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    onEvent: (event: HermesBackendStreamEvent) => void | Promise<void>;
  },
) {
  const prepared = await prepareHermesBackendChat(input, options);
  const env = options.env ?? process.env;
  const apiKey = await hermesApiKey(env);
  if (!apiKey) throw new Error("Hermes API authentication is not configured on this host.");
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CHAT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${hermesBaseUrl(env)}/api/sessions/${encodeURIComponent(prepared.sessionId)}/chat/stream`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        message: String(input.prompt ?? "").replace(/\u0000/g, "").trim(),
        instructions: "Answer as PhantomBot through the active Hermes runtime. Use the available Hermes tools when they materially improve the result.",
        ...prepared.selectedRuntime,
      }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const nested = payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>).message
        : payload.error;
      throw Object.assign(new Error(clean(nested || `Hermes backend stream failed (${response.status}).`, 500)), { status: response.status || 502 });
    }
    let buffer = "";
    let assistantSafetyBuffer = "";
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const forward = async (normalized: HermesBackendStreamEvent) => {
      if (normalized.event === "assistant.delta") {
        assistantSafetyBuffer += String(normalized.data.delta ?? "");
        const safeWindow = Math.max(0, assistantSafetyBuffer.length - 128);
        const boundary = assistantSafetyBuffer.slice(0, safeWindow).search(/\s(?=[^\s]*$)/u);
        if (boundary >= 0) {
          const chunk = assistantSafetyBuffer.slice(0, boundary + 1);
          assistantSafetyBuffer = assistantSafetyBuffer.slice(boundary + 1);
          await options.onEvent({ ...normalized, data: { ...normalized.data, delta: redactSensitiveText(chunk) } });
        }
        return;
      }
      if (assistantSafetyBuffer && (normalized.event === "assistant.completed" || normalized.event === "run.completed" || normalized.event === "error" || normalized.event === "done")) {
        await options.onEvent({
          event: "assistant.delta",
          data: { ...normalized.data, delta: redactSensitiveText(assistantSafetyBuffer) },
        });
        assistantSafetyBuffer = "";
      }
      await options.onEvent(normalized);
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/u);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const separator = /^\r\n/u.test(buffer.slice(boundary)) ? 4 : 2;
        buffer = buffer.slice(boundary + separator);
        const normalized = parseSseFrame(frame);
        if (normalized) await forward(normalized);
        boundary = buffer.search(/\r?\n\r?\n/u);
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const normalized = parseSseFrame(buffer);
      if (normalized) await forward(normalized);
    }
    if (assistantSafetyBuffer) {
      await options.onEvent({ event: "assistant.delta", data: { delta: redactSensitiveText(assistantSafetyBuffer) } });
    }
    return {
      session_id: prepared.sessionId,
      provider_id: prepared.provider?.id || prepared.inventory.current_provider,
      model_id: prepared.modelId || prepared.inventory.current_model,
      source: "hermes_backend" as const,
      secret_returned: false as const,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      if (options.signal?.aborted && !timedOut) throw Object.assign(new Error("Hermes response was stopped."), { status: 499, code: "ABORT_ERR" });
      throw Object.assign(new Error("Hermes backend did not respond in time."), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function runHermesBackendChat(input: HermesBackendChatInput, options: { env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike } = {}): Promise<HermesBackendChatResult> {
  const prompt = String(input.prompt ?? "").replace(/\u0000/g, "").trim();
  const prepared = await prepareHermesBackendChat(input, options);

  const completion = await hermesRequest(`/api/sessions/${encodeURIComponent(prepared.sessionId)}/chat`, {
    ...options,
    timeoutMs: CHAT_TIMEOUT_MS,
    method: "POST",
    body: {
      message: prompt,
      instructions: "Answer as PhantomBot through the active Hermes runtime. Use the available Hermes tools when they materially improve the result.",
      ...prepared.selectedRuntime,
    },
  });
  const message = completion.payload.message && typeof completion.payload.message === "object"
    ? completion.payload.message as Record<string, unknown>
    : {};
  const runtime = completion.payload.runtime && typeof completion.payload.runtime === "object"
    ? completion.payload.runtime as Record<string, unknown>
    : {};
  const usage = completion.payload.usage && typeof completion.payload.usage === "object"
    ? completion.payload.usage as Record<string, unknown>
    : {};
  const say = String(message.content ?? "").trim();
  if (!say) throw Object.assign(new Error("Hermes completed without a usable response."), { status: 502 });
  return {
    session_id: clean(completion.payload.session_id || prepared.sessionId, 180),
    say,
    runtime,
    usage,
    provider_id: clean(runtime.provider || prepared.provider?.id || prepared.inventory.current_provider, 80),
    model_id: clean(runtime.model || prepared.modelId || prepared.inventory.current_model, 160),
    source: "hermes_backend",
    secret_returned: false,
  };
}

export function resetHermesBackendInventoryCache() {
  cachedInventory = null;
}
