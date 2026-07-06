export type PangolinReadOnlyStatus = {
  provider: "Pangolin";
  readOnly: true;
  configured: boolean;
  status: "unconfigured" | "reachable" | "unreachable";
  checkedAt: string;
  baseUrl?: string;
  healthPath?: string;
  httpStatus?: number;
  latencyMs?: number;
  reason: string;
  liveChangesAllowed: false;
};

function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "");
}

function normalizeHealthPath(value: string | undefined) {
  const path = value?.trim() || "/api/v1";
  return path.startsWith("/") ? path : `/${path}`;
}

export async function checkPangolinReadOnlyStatus(): Promise<PangolinReadOnlyStatus> {
  const baseUrl = normalizeBaseUrl(process.env.PANGOLIN_READONLY_BASE_URL);
  const healthPath = normalizeHealthPath(process.env.PANGOLIN_READONLY_HEALTH_PATH);
  const checkedAt = new Date().toISOString();

  if (!baseUrl) {
    return {
      provider: "Pangolin",
      readOnly: true,
      configured: false,
      status: "unconfigured",
      checkedAt,
      healthPath,
      reason: "Set PANGOLIN_READONLY_BASE_URL to enable live read-only gateway verification.",
      liveChangesAllowed: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}${healthPath}`, {
      method: "GET",
      headers: process.env.PANGOLIN_READONLY_TOKEN
        ? { Authorization: `Bearer ${process.env.PANGOLIN_READONLY_TOKEN}` }
        : undefined,
      signal: controller.signal,
    });

    return {
      provider: "Pangolin",
      readOnly: true,
      configured: true,
      status: response.ok ? "reachable" : "unreachable",
      checkedAt,
      baseUrl,
      healthPath,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      reason: response.ok
        ? "Pangolin read-only endpoint responded."
        : `Pangolin read-only endpoint returned HTTP ${response.status}.`,
      liveChangesAllowed: false,
    };
  } catch (error) {
    return {
      provider: "Pangolin",
      readOnly: true,
      configured: true,
      status: "unreachable",
      checkedAt,
      baseUrl,
      healthPath,
      latencyMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Pangolin read-only endpoint did not respond.",
      liveChangesAllowed: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
