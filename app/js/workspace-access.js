import { renderPrintOpportunities } from "./print-opportunity.js?v=phantom-live-20261026-245";
import { workspaceDirectory, filterWorkspaceDirectory } from "./workspace-directory.js?v=phantom-live-20261026-245";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function createWorkspaceCatalog({ getAccount, getToken, getTenant, onAccepted, fetcher = (...args) => globalThis.fetch(...args) }) {
  let items = null, status = "idle", revision = 0, owner = null, pending = null;
  return {
    get items() { return owner === getAccount() ? items : null; },
    get status() { return owner === getAccount() ? status : "idle"; },
    clear() { revision++; pending?.abort(); pending = null; items = null; status = "idle"; owner = null; },
    async load() {
      const account = getAccount(), tenant = getTenant(), token = getToken();
      if (owner !== account) { items = null; owner = account; }
      if (!token) { revision++; pending?.abort(); pending = null; items = null; status = "error"; return false; }
      const started = ++revision;
      pending?.abort();
      const controller = new AbortController(); pending = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      status = "loading";
      try {
        const response = await fetcher("/api/business-workspaces", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (started !== revision || account !== getAccount()) return false;
        if (tenant !== getTenant() || token !== getToken()) { status = "idle"; return false; }
        if (!response.ok || !Array.isArray(payload.workspaces)) throw new Error("Workspace access is unavailable.");
        items = payload.workspaces.filter(item => typeof item.tenantId === "string"); status = "ready";
        onAccepted(items);
        return true;
      } catch {
        if (started === revision && account === getAccount()) status = "error";
        return false;
      } finally { clearTimeout(timeout); if (pending === controller) pending = null; }
    },
  };
}

/** Use the server catalog when available. A profile name never grants access. */
export function workspaceChoices({ account = {}, catalog = null, workspaces = [], current = "" }) {
  let choices;
  if (Array.isArray(catalog)) choices = catalog.map(item => ({ id: item.tenantId, name: item.name, role: item.role, ...(typeof item.businessId === "string" && item.businessId ? { businessId: item.businessId } : {}) }));
  else if (account.database || account.localCustomer) choices = (account.memberships || []).map(item => ({ id: item.orgId, name: item.orgName, role: item.role }));
  else choices = account.role === "admin" ? workspaces : workspaces.filter(item => item.id === current);
  if (account.localCustomer) choices = choices.filter(item => item.id === account.orgId);
  const seen = new Set();
  return choices.filter(item => typeof item.id === "string" && item.id && !seen.has(item.id) && seen.add(item.id))
    .map(item => ({ id: item.id, name: String(item.name || item.id), role: String(item.role || "member"), ...(typeof item.businessId === "string" && item.businessId ? { businessId: item.businessId } : {}) }));
}

export function workspaceAccessMessage({ account = {}, count, status }) {
  if (status === "loading") return "Checking the workspaces available to this account…";
  if (status === "error") return "Workspace access could not be refreshed. Your current workspace is unchanged. Retry when the connection is available.";
  if (count > 1) return "Choose a workspace below. Each business keeps its own records, files and conversations.";
  if (account.localCustomer) return "This customer account has one workspace. To open PhantomForce, ChicagoShots or Occasionally Odd, sign in with an account that has access to those businesses.";
  return "Only one workspace is available to this account. Refresh access after an invitation, or use a different account.";
}

export function workspaceOptionMarkup(choices, current, account = {}) {
  const { primary } = workspaceDirectory({ choices, current, account });
  const placeholder = primary.some(item => item.id === current) ? "" : `<option value="${esc(current || "__unselected__")}" disabled selected>${!current || current === "__unselected__" ? "Choose a business…" : "Current workspace · unavailable"}</option>`;
  return placeholder + primary.map(item => `<option value="${esc(item.id)}" ${item.id === current ? "selected" : ""}>${esc(item.label)}</option>`).join("") + '<option value="__workspace_access__">Workspaces &amp; accounts…</option>';
}

let activeDialog = null;
export function closeWorkspaceAccess() { activeDialog?.close(); }

export function createWorkspaceAccessOpener(options) {
  let version = 0;
  const show = async (initialTool = false, notice = "") => {
    const request = ++version, snapshot = options.getSnapshot();
    const button = document.querySelector("[data-workspace-access]");
    button?.setAttribute("aria-busy", "true");
    try {
      await options.loadStyle("workspace-access", "/app/workspace-access.css?v=phantom-live-20261026-245");
    } catch {
      options.onError("Workspaces could not load. Check your connection and try the workspace button again.");
      return false;
    } finally { button?.removeAttribute("aria-busy"); }
    const current = options.getSnapshot();
    if (request !== version || snapshot.account !== current.account || snapshot.current !== current.current) return false;
    openWorkspaceAccess({ ...options, initialTool, notice,
      preparePrintStyles: () => options.loadStyle("print-analysis", "/app/commerce-workspace.css?v=phantom-live-20261026-245"),
    });
  };
  show.invalidate = () => { version++; };
  return show;
}

/** One native modal supplies focus trapping, Escape and focus restoration. */
export function openWorkspaceAccess({ getSnapshot, getToken = () => "", refresh, switchWorkspace, signOut, openAdminAccess = signOut, preparePrintStyles, initialTool = false, notice = "" }) {
  closeWorkspaceAccess();
  const opener = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "workspace-access-dialog";
  dialog.setAttribute("aria-labelledby", "workspace-access-title");
  document.body.append(dialog);
  activeDialog = dialog;
  let printMount = null, closed = false, refreshing = false, revision = 0;
  const cleanup = () => {
    closed = true; revision++; printMount?.destroy(); printMount = null;
    if (activeDialog === dialog) activeDialog = null;
    dialog.remove(); if (opener?.isConnected) opener.focus();
  };
  dialog.addEventListener("close", cleanup, { once: true });
  dialog.addEventListener("click", event => { if (event.target.closest("[data-access-close]")) dialog.close(); });

  function paint(notice = "") {
    if (closed) return;
    const snapshot = getSnapshot(), { account, current, choices, status } = snapshot;
    const directory = workspaceDirectory({ choices, current, account });
    const owner = directory.owner;
    const workspaceCard = item => `<button class="wa-workspace ${item.id === current ? "is-current" : ""}" type="button" data-access-workspace="${esc(item.id)}" ${item.id === current ? 'aria-current="true"' : ""} ${refreshing ? "disabled" : ""}><span class="wa-avatar">${esc(item.name.slice(0, 2).toUpperCase())}</span><span><strong>${esc(item.label)}</strong><small>${esc(item.role)}${item.id === current ? " · Current workspace" : " · Open workspace"}${owner && (directory.other.some(other => other.id === item.id) || directory.activeOther?.id === item.id) ? ` · ${esc(item.kind)} · ${esc(item.idHint)}` : ""}</small></span><span aria-hidden="true">${item.id === current ? "✓" : "→"}</span></button>`;
    dialog.classList.remove("is-print-tool");
    dialog.innerHTML = `<header class="wa-heading"><div><p class="wa-eyebrow">Your workspaces</p><h2 id="workspace-access-title">Where do you want to work?</h2></div><button type="button" class="wa-close" data-access-close aria-label="Close workspaces">×</button></header>
      <p class="wa-account">Signed in as <strong>${esc(account.name || "Operator")}</strong> · ${owner ? "Platform administrator" : account.localCustomer ? "Customer account" : account.database ? "Organization account" : "Operator account"}</p>
      <p class="wa-message" role="status">${esc(notice || workspaceAccessMessage({ account, count: choices.length, status: refreshing ? "loading" : status }))}</p>
      ${choices.length <= 1 && (status === "error" || refreshing || notice) ? `<p class="wa-account">${esc(workspaceAccessMessage({ account, count: choices.length, status: "ready" }))}</p>` : ""}
      <div class="wa-list" data-workspace-primary>${directory.primary.map(workspaceCard).join("") || '<p>No workspace access was returned. Refresh access or sign in again.</p>'}</div>
      ${owner && directory.other.length ? `<details class="wa-directory" data-access-directory><summary>Manage other workspaces <span>(${directory.other.length})</span></summary><p>Customer, development and test organizations keep their own records.</p><label class="wa-search"><span>Find a workspace</span><input type="search" data-access-search autocomplete="off" placeholder="Search by name or workspace ID" /></label><p class="wa-directory-count" data-access-search-count role="status">${directory.other.length} workspaces</p><div class="wa-list" data-workspace-directory-results>${directory.other.map(workspaceCard).join("")}</div></details>` : ""}
      <section class="wa-tool"><div><p class="wa-eyebrow">Available here · no workspace switch</p><h3>Print opportunity analysis</h3><p>Compare your 3MF projects, quoting thresholds and contribution per printer-hour. Files stay on this device.</p></div><button class="wa-primary" type="button" data-access-print>Open print analysis →</button></section>
      <footer class="wa-actions"><button type="button" data-access-refresh ${refreshing ? "disabled" : ""}>${refreshing ? "Refreshing…" : "Refresh workspace access"}</button><button type="button" data-access-admin ${refreshing ? "disabled" : ""}>${owner ? "Open admin console" : "Admin sign-in"}</button><button type="button" data-access-account ${refreshing ? "disabled" : ""}>Sign in with a different account</button><a href="https://app.phantomforce.online/app/index.html" target="_blank" rel="noopener">Open PhantomForce app ↗</a></footer>
      <p class="wa-account wa-local-owner">Using the PC where PhantomForce is installed? <a href="http://127.0.0.1:5177/app/index.html" target="_blank" rel="noopener">Open the installed app ↗</a>. Use your account’s normal sign-in.</p>`;
    const bindWorkspaceButtons = root => root.querySelectorAll("[data-access-workspace]").forEach(button => button.onclick = async () => {
      if (button.dataset.accessWorkspace === getSnapshot().current) { dialog.close(); return; }
      dialog.close(); await switchWorkspace(button.dataset.accessWorkspace);
    });
    bindWorkspaceButtons(dialog);
    const search = dialog.querySelector("[data-access-search]");
    if (search) search.oninput = () => {
      const matches = filterWorkspaceDirectory(directory.other, search.value);
      const results = dialog.querySelector("[data-workspace-directory-results]");
      results.innerHTML = matches.map(workspaceCard).join("") || '<p class="wa-directory-empty">No matching workspaces.</p>';
      dialog.querySelector("[data-access-search-count]").textContent = `${matches.length} of ${directory.other.length} workspaces`;
      bindWorkspaceButtons(results);
    };
    dialog.querySelector("[data-access-refresh]").onclick = async () => {
      if (refreshing) return; refreshing = true; paint();
      let ok = false;
      try { ok = await refresh(); } catch { /* Retry remains available. */ }
      refreshing = false; paint(ok ? "Workspace access refreshed." : "Could not refresh workspace access. Check your connection and retry.");
      dialog.querySelector("[data-access-refresh]")?.focus();
    };
    dialog.querySelector("[data-access-account]").onclick = () => { dialog.close(); void signOut(); };
    dialog.querySelector("[data-access-admin]").onclick = () => { dialog.close(); void openAdminAccess(); };
    dialog.querySelector("[data-access-print]").onclick = () => { void showPrint(); };
    dialog.scrollTop = 0;
  }

  async function showPrint() {
    const started = ++revision;
    const businessId = getSnapshot().current;
    dialog.classList.add("is-print-tool");
    dialog.innerHTML = '<header class="wa-heading"><div><p class="wa-eyebrow">Local tools</p><h2 id="workspace-access-title">Print analysis</h2></div><button type="button" class="wa-close" data-access-close aria-label="Close print analysis">×</button></header><button class="wa-back" type="button" data-access-back>← Workspaces</button><div data-access-print-mount role="status">Preparing print analysis…</div>';
    dialog.scrollTop = 0;
    dialog.querySelector("[data-access-close]").focus({ preventScroll: true });
    dialog.querySelector("[data-access-back]").onclick = () => { revision++; printMount?.destroy(); printMount = null; paint(); };
    try {
      await preparePrintStyles();
      if (closed || started !== revision || businessId !== getSnapshot().current) return;
      const mount = dialog.querySelector("[data-access-print-mount]"); mount.removeAttribute("role");
      printMount = renderPrintOpportunities(mount, { businessId, isActive: () => !closed && started === revision && businessId === getSnapshot().current });
      const account = getSnapshot().account, token = getToken();
      if (token) void readPrintBusinessContext(businessId, token).then(context => {
        if (context && !closed && started === revision && account === getSnapshot().account && token === getToken() && businessId === getSnapshot().current) printMount?.updateBusinessContext?.(context);
      });
    } catch {
      if (!closed && started === revision) dialog.querySelector("[data-access-print-mount]").textContent = "Print analysis could not load. Go back and try again.";
    }
  }
  paint(notice); dialog.showModal(); if (initialTool) void showPrint();
  return { close: () => dialog.close() };
}

async function readPrintBusinessContext(businessId, token) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch("/api/business-workspaces/commerce", { headers: { Authorization: `Bearer ${token}`, "x-phantomforce-business": businessId }, cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    if (!response.ok || payload.tenant_id !== businessId || payload.state?.tenantId !== businessId) return null;
    for (const key of ["materials", "products", "printers"]) if (!Array.isArray(payload.state[key]) || payload.state[key].some(item => item.tenantId !== businessId)) return null;
    return payload.state;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

export function setDatabaseOrganizationSwitching(active) {
  document.documentElement.dataset.orgSwitching = active ? "true" : "false";
  const select = document.querySelector("[data-org-select]");
  const input = document.querySelector("[data-command-input]");
  const form = document.querySelector("[data-command-form]");
  if (select) select.disabled = active;
  if (input) input.disabled = active;
  if (form) form.setAttribute("aria-busy", active ? "true" : "false");
}
