import { ctx, isAdmin, session, store } from "./store.js?v=phantom-live-20260713-qa-sweep-01";

const CONTROL_CENTER_URL = "http://127.0.0.1:5757/";
const ADMIN_CHECK_MS = 650;

const signals = [
  ["Operator Desk", "local control"],
  ["Workflow Lane", "worker lane"],
  ["Proposal Gate", "approval gate"],
  ["Code Lens", "read-only"],
  ["Security", "local scans"],
];

let root = null;
let isOpen = false;

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function hasAdminSession() {
  return isAdmin() || session.get()?.role === "admin" || ctx.session?.role === "admin";
}

function phantomIsVisible() {
  const shell = document.querySelector("[data-phantom]");
  return !!shell && !shell.hidden;
}

function setFrameStatus(text, tone = "idle") {
  const status = root?.querySelector("[data-acc-frame-status]");
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function initials(value = "") {
  return String(value || "PF")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "PF";
}

function stateLabel(value = "") {
  return String(value || "ready").replace(/-/g, " ");
}

function mirrorHtml() {
  const agents = store.state.agents || [];
  const tools = store.state.toolSpine || [];
  const activeAgents = agents.filter((agent) => agent.status === "active").length;
  const readyTools = tools.filter((tool) => ["active", "ready", "routed", "indexed", "watching"].includes(tool.mode || tool.status)).length;
  const topAgents = agents.slice(0, 15);
  const topTools = tools.slice(0, 10);

  return `
    <section class="acc-mirror-grid" aria-label="Phantom agent mirror">
      <article class="acc-mirror-hero">
        <span>Agent Mirror</span>
        <strong>${activeAgents}/${agents.length} Phantom systems ready</strong>
        <p>Showing the app-owned agent map directly in PhantomForce. The localhost control app is optional and only works on the PC running it.</p>
        <div class="acc-proof-row">
          <b>Read-only</b>
          <b>Admin only</b>
          <b>No sends</b>
        </div>
      </article>

      <article class="acc-mirror-hero acc-mirror-local">
        <span>Local Control App</span>
        <strong>${CONTROL_CENTER_URL.replace("http://", "")}</strong>
        <p>Use this only on the master PC. On a phone, localhost points to the phone, so Phantom shows this mirror instead.</p>
        <button class="acc-try-local" type="button" data-acc-local-embed>Try local embed</button>
      </article>

      <section class="acc-agent-panel">
        <div class="acc-panel-title">
          <span>Running Agents</span>
          <b>${activeAgents} live</b>
        </div>
        <div class="acc-agent-grid">
          ${topAgents.map((agent) => `
            <article class="acc-agent acc-agent-${esc(agent.status || "ready")}">
              <span class="acc-agent-avatar">${esc(initials(agent.name))}</span>
              <span class="acc-agent-copy">
                <b>${esc(agent.name)}</b>
                <i>${esc(agent.mission || agent.next || "Ready")}</i>
                <small>${esc(agent.role || agent.bundle || "")}</small>
              </span>
              <em>${esc(stateLabel(agent.status))}</em>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="acc-agent-panel">
        <div class="acc-panel-title">
          <span>Tool Lanes</span>
          <b>${readyTools}/${tools.length} mapped</b>
        </div>
        <div class="acc-tool-grid">
          ${topTools.map((tool) => `
            <article class="acc-tool">
              <span class="acc-tool-dot" aria-hidden="true"></span>
              <span>
                <b>${esc(tool.name)}</b>
                <i>${esc(tool.worker || tool.internal || "Phantom lane")}</i>
                <small>${esc(tool.status || tool.mode || "ready")}</small>
              </span>
            </article>
          `).join("")}
        </div>
      </section>
    </section>
  `;
}

function paintMirror() {
  const mirror = root?.querySelector("[data-acc-mirror]");
  if (!mirror) return;
  mirror.innerHTML = mirrorHtml();
  const tryButton = mirror.querySelector("[data-acc-local-embed]");
  if (tryButton) {
    tryButton.addEventListener("click", () => showLocalEmbed());
  }
}

function showLocalEmbed() {
  if (!root) return;
  const frame = root.querySelector("[data-acc-frame]");
  const frameWrap = root.querySelector("[data-acc-frame-wrap]");
  const mirror = root.querySelector("[data-acc-mirror]");
  if (!frame || !frameWrap || !mirror) return;
  mirror.hidden = true;
  frameWrap.hidden = false;
  if (!frame.src) {
    setFrameStatus("Trying local control center on 127.0.0.1:5757...", "loading");
    frame.src = CONTROL_CENTER_URL;
    window.setTimeout(() => {
      if (isOpen && !frameWrap.hidden) setFrameStatus("If this is blank, use the agent mirror or start Agent Control Center on this PC.", "idle");
    }, 1800);
  }
}

function setOpen(nextOpen) {
  if (!root) return;
  isOpen = nextOpen;
  const panel = root.querySelector("[data-acc-panel]");
  const openButton = root.querySelector("[data-acc-open]");
  const frameWrap = root.querySelector("[data-acc-frame-wrap]");
  const mirror = root.querySelector("[data-acc-mirror]");

  panel.hidden = !isOpen;
  openButton.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("acc-open", isOpen);

  if (isOpen) {
    paintMirror();
    if (frameWrap) frameWrap.hidden = true;
    if (mirror) mirror.hidden = false;
    setFrameStatus("Showing Phantom agent mirror. Local embed is optional on the master PC.", "ok");
  }
}

function render() {
  if (root) return root;
  root = document.createElement("div");
  root.className = "acc-root";
  root.hidden = true;
  root.innerHTML = `
    <button class="acc-launcher" type="button" data-acc-open aria-expanded="false">
      <span class="acc-launcher-pulse" aria-hidden="true"></span>
      <span>
        <b>Operator Control</b>
        <i>private local stack</i>
      </span>
    </button>

    <div class="acc-panel" data-acc-panel hidden>
      <button class="acc-backdrop" type="button" data-acc-close aria-label="Close operator control"></button>
      <section class="acc-drawer" aria-label="Private Operator Control Center">
        <header class="acc-head">
          <div>
            <p>PHANTOMFORCE ADMIN</p>
            <h2>Operator Control Center</h2>
          </div>
          <div class="acc-head-actions">
            <a class="acc-link" href="${CONTROL_CENTER_URL}" target="_blank" rel="noreferrer">Open full screen</a>
            <button class="acc-close" type="button" data-acc-close aria-label="Close">Close</button>
          </div>
        </header>

        <div class="acc-signal-tape" aria-label="Private stack status">
          ${signals.map(([name, detail]) => `
            <span><b>${esc(name)}</b><i>${esc(detail)}</i></span>
          `).join("")}
        </div>

        <section class="acc-command-board" aria-label="Operator stack summary">
          <article class="acc-command-main">
            <span>Admin-only mirror</span>
            <strong>See what is running without exposing the machinery to clients.</strong>
            <p>This embeds the local Agent Control Center. It stays on localhost, does not send, and does not expose client controls.</p>
            <p>Remote phone browsers cannot load a PC localhost iframe, so Phantom shows the agent mirror below by default.</p>
          </article>
          <article>
            <span>Allowed</span>
            <strong>View status</strong>
            <p>Agent loops, local scans, proposal gates, code profile, workflow lane, and safe process notes.</p>
          </article>
          <article>
            <span>Blocked</span>
            <strong>No external action</strong>
            <p>No uploads, no sends, no public hooks, no provider calls from this admin embed.</p>
          </article>
        </section>

        <div class="acc-frame-head">
          <span data-acc-frame-status data-tone="idle">Agent mirror is ready.</span>
          <code>agent mirror · 127.0.0.1:5757 optional</code>
        </div>
        <div class="acc-mirror" data-acc-mirror></div>
        <div class="acc-frame-wrap" data-acc-frame-wrap hidden>
          <iframe data-acc-frame title="Agent Control Center" referrerpolicy="no-referrer" sandbox="allow-same-origin allow-scripts allow-forms"></iframe>
        </div>
      </section>
    </div>
  `;

  root.querySelector("[data-acc-open]").addEventListener("click", () => setOpen(true));
  root.querySelectorAll("[data-acc-close]").forEach((button) => {
    button.addEventListener("click", () => setOpen(false));
  });
  root.querySelector("[data-acc-frame]").addEventListener("load", () => {
    if (isOpen) setFrameStatus("Loaded local Agent Control Center.", "ok");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) setOpen(false);
  });
  document.body.appendChild(root);
  return root;
}

function syncVisibility() {
  const el = render();
  const visible = hasAdminSession() && phantomIsVisible();
  el.hidden = !visible;
  if (!visible && isOpen) setOpen(false);
}

render();
syncVisibility();
window.setInterval(syncVisibility, ADMIN_CHECK_MS);
store.onChange(() => {
  if (isOpen) paintMirror();
});
