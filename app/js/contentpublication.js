import { currentTenantId, session } from "./store.js?v=phantom-live-20260914-231";

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
    : draft.status === "approval" || draft.status === "live"
      ? "approval_required"
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
      source_asset_id: draft.serverSourceAssetId || (String(draft.sourceKey || "").startsWith("asset:") ? String(draft.sourceKey).slice(6) : ""),
      thumbnail_asset_id: draft.serverThumbnailAssetId || (String(draft.thumbnailKey || "").startsWith("asset:") ? String(draft.thumbnailKey).slice(6) : ""),
      post_type: draft.postType || "auto",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      scheduled_for: status === "scheduled" ? draft.scheduledFor : "",
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `publication_http_${response.status}`);
  return payload.publication;
}

export async function fetchContentPublishingStatus() {
  const response = await fetch(`/api/connections/status?tenant_id=${encodeURIComponent(currentTenantId())}`, {
    headers: authHeaders(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `publishing_status_http_${response.status}`);
  return payload.social_publishing || {
    state: "configuration_required",
    publishReady: false,
    trackingReady: false,
    reason: "Social publishing status is unavailable.",
  };
}

export async function listContentPublications() {
  const response = await fetch(`/api/content-publications?tenant_id=${encodeURIComponent(currentTenantId())}`, {
    headers: authHeaders(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `publication_list_http_${response.status}`);
  return Array.isArray(payload.publications) ? payload.publications : [];
}

export async function approveAndSubmitContentPublication(draft) {
  const publication = await persistContentPublication({ ...draft, status: "approval" });
  const response = await fetch(`/api/content-publications/${encodeURIComponent(publication.id)}/approve`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      approval_id: `live-post:${draft.id}`,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.connector?.reason || payload?.error || `publication_approval_http_${response.status}`);
    error.publication = payload?.publication || publication;
    throw error;
  }
  return payload;
}
