/* PhantomForce — Organization: the boss's control room for their people.
 *
 * Person-first, not module-first: the owner/admin sees everyone in the
 * organization, sets each person's role, invites new people, and decides
 * which parts of PhantomForce each role can open. A dev shop can hire
 * employees with far less access than the boss — or the same; that call
 * belongs to the boss, so every control here writes to the real org APIs
 * (database memberships + the published workspace configuration), never
 * to a local mock.
 */

import { currentTenantId, session } from "./store.js?v=phantom-live-20260714-271";

const ROLES = [
  { id: "owner", label: "Owner", blurb: "Everything, including billing and this page." },
  { id: "admin", label: "Admin", blurb: "Full workspace control, manages people and modules." },
  { id: "manager", label: "Manager", blurb: "Runs day-to-day operations and approvals." },
  { id: "member", label: "Member", blurb: "Works inside the tools their role can open." },
  { id: "client", label: "Client", blurb: "Portal access only — sees what you publish to them." },
];
/* Membership roles the database accepts today (manager is a module-visibility
   role, not yet a membership role — shown in the matrix, not the dropdown). */
const MEMBERSHIP_ROLES = ["owner", "admin", "member", "client"];

const orgState = {
  loading: false,
  loaded: false,
  error: "",
  needsDatabase: false,
  org: null,
  members: [],
  invitations: [],
  configVersion: 0,
  modules: [],
  matrixDirty: false,
  message: "",
  busy: false,
};

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadOrganization() {
  orgState.loading = true;
  orgState.error = "";
  orgState.needsDatabase = false;
  try {
    const orgsPayload = await api("/orgs");
    const orgs = orgsPayload.organizations || [];
    orgState.org = orgs.find((org) => org.role === "owner" || org.role === "admin") || orgs[0] || null;
    if (orgState.org) {
      const [membersPayload, invitationsPayload] = await Promise.all([
        api(`/orgs/${encodeURIComponent(orgState.org.id)}/members`),
        api(`/orgs/${encodeURIComponent(orgState.org.id)}/invitations`).catch(() => ({ invitations: [] })),
      ]);
      orgState.members = membersPayload.members || [];
      orgState.invitations = (invitationsPayload.invitations || []).filter((inv) => inv.status === "pending");
    }
  } catch (error) {
    /* No database session = the whole people section is honestly unavailable,
       not silently empty. 401/403 covers the local demo shortcut too. */
    if (error.status === 401 || error.status === 403 || /database/i.test(error.message)) {
      orgState.needsDatabase = true;
    } else {
      orgState.error = error.message;
    }
  }
  try {
    const configPayload = await api(`/phantom-ai/customization/config?tenant_id=${encodeURIComponent(currentTenantId())}`);
    orgState.configVersion = configPayload.configuration?.version || 0;
    orgState.modules = (configPayload.configuration?.modules || []).map((module) => ({
      id: module.id,
      label: module.label,
      enabled: module.enabled !== false,
      roles: Array.isArray(module.roles) ? [...module.roles] : [],
      raw: module,
    }));
  } catch (error) {
    if (!orgState.error && !orgState.needsDatabase) orgState.error = error.message;
  }
  orgState.loading = false;
  orgState.loaded = true;
}

function initialsFor(nameOrEmail) {
  const source = String(nameOrEmail || "?").trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function roleBlurb(roleId) {
  return ROLES.find((role) => role.id === roleId)?.blurb || "";
}

function membersMarkup(esc) {
  if (!orgState.members.length) {
    return `<p class="set-note">No one else is in this organization yet. Invite your first teammate below.</p>`;
  }
  return `<div class="org-members">${orgState.members.map((member) => `
    <div class="org-member" data-org-member="${esc(member.userId)}">
      <span class="org-avatar">${esc(initialsFor(member.name || member.email))}</span>
      <span class="org-member-id">
        <b>${esc(member.name || member.email)}</b>
        <i>${esc(member.email)}${member.isSuperAdmin ? " · platform admin" : ""} · joined ${esc(String(member.joinedAt).slice(0, 10))}</i>
      </span>
      <label class="org-role-pick">
        <select data-org-role="${esc(member.userId)}">
          ${MEMBERSHIP_ROLES.map((role) => `<option value="${role}" ${member.role === role ? "selected" : ""}>${esc(ROLES.find((r) => r.id === role)?.label || role)}</option>`).join("")}
        </select>
        <i>${esc(roleBlurb(member.role))}</i>
      </label>
      <button class="org-remove" type="button" data-org-remove="${esc(member.userId)}" title="Remove from organization">✕</button>
    </div>`).join("")}</div>`;
}

function invitationsMarkup(esc) {
  const pending = orgState.invitations;
  return `
    <form class="org-invite" data-org-invite-form>
      <input type="email" required placeholder="teammate@company.com" data-org-invite-email />
      <select data-org-invite-role>
        ${MEMBERSHIP_ROLES.filter((role) => role !== "owner").map((role) => `<option value="${role}" ${role === "member" ? "selected" : ""}>${esc(ROLES.find((r) => r.id === role)?.label || role)}</option>`).join("")}
      </select>
      <button class="btn btn-primary" type="submit">Invite</button>
    </form>
    ${pending.length ? `<div class="org-invite-list">${pending.map((inv) => `
      <div class="org-invite-row">
        <span><b>${esc(inv.email)}</b><i>${esc(ROLES.find((r) => r.id === inv.role)?.label || inv.role)} · expires ${esc(String(inv.expiresAt).slice(0, 10))}</i></span>
        <button class="org-remove" type="button" data-org-revoke="${esc(inv.id)}" title="Revoke invitation">✕</button>
      </div>`).join("")}</div>` : ""}`;
}

function matrixMarkup(esc) {
  if (!orgState.modules.length) return `<p class="set-note">The workspace configuration hasn't loaded, so the access matrix is unavailable right now.</p>`;
  return `
    <div class="org-matrix-wrap">
      <table class="org-matrix">
        <thead><tr><th>Module</th>${ROLES.map((role) => `<th title="${esc(role.blurb)}">${esc(role.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${orgState.modules.map((module) => `
            <tr class="${module.enabled ? "" : "is-off"}">
              <td><b>${esc(module.label)}</b>${module.enabled ? "" : `<i>module off</i>`}</td>
              ${ROLES.map((role) => `<td><input type="checkbox" data-org-matrix="${esc(module.id)}:${role.id}" ${module.roles.includes(role.id) ? "checked" : ""} ${module.id === "settings" && role.id === "owner" ? "disabled" : ""} /></td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="set-actions-row">
      <button class="btn btn-primary" type="button" data-org-matrix-save ${orgState.matrixDirty ? "" : "disabled"}>Publish access changes</button>
      <span class="set-note">${orgState.matrixDirty ? "Unpublished changes — nothing applies until you publish." : "Checked = that role can open the module. Publishing creates a reversible workspace version."}</span>
    </div>`;
}

export function renderOrganizationPanel(el, opts = {}) {
  const esc = opts.esc || ((value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  if (!orgState.loaded && !orgState.loading) {
    loadOrganization().then(() => renderOrganizationPanel(el, opts));
  }
  if (orgState.loading || (!orgState.loaded && !orgState.error)) {
    el.innerHTML = `<div class="set-section"><p class="set-note">Loading your organization…</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="set-section">
      <p class="set-eyebrow">Organization${orgState.org ? ` · ${esc(orgState.org.name)}` : ""}</p>
      <h3>Your people, your rules.</h3>
      <p class="set-note">Everyone here belongs to this business — not clients, your team. Set each person's role, and decide below exactly which parts of PhantomForce each role can open.</p>
      ${orgState.message ? `<p class="org-message">${esc(orgState.message)}</p>` : ""}
      ${orgState.error ? `<p class="org-message is-error">${esc(orgState.error)}</p>` : ""}
    </div>

    ${orgState.needsDatabase ? `
      <div class="set-section org-db-note">
        <h4>People management needs the database connection</h4>
        <p class="set-note">Members and invitations live in the real PhantomForce database. Sign in through the owner login on the admin box (or set DATABASE_URL for this environment) and this section fills in with your actual organization.</p>
      </div>` : `
      <div class="set-section">
        <h4>People (${orgState.members.length})</h4>
        ${membersMarkup(esc)}
      </div>
      <div class="set-section">
        <h4>Invite someone</h4>
        <p class="set-note">They get an email invitation and land with the role you pick — you can change it any time.</p>
        ${invitationsMarkup(esc)}
      </div>`}

    <div class="set-section">
      <h4>What each role can open</h4>
      ${matrixMarkup(esc)}
    </div>`;

  const rerender = () => renderOrganizationPanel(el, opts);
  const withBusy = async (work, doneMessage) => {
    if (orgState.busy) return;
    orgState.busy = true;
    orgState.message = "Working…";
    rerender();
    try {
      await work();
      orgState.message = doneMessage;
      await loadOrganization();
    } catch (error) {
      orgState.message = "";
      orgState.error = error.message;
    }
    orgState.busy = false;
    rerender();
  };

  el.querySelectorAll("[data-org-role]").forEach((select) => select.onchange = () => {
    const member = orgState.members.find((m) => m.userId === select.dataset.orgRole);
    if (!member) return;
    withBusy(
      () => api(`/orgs/${encodeURIComponent(orgState.org.id)}/members/${encodeURIComponent(member.userId)}/role`, { method: "POST", body: JSON.stringify({ role: select.value }) }),
      `${member.name || member.email} is now ${select.value}.`,
    );
  });

  el.querySelectorAll("[data-org-remove]").forEach((button) => button.onclick = () => {
    const member = orgState.members.find((m) => m.userId === button.dataset.orgRemove);
    if (!member) return;
    if (!window.confirm(`Remove ${member.name || member.email} from ${orgState.org?.name || "this organization"}? They lose access immediately.`)) return;
    withBusy(
      () => api(`/orgs/${encodeURIComponent(orgState.org.id)}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" }),
      `${member.name || member.email} was removed.`,
    );
  });

  const inviteForm = el.querySelector("[data-org-invite-form]");
  if (inviteForm) inviteForm.onsubmit = (event) => {
    event.preventDefault();
    const email = inviteForm.querySelector("[data-org-invite-email]")?.value?.trim();
    const role = inviteForm.querySelector("[data-org-invite-role]")?.value || "member";
    if (!email) return;
    withBusy(
      () => api(`/orgs/${encodeURIComponent(orgState.org.id)}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) }),
      `Invitation sent to ${email}.`,
    );
  };

  el.querySelectorAll("[data-org-revoke]").forEach((button) => button.onclick = () => {
    withBusy(
      () => api(`/orgs/${encodeURIComponent(orgState.org.id)}/invitations/${encodeURIComponent(button.dataset.orgRevoke)}/revoke`, { method: "POST" }),
      "Invitation revoked.",
    );
  });

  el.querySelectorAll("[data-org-matrix]").forEach((input) => input.onchange = () => {
    const [moduleId, roleId] = input.dataset.orgMatrix.split(":");
    const module = orgState.modules.find((m) => m.id === moduleId);
    if (!module) return;
    module.roles = input.checked ? [...new Set([...module.roles, roleId])] : module.roles.filter((r) => r !== roleId);
    orgState.matrixDirty = true;
    const saveButton = el.querySelector("[data-org-matrix-save]");
    if (saveButton) saveButton.disabled = false;
  });

  const matrixSave = el.querySelector("[data-org-matrix-save]");
  if (matrixSave) matrixSave.onclick = () => withBusy(async () => {
    /* Same contract Workspace Studio uses: validate as a preview, then
       publish a reversible version. The patch carries the full modules list
       with the edited roles arrays. */
    const patch = { modules: orgState.modules.map((module) => ({ ...module.raw, roles: module.roles })) };
    const tenant = currentTenantId();
    const preview = await api("/phantom-ai/customization/preview", { method: "POST", body: JSON.stringify({ tenant_id: tenant, patch }) });
    if (!preview.preview?.valid) {
      const issues = (preview.preview?.issues || []).map((issue) => issue.message).join(" ");
      throw new Error(issues || "The access change failed validation.");
    }
    await api("/phantom-ai/customization/publish", { method: "POST", body: JSON.stringify({ tenant_id: tenant, patch, expected_version: orgState.configVersion, summary: "Role access updated from Organization settings" }) });
    orgState.matrixDirty = false;
  }, "Access changes are live for the whole organization.");
}

/* Test hook: lets harnesses reset the module-level cache between scenarios. */
export function __resetOrganizationPanel() {
  orgState.loaded = false;
  orgState.loading = false;
  orgState.error = "";
  orgState.message = "";
  orgState.matrixDirty = false;
}
