import { session } from "./store.js?v=phantom-live-20260914-229";

const TENANT_ID = "client-chicagoshots";
const MAX_INLINE_FILE_BYTES = 12 * 1024 * 1024;
const CONNECTED = new Set(["CONNECTED", "LIMITED_PERMISSIONS"]);
const thumbUrls = new Map();
let studioRoot = null;
let studioOpts = {};
let studioState = { status: "idle", data: null, error: "", upload: null, uploadCampaignId: "" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function authHeaders(extra = {}) {
  const token = session.token();
  const current = session.get?.();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(current?.sessionId ? { "x-phantomforce-session": current.sessionId } : {}),
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function bytes(value) {
  const size = Number(value || 0);
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function shortDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Review";
}

function statusClass(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function campaignStatusLabel(value) {
  return ({
    planned: "Planned",
    in_progress: "In progress",
    ready_for_review: "In approvals",
    approved: "Approved",
    published: "Published",
  })[value] || "Planned";
}

function campaignAction(deliverable) {
  if (deliverable.status === "planned") return { label: "Start", next: "in_progress", disabled: false };
  if (deliverable.status === "in_progress") return { label: "Send to approvals", next: "ready_for_review", disabled: false };
  if (deliverable.status === "ready_for_review") return { label: "Review in Approvals", next: "", disabled: false, open: "approvals" };
  return { label: deliverable.status === "published" ? "Published" : "Approved", next: "", disabled: true };
}

function notify(message) {
  studioOpts.notify?.("ChicagoShots Studio", message);
}

async function copyCampaignLink(tag, name) {
  const link = `https://chicagoshots.com/?pf_campaign=${encodeURIComponent(tag)}&utm_campaign=${encodeURIComponent(tag)}#contact`;
  try {
    await navigator.clipboard.writeText(link);
    notify(`${name} tracked inquiry link copied. Add the channel source when you publish.`);
  } catch {
    notify(`Copy this tracked link: ${link}`);
  }
}

async function loadStudio(force = false) {
  if (studioState.status === "loading" || (studioState.status === "ready" && !force)) return;
  studioState = { ...studioState, status: "loading", error: "" };
  rerender();
  try {
    const data = await api("/phantom-ai/ops/chicagoshots/studio?limit=12");
    studioState = { ...studioState, status: "ready", data, error: "" };
  } catch (error) {
    studioState = { ...studioState, status: "error", error: error?.message || "ChicagoShots Studio could not load." };
  }
  rerender();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function uploadOne(file, campaignId) {
  const image = await readFileAsDataUrl(file);
  return api("/phantom-ai/content/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: TENANT_ID, campaign_id: campaignId || undefined, image, filename: file.name }),
  });
}

async function uploadBatch(files, campaignId = "") {
  const selected = [...files].filter((file) => /^(image|video|audio)\//.test(file.type));
  if (!selected.length) {
    notify("Choose image, video, or audio files.");
    return;
  }
  const oversized = selected.filter((file) => file.size > MAX_INLINE_FILE_BYTES);
  const queue = selected.filter((file) => file.size <= MAX_INLINE_FILE_BYTES);
  const campaign = (studioState.data?.campaigns || []).find((item) => item.id === campaignId);
  studioState.upload = { total: selected.length, completed: 0, failed: oversized.length, current: "Preparing batch", campaignName: campaign?.name || "General media library" };
  rerender();

  const failures = oversized.map((file) => `${file.name} is over the 12 MB cross-device staging limit`);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const file = queue[cursor++];
      studioState.upload.current = file.name;
      rerender();
      try {
        await uploadOne(file, campaignId);
        studioState.upload.completed += 1;
      } catch (error) {
        studioState.upload.failed += 1;
        failures.push(`${file.name}: ${error?.message || "upload failed"}`);
      }
      rerender();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  const success = studioState.upload.completed;
  studioState.upload = null;
  notify(`${success} file${success === 1 ? "" : "s"} staged in ${campaign?.name || "the general media library"}${failures.length ? `; ${failures.length} need attention` : " with automatic preview thumbnails"}.`);
  if (failures.length) console.warn("[ChicagoShots Studio] Files not staged", failures);
  await loadStudio(true);
}

async function queueReplyDrafts() {
  const button = studioRoot?.querySelector("[data-cs-queue-replies]");
  if (button) button.disabled = true;
  try {
    const payload = await api("/phantom-ai/ops/chicagoshots/reply-drafts/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 8 }),
    });
    notify(`${payload.queued?.length || 0} reply draft${payload.queued?.length === 1 ? "" : "s"} added to Approvals. Nothing was sent.`);
    await loadStudio(true);
  } catch (error) {
    notify(error?.message || "Reply drafts could not be queued.");
    if (button) button.disabled = false;
  }
}

async function refreshLocalLibrary() {
  const button = studioRoot?.querySelector("[data-cs-scan-folder]");
  if (button) button.disabled = true;
  try {
    const payload = await api("/phantom-ai/local-assets/refresh", { method: "POST" });
    notify(`${Number(payload.count || 0).toLocaleString()} full-size files indexed from ${payload.root_label || "the local media folder"}.`);
    await loadStudio(true);
  } catch (error) {
    notify(error?.message || "The local media folder could not be refreshed.");
    if (button) button.disabled = false;
  }
}

async function updateCampaignDeliverable(campaignId, deliverableId, status) {
  const key = `${campaignId}:${deliverableId}`;
  studioState.campaignUpdating = key;
  rerender();
  try {
    const payload = await api(`/phantom-ai/ops/chicagoshots/campaigns/${encodeURIComponent(campaignId)}/deliverables/${encodeURIComponent(deliverableId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    notify(payload.approval_queued
      ? `${payload.deliverable?.name || "Deliverable"} is in Approvals. Nothing was published.`
      : `${payload.deliverable?.name || "Deliverable"} is now ${campaignStatusLabel(payload.deliverable?.status).toLowerCase()}.`);
    studioState.campaignUpdating = "";
    await loadStudio(true);
  } catch (error) {
    studioState.campaignUpdating = "";
    notify(error?.message || "The campaign milestone could not be updated.");
    rerender();
  }
}

async function createCampaign(form) {
  const values = new FormData(form);
  studioState.campaignCreating = true;
  rerender();
  try {
    const payload = await api("/phantom-ai/ops/chicagoshots/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.get("name"),
        template: values.get("template"),
        date_label: values.get("date_label"),
        target_outcome: values.get("target_outcome"),
        channels: values.getAll("channels"),
      }),
    });
    studioState.campaignCreating = false;
    studioState.showCampaignForm = false;
    notify(`${payload.campaign?.name || "Campaign"} is ready with a complete production blueprint. Nothing was published.`);
    await loadStudio(true);
  } catch (error) {
    studioState.campaignCreating = false;
    notify(error?.message || "The campaign could not be created.");
    rerender();
  }
}

async function beginSocialConnection(providerId, providerName) {
  const popup = window.open("about:blank", `phantomforce-social-${providerId}-${Date.now()}`, "popup,width=820,height=860");
  try {
    const payload = await api("/phantom-ai/ops/social-oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: providerId, tenant_id: TENANT_ID }),
    });
    const url = payload?.oauth?.authorizationUrl;
    if (!url) throw new Error(`${providerName} needs its provider app configured first.`);
    if (popup && !popup.closed) {
      popup.opener = null;
      popup.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    notify(`${providerName} sign-in opened. Approve the account once, then refresh Studio.`);
  } catch (error) {
    try { popup?.close(); } catch {}
    notify(error?.message || `${providerName} could not start connecting.`);
  }
}

function heroMarkup(data) {
  const crm = data.crm?.summary || {};
  return `
    <section class="cs-hero">
      <div class="cs-hero-copy">
        <p class="cs-eyebrow">PHANTOMFORCE × CHICAGOSHOTS</p>
        <h2>One studio. Every growth lane.</h2>
        <p>Bring footage in once, package it for every channel, keep every lead moving, and hold the final send behind your approval.</p>
        <div class="cs-hero-actions">
          <button type="button" class="cs-button cs-button-primary" data-cs-upload-open>Upload a batch</button>
          <button type="button" class="cs-button" data-open-ws="content">Build social posts</button>
          <a class="cs-button" href="https://chicagoshots.com" target="_blank" rel="noreferrer">Open live site</a>
        </div>
      </div>
      <div class="cs-command-score" aria-label="ChicagoShots command score">
        <span>ACTIVE PIPELINE</span>
        <b>${money(crm.open_pipeline_value)}</b>
        <i>${Number(crm.contacts_total || 0).toLocaleString()} tracked contacts · ${Number(data.socials?.connected || 0)} socials live</i>
      </div>
    </section>`;
}

function runwayMarkup() {
  return `
    <section class="cs-runway" aria-label="Production runway">
      <article><span>SEP 26</span><div><b>Wedding production</b><i>Capture plan · backup audio · delivery map</i></div><em>BOOKED</em></article>
      <article><span>OCT</span><div><b>Doctor-hosted conference</b><i>Speaker coverage · interviews · expert cutdowns</i></div><em>BOOKED</em></article>
      <article><span>ONGOING</span><div><b>Menopause podcast</b><i>Episodes · clips · thumbnails · distribution</i></div><em>CONTENT ENGINE</em></article>
    </section>`;
}

function campaignMarkup(data) {
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const channelOptions = ["Instagram", "TikTok", "YouTube", "Facebook", "LinkedIn", "Podcast", "Website"];
  return `
    <section class="cs-campaign-engine" aria-labelledby="cs-campaign-title">
      <header class="cs-campaign-head">
        <div><p class="cs-eyebrow">GROWTH CAMPAIGNS</p><h3 id="cs-campaign-title">Every shoot becomes a revenue system.</h3></div>
        <div><b>${campaigns.length}</b><span>active campaign engines</span><button type="button" data-cs-new-campaign>${studioState.showCampaignForm ? "Close builder" : "New campaign"}</button></div>
      </header>
      ${studioState.showCampaignForm ? `<form class="cs-campaign-builder" data-cs-campaign-form>
        <header><div><span>NEW CAMPAIGN ENGINE</span><h4>Choose the lane. PhantomForce builds the operating plan.</h4></div><button type="button" data-cs-cancel-campaign aria-label="Close campaign builder">×</button></header>
        <div class="cs-campaign-form-grid">
          <label><span>Campaign name *</span><input name="name" required minlength="3" maxlength="120" placeholder="Example: Fall Sports Recruitment Push"></label>
          <label><span>Campaign blueprint *</span><select name="template" required><option value="wedding">Wedding + milestone</option><option value="conference">Conference + expert media</option><option value="podcast">Podcast + expert series</option><option value="sports">Sports + athletes</option><option value="brand">Brand + business content</option><option value="custom">Custom campaign</option></select></label>
          <label><span>Date or timing</span><input name="date_label" maxlength="80" placeholder="November 2026 or Ongoing"></label>
          <label class="is-wide"><span>Business outcome *</span><textarea name="target_outcome" required minlength="10" maxlength="320" rows="3" placeholder="What should this media make happen for the client?"></textarea></label>
        </div>
        <fieldset><legend>Channel override <i>Optional—leave blank for blueprint recommendations</i></legend><div>${channelOptions.map((channel) => `<label><input type="checkbox" name="channels" value="${channel}"><span>${channel}</span></label>`).join("")}</div></fieldset>
        <footer><span>Creates an internal plan only. No post, email, or CRM message is sent.</span><button class="cs-button cs-button-primary" type="submit" ${studioState.campaignCreating ? "disabled" : ""}>${studioState.campaignCreating ? "Building…" : "Create campaign engine"}</button></footer>
      </form>` : ""}
      <div class="cs-campaign-grid">
        ${campaigns.map((campaign) => {
          const deliverables = Array.isArray(campaign.deliverables) ? campaign.deliverables : [];
          const reviewReady = deliverables.filter((item) => ["ready_for_review", "approved", "published"].includes(item.status)).length;
          const inProgress = deliverables.filter((item) => item.status === "in_progress").length;
          const assetCount = Number(campaign.outcomes?.assets_total || 0);
          const inquiryCount = Number(campaign.outcomes?.inquiries_total || 0);
          const progress = deliverables.length ? Math.round((reviewReady / deliverables.length) * 100) : 0;
          return `<article class="cs-campaign-card">
            <header><div><span>${esc(campaign.dateLabel)}</span><h4>${esc(campaign.name)}</h4><i>${esc(campaign.serviceLine)}</i></div><strong>${progress}%</strong></header>
            <p>${esc(campaign.targetOutcome)}</p>
            <div class="cs-campaign-progress" aria-label="${progress}% review-ready"><i style="--progress:${progress}%"></i></div>
            <div class="cs-campaign-counts"><span>${assetCount} assets</span><span>${inquiryCount} attributed inquiries</span><span>${reviewReady} review-ready</span><span>${inProgress} in progress</span><span>${deliverables.length} tasks</span></div>
            <div class="cs-campaign-deliverables">
              ${deliverables.map((deliverable) => {
                const action = campaignAction(deliverable);
                const key = `${campaign.id}:${deliverable.id}`;
                const updating = studioState.campaignUpdating === key;
                const attrs = action.open
                  ? `data-open-ws="${action.open}"`
                  : `data-cs-campaign="${esc(campaign.id)}" data-cs-deliverable="${esc(deliverable.id)}" data-cs-next-status="${esc(action.next)}"`;
                return `<div class="cs-campaign-task is-${statusClass(deliverable.status)}"><i></i><div><b>${esc(deliverable.name)}</b><span>${campaignStatusLabel(deliverable.status)}</span></div><button type="button" ${attrs} ${(action.disabled || updating) ? "disabled" : ""}>${updating ? "Saving…" : esc(action.label)}</button></div>`;
              }).join("")}
            </div>
            <div class="cs-campaign-foot"><div>${campaign.channels.map((channel) => `<span>${esc(channel)}</span>`).join("")}</div><div class="cs-attribution-row"><code>${esc(campaign.attributionTag)}</code><button type="button" data-cs-copy-campaign="${esc(campaign.attributionTag)}" data-cs-campaign-name="${esc(campaign.name)}">Copy tracked link</button></div></div>
          </article>`;
        }).join("") || `<p class="cs-empty">Campaign engines are not available yet.</p>`}
      </div>
      <footer><span>Production updates are internal. Attribution shows real matched inquiries only.</span><b>Review stays in Approvals. Publishing requires a provider receipt.</b></footer>
    </section>`;
}

function metricsMarkup(data) {
  const crm = data.crm?.summary || {};
  return `
    <section class="cs-metrics" aria-label="Business metrics">
      <article><span>CRM contacts</span><b>${Number(crm.contacts_total || 0).toLocaleString()}</b><i>${Number(crm.verified_contacts || 0).toLocaleString()} verified</i></article>
      <article><span>Organizations</span><b>${Number(crm.organizations_total || 0).toLocaleString()}</b><i>${Number(crm.immediate_opportunities || 0).toLocaleString()} priority opportunities</i></article>
      <article class="is-alert"><span>Follow-ups due</span><b>${Number(crm.follow_ups_due_or_ready || 0).toLocaleString()}</b><i>${Number(crm.follow_ups_overdue || 0).toLocaleString()} overdue in NexProspex</i></article>
      <article><span>Media staged</span><b>${Number(data.media?.assets_total || 0).toLocaleString()}</b><i>${bytes(data.media?.bytes_total || 0)} cross-device</i></article>
      <article><span>Publish records</span><b>${Number(data.publishing?.total || 0).toLocaleString()}</b><i>${Number(data.publishing?.pending_approval || 0)} awaiting approval</i></article>
      <article><span>Website inquiries</span><b>${Number(data.inquiries?.total || 0).toLocaleString()}</b><i>${Number(data.inquiries?.new || 0)} new · reply drafts queued</i></article>
    </section>`;
}

function mediaMarkup(data) {
  const assets = data.media?.recent_assets || [];
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  const local = data.media?.local_library || {};
  const upload = studioState.upload;
  return `
    <section class="cs-panel cs-media-panel">
      <header><div><p class="cs-eyebrow">01 · INGEST</p><h3>Media intake + auto thumbnails</h3></div><button class="cs-link" type="button" data-open-ws="media">Full Media Lab →</button></header>
      <div class="cs-upload-route"><label><span>Route this batch to</span><select data-cs-upload-campaign ${upload ? "disabled" : ""}><option value="">General media library</option>${campaigns.map((campaign) => `<option value="${esc(campaign.id)}" ${studioState.uploadCampaignId === campaign.id ? "selected" : ""}>${esc(campaign.name)}</option>`).join("")}</select></label><b>${upload ? esc(upload.campaignName) : studioState.uploadCampaignId ? "Campaign-linked ingest" : "Unassigned intake"}</b></div>
      <button class="cs-drop ${upload ? "is-uploading" : ""}" type="button" data-cs-upload-open ${upload ? "disabled" : ""}>
        <strong>${upload ? `${upload.completed + upload.failed} / ${upload.total}` : "Drop the whole social-ready batch here"}</strong>
        <span>${upload ? `Working on ${esc(upload.current)}` : "Photos, short clips, audio · multi-select · automatic preview generation"}</span>
        ${upload ? `<i style="--progress:${Math.round(((upload.completed + upload.failed) / upload.total) * 100)}%"></i>` : ""}
      </button>
      <input type="file" data-cs-upload-input accept="image/*,video/*,audio/*" multiple hidden>
      <p class="cs-fineprint">Cross-device staging accepts files up to 12 MB each. Use Media Lab folder sync for full camera originals; it keeps those large source files local and brings their catalogue into PhantomForce.</p>
      <div class="cs-local-library">
        <div><b>${Number(local.count || 0).toLocaleString()} full-size files indexed</b><span>${esc(local.root_label || "Local media library")} · ${local.generated_at ? `updated ${shortDate(local.generated_at)}` : "ready for first scan"}</span></div>
        <button type="button" data-cs-scan-folder>Rescan camera folder</button>
      </div>
      <div class="cs-assets">
        ${assets.map((asset) => `<article>
          <div class="cs-thumb" data-cs-thumb="${esc(asset.id)}"><span>${esc(asset.mime_type.split("/")[0])}</span></div>
          <div><b>${esc(asset.original_name)}</b><i>${bytes(asset.size_bytes)} · ${shortDate(asset.created_at)}${asset.campaign_id ? ` · ${esc(campaignNames.get(asset.campaign_id) || "Campaign linked")}` : ""}</i></div>
        </article>`).join("") || `<p class="cs-empty">No files staged yet. Your first batch will appear here.</p>`}
      </div>
    </section>`;
}

function socialMarkup(data) {
  const providers = data.socials?.providers || [];
  return `
    <section class="cs-panel">
      <header><div><p class="cs-eyebrow">02 · DISTRIBUTE</p><h3>One post, every connected channel</h3></div><button class="cs-link" type="button" data-open-ws="content">Open publisher →</button></header>
      <div class="cs-social-summary"><b>${data.socials?.connected || 0} / ${data.socials?.total || providers.length}</b><span>provider connections live for ChicagoShots</span></div>
      <div class="cs-social-grid">
        ${providers.map((provider) => {
          const connected = CONNECTED.has(provider.connectionStatus);
          return `<article class="${connected ? "is-connected" : ""}">
            <i></i><div><b>${esc(provider.name || provider.provider)}</b><span>${connected ? esc(provider.username || provider.selectedAssetName || "Connected") : esc(provider.customerMessage || "Not connected")}</span></div>
            ${connected ? `<em>LIVE</em>` : `<button type="button" data-cs-connect="${esc(provider.provider)}" data-cs-provider-name="${esc(provider.name || provider.provider)}">Connect</button>`}
          </article>`;
        }).join("") || `<p class="cs-empty">Social status is not available yet. Refresh after the provider service starts.</p>`}
      </div>
      <div class="cs-safe-line"><span>Draft</span><i>→</i><span>Review</span><i>→</i><span>Approve</span><i>→</i><span>Provider receipt</span></div>
    </section>`;
}

function crmMarkup(data) {
  const drafts = data.response_drafts || [];
  const contacts = data.crm?.contacts || [];
  const inquiries = data.inquiries?.recent || [];
  return `
    <section class="cs-panel cs-crm-panel">
      <header><div><p class="cs-eyebrow">03 · CONVERT</p><h3>NexProspex live desk</h3></div><button class="cs-link" type="button" data-open-ws="leads">Open CRM →</button></header>
      <div class="cs-crm-proof"><span><b>${Number(data.crm?.summary?.active_sequences || 0)}</b> active sequences</span><span><b>${Number(data.crm?.summary?.responses_received || 0)}</b> responses detected</span><span><b>${Number(data.crm?.summary?.suppressed_contacts || 0)}</b> suppressed safely</span></div>
      ${inquiries.length ? `<div class="cs-inquiries"><h4>New from ChicagoShots.com</h4>${inquiries.slice(0, 4).map((inquiry) => `<article><div><b>${esc(inquiry.name)} · ${esc(inquiry.projectType)}</b><span>${esc(inquiry.eventDate || "Date open")} · ${esc(inquiry.location || "Location open")}</span></div><em>${esc(inquiry.status)}</em></article>`).join("")}</div>` : ""}
      <div class="cs-reply-head"><div><b>Automatic response drafts</b><span>PhantomForce writes them; you approve them; nothing auto-sends.</span></div><button class="cs-button cs-button-primary" type="button" data-cs-queue-replies ${drafts.every((draft) => draft.already_queued) ? "disabled" : ""}>Queue next 8 for review</button></div>
      <div class="cs-replies">
        ${drafts.slice(0, 5).map((draft) => `<article>
          <div><b>${esc(draft.contact_name)} · ${esc(draft.organization)}</b><span>${esc(draft.subject)}</span><i>${esc(draft.channel)} · due ${shortDate(draft.due_at)}</i></div>
          <em class="is-${draft.already_queued ? "queued" : "ready"}">${draft.already_queued ? "IN APPROVALS" : "DRAFT READY"}</em>
        </article>`).join("") || `<p class="cs-empty">No follow-up candidates are available from the current NexProspex source.</p>`}
      </div>
      <div class="cs-top-leads">
        <h4>Priority pipeline</h4>
        ${contacts.slice(0, 5).map((contact) => `<article><div><b>${esc(contact.organization)}</b><span>${esc(contact.name)} · ${esc(contact.role)}</span></div><i>${esc(contact.priority_tier)}</i><strong>${contact.pipeline_value ? money(contact.pipeline_value) : `Score ${contact.priority_score}`}</strong></article>`).join("")}
      </div>
    </section>`;
}

function siteMarkup() {
  return `
    <section class="cs-panel cs-site-panel">
      <header><div><p class="cs-eyebrow">04 · OWN THE MARKET</p><h3>ChicagoShots.com</h3></div><a class="cs-link" href="https://chicagoshots.com" target="_blank" rel="noreferrer">View site →</a></header>
      <div class="cs-site-preview">
        <span>CHICAGO CREATIVE STUDIO</span>
        <strong>Stories that<br>move people.</strong>
        <p>Weddings · conferences · expert media · sports</p>
      </div>
      <div class="cs-site-actions"><button class="cs-button" type="button" data-open-ws="sites">Open Site Studio</button><button class="cs-button" type="button" data-open-ws="analytics">See performance</button></div>
    </section>`;
}

function renderReady(data) {
  return `<div class="cs-studio">
    ${heroMarkup(data)}
    ${runwayMarkup()}
    ${campaignMarkup(data)}
    ${metricsMarkup(data)}
    <div class="cs-grid">${mediaMarkup(data)}${socialMarkup(data)}${crmMarkup(data)}${siteMarkup()}</div>
    <footer class="cs-footer"><b>ChicagoShots runs on PhantomForce.</b><span>CRM source is read-only · drafts require approval · external actions require provider confirmation.</span><button type="button" data-cs-refresh>Refresh all</button></footer>
  </div>`;
}

function wire(root) {
  const input = root.querySelector("[data-cs-upload-input]");
  const campaignSelect = root.querySelector("[data-cs-upload-campaign]");
  campaignSelect?.addEventListener("change", () => {
    studioState.uploadCampaignId = campaignSelect.value;
    rerender();
  });
  root.querySelectorAll("[data-cs-upload-open]").forEach((button) => button.addEventListener("click", () => input?.click()));
  input?.addEventListener("change", () => {
    const files = input.files;
    input.value = "";
    void uploadBatch(files || [], studioState.uploadCampaignId);
  });
  root.querySelector("[data-cs-queue-replies]")?.addEventListener("click", () => void queueReplyDrafts());
  root.querySelector("[data-cs-scan-folder]")?.addEventListener("click", () => void refreshLocalLibrary());
  root.querySelector("[data-cs-refresh]")?.addEventListener("click", () => void loadStudio(true));
  root.querySelector("[data-cs-new-campaign]")?.addEventListener("click", () => {
    studioState.showCampaignForm = !studioState.showCampaignForm;
    rerender();
  });
  root.querySelector("[data-cs-cancel-campaign]")?.addEventListener("click", () => {
    studioState.showCampaignForm = false;
    rerender();
  });
  root.querySelector("[data-cs-campaign-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void createCampaign(event.currentTarget);
  });
  root.querySelectorAll("[data-cs-campaign]").forEach((button) => button.addEventListener("click", () => {
    if (!button.dataset.csCampaign || !button.dataset.csDeliverable || !button.dataset.csNextStatus) return;
    void updateCampaignDeliverable(button.dataset.csCampaign, button.dataset.csDeliverable, button.dataset.csNextStatus);
  }));
  root.querySelectorAll("[data-cs-copy-campaign]").forEach((button) => button.addEventListener("click", () => {
    if (!button.dataset.csCopyCampaign) return;
    void copyCampaignLink(button.dataset.csCopyCampaign, button.dataset.csCampaignName || "Campaign");
  }));
  root.querySelectorAll("[data-cs-connect]").forEach((button) => button.addEventListener("click", () => {
    void beginSocialConnection(button.dataset.csConnect, button.dataset.csProviderName || button.dataset.csConnect);
  }));
  hydrateThumbnails(root);
}

async function hydrateThumbnails(root) {
  const cards = [...root.querySelectorAll("[data-cs-thumb]")];
  let cursor = 0;
  const worker = async () => {
    while (cursor < cards.length) {
      const card = cards[cursor++];
      const id = card.dataset.csThumb;
      if (!id || !card.isConnected) continue;
      let url = thumbUrls.get(id);
      if (!url) {
        try {
          const response = await fetch(`/phantom-ai/content/assets/${encodeURIComponent(id)}/thumbnail?tenant_id=${encodeURIComponent(TENANT_ID)}`, { headers: authHeaders() });
          if (!response.ok) continue;
          url = URL.createObjectURL(await response.blob());
          thumbUrls.set(id, url);
        } catch { continue; }
      }
      card.style.backgroundImage = `url("${url}")`;
      card.classList.add("is-ready");
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, cards.length) }, worker));
}

function rerender() {
  if (!studioRoot?.isConnected) return;
  if (studioState.status === "ready" && studioState.data) {
    studioRoot.innerHTML = renderReady(studioState.data);
    wire(studioRoot);
    return;
  }
  if (studioState.status === "error") {
    studioRoot.innerHTML = `<div class="cs-state"><p class="cs-eyebrow">CHICAGOSHOTS STUDIO</p><h2>The command center needs attention.</h2><p>${esc(studioState.error)}</p><button class="cs-button cs-button-primary" type="button" data-cs-retry>Try again</button></div>`;
    studioRoot.querySelector("[data-cs-retry]")?.addEventListener("click", () => void loadStudio(true));
    return;
  }
  studioRoot.innerHTML = `<div class="cs-state is-loading"><p class="cs-eyebrow">PHANTOMFORCE × CHICAGOSHOTS</p><h2>Bringing the studio online…</h2><p>Loading media, social connections, publishing, and the live NexProspex pipeline.</p><i></i></div>`;
}

export function renderChicagoShotsStudio(root, opts = {}) {
  studioRoot = root;
  studioOpts = opts;
  rerender();
  void loadStudio(true);
}
