import { currentTenantId, session } from "./store.js?v=phantom-live-20260711-198";

let activeConfiguration = null;
let activeEntitlements = null;
let activeVersions = [];

const clone = (value) => JSON.parse(JSON.stringify(value));
const authHeaders = (json = false) => {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
};

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : payload?.error?.formErrors?.join?.(" ") || payload?.error?.fieldErrors && Object.values(payload.error.fieldErrors).flat().join(" ") || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

function tenantQuery() {
  return `tenant_id=${encodeURIComponent(currentTenantId())}`;
}

export function currentCustomization() {
  return activeConfiguration;
}

export function applyOrganizationCustomization(configuration = activeConfiguration) {
  if (!configuration) return;
  activeConfiguration = configuration;
  const root = document.documentElement;
  root.style.setProperty("--neon", configuration.theme.primary);
  root.style.setProperty("--neon-2", configuration.theme.secondary);
  root.style.setProperty("--warn", configuration.theme.accent);
  root.style.setProperty("--org-radius", `${configuration.theme.radius}px`);
  root.style.setProperty("--org-font", `"${configuration.theme.font}", "Space Grotesk", sans-serif`);
  root.dataset.orgColorMode = configuration.theme.colorMode;
  root.dataset.orgDensity = configuration.theme.density;
  root.dataset.orgSurface = configuration.theme.surfaceStyle;
  document.body.dataset.brandMode = configuration.brand.mode;
  document.querySelectorAll("[data-organization-name]").forEach((node) => { node.textContent = configuration.brand.organizationName; });
  const sidebarBrand = document.querySelector(".side-brand-text b");
  if (sidebarBrand) sidebarBrand.textContent = configuration.brand.organizationName.toUpperCase();
  const mobileBrand = document.querySelector(".mobile-admin-brand b");
  if (mobileBrand) mobileBrand.textContent = configuration.brand.organizationName;
  if (configuration.brand.logoUrl) document.querySelectorAll(".brand-ghost").forEach((image) => { image.src = configuration.brand.logoUrl; });
}

export function customizeNavigation(baseItems, role = "owner") {
  if (!activeConfiguration) return baseItems;
  const states = new Map(activeConfiguration.modules.map((module) => [module.id, module]));
  return baseItems
    .filter((item) => {
      const state = states.get(item.id);
      if (!state) return true;
      return state.enabled && state.roles.includes(role);
    })
    .map((item) => {
      const state = states.get(item.id);
      return state ? { ...item, label: state.label, customizationOrder: state.order } : item;
    })
    .sort((left, right) => (left.customizationOrder ?? 999) - (right.customizationOrder ?? 999));
}

export async function loadOrganizationCustomization({ onApplied } = {}) {
  try {
    const payload = await api(`/phantom-ai/customization/config?${tenantQuery()}`);
    activeConfiguration = payload.configuration;
    activeEntitlements = payload.entitlements;
    applyOrganizationCustomization(activeConfiguration);
    if (typeof onApplied === "function") onApplied(activeConfiguration);
    return activeConfiguration;
  } catch (error) {
    console.warn("Workspace customization is unavailable; using PhantomForce defaults.", error);
    return null;
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function configurationPatch(configuration) {
  return {
    brand: configuration.brand,
    theme: configuration.theme,
    terminology: configuration.terminology,
    modules: configuration.modules,
    navigation: configuration.navigation,
    assistant: configuration.assistant,
    dashboards: configuration.dashboards,
    customObjects: configuration.customObjects,
    forms: configuration.forms,
    workflows: configuration.workflows,
    extensions: configuration.extensions,
    policies: configuration.policies,
  };
}

function issueMarkup(issues = []) {
  if (!issues.length) return `<p class="cust-ok">Ready to preview. No validation problems found.</p>`;
  return `<div class="cust-issues">${issues.map((issue) => `<p class="is-${esc(issue.severity)}"><b>${esc(issue.severity)}</b>${esc(issue.message)}</p>`).join("")}</div>`;
}

function moduleCards(draft) {
  return draft.modules.filter((module) => module.id !== "developer").sort((a, b) => a.order - b.order).map((module) => {
    const protectedModule = ["dashboard", "approvals", "customize", "settings"].includes(module.id);
    return `<article class="cust-module" data-cust-module="${esc(module.id)}">
      <span class="cust-module-grip">⋮⋮</span>
      <div><b>${esc(module.label)}</b><i>${esc(module.id)}${protectedModule ? " · required" : ""}</i></div>
      <input data-cust-module-label="${esc(module.id)}" value="${esc(module.label)}" maxlength="40" ${protectedModule ? "disabled" : ""} aria-label="${esc(module.label)} label" />
      <label class="cust-switch"><input type="checkbox" data-cust-module-enabled="${esc(module.id)}" ${module.enabled ? "checked" : ""} ${protectedModule ? "disabled" : ""}/><span></span></label>
    </article>`;
  }).join("");
}

function objectCards(draft) {
  if (!draft.customObjects.length) return `<div class="cust-empty"><b>No custom business records yet.</b><span>Create Athletes, Properties, Applicants, Cases, Locations, or anything else your organization manages.</span></div>`;
  return draft.customObjects.map((object) => `<article class="cust-object"><div><b>${esc(object.pluralLabel)}</b><i>${esc(object.id)} · ${object.fields.length} fields</i></div><button class="cust-icon-btn" type="button" data-cust-remove-object="${esc(object.id)}" aria-label="Remove ${esc(object.pluralLabel)}">×</button><div class="cust-field-list">${object.fields.map((field) => `<span>${esc(field.label)} · ${esc(field.type.replaceAll("_", " "))}</span>`).join("")}</div></article>`).join("");
}

function versionsMarkup() {
  if (!activeVersions.length) return `<p class="cust-muted">Version history will appear after the first published change.</p>`;
  return activeVersions.slice(0, 10).map((version) => `<article class="cust-version"><div><b>Version ${version.version}</b><i>${esc(version.summary)} · ${new Date(version.createdAt).toLocaleString()}</i></div><button class="cust-secondary" type="button" data-cust-rollback="${version.version}">Restore</button></article>`).join("");
}

function renderStudio(el, state, opts) {
  const { draft, preview, busy, message } = state;
  const whiteLabelAllowed = activeEntitlements?.whiteLabel;
  el.innerHTML = `<div class="customization-studio">
    <section class="cust-hero">
      <div><p class="cust-kicker">WORKSPACE STUDIO</p><h2>Make PhantomForce fit this business.</h2><p>Change the workspace above the security boundary. Preview first, publish when it looks right, and restore any earlier version.</p></div>
      <div class="cust-scope"><span>Editing</span><b>${esc(draft.brand.organizationName)}</b><i>Version ${draft.version} · Powered by PhantomForce</i></div>
    </section>
    ${message ? `<div class="cust-message">${esc(message)}</div>` : ""}
    <section class="cust-ai">
      <div><p class="cust-kicker">ASK PHANTOM</p><h3>Describe the workspace you want.</h3><p>Try “Change Clients to Athletes,” “Use #22ee88,” or “Make the assistant more professional.”</p></div>
      <form data-cust-ai-form><textarea name="message" rows="2" maxlength="1200" placeholder="Make this workspace feel like a football recruiting platform…"></textarea><button class="cust-primary" ${busy ? "disabled" : ""}>Create preview</button></form>
    </section>
    <div class="cust-grid">
      <section class="cust-panel"><div class="cust-panel-head"><div><p class="cust-kicker">BRAND + THEME</p><h3>Make it feel like yours.</h3></div><span class="cust-protected">Protected platform</span></div>
        <div class="cust-form-grid">
          <label>Business name<input data-cust-field="brand.organizationName" value="${esc(draft.brand.organizationName)}" maxlength="40"/></label>
          <label>Workspace name<input data-cust-field="brand.workspaceName" value="${esc(draft.brand.workspaceName)}" maxlength="40"/></label>
          <label>Brand mode<select data-cust-field="brand.mode"><option value="standard" ${draft.brand.mode === "standard" ? "selected" : ""}>Standard</option><option value="co_branded" ${draft.brand.mode === "co_branded" ? "selected" : ""}>Co-branded</option><option value="white_label" ${draft.brand.mode === "white_label" ? "selected" : ""} ${whiteLabelAllowed ? "" : "disabled"}>White-label · enterprise</option><option value="internal_phantomforce" ${draft.brand.mode === "internal_phantomforce" ? "selected" : ""} ${activeEntitlements?.internalPhantomForce ? "" : "disabled"}>Internal PhantomForce</option></select></label>
          <label>Font<select data-cust-field="theme.font">${["Space Grotesk", "Inter", "DM Sans", "IBM Plex Sans", "Source Sans 3"].map((font) => `<option ${font === draft.theme.font ? "selected" : ""}>${font}</option>`).join("")}</select></label>
          <label>Primary color<input type="color" data-cust-field="theme.primary" value="${esc(draft.theme.primary)}"/></label>
          <label>Accent color<input type="color" data-cust-field="theme.accent" value="${esc(draft.theme.accent)}"/></label>
          <label>Density<select data-cust-field="theme.density"><option value="comfortable" ${draft.theme.density === "comfortable" ? "selected" : ""}>Comfortable</option><option value="compact" ${draft.theme.density === "compact" ? "selected" : ""}>Compact</option></select></label>
          <label>Assistant tone<select data-cust-field="assistant.tone">${["direct", "professional", "friendly", "energetic", "concise"].map((tone) => `<option ${tone === draft.assistant.tone ? "selected" : ""}>${tone}</option>`).join("")}</select></label>
        </div>
      </section>
      <section class="cust-panel cust-modules"><div class="cust-panel-head"><div><p class="cust-kicker">NAVIGATION + MODULES</p><h3>Show only what this team needs.</h3></div><button class="cust-secondary" type="button" data-cust-defaults>Restore defaults</button></div>${moduleCards(draft)}</section>
      <section class="cust-panel"><div class="cust-panel-head"><div><p class="cust-kicker">BUSINESS RECORDS</p><h3>Model the work your way.</h3></div></div>${objectCards(draft)}
        <form class="cust-object-form" data-cust-object-form><input name="plural" placeholder="Athletes" maxlength="40" required/><input name="singular" placeholder="Athlete" maxlength="40" required/><input name="fields" placeholder="Name:text, Email:email, Status:status"/><button class="cust-secondary">Add record type</button></form>
      </section>
      <section class="cust-panel"><div class="cust-panel-head"><div><p class="cust-kicker">VERSION HISTORY</p><h3>Every publish is reversible.</h3></div></div><div data-cust-versions>${versionsMarkup()}</div></section>
    </div>
    <section class="cust-publish"><div><p class="cust-kicker">CHANGE REVIEW</p><h3>${preview ? `Preview version ${preview.proposedVersion}` : "Preview before publishing"}</h3>${issueMarkup(preview?.issues)}</div><div class="cust-publish-actions"><button class="cust-secondary" type="button" data-cust-preview ${busy ? "disabled" : ""}>Preview changes</button><button class="cust-primary" type="button" data-cust-publish ${!preview?.valid || busy ? "disabled" : ""}>Publish workspace</button></div></section>
  </div>`;
  bindStudio(el, state, opts);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  while (parts.length > 1) cursor = cursor[parts.shift()];
  cursor[parts[0]] = value;
}

function parseObjectFields(value) {
  const typeMap = { text: "short_text", email: "email", phone: "phone", number: "number", date: "date", status: "status", money: "currency", checkbox: "checkbox" };
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean).map((entry, index) => {
    const [labelRaw, typeRaw] = entry.split(":").map((part) => part.trim());
    const label = labelRaw || `Field ${index + 1}`;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `field_${index + 1}`;
    return { id, label, type: typeMap[typeRaw?.toLowerCase()] || "short_text", required: false, options: [], readOnly: false };
  });
}

async function fetchVersions() {
  const payload = await api(`/phantom-ai/customization/versions?${tenantQuery()}`);
  activeVersions = payload.versions || [];
}

function bindStudio(el, state, opts) {
  el.querySelectorAll("[data-cust-field]").forEach((input) => {
    input.onchange = () => {
      setPath(state.draft, input.dataset.custField, input.value);
      state.preview = null;
      if (input.type === "color") applyOrganizationCustomization(state.draft);
    };
  });
  el.querySelectorAll("[data-cust-module-label]").forEach((input) => { input.onchange = () => { const module = state.draft.modules.find((item) => item.id === input.dataset.custModuleLabel); if (module) module.label = input.value; state.preview = null; }; });
  el.querySelectorAll("[data-cust-module-enabled]").forEach((input) => { input.onchange = () => { const module = state.draft.modules.find((item) => item.id === input.dataset.custModuleEnabled); if (module) module.enabled = input.checked; state.preview = null; }; });
  el.querySelector("[data-cust-object-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const plural = String(data.get("plural") || "").trim();
    const singular = String(data.get("singular") || "").trim();
    const id = plural.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    if (!id) return;
    state.draft.customObjects.push({ id, singularLabel: singular, pluralLabel: plural, icon: "db", fields: parseObjectFields(data.get("fields")), rolePermissions: { owner: ["view", "create", "edit", "delete", "export"], admin: ["view", "create", "edit"] } });
    state.preview = null;
    renderStudio(el, state, opts);
  });
  el.querySelectorAll("[data-cust-remove-object]").forEach((button) => { button.onclick = () => { state.draft.customObjects = state.draft.customObjects.filter((object) => object.id !== button.dataset.custRemoveObject); state.preview = null; renderStudio(el, state, opts); }; });
  const runPreview = async (patch = configurationPatch(state.draft)) => {
    state.busy = true; state.message = "Checking the workspace change…"; renderStudio(el, state, opts);
    try {
      const payload = await api("/phantom-ai/customization/preview", { method: "POST", body: JSON.stringify({ tenant_id: currentTenantId(), patch }) });
      state.preview = payload.preview; state.pendingPatch = patch; state.draft = clone(payload.preview.candidate); state.message = payload.preview.valid ? "Preview ready. Nothing has changed for the organization yet." : "Fix the highlighted items before publishing.";
    } catch (error) { state.preview = null; state.message = error.message; }
    state.busy = false; renderStudio(el, state, opts);
  };
  el.querySelector("[data-cust-preview]")?.addEventListener("click", () => runPreview());
  el.querySelector("[data-cust-publish]")?.addEventListener("click", async () => {
    if (!state.preview?.valid) return;
    state.busy = true; state.message = "Publishing this organization version…"; renderStudio(el, state, opts);
    try {
      const payload = await api("/phantom-ai/customization/publish", { method: "POST", body: JSON.stringify({ tenant_id: currentTenantId(), patch: state.pendingPatch || configurationPatch(state.draft), expected_version: activeConfiguration.version, summary: "Published from Workspace Studio" }) });
      activeConfiguration = payload.result.configuration; state.draft = clone(activeConfiguration); state.preview = null; state.pendingPatch = null; state.message = `Version ${activeConfiguration.version} is live for this organization.`; applyOrganizationCustomization(activeConfiguration); await fetchVersions(); if (typeof opts.onApplied === "function") opts.onApplied(activeConfiguration);
    } catch (error) { state.message = error.message; }
    state.busy = false; renderStudio(el, state, opts);
  });
  el.querySelector("[data-cust-ai-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message"); if (!String(message || "").trim()) return;
    state.busy = true; state.message = "Phantom is mapping that request to safe workspace settings…"; renderStudio(el, state, opts);
    try { const payload = await api("/phantom-ai/customization/assistant-plan", { method: "POST", body: JSON.stringify({ tenant_id: currentTenantId(), message }) }); state.preview = payload.preview; state.pendingPatch = payload.plan.patch; state.draft = clone(payload.preview.candidate); state.message = payload.plan.explanations.join(" "); }
    catch (error) { state.message = error.message; }
    state.busy = false; renderStudio(el, state, opts);
  });
  el.querySelectorAll("[data-cust-rollback]").forEach((button) => { button.onclick = async () => { state.busy = true; state.message = `Restoring version ${button.dataset.custRollback}…`; renderStudio(el, state, opts); try { const payload = await api("/phantom-ai/customization/rollback", { method: "POST", body: JSON.stringify({ tenant_id: currentTenantId(), version: Number(button.dataset.custRollback) }) }); activeConfiguration = payload.result.configuration; state.draft = clone(activeConfiguration); state.preview = null; applyOrganizationCustomization(activeConfiguration); await fetchVersions(); state.message = `Restored as version ${activeConfiguration.version}.`; if (typeof opts.onApplied === "function") opts.onApplied(activeConfiguration); } catch (error) { state.message = error.message; } state.busy = false; renderStudio(el, state, opts); }; });
  el.querySelector("[data-cust-defaults]")?.addEventListener("click", async () => {
    if (!window.confirm("Restore the PhantomForce workspace layout? Organization records and files will stay intact.")) return;
    state.busy = true; state.message = "Restoring safe defaults…"; renderStudio(el, state, opts);
    try { const payload = await api("/phantom-ai/customization/reset", { method: "POST", body: JSON.stringify({ tenant_id: currentTenantId() }) }); activeConfiguration = payload.result.configuration; state.draft = clone(activeConfiguration); state.preview = null; applyOrganizationCustomization(activeConfiguration); await fetchVersions(); state.message = "PhantomForce defaults restored. Organization data was not deleted."; if (typeof opts.onApplied === "function") opts.onApplied(activeConfiguration); } catch (error) { state.message = error.message; }
    state.busy = false; renderStudio(el, state, opts);
  });
}

export async function renderCustomizationStudio(el, opts = {}) {
  el.innerHTML = `<div class="cust-loading">Loading this organization’s workspace settings…</div>`;
  if (!activeConfiguration || activeConfiguration.tenantId !== currentTenantId()) await loadOrganizationCustomization();
  if (!activeConfiguration) { el.innerHTML = `<div class="cust-empty"><b>Workspace Studio could not load.</b><span>Check the private backend connection and try again.</span></div>`; return; }
  try { await fetchVersions(); } catch { activeVersions = []; }
  renderStudio(el, { draft: clone(activeConfiguration), preview: null, pendingPatch: null, busy: false, message: "" }, opts);
}
