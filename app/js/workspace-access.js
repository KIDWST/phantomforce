import { renderPrintOpportunities } from "./print-opportunity.js?v=phantom-live-20261026-239";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Use the server catalog when available. A profile name never grants access. */
export function workspaceChoices({ account = {}, catalog = null, workspaces = [], current = "" }) {
  let choices;
  if (Array.isArray(catalog)) choices = catalog.map(item => ({ id: item.tenantId, name: item.name, role: item.role }));
  else if (account.database || account.localCustomer) choices = (account.memberships || []).map(item => ({ id: item.orgId, name: item.orgName, role: item.role }));
  else choices = account.role === "admin" ? workspaces : workspaces.filter(item => item.id === current);
  if (account.localCustomer) choices = choices.filter(item => item.id === account.orgId);
  const seen = new Set();
  return choices.filter(item => typeof item.id === "string" && item.id && !seen.has(item.id) && seen.add(item.id))
    .map(item => ({ id: item.id, name: String(item.name || item.id), role: String(item.role || "member") }));
}

export function workspaceAccessMessage({ account = {}, count, status }) {
  if (status === "loading") return "Checking the workspaces available to this account…";
  if (status === "error") return "Workspace access could not be refreshed. Your current workspace is unchanged. Retry when the connection is available.";
  if (count > 1) return "Choose a workspace below. Each business keeps its own records, files and conversations.";
  if (account.localCustomer) return "This customer account has one workspace. To open PhantomForce, ChicagoShots or Occasionally Odd, sign in with an account that has access to those businesses.";
  return "Only one workspace is available to this account. Refresh access after an invitation, or use a different account.";
}

let activeDialog = null;
export function closeWorkspaceAccess() { activeDialog?.close(); }

/** One native modal supplies focus trapping, Escape and focus restoration. */
export function openWorkspaceAccess({ getSnapshot, refresh, switchWorkspace, signOut, preparePrintStyles, initialTool = false, notice = "" }) {
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
    dialog.classList.remove("is-print-tool");
    dialog.innerHTML = `<header class="wa-heading"><div><p class="wa-eyebrow">Your workspaces</p><h2 id="workspace-access-title">Where do you want to work?</h2></div><button type="button" class="wa-close" data-access-close aria-label="Close workspaces">×</button></header>
      <p class="wa-account">Signed in as <strong>${esc(account.name || "Operator")}</strong> · ${account.localCustomer ? "Customer account" : account.database ? "Organization account" : "Operator account"}</p>
      <p class="wa-message" role="status">${esc(notice || workspaceAccessMessage({ account, count: choices.length, status: refreshing ? "loading" : status }))}</p>
      ${choices.length <= 1 && (status === "error" || refreshing || notice) ? `<p class="wa-account">${esc(workspaceAccessMessage({ account, count: choices.length, status: "ready" }))}</p>` : ""}
      <div class="wa-list">${choices.map(item => `<button class="wa-workspace ${item.id === current ? "is-current" : ""}" type="button" data-access-workspace="${esc(item.id)}" ${item.id === current ? 'aria-current="true"' : ""} ${refreshing ? "disabled" : ""}><span class="wa-avatar">${esc(item.name.slice(0, 2).toUpperCase())}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.role)}${item.id === current ? " · Current workspace" : " · Open workspace"}</small></span><span aria-hidden="true">${item.id === current ? "✓" : "→"}</span></button>`).join("") || '<p>No workspace access was returned. Refresh access or sign in again.</p>'}</div>
      <section class="wa-tool"><div><p class="wa-eyebrow">Available here · no workspace switch</p><h3>Print opportunity analysis</h3><p>Compare your 3MF projects, quoting thresholds and contribution per printer-hour. Files stay on this device.</p></div><button class="wa-primary" type="button" data-access-print>Open print analysis →</button></section>
      <footer class="wa-actions"><button type="button" data-access-refresh ${refreshing ? "disabled" : ""}>${refreshing ? "Refreshing…" : "Refresh workspace access"}</button><button type="button" data-access-account ${refreshing ? "disabled" : ""}>Sign in with a different account</button><a href="https://admin.phantomforce.online/app/index.html" target="_blank" rel="noopener">Open owner workspace ↗</a></footer>
      <p class="wa-account wa-local-owner">Using the PC where PhantomForce is installed? <a href="http://127.0.0.1:5177/app/index.html" target="_blank" rel="noopener">Open the installed owner app ↗</a>. Your owner sign-in is still required.</p>`;
    dialog.querySelectorAll("[data-access-workspace]").forEach(button => button.onclick = async () => {
      if (button.dataset.accessWorkspace === getSnapshot().current) { dialog.close(); return; }
      dialog.close(); await switchWorkspace(button.dataset.accessWorkspace);
    });
    dialog.querySelector("[data-access-refresh]").onclick = async () => {
      if (refreshing) return; refreshing = true; paint();
      let ok = false;
      try { ok = await refresh(); } catch { /* Retry remains available. */ }
      refreshing = false; paint(ok ? "Workspace access refreshed." : "Could not refresh workspace access. Check your connection and retry.");
      dialog.querySelector("[data-access-refresh]")?.focus();
    };
    dialog.querySelector("[data-access-account]").onclick = () => { dialog.close(); void signOut(); };
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
    } catch {
      if (!closed && started === revision) dialog.querySelector("[data-access-print-mount]").textContent = "Print analysis could not load. Go back and try again.";
    }
  }
  paint(notice); dialog.showModal(); if (initialTool) void showPrint();
  return { close: () => dialog.close() };
}
