/* PhantomForce Phantom — shell, overlay engine, ghost, ticker, command deck. */

import {
  store, uid, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, daysUntil, isLiveAdminHost, isStaticPublicHost,
  ownerLogin, redirectToLiveAdmin, verifyLiveSession, tenantIdForWorkspace,
} from "./store.js?v=phantom-brain-20260703-16";
import { handleCommand, commandSuggestions } from "./command.js?v=phantom-brain-20260703-16";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js?v=phantom-brain-20260703-16";

const $ = (sel, root = document) => root.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const compactScreen = window.matchMedia("(max-width: 640px)").matches;

const gate = $("[data-gate]");
const phantom = $("[data-phantom]");
const overlayRoot = $("[data-overlay-root]");

/* ============================ access gate ============================ */
function showGate() {
  gate.hidden = false;
  phantom.hidden = true;
  const card = gate.querySelector(".gate-card");
  if (isLiveAdminHost()) {
    card.innerHTML = `
      <p class="gate-kicker">PHANTOMFORCE · LIVE OWNER ACCESS</p>
      <h1>Sign in to Phantom.</h1>
      <form class="owner-login" data-owner-login>
        <label>
          <span>Owner key</span>
          <input type="password" data-owner-key autocomplete="current-password" placeholder="Enter owner key" autofocus />
        </label>
        <button class="gate-opt gate-submit" type="submit">
          <span class="gate-opt-icon">⌘</span>
          <b>Wake Phantom</b>
          <i>Backend session required. Owner login is enforced on this host.</i>
        </button>
        <p class="gate-error" data-owner-error hidden></p>
      </form>
      <p class="gate-note">Pangolin provides the private route. PhantomForce owns the visible login and session.</p>`;
    const form = card.querySelector("[data-owner-login]");
    const input = card.querySelector("[data-owner-key]");
    const error = card.querySelector("[data-owner-error]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      error.hidden = true;
      const ownerKey = input.value.trim();
      if (!ownerKey) {
        error.textContent = "Enter the owner key.";
        error.hidden = false;
        return;
      }
      form.classList.add("is-loading");
      try {
        ctx.session = await ownerLogin(ownerKey);
        enterPhantom();
      } catch (err) {
        session.clear();
        error.textContent = err?.message || "Owner login failed.";
        error.hidden = false;
      } finally {
        form.classList.remove("is-loading");
      }
    };
    return;
  }

  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.enter;
      if (kind === "admin" && isStaticPublicHost()) {
        redirectToLiveAdmin();
        return;
      }
      ctx.session = kind === "admin"
        ? { role: "admin", name: "Jordan", ws: "phantomforce" }
        : { role: "client", name: "Test Client", ws: "test-client" };
      session.set(ctx.session);
      enterPhantom();
    };
  });
}

/* ============================ shell ============================ */
function renderTopbar() {
  $("[data-role-sub]").textContent = isAdmin() ? "ADMIN PHANTOM" : "EMPLOYEE";
  const wsLabel = wsName(ctx.session.ws);
  $("[data-identity]").textContent = isAdmin()
    ? `${ctx.session.name} · operator`
    : (ctx.session.name === wsLabel ? `${wsLabel} · workspace` : `${ctx.session.name} · ${wsLabel}`);
  const options = store.state.workspaces
    .map((w) => `<option value="${w.id}" ${w.id === currentWs() ? "selected" : ""}>${esc(w.name)} — ${esc(w.kind)}</option>`)
    .join("");
  for (const [wrapSel, selSel] of [["[data-org-wrap]", "[data-org-select]"], ["[data-org-wrap-harbor]", "[data-org-select-harbor]"]]) {
    const wrap = $(wrapSel);
    const select = $(selSel);
    if (!wrap || !select) continue;
    if (isAdmin()) {
      wrap.hidden = false;
      select.innerHTML = options;
      select.onchange = () => { setWorkspace(select.value); renderDashboard(); };
    } else {
      wrap.hidden = true;
    }
  }
  $("[data-signout]").onclick = () => { session.clear(); ctx.session = null; closeOverlay(true); showGate(); };
}

/* ============================ ticker ============================ */
let tickerTimer = 0, tickerIdx = 0;
function tickerItems() {
  const activity = visible(store.state.activity);
  if (!isAdmin()) return activity;
  const toolItems = (store.state.toolSpine || []).map((tool) => ({
    id: `tool-${tool.id}`,
    ws: "phantomforce",
    who: tool.worker,
    text: tool.activity,
    at: new Date().toISOString(),
  }));
  return [...toolItems, ...activity];
}

function startTicker() {
  const line = $("[data-ticker-line]");
  const feed = () => {
    const items = tickerItems();
    if (!items.length) { line.textContent = "The desks are quiet. Ask for something."; return; }
    tickerIdx = (tickerIdx + 1) % items.length;
    const a = items[tickerIdx];
    line.classList.remove("ticker-in");
    void line.offsetWidth;
    line.textContent = `${a.who} ${a.text}`;
    line.classList.add("ticker-in");
  };
  clearInterval(tickerTimer);
  feed();
  tickerTimer = setInterval(feed, 4200);
}

/* ============================ mission grid ============================ */
function renderMission() {
  const grid = $("[data-mission]");
  grid.innerHTML = missionWidgets().map((w) => `
    <button class="widget ${w.alert ? "widget-alert" : ""}" data-open-ws="${w.id}">
      <span class="widget-icon" aria-hidden="true">${w.icon}</span>
      <span class="widget-title">${esc(w.title)}</span>
      <span class="widget-stat">${esc(w.stat)}</span>
      <span class="widget-sub">${esc(w.sub)}</span>
    </button>`).join("");
}

/* ============================ rail ============================ */
function renderRail() {
  const plan = todaysPlan();
  $("[data-rail-plan] .rail-body").innerHTML = plan.length
    ? plan.map((p) => `<button class="rail-item" data-open-ws="${p.open}"><i>${p.icon}</i><span>${esc(p.text)}</span></button>`).join("")
    : `<p class="rail-empty">Clear runway. The desks are working the routine.</p>`;

  const m = moneyView();
  $("[data-rail-money] .rail-body").innerHTML = `
    <button class="rail-item rail-money" data-open-ws="money">
      <span class="rail-money-big">${fmtMoney(m.pipeline)}</span>
      <span>open pipeline · ${fmtMoney(m.wonValue)} won · ${fmtMoney(m.retainerMonthly)}/mo retainers</span>
    </button>`;

  const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
  $("[data-rail-approvals] .rail-body").innerHTML = pend.length
    ? pend.slice(0, 4).map((a) => `<button class="rail-item rail-approval" data-open-ws="approvals"><i>◈</i><span>${esc(a.title)}</span></button>`).join("")
    : `<p class="rail-empty">Nothing waiting on you.</p>`;

  $("[data-rail-work] .rail-body").innerHTML = visible(store.state.activity).slice(0, 4)
    .map((a) => `<div class="rail-item rail-static"><span><b>${esc(a.who)}</b> ${esc(a.text)}</span><i>${ago(a.at)}</i></div>`).join("")
    || `<p class="rail-empty">Quiet.</p>`;

  reviewAlert = pend.length > 0;
  phantom?.classList.toggle("is-watching", reviewAlert);
}

function renderDashboard() {
  renderTopbar();
  renderMission();
  renderRail();
  renderSuggests();
  startTicker();
}

/* ============================ command deck ============================ */
const sayBox = () => $("[data-say]");
let typeTimer = 0;
let speechFadeTimer = 0;
let ghostMood = "idle";
let ghostEmotion = "calm";
let ghostMoodUntil = 0;
let ghostBurstStart = 0;
let ghostBurstUntil = 0;

function emotionForText(text = "") {
  const s = text.toLowerCase();
  if (/security|scan|breach|risk|threat|password|malware|approval|waiting|blocked|paid/.test(s)) return "alert";
  if (/money|pipeline|won|revenue|quote|proposal|ready|captured|drafted|live/.test(s)) return "bright";
  if (/clear|current|nothing waiting|clean|welcome/.test(s)) return "happy";
  return "calm";
}

function setGhostMood(mood, options = {}) {
  ghostMood = mood;
  ghostEmotion = options.emotion || ghostEmotion;
  ghostMoodUntil = options.ms ? performance.now() + options.ms : 0;
}

function ghostAnswerBurst(text = "") {
  if (reduceMotion) return;
  ghostPulse = 1;
  ghostBurstStart = performance.now();
  ghostBurstUntil = ghostBurstStart + 820;
  setGhostMood("talking", { emotion: emotionForText(text), ms: 1400 });
}

function speak(text, cls = "") {
  clearTimeout(typeTimer);
  clearTimeout(speechFadeTimer);
  if (!cls || cls === "thinking") {
    phantom?.classList.add("is-speaking");
    speechFadeTimer = setTimeout(() => phantom?.classList.remove("is-speaking"), Math.max(1300, text.length * 45));
  } else if (cls === "user") {
    phantom?.classList.remove("is-speaking");
  }
  const p = document.createElement("p");
  p.className = `say-line ${cls}`.trim();
  if (!cls && String(text || "").length > 95) p.classList.add("is-compact");
  sayBox().replaceChildren(p);
  const emotion = emotionForText(text);
  if (cls === "thinking") setGhostMood("thinking", { emotion: "bright" });
  else if (cls === "user") setGhostMood("listening", { emotion: "calm", ms: 1600 });
  else setGhostMood("talking", { emotion, ms: Math.max(1500, text.length * 36) });

  if (cls || reduceMotion || compactScreen) {
    p.textContent = text;
    if (!cls && !reduceMotion) setGhostMood("talking", { emotion, ms: Math.max(1100, text.length * 24) });
    else if (!cls) setGhostMood("idle", { emotion, ms: 1800 });
    return;
  }
  let i = 0;
  const tick = () => {
    p.textContent = text.slice(0, i);
    if (i++ < text.length) typeTimer = setTimeout(tick, 11 + Math.random() * 16);
    else setGhostMood("idle", { emotion, ms: 1800 });
  };
  tick();
}

function cardHtml(c) {
  return `
    <article class="rcard">
      <p class="rcard-kicker">${esc(c.kicker)}</p>
      <h4>${esc(c.title)}</h4>
      ${c.body ? `<p class="rcard-body">${esc(c.body)}</p>` : ""}
      ${c.meta ? `<p class="rcard-meta">${esc(c.meta)}</p>` : ""}
      ${c.actions?.length ? `<div class="rcard-actions">${c.actions.map((a) => `<button class="btn" data-open-ws="${a.open}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    </article>`;
}

function responseCard(kicker, title, body, actions = [], meta = "") {
  return { kicker, title, body, actions, meta };
}

function wantsDetailedAnswer(text = "") {
  return /\b(detail|detailed|deep|full|explain|novel|report|audit|step by step|strategy|write|cover letter|long)\b/i.test(text);
}

function compactReply(text = "", max = compactScreen ? 145 : 220) {
  const clean = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n+\s*[-*•]\s*/g, " · ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const sentenceMatch = clean.match(/^(.{24,}?[.!?])\s/);
  const firstSentence = sentenceMatch?.[1]?.trim();
  if (firstSentence && firstSentence.length <= max) return firstSentence;
  const slice = clean.slice(0, max + 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 80 ? lastSpace : max).trim()}...`;
}

function isTinyGreeting(text = "") {
  return /^(hey|hi|hello|yo|sup|gm|gn|good morning|good afternoon|good evening|what'?s up|wassup|you there|u there)[\s.!?]*$/i.test(text.trim());
}

function isInstantWorkIntent(text = "") {
  const s = text.trim().toLowerCase();
  return /\b(pipeline|revenue|money|unpaid|invoice|cash|proposal|quote|pricing|estimate|lead|prospect|crm|follow.?up|video brief|media lab|content job|reel|shoot|site studio|website draft|landing page|store|checkout|security scan|protect|risk radar|breach|malware|phish|password|review queue|testimonial|booking|schedule|calendar|appointment|google\s+drive|gdrive|drive file|approval|sign.?off|waiting on me|needs my eyes|pending|workforce|agents?|workers|today|what'?s next|catch me up|status|summary|help|what can you do|what do you do)\b/.test(s);
}

function isGeneralKnowledgeIntent(text = "") {
  const s = text.trim().toLowerCase();
  if (!s) return false;
  if (/\b(my|our|phantomforce|phantom|chicagoshots|client|customer|lead|proposal|pipeline|approval|money|revenue|media lab|site studio|protect|booking|agent|worker)\b/.test(s)) {
    return false;
  }
  return /^(who|what|when|where|why|how|which|define|explain|tell me about|tell me why|can you tell|can you explain|is |are |do |does |should |could |would )\b/.test(s)
    || /\?$/.test(s);
}

function shouldUseCodexBrain(text = "", localResult = {}) {
  const s = text.trim().toLowerCase();
  if (!s || isTinyGreeting(s)) return false;
  if (localResult?.skipBrain) return false;
  if (isAdmin() && (ctx.session?.token || session.token())) return true;
  if (wantsDetailedAnswer(s) || isGeneralKnowledgeIntent(s)) return true;
  if (isInstantWorkIntent(s)) return false;
  return true;
}

function inferTaskType(text) {
  const s = text.toLowerCase();
  if (/security|scan|breach|malware|phish|password|protect|hack|threat|leak|radar/.test(s)) return "security_review";
  if (/proposal|quote|pricing|estimate/.test(s)) return "proposal_work";
  if (/lead|prospect|follow/.test(s)) return "pipeline_follow_up";
  if (/video|reel|content|media|caption/.test(s)) return "media_work";
  if (/site|website|store|shop|page/.test(s)) return "site_work";
  if (/money|revenue|pipeline|invoice|payment/.test(s)) return "revenue_review";
  if (!isInstantWorkIntent(s)) return "general_chat";
  return "phantom_admin_chat";
}

function inferSensitivity(text) {
  const s = text.toLowerCase();
  if (/password|secret|token|api key|credential|breach|malware|hack|leak/.test(s)) return "high";
  if (/client|customer|lead|money|invoice|payment|proposal/.test(s)) return "medium";
  return "low";
}

function moduleItem(title, status = "", detail = "") {
  return { title: String(title || "").slice(0, 120), status: String(status || "").slice(0, 60), detail: String(detail || "").slice(0, 220) };
}

function brainModuleData() {
  const leads = visible(store.state.leads || []);
  const proposals = visible(store.state.proposals || []);
  const approvals = visible(store.state.approvals || []).filter((a) => a.status === "pending");
  const media = visible(store.state.media || []);
  const sites = visible(store.state.sites || []);
  const security = visible(store.state.security || []);
  const agents = store.state.agents || [];
  const plan = todaysPlan();
  const money = moneyView();

  return [
    {
      module: "Workspace",
      summary: `${wsName(currentWs())}. ${isAdmin() ? "Admin" : "Employee"} session. External actions remain review-and-approve.`,
      items: plan.slice(0, 5).map((p) => moduleItem(p.text, "today", `Open ${p.open}`)),
    },
    {
      module: "Approvals",
      summary: `${approvals.length} item${approvals.length === 1 ? "" : "s"} waiting on owner review. Nothing sends or publishes automatically.`,
      items: approvals.slice(0, 5).map((a) => moduleItem(a.title, a.type, a.detail)),
    },
    {
      module: "Pipeline",
      summary: `${fmtMoney(money.pipeline)} open pipeline, ${fmtMoney(money.wonValue)} won, ${fmtMoney(money.retainerMonthly)}/mo retainers attached.`,
      items: proposals.slice(0, 5).map((p) => moduleItem(p.client, p.status, `${fmtMoney(p.price)} · ${p.timeline || "timeline unset"}`)),
    },
    {
      module: "Leads",
      summary: `${leads.length} visible lead${leads.length === 1 ? "" : "s"} in this workspace.`,
      items: leads.slice(0, 5).map((l) => moduleItem(l.company || l.name, l.status, l.next)),
    },
    {
      module: "Media and sites",
      summary: `${media.length} media item${media.length === 1 ? "" : "s"} and ${sites.length} site/store draft${sites.length === 1 ? "" : "s"} visible.`,
      items: [...media.slice(0, 3).map((m) => moduleItem(m.title, m.status, m.angle)), ...sites.slice(0, 2).map((s) => moduleItem(s.title, s.status, (s.sections || []).join(" · ")))],
    },
    {
      module: "Protect",
      summary: security[0] ? `Posture ${security[0].posture}; proof ${security[0].proofId}; next scan in ${daysUntil(security[0].nextScan)} days.` : "No security record visible.",
      items: (security[0]?.findings || []).slice(0, 5).map((f) => moduleItem(f.text, f.level, "Security finding")),
    },
    {
      module: "Workers",
      summary: `${agents.filter((a) => a.status === "active").length} active worker${agents.filter((a) => a.status === "active").length === 1 ? "" : "s"} out of ${agents.length}.`,
      items: agents.slice(0, 5).map((a) => moduleItem(a.name, a.status, a.mission)),
    },
  ];
}

async function askCodexPhantomBrain(text, localResult) {
  const token = ctx.session?.token || session.token();
  if (!isAdmin() || !token) return null;
  if (!shouldUseCodexBrain(text, localResult)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 135000);
  try {
    const response = await fetch("/phantom-ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        provider: "phantom",
        admin_model: "codex",
        message: text,
        tenant_id: tenantIdForWorkspace(currentWs()),
        business_name: wsName(currentWs()),
        actor_user_id: "owner-admin",
        request_id: `app-codex-${uid("req")}`,
        task_type: inferTaskType(text),
        sensitivity_level: inferSensitivity(text),
        business_summary: "PhantomForce admin mobile command deck. Use Codex as both the operator brain and a normal general-purpose chatbot. For unrelated/general questions, answer directly without forcing dashboard context. Draft and advise only unless owner approves a separate action.",
        module_data: brainModuleData(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Local brain HTTP ${response.status}`);
    }
    const rawSay = String(payload?.message?.content || "").trim();
    const say = wantsDetailedAnswer(text) ? rawSay : compactReply(rawSay);
    if (!say) return null;

    const cards = [];
    if (payload.codex_cli?.status && payload.codex_cli.status !== "called") {
      cards.push(responseCard(
        "Brain lane",
        "Codex needs attention",
        "Codex did not complete this request, so I used the safe dashboard router instead.",
        [],
        "No action executed",
      ));
    }

    return {
      say,
      cards,
      open: localResult?.open || null,
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

function runCommand(text) {
  speak(text, "user");
  ghostFlare("listening");
  const respBox = $("[data-response]");
  respBox.innerHTML = "";
  const local = handleCommand(text);
  const appendLocalSurface = isInstantWorkIntent(text);
  if (!shouldUseCodexBrain(text, local)) {
    setTimeout(() => {
      ghostAnswerBurst(local.say);
      speak(local.say);
      respBox.innerHTML = (local.cards || []).map(cardHtml).join("");
      renderDashboard();
      if (local.open) setTimeout(() => openWorkspace(local.open), reduceMotion ? 120 : 420);
    }, reduceMotion ? 40 : 150);
    return;
  }
  setTimeout(() => {
    speak("· · ·", "thinking");
    setTimeout(async () => {
      let r = local;
      try {
        const brain = await askCodexPhantomBrain(text, local);
        if (brain?.say) {
          r = {
            ...local,
            say: brain.say,
            cards: appendLocalSurface ? [...(brain.cards || []), ...(local.cards || [])].slice(0, 4) : (brain.cards || []),
            open: appendLocalSurface ? (local.open || brain.open) : brain.open,
          };
        }
      } catch (err) {
        if (isAdmin() && (ctx.session?.token || session.token())) {
          const msg = err?.name === "AbortError" ? "Codex timed out." : (err?.message || "Codex unavailable.");
          r = {
            ...local,
            cards: [
              responseCard("Brain lane", "Codex unavailable", `${msg} I used the safe dashboard router instead.`, [], "No action executed"),
              ...(local.cards || []),
            ].slice(0, 4),
          };
        }
      }
      ghostAnswerBurst(r.say);
      speak(r.say);
      respBox.innerHTML = (r.cards || []).map(cardHtml).join("");
      renderDashboard();
      if (r.open) setTimeout(() => openWorkspace(r.open), reduceMotion ? 150 : 750);
    }, reduceMotion ? 120 : 620);
  }, reduceMotion ? 60 : 260);
}

function renderSuggests() {
  $("[data-suggests]").innerHTML = commandSuggestions()
    .map((s) => `<button class="suggest" data-suggest="${esc(s)}">${esc(s)}</button>`).join("");
}

function wireCommandDeck() {
  const form = $("[data-command-form]");
  const input = $("[data-command-input]");
  input.addEventListener("focus", () => setGhostMood("listening", { emotion: "calm" }));
  input.addEventListener("input", () => setGhostMood("listening", { emotion: "bright" }));
  input.addEventListener("blur", () => setGhostMood("idle", { emotion: "calm", ms: 600 }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    runCommand(v);
  });
  document.addEventListener("click", (e) => {
    const sug = e.target.closest("[data-suggest]");
    if (sug) { setHarbor(false); runCommand(sug.dataset.suggest); return; }
    const opener = e.target.closest("[data-open-ws]");
    if (opener) { setHarbor(false); openWorkspace(opener.dataset.openWs); }
  });
}

/* ============================ harbor ============================ */
const harbor = $("[data-harbor]");
function setHarbor(open) {
  if (!harbor) return;
  harbor.hidden = !open;
  phantom?.classList.toggle("is-harbor", open);
  if (open) { setGhostMood("harbor", { emotion: "happy" }); ghostPulse = Math.max(ghostPulse, 0.7); }
  else if (ghostMood === "harbor") setGhostMood("idle", { emotion: "calm" });
  const toggle = $("[data-harbor-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
}
function wireHarbor() {
  const toggle = $("[data-harbor-toggle]");
  if (toggle) toggle.addEventListener("click", () => setHarbor(harbor.hidden));
  harbor?.querySelectorAll("[data-harbor-close]").forEach((b) => b.addEventListener("click", () => setHarbor(false)));
}

/* Short, alive status line — never a dashboard headline. */
function phantomBrief() {
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const plan = todaysPlan().length;
  if (!isAdmin()) {
    return plan
      ? `Your workspace is moving. ${plan} thing${plan === 1 ? "" : "s"} in motion.`
      : "Your workspace is quiet. I'm watching.";
  }
  if (pending === 1) return "One item needs review.";
  if (pending > 1) return `${pending} items need review.`;
  if (plan) return `${plan} thing${plan === 1 ? "" : "s"} need attention. I'll surface what matters first.`;
  return "All clear. I'm watching every desk.";
}

/* ============================ overlay engine ============================ */
let openId = null;
function openWorkspace(id, pushHash = true) {
  const def = WORKSPACE_DEFS[id];
  if (!def) return;
  if (def.adminOnly && !isAdmin()) return;
  closeOverlay(false);
  openId = id;
  document.body.classList.add("overlay-open");
  overlayRoot.innerHTML = `
    <div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(def.title)}">
      <button class="overlay-backdrop" data-overlay-close aria-label="Back to phantom"></button>
      <section class="overlay-panel">
        <header class="overlay-head">
          <div>
            <p class="overlay-kicker">${esc(def.kicker)}${isAdmin() && currentWs() !== "phantomforce" ? ` · ${esc(wsName(currentWs()))}` : ""}</p>
            <h2>${esc(def.title)}</h2>
          </div>
          <button class="overlay-x" data-overlay-close aria-label="Close workspace">✕</button>
        </header>
        <div class="overlay-body" data-overlay-body></div>
      </section>
    </div>`;
  const body = $("[data-overlay-body]", overlayRoot);
  const rerender = () => { def.render(body, rerender); if (id === "phantom") wirePhantomConsole(body); };
  rerender();
  overlayRoot.querySelectorAll("[data-overlay-close]").forEach((b) => b.addEventListener("click", () => closeOverlay(true)));
  if (pushHash && location.hash !== `#ws/${id}`) {
    try { history.pushState(null, "", `#ws/${id}`); } catch {}
  }
}

function closeOverlay(clearHash) {
  if (!openId) return;
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
  if (clearHash && location.hash.startsWith("#ws/")) {
    try { history.pushState(null, "", location.pathname + location.search); } catch {}
  }
  renderDashboard();
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (openId) { closeOverlay(true); return; }
  if (harbor && !harbor.hidden) setHarbor(false);
});
window.addEventListener("popstate", () => {
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  else closeOverlay(false);
});

/* ============================ phantom console ============================ */
const phantomHistory = [];
function wirePhantomConsole(body) {
  const log = $("[data-phantom-log]", body);
  const form = $("[data-phantom-form]", body);
  const input = $("[data-phantom-input]", body);
  const paint = () => {
    log.innerHTML = phantomHistory.map((h) => `
      <div class="phantom-entry">
        <p class="phantom-user">› ${esc(h.q)}</p>
        <p class="phantom-reply">${esc(h.say)}</p>
        ${(h.cards || []).map(cardHtml).join("")}
      </div>`).join("") || `<p class="phantom-hello">This is the full Phantom brain. Anything you drop here turns into a draft, brief, pipeline view, or reviewable next step.</p>`;
    log.scrollTop = log.scrollHeight;
  };
  paint();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    const local = handleCommand(v);
    let r = local;
    try {
      const brain = await askCodexPhantomBrain(v, local);
      if (brain?.say) {
        r = { ...local, say: brain.say, cards: [...(brain.cards || []), ...(local.cards || [])].slice(0, 4) };
      }
    } catch {
      r = local;
    }
    phantomHistory.push({ q: v, say: r.say, cards: r.cards });
    paint();
    renderDashboard();
  });
  setTimeout(() => input.focus(), 60);
}

/* ============================ ghost (twilight cyber-spirit) ============================ */
let ghostPulse = 0;
let reviewAlert = false;
function ghostFlare(mood = "bright") {
  ghostPulse = 1;
  const knownMood = ["idle", "listening", "thinking", "talking", "happy", "harbor"].includes(mood) ? mood : "talking";
  setGhostMood(knownMood, { emotion: mood === "listening" ? "calm" : mood, ms: 1200 });
}
function initGhost() {
  const canvas = $("[data-ghost]");
  if (!canvas) return;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return;
  const small = window.matchMedia("(max-width: 720px)").matches;
  const N = small ? 700 : 1300;
  const GA = 2.399963229728653, NTEND = 7;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const v = k / (N - 1);
    const angp = k * GA;
    const tend = Math.pow(0.5 + 0.5 * Math.cos(angp * NTEND), 1.7);
    const hemY = -0.6 - tend * 1.05;
    let R, y;
    if (v < 0.3) { const u = v / 0.3; R = Math.sin((u * Math.PI) / 2); y = 1.55 - u * 0.95; }
    else if (v < 0.6) { const u = (v - 0.3) / 0.3; R = 1 - 0.05 * Math.sin(u * Math.PI); y = 0.6 - u; }
    else { const u = (v - 0.6) / 0.4; R = 1 - 0.16 * u; y = -0.4 + u * (hemY + 0.4); }
    const rr = R * (0.9 + 0.1 * (((k * 9301) % 233) / 233));
    pts.push({ x: Math.cos(angp) * rr, y, z: Math.sin(angp) * rr * 0.58, tw: ((k * 7919) % 997) / 997, rim: R });
  }

  let w = 0, h = 0, dpr = 1;
  const accents = {
    calm: [65, 255, 161],
    happy: [132, 255, 207],
    bright: [30, 240, 255],
    alert: [255, 92, 116],
  };
  const VIOLET = [154, 107, 255];
  const AMBER = [255, 209, 102];
  const css = (c, alpha) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
  const mixc = (a, b, m) => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];

  /* gaze — follows pointer/touch, wanders on its own when left alone */
  let pgx = 0, pgy = 0, gx = 0, gy = 0, cpx = 0, lastPointer = -1e9;
  const phoneTilt = { x: 0, y: 0, tx: 0, ty: 0, activeUntil: 0, armed: false, asked: false };
  const onPoint = (e) => {
    pgx = (e.clientX / innerWidth) * 2 - 1;
    pgy = (e.clientY / innerHeight) * 2 - 1;
    lastPointer = performance.now();
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const onTilt = (e) => {
    if (typeof e.gamma !== "number" || typeof e.beta !== "number") return;
    phoneTilt.tx = clamp(e.gamma / 24, -1, 1);
    phoneTilt.ty = clamp(e.beta / 38, -1, 1);
    phoneTilt.activeUntil = performance.now() + 900;
  };
  const attachTilt = () => {
    if (phoneTilt.armed || !("DeviceOrientationEvent" in window)) return;
    phoneTilt.armed = true;
    window.addEventListener("deviceorientation", onTilt, { passive: true });
  };
  const requestTilt = () => {
    if (phoneTilt.asked || reduceMotion || !("DeviceOrientationEvent" in window)) return;
    phoneTilt.asked = true;
    const Orientation = window.DeviceOrientationEvent;
    if (typeof Orientation.requestPermission === "function") {
      Orientation.requestPermission()
        .then((state) => { if (state === "granted") attachTilt(); })
        .catch(() => undefined);
    } else {
      attachTilt();
    }
  };

  /* idle mischief — side-eye, winks, smirks on its own clock */
  const mis = { kind: "", side: 1, until: 0, next: performance.now() + 4200 };

  /* asymmetric orbiting sigils — original glyphs, never copied marks */
  const SIGILS = [
    { r: 1.28, tilt: 0.5, speed: 0.22, phase: 0.0, kind: 0, s: 0.05 },
    { r: 1.46, tilt: 0.34, speed: -0.15, phase: 2.2, kind: 1, s: 0.042 },
    { r: 1.12, tilt: 0.6, speed: 0.3, phase: 4.1, kind: 2, s: 0.048 },
    { r: 1.55, tilt: 0.28, speed: 0.11, phase: 1.1, kind: 3, s: 0.058 },
    { r: 1.2, tilt: 0.54, speed: -0.26, phase: 5.3, kind: 1, s: 0.036 },
  ];
  const WISPS = [
    { bx: -0.34, tall: 0.28, lean: -0.16, ph: 0 },
    { bx: 0.3, tall: 0.2, lean: 0.2, ph: 2.1 },
  ];
  const spark = { x: 0, y: 0, seeded: false, trail: [] };

  const drawSigil = (kind, x, y, s, rotS, strokeStyle) => {
    ctx2.strokeStyle = strokeStyle;
    ctx2.lineWidth = 1;
    ctx2.save();
    ctx2.translate(x, y);
    ctx2.rotate(rotS);
    ctx2.beginPath();
    if (kind === 0) { ctx2.moveTo(0, -s); ctx2.lineTo(s * 0.7, 0); ctx2.lineTo(0, s); ctx2.lineTo(-s * 0.7, 0); ctx2.closePath(); }
    else if (kind === 1) { ctx2.moveTo(0, -s); ctx2.lineTo(s * 0.85, s * 0.6); ctx2.lineTo(-s * 0.85, s * 0.6); ctx2.closePath(); }
    else if (kind === 2) { ctx2.moveTo(0, -s); ctx2.lineTo(0, s); ctx2.moveTo(-s * 0.6, -s * 0.25); ctx2.lineTo(s * 0.6, s * 0.25); }
    else { ctx2.arc(0, 0, s, Math.PI * 0.7, Math.PI * 1.9); }
    ctx2.stroke();
    ctx2.restore();
  };

  const t0 = performance.now();
  const draw = (now) => {
    const t = (now - t0) * 0.001;
    if (ghostMoodUntil && now > ghostMoodUntil) {
      ghostMood = "idle";
      ghostMoodUntil = 0;
    }
    const mood = ghostMood, emotion = ghostEmotion;
    ghostPulse = Math.max(0, ghostPulse - 0.02);
    phoneTilt.x += (phoneTilt.tx - phoneTilt.x) * 0.08;
    phoneTilt.y += (phoneTilt.ty - phoneTilt.y) * 0.08;
    const tiltLive = now < phoneTilt.activeUntil;
    if (!tiltLive) {
      phoneTilt.tx *= 0.94;
      phoneTilt.ty *= 0.94;
    }

    let act = "";
    if (mood === "idle") {
      if (now > mis.next) {
        const kinds = ["glance", "wink", "smirk", "peek"];
        mis.kind = kinds[(Math.random() * kinds.length) | 0];
        mis.side = Math.random() < 0.5 ? -1 : 1;
        mis.until = now + 850 + Math.random() * 800;
        mis.next = mis.until + 5600 + Math.random() * 8600;
      }
      if (now < mis.until) act = mis.kind;
    } else {
      mis.until = 0;
      if (mis.next < now + 2600) mis.next = now + 2600;
    }

    let tgx = pgx, tgy = pgy;
    if (now - lastPointer > 3500) {
      tgx = Math.sin(t * 0.33) * 0.45 + Math.sin(t * 0.11 + 2) * 0.2;
      tgy = Math.sin(t * 0.24 + 1.7) * 0.22;
    }
    if (tiltLive && now - lastPointer > 1200) {
      tgx = phoneTilt.x * 0.9;
      tgy = phoneTilt.y * 0.48;
    }
    if (act === "glance" || act === "peek") { tgx = mis.side * 0.95; tgy = -0.12; }
    gx += (tgx - gx) * 0.06;
    gy += (tgy - gy) * 0.06;
    cpx += (gx * 0.55 - cpx) * 0.05;

    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    const tiltShiftX = tiltLive ? phoneTilt.x * Math.min(18, w * 0.04) : 0;
    const tiltShiftY = tiltLive ? phoneTilt.y * Math.min(8, h * 0.018) : 0;
    const scale = Math.min(w, h) * 0.31;
    const talkBeat = mood === "talking" ? Math.abs(Math.sin(t * 9.5)) : 0;
    const talkWave = mood === "talking" ? Math.sin(t * 7.2) : 0;
    const talkNod = mood === "talking" ? Math.sin(t * 10.4) : 0;
    const cx = w / 2 + tiltShiftX + talkWave * scale * 0.035;
    const cy = h * 0.56 + tiltShiftY + talkBeat * scale * 0.018 - talkNod * scale * 0.01;
    const burstOn = now < ghostBurstUntil && ghostBurstUntil > ghostBurstStart;
    const burstT = burstOn ? clamp((now - ghostBurstStart) / (ghostBurstUntil - ghostBurstStart), 0, 1) : 1;
    const burstEase = 1 - Math.pow(1 - burstT, 3);
    const answerSpin = burstOn ? burstEase * Math.PI * 2 : 0;
    const tiltLean = (tiltLive ? phoneTilt.x : cpx) * 0.22;
    const talkLean = mood === "talking" ? Math.sin(t * 5.6) * 0.075 : 0;
    const moodLean =
      mood === "thinking" ? Math.sin(t * 4.2) * 0.055 :
      mood === "listening" ? Math.sin(t * 2.2) * 0.035 :
      mood === "harbor" ? Math.sin(t * 1.4) * 0.045 :
      0;
    const rot = answerSpin + tiltLean + cpx * 0.35 + moodLean + talkLean + Math.sin(t * 0.55) * 0.025;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const thinkBeat = mood === "thinking" ? Math.abs(Math.sin(t * 5.2)) : 0;
    const breath = 1 + Math.sin(t * 0.9) * 0.025 + ghostPulse * 0.1 + talkBeat * 0.04;
    const bodyScaleX = breath * (1 + talkBeat * 0.035);
    const bodyScaleY = breath * (1 - talkBeat * 0.02);
    const floatY = Math.sin(t * 1.1) * 4 + Math.sin(t * 3.2) * (mood === "talking" ? 2.2 : 0.7) + talkNod * 1.4;
    const accent = accents[emotion] || accents.calm;
    const accentCss = (alpha) => css(accent, alpha);
    const bodyY = cy - 0.35 * scale + floatY;

    ctx2.globalCompositeOperation = "lighter";

    /* twilight halo */
    const hy = cy - 0.45 * scale + floatY * 0.5;
    const haloR = scale * (mood === "harbor" ? 2.0 : 1.7);
    const halo = ctx2.createRadialGradient(cx, hy, 0, cx, hy, haloR);
    halo.addColorStop(0, accentCss(0.085 + ghostPulse * 0.07));
    halo.addColorStop(0.55, css(VIOLET, 0.05 + (mood === "harbor" ? 0.03 : 0)));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx2.fillStyle = halo;
    ctx2.fillRect(0, 0, w, h);

    /* readable energy body: staged behind particles so Phantom stays visible while talking */
    ctx2.save();
    ctx2.translate(cx, cy + floatY);
    ctx2.rotate(rot * 0.12);
    ctx2.scale(bodyScaleX, bodyScaleY);
    const shell = ctx2.createLinearGradient(0, -scale * 1.42, 0, scale * 0.74);
    shell.addColorStop(0, css(VIOLET, 0.08 + ghostPulse * 0.03));
    shell.addColorStop(0.34, accentCss(0.11 + talkBeat * 0.025 + ghostPulse * 0.035));
    shell.addColorStop(0.8, accentCss(0.07 + talkBeat * 0.018));
    shell.addColorStop(1, "rgba(0,0,0,0)");
    ctx2.shadowColor = accentCss(0.55);
    ctx2.shadowBlur = 24 + ghostPulse * 18 + talkBeat * 8;
    ctx2.fillStyle = shell;
    ctx2.strokeStyle = accentCss(0.16 + talkBeat * 0.09 + ghostPulse * 0.08);
    ctx2.lineWidth = 1.2;
    ctx2.beginPath();
    ctx2.moveTo(0, -scale * 1.45);
    ctx2.bezierCurveTo(scale * 0.68, -scale * 1.35, scale * 0.93, -scale * 0.74, scale * 0.88, -scale * 0.04);
    ctx2.bezierCurveTo(scale * 0.84, scale * 0.3, scale * 0.7, scale * 0.58, scale * 0.52, scale * 0.72);
    ctx2.lineTo(scale * 0.32, scale * 0.58);
    ctx2.lineTo(scale * 0.14, scale * 0.8);
    ctx2.lineTo(0, scale * 0.62);
    ctx2.lineTo(-scale * 0.14, scale * 0.8);
    ctx2.lineTo(-scale * 0.32, scale * 0.58);
    ctx2.lineTo(-scale * 0.52, scale * 0.72);
    ctx2.bezierCurveTo(-scale * 0.7, scale * 0.58, -scale * 0.84, scale * 0.3, -scale * 0.88, -scale * 0.04);
    ctx2.bezierCurveTo(-scale * 0.93, -scale * 0.74, -scale * 0.68, -scale * 1.35, 0, -scale * 1.45);
    ctx2.closePath();
    ctx2.fill();
    ctx2.stroke();
    ctx2.restore();

    /* crescent aura arcs — asymmetric, counter-rotating */
    const quiver = emotion === "alert" ? Math.sin(t * 26) * scale * 0.014 : 0;
    const crescents = [
      { r: 1.3, a0: t * 0.3, span: 1.9, al: 0.15, c: VIOLET },
      { r: 1.06, a0: -t * 0.22 + 2.4, span: 1.15, al: 0.11, c: accent },
    ];
    for (const cr of crescents) {
      ctx2.strokeStyle = css(emotion === "alert" ? accents.alert : cr.c, (cr.al + ghostPulse * 0.12) * (mood === "harbor" ? 1.5 : 1));
      ctx2.lineWidth = 1.2;
      ctx2.beginPath();
      ctx2.arc(cx, cy - 0.55 * scale + floatY * 0.6, (cr.r + (mood === "harbor" ? 0.1 : 0)) * scale + quiver, cr.a0, cr.a0 + cr.span);
      ctx2.stroke();
    }

    ctx2.save();
    ctx2.translate(cx, cy + scale * 0.64 + floatY * 0.35);
    ctx2.rotate(rot * 0.32);
    for (let ring = 0; ring < 3; ring++) {
      const pulse = (t * 0.38 + ring / 3) % 1;
      ctx2.strokeStyle = css(ring === 2 ? VIOLET : accent, (0.22 - pulse * 0.16) * (mood === "thinking" ? 1.3 : 0.8));
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.ellipse(0, 0, scale * (0.72 + pulse * 0.48), scale * (0.13 + pulse * 0.08), 0, 0, Math.PI * 2);
      ctx2.stroke();
    }
    ctx2.restore();

    /* floating sigils */
    for (let i = 0; i < SIGILS.length; i++) {
      const sg = SIGILS[i];
      const ang = t * sg.speed + sg.phase;
      const sgx = cx + Math.cos(ang) * sg.r * scale;
      const sgy = bodyY + Math.sin(ang) * sg.r * scale * sg.tilt - Math.sin(t * 0.7 + sg.phase) * scale * 0.05;
      let col = sg.kind % 2 ? accent : VIOLET;
      if (reviewAlert && i === 0) col = AMBER;
      const al = (0.1 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.9 + sg.phase * 2))) * (mood === "thinking" ? 1.7 : 1) + ghostPulse * 0.2;
      drawSigil(sg.kind, sgx, sgy, sg.s * scale, t * 0.5 + sg.phase, css(col, Math.min(0.5, al)));
    }

    /* body particles */
    for (const p of pts) {
      let ny = p.y;
      if (p.y < -0.2) {
        const m = Math.min(1, (-0.2 - p.y) / 1.2);
        ny = p.y + (Math.sin(p.x * 4 + t * 2.4) * 0.09 + Math.sin(p.z * 5 - t * 1.7) * 0.05) * m;
      }
      const moodWarp = mood === "thinking" ? Math.sin(t * 6 + p.x * 4 + p.z * 3) * 0.018 : 0;
      const sw = 1 + Math.sin(t * 1.4 + p.tw * 6.283) * 0.02;
      const rx = (p.x * cosR + p.z * sinR) * sw;
      const rz = (-p.x * sinR + p.z * cosR) * sw;
      const X = cx + (rx + moodWarp) * scale * bodyScaleX;
      const Y = cy - ny * scale * bodyScaleY + floatY + (mood === "talking" ? Math.sin(t * 10 + p.tw * 6.283) * talkBeat * scale * 0.011 : 0);
      const depth = (rz + 1) / 2;
      const faceZone =
        Math.abs(X - cx) < scale * 0.53 &&
        Y > cy - scale * 1.08 + floatY &&
        Y < cy - scale * 0.37 + floatY;
      const expressionZone =
        Math.abs(X - cx) < scale * 0.42 &&
        Y > cy - scale * 1.02 + floatY &&
        Y < cy - scale * 0.46 + floatY;
      let a = (0.24 + depth * 0.58 + ghostPulse * 0.34) * (0.9 + 0.28 * Math.sin(t * 2.3 + p.tw * 6.283));
      if (p.rim > 0.93) a *= 1.45;
      if (mood === "talking") a *= 1.12;
      if (faceZone) a *= expressionZone ? 0.1 : 0.28;
      const greenMix = emotion === "alert" ? 0.55 : 1;
      let r = 65 * greenMix + accent[0] * (1 - greenMix);
      let g = 255 * greenMix + accent[1] * (1 - greenMix);
      let b = 161 * greenMix + accent[2] * (1 - greenMix);
      if (ny < -0.75) {
        const mv = Math.min(0.4, (-0.75 - ny) * 0.45);
        r += (VIOLET[0] - r) * mv; g += (VIOLET[1] - g) * mv; b += (VIOLET[2] - b) * mv;
      }
      ctx2.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${Math.min(0.92, a)})`;
      const sz = (1.02 + depth * 1.45 + talkBeat * 0.55) * (faceZone ? 0.48 : 1);
      ctx2.fillRect(X, Y, sz, sz);
    }

    /* crown wisps — asymmetric antennae that perk with mood */
    const perk =
      mood === "listening" ? 1.3 :
      mood === "harbor" || mood === "happy" || emotion === "happy" ? 1.16 :
      emotion === "alert" ? 0.6 : 1;
    const headY = cy - 1.36 * scale * bodyScaleY + floatY;
    ctx2.lineCap = "round";
    for (const wsp of WISPS) {
      const bx = cx + (wsp.bx * cosR + 0.5 * sinR * 0.25) * scale * bodyScaleX + gx * scale * 0.03;
      const sway = Math.sin(t * 1.6 + wsp.ph) * 0.07 + gx * 0.08;
      const tipX = bx + (wsp.lean + sway) * scale;
      const tipY = headY - wsp.tall * perk * scale;
      ctx2.strokeStyle = css(VIOLET, 0.34 + ghostPulse * 0.2);
      for (let i = 0; i < 2; i++) {
        ctx2.lineWidth = 1.7 - i * 0.8;
        ctx2.beginPath();
        ctx2.moveTo(bx - i * 2, headY + scale * 0.06);
        ctx2.quadraticCurveTo(bx + (wsp.lean * 0.3 + sway * 1.4) * scale, headY - wsp.tall * perk * scale * 0.55, tipX + i * 1.5, tipY + i * 2);
        ctx2.stroke();
      }
      ctx2.fillStyle = accentCss(0.5 + ghostPulse * 0.3);
      ctx2.beginPath(); ctx2.arc(tipX, tipY, 1.3, 0, Math.PI * 2); ctx2.fill();
    }

    /* expressive face */
    const blink = (Math.sin(t * 0.9) > 0.995) ? 0.12 : 1;
    const happyEyes = mood === "harbor" || mood === "happy" || (emotion === "happy" && (mood === "idle" || mood === "talking"));
    const eyeSquint =
      mood === "thinking" ? 0.62 :
      emotion === "alert" ? 0.7 :
      act === "glance" || act === "peek" ? 0.82 :
      mood === "listening" ? 1.22 :
      1;
    const eyeY = cy - 0.74 * scale * bodyScaleY + floatY + gy * scale * 0.045 - talkBeat * scale * 0.012;
    for (const sx of [-0.3, 0.3]) {
      const winking = act === "wink" && (sx > 0 ? 1 : -1) === mis.side;
      const ex = cx + (sx * cosR + 0.62 * sinR * 0.4) * scale * bodyScaleX + gx * scale * 0.06;
      const browY = eyeY - scale * (0.18 + talkBeat * 0.015);
      ctx2.strokeStyle = accentCss(mood === "talking" ? 0.55 : 0.28);
      ctx2.lineWidth = Math.max(1, scale * 0.012);
      ctx2.beginPath();
      ctx2.moveTo(ex - scale * 0.12, browY + (sx < 0 ? -talkBeat * scale * 0.02 : talkBeat * scale * 0.015));
      ctx2.quadraticCurveTo(ex, browY - scale * (0.022 + talkBeat * 0.018), ex + scale * 0.12, browY + (sx > 0 ? -talkBeat * scale * 0.02 : talkBeat * scale * 0.015));
      ctx2.stroke();
      if (happyEyes && !winking) {
        ctx2.strokeStyle = accentCss(0.9);
        ctx2.lineWidth = Math.max(1.4, scale * 0.03);
        ctx2.beginPath();
        ctx2.arc(ex, eyeY + scale * 0.05, scale * 0.11, Math.PI * 1.12, Math.PI * 1.88);
        ctx2.stroke();
        continue;
      }
      const lid = winking ? 0.07 : blink;
      const g2 = ctx2.createRadialGradient(ex, eyeY, 0, ex, eyeY, scale * 0.16);
      g2.addColorStop(0, `rgba(235,255,246,${0.9 + ghostPulse * 0.1})`);
      g2.addColorStop(0.45, accentCss(0.72 + ghostPulse * 0.2));
      g2.addColorStop(1, accentCss(0));
      ctx2.fillStyle = g2;
      ctx2.save();
      ctx2.translate(ex, eyeY);
      ctx2.rotate(emotion === "alert" ? sx * -0.22 : Math.sin(t * 1.8 + sx) * 0.04);
      ctx2.scale(0.68, 1.18 * lid * eyeSquint);
      ctx2.beginPath(); ctx2.arc(0, 0, scale * 0.16, 0, Math.PI * 2); ctx2.fill();
      ctx2.strokeStyle = accentCss(0.5);
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.arc(0, 0, scale * 0.19, Math.PI * 0.08, Math.PI * 1.92);
      ctx2.stroke();
      ctx2.restore();
      if (lid > 0.5) {
        ctx2.fillStyle = `rgba(240,255,250,${0.85 + ghostPulse * 0.15})`;
        ctx2.beginPath();
        ctx2.arc(ex + gx * scale * 0.045, eyeY + gy * scale * 0.035, scale * 0.045 * Math.min(1, eyeSquint), 0, Math.PI * 2);
        ctx2.fill();
      }
    }

    const faceY = cy - 0.49 * scale * bodyScaleY + floatY + gy * scale * 0.03 + talkNod * scale * 0.012;
    const mouthX = cx + gx * scale * 0.05 + talkWave * scale * 0.018;
    ctx2.strokeStyle = accentCss(0.72);
    ctx2.lineWidth = Math.max(1, scale * 0.012);
    ctx2.shadowColor = accentCss(0.8);
    ctx2.shadowBlur = 9 + ghostPulse * 10;
    ctx2.lineCap = "round";
    ctx2.lineJoin = "round";
    let mouthPainted = false;
    ctx2.beginPath();
    if (mood === "talking") {
      mouthPainted = true;
      const phoneme = (Math.sin(t * 13.4) + 1) / 2;
      const open = 0.35 + talkBeat * 0.65;
      ctx2.save();
      ctx2.shadowColor = accentCss(0.86);
      ctx2.shadowBlur = 13 + talkBeat * 10;
      ctx2.strokeStyle = accentCss(0.88);
      ctx2.fillStyle = `rgba(1, 8, 6, ${0.55 + talkBeat * 0.18})`;
      ctx2.lineWidth = Math.max(1.5, scale * 0.018);
      if (phoneme < 0.34) {
        ctx2.beginPath();
        ctx2.ellipse(mouthX, faceY + scale * 0.01, scale * (0.085 + open * 0.045), scale * (0.055 + open * 0.075), 0, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.stroke();
        ctx2.fillStyle = accentCss(0.42);
        ctx2.beginPath();
        ctx2.ellipse(mouthX, faceY - scale * 0.012, scale * 0.04, scale * 0.016, 0, 0, Math.PI * 2);
        ctx2.fill();
      } else if (phoneme < 0.68) {
        ctx2.beginPath();
        ctx2.moveTo(mouthX - scale * 0.22, faceY + scale * 0.01);
        ctx2.bezierCurveTo(
          mouthX - scale * 0.12, faceY + scale * (0.075 + open * 0.025),
          mouthX + scale * 0.12, faceY + scale * (0.075 + open * 0.025),
          mouthX + scale * 0.22, faceY + scale * 0.01,
        );
        ctx2.stroke();
        ctx2.beginPath();
        ctx2.moveTo(mouthX - scale * 0.13, faceY - scale * 0.035);
        ctx2.quadraticCurveTo(mouthX, faceY - scale * 0.005, mouthX + scale * 0.13, faceY - scale * 0.035);
        ctx2.strokeStyle = accentCss(0.4);
        ctx2.stroke();
      } else {
        ctx2.beginPath();
        ctx2.moveTo(mouthX - scale * 0.24, faceY);
        ctx2.quadraticCurveTo(mouthX, faceY - scale * (0.035 + talkBeat * 0.025), mouthX + scale * 0.24, faceY);
        ctx2.stroke();
        ctx2.beginPath();
        ctx2.moveTo(mouthX - scale * 0.12, faceY + scale * 0.032);
        ctx2.quadraticCurveTo(mouthX, faceY + scale * (0.045 + talkBeat * 0.02), mouthX + scale * 0.12, faceY + scale * 0.032);
        ctx2.strokeStyle = accentCss(0.48);
        ctx2.stroke();
      }
      ctx2.restore();
    } else if (mood === "thinking") {
      for (let i = 0; i < 3; i++) {
        const x = mouthX + (i - 1) * scale * 0.13;
        const y = faceY + Math.sin(t * 5 + i) * scale * 0.018;
        ctx2.moveTo(x + scale * 0.025, y);
        ctx2.arc(x, y, scale * (0.02 + thinkBeat * 0.006), 0, Math.PI * 2);
      }
    } else if (mood === "listening") {
      ctx2.ellipse(mouthX, faceY + scale * 0.006, scale * 0.045, scale * 0.055, 0, 0, Math.PI * 2);
    } else if (emotion === "alert") {
      ctx2.moveTo(mouthX - scale * 0.22, faceY);
      ctx2.lineTo(mouthX - scale * 0.08, faceY + scale * 0.035);
      ctx2.lineTo(mouthX + scale * 0.08, faceY - scale * 0.035);
      ctx2.lineTo(mouthX + scale * 0.22, faceY);
    } else if (mood === "harbor" || mood === "happy" || emotion === "happy") {
      ctx2.arc(mouthX, faceY - scale * 0.02, scale * (mood === "harbor" ? 0.24 : 0.2), 0.12 * Math.PI, 0.88 * Math.PI);
    } else if (act === "smirk" || act === "peek") {
      ctx2.moveTo(mouthX - scale * 0.15, faceY + (mis.side < 0 ? -scale * 0.045 : scale * 0.008));
      ctx2.quadraticCurveTo(mouthX, faceY - scale * 0.01, mouthX + scale * 0.15, faceY + (mis.side > 0 ? -scale * 0.045 : scale * 0.008));
    } else {
      ctx2.moveTo(mouthX - scale * 0.15, faceY);
      ctx2.quadraticCurveTo(mouthX, faceY + scale * 0.018, mouthX + scale * 0.15, faceY - scale * 0.008);
    }
    if (!mouthPainted) ctx2.stroke();
    ctx2.shadowBlur = 0;

    const coreAlpha = mood === "thinking" || emotion === "alert" ? 0.54 : 0.26;
    for (const [nx, nny] of [[-0.18, 0.16], [0.18, 0.16], [0, 0.34]]) {
      const x = cx + (nx * cosR + 0.3 * sinR * 0.18) * scale;
      const y = cy + nny * scale + floatY;
      ctx2.fillStyle = accentCss(coreAlpha);
      ctx2.beginPath();
      ctx2.arc(x, y, scale * 0.018, 0, Math.PI * 2);
      ctx2.fill();
    }

    /* companion spark — the little imp-light */
    const sparkCol = mixc(accent, VIOLET, 0.65);
    let tx, ty;
    if (mood === "listening") {
      tx = cx - 0.58 * scale + Math.sin(t * 2.1) * 4;
      ty = eyeY - 0.22 * scale + Math.cos(t * 1.7) * 5;
    } else if (mood === "thinking") {
      const a2 = t * 3.4;
      tx = cx + Math.cos(a2) * 0.55 * scale;
      ty = eyeY - 0.12 * scale + Math.sin(a2) * 0.2 * scale;
    } else if (mood === "talking") {
      tx = cx + 0.52 * scale;
      ty = faceY - scale * 0.04 - talkBeat * 5;
    } else if (emotion === "alert") {
      tx = cx + Math.sin(t * 31) * 3;
      ty = eyeY - 0.5 * scale + Math.cos(t * 29) * 3;
    } else if (mood === "harbor" || mood === "happy") {
      tx = cx + Math.sin(t * 1.5) * 1.12 * scale;
      ty = bodyY + Math.sin(t * 3) * 0.36 * scale;
    } else {
      const a2 = t * 0.62 + 1;
      tx = cx + Math.cos(a2) * 1.28 * scale;
      ty = bodyY - 0.08 * scale + Math.sin(a2) * 0.4 * scale;
    }
    if (!spark.seeded) { spark.x = tx; spark.y = ty; spark.seeded = true; }
    spark.x += (tx - spark.x) * 0.09;
    spark.y += (ty - spark.y) * 0.09;
    spark.trail.unshift({ x: spark.x, y: spark.y });
    if (spark.trail.length > 14) spark.trail.pop();
    for (let i = 1; i < spark.trail.length; i++) {
      const tp = spark.trail[i], fade = 1 - i / spark.trail.length;
      ctx2.fillStyle = css(sparkCol, 0.28 * fade * (0.6 + ghostPulse));
      const s2 = 1 + fade * 1.6;
      ctx2.fillRect(tp.x - s2 / 2, tp.y - s2 / 2, s2, s2);
    }
    const sr = scale * (0.055 + 0.012 * Math.sin(t * 7.3)) * (1 + ghostPulse * 0.7);
    const sg2 = ctx2.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, sr * 2.6);
    sg2.addColorStop(0, "rgba(245,240,255,0.95)");
    sg2.addColorStop(0.35, css(sparkCol, 0.75));
    sg2.addColorStop(1, css(sparkCol, 0));
    ctx2.fillStyle = sg2;
    ctx2.beginPath(); ctx2.arc(spark.x, spark.y, sr * 2.6, 0, Math.PI * 2); ctx2.fill();
    ctx2.strokeStyle = css(sparkCol, 0.5 + ghostPulse * 0.3);
    ctx2.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a3 = t * 2.2 + (i * Math.PI * 2) / 3;
      ctx2.beginPath();
      ctx2.moveTo(spark.x + Math.cos(a3) * sr * 1.4, spark.y + Math.sin(a3) * sr * 1.4);
      ctx2.lineTo(spark.x + Math.cos(a3) * sr * 2.3, spark.y + Math.sin(a3) * sr * 2.3);
      ctx2.stroke();
    }
    ctx2.globalCompositeOperation = "source-over";
  };

  const drawStill = () => {
    ghostMood = "idle";
    ghostMoodUntil = 0;
    mis.next = Infinity;
    draw(t0 + 9000);
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    if (reduceMotion) drawStill();
  };
  const frame = (now) => {
    if (!document.hidden) draw(now);
    requestAnimationFrame(frame);
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  if (reduceMotion) return;
  window.addEventListener("pointermove", onPoint, { passive: true });
  window.addEventListener("pointerdown", onPoint, { passive: true });
  if ("DeviceOrientationEvent" in window) {
    if (typeof window.DeviceOrientationEvent.requestPermission === "function") {
      document.addEventListener("pointerdown", requestTilt, { once: true, passive: true });
      document.addEventListener("touchstart", requestTilt, { once: true, passive: true });
    } else {
      attachTilt();
    }
  }
  requestAnimationFrame(frame);
}

/* ============================ boot ============================ */
let ghostStarted = false;
function enterPhantom() {
  gate.hidden = true;
  phantom.hidden = false;
  if (!ghostStarted) { ghostStarted = true; initGhost(); }
  renderDashboard();
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  if (view && view !== "command" && WORKSPACE_DEFS[view]) openWorkspace(view);
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  speak(phantomBrief());
}

async function boot() {
  ctx.session = isLiveAdminHost() ? await verifyLiveSession() : resolveSession();
  wireCommandDeck();
  wireHarbor();
  store.onChange(() => { /* keep rail + grid live after any store write */
    if (!phantom.hidden) { renderMission(); renderRail(); }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
