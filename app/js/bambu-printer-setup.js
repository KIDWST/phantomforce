const API = "/api/business-workspaces/print-runs";
const TENANT = "occasionally-odd";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const label = file => file?.mapping?.name || file?.metadata?.projectTitle || file?.metadata?.name || "Captured package";

/** Separate from feed refreshes so a pending access-code entry is never serialized into shared UI state. */
export function renderBambuPrinterSetup(root, options = {}) {
  if (options.businessId !== TENANT) { root.replaceChildren(); return { destroy() {} }; }
  const identity = options.getSessionIdentity?.(), controllers = new Set();
  let disposed = false, state = null, busy = false, notice = "", opened = false, selected = "p2s", feed = null;
  const active = () => !disposed && options.isActive?.() !== false && (!options.getSessionIdentity || identity === options.getSessionIdentity());
  async function request(path, body) {
    if (!active()) throw new Error("The account or business changed. Reopen Occasionally Odd.");
    const controller = new AbortController(); controllers.add(controller); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(API + path, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        headers: { ...options.getHeaders?.(), "x-phantomforce-business": TENANT, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok || value.ok === false) throw new Error(typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "Printer connection is unavailable.");
      if (value.tenant_id !== TENANT) throw new Error("The printer response belongs to another business.");
      if (!active()) throw new Error("The account or business changed. Reopen Occasionally Odd.");
      return value;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  const field = (name, text, attrs = "") => `<label class="bpf-field"><span>${esc(text)}</span><input name="${name}" ${attrs}></label>`;
  function paint() {
    if (!active()) return;
    const monitor = state?.monitor, printers = monitor?.printers || [], connections = state?.connections || [];
    root.innerHTML = `<details class="bpf-details cw-panel" data-bambu-pairing ${opened ? "open" : ""}><summary>Printer completion · ${monitor?.connected ? `${monitor.connected} connected` : "pair P2S / P1S"}</summary><div class="bpf-run-body"><p class="bpf-copy">Connect each printer once for read-only task status. Access codes stay encrypted on this server and are never returned. This connection cannot start, pause or change a print.</p>${notice ? `<p class="bpf-notice" role="status">${esc(notice)}</p>` : ""}${state ? `<div class="bpf-printer-grid">${["p2s", "p1s"].map(id => {
      const saved = connections.find(row => row.id === id), printer = printers.find(row => row.id === id), job = printer?.job;
      const unavailable = job && !job.taskId ? '<p class="bpf-warning">This task has no unique printer ID. Record its outcome in Completion, finishing and actual costs; it cannot be linked automatically.</p>' : "";
      return `<article class="bpf-printer-card"><strong>Bambu ${id.toUpperCase()}</strong>${unavailable}<p>${esc(printer?.state || (saved ? "Awaiting connection" : "Not paired"))}</p>${printer?.lastError ? `<p class="bpf-warning">${esc(printer.lastError)}</p>` : ""}${job ? `<p class="bpf-copy">${esc(job.name || "Printer task")} · ${esc(job.state)}${job.progress != null ? ` · ${esc(job.progress)}%` : ""}${job.remainingMinutes != null ? ` · ${esc(job.remainingMinutes)} min remaining` : ""}</p><small>Observed ${esc(new Date(job.observedAt).toLocaleString())}</small>` : ""}<div class="bpf-actions"><button type="button" class="cw-button" data-pair-select="${id}" ${busy ? "disabled" : ""}>${saved ? "Replace connection" : "Pair printer"}</button>${saved ? `<button type="button" class="cw-button" data-pair-disconnect="${id}" ${busy ? "disabled" : ""}>Disconnect</button>` : ""}</div>${job?.taskId ? `<form data-pair-bind="${id}"><p class="bpf-copy">Link this exact printer task only after checking its project and captured package. Names or nearby times alone do not establish a match.</p><label class="bpf-field"><span>Matching captured 3MF</span><select name="runId" required><option value="">Choose verified package…</option>${(feed?.runs || []).map(run => `<option value="${esc(run.id)}">${esc(label(feed.files.find(file => file.sha256 === run.fileHash)))} · ${esc(new Date(run.observedAt).toLocaleString())}</option>`).join("")}</select></label><label class="bpf-check"><input type="checkbox" name="verified" required>I verified this is the same print task and package</label><button class="cw-button" ${busy ? "disabled" : ""}>Link task for automatic outcome</button></form>` : ""}</article>`;
    }).join("")}</div>${monitor?.error ? `<p class="bpf-warning">${esc(monitor.error)}</p>` : ""}<form data-pair-form autocomplete="off"><h4>Pair Bambu ${selected.toUpperCase()}</h4><p class="bpf-copy">Use the printer's normal network/device screen for its LAN address, serial and access code. Enter the code here; do not paste it into chat. Both this PC and the printer must be on the same reachable network. Certificate verification stays enabled.</p><div class="bpf-fields">${field("host", "Printer private IPv4 address", 'required inputmode="decimal" placeholder="192.168.x.x" maxlength="15" autocomplete="off"')}${field("serial", "Printer serial", 'required minlength="6" maxlength="40" autocomplete="off"')}${field("accessCode", "Printer LAN access code", 'type="password" required minlength="8" maxlength="8" autocomplete="new-password"')}</div><button class="cw-button cw-button-primary" ${busy || !state.encryptionReady ? "disabled" : ""}>Save encrypted connection</button>${!state.encryptionReady ? '<p class="bpf-warning">Server credential encryption must be configured before pairing.</p>' : ""}</form>` : `<button class="cw-button" type="button" data-pair-load ${busy ? "disabled" : ""}>${busy ? "Checking printer connections…" : "Load printer connections"}</button>`}<div class="bpf-actions"><button type="button" class="cw-button" data-pair-refresh ${busy ? "disabled" : ""}>Refresh printer status</button></div><p class="bpf-copy">Completion time means when a terminal status was observed. Measured duration, material consumption, finishing and sale amounts remain separate. Hardware pairing has not succeeded until a verified status arrives.</p></div></details>`;
    root.querySelector("[data-bambu-pairing]").addEventListener("toggle", event => { opened = event.currentTarget.open; if (opened && !state && !busy) void load(); });
    root.querySelectorAll("[data-pair-load],[data-pair-refresh]").forEach(button => button.addEventListener("click", () => void load()));
    root.querySelectorAll("[data-pair-select]").forEach(button => button.addEventListener("click", () => { selected = button.dataset.pairSelect; paint(); }));
    root.querySelector("[data-pair-form]")?.addEventListener("submit", event => {
      event.preventDefault(); if (!active() || busy) return;
      const form = event.currentTarget, data = new FormData(form), body = { id: selected, label: `Bambu ${selected.toUpperCase()}`, model: selected.toUpperCase(), host: String(data.get("host")).trim(), serial: String(data.get("serial")).trim(), accessCode: String(data.get("accessCode")).trim(), expectedRevision: state.revision };
      form.querySelector('[name="accessCode"]').value = "";
      void perform(async () => { state = await request("/printer-connections", body); notice = "Connection saved encrypted. Waiting for a verified printer status; no printer command was sent."; }, "Pairing could not be saved.");
    });
    root.querySelectorAll("[data-pair-disconnect]").forEach(button => button.addEventListener("click", () => void perform(async () => { state = await request(`/printer-connections/${button.dataset.pairDisconnect}/disconnect`, { expectedRevision: state.revision }); notice = "Printer monitoring disconnected. Captured files and business history remain saved."; })));
    root.querySelectorAll("[data-pair-bind]").forEach(form => form.addEventListener("submit", event => {
      event.preventDefault(); if (!active() || busy) return; const data = new FormData(form), printer = state.monitor.printers.find(row => row.id === form.dataset.pairBind), printerId = printer?.bindingId || form.dataset.pairBind, job = printer?.job;
      if (data.get("verified") !== "on" || !job?.taskId || !data.get("runId")) return;
      void perform(async () => { const latest = await request(""); await request("/workflow/commands", { commandId: crypto.randomUUID(), expectedRevision: latest.workflow.revision, type: "bind-printer-task", payload: { runId: data.get("runId"), printerId, taskId: job.taskId, ...(job.subtaskId ? { subtaskId: job.subtaskId } : {}) } }); notice = "Exact printer task linked. Future verified status reports can record its outcome."; options.onChange?.(); });
    }));
  }
  async function perform(operation, fallback = "The printer update failed.") {
    if (busy || !active()) return; busy = true;
    root.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try { await operation(); } catch (error) { if (active()) notice = error.name === "AbortError" ? "Printer request timed out. Refresh before retrying." : error.message || fallback; }
    finally { busy = false; if (active()) paint(); }
  }
  async function load() { await perform(async () => { const values = await Promise.all([request("/printer-connections"), request("")]); state = values[0]; feed = values[1]; notice = ""; }); }
  paint();
  return { destroy() { disposed = true; controllers.forEach(controller => controller.abort()); controllers.clear(); } };
}
