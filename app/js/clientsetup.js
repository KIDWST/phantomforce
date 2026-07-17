import { currentTenantId, session } from "./store.js?v=phantom-live-20260717-17";

const SLOT_IDS = ["active-1", "active-2", "pending-1"];
const SLOT_META = {
  "active-1": { label: "Active client 1", statusLabel: "Active slot", kind: "active" },
  "active-2": { label: "Active client 2", statusLabel: "Active slot", kind: "active" },
  "pending-1": { label: "Pending client", statusLabel: "Optional pending", kind: "pending" },
};
const MODULES = [
  { id: "lead_queue", label: "Lead Queue", description: "Capture and qualify new prospects." },
  { id: "follow_up_queue", label: "Follow-Up Queue", description: "Track callbacks, reminders, and nurture." },
  { id: "content_calendar", label: "Social/Content Calendar", description: "Plan approved posts and campaigns." },
  { id: "media_assets", label: "Media Assets", description: "Organize brand photos, clips, and creative." },
  { id: "approval_queue", label: "Approval Queue", description: "Hold outbound work until the right person approves." },
  { id: "client_requests", label: "Client Requests", description: "Collect asks, issues, and change requests." },
  { id: "employee_tasks", label: "Employee Tasks", description: "Assign work to team workspace members." },
  { id: "reports", label: "Reports", description: "Send progress, activity, and growth summaries." },
  { id: "packages_offers", label: "Packages/Offers", description: "Define sellable services and offers." },
  { id: "business_cleanup", label: "Business Cleanup Checklist", description: "Spot missing basics before growth work." },
];
const TEMPLATES = [
  { key: "local_service", label: "Local service business", recommendedModules: ["lead_queue", "follow_up_queue", "approval_queue", "reports", "packages_offers", "business_cleanup"], reportingMetrics: ["new_leads", "follow_ups_due", "reviews", "appointments"] },
  { key: "media_content", label: "Media/content business", recommendedModules: ["content_calendar", "media_assets", "approval_queue", "client_requests", "employee_tasks", "reports"], reportingMetrics: ["assets_created", "posts_approved", "drafts_ready", "client_requests"] },
  { key: "contractor_home_service", label: "Contractor/home service", recommendedModules: ["lead_queue", "follow_up_queue", "content_calendar", "approval_queue", "reports", "packages_offers"], reportingMetrics: ["quote_requests", "follow_ups_due", "jobs_won", "reviews"] },
  { key: "sports_team_club", label: "Sports/team/club", recommendedModules: ["client_requests", "content_calendar", "media_assets", "approval_queue", "reports", "employee_tasks"], reportingMetrics: ["registrations", "requests_open", "content_ready", "sponsor_deliverables"] },
  { key: "restaurant_bar_venue", label: "Restaurant/bar/venue", recommendedModules: ["content_calendar", "media_assets", "lead_queue", "approval_queue", "reports", "packages_offers"], reportingMetrics: ["event_inquiries", "posts_ready", "offers_active", "reviews"] },
  { key: "professional_service", label: "Professional service", recommendedModules: ["lead_queue", "follow_up_queue", "approval_queue", "reports", "client_requests", "business_cleanup"], reportingMetrics: ["qualified_leads", "consults_booked", "follow_ups_due", "proof_assets"] },
  { key: "crypto_startup_internal_ops", label: "Crypto/startup/internal ops", recommendedModules: ["employee_tasks", "client_requests", "approval_queue", "reports", "content_calendar", "business_cleanup"], reportingMetrics: ["open_tasks", "approvals_pending", "launch_updates", "requests_open"] },
];
const SOCIAL_PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "x", "linkedin", "pinterest"];
const METRICS = ["new_leads", "qualified_leads", "follow_ups_due", "appointments", "posts_ready", "posts_approved", "assets_created", "requests_open", "reviews", "jobs_won", "revenue_notes", "blocked_items"];

const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const cleanId = () => `cs-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;

function defaultModules() {
  return Object.fromEntries(MODULES.map((module) => [module.id, false]));
}

function computeCompleteness(slot) {
  if (slot.status === "empty") {
    return {
      score: 0,
      completed: [],
      blockers: ["Set this slot to active or pending before it counts as a client setup."],
      nextAction: slot.slotKind === "pending" ? "Mark this slot pending when a real prospect is ready." : "Mark this slot active when a real client is ready.",
    };
  }
  const checks = [
    ["organization", Boolean(slot.organizationName), "Name the organization."],
    ["business_template", Boolean(slot.businessTemplate), "Choose a business template."],
    ["modules", Object.values(slot.modules || {}).some(Boolean), "Enable at least one operating module."],
    ["services_packages", (slot.servicesPackages || []).length > 0, "Add at least one service/package."],
    ["lead_sources", (slot.leadSources || []).some((source) => source.enabled !== false), "Add at least one enabled lead source."],
    ["social_media_workflow", Boolean(slot.socialMediaWorkflow?.cadence || slot.socialMediaWorkflow?.platforms?.length || slot.socialMediaWorkflow?.assetSource), "Configure the social/media workflow."],
    ["approval_rules", Boolean(slot.approvalRules?.outboundPublishing), "Confirm approval rules."],
    ["reporting_preferences", Boolean(slot.reportingPreferences?.cadence || slot.reportingPreferences?.metrics?.length || slot.reportingPreferences?.recipients), "Choose reporting preferences."],
  ];
  const completed = checks.filter(([, ok]) => ok).map(([id]) => id);
  const blockers = checks.filter(([, ok]) => !ok).map(([, , text]) => text);
  return {
    score: Math.round((completed.length / checks.length) * 100),
    completed,
    blockers,
    nextAction: blockers[0] || "Ready for owner review, team access, and managed growth ops.",
  };
}

function defaultSlot(slotId) {
  const slotKind = SLOT_META[slotId]?.kind || "active";
  const slot = {
    slotId,
    slotKind,
    status: "empty",
    organizationName: "",
    businessTemplate: "",
    modules: defaultModules(),
    servicesPackages: [],
    leadSources: [],
    socialMediaWorkflow: { enabled: false, platforms: [], cadence: "", assetSource: "", approvalRequired: true, notes: "" },
    approvalRules: { requireOwnerApproval: true, requireClientApproval: false, outboundPublishing: "approval_required", spendApprovalThreshold: "", notes: "" },
    reportingPreferences: { cadence: "", metrics: [], recipients: "", notes: "" },
    updatedAt: new Date().toISOString(),
    updatedBy: "local",
  };
  slot.completeness = computeCompleteness(slot);
  return slot;
}

function defaultDocument(tenantId = currentTenantId()) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    tenantId,
    version: 1,
    slots: SLOT_IDS.map(defaultSlot),
    audit: [],
    updatedAt: now,
    updatedBy: "local",
  };
}

function normalizeDoc(document) {
  const base = defaultDocument(document?.tenantId || currentTenantId());
  const slots = SLOT_IDS.map((slotId) => {
    const existing = document?.slots?.find?.((slot) => slot.slotId === slotId);
    const slot = {
      ...defaultSlot(slotId),
      ...(existing || {}),
      slotId,
      slotKind: SLOT_META[slotId]?.kind || "active",
      modules: { ...defaultModules(), ...(existing?.modules || {}) },
      servicesPackages: Array.isArray(existing?.servicesPackages) ? existing.servicesPackages : [],
      leadSources: Array.isArray(existing?.leadSources) ? existing.leadSources : [],
      socialMediaWorkflow: { ...defaultSlot(slotId).socialMediaWorkflow, ...(existing?.socialMediaWorkflow || {}) },
      approvalRules: { ...defaultSlot(slotId).approvalRules, ...(existing?.approvalRules || {}) },
      reportingPreferences: { ...defaultSlot(slotId).reportingPreferences, ...(existing?.reportingPreferences || {}) },
    };
    slot.completeness = computeCompleteness(slot);
    return slot;
  });
  return { ...base, ...(document || {}), slots };
}

function localKey(tenantId = currentTenantId()) {
  return `pf.clientSetup.v1::${tenantId}`;
}

function loadLocalDocument(tenantId = currentTenantId()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(localKey(tenantId)) || "null");
    return normalizeDoc(parsed || defaultDocument(tenantId));
  } catch {
    return defaultDocument(tenantId);
  }
}

function saveLocalDocument(document) {
  localStorage.setItem(localKey(document.tenantId || currentTenantId()), JSON.stringify(document));
}

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

function friendlyClientSetupError(status, message = "") {
  const text = String(message || "");
  if (status === 401 || /authorization bearer/i.test(text)) return "Sign in to load server-backed Client Setup.";
  return text || `Request failed (${status}).`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyClientSetupError(response.status, payload?.error));
  return payload;
}

function templateByKey(templates, key) {
  return templates.find((template) => template.key === key);
}

function applyTemplate(slot, template) {
  if (!template) return;
  slot.businessTemplate = template.key;
  slot.modules = Object.fromEntries(MODULES.map((module) => [module.id, (template.recommendedModules || []).includes(module.id)]));
  slot.servicesPackages = (template.starterPackages?.length ? template.starterPackages : [
    { name: `${template.label} setup package`, price: "", cadence: "one-time", notes: "Define offer, intake, approvals, and reporting." },
    { name: "Managed growth operations", price: "", cadence: "monthly", notes: "Run approved lead, follow-up, content, and reporting workflows." },
  ]).map((item) => ({ id: cleanId(), name: item.name || "", price: item.price || "", cadence: item.cadence || "", notes: item.notes || "" }));
  slot.leadSources = (template.starterLeadSources?.length ? template.starterLeadSources : [
    { label: "Website form", type: "owned", notes: "Owned intake and qualification." },
    { label: "Social messages", type: "social", notes: "Manual import until OAuth is connected." },
    { label: "Referral partners", type: "relationship", notes: "Warm lead source." },
  ]).map((item) => ({ id: cleanId(), label: item.label || "", type: item.type || "", enabled: true, notes: item.notes || "" }));
  slot.socialMediaWorkflow.enabled = (template.recommendedModules || []).includes("content_calendar") || (template.recommendedModules || []).includes("media_assets");
  slot.socialMediaWorkflow.approvalRequired = true;
  slot.reportingPreferences.metrics = template.reportingMetrics || [];
  slot.completeness = computeCompleteness(slot);
}

function slotTitle(slot) {
  return slot.organizationName || SLOT_META[slot.slotId]?.label || slot.slotId;
}

function renderStatusControls(slot) {
  const activeValue = slot.slotKind === "pending" ? "pending" : "active";
  const activeLabel = slot.slotKind === "pending" ? "Pending" : "Active";
  return `
    <div class="cs-seg" role="group" aria-label="Slot status">
      <button type="button" class="${slot.status === activeValue ? "is-active" : ""}" data-cs-status="${activeValue}">${activeLabel}</button>
      <button type="button" class="${slot.status === "empty" ? "is-active" : ""}" data-cs-status="empty">Empty</button>
    </div>`;
}

function renderCompleteness(slot) {
  const completeness = computeCompleteness(slot);
  slot.completeness = completeness;
  return `
    <aside class="cs-completeness" data-cs-completeness>
      <div class="cs-score-row">
        <span>Setup completeness</span>
        <b data-cs-score>${completeness.score}%</b>
      </div>
      <div class="cs-meter"><i style="width:${completeness.score}%"></i></div>
      <div class="cs-next">
        <span>Next setup action</span>
        <b data-cs-next>${esc(completeness.nextAction)}</b>
      </div>
      <div class="cs-blockers">
        <span>Blockers</span>
        <ul data-cs-blockers>${completeness.blockers.map((item) => `<li>${esc(item)}</li>`).join("") || "<li>No setup blockers visible.</li>"}</ul>
      </div>
    </aside>`;
}

function syncCompleteness(root, slot) {
  const completeness = computeCompleteness(slot);
  slot.completeness = completeness;
  root.querySelector("[data-cs-score]")?.replaceChildren(document.createTextNode(`${completeness.score}%`));
  const meter = root.querySelector(".cs-meter i");
  if (meter) meter.style.width = `${completeness.score}%`;
  root.querySelector("[data-cs-next]")?.replaceChildren(document.createTextNode(completeness.nextAction));
  const blockers = root.querySelector("[data-cs-blockers]");
  if (blockers) blockers.innerHTML = completeness.blockers.map((item) => `<li>${esc(item)}</li>`).join("") || "<li>No setup blockers visible.</li>";
}

function renderSlotList(state) {
  return state.document.slots.map((slot) => `
    <button type="button" class="cs-slot ${state.selectedSlotId === slot.slotId ? "is-active" : ""}" data-cs-slot="${esc(slot.slotId)}">
      <span>${esc(SLOT_META[slot.slotId]?.statusLabel || slot.slotId)}</span>
      <b>${esc(slotTitle(slot))}</b>
      <i>${slot.completeness?.score ?? computeCompleteness(slot).score}% complete · ${esc(slot.status)}</i>
    </button>`).join("");
}

function renderModuleToggles(slot, modules) {
  return modules.map((module) => `
    <label class="cs-toggle">
      <input type="checkbox" data-cs-module="${esc(module.id)}" ${slot.modules?.[module.id] ? "checked" : ""} />
      <span><b>${esc(module.label)}</b><i>${esc(module.description)}</i></span>
    </label>`).join("");
}

function renderServices(slot) {
  const rows = slot.servicesPackages || [];
  return rows.map((item, index) => `
    <div class="cs-mini-row" data-cs-service-row="${index}">
      <input value="${esc(item.name)}" data-cs-service-field="name" data-cs-index="${index}" placeholder="Service/package name" />
      <input value="${esc(item.price)}" data-cs-service-field="price" data-cs-index="${index}" placeholder="Price" />
      <input value="${esc(item.cadence)}" data-cs-service-field="cadence" data-cs-index="${index}" placeholder="Cadence" />
      <button type="button" data-cs-remove-service="${index}" aria-label="Remove service">×</button>
      <textarea data-cs-service-field="notes" data-cs-index="${index}" placeholder="What this includes">${esc(item.notes)}</textarea>
    </div>`).join("") || `<p class="cs-empty">No packages configured yet.</p>`;
}

function renderLeadSources(slot) {
  const rows = slot.leadSources || [];
  return rows.map((item, index) => `
    <div class="cs-mini-row cs-lead-row" data-cs-lead-row="${index}">
      <label class="cs-mini-check"><input type="checkbox" data-cs-lead-enabled="${index}" ${item.enabled !== false ? "checked" : ""} /> Enabled</label>
      <input value="${esc(item.label)}" data-cs-lead-field="label" data-cs-index="${index}" placeholder="Lead source" />
      <input value="${esc(item.type)}" data-cs-lead-field="type" data-cs-index="${index}" placeholder="Type" />
      <button type="button" data-cs-remove-lead="${index}" aria-label="Remove lead source">×</button>
      <textarea data-cs-lead-field="notes" data-cs-index="${index}" placeholder="How Phantom should treat this source">${esc(item.notes)}</textarea>
    </div>`).join("") || `<p class="cs-empty">No lead sources configured yet.</p>`;
}

function renderEditor(state) {
  const slot = state.document.slots.find((item) => item.slotId === state.selectedSlotId) || state.document.slots[0];
  const templates = state.templates.length ? state.templates : TEMPLATES;
  const modules = state.modules.length ? state.modules : MODULES;
  const selectedTemplate = templateByKey(templates, slot.businessTemplate);
  return `
    <div class="cs-editor" data-cs-editor>
      <section class="cs-primary-panel">
        <div class="cs-panel-head">
          <div>
            <p>${esc(SLOT_META[slot.slotId]?.label || slot.slotId)}</p>
            <h2>${esc(slotTitle(slot))}</h2>
          </div>
          ${renderStatusControls(slot)}
        </div>
        <div class="cs-grid-two">
          <label class="cs-field">
            <span>Organization name</span>
            <input value="${esc(slot.organizationName)}" data-cs-slot-field="organizationName" placeholder="Type the real client or workspace name" />
          </label>
          <label class="cs-field">
            <span>Business template/type</span>
            <select data-cs-template>
              <option value="">Choose a template</option>
              ${templates.map((template) => `<option value="${esc(template.key)}" ${slot.businessTemplate === template.key ? "selected" : ""}>${esc(template.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="cs-template-action">
          <p>${esc(selectedTemplate?.description || "Templates fill recommended modules, starter packages, lead sources, and report metrics. Nothing is posted or sent.")}</p>
          <button type="button" data-cs-apply-template ${slot.businessTemplate ? "" : "disabled"}>Apply template defaults</button>
        </div>
      </section>

      <div class="cs-editor-grid">
        <section class="cs-panel">
          <div class="cs-panel-head"><div><p>Modules</p><h3>Managed Growth Ops</h3></div></div>
          <div class="cs-toggle-grid">${renderModuleToggles(slot, modules)}</div>
        </section>
        ${renderCompleteness(slot)}
      </div>

      <section class="cs-panel">
        <div class="cs-panel-head"><div><p>Services/packages</p><h3>What they sell</h3></div><button type="button" data-cs-add-service>+ Add package</button></div>
        <div class="cs-mini-list">${renderServices(slot)}</div>
      </section>

      <section class="cs-panel">
        <div class="cs-panel-head"><div><p>Lead sources</p><h3>Where prospects come from</h3></div><button type="button" data-cs-add-lead>+ Add source</button></div>
        <div class="cs-mini-list">${renderLeadSources(slot)}</div>
      </section>

      <section class="cs-panel">
        <div class="cs-panel-head"><div><p>Social/media workflow</p><h3>How content gets created and approved</h3></div></div>
        <div class="cs-grid-two">
          <label class="cs-toggle cs-toggle-compact"><input type="checkbox" data-cs-social-field="enabled" ${slot.socialMediaWorkflow.enabled ? "checked" : ""} /><span><b>Enable workflow</b><i>Use media, captions, and approvals for this client.</i></span></label>
          <label class="cs-toggle cs-toggle-compact"><input type="checkbox" data-cs-social-field="approvalRequired" ${slot.socialMediaWorkflow.approvalRequired ? "checked" : ""} /><span><b>Require approval</b><i>No publishing without approval.</i></span></label>
          <label class="cs-field"><span>Cadence</span><input value="${esc(slot.socialMediaWorkflow.cadence)}" data-cs-social-field="cadence" placeholder="Example: 3 posts/week" /></label>
          <label class="cs-field"><span>Asset source</span><input value="${esc(slot.socialMediaWorkflow.assetSource)}" data-cs-social-field="assetSource" placeholder="Media pool, client uploads, shoot days" /></label>
        </div>
        <div class="cs-platforms">
          ${SOCIAL_PLATFORMS.map((platform) => `<label><input type="checkbox" data-cs-platform="${esc(platform)}" ${slot.socialMediaWorkflow.platforms?.includes(platform) ? "checked" : ""} /> ${esc(platform)}</label>`).join("")}
        </div>
        <label class="cs-field"><span>Workflow notes</span><textarea data-cs-social-field="notes" placeholder="How Phantom should prepare this client's content">${esc(slot.socialMediaWorkflow.notes)}</textarea></label>
      </section>

      <section class="cs-panel">
        <div class="cs-panel-head"><div><p>Approval rules</p><h3>What needs a human yes</h3></div></div>
        <div class="cs-grid-two">
          <label class="cs-toggle cs-toggle-compact"><input type="checkbox" data-cs-approval-field="requireOwnerApproval" ${slot.approvalRules.requireOwnerApproval ? "checked" : ""} /><span><b>Owner approval</b><i>Business owner approves outbound work.</i></span></label>
          <label class="cs-toggle cs-toggle-compact"><input type="checkbox" data-cs-approval-field="requireClientApproval" ${slot.approvalRules.requireClientApproval ? "checked" : ""} /><span><b>Client approval</b><i>Client admin approves where required.</i></span></label>
          <label class="cs-field"><span>Outbound publishing</span><select data-cs-approval-field="outboundPublishing">
            <option value="approval_required" ${slot.approvalRules.outboundPublishing === "approval_required" ? "selected" : ""}>Approval required</option>
            <option value="draft_only" ${slot.approvalRules.outboundPublishing === "draft_only" ? "selected" : ""}>Draft only</option>
            <option value="manual_only" ${slot.approvalRules.outboundPublishing === "manual_only" ? "selected" : ""}>Manual only</option>
          </select></label>
          <label class="cs-field"><span>Spend approval threshold</span><input value="${esc(slot.approvalRules.spendApprovalThreshold)}" data-cs-approval-field="spendApprovalThreshold" placeholder="Example: any paid spend" /></label>
        </div>
        <label class="cs-field"><span>Approval notes</span><textarea data-cs-approval-field="notes" placeholder="Rules, reviewers, exceptions">${esc(slot.approvalRules.notes)}</textarea></label>
      </section>

      <section class="cs-panel">
        <div class="cs-panel-head"><div><p>Reporting preferences</p><h3>How results get reviewed</h3></div></div>
        <div class="cs-grid-two">
          <label class="cs-field"><span>Cadence</span><input value="${esc(slot.reportingPreferences.cadence)}" data-cs-report-field="cadence" placeholder="Weekly, monthly, launch-based" /></label>
          <label class="cs-field"><span>Recipients</span><input value="${esc(slot.reportingPreferences.recipients)}" data-cs-report-field="recipients" placeholder="Owner/admin names or roles" /></label>
        </div>
        <div class="cs-platforms cs-metrics">
          ${METRICS.map((metric) => `<label><input type="checkbox" data-cs-metric="${esc(metric)}" ${slot.reportingPreferences.metrics?.includes(metric) ? "checked" : ""} /> ${esc(metric.replaceAll("_", " "))}</label>`).join("")}
        </div>
        <label class="cs-field"><span>Report notes</span><textarea data-cs-report-field="notes" placeholder="What the owner needs to see">${esc(slot.reportingPreferences.notes)}</textarea></label>
      </section>
    </div>`;
}

function render(state) {
  state.root.innerHTML = `
    <section class="client-setup-console">
      <header class="cs-hero">
        <div>
          <p class="cs-kicker">Client onboarding machine</p>
          <h1>Owner Setup Console</h1>
          <span>Configure real customer workspaces before lead, follow-up, content, approval, and reporting operations begin.</span>
        </div>
        <div class="cs-status-strip">
          <b>${state.document.slots.filter((slot) => slot.slotKind === "active").length} active slots</b>
          <b>1 pending slot</b>
          <i>${state.serverBacked ? "Server-backed setup" : "Local setup draft only"}</i>
        </div>
      </header>
      ${state.message ? `<div class="cs-message ${state.serverBacked ? "" : "is-local"}">${esc(state.message)}</div>` : ""}
      <div class="cs-shell">
        <aside class="cs-sidebar">
          <div class="cs-sidebar-head">
            <span>Client slots</span>
            <b>${state.document.slots.filter((slot) => slot.status !== "empty").length}/3 configured</b>
          </div>
          ${renderSlotList(state)}
          <div class="cs-safety-note">No outreach, publishing, OAuth, or public exposure happens from this setup screen.</div>
        </aside>
        <main class="cs-main">
          ${state.loading ? `<div class="cs-loading">Loading setup console...</div>` : renderEditor(state)}
          <div class="cs-savebar">
            <span>${esc(state.saveNote || "Changes stay as draft setup until saved.")}</span>
            <button type="button" data-cs-save ${state.saving || !state.canManage ? "disabled" : ""}>${state.saving ? "Saving..." : state.canManage ? "Save setup" : "Owner/admin required"}</button>
          </div>
        </main>
      </div>
    </section>`;
  bind(state);
}

function currentSlot(state) {
  return state.document.slots.find((slot) => slot.slotId === state.selectedSlotId) || state.document.slots[0];
}

function markChanged(state) {
  const slot = currentSlot(state);
  slot.completeness = computeCompleteness(slot);
  state.saveNote = "Unsaved setup changes.";
  syncCompleteness(state.root, slot);
}

function bind(state) {
  state.root.querySelectorAll("[data-cs-slot]").forEach((button) => {
    button.onclick = () => { state.selectedSlotId = button.dataset.csSlot; render(state); };
  });
  state.root.querySelectorAll("[data-cs-status]").forEach((button) => {
    button.onclick = () => {
      currentSlot(state).status = button.dataset.csStatus;
      markChanged(state);
      render(state);
    };
  });
  state.root.querySelector("[data-cs-template]")?.addEventListener("change", (event) => {
    currentSlot(state).businessTemplate = event.target.value;
    markChanged(state);
    render(state);
  });
  state.root.querySelector("[data-cs-apply-template]")?.addEventListener("click", () => {
    const slot = currentSlot(state);
    applyTemplate(slot, templateByKey(state.templates.length ? state.templates : TEMPLATES, slot.businessTemplate));
    markChanged(state);
    render(state);
  });
  state.root.querySelector("[data-cs-add-service]")?.addEventListener("click", () => {
    currentSlot(state).servicesPackages.push({ id: cleanId(), name: "", price: "", cadence: "", notes: "" });
    markChanged(state);
    render(state);
  });
  state.root.querySelector("[data-cs-add-lead]")?.addEventListener("click", () => {
    currentSlot(state).leadSources.push({ id: cleanId(), label: "", type: "", enabled: true, notes: "" });
    markChanged(state);
    render(state);
  });
  state.root.querySelectorAll("[data-cs-remove-service]").forEach((button) => {
    button.onclick = () => {
      currentSlot(state).servicesPackages.splice(Number(button.dataset.csRemoveService), 1);
      markChanged(state);
      render(state);
    };
  });
  state.root.querySelectorAll("[data-cs-remove-lead]").forEach((button) => {
    button.onclick = () => {
      currentSlot(state).leadSources.splice(Number(button.dataset.csRemoveLead), 1);
      markChanged(state);
      render(state);
    };
  });
  state.root.querySelectorAll("[data-cs-module]").forEach((input) => {
    input.onchange = () => {
      currentSlot(state).modules[input.dataset.csModule] = input.checked;
      markChanged(state);
    };
  });
  state.root.querySelectorAll("[data-cs-platform]").forEach((input) => {
    input.onchange = () => {
      const slot = currentSlot(state);
      const set = new Set(slot.socialMediaWorkflow.platforms || []);
      if (input.checked) set.add(input.dataset.csPlatform);
      else set.delete(input.dataset.csPlatform);
      slot.socialMediaWorkflow.platforms = [...set];
      markChanged(state);
    };
  });
  state.root.querySelectorAll("[data-cs-metric]").forEach((input) => {
    input.onchange = () => {
      const slot = currentSlot(state);
      const set = new Set(slot.reportingPreferences.metrics || []);
      if (input.checked) set.add(input.dataset.csMetric);
      else set.delete(input.dataset.csMetric);
      slot.reportingPreferences.metrics = [...set];
      markChanged(state);
    };
  });
  state.root.querySelectorAll("[data-cs-lead-enabled]").forEach((input) => {
    input.onchange = () => {
      const lead = currentSlot(state).leadSources[Number(input.dataset.csLeadEnabled)];
      if (lead) lead.enabled = input.checked;
      markChanged(state);
    };
  });
  state.root.oninput = (event) => {
    const target = event.target;
    const slot = currentSlot(state);
    if (target.matches("[data-cs-slot-field]")) slot[target.dataset.csSlotField] = target.value;
    else if (target.matches("[data-cs-service-field]")) {
      const row = slot.servicesPackages[Number(target.dataset.csIndex)];
      if (row) row[target.dataset.csServiceField] = target.value;
    } else if (target.matches("[data-cs-lead-field]")) {
      const row = slot.leadSources[Number(target.dataset.csIndex)];
      if (row) row[target.dataset.csLeadField] = target.value;
    } else if (target.matches("[data-cs-social-field]")) {
      if (target.type === "checkbox") slot.socialMediaWorkflow[target.dataset.csSocialField] = target.checked;
      else slot.socialMediaWorkflow[target.dataset.csSocialField] = target.value;
    } else if (target.matches("[data-cs-approval-field]")) {
      if (target.type === "checkbox") slot.approvalRules[target.dataset.csApprovalField] = target.checked;
      else slot.approvalRules[target.dataset.csApprovalField] = target.value;
    } else if (target.matches("[data-cs-report-field]")) {
      slot.reportingPreferences[target.dataset.csReportField] = target.value;
    } else return;
    markChanged(state);
  };
  state.root.onchange = (event) => {
    const target = event.target;
    const slot = currentSlot(state);
    if (target.matches("[data-cs-social-field]") && target.type === "checkbox") slot.socialMediaWorkflow[target.dataset.csSocialField] = target.checked;
    else if (target.matches("[data-cs-approval-field]") && target.type === "checkbox") slot.approvalRules[target.dataset.csApprovalField] = target.checked;
    else if (target.matches("[data-cs-approval-field]")) slot.approvalRules[target.dataset.csApprovalField] = target.value;
    else return;
    markChanged(state);
  };
  state.root.querySelector("[data-cs-save]")?.addEventListener("click", () => save(state));
}

async function load(state) {
  state.loading = true;
  render(state);
  const tenant = currentTenantId();
  try {
    const payload = await loadClientSetupDocument(tenant);
    state.document = normalizeDoc(payload.document);
    state.templates = payload.templates || TEMPLATES;
    state.modules = payload.modules || MODULES;
    state.serverBacked = true;
    state.canManage = payload.can_manage !== false;
    state.message = state.canManage ? "" : "You can view setup, but saving requires workspace owner/admin access.";
  } catch (error) {
    state.document = loadLocalDocument(tenant);
    state.templates = TEMPLATES;
    state.modules = MODULES;
    state.serverBacked = false;
    state.canManage = true;
    state.message = `Local setup draft only. Backend setup API is unavailable: ${error.message}`;
  } finally {
    state.loading = false;
    render(state);
  }
}

export async function loadClientSetupDocument(tenant = currentTenantId()) {
  const payload = await api(`/api/client-setup?tenant_id=${encodeURIComponent(tenant)}`);
  return { ...payload, document: normalizeDoc(payload.document) };
}

async function save(state) {
  const slot = currentSlot(state);
  slot.completeness = computeCompleteness(slot);
  state.saving = true;
  state.saveNote = "Saving setup...";
  render(state);
  try {
    if (!state.serverBacked) {
      saveLocalDocument(state.document);
      state.saveNote = "Saved as a local setup draft.";
      state.message = "Local setup draft only. Connect the backend to save server-backed setup.";
      return;
    }
    const payload = await api(`/api/client-setup/slots/${encodeURIComponent(slot.slotId)}`, {
      method: "POST",
      body: JSON.stringify({ tenant_id: currentTenantId(), slot }),
    });
    state.document = normalizeDoc(payload.document);
    state.saveNote = "Saved to server-backed setup.";
    state.message = "Setup saved. No external sends, posts, or public routes were changed.";
  } catch (error) {
    saveLocalDocument(state.document);
    state.serverBacked = false;
    state.saveNote = "Saved locally after server save failed.";
    state.message = `Local setup draft only. Server save failed: ${error.message}`;
  } finally {
    state.saving = false;
    render(state);
  }
}

export function renderClientSetupConsole(root) {
  const state = {
    root,
    loading: true,
    saving: false,
    serverBacked: false,
    canManage: true,
    document: defaultDocument(currentTenantId()),
    selectedSlotId: "active-1",
    templates: TEMPLATES,
    modules: MODULES,
    message: "",
    saveNote: "",
  };
  load(state);
}
