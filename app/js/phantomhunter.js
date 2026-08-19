import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260817-161";

const states = new WeakMap();
const terminal = new Set(["completed", "partial", "failed", "cancelled"]);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function tenantId() {
  return String(currentTenantId() || "").trim();
}

function authHeaders() {
  const token = session.token();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withTenant(path) {
  const tenant = tenantId();
  if (!tenant) return path;
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}tenant_id=${encodeURIComponent(tenant)}`;
}

async function api(path, options = {}) {
  const response = await fetch(withTenant(path), {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({ ok: false, error: "PhantomHunter returned an unreadable response." }));
  if (!response.ok || body.ok === false) {
    const backendError = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(friendlyBackendError(response.status, backendError, {
      authMessage: "Your PhantomForce session expired. Sign in again to use PhantomHunter.",
      fallbackPrefix: "PhantomHunter request failed",
    }));
  }
  return body;
}

function shortTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initials(value) {
  return String(value || "RE").split(/[\s/._-]+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
}

function toolStrip(hunter) {
  return `<div class="hunter-web-tools">${(hunter?.tools || []).map((tool) => `<span class="${tool.available ? "ready" : "missing"}"><i></i>${esc(tool.name || tool.id)}</span>`).join("")}</div>`;
}

function repoCard(repository) {
  const repo = repository.repository;
  if (!repository.connected || !repo) {
    return `<section class="hunter-web-connect">
      <div class="hunter-web-connect-icon">⌁</div>
      <span>ONE-TIME SETUP</span>
      <h2>Connect your code source</h2>
      <p>Your workspace owner connects GitHub, GitLab, or Bitbucket once. After that, everyone uses one button—no paths, URLs, or repo hunting.</p>
      <div class="hunter-web-providers"><button type="button" data-hunter-connect="github">GitHub</button><button type="button" data-hunter-connect="gitlab">GitLab</button><button type="button" data-hunter-connect="bitbucket">Bitbucket</button></div>
      <small>PhantomHunter Web never accepts a custom scan target.</small>
    </section>`;
  }
  return `<section class="hunter-web-repo">
    <div class="hunter-web-repo-mark">${esc(initials(repo.label))}</div>
    <div><span>WORKSPACE REPOSITORY</span><h2>${esc(repo.label)}</h2><p>${esc(repo.target_display)}</p></div>
    <div class="hunter-web-connected"><i></i> CONNECTED</div>
  </section>`;
}

function findingCard(finding) {
  const source = finding.sources?.[0] || {};
  return `<article class="hunter-web-finding">
    <div class="hunter-web-provider">${esc(initials(finding.provider))}</div>
    <div><span>${esc(finding.provider)}</span><h3>${esc(finding.masked_secret)}</h3><p>${esc(source.location || "Repository source")} ${source.line ? `· line ${source.line}` : ""}</p></div>
    <div class="hunter-web-active"><i></i> ACTIVE</div>
  </article>`;
}

function resultPanel(scan) {
  if (!scan) {
    return `<section class="hunter-web-results is-idle"><div class="hunter-web-result-icon">✓</div><div><span>VERIFIED EXPOSURE</span><h2>Ready to check this repository</h2><p>Only provider-confirmed active keys can appear here.</p></div></section>`;
  }
  const findings = scan.findings || scan.active_findings || [];
  const running = !terminal.has(scan.status);
  const completed = Number(scan.progress?.completed_assets || 0);
  const total = Number(scan.progress?.total_assets || 1);
  const percent = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
  return `<section class="hunter-web-results ${findings.length ? "has-exposure" : "is-clean"}">
    <div class="hunter-web-result-head">
      <div class="hunter-web-result-icon">${running ? "↻" : findings.length ? "!" : "✓"}</div>
      <div><span>VERIFIED EXPOSURE · ${esc(scan.id.slice(0, 8).toUpperCase())}</span><h2>${running ? "Checking the connected repository" : findings.length ? `${findings.length} active key${findings.length === 1 ? "" : "s"} confirmed` : "No active keys confirmed"}</h2><p>${running ? "Betterleaks, TruffleHog, and KeyHunter are working as one pipeline." : findings.length ? "Rotate or revoke immediately, remove the source copy, then scan again." : "Nothing provider-confirmed reached the result surface."}</p></div>
      ${!running ? `<button type="button" data-hunter-export>Export</button>` : ""}
    </div>
    ${running ? `<div class="hunter-web-progress"><i style="width:${percent}%"></i></div>` : ""}
    <div class="hunter-web-findings">${findings.map(findingCard).join("")}</div>
  </section>`;
}

function historyPanel(scans) {
  return `<section class="hunter-web-history">
    <header><div><span>RECENT CHECKS</span><h2>Repository history</h2></div></header>
    <div>${scans.length ? scans.map((scan) => `<button type="button" data-hunter-scan="${esc(scan.id)}"><span>${esc(shortTime(scan.created_at))}</span><b>${esc(scan.status)}</b><strong>${Number(scan.summary?.verified_active || scan.findings?.length || 0)} active</strong></button>`).join("") : `<p>No previous checks yet.</p>`}</div>
  </section>`;
}

function render(root) {
  const state = states.get(root);
  const connected = Boolean(state.web?.repository?.connected);
  root.innerHTML = `<div class="hunter-web-shell">
    <header class="hunter-web-hero">
      <div><span class="hunter-web-kicker">PHANTOMHUNTER WEB</span><h1>Your repository.<br><em>One clear answer.</em></h1><p>No paths. No target lists. No security jargon. PhantomHunter checks only the repository already connected to this workspace and shows active keys only.</p></div>
      <div class="hunter-web-verdict"><small>RESULT POLICY</small><strong>ACTIVE<br>ONLY</strong><span>Provider confirmed</span></div>
    </header>
    ${state.loading ? `<section class="hunter-web-loading">Loading the workspace repository…</section>` : ""}
    ${state.error ? `<section class="hunter-web-error"><b>PhantomHunter needs attention</b><span>${esc(state.error)}</span><button type="button" data-hunter-retry>Retry</button></section>` : ""}
    ${state.notice ? `<section class="hunter-web-notice"><b>Connection requested</b><span>${esc(state.notice)}</span></section>` : ""}
    ${state.web ? repoCard(state.web.repository) : ""}
    ${state.web ? `<section class="hunter-web-action ${connected ? "" : "disabled"}">
      <div><span>ONE ACTION</span><h2>Check this repository now</h2><p>Read-only scan. PhantomHunter will not rotate, revoke, publish, or change anything.</p></div>
      <label><input type="checkbox" data-hunter-attest ${state.attested ? "checked" : ""}><i></i><span>I am authorized</span></label>
      <button type="button" data-hunter-launch ${!connected || state.running ? "disabled" : ""}>${state.running ? "Checking…" : "Scan now"}<i>→</i></button>
    </section>` : ""}
    ${toolStrip(state.web?.hunter)}
    ${resultPanel(state.activeScan)}
    ${historyPanel(state.web?.scans || [])}
  </div>`;
  bind(root);
}

async function load(root) {
  const state = states.get(root);
  state.loading = true;
  state.error = "";
  render(root);
  try {
    state.web = await api("/phantom-ai/phantom-hunter/web?limit=10");
    const running = state.web.scans?.find((scan) => !terminal.has(scan.status));
    if (!state.activeScan) state.activeScan = running || state.web.scans?.[0] || null;
    state.loading = false;
    render(root);
    if (running) poll(root, running.id);
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : "PhantomHunter is unavailable.";
    render(root);
  }
}

async function poll(root, scanId) {
  const state = states.get(root);
  clearTimeout(state.timer);
  try {
    const result = await api(`/phantom-ai/phantom-hunter/scans/${encodeURIComponent(scanId)}`);
    state.activeScan = result.scan;
    state.running = !terminal.has(result.scan.status);
    render(root);
    if (state.running) state.timer = setTimeout(() => poll(root, scanId), 900);
    else await load(root);
  } catch (error) {
    state.running = false;
    state.error = error instanceof Error ? error.message : "Could not refresh this check.";
    render(root);
  }
}

async function launch(root) {
  const state = states.get(root);
  if (!state.attested) {
    state.error = "Confirm that you are authorized to check this workspace repository.";
    return render(root);
  }
  state.running = true;
  state.error = "";
  render(root);
  try {
    const result = await api("/phantom-ai/phantom-hunter/web/scan", {
      method: "POST",
      body: JSON.stringify({ authorization_attested: true }),
    });
    state.activeScan = result.scan;
    render(root);
    poll(root, result.scan.id);
  } catch (error) {
    state.running = false;
    state.error = error instanceof Error ? error.message : "The repository check could not start.";
    render(root);
  }
}

async function requestConnection(root, provider) {
  const state = states.get(root);
  state.error = "";
  state.notice = "";
  try {
    const result = await api("/phantom-ai/phantom-hunter/web/connect", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
    state.notice = result.customer_message;
    render(root);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The repository connection could not be requested.";
    render(root);
  }
}

async function exportScan(root) {
  const state = states.get(root);
  if (!state.activeScan) return;
  const response = await fetch(withTenant(`/phantom-ai/phantom-hunter/scans/${encodeURIComponent(state.activeScan.id)}/export.csv`), { headers: authHeaders() });
  if (!response.ok) {
    state.error = "The active-key report could not be exported.";
    return render(root);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `phantomhunter-${state.activeScan.id.slice(0, 8)}-active.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function bind(root) {
  const state = states.get(root);
  root.querySelector("[data-hunter-retry]")?.addEventListener("click", () => load(root));
  root.querySelector("[data-hunter-attest]")?.addEventListener("change", (event) => { state.attested = event.target.checked; state.error = ""; });
  root.querySelector("[data-hunter-launch]")?.addEventListener("click", () => launch(root));
  root.querySelector("[data-hunter-export]")?.addEventListener("click", () => exportScan(root));
  root.querySelectorAll("[data-hunter-connect]").forEach((button) => button.addEventListener("click", () => requestConnection(root, button.dataset.hunterConnect)));
  root.querySelectorAll("[data-hunter-scan]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const result = await api(`/phantom-ai/phantom-hunter/scans/${encodeURIComponent(button.dataset.hunterScan)}`);
      state.activeScan = result.scan;
      render(root);
      root.querySelector(".hunter-web-results")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Could not open that check.";
      render(root);
    }
  }));
}

export function renderPhantomHunter(root) {
  if (!root) return;
  if (!states.has(root)) states.set(root, { loading: true, error: "", notice: "", web: null, activeScan: null, running: false, attested: false, timer: null });
  load(root);
}
