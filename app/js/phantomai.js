/* PhantomForce — the one Phantom AI surface.
   Chat, Memory, and Activity used to be three disconnected places (a chat
   box, a buried settings sub-panel, and a topbar ticker with no real home).
   This module just owns tab switching over the same three existing
   implementations (companion.js chat wiring in main.js, brain.js's memory
   vault, agentops.js's console) so they read as one product. It does not
   re-implement any of them. */

import { isOwnerOperator, rememberConversation } from "./store.js?v=phantom-live-20260723-47";
import { mountAgentConsole } from "./agentops.js?v=phantom-live-20260723-47";
import { handleCommand, handleSmartCommand } from "./command.js?v=phantom-live-20260723-47";
import { esc } from "./workspaces.js?v=phantom-live-20260723-47";

const TABS = ["chat", "memory", "activity"];
let rootEl = null;

/* Own history for this surface — deliberately separate from the home-page
   hero chatbox's chatHistory and the older "phantom" workspace overlay's
   phantomHistory (both in main.js). Those are different, existing chat
   surfaces; this is a fourth one and must not share their state. */
const chatHistory = [];

function pane(tab) {
  return rootEl?.querySelector(`[data-phantomai-pane="${tab}"]`) || null;
}

/* Same rcard markup/behavior main.js's cardHtml/bindCardRemovers render for
   the other chat surfaces, reimplemented locally so this module stays
   self-contained (main.js does not export those helpers). Card "open"
   actions use [data-open-ws], which main.js already handles with a
   document-level delegated click listener, so no extra wiring is needed
   here for those buttons to route to a workspace. */
function chatCardHtml(c, cardIndex, entryIndex) {
  return `
    <article class="rcard" data-card-index="${cardIndex}" data-entry-index="${entryIndex}">
      <button class="rcard-x" data-card-remove data-card-index="${cardIndex}" data-entry-index="${entryIndex}" aria-label="Remove card">×</button>
      <p class="rcard-kicker">${esc(c.kicker)}</p>
      <h4>${esc(c.title)}</h4>
      ${c.body ? `<p class="rcard-body">${esc(c.body)}</p>` : ""}
      ${c.meta ? `<p class="rcard-meta">${esc(c.meta)}</p>` : ""}
      ${c.actions?.length ? `<div class="rcard-actions">${c.actions.map((a) => `<button class="btn" data-open-ws="${esc(a.open)}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    </article>`;
}
function bindChatCardRemovers(root, onRemove) {
  if (!root) return;
  root.querySelectorAll("[data-card-remove]").forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const entryIndex = btn.dataset.entryIndex;
      const cardIndex = btn.dataset.cardIndex;
      if (onRemove && entryIndex !== "" && cardIndex !== "") onRemove(Number(entryIndex), Number(cardIndex));
      else btn.closest(".rcard")?.remove();
    };
  });
}

/* The backend team is adding a "mission" route_tier for longer, multi-agent
   requests (chosen server-side; nothing to select here). handleSmartCommand
   already returns whatever the server sends back — if it starts including a
   mission/background marker on `r.hermes`, surface a small status line using
   the same card-rendering pattern; otherwise this renders nothing extra. */
function backgroundNoteFor(r) {
  const h = r?.hermes;
  if (!h || typeof h !== "object") return false;
  return !!(h.mission_id || h.missionId || h.background || h.running_in_background || h.route_tier === "mission");
}

function chatMediaHtml(media = {}) {
  const url = String(media.url || "");
  const safeUrl = /^(?:data:(?:image|video)\/(?:png|jpe?g|webp|gif|mp4|webm);base64,|https?:\/\/|\/|blob:)/i.test(url) ? url : "";
  if (!safeUrl) return "";
  const title = esc(String(media.title || "Generated media"));
  const status = esc(String(media.status || "saved"));
  const type = media.type === "video" ? "video" : "image";
  const preview = type === "video"
    ? `<video src="${esc(safeUrl)}" controls playsinline preload="metadata" aria-label="${title}"></video>`
    : `<img src="${esc(safeUrl)}" alt="${title}" loading="lazy"/>`;
  return `<figure class="chat-media chat-media-${type}" data-chat-media-status="${status}">
    <div class="chat-media-frame">${preview}</div>
    <figcaption><span>${title}</span><b>${status === "saved" ? "Saved to Media Pool" : status === "queued" ? "Queued preview" : "Preview — not saved"}</b></figcaption>
  </figure>`;
}

function mountChatTab() {
  const mount = pane("chat")?.querySelector("[data-phantomai-chat-mount]");
  if (!mount || mount.dataset.mounted) return;
  mount.dataset.mounted = "1";
  const log = mount.querySelector("[data-phantomai-chat-log]");
  const form = mount.querySelector("[data-phantomai-chat-form]");
  const input = mount.querySelector("[data-phantomai-chat-input]");
  if (!log || !form || !input) return;

  const paint = () => {
    log.innerHTML = chatHistory.map((h, entryIndex) => `
      <div class="phantomai-chat-entry">
        <p class="phantomai-chat-user">› ${esc(h.q)}</p>
        <p class="phantomai-chat-reply">${esc(h.say)}</p>
        ${h.background ? `<p class="phantomai-chat-status">Running a longer task in the background...</p>` : ""}
        ${(h.media || []).map(chatMediaHtml).join("")}
        ${(h.cards || []).map((c, cardIndex) => chatCardHtml(c, cardIndex, entryIndex)).join("")}
      </div>`).join("") || `<p class="phantomai-chat-hello">Ask Phantom anything — questions get answered, commands become guarded work, and anything external stays approval-gated.</p>`;
    bindChatCardRemovers(log, (entryIndex, cardIndex) => {
      const cards = chatHistory[entryIndex]?.cards;
      if (!cards) return;
      cards.splice(cardIndex, 1);
      paint();
    });
    log.scrollTop = log.scrollHeight;
  };
  paint();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    const r = await handleSmartCommand(v).catch(() => handleCommand(v));
    chatHistory.push({ q: v, say: r.say, cards: r.cards, media: r.media, background: backgroundNoteFor(r) });
    rememberConversation({ prompt: v, reply: r.say, mode: "phantom-ai-chat", route: r.open || "" });
    paint();
  });

  setTimeout(() => {
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  }, 60);
}

function mountMemoryTab() {
  const mount = pane("memory")?.querySelector("[data-phantomai-memory-mount]");
  if (!mount || mount.dataset.mounted) return;
  mount.dataset.mounted = "1";
  import("./brain.js?v=phantom-live-20260723-47")
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
  if (tab === "chat") mountChatTab();
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
