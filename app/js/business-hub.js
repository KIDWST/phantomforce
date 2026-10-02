import { store, ctx, session, currentWs, uid, pushActivity } from "./store.js?v=phantom-live-20260927-235";
import { getBusinessProfile } from "./business-profiles.js?v=phantom-live-20260927-235";

const mounted = new WeakMap();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const titleCase = (value) => String(value || "draft").replace(/-/g, " ").replace(/^./, (char) => char.toUpperCase());
const endpoint = "/api/business-workspaces/records";
const scoped = (list, businessId) => (Array.isArray(list) ? list : []).filter((record) => record && record.ws === businessId);
const recordScope = (record) => record?.businessId || record?.tenantId || record?.ws;
const dateLabel = (value) => {
  if (!value) return "No due date";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No due date";
};

export function validateBusinessWorkItem(profileOrId, item, targetStatus = item.status || "draft") {
  const profile = typeof profileOrId === "object" ? profileOrId : getBusinessProfile(profileOrId);
  const workflow = profile.workflows.find((flow) => flow.kind === item.kind);
  if (!workflow) return "Choose a workflow belonging to this business.";
  if (!String(item.title || "").trim()) return "Add a title for this work.";
  if (!workflow.stages.includes(targetStatus)) return "Choose a stage belonging to this workflow.";
  if (profile.id === "occasionally-odd" && ["order", "product"].includes(item.kind)) {
    const rights = item.metadata?.rightsStatus;
    if (!["original", "pending", "authorized"].includes(rights)) return "Record whether the design is original or requires permission.";
    if (rights === "authorized" && !String(item.metadata?.rightsReference || "").trim()) return "Add the written authorization reference.";
    if (["production", "quality-check", "ready", "complete"].includes(targetStatus) && !["original", "authorized"].includes(rights)) return "Written authorization is required before this design can enter production.";
  }
  return "";
}

export function businessRecordPatch(item, currentRecord) {
  if (!currentRecord || !Number.isInteger(currentRecord.version) || currentRecord.version < 1) throw new Error("Refresh this record before saving.");
  const { kind: _kind, ...patch } = item;
  return { ...patch, expectedVersion: currentRecord.version };
}

export function canManageLocalBusiness(sessionValue) {
  return Boolean(sessionValue && (sessionValue.role === "admin" || ["owner", "admin"].includes(sessionValue.orgRole)));
}

function requestHeaders(businessId) {
  const token = session.token?.();
  return {
    "Content-Type": "application/json", "x-phantomforce-business": businessId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(ctx.session?.sessionId ? { "x-phantomforce-session": ctx.session.sessionId } : {}),
  };
}

async function request(businessId, path = "", method = "GET", body) {
  const response = await fetch(`${endpoint}${path}`, {
    method, headers: requestHeaders(businessId), signal: AbortSignal.timeout(20_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(typeof payload.error === "string" ? payload.error.replace(/_/g, " ") : `The workspace could not be updated (${response.status}).`);
  if (payload.tenant_id !== businessId) throw new Error("Business changed. Refresh this workspace before continuing.");
  return payload;
}

function sectionKinds(section, profile) {
  return ({ projects: ["project", "automation"], bookings: ["shoot"], calendar: ["shoot", "edit", "delivery", "project"], gear: ["gear"], deliverables: ["edit", "delivery", "social"], orders: ["order"], production: ["order", "product"], campaigns: ["campaign"], licensing: ["licensing"] })[section] || profile.workflows.map((flow) => flow.kind);
}

/** Every render captures an immutable business ID. Stale forms/responses cannot write
 * into a newly selected workspace; authenticated errors never fall back to local data. */
export function renderBusinessHub(root, options = {}) {
  const businessId = options.businessId || currentWs();
  const profile = getBusinessProfile(options.profile || businessId);
  const prior = mounted.get(root);
  if (prior) prior.disposed = true;
  const remote = Boolean(session.token?.() || ctx.session?.database || ctx.session?.localCustomer);
  const state = {
    businessId, disposed: false, section: String(options.section || "overview").replace(/^business-/, ""),
    status: remote ? "loading" : "ready", records: remote ? [] : scoped(store.state.businessWorkItems, businessId),
    canManage: !remote && canManageLocalBusiness(ctx.session), search: "", filter: "all", error: "", notice: "", busy: false, editor: null,
  };
  mounted.set(root, state);
  const active = () => !state.disposed && mounted.get(root) === state && currentWs() === businessId;
  const currentRecord = (id) => state.records.find((record) => record.id === id && recordScope(record) === businessId);
  const navigate = (route) => { if (active()) options.navigate?.(route); };
  const notify = (message) => { state.notice = message; options.notify?.(profile.name, message); };

  async function refresh() {
    if (!remote || !active()) return;
    state.status = "loading"; state.error = ""; paint();
    try {
      const payload = await request(businessId);
      if (!active()) return;
      const records = Array.isArray(payload.records) ? payload.records : [];
      if (records.some((record) => recordScope(record) !== businessId)) throw new Error("A response did not match this business. Nothing from that response was loaded.");
      state.records = records; state.canManage = payload.canManage === true; state.status = "ready";
    } catch (error) {
      if (!active()) return;
      state.records = []; state.status = "error"; state.error = error.message || "Workspace records could not load.";
    }
    paint();
  }

  async function save(item, existingId = "", expectedVersion) {
    if (!active()) throw new Error("The active business changed. Reopen this work in its own workspace.");
    if (!state.canManage) throw new Error("Your role can view this workspace. Ask a business administrator to make changes.");
    const validation = validateBusinessWorkItem(profile, item);
    if (validation) throw new Error(validation);
    if (existingId && !currentRecord(existingId)) throw new Error("This record is not in the active business.");
    let saved;
    if (remote) {
      const readRecord = expectedVersion === undefined ? currentRecord(existingId) : { version: expectedVersion };
      const payload = await request(businessId, existingId ? `/${encodeURIComponent(existingId)}` : "", existingId ? "PATCH" : "POST", existingId ? businessRecordPatch(item, readRecord) : item);
      if (!active()) return;
      saved = payload.record;
      if (!saved || recordScope(saved) !== businessId) throw new Error("The saved record did not match the active business.");
    } else {
      const now = new Date().toISOString();
      saved = { ...item, id: existingId || uid("business-work"), ws: businessId, businessId, createdAt: currentRecord(existingId)?.createdAt || now, updatedAt: now, localDraft: true };
      store.state.businessWorkItems = [saved, ...(store.state.businessWorkItems || []).filter((record) => !(record.id === saved.id && record.ws === businessId))];
      pushActivity(profile.name, `${existingId ? "Updated" : "Created"} ${saved.title}.`, businessId);
      store.save();
    }
    if (!active()) return;
    state.records = [saved, ...state.records.filter((record) => record.id !== saved.id)];
    state.editor = null;
    notify(`${existingId ? "Updated" : "Saved"} in ${profile.name}${remote ? "." : " as a local draft."}`);
  }

  function openEditor({ kind, template, record } = {}) {
    if (!active() || !state.canManage) return;
    state.editor = record ? { ...record, metadata: { ...record.metadata } } : {
      kind: kind || template?.kind || sectionKinds(state.section, profile)[0], title: template?.title || "", status: "draft", customer: "", due: "", notes: template?.notes || "",
      metadata: { templateId: template?.id || "", checklist: template?.checklist || [], channel: "", ...(profile.id === "occasionally-odd" ? { quantity: 1 } : {}), ...(template?.id === "special-freebie" ? { isFreebie: true } : {}) },
    };
    state.error = ""; paint();
    root.querySelector("[data-business-editor] input[name=title]")?.focus();
  }

  function visibleRecords() {
    const kinds = sectionKinds(state.section, profile);
    return state.records.filter((record) => recordScope(record) === businessId && kinds.includes(record.kind))
      .filter((record) => state.filter === "all" || (state.filter === "open" ? !["complete", "ready"].includes(record.status) : record.status === state.filter))
      .filter((record) => `${record.title} ${record.customer || ""} ${record.notes || ""}`.toLowerCase().includes(state.search.toLowerCase()));
  }

  function metric(label, value, detail) {
    return `<div class="business-metric"><span>${esc(label)}</span><strong>${state.status === "ready" ? esc(value) : "—"}</strong><small>${esc(detail)}</small></div>`;
  }

  function metrics() {
    const records = state.records;
    const open = records.filter((record) => !["ready", "complete"].includes(record.status));
    const review = records.filter((record) => ["review", "quality-check"].includes(record.status));
    const metrics = profile.id === "occasionally-odd"
      ? [["Open orders", open.filter((record) => record.kind === "order").length, "Custom and bulk requests"], ["On the workbench", records.filter((record) => ["production", "quality-check"].includes(record.status)).length, "Production and quality checks"], ["Ready for review", review.length, "An eye on every detail"], ["Seasonal plans", open.filter((record) => ["campaign", "product"].includes(record.kind)).length, "Collections and special campaigns"]]
      : profile.id === "client-chicagoshots"
        ? [["Shoot plans", open.filter((record) => record.kind === "shoot").length, "Media days and game days"], ["In the edit", records.filter((record) => record.status === "editing").length, "Cuts currently in progress"], ["Client review", review.length, "Feedback before delivery"], ["Ready to hand off", records.filter((record) => record.status === "ready").length, "Approved preparation stage"]]
        : [["Active projects", open.filter((record) => record.kind === "project").length, "Scope through delivery"], ["Automation plans", open.filter((record) => record.kind === "automation").length, "Approval stays in your hands"], ["Review queue", review.length, "Decisions waiting on you"], ["Completed projects", records.filter((record) => record.status === "complete").length, "Recorded handoffs"]];
    return `<div class="business-metrics">${metrics.map((values) => metric(...values)).join("")}</div>`;
  }

  function workCard(record) {
    const workflow = profile.workflows.find((item) => item.kind === record.kind);
    if (!workflow) return "";
    const next = workflow.stages[workflow.stages.indexOf(record.status) + 1];
    const blocked = next ? validateBusinessWorkItem(profile, record, next) : "";
    return `<article class="business-work-card" data-business-record="${esc(record.id)}">
      <div class="business-card-meta"><span>${esc(workflow.label)}</span><span class="business-stage stage-${esc(record.status)}">${esc(titleCase(record.status))}</span></div>
      <h3>${esc(record.title)}</h3><p>${esc(record.kind === "gear" ? record.metadata?.assetTag || "No asset tag recorded" : record.customer || `No ${profile.nouns.customer.toLowerCase()} assigned`)}</p>
      ${record.kind === "gear" ? `<p>${esc(record.metadata?.location || "Location not recorded")} · ${esc(record.metadata?.checkoutTo || "Unassigned")}</p>` : ""}
      ${record.notes ? `<p class="business-note-preview">${esc(record.notes)}</p>` : ""}
      <div class="business-card-details"><span>${esc(dateLabel(record.due))}</span>${record.metadata?.quantity ? `<span>Qty ${esc(record.metadata.quantity)}</span>` : ""}${record.metadata?.rightsStatus === "pending" ? '<span class="business-rights-pending">Permission pending</span>' : ""}</div>
      <div class="business-card-actions"><button type="button" class="business-button business-button-subtle" data-edit-record="${esc(record.id)}" ${!state.canManage ? "disabled" : ""}>Edit details</button>${next ? `<button type="button" class="business-button business-button-small" data-advance-record="${esc(record.id)}" title="${esc(blocked || `Move to ${titleCase(next)}`)}" ${state.busy || !state.canManage || blocked ? "disabled" : ""}>${esc(titleCase(next))} <span aria-hidden="true">→</span></button>` : '<span class="business-finished">Stage complete</span>'}</div>
      ${blocked ? `<small class="business-card-blocker">${esc(blocked)}</small>` : ""}
    </article>`;
  }

  function workList() {
    const records = visibleRecords();
    const kinds = sectionKinds(state.section, profile);
    const workflows = profile.workflows.filter((flow) => kinds.includes(flow.kind));
    const section = profile.sections.find((item) => item.id === state.section);
    const title = state.section === "overview" ? (profile.id === "occasionally-odd" ? "From the order book" : profile.id === "client-chicagoshots" ? "On the production desk" : "Work in motion") : section?.label || "Work in motion";
    return `<section class="business-panel business-work-panel" aria-label="${esc(title)}"><div class="business-panel-heading"><div><p class="business-eyebrow">${esc(profile.name)} work</p><h2>${esc(title)}</h2></div>${workflows.length ? `<button type="button" class="business-button business-button-primary" data-new-business-work ${!state.canManage || state.status !== "ready" ? "disabled" : ""}>+ ${esc(workflows[0].label)}</button>` : ""}</div>
      <div class="business-work-filters"><label class="business-search"><span class="business-sr-only">Search this business's work</span><input type="search" placeholder="Search ${esc(profile.nouns.work.toLowerCase())}…" value="${esc(state.search)}" data-business-search></label><label><span class="business-sr-only">Filter stage</span><select data-business-filter><option value="all" ${state.filter === "all" ? "selected" : ""}>All stages</option><option value="open" ${state.filter === "open" ? "selected" : ""}>In progress</option><option value="review" ${state.filter === "review" ? "selected" : ""}>In review</option><option value="ready" ${state.filter === "ready" ? "selected" : ""}>Ready</option><option value="complete" ${state.filter === "complete" ? "selected" : ""}>Completed</option></select></label></div>
      ${state.status === "loading" ? '<div class="business-empty" role="status"><span class="business-empty-mark" aria-hidden="true">···</span><h3>Opening your work</h3><p>Loading records for this business.</p></div>' : state.status === "error" ? '<div class="business-empty"><h3>Records are unavailable</h3><p>Reconnect to load this business’s saved work.</p><button type="button" class="business-button" data-business-retry>Try again</button></div>' : records.length ? `<div class="business-work-grid">${records.slice(0, state.section === "overview" ? 6 : 200).map(workCard).join("")}</div>` : `<div class="business-empty"><span class="business-empty-mark" aria-hidden="true">${profile.id === "occasionally-odd" ? "✦" : profile.id === "client-chicagoshots" ? "↗" : "⌁"}</span><h3>${state.search || state.filter !== "all" ? "No matching work" : profile.id === "occasionally-odd" ? "Room for something wonderfully odd" : profile.id === "client-chicagoshots" ? "Every great shoot starts with a plan" : "The next project starts here"}</h3><p>${state.search || state.filter !== "all" ? "Try another search or stage." : workflows[0]?.detail || "Your business records will appear here as you add them."}</p>${workflows.length && state.canManage ? '<button type="button" class="business-button" data-new-business-work>Create the first draft</button>' : ""}</div>`}
      ${state.section === "overview" && state.records.length > 6 ? `<button type="button" class="business-text-button" data-business-section="${esc(profile.sections[1]?.id || "overview")}">View the full work queue →</button>` : ""}
    </section>`;
  }

  function templatesView(compact = false) {
    return `<section class="business-panel"><div class="business-panel-heading"><div><p class="business-eyebrow">A useful starting point</p><h2>${esc(profile.id === "phantomforce" ? "Operating playbooks" : profile.id === "client-chicagoshots" ? "Ready for the next shoot" : "Ideas for the workroom")}</h2></div>${compact ? '<button type="button" class="business-text-button" data-business-section="templates">All templates →</button>' : ""}</div><div class="business-template-grid">${profile.templates.slice(0, compact ? 3 : 100).map((item, index) => `<article class="business-template-card"><span class="business-template-number">${String(index + 1).padStart(2, "0")}</span><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p>${!compact ? `<ul>${item.checklist.map((step) => `<li>${esc(step)}</li>`).join("")}</ul>` : ""}<button type="button" class="business-text-button" data-business-template="${esc(item.id)}" ${!state.canManage || state.status !== "ready" ? "disabled" : ""}>Use this template <span aria-hidden="true">↗</span></button></article>`).join("") || '<p class="business-muted">Add templates to this business’s profile to establish its workflow.</p>'}</div></section>`;
  }

  function calendarView() {
    if (state.status !== "ready") return workList();
    const dated = visibleRecords().filter((record) => record.due).sort((a, b) => a.due.localeCompare(b.due));
    const unscheduled = visibleRecords().filter((record) => !record.due && record.status !== "complete");
    return `<section class="business-panel business-calendar"><div class="business-panel-heading"><div><p class="business-eyebrow">Shoot dates & delivery deadlines</p><h2>Your production calendar</h2></div><button type="button" class="business-button business-button-primary" data-new-business-work ${state.canManage ? "" : "disabled"}>+ Shoot plan</button></div><p class="business-muted">Dates from your saved studio plans. External calendar synchronization depends on this organization’s calendar connection.</p>${dated.length ? `<div class="business-agenda">${dated.map((record) => `<article class="business-agenda-row"><time datetime="${esc(record.due)}">${esc(dateLabel(record.due))}</time><div><strong>${esc(record.title)}</strong><p>${esc(record.customer || "Client not assigned")} · ${esc(titleCase(record.kind))}</p></div><span>${esc(titleCase(record.status))}</span><button type="button" class="business-button" data-edit-record="${esc(record.id)}" ${state.canManage ? "" : "disabled"}>Open plan</button></article>`).join("")}</div>` : '<div class="business-empty"><h3>A clear calendar</h3><p>Add a shoot plan or set a target date on a project to see it here.</p></div>'}${unscheduled.length ? `<p class="business-muted">${unscheduled.length} open ${unscheduled.length === 1 ? "plan needs" : "plans need"} a date.</p>` : ""}</section>`;
  }

  function assetsView() {
    const assets = scoped(store.state.media, businessId);
    return `<section class="business-panel"><div class="business-panel-heading"><div><p class="business-eyebrow">Belonging to ${esc(profile.name)}</p><h2>${esc(profile.nouns.assets)}</h2></div><button type="button" class="business-button" data-business-route="content">Open asset library →</button></div><p class="business-muted">Manage originals, working files, and approved exports in this business’s content library.</p>${assets.length ? `<div class="business-work-grid">${assets.slice(0, 12).map((asset) => `<article class="business-asset-card"><span class="business-asset-symbol" aria-hidden="true">▧</span><div><h3>${esc(asset.title || asset.name || "Untitled asset")}</h3><p>${esc(asset.type || asset.kind || "Media asset")}</p></div><button type="button" class="business-text-button" data-business-route="content">Open library</button></article>`).join("")}</div>` : '<div class="business-empty"><span class="business-empty-mark" aria-hidden="true">▧</span><h3>A home for this business’s assets</h3><p>Open the content library to view connected assets or add approved material.</p></div>'}</section>`;
  }

  function channelsView() {
    return `<section class="business-panel"><div class="business-panel-heading"><div><p class="business-eyebrow">Your business, connected</p><h2>${esc(profile.id === "occasionally-odd" ? "Shops, socials & support" : profile.id === "client-chicagoshots" ? "Where your work gets seen" : "Business channels")}</h2></div><button type="button" class="business-button" data-business-route="settings">Manage connections →</button></div><p class="business-muted">Open a channel to inspect its current connection and permissions for ${esc(profile.name)}.</p><div class="business-channel-grid">${profile.channels.map((channel) => `<article class="business-channel-card"><span class="business-channel-icon" aria-hidden="true">${esc(channel.name.slice(0, 1))}</span><div><h3>${esc(channel.name)}</h3><p>${esc(channel.detail)}</p><span class="business-connection-state">Verify in connections</span></div><button type="button" class="business-button business-button-small" data-business-route="${esc(channel.route)}">Open →</button></article>`).join("")}</div>${profile.supportEmail ? `<div class="business-support"><span>Customer contact</span><a href="mailto:${esc(profile.supportEmail)}">${esc(profile.supportEmail)}</a><small>Address recorded for this business. Inbox authorization is managed in Connections.</small></div>` : ""}</section>`;
  }

  function assistantView() {
    return `<aside class="business-assistant"><div class="business-assistant-heading"><span class="business-assistant-mark" aria-hidden="true">✳</span><div><p class="business-eyebrow">Working with ${esc(profile.name)}</p><h2>${esc(profile.assistantName)}</h2></div></div><p>${esc(profile.assistantPlaceholder)}</p><div class="business-prompt-list">${profile.prompts.slice(0, 3).map((prompt, index) => `<button type="button" data-business-prompt="${index}">${esc(prompt)}<span aria-hidden="true">↗</span></button>`).join("")}</div>${profile.id === "client-chicagoshots" ? '<button type="button" class="business-button" data-business-route="chicagoshots">Open campaign studio →</button>' : profile.id === "occasionally-odd" ? `<div class="business-small-note"><strong>Made with permission.</strong><p>Original designs can move into production. Protected horror properties require written authorization.</p><button type="button" class="business-text-button" data-business-section="licensing">Open licensing desk →</button></div>` : '<button type="button" class="business-button" data-business-route="automation">Review automations →</button>'}</aside>`;
  }

  function editorView() {
    const item = state.editor;
    if (!item) return "";
    const metadata = item.metadata || {};
    const isOdd = profile.id === "occasionally-odd";
    const flow = profile.workflows.find((workflow) => workflow.kind === item.kind);
    return `<section class="business-editor business-panel" aria-labelledby="business-editor-heading"><div class="business-panel-heading"><div><p class="business-eyebrow">${item.id ? "Edit" : "New draft"} · ${esc(profile.name)}</p><h2 id="business-editor-heading">${esc(item.id ? item.title : flow?.label || "New work")}</h2></div><button type="button" class="business-button business-button-subtle" data-business-cancel>Close</button></div><form data-business-editor>
      <div class="business-form-grid"><label class="business-form-wide">Title<input name="title" required maxlength="180" value="${esc(item.title)}" placeholder="${esc(isOdd ? "Custom autumn porch sign" : profile.id === "client-chicagoshots" ? "Team media-day shoot" : "Client website launch")}"></label>
      <label>Workflow<select name="kind" ${item.id ? "disabled" : ""}>${profile.workflows.map((workflow) => `<option value="${esc(workflow.kind)}" ${item.kind === workflow.kind ? "selected" : ""}>${esc(workflow.label)}</option>`).join("")}</select></label><label>${esc(profile.nouns.customer)}<input name="customer" maxlength="180" value="${esc(item.customer)}" placeholder="Optional"></label>
      <label>Target date<input name="due" type="date" value="${esc(String(item.due || "").slice(0, 10))}"></label><label>Channel / delivery destination<input name="channel" maxlength="120" value="${esc(metadata.channel)}" placeholder="Optional"></label>
      ${profile.id === "client-chicagoshots" && item.kind === "gear" ? `<label>Equipment status<select name="gearStatus">${flow.stages.map((status) => `<option value="${esc(status)}" ${item.status === status ? "selected" : ""}>${esc(titleCase(status))}</option>`).join("")}</select></label><label>Asset tag / serial reference<input name="assetTag" maxlength="120" value="${esc(metadata.assetTag)}"></label><label>Storage / shoot location<input name="location" maxlength="180" value="${esc(metadata.location)}"></label><label>Assigned to<input name="checkoutTo" maxlength="180" value="${esc(metadata.checkoutTo)}"></label>` : ""}
      ${isOdd ? `<label>Quantity<input name="quantity" type="number" min="1" max="100000" step="1" value="${esc(metadata.quantity || 1)}"></label><label>Design rights<select name="rightsStatus"><option value="">Choose when relevant</option><option value="original" ${metadata.rightsStatus === "original" ? "selected" : ""}>Original design / permission not required</option><option value="pending" ${metadata.rightsStatus === "pending" ? "selected" : ""}>Permission required · pending</option><option value="authorized" ${metadata.rightsStatus === "authorized" ? "selected" : ""}>Written authorization held</option></select></label><label class="business-form-wide">Authorization reference<input name="rightsReference" maxlength="500" value="${esc(metadata.rightsReference)}" placeholder="Agreement reference, approved use, and expiry — never credentials"></label>` : ""}
      <label class="business-form-wide">Brief & notes<textarea name="notes" rows="7" maxlength="6000" placeholder="Requirements, deliverables, milestones, and review notes">${esc(item.notes)}</textarea></label>
      ${metadata.checklist?.length ? `<fieldset class="business-form-wide business-checklist"><legend>Template checklist</legend>${metadata.checklist.map((step) => `<div>○ ${esc(step)}</div>`).join("")}</fieldset>` : ""}</div>
      <div class="business-form-footer"><p>${remote ? `Saved to ${esc(profile.name)}.` : "Saved as a local draft in this browser."} External actions require their own approval.</p><button type="submit" class="business-button business-button-primary" ${state.busy ? "disabled" : ""}>${state.busy ? "Saving…" : "Save draft"}</button></div><p class="business-form-error" role="alert" data-business-form-error></p>
    </form></section>`;
  }

  function paint() {
    if (!active()) return;
    root.innerHTML = `<div class="business-hub business-${esc(profile.id)}" data-business-hub="${esc(businessId)}" aria-busy="${state.status === "loading"}">
      <header class="business-hero"><div class="business-hero-copy"><p class="business-eyebrow">${esc(profile.eyebrow)}</p><h1>${esc(profile.tagline)}</h1><p>${esc(profile.description)}</p><div class="business-hero-footer"><span class="business-scope-label"><i aria-hidden="true"></i>${esc(profile.name)} workspace</span><span>${remote ? "Business records" : "Local draft workspace"}</span></div></div><div class="business-brand-art" aria-hidden="true"><span class="business-brand-orbit"></span><b>${esc(profile.initials)}</b><span class="business-art-caption">${esc(profile.kind)}</span></div></header>
      <nav class="business-section-nav" aria-label="${esc(profile.name)} workspace sections">${profile.sections.map((section) => `<button type="button" class="${state.section === section.id ? "is-active" : ""}" data-business-section="${esc(section.id)}" ${state.section === section.id ? 'aria-current="page"' : ""}>${esc(section.label)}</button>`).join("")}</nav>
      ${state.error ? `<div class="business-alert" role="alert">${esc(state.error)}</div>` : ""}${state.notice ? `<div class="business-notice" role="status">${esc(state.notice)}</div>` : ""}
      ${state.status === "ready" && !state.canManage ? '<div class="business-notice">View-only access. Your business administrator manages records.</div>' : ""}
      ${editorView()}
      ${state.section === "overview" ? `${metrics()}<div class="business-overview-grid">${workList()}${assistantView()}</div>${templatesView(true)}` : state.section === "calendar" ? calendarView() : state.section === "templates" ? templatesView() : state.section === "assets" ? assetsView() : state.section === "channels" ? channelsView() : workList()}
    </div>`;
    bind();
  }

  function bind() {
    root.querySelectorAll("[data-business-section]").forEach((button) => button.addEventListener("click", () => {
      if (!active()) return;
      if (options.onSectionChange) return options.onSectionChange(button.dataset.businessSection);
      if (profile.id === "occasionally-odd" && ["overview", "orders", "products", "production", "inventory", "customers", "channels", "shipping", "marketing", "finance", "analytics"].includes(button.dataset.businessSection)) return navigate(`business-${button.dataset.businessSection}`);
      state.section = button.dataset.businessSection; state.search = ""; state.filter = "all"; state.editor = null; state.error = ""; paint();
    }));
    root.querySelectorAll("[data-business-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.businessRoute)));
    root.querySelectorAll("[data-new-business-work]").forEach((button) => button.addEventListener("click", () => openEditor()));
    root.querySelectorAll("[data-business-template]").forEach((button) => button.addEventListener("click", () => openEditor({ template: profile.templates.find((item) => item.id === button.dataset.businessTemplate) })));
    root.querySelectorAll("[data-edit-record]").forEach((button) => button.addEventListener("click", () => { const record = currentRecord(button.dataset.editRecord); if (record) openEditor({ record }); }));
    root.querySelectorAll("[data-business-prompt]").forEach((button) => button.addEventListener("click", () => {
      if (!active()) return;
      const prompt = profile.prompts[Number(button.dataset.businessPrompt)];
      if (options.onAsk) options.onAsk(prompt, { businessId, profile }); else navigate("phantomai");
    }));
    root.querySelector("[data-business-cancel]")?.addEventListener("click", () => { state.editor = null; paint(); });
    root.querySelector("[data-business-retry]")?.addEventListener("click", refresh);
    root.querySelector("[data-business-filter]")?.addEventListener("change", (event) => { state.filter = event.target.value; paint(); });
    root.querySelector("[data-business-search]")?.addEventListener("input", (event) => {
      state.search = event.target.value; const cursor = event.target.selectionStart; paint();
      const input = root.querySelector("[data-business-search]"); input?.focus(); input?.setSelectionRange(cursor, cursor);
    });
    root.querySelectorAll("[data-advance-record]").forEach((button) => button.addEventListener("click", async () => {
      const record = currentRecord(button.dataset.advanceRecord);
      if (!record || state.busy || !active()) return;
      const flow = profile.workflows.find((item) => item.kind === record.kind);
      const status = flow?.stages[flow.stages.indexOf(record.status) + 1];
      if (!status) return;
      state.busy = true; state.error = ""; paint();
      try { await save({ kind: record.kind, title: record.title, status, customer: record.customer, due: record.due, notes: record.notes, metadata: record.metadata }, record.id); }
      catch (error) { if (active()) state.error = error.message; }
      finally { state.busy = false; paint(); }
    }));
    const form = root.querySelector("[data-business-editor]");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault(); if (!active() || state.busy || !state.editor) return;
      const data = new FormData(form); const editor = state.editor;
      const item = {
        kind: editor.id ? editor.kind : String(data.get("kind") || ""), title: String(data.get("title") || "").trim(), status: editor.status || "draft", customer: String(data.get("customer") || "").trim(), due: String(data.get("due") || ""), notes: String(data.get("notes") || "").trim(),
        metadata: { ...editor.metadata, channel: String(data.get("channel") || "").trim(), ...(profile.id === "occasionally-odd" ? { quantity: Number(data.get("quantity") || 1), rightsStatus: String(data.get("rightsStatus") || ""), rightsReference: String(data.get("rightsReference") || "").trim() } : {}) },
      };
      if (profile.id === "client-chicagoshots" && item.kind === "gear") {
        item.status = String(data.get("gearStatus") || editor.status || "draft");
        for (const key of ["assetTag", "location", "checkoutTo"]) item.metadata[key] = String(data.get(key) || "").trim();
      }
      if (!item.metadata.rightsStatus) delete item.metadata.rightsStatus;
      state.busy = true; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = "Saving…";
      try { await save(item, editor.id, editor.version); state.busy = false; if (active()) paint(); }
      catch (error) { if (active()) form.querySelector("[data-business-form-error]").textContent = error.message; }
      finally { state.busy = false; if (submit.isConnected) { submit.disabled = false; submit.textContent = "Save draft"; } }
    });
  }
  paint();
  if (remote) void refresh();
  return { dispose() { state.disposed = true; }, refresh };
}
