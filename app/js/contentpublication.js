import { currentTenantId, session } from "./store.js?v=phantom-live-20260723-53";

function authHeaders() {
  const token = session.token();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function persistContentPublication(draft) {
  const status = draft.status === "scheduled"
    ? "scheduled"
    : ["posted", "manual-posted"].includes(draft.status)
      ? "manual_record"
      : "draft";
  const response = await fetch("/api/content-publications", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      idempotency_key: draft.id,
      status,
      channels: draft.platforms,
      caption: draft.caption,
      source_asset_id: String(draft.sourceKey || "").startsWith("asset:") ? String(draft.sourceKey).slice(6) : "",
      thumbnail_asset_id: String(draft.thumbnailKey || "").startsWith("asset:") ? String(draft.thumbnailKey).slice(6) : "",
      post_type: draft.postType || "auto",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      scheduled_for: status === "scheduled" ? draft.scheduledFor : "",
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `publication_http_${response.status}`);
  return payload.publication;
}
