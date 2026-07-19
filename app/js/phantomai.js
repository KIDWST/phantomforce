/* PhantomForce — the one Phantom AI surface.
   Chat, Memory, and Activity used to be three disconnected places (a chat
   box, a buried settings sub-panel, and a topbar ticker with no real home).
   This module just owns tab switching over the same three existing
   implementations (companion.js chat wiring in main.js, brain.js's memory
   vault, agentops.js's console) so they read as one product. It does not
   re-implement any of them. */

import { isOwnerOperator } from "./store.js?v=phantom-live-20260718-37";
import { mountAgentConsole } from "./agentops.js?v=phantom-live-20260718-37";

const TABS = ["chat", "memory", "activity"];
let rootEl = null;

function pane(tab) {
  return rootEl?.querySelector(`[data-phantomai-pane="${tab}"]`) || null;
}

function mountMemoryTab() {
  const mount = pane("memory")?.querySelector("[data-phantomai-memory-mount]");
  if (!mount || mount.dataset.mounted) return;
  mount.dataset.mounted = "1";
  import("./brain.js?v=phantom-live-20260718-37")
    .then((mod) => { if (mount.isConnected) mod.renderPhantomBrain(mount); })
    .catch(() => { mount.innerHTML = `<p class="ws-note">This panel could not load. Try again in a moment.</p>`; });
}

function mountActivityTab() {
  const mount = pane("activity")?.querySelector("[data-phantomai-activity-mount]");
  if (mount) mountAgentConsole(mount);
}

export function activatePhantomAiTab(tab) {
  if (!rootEl || !TABS.includes(tab)) return;
  if (tab === "memory" && !isOwnerOperator()) tab = "chat";
  TABS.forEach((t) => {
    const p = pane(t);
    if (p) p.hidden = t !== tab;
  });
  rootEl.querySelectorAll("[data-phantomai-tab]").forEach((btn) => {
    const isActive = btn.dataset.phantomaiTab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (tab === "memory") mountMemoryTab();
  if (tab === "activity") mountActivityTab();
}

export function mountPhantomAI(root) {
  if (!root || root.dataset.phantomaiMounted) return;
  root.dataset.phantomaiMounted = "1";
  rootEl = root;

  const memoryTabBtn = root.querySelector('[data-phantomai-tab="memory"]');
  if (memoryTabBtn && !isOwnerOperator()) memoryTabBtn.hidden = true;

  root.querySelectorAll("[data-phantomai-tab]").forEach((btn) => {
    btn.addEventListener("click", () => activatePhantomAiTab(btn.dataset.phantomaiTab));
  });
  activatePhantomAiTab("chat");

  const ticker = document.querySelector("[data-phantomwire]");
  if (ticker && !ticker.dataset.phantomaiWired) {
    ticker.dataset.phantomaiWired = "1";
    ticker.style.cursor = "pointer";
    ticker.title = "Open Phantom AI — Activity";
    ticker.addEventListener("click", () => {
      activatePhantomAiTab("activity");
      root.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}
