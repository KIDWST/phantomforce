/* PhantomForce — organization membership and workspace access.
 *
 * Person-first, not module-first: the owner/admin sees everyone in the
 * organization, sets each person's role, invites new people, and decides
 * which parts of PhantomForce each role can open. A dev shop can hire
 * employees with limited access or broad access; that decision belongs to
 * the organization owner, so every control here writes to the real org APIs
 * (database memberships + the published workspace configuration), never
 * to a local mock.
 */

import { currentTenantId, session, isAdmin, isOwnerOperator } from "./store.js?v=phantom-live-20260718-22";
import { canManageActiveOrg } from "./orgs.js?v=phantom-live-20260718-22";

/* Owner/admin only — legacy local-admin sessions (isAdmin/isOwnerOperator)
   and real database org sessions (canManageActiveOrg) both count. */
const canManageOrganization = () => isAdmin() || isOwnerOperator() || canManageActiveOrg();

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
/* Required modules (module-registry.ts required:true) — access, approvals,
   and recovery. Owner can't uncheck their own access to these from the
   matrix: it's how an owner finds their way back if they lock down
   everything else, and there's no recovery path if they lock themselves
   out of it too. */
const OWNER_LOCKED_MODULES = new Set(["dashboard", "approvals", "settings"]);

const orgState = {
  loading: false,
  loaded: false,
  error: "",
  needsDatabase: false,
  org: null,
  members: [],
  invitations: [],
  configVersion: 0,
  orgType: "business",
  modules: [],
  matrixDirty: false,
  message: "",
  busy: false,
};

const ORG_TYPES = [
  { id: "dev_only", label: "Dev Only", blurb: "Sandbox for building and testing — every module unlocked, safe to break." },
  { id: "business", label: "Business", blurb: "A normal single-business operator. The standard setup." },
  { id: "full_force", label: "Full Force", blurb: "Multi-business/agency operator running every module at once." },
];

function orgTypeMarkup(esc) {
  return `
    <div class="org-type-picker">
      ${ORG_TYPES.map((type) => `
        <button class="org-type-option ${orgState.orgType === type.id ? "is-active" : ""}" type="button" data-org-type="${type.id}">
          <b>${esc(type.label)}</b>
          <i>${esc(type.blurb)}</i>
        </button>`).join("")}
    </div>
    <p class="set-note">Switching to Dev Only or Full Force unlocks every module for this organization. It never turns modules off for you — switch back to Business and your setup stays as you left it.</p>`;
}

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
    orgState.orgType = configPayload.configuration?.orgType || "business";
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

function membersMarkup(esc, canManage) {
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
        <select data-org-role="${esc(member.userId)}" ${canManage ? "" : "disabled"}>
          ${MEMBERSHIP_ROLES.map((role) => `<option value="${role}" ${member.role === role ? "selected" : ""}>${esc(ROLES.find((r) => r.id === role)?.label || role)}</option>`).join("")}
        </select>
        <i>${esc(roleBlurb(member.role))}</i>
      </label>
      ${canManage ? `<button class="org-remove" type="button" data-org-remove="${esc(member.userId)}" title="Remove from organization">✕</button>` : ""}
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

function matrixMarkup(esc, canManage) {
  if (!orgState.modules.length) return `<p class="set-note">The workspace configuration hasn't loaded, so the access matrix is unavailable right now.</p>`;
  return `
    <div class="org-matrix-wrap">
      <table class="org-matrix">
        <thead><tr><th>Module</th>${ROLES.map((role) => `<th title="${esc(role.blurb)}">${esc(role.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${orgState.modules.map((module) => `
            <tr class="${module.enabled ? "" : "is-off"}">
              <td><b>${esc(module.label)}</b>${module.enabled ? "" : `<i>module off</i>`}</td>
              ${ROLES.map((role) => `<td><input type="checkbox" data-org-matrix="${esc(module.id)}:${role.id}" ${module.roles.includes(role.id) ? "checked" : ""} ${!canManage || (OWNER_LOCKED_MODULES.has(module.id) && role.id === "owner") ? "disabled" : ""} /></td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="set-actions-row">
      ${canManage ? `<button class="btn btn-primary" type="button" data-org-matrix-save ${orgState.matrixDirty ? "" : "disabled"}>Publish access changes</button>` : ""}
      <span class="set-note">${canManage
        ? (orgState.matrixDirty ? "Unpublished changes — nothing applies until you publish." : "Checked = that role can open the module. Publishing creates a reversible workspace version.")
        : "This access map is read-only for your role. An owner or admin can publish changes."}</span>
    </div>`;
}

export function renderOrganizationPanel(el, opts = {}) {
  const esc = opts.esc || ((value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const canManage = canManageOrganization();
  if (!orgState.loaded && !orgState.loading) {
    loadOrganization().then(() => renderOrganizationPanel(el, opts));
  }
  if (orgState.loading || (!orgState.loaded && !orgState.error)) {
    el.innerHTML = `<div class="set-section"><p class="set-note">Loading your organization…</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="set-section">
      <p class="set-eyebrow">Workspace organization</p>
      <h3>People &amp; access</h3>
      <p class="set-note">Manage the organization behind this workspace: employees, invitations, roles, and the PhantomForce modules each role can open. Client leads and pipeline remain in Clients.</p>
      <div class="org-summary" aria-label="Organization summary">
        <span><b>Organization</b><i>${esc(orgState.org?.name || "Current workspace")}</i></span>
        <span><b>Members</b><i>${orgState.members.length}</i></span>
        <span><b>Pending invites</b><i>${orgState.invitations.length}</i></span>
        <span><b>Workspace type</b><i>${esc(ORG_TYPES.find((type) => type.id === orgState.orgType)?.label || orgState.orgType)}</i></span>
      </div>
      ${orgState.message ? `<p class="org-message">${esc(orgState.message)}</p>` : ""}
      ${orgState.error ? `<p class="org-message is-error">${esc(orgState.error)}</p>` : ""}
    </div>

    ${canManage ? `
    <div class="set-section org-type-card">
      <p class="set-eyebrow">Workspace profile</p>
      <h4>Choose how this organization operates</h4>
      ${orgTypeMarkup(esc)}
    </div>` : ""}

    ${orgState.needsDatabase ? `
      <div class="set-section org-db-note">
        <h4>People management needs the database connection</h4>
        <p class="set-note">Members and invitations live in the real PhantomForce database. Sign in through the owner login on the admin box (or set DATABASE_URL for this environment) and this section fills in with your actual organization.</p>
      </div>` : `
      <div class="set-section">
        <h4>Members (${orgState.members.length})</h4>
        <p class="set-note">These are people with access to this organization, not CRM prospects or clients.</p>
        ${membersMarkup(esc, canManage)}
      </div>
      ${canManage ? `<div class="set-section">
        <h4>Invite someone</h4>
        <p class="set-note">Invite an employee or collaborator, choose their starting role, and adjust their access at any time.</p>
        ${invitationsMarkup(esc)}
      </div>` : ""}`}

    <div class="set-section">
      <h4>Role access</h4>
      <p class="set-note">Control which PhantomForce modules each organization role can open.</p>
      ${matrixMarkup(esc, canManage)}
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

  el.querySelectorAll("[data-org-type]").forEach((button) => button.onclick = () => {
    const orgType = button.dataset.orgType;
    if (orgType === orgState.orgType) return;
    const label = ORG_TYPES.find((type) => type.id === orgType)?.label || orgType;
    withBusy(async () => {
      const tenant = currentTenantId();
      const patch = { orgType };
      await api("/phantom-ai/customization/publish", { method: "POST", body: JSON.stringify({ tenant_id: tenant, patch, expected_version: orgState.configVersion, summary: `Organization set up as ${label}` }) });
      orgState.orgType = orgType;
    }, `Organization set up as ${label}.`);
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
  orgState.org = null;
  orgState.members = [];
  orgState.invitations = [];
  orgState.modules = [];
}
