import { currentTenantId, session } from "./store.js?v=phantom-live-20260723-55";

function headers() {
  const token = session.token();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `media_generation_http_${response.status}`);
  return payload;
}

export async function listMediaJobs({ activeOnly = false } = {}) {
  const query = new URLSearchParams({ tenant_id: currentTenantId(), active: activeOnly ? "true" : "false" });
  const payload = await request(`/api/media-generation/jobs?${query}`);
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

export function listActiveMediaJobs() {
  return listMediaJobs({ activeOnly: true });
}

export async function createMediaJob(input) {
  const payload = await request("/api/media-generation/jobs", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      idempotency_key: input.idempotencyKey,
      modality: input.modality,
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      parameters: input.parameters || {},
      reference_asset_ids: input.referenceAssetIds || [],
    }),
  });
  return payload.job;
}

export async function transitionMediaJob(jobId, status, details = {}) {
  const payload = await request(`/api/media-generation/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      status,
      output_asset_ids: details.outputAssetIds || [],
      error_code: details.errorCode || "",
      error_message: details.errorMessage || "",
    }),
  });
  return payload.job;
}

export async function retryMediaJob(jobId) {
  const payload = await request(`/api/media-generation/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      idempotency_key: `retry-${jobId}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(16).slice(2)}`,
    }),
  });
  return payload.job;
}
