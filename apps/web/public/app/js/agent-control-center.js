import { ctx, isAdmin, session } from "./store.js";

const CONTROL_CENTER_URL = "http://127.0.0.1:5757/";
const ADMIN_CHECK_MS = 650;

const signals = [
  ["AgentLab", "local control"],
  ["n8n", "worker lane"],
  ["OpenSpec", "proposal gate"],
  ["Serena", "read-only"],
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

function setOpen(nextOpen) {
  if (!root) return;
  isOpen = nextOpen;
  const panel = root.querySelector("[data-acc-panel]");
  const frame = root.querySelector("[data-acc-frame]");
  const openButton = root.querySelector("[data-acc-open]");

  panel.hidden = !isOpen;
  openButton.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("acc-open", isOpen);

  if (isOpen && frame && !frame.src) {
    setFrameStatus("Loading local control center on 127.0.0.1:5757...", "loading");
    frame.src = CONTROL_CENTER_URL;
    window.setTimeout(() => {
      if (isOpen) setFrameStatus("If the panel is blank, start Agent Control Center locally.", "idle");
    }, 1800);
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
          </article>
          <article>
            <span>Allowed</span>
            <strong>View status</strong>
            <p>Agent loops, local scans, OpenSpec, Serena profile, n8n lane, and safe process notes.</p>
          </article>
          <article>
            <span>Blocked</span>
            <strong>No external action</strong>
            <p>No uploads, no sends, no public hooks, no provider calls from this admin embed.</p>
          </article>
        </section>

        <div class="acc-frame-head">
          <span data-acc-frame-status data-tone="idle">Local control center is ready to load.</span>
          <code>127.0.0.1:5757</code>
        </div>
        <div class="acc-frame-wrap">
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
