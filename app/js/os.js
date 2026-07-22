/* PhantomOS — the interface after the interface.
 *
 * There is no sidebar, no dashboard, no notification center, and no
 * chat page in this shell. The model:
 *
 *   FLOOR      The organization as living cells. Band membership and
 *              size are COMPUTED from real store state every render:
 *              "Needs you" (a specific ask, stated), "In motion"
 *              (desks working without you, showing their actual last
 *              action), and the "Shelf" (quiet capability, compressed
 *              but always one tap away). Layout is the signal — there
 *              are no badges and no notification tray, because the
 *              room itself reorders.
 *
 *   FOCUS      Touching a cell expands it in place into the full desk
 *              canvas (the untouched workspace renderers), while the
 *              rest of the org compresses into a live periphery that
 *              keeps breathing and stays clickable. Related contexts
 *              are marked "linked" from a semantic graph. You never
 *              leave the whole.
 *
 *   THREADLINE Your path through contexts is a visible trail under
 *              the presence line. Esc walks back. Context is never
 *              thrown away by navigation.
 *
 *   DESK       Held decisions dock at the bottom edge and follow you
 *              into every context. Approve/return in place, evidence
 *              attached; resolving one visibly recomputes the Floor —
 *              consequence stays connected to action.
 *
 *   VOICE      The Phantom is ambient, not a chat box: one line of
 *              present-tense truth (rotating through REAL activity),
 *              summonable from anywhere with "/". Answers arrive as
 *              artifacts pinned into the current context and real
 *              drafts in the store — never chat-only when an action
 *              fits. Long-form console remains on the Shelf.
 *
 * Honesty rules carried over from the rest of this codebase: every
 * number and line on the Floor traces to a real record; a desk with
 * nothing moving says so instead of shimmering; reduced motion kills
 * all pulse while bands still communicate through order and size.
 */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, moneyView, fmtMoney, ago, daysUntil, commandBriefing, resolveApproval,
} from "./store.js?v=phantom-live-20260722-22";
import { handleCommand, commandSuggestions } from "./command.js?v=phantom-live-20260722-22";
import { WORKSPACE_DEFS, esc } from "./workspaces.js?v=phantom-live-20260722-22";

const $ = (sel, root = document) => root.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ORIENT_KEY = "pf.os.oriented.v1";

/* ===================== the cell registry =====================
   Each cell computes its own truth from the store. `need` > 0 puts it
   in the NOW band with `ask` as the stated reason; otherwise recent
   mapped activity puts it in MOTION with its actual last action;
   otherwise it rests on the SHELF with an honest quiet line. */

const ACTIVITY_CELL = {
  "Lead Hunter": "leads", "Follow-Up Desk": "leads", "Delivery Manager": "leads",
  "Proposal Forge": "proposals", "Media Factory": "media",
  "Site Builder": "sites", "Store Builder": "sites",
  "Review Desk": "reviews", "Booking Coordinator": "bookings",
  "Security Watch": "protect",
};

/* One name per place, used by cells, threadline, and canvas alike —
   clicking "Protection" must land somewhere called "Protection". */
const CELL_NAMES = {
  leads: "Clients & Leads", proposals: "Proposals", money: "Money", media: "Media",
  sites: "Sites & Builds", reviews: "Reputation", bookings: "Bookings", protect: "Protection",
  workforce: "Workforce", outcomes: "Outcomes", play: "Play", store: "Store",
  phantom: "Console", adminos: "PhantomOps", approvals: "Held decisions",
};
const placeName = (id) => CELL_NAMES[id] || WORKSPACE_DEFS[id]?.title || id;

const RELATED = {
  leads: ["proposals", "bookings", "money"],
  proposals: ["leads", "money", "sites"],
  money: ["proposals", "leads"],
  media: ["sites", "reviews"],
  sites: ["media", "proposals", "store"],
  reviews: ["media", "leads"],
  bookings: ["leads", "media"],
  protect: ["sites", "workforce"],
  workforce: ["outcomes", "protect"],
  outcomes: ["workforce", "money", "leads"],
  play: ["store"],
  store: ["play", "sites"],
  approvals: ["leads", "media", "sites", "reviews"],
  phantom: [],
  adminos: ["workforce", "protect"],
};

function latestActivityFor(cellId) {
  const acts = visible(store.state.activity);
  for (const a of acts) {
    if (ACTIVITY_CELL[a.who] === cellId) return a;
  }
  return null;
}

function computeCells() {
  const admin = isAdmin();
  const cells = [];
  const add = (c) => cells.push(c);

  const leads = visible(store.state.leads);
  const overdue = leads.filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
  const openLeads = leads.filter((l) => !["won", "lost"].includes(l.status));
  add({
    id: "leads", name: "Clients & Leads",
    need: overdue.length,
    ask: `${overdue.length} follow-up${overdue.length === 1 ? "" : "s"} overdue`,
    evidence: overdue[0] ? `${overdue[0].name} — ${overdue[0].next}` : "",
    verb: "Review messages",
    quiet: openLeads.length ? `${openLeads.length} open in pipeline` : "no open leads",
  });

  const props = visible(store.state.proposals);
  const sendReady = props.filter((p) => p.status === "sent-ready");
  add({
    id: "proposals", name: "Proposals",
    need: sendReady.length,
    ask: `${sendReady.length} proposal${sendReady.length === 1 ? "" : "s"} send-ready`,
    evidence: sendReady[0] ? `${sendReady[0].client} · ${fmtMoney(sendReady[0].price)}` : "",
    verb: "Review & send",
    quiet: props.length ? `${props.length} in the forge` : "no quotes yet",
  });

  const m = moneyView();
  add({
    id: "money", name: "Money",
    need: 0, ask: "", evidence: "", verb: "",
    quiet: m.pipeline ? `${fmtMoney(m.pipeline)} open pipeline` : "no open pipeline",
  });

  const media = visible(store.state.media);
  const briefReady = media.filter((x) => x.status === "brief-ready");
  add({
    id: "media", name: "Media",
    need: briefReady.length,
    ask: `${briefReady.length} brief${briefReady.length === 1 ? "" : "s"} ready for sign-off`,
    evidence: briefReady[0] ? briefReady[0].title : "",
    verb: "Review campaign",
    quiet: media.length ? `${media.length} in production` : "nothing in production",
  });

  const sites = visible(store.state.sites);
  const toPublish = sites.filter((x) => x.status === "approved-to-publish");
  add({
    id: "sites", name: "Sites & Builds",
    need: toPublish.length,
    ask: `${toPublish.length} build${toPublish.length === 1 ? "" : "s"} approved to publish`,
    evidence: toPublish[0] ? toPublish[0].title : "",
    verb: "Push live",
    quiet: sites.length ? `${sites.length} draft${sites.length === 1 ? "" : "s"} on the bench` : "no builds yet",
  });

  const reviews = visible(store.state.reviews);
  const pubReady = reviews.filter((r) => r.status === "publish-ready" && r.quote);
  add({
    id: "reviews", name: "Reputation",
    need: pubReady.length,
    ask: `${pubReady.length} testimonial${pubReady.length === 1 ? "" : "s"} ready to go live`,
    evidence: pubReady[0] ? `"${pubReady[0].quote}"` : "",
    verb: "Publish",
    quiet: reviews.length ? `${reviews.length} in the review engine` : "no requests out",
  });

  const bookings = visible(store.state.bookings);
  const bkDrafts = bookings.filter((b) => ["draft", "pending"].includes(b.status));
  add({
    id: "bookings", name: "Bookings",
    need: bkDrafts.length,
    ask: `${bkDrafts.length} appointment${bkDrafts.length === 1 ? "" : "s"} to confirm`,
    evidence: bkDrafts[0] ? `${bkDrafts[0].type} — ${bkDrafts[0].client}` : "",
    verb: "Confirm",
    quiet: bookings.length ? `${bookings.length} on the calendar` : "calendar clear",
  });

  const sec = visible(store.state.security)[0];
  const rotDays = sec ? daysUntil(sec.rotationDue) : Infinity;
  add({
    id: "protect", name: "Protection",
    need: sec && rotDays <= 30 ? 1 : 0,
    ask: sec ? `Password rotation closes in ${rotDays} day${rotDays === 1 ? "" : "s"}` : "",
    evidence: sec ? `Last scan ${sec.proofId} — posture ${sec.posture}` : "",
    verb: "Handle it",
    quiet: sec ? `posture ${sec.posture} · scan in ${daysUntil(sec.nextScan)}d` : "no scans yet",
  });

  const agents = store.state.agents || [];
  const activeAgents = agents.filter((a) => a.status === "active").length;
  add({
    id: "workforce", name: "Workforce",
    need: 0, ask: "", evidence: "", verb: "",
    quiet: `${activeAgents}/${agents.length} desks active`,
  });

  if (admin) {
    add({ id: "outcomes", name: "Outcomes", need: 0, ask: "", evidence: "", verb: "", quiet: "what the business is driving toward" });
  }

  const liveGames = (store.state.games || []).filter((g) => g.active && g.status !== "pending-review").length;
  add({ id: "play", name: "Play", need: 0, ask: "", evidence: "", verb: "", quiet: `${liveGames} games live` });
  const liveItems = (store.state.storeItems || []).filter((p) => p.status === "live").length;
  add({ id: "store", name: "Store", need: 0, ask: "", evidence: "", verb: "", quiet: liveItems ? `${liveItems} products live` : "marketplace idle" });
  add({ id: "phantom", name: "Console", need: 0, ask: "", evidence: "", verb: "", quiet: "long-form command console" });
  if (admin) add({ id: "adminos", name: "PhantomOps", need: 0, ask: "", evidence: "", verb: "", quiet: "operator controls" });

  // attach live motion from real activity
  for (const c of cells) {
    const act = latestActivityFor(c.id);
    c.motionAt = act ? act.at : null;
    c.motionLine = act ? `${act.who} ${act.text}` : "";
  }
  return cells;
}

/* ===================== planes & rendering ===================== */

const osRoot = $("[data-os]");
const gate = $("[data-gate]");
const floorEl = $("[data-floor]");
const focusEl = $("[data-focus]");
let thread = [];           // context trail, e.g. ["leads", "money"]
let voicePinned = [];      // cards pinned into the current focus
let floorReplies = [];     // voice replies pinned on the floor

function cellsById() {
  const map = {};
  for (const c of computeCells()) map[c.id] = c;
  return map;
}

function renderFloor() {
  const cells = computeCells();
  const now = cells.filter((c) => c.need > 0).sort((a, b) => b.need - a.need);
  const inMotion = cells.filter((c) => c.need === 0 && c.motionAt)
    .sort((a, b) => new Date(b.motionAt) - new Date(a.motionAt));
  const shelf = cells.filter((c) => c.need === 0 && !c.motionAt);

  const nowBand = $("[data-band-now]");
  nowBand.innerHTML = (floorReplies.length || now.length ? `<p class="band-label">Needs you</p>` : "") +
    floorReplies.map((r, i) => `
      <article class="cell cell-reply" data-reply="${i}">
        <button class="cell-x" data-reply-x="${i}" aria-label="Dismiss">✕</button>
        <span class="cell-name">The Voice</span>
        <span class="cell-ask">${esc(r.title)}</span>
        ${r.body ? `<span class="cell-line">${esc(r.body)}</span>` : ""}
        ${r.actions.map((a) => `<button class="cell-verb" style="pointer-events:auto" data-go="${esc(a.open)}">${esc(a.label)}</button>`).join("")}
      </article>`).join("") +
    now.map((c) => `
      <button class="cell" data-cell="${c.id}">
        <span class="cell-name">${esc(c.name)}</span>
        <span class="cell-ask">${esc(c.ask)}</span>
        ${c.evidence ? `<span class="cell-line">${esc(c.evidence)}</span>` : ""}
        <span class="cell-verb">${esc(c.verb)}</span>
      </button>`).join("");

  $("[data-band-motion]").innerHTML = inMotion.length ? `<p class="band-label">In motion — working without you</p>` +
    inMotion.map((c) => `
      <button class="cell" data-cell="${c.id}">
        ${!reduceMotion ? `<span class="motion-dot" aria-hidden="true"></span>` : ""}
        <span class="cell-name">${esc(c.name)}</span>
        <span class="cell-live"><span>${esc(c.motionLine)}</span></span>
        <span class="cell-live"><i>${esc(ago(c.motionAt))}</i></span>
      </button>`).join("") : "";

  $("[data-band-shelf]").innerHTML = shelf.length ? `<p class="band-label">Quiet — resting, one tap away</p>` +
    shelf.map((c) => `
      <button class="cell" data-cell="${c.id}">
        <span class="cell-name">${esc(c.name)}</span>
        <span class="cell-line">${esc(c.quiet)}</span>
      </button>`).join("") : "";
}

/* ---- focus ---- */
function currentFocus() { return thread.length ? thread[thread.length - 1] : null; }

function renderPeriphery() {
  const focusId = currentFocus();
  if (!focusId) return;
  const cells = computeCells().filter((c) => c.id !== focusId);
  const related = new Set(RELATED[focusId] || []);
  cells.sort((a, b) => {
    const ra = related.has(a.id) ? 2 : 0, rb = related.has(b.id) ? 2 : 0;
    const na = a.need > 0 ? 1 : 0, nb = b.need > 0 ? 1 : 0;
    return (rb + nb) - (ra + na);
  });
  $("[data-periphery]").innerHTML = `<p class="periphery-label">The rest of the org</p>` +
    cells.map((c) => `
      <button class="peri-cell ${related.has(c.id) ? "linked" : ""} ${c.need > 0 ? "needs" : ""}" data-cell="${c.id}">
        ${c.motionAt && !reduceMotion ? `<span class="motion-dot" aria-hidden="true"></span>` : ""}
        <span class="cell-name">${esc(c.name)}</span>
        <span class="peri-line">${esc(c.need > 0 ? c.ask : (c.motionLine || c.quiet))}</span>
      </button>`).join("");
}

function renderVoicePins() {
  $("[data-voice-pins]").innerHTML = voicePinned.map((card, i) => `
    <div class="voice-pin">
      <button class="cell-x" data-pin-x="${i}" aria-label="Dismiss">✕</button>
      <span class="cell-name">${esc(card.kicker || "The Voice")}</span>
      <h4>${esc(card.title)}</h4>
      ${card.body ? `<p>${esc(card.body)}</p>` : ""}
      ${card.meta ? `<p><i>${esc(card.meta)}</i></p>` : ""}
      ${(card.actions || []).map((a) => `<button class="held-btn" style="margin-top:7px" data-go="${esc(a.open)}">${esc(a.label)}</button>`).join(" ")}
    </div>`).join("");
}

function renderCanvas() {
  const id = currentFocus();
  const def = WORKSPACE_DEFS[id];
  if (!def) return;
  $("[data-canvas-kicker]").textContent = def.kicker + (isAdmin() && currentWs() !== "phantomforce" ? ` · ${wsName(currentWs())}` : "");
  $("[data-canvas-title]").textContent = placeName(id);
  const canvas = $("[data-canvas]");
  const rerender = () => { def.render(canvas, rerender); if (id === "phantom") wireConsole(canvas); };
  rerender();
  renderVoicePins();
  renderPeriphery();
}

/* Long-form console (the Shelf's "Console" cell) — the deep end of the
   same Voice. History is session-scoped; every ask routes through the
   identical command engine, so console answers are real drafts too. */
const consoleHistory = [];
function wireConsole(root) {
  const log = $("[data-phantom-log]", root);
  const form = $("[data-phantom-form]", root);
  const input = $("[data-phantom-input]", root);
  if (!log || !form) return;
  const paint = () => {
    log.innerHTML = consoleHistory.map((h) => `
      <div class="phantom-entry">
        <p class="phantom-user">› ${esc(h.q)}</p>
        <p class="phantom-reply">${esc(h.say)}</p>
        ${(h.cards || []).map((c) => `
          <article class="rcard">
            <p class="rcard-kicker">${esc(c.kicker)}</p>
            <h4>${esc(c.title)}</h4>
            ${c.body ? `<p class="rcard-body">${esc(c.body)}</p>` : ""}
            ${c.meta ? `<p class="rcard-meta">${esc(c.meta)}</p>` : ""}
            ${c.actions?.length ? `<div class="rcard-actions">${c.actions.map((a) => `<button class="btn" data-open-ws="${esc(a.open)}">${esc(a.label)}</button>`).join("")}</div>` : ""}
          </article>`).join("")}
      </div>`).join("") || `<p class="phantom-hello">The deep end of the Voice. Everything you ask lands as real work — drafts, briefs, and pipelines, never just chat.</p>`;
    log.scrollTop = log.scrollHeight;
  };
  paint();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    const r = handleCommand(v);
    consoleHistory.push({ q: v, say: r.say, cards: r.cards });
    paint();
  });
  setTimeout(() => input.focus(), 60);
}

function renderThreadline() {
  const line = $("[data-threadline]");
  if (!thread.length) { line.innerHTML = ""; return; }
  const steps = [{ id: null, label: "Floor" }, ...thread.map((id) => ({ id, label: placeName(id) }))];
  line.innerHTML = steps.map((s, i) => {
    const last = i === steps.length - 1;
    return `<button class="thread-step" data-thread-i="${i}" aria-current="${last}">${esc(s.label)}</button>${last ? "" : `<span class="thread-sep">▸</span>`}`;
  }).join("");
}

function showPlane() {
  const focused = !!currentFocus();
  floorEl.hidden = focused;
  focusEl.hidden = !focused;
  renderThreadline();
  if (focused) renderCanvas();
  else renderFloor();
}

function focusOn(id, pushHash = true) {
  const def = WORKSPACE_DEFS[id];
  if (!def) return;
  if (def.adminOnly && !isAdmin()) return;
  if (currentFocus() === id) return;
  const idx = thread.indexOf(id);
  if (idx >= 0) thread = thread.slice(0, idx + 1); // returning along the trail
  else thread.push(id);
  voicePinned = [];
  showPlane();
  if (pushHash && location.hash !== `#focus/${id}`) {
    try { history.pushState(null, "", `#focus/${id}`); } catch {}
  }
  speak(`${placeName(id)} is open. ${statusLineFor(id)}`);
}

function stepBack() {
  if (!thread.length) return;
  thread.pop();
  voicePinned = [];
  showPlane();
  const id = currentFocus();
  try { history.pushState(null, "", id ? `#focus/${id}` : location.pathname + location.search); } catch {}
}

function jumpToThread(i) {
  // i = 0 is the Floor; i = n maps to thread[n-1]
  thread = thread.slice(0, i);
  voicePinned = [];
  showPlane();
  const id = currentFocus();
  try { history.pushState(null, "", id ? `#focus/${id}` : location.pathname + location.search); } catch {}
}

function statusLineFor(id) {
  const c = cellsById()[id];
  if (!c) return "";
  if (c.need > 0) return c.ask + ".";
  if (c.motionLine) return c.motionLine;
  return "";
}

/* ===================== the Desk ===================== */
const deskEl = $("[data-desk]");
const DESK_VISIBLE = 3;

function renderDesk() {
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending");
  if (!pending.length) { deskEl.hidden = true; deskEl.innerHTML = ""; return; }
  deskEl.hidden = false;
  const shown = pending.slice(0, DESK_VISIBLE);
  const extra = pending.length - shown.length;
  deskEl.innerHTML = `<button class="desk-label" data-desk-all title="Open the full decision queue">Held for you ▸</button>` +
    shown.map((a) => `
      <div class="held" data-held="${a.id}">
        <span class="held-title">${esc(a.title)}</span>
        <span class="held-meta">${esc(a.requestedBy)} · ${esc(ago(a.at))}</span>
        <span class="held-evidence">${esc(a.detail)}</span>
        <span class="held-row">
          <button class="held-btn" data-approve="${a.id}">Approve</button>
          <button class="held-btn held-return" data-return="${a.id}">Return</button>
        </span>
      </div>`).join("") +
    (extra > 0 ? `<button class="held-btn held-more desk-more" data-desk-all>+${extra} more — open the queue</button>` : "");
}

function resolveHeld(id, approved) {
  const held = deskEl.querySelector(`[data-held="${id}"]`);
  const title = visible(store.state.approvals).find((a) => a.id === id)?.title || "";
  const done = () => {
    resolveApproval(id, approved); // store.save() → onChange re-renders
    speak(`${approved ? "Approved" : "Returned"}: ${title}. The desks are moving on it.`);
  };
  if (held && !reduceMotion) {
    held.classList.add("held-leaving");
    setTimeout(done, 260);
  } else done();
}

/* ===================== the Voice ===================== */
const voiceEl = $("[data-voice]");
const voiceInput = $("[data-voice-input]");
let presenceTimer = 0, presenceIdx = 0, presenceHoldUntil = 0, typeTimer = 0;

function speak(text) {
  if (!text) return;
  presenceHoldUntil = Date.now() + 8000;
  const line = $("[data-presence-line]");
  line.classList.remove("presence-in");
  void line.offsetWidth;
  line.classList.add("presence-in");
  clearTimeout(typeTimer);
  if (reduceMotion) { line.textContent = text; return; }
  let i = 0;
  const tick = () => {
    line.textContent = text.slice(0, i);
    if (i++ < text.length) typeTimer = setTimeout(tick, 12);
  };
  tick();
}

function startPresence() {
  clearInterval(presenceTimer);
  const feed = () => {
    if (Date.now() < presenceHoldUntil) return;
    const items = visible(store.state.activity);
    if (!items.length) { $("[data-presence-line]").textContent = "The desks are quiet. Press / and ask for something."; return; }
    presenceIdx = (presenceIdx + 1) % items.length;
    const a = items[presenceIdx];
    const line = $("[data-presence-line]");
    line.classList.remove("presence-in");
    void line.offsetWidth;
    line.classList.add("presence-in");
    line.textContent = `${a.who} ${a.text}`;
  };
  presenceTimer = setInterval(feed, 5200);
}

function summonVoice() {
  voiceEl.hidden = false;
  $("[data-voice-suggests]").innerHTML = commandSuggestions()
    .map((s) => `<button class="voice-suggest" data-suggest="${esc(s)}">${esc(s)}</button>`).join("");
  setTimeout(() => voiceInput.focus(), 40);
}
function dismissVoice() { voiceEl.hidden = true; voiceInput.value = ""; }

function runIntent(text) {
  dismissVoice();
  speak("· · ·");
  setTimeout(() => {
    const r = handleCommand(text);
    speak(r.say);
    const cards = r.cards || [];
    if (r.open) {
      const wasFocused = currentFocus() === r.open;
      focusOn(r.open);
      voicePinned = cards;
      renderVoicePins();
      if (wasFocused) renderCanvas();
      speak(r.say); // focusOn spoke its own line; the answer wins
    } else if (cards.length) {
      if (currentFocus()) {
        voicePinned = cards;
        renderVoicePins();
      } else {
        floorReplies = cards.slice(0, 2).map((c) => ({ title: c.title, body: c.body, actions: c.actions || [] }));
        renderFloor();
      }
    }
  }, reduceMotion ? 60 : 420);
}

/* ===================== presence bar: lens & person ===================== */
function renderPresenceChrome() {
  $("[data-person]").textContent = isAdmin() ? `${ctx.session.name} · owner` : `${ctx.session.name}`;
  const wrap = $("[data-lens-wrap]");
  if (isAdmin()) {
    wrap.hidden = false;
    const sel = $("[data-lens]");
    sel.innerHTML = store.state.workspaces
      .map((w) => `<option value="${w.id}" ${w.id === currentWs() ? "selected" : ""}>${esc(w.name)}</option>`).join("");
    sel.onchange = () => { setWorkspace(sel.value); rerenderEverything(); };
  } else wrap.hidden = true;
}

function rerenderEverything() {
  renderPresenceChrome();
  renderDesk();
  showPlane();
}

/* ===================== boot & wiring ===================== */
function enter() {
  gate.hidden = true;
  osRoot.hidden = false;
  renderPresenceChrome();
  renderDesk();

  // one-time orientation
  let oriented = false;
  try { oriented = !!localStorage.getItem(ORIENT_KEY); } catch {}
  $("[data-orient]").hidden = oriented;

  // deep link (new #focus/x, legacy #ws/x)
  const m = location.hash.match(/^#(?:focus|ws)\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]] && !(WORKSPACE_DEFS[m[1]].adminOnly && !isAdmin())) {
    thread = [m[1]];
  }
  showPlane();
  startPresence();
  const brief = commandBriefing();
  speak(isAdmin() ? brief.healthLine : `Welcome back. Your organization is moving — the Floor shows what needs you.`);
}

function showGate() {
  gate.hidden = false;
  osRoot.hidden = true;
  // Tenant hygiene: never leave one session's rendered data in the DOM
  // for the next. Every plane resets to empty at the gate.
  voicePinned = []; floorReplies = [];
  for (const sel of ["[data-canvas]", "[data-periphery]", "[data-voice-pins]", "[data-desk]", "[data-band-now]", "[data-band-motion]", "[data-band-shelf]", "[data-threadline]"]) {
    const el = $(sel);
    if (el) el.innerHTML = "";
  }
  $("[data-desk]").hidden = true;
  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = () => {
      ctx.session = btn.dataset.enter === "admin"
        ? { role: "admin", name: "Jordan", ws: "phantomforce" }
        : { role: "client", name: "Test Client", ws: "test-client" };
      session.set(ctx.session);
      thread = [];
      enter();
    };
  });
}

/* one delegated click surface for the whole organism */
document.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-cell]");
  if (cell) { focusOn(cell.dataset.cell); return; }
  const go = e.target.closest("[data-go]");
  if (go) { focusOn(go.dataset.go); return; }
  const opener = e.target.closest("[data-open-ws]"); // legacy links inside renderers
  if (opener) { focusOn(opener.dataset.openWs); return; }
  const threadStep = e.target.closest("[data-thread-i]");
  if (threadStep) { jumpToThread(Number(threadStep.dataset.threadI)); return; }
  if (e.target.closest("[data-canvas-back]")) { stepBack(); return; }
  const approve = e.target.closest("[data-approve]");
  if (approve) { resolveHeld(approve.dataset.approve, true); return; }
  const ret = e.target.closest("[data-return]");
  if (ret) { resolveHeld(ret.dataset.return, false); return; }
  if (e.target.closest("[data-desk-all]")) { focusOn("approvals"); return; }
  if (e.target.closest("[data-sigil]")) { summonVoice(); return; }
  if (e.target.closest("[data-voice-close]")) { dismissVoice(); return; }
  const sug = e.target.closest("[data-suggest]");
  if (sug) { runIntent(sug.dataset.suggest); return; }
  const pinX = e.target.closest("[data-pin-x]");
  if (pinX) { voicePinned.splice(Number(pinX.dataset.pinX), 1); renderVoicePins(); return; }
  const replyX = e.target.closest("[data-reply-x]");
  if (replyX) { floorReplies.splice(Number(replyX.dataset.replyX), 1); renderFloor(); return; }
  if (e.target.closest("[data-orient-x]")) {
    $("[data-orient]").hidden = true;
    try { localStorage.setItem(ORIENT_KEY, "1"); } catch {}
    return;
  }
  if (e.target.closest("[data-leave]")) {
    session.clear(); ctx.session = null; thread = [];
    try { history.pushState(null, "", location.pathname + location.search); } catch {}
    showGate();
  }
});

$("[data-voice-form]").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = voiceInput.value.trim();
  if (v) runIntent(v);
});

document.addEventListener("keydown", (e) => {
  const typing = /^(input|textarea|select)$/i.test(e.target.tagName);
  if (e.key === "/" && !typing && !ctx.session?.none) {
    if (!osRoot.hidden) { e.preventDefault(); summonVoice(); }
    return;
  }
  if (e.key === "Escape") {
    if (!voiceEl.hidden) { dismissVoice(); return; }
    if (currentFocus()) stepBack();
  }
});

window.addEventListener("popstate", () => {
  const m = location.hash.match(/^#(?:focus|ws)\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]] && !(WORKSPACE_DEFS[m[1]].adminOnly && !isAdmin())) {
    const idx = thread.indexOf(m[1]);
    thread = idx >= 0 ? thread.slice(0, idx + 1) : [...thread, m[1]];
  } else {
    thread = [];
  }
  voicePinned = [];
  showPlane();
});

/* live consequence: any store write recomputes the ambient planes.
   The focused canvas re-renders through its own action callbacks, so
   mid-interaction DOM is never yanked out from under the user. */
store.onChange(() => {
  if (osRoot.hidden) return;
  renderDesk();
  if (!currentFocus()) renderFloor();
  else renderPeriphery();
});

/* boot */
ctx.session = resolveSession();
if (ctx.session) enter();
else showGate();
