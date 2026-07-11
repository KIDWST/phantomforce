import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

export type AdminProviderId = "codex_cli" | "claude_cli" | "openrouter_glm" | "local_ollama";
export type AdminProviderAvailability = "unknown" | "online" | "offline" | "checking";
export type AdminProviderQuota = "unknown" | "available" | "exhausted";

export type AdminProviderState = {
  provider_id: AdminProviderId;
  status: AdminProviderAvailability;
  preferred: boolean;
  availability: boolean;
  quota: AdminProviderQuota;
  latency_ms: number | null;
  last_health_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  detail: string;
};

const execFileAsync = promisify(execFile);
const PROVIDER_PRIORITY: AdminProviderId[] = ["codex_cli", "claude_cli", "openrouter_glm", "local_ollama"];
const DEFAULT_CLAUDE_PS1 = "C:\\Users\\jorda\\AppData\\Local\\hermes\\node\\claude.ps1";

function initialState(providerId: AdminProviderId): AdminProviderState {
  return {
    provider_id: providerId,
    status: "unknown",
    preferred: providerId === PROVIDER_PRIORITY[0],
    availability: true,
    quota: "unknown",
    latency_ms: null,
    last_health_at: null,
    last_success_at: null,
    last_failure_at: null,
    consecutive_failures: 0,
    detail: "Waiting for first health check.",
  };
}

const registry = new Map<AdminProviderId, AdminProviderState>(
  PROVIDER_PRIORITY.map((providerId) => [providerId, initialState(providerId)]),
);
let activeProviderId: AdminProviderId = PROVIDER_PRIORITY[0];
let monitorTimer: NodeJS.Timeout | null = null;
let sweepRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function safeDetail(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function quotaFromFailure(detail: string): AdminProviderQuota {
  return /usage limit|quota|insufficient credits|rate limit|too many requests|429/i.test(detail) ? "exhausted" : "unknown";
}

function setPreferred(providerId: AdminProviderId) {
  for (const [id, state] of registry.entries()) state.preferred = id === providerId;
}

export function setPreferredAdminProvider(providerId: AdminProviderId) {
  setPreferred(providerId);
}

export function adminProviderAttemptOrder(primaryProviderId: AdminProviderId) {
  setPreferred(primaryProviderId);
  const primary = registry.get(primaryProviderId)!;
  const active = registry.get(activeProviderId)!;
  const candidates = primary.status === "offline" && active.status !== "offline"
    ? [activeProviderId, primaryProviderId, ...PROVIDER_PRIORITY]
    : [primaryProviderId, activeProviderId, ...PROVIDER_PRIORITY];
  const unique = [...new Set(candidates)];
  const available = unique.filter((providerId) => registry.get(providerId)?.status !== "offline");
  return available.length ? available : [activeProviderId];
}

export function recordAdminProviderSuccess(providerId: AdminProviderId, latencyMs: number | null = null) {
  const state = registry.get(providerId)!;
  const at = nowIso();
  Object.assign(state, {
    status: "online" as const,
    availability: true,
    quota: "available" as const,
    latency_ms: latencyMs,
    last_health_at: at,
    last_success_at: at,
    consecutive_failures: 0,
    detail: "Ready.",
  });
  activeProviderId = providerId;
}

export function recordAdminProviderFailure(providerId: AdminProviderId, reason: unknown, latencyMs: number | null = null) {
  const state = registry.get(providerId)!;
  const at = nowIso();
  const detail = safeDetail(reason) || "Provider did not return a usable response.";
  Object.assign(state, {
    status: "offline" as const,
    availability: false,
    quota: quotaFromFailure(detail),
    latency_ms: latencyMs,
    last_health_at: at,
    last_failure_at: at,
    consecutive_failures: state.consecutive_failures + 1,
    detail,
  });
  if (activeProviderId === providerId) {
    activeProviderId = PROVIDER_PRIORITY.find((id) => registry.get(id)?.status !== "offline") ?? "local_ollama";
  }
}

async function timedCheck(run: () => Promise<boolean>, onlineDetail: string) {
  const startedAt = Date.now();
  try {
    const online = await run();
    return { online, latencyMs: Date.now() - startedAt, detail: online ? onlineDetail : "Health check did not pass." };
  } catch (error) {
    return { online: false, latencyMs: Date.now() - startedAt, detail: safeDetail(error instanceof Error ? error.message : error) };
  }
}

async function fetchHealth(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response.ok;
  } finally {
    clearTimeout(timer);
  }
}

async function checkProvider(providerId: AdminProviderId) {
  if (providerId === "codex_cli") {
    return timedCheck(async () => {
      await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "codex login status"], {
        timeout: 5000,
        windowsHide: true,
      });
      return true;
    }, "CLI and login are available.");
  }
  if (providerId === "claude_cli") {
    const command = process.env.PHANTOM_CLAUDE_CLI_COMMAND?.trim();
    if (!command && process.platform === "win32" && existsSync(DEFAULT_CLAUDE_PS1)) {
      return { online: true, latencyMs: 0, detail: "Local CLI is available." };
    }
    return timedCheck(async () => {
      await execFileAsync(command || "claude", ["--version"], { timeout: 5000, windowsHide: true });
      return true;
    }, "CLI is available.");
  }
  if (providerId === "openrouter_glm") {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key || process.env.PHANTOM_FORCE_OPENROUTER_GLM !== "true") {
      return { online: false, latencyMs: 0, detail: "Cloud route is not configured." };
    }
    return timedCheck(
      () => fetchHealth("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${key}` } }),
      "Cloud route is reachable.",
    );
  }
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  return timedCheck(() => fetchHealth(`${baseUrl.replace(/\/$/, "")}/api/tags`), "Local model service is reachable.");
}

export async function runAdminProviderHealthSweep() {
  if (sweepRunning) return getAdminProviderManagerStatus();
  sweepRunning = true;
  try {
    for (const providerId of PROVIDER_PRIORITY) {
      const state = registry.get(providerId)!;
      const lastFailureMs = state.last_failure_at ? Date.parse(state.last_failure_at) : 0;
      if (state.quota === "exhausted" && Date.now() - lastFailureMs < quotaRecheckMs()) {
        state.last_health_at = nowIso();
        state.detail = "Quota cooldown active; staying on the current healthy provider.";
        continue;
      }
      state.status = "checking";
      const result = await checkProvider(providerId);
      if (result.online) recordAdminProviderSuccess(providerId, result.latencyMs);
      else recordAdminProviderFailure(providerId, result.detail, result.latencyMs);
    }
    const preferred = PROVIDER_PRIORITY.find((id) => registry.get(id)?.preferred) ?? PROVIDER_PRIORITY[0];
    const best = registry.get(preferred)?.status === "online"
      ? preferred
      : PROVIDER_PRIORITY.find((id) => registry.get(id)?.status === "online");
    if (best) activeProviderId = best;
    return getAdminProviderManagerStatus();
  } finally {
    sweepRunning = false;
  }
}

export function getAdminProviderManagerStatus() {
  return {
    active_provider_id: activeProviderId,
    preferred_provider_id: PROVIDER_PRIORITY.find((id) => registry.get(id)?.preferred) ?? PROVIDER_PRIORITY[0],
    health_interval_ms: providerHealthIntervalMs(),
    background_monitor_running: monitorTimer !== null,
    providers: PROVIDER_PRIORITY.map((providerId) => ({ ...registry.get(providerId)! })),
  };
}

function providerHealthIntervalMs() {
  const configured = Number(process.env.PHANTOM_ADMIN_PROVIDER_HEALTH_MS ?? 30000);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 15000), 300000) : 30000;
}

function quotaRecheckMs() {
  const configured = Number(process.env.PHANTOM_ADMIN_PROVIDER_QUOTA_RECHECK_MS ?? 1800000);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 300000), 86400000) : 1800000;
}

export function startAdminProviderHealthMonitor(logger?: { info: (message: string) => void }) {
  if (monitorTimer) return () => stopAdminProviderHealthMonitor();
  void runAdminProviderHealthSweep();
  monitorTimer = setInterval(() => void runAdminProviderHealthSweep(), providerHealthIntervalMs());
  monitorTimer.unref?.();
  logger?.info("Admin provider health monitor started.");
  return () => stopAdminProviderHealthMonitor();
}

export function stopAdminProviderHealthMonitor() {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}

export const adminProviderManagerInternals = {
  priority: [...PROVIDER_PRIORITY],
  reset() {
    for (const providerId of PROVIDER_PRIORITY) registry.set(providerId, initialState(providerId));
    activeProviderId = PROVIDER_PRIORITY[0];
    stopAdminProviderHealthMonitor();
  },
};
