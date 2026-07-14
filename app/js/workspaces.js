/* PhantomForce Phantom — workspace surfaces.
   Every widget on the mission grid opens one of these as a focused overlay
   above the dashboard. Registry-driven so the grid can scale to hundreds
   of widgets without changing the shell. */

import {
  store, uid, visible, isAdmin, isOwnerOperator, currentWs, wsName, pushActivity, resolveApproval,
  moneyView, fmtMoney, fmtDate, fmtDateTime, ago, daysUntil, statusLabel,
  PACKAGES, RETAINERS, FINANCE_CATEGORIES, MEMORY_CATEGORY_LABELS, MEMORY_RETENTION_DAYS, CHAT_HISTORY_RETENTION_DAYS,
  addMemory, toggleMemoryRemember, forgetMemory, forgetChatHistory, memoryStats, memoryRetention, chatHistoryStats, chatHistoryRetention,
  session,
} from "./store.js?v=phantom-live-20260714-253";
import {
  isDatabaseSession, canManageActiveOrg, fetchServerApprovals, decideServerRun,
} from "./orgs.js?v=phantom-live-20260714-253";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const title = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());

const chip = (status) => `<span class="chip chip-${esc(status)}">${esc(statusLabel(status))}</span>`;
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
const empty = (msg) => `<div class="ws-empty">${esc(msg)}</div>`;
const wsTag = (id) => (isAdmin() && currentWs() === "phantomforce") ? `<span class="ws-tag">${esc(wsName(id))}</span>` : "";
const memoryUi = { query: "", category: "all", brainOpen: false };
const leadsUi = { prompt: "", notice: "" };
const workerUi = { filter: "all", notice: "", selectedId: "", tab: "overview", preview: null, view: "map" };
// Transient pan/zoom/search state for the fullscreen Workers "web" canvas -
// not persisted, resets whenever the user leaves and re-enters Web view.
// _needsFit is a one-shot flag: the actual fit measurement needs the web's
// nodes to exist in the DOM, so it's consumed in wireWorkerWeb() after render,
// not here.
const workerWebUi = { pan: { x: 0, y: 0 }, zoom: 1, search: "", _needsFit: true };
let workerWebEscapeHandler = null;
const workerRuntime = { state: "idle", workforce: null, error: "" };
const LOCAL_CORE_WORKERS = [
  { name: "Phantom Router", note: "Command and workspace routing loaded" },
  { name: "Memory Keeper", note: "Local memory and receipts ready" },
  { name: "Safety Guard", note: "Approval and security rules loaded" },
];
const MEMORY_DAY = 86400000;

async function loadWorkerRuntime() {
  if (workerRuntime.state === "loading") return;
  workerRuntime.state = "loading";
  workerRuntime.error = "";
  try {
    const token = session.token();
    const response = await fetch("/phantom-ai/agents/status?window_hours=24", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !payload.workforce) {
      throw new Error(payload?.error?.message || payload?.error || `Worker status failed (${response.status}).`);
    }
    workerRuntime.workforce = payload.workforce;
    workerRuntime.state = "ready";
  } catch (error) {
    workerRuntime.workforce = null;
    workerRuntime.state = "error";
    workerRuntime.error = error instanceof Error ? error.message : "Worker status is unavailable.";
  }
}

function bindActions(root, handlers) {
  root.querySelectorAll("[data-act]").forEach((el) => {
    el.addEventListener("click", () => {
      const fn = handlers[el.dataset.act];
      if (fn) fn(el.dataset.id, el);
    });
  });
}

async function copyText(el, text) {
  try { await navigator.clipboard.writeText(text); } catch {}
  const prev = el.textContent;
  el.textContent = "Copied ✓";
  setTimeout(() => { el.textContent = prev; }, 1400);
}

/* =============================== LEADS =============================== */
const LEAD_ARCHETYPES = [
  {
    match: /\b(school|schools|academy|academies|college|colleges|student|students|athletic|booster|pta)\b/i,
    name: "School programs",
    company: "Local schools and booster clubs",
    source: "Phantom prospect prompt",
    value: 1250,
    next: "Research athletic directors, activities leads, and booster contacts; draft a season/event media offer.",
    notes: "Best angle: event coverage, sponsor assets, team media days, parent-friendly photo/video packages.",
    tags: ["schools", "seasonal", "community"],
    fit: 84,
    qualification: ["Current event or season coming up", "Decision maker listed publicly", "Budget from booster/PTA/sponsor lane"],
    outreach: "Quick opener: noticed your upcoming season/events and can help turn them into sponsor-ready media plus parent-facing content.",
  },
  {
    match: /\b(gym|gyms|fitness|trainer|trainers|training|martial|boxing|sports performance|coach|coaches)\b/i,
    name: "Gym owners",
    company: "Independent gyms and training studios",
    source: "Phantom prospect prompt",
    value: 950,
    next: "Find owner/head coach, check current content cadence, and draft a membership-growth content offer.",
    notes: "Best angle: transformation stories, class reels, lead capture, review push, and local SEO proof.",
    tags: ["fitness", "local", "content"],
    fit: 88,
    qualification: ["Owner-visible contact path", "Recent classes/events posted", "Needs member acquisition or retention"],
    outreach: "Quick opener: I can turn your classes/results into a weekly content and lead-follow-up engine without adding work to your staff.",
  },
  {
    match: /\b(creator|creators|influencer|influencers|podcast|streamer|youtube|tiktok|instagram|content creator)\b/i,
    name: "Creators",
    company: "Local creators and coaches",
    source: "Phantom prospect prompt",
    value: 750,
    next: "Identify creators with inconsistent packaging; draft a media-kit, clip, and sponsor-ready workflow.",
    notes: "Best angle: polish their offer, repurpose clips, organize their content hub, and make brand outreach easier.",
    tags: ["creator", "media", "sponsor"],
    fit: 79,
    qualification: ["Active public profile", "Clear niche", "Needs packaging, clips, or sponsor assets"],
    outreach: "Quick opener: your content has the raw material; I can package it into clips, sponsor assets, and a cleaner offer path.",
  },
  {
    match: /\b(service|services|plumber|plumbing|hvac|roof|roofing|landscap|electric|contractor|cleaning|home service|repair)\b/i,
    name: "Service companies",
    company: "Home and local service companies",
    source: "Phantom prospect prompt",
    value: 1500,
    next: "Find businesses with weak websites or slow follow-up; draft a lead-capture and missed-call recovery offer.",
    notes: "Best angle: more booked jobs, stronger reviews, faster quote follow-up, and a simple service landing page.",
    tags: ["services", "lead capture", "reviews"],
    fit: 91,
    qualification: ["Website/contact form friction", "Review gaps or stale content", "High-value jobs with quote workflow"],
    outreach: "Quick opener: I help service businesses stop losing quote requests by tightening the website, follow-up, and review loop.",
  },
  {
    match: /\b(warm|referral|referred|past client|old client|previous client|follow.?up|followups|follow ups)\b/i,
    name: "Warm prospects",
    company: "Referral and warm-contact list",
    source: "Phantom prospect prompt",
    value: 1200,
    next: "Gather names from referrals, past conversations, and warm DMs; draft low-pressure reactivation messages.",
    notes: "Best angle: do not cold pitch. Re-open the relationship with proof, a specific helpful idea, and a simple next step.",
    tags: ["warm", "referral", "follow-up"],
    fit: 94,
    qualification: ["Prior relationship exists", "Recent business trigger", "Permission-safe contact path"],
    outreach: "Quick opener: thought of your business because I found a quick way to tighten your follow-up/content flow. Want me to send the idea?",
  },
  {
    match: /\b(restaurant|restaurants|bar|bars|cafe|coffee|food|venue|salon|spa|retail|store|boutique)\b/i,
    name: "Local storefronts",
    company: "Restaurants, venues, and retail operators",
    source: "Phantom prospect prompt",
    value: 1050,
    next: "Find owners with event/menu/service changes; draft a local promo and content refresh offer.",
    notes: "Best angle: foot traffic, offers, seasonal promos, short-form video, and review recovery.",
    tags: ["storefront", "promo", "local"],
    fit: 82,
    qualification: ["Public offer/menu/event activity", "Needs fresh content", "Clear booking or visit CTA"],
    outreach: "Quick opener: I can turn your current specials/events into a cleaner local campaign and follow-up path.",
  },
];

const LEAD_STOPWORDS = new Set(["find", "add", "want", "need", "looking", "for", "prospects", "clients", "client", "leads", "lead", "businesses", "business"]);

function normalizeLeadKey(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function leadWorkspaceId() {
  return currentWs() === "phantomforce" ? "phantomforce" : currentWs();
}

function splitLeadPrompt(prompt) {
  return String(prompt || "")
    .replace(/[.;]/g, ",")
    .split(/,|\band\b|\bor\b|\+|&/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function templateFromSegment(segment) {
  const found = LEAD_ARCHETYPES.find((item) => item.match.test(segment));
  if (found) return found;
  const words = normalizeLeadKey(segment).split(/\s+/).filter((w) => w && !LEAD_STOPWORDS.has(w));
  const label = title(words.join(" ") || segment || "Custom prospects");
  return {
    name: label,
    company: `${label} prospects`,
    source: "Phantom prospect prompt",
    value: 850,
    next: `Research real ${label.toLowerCase()} targets, confirm fit, and draft a direct outreach angle.`,
    notes: "Custom lane from your prompt. Phantom created the CRM card and next steps; add real names or connect discovery to enrich it.",
    tags: ["custom", "needs-enrichment"],
    fit: 72,
    qualification: ["Real business/contact confirmed", "Clear problem PhantomForce can solve", "Approval-safe outreach path"],
    outreach: `Quick opener: I found a practical way PhantomForce could help ${label.toLowerCase()} save time or win more work.`,
  };
}

function leadDraftText(lead) {
  if (!lead) return "No lead selected.";
  return [
    `Prospect: ${lead.company}`,
    `Angle: ${lead.notes || lead.next}`,
    `Next: ${lead.next}`,
    lead.outreach ? `Draft opener: ${lead.outreach}` : "",
    "Nothing sends until you approve it.",
  ].filter(Boolean).join("\n");
}

function createProspectsFromPrompt(prompt) {
  const ws = leadWorkspaceId();
  const segments = splitLeadPrompt(prompt);
  const templates = [];
  segments.forEach((segment) => {
    const template = templateFromSegment(segment);
    const key = normalizeLeadKey(template.company || template.name);
    if (!templates.some((item) => normalizeLeadKey(item.company || item.name) === key)) templates.push(template);
  });
  if (!templates.length) return { created: [], skipped: 0 };
  const existing = new Set(store.state.leads.map((lead) => normalizeLeadKey(`${lead.ws}:${lead.company || lead.name}`)));
  const created = [];
  let skipped = 0;
  templates.slice(0, 12).forEach((template, index) => {
    const key = normalizeLeadKey(`${ws}:${template.company || template.name}`);
    if (existing.has(key)) {
      skipped += 1;
      return;
    }
    const lead = {
      id: uid("lead"),
      ws,
      name: template.name,
      company: template.company,
      source: template.source,
      status: "new",
      value: template.value,
      next: template.next,
      due: new Date(Date.now() + (index + 1) * 86400000).toISOString(),
      owner: "Lead Hunter",
      notes: template.notes,
      proposalId: null,
      tags: template.tags || [],
      fitScore: template.fit,
      qualification: template.qualification || [],
      outreach: template.outreach || "",
      promptSeed: prompt,
      requiresApproval: true,
      enriched: false,
    };
    created.push(lead);
    existing.add(key);
  });
  if (created.length) {
    store.state.leads.unshift(...created);
    pushActivity("Lead Hunter", `built ${created.length} prospect card${created.length === 1 ? "" : "s"} from the Clients prompt. Outreach is draft-only until approved.`, ws);
  }
  return { created, skipped };
}

function renderLeads(el, rerender) {
  const leads = visible(store.state.leads);
  const lanes = [
    ["new", "New"], ["follow-up", "Follow-up"], ["proposal", "Proposal out"], ["won", "Won"], ["lost", "Lost"],
  ];
  el.innerHTML = `
    <section class="lead-intel">
      <div>
        <p>Client intelligence</p>
        <h3>Build the client base.</h3>
        <span>Tell Phantom who to find. It creates prospect cards, qualification steps, and approval-safe outreach angles.</span>
      </div>
      <form class="lead-intel-form" data-lead-form>
        <input data-lead-prompt value="${esc(leadsUi.prompt)}" placeholder="schools, gyms, creators, service companies, warm prospects..." />
        <button class="btn btn-primary" type="submit">Run</button>
      </form>
    </section>
    ${leadsUi.notice ? `<div class="lead-intel-result">${esc(leadsUi.notice)}</div>` : ""}
    <div class="ws-toolbar">
      <p class="ws-note">Every lead moves draft → approval → send-ready. Nothing goes out without you.</p>
      <button class="btn btn-primary" data-act="add">+ Capture lead</button>
    </div>
    <div class="lane-row">
      ${lanes.map(([k, label]) => {
        const items = leads.filter((l) => l.status === k);
        return `<div class="lane"><div class="lane-head">${label} <b>${items.length}</b></div>
          ${items.map((l) => `
            <article class="record ${daysUntil(l.due) <= 0 && ["new", "follow-up"].includes(l.status) ? "record-due" : ""}">
              <button class="record-x" data-act="remove" data-id="${l.id}" aria-label="Remove lead">×</button>
              ${wsTag(l.ws)}
              <h4>${esc(l.name)}</h4>
              <p class="record-sub">${esc(l.company)} · ${esc(l.source)} · ${fmtMoney(l.value)}</p>
              ${(l.fitScore || (l.tags && l.tags.length)) ? `<div class="lead-meta">${l.fitScore ? `<span>Fit ${esc(l.fitScore)}%</span>` : ""}${(l.tags || []).slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}
              <p class="record-next">▸ ${esc(l.next)}${["new", "follow-up"].includes(l.status) ? ` <i>(${daysUntil(l.due) <= 0 ? "due today" : "in " + daysUntil(l.due) + "d"})</i>` : ""}</p>
              <p class="record-notes">${esc(l.notes)}</p>
              ${(l.qualification && l.qualification.length) ? `<ul class="lead-checks">${l.qualification.slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
              <div class="record-actions">
                ${l.outreach ? `<button class="btn" data-act="copy-outreach" data-id="${l.id}">Copy outreach angle</button>` : ""}
                ${l.status === "new" ? `<button class="btn" data-act="advance" data-id="${l.id}">Start follow-up</button>` : ""}
                ${["new", "follow-up"].includes(l.status) ? `<button class="btn" data-act="propose" data-id="${l.id}">Convert to proposal</button>` : ""}
                ${l.status === "proposal" ? `<button class="btn btn-good" data-act="won" data-id="${l.id}">Mark won</button><button class="btn btn-quiet" data-act="lost" data-id="${l.id}">Mark lost</button>` : ""}
                ${l.status === "won" ? `<button class="btn" data-act="review" data-id="${l.id}">Prepare review request</button>` : ""}
                ${l.status === "lost" ? `<button class="btn btn-quiet" data-act="revive" data-id="${l.id}">Re-open</button>` : ""}
              </div>
            </article>`).join("") || `<div class="lane-empty">—</div>`}
        </div>`;
      }).join("")}
    </div>`;
  const find = (id) => store.state.leads.find((l) => l.id === id);
  const form = el.querySelector("[data-lead-form]");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector("[data-lead-prompt]");
      const prompt = input?.value?.trim() || "";
      leadsUi.prompt = prompt;
      if (!prompt) {
        leadsUi.notice = "Tell Phantom who to target first: schools, gyms, creators, service companies, warm prospects, or any niche.";
        rerender();
        return;
      }
      const { created, skipped } = createProspectsFromPrompt(prompt);
      leadsUi.notice = created.length
        ? `Created ${created.length} prospect card${created.length === 1 ? "" : "s"} from your prompt${skipped ? ` and skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""}. Outreach is draft-only until approved.`
        : `No new cards created${skipped ? ` — ${skipped} matching prospect lane${skipped === 1 ? " already exists" : "s already exist"}` : ""}.`;
      store.save();
      rerender();
    });
  }
  bindActions(el, {
    add: () => {
      const name = prompt("Lead name (person or business):");
      if (!name) return;
      store.state.leads.unshift({ id: uid("lead"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), name: name.trim(), company: name.trim(), source: "Manual capture", status: "new", value: 750, next: "Qualify the need and the budget", due: new Date(Date.now() + 86400000).toISOString(), owner: "Lead Hunter", notes: "", proposalId: null });
      pushActivity("Lead Hunter", `captured a new lead: ${name.trim()}.`);
      store.save(); rerender();
    },
    remove: (id) => {
      const l = find(id);
      store.state.leads = store.state.leads.filter((item) => item.id !== id);
      if (l) pushActivity("Lead Hunter", `removed lead: ${l.name}.`, l.ws);
      store.save(); rerender();
    },
    "copy-outreach": (id, btn) => copyText(btn, leadDraftText(find(id))),
    advance: (id) => { const l = find(id); l.status = "follow-up"; store.save(); rerender(); },
    propose: (id) => {
      const l = find(id);
      const pkg = PACKAGES.find((p) => p.price >= l.value) || PACKAGES[2];
      const p = { id: uid("prop"), ws: l.ws, client: l.company, contact: l.name, pkg: pkg.id, price: pkg.price, retainer: "keeper", status: "draft", pain: l.notes || "Capture the pain in one sentence.", scope: ["Build scoped to the outcome", "Lead capture + follow-up wiring", "Review engine", "30-day watch"], timeline: "2 weeks build, launch week 3", updated: new Date().toISOString() };
      store.state.proposals.unshift(p);
      l.status = "proposal"; l.proposalId = p.id; l.next = "Proposal drafted — review it in Proposal Forge";
      pushActivity("Proposal Forge", `opened a ${pkg.name} draft for ${l.company}.`, l.ws);
      store.save(); rerender();
    },
    won: (id) => { const l = find(id); l.status = "won"; l.next = "Kick off delivery"; const p = store.state.proposals.find((x) => x.id === l.proposalId); if (p) p.status = "won"; pushActivity("Client Pipeline", `marked ${l.company} as won.`, l.ws); store.save(); rerender(); },
    lost: (id) => { const l = find(id); l.status = "lost"; l.next = "Re-engage in 90 days"; const p = store.state.proposals.find((x) => x.id === l.proposalId); if (p) p.status = "lost"; store.save(); rerender(); },
    revive: (id) => { const l = find(id); l.status = "follow-up"; l.next = "Warm re-engage with a proof point"; store.save(); rerender(); },
    review: (id) => {
      const l = find(id);
      store.state.reviews.unshift({ id: uid("rev"), ws: l.ws, client: `${l.name} — ${l.company}`, status: "draft", channel: "Google", draft: `${l.name.split(" ")[0]} — glad this one landed. A short review helps the next owner find us; two sentences is plenty. Link below.`, link: "review-link-ready", received: null, quote: null });
      pushActivity("Review Desk", `drafted a review request for ${l.company}.`, l.ws);
      store.save(); rerender();
    },
  });
}

/* ============================ PROPOSAL FORGE ============================ */
function renderProposals(el, rerender) {
  const props = visible(store.state.proposals);
  const proposalText = (p) => {
    const pkg = PACKAGES.find((x) => x.id === p.pkg);
    const ret = RETAINERS.find((x) => x.id === p.retainer);
    return [
      `PROPOSAL — ${p.client}`, ``,
      `The problem: ${p.pain}`, ``,
      `The plan (${pkg?.name} — ${fmtMoney(p.price)}):`,
      ...p.scope.map((x) => `  • ${x}`), ``,
      `Timeline: ${p.timeline}`,
      ret ? `Ongoing: ${ret.name} retainer — ${ret.range || fmtMoney(ret.price) + "/mo"} (${ret.blurb})` : ``,
      ``, `Nothing goes live without your approval at each step.`, `— PhantomForce`,
    ].filter((x) => x !== undefined).join("\n");
  };
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Offer ladder: ${PACKAGES.map((p) => `${p.name} ${fmtMoney(p.price)}`).join(" · ")} — retainers ${RETAINERS.map((r) => r.range || fmtMoney(r.price) + "/mo").join(" · ")}.</p>
      <button class="btn btn-primary" data-act="add">+ New proposal</button>
    </div>
    <div class="stack">
      ${props.map((p) => {
        const pkg = PACKAGES.find((x) => x.id === p.pkg);
        const ret = RETAINERS.find((x) => x.id === p.retainer);
        return `
        <article class="record record-wide">
          <button class="record-x" data-act="remove" data-id="${p.id}" aria-label="Remove proposal">×</button>
          <div class="record-top">
            ${wsTag(p.ws)}
            <h4>${esc(p.client)} ${chip(p.status)}</h4>
            <b class="record-price">${fmtMoney(p.price)}${ret ? ` <i>+ ${esc(ret.range || fmtMoney(ret.price) + "/mo")}</i>` : ""}</b>
          </div>
          <p class="record-sub">${esc(pkg?.name || "Custom")} · ${esc(p.timeline)} · updated ${ago(p.updated)}</p>
          <p class="record-notes"><b>Pain:</b> ${esc(p.pain)}</p>
          <ul class="record-list">${p.scope.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <div class="record-actions">
            <button class="btn" data-act="copy" data-id="${p.id}">Copy proposal</button>
            ${p.status === "draft" ? `<button class="btn btn-good" data-act="ready" data-id="${p.id}">Mark send-ready</button>` : ""}
            ${p.status === "sent-ready" ? `<button class="btn btn-good" data-act="won" data-id="${p.id}">Mark won</button><button class="btn btn-quiet" data-act="lost" data-id="${p.id}">Mark lost</button>` : ""}
            ${p.status === "won" ? `<button class="btn" data-act="invoice" data-id="${p.id}">Mark invoice-ready</button>` : ""}
            ${p.status === "invoice-ready" ? `<span class="hint-inline">Invoice-ready — payment connector not wired, tracked in Accounting.</span>` : ""}
          </div>
        </article>`;
      }).join("") || empty("No proposals yet. Convert a lead or ask Phantom AI to draft one.")}
    </div>`;
  const find = (id) => store.state.proposals.find((p) => p.id === id);
  bindActions(el, {
    add: () => {
      const client = prompt("Client / business name:");
      if (!client) return;
      const p = { id: uid("prop"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), client: client.trim(), contact: client.trim(), pkg: "core", price: 1500, retainer: "keeper", status: "draft", pain: "Capture the pain in one sentence.", scope: ["Build scoped to the outcome", "Lead capture + follow-up wiring", "Review engine", "30-day watch"], timeline: "2 weeks build, launch week 3", updated: new Date().toISOString() };
      store.state.proposals.unshift(p);
      pushActivity("Proposal Forge", `opened a Core draft for ${client.trim()}.`);
      store.save(); rerender();
    },
    copy: (id, btn) => copyText(btn, proposalText(find(id))),
    remove: (id) => {
      const p = find(id);
      store.state.proposals = store.state.proposals.filter((item) => item.id !== id);
      store.state.leads.forEach((lead) => { if (lead.proposalId === id) lead.proposalId = null; });
      if (p) pushActivity("Proposal Forge", `removed proposal: ${p.client}.`, p.ws);
      store.save(); rerender();
    },
    ready: (id) => { const p = find(id); p.status = "sent-ready"; p.updated = new Date().toISOString(); pushActivity("Proposal Forge", `moved ${p.client} to send-ready.`, p.ws); store.save(); rerender(); },
    won: (id) => { const p = find(id); p.status = "won"; pushActivity("Offer Desk", `${p.client} proposal won — ${fmtMoney(p.price)}.`, p.ws); store.save(); rerender(); },
    lost: (id) => { const p = find(id); p.status = "lost"; store.save(); rerender(); },
    invoice: (id) => { const p = find(id); p.status = "invoice-ready"; pushActivity("Accounting Ledger", `${p.client} marked invoice-ready.`, p.ws); store.save(); rerender(); },
  });
}

/* ============================ REVIEW DESK ============================ */
function renderReviews(el, rerender) {
  const reviews = visible(store.state.reviews);
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">draft → approved to request → sent (manual) → received → publish approval → published-ready. No auto-publishing.</p>
      <button class="btn btn-primary" data-act="add">+ Review request</button>
    </div>
    <div class="stack">
      ${reviews.map((r) => `
        <article class="record record-wide">
          <button class="record-x" data-act="remove" data-id="${r.id}" aria-label="Remove review request">×</button>
          <div class="record-top">${wsTag(r.ws)}<h4>${esc(r.client)} ${chip(r.status)}</h4><b class="record-price">${esc(r.channel)}</b></div>
          ${r.draft ? `<p class="record-notes"><b>Request draft:</b> ${esc(r.draft)}</p>` : ""}
          ${r.quote ? `<blockquote class="quote-preview">“${esc(r.quote)}”<footer>— ${esc(r.client.split(" — ")[0])}</footer></blockquote>` : ""}
          <div class="record-actions">
            ${r.draft ? `<button class="btn" data-act="copy" data-id="${r.id}">Copy request</button>` : ""}
            ${r.status === "draft" ? `<button class="btn btn-good" data-act="approve-req" data-id="${r.id}">Approve to request</button>` : ""}
            ${r.status === "approved" ? `<button class="btn" data-act="sent" data-id="${r.id}">Mark sent (manual)</button>` : ""}
            ${r.status === "sent" ? `<button class="btn" data-act="received" data-id="${r.id}">Log received review</button>` : ""}
            ${(r.status === "received" || r.status === "publish-ready") && r.quote ? `<button class="btn btn-good" data-act="queue-publish" data-id="${r.id}">Queue publish approval</button>` : ""}
            ${r.status === "published-ready" ? `<span class="hint-inline">Approved — publish-ready for the site's reviews wall.</span>` : ""}
          </div>
        </article>`).join("") || empty("No reviews in the pipeline. Mark a lead won, or draft a request.")}
    </div>`;
  const find = (id) => store.state.reviews.find((r) => r.id === id);
  bindActions(el, {
    add: () => {
      const client = prompt("Who are we asking for a review?");
      if (!client) return;
      store.state.reviews.unshift({ id: uid("rev"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), client: client.trim(), status: "draft", channel: "Google", draft: `${client.trim().split(" ")[0]} — if the work moved the needle, a short review helps the next owner find us. Two sentences is plenty — link below.`, link: "review-link-ready", received: null, quote: null });
      pushActivity("Review Desk", `drafted a review request for ${client.trim()}.`);
      store.save(); rerender();
    },
    copy: (id, btn) => { const r = find(id); copyText(btn, `${r.draft}\n\n${r.link || ""}`); },
    remove: (id) => {
      const r = find(id);
      store.state.reviews = store.state.reviews.filter((item) => item.id !== id);
      if (r) pushActivity("Review Desk", `removed review request: ${r.client}.`, r.ws);
      store.save(); rerender();
    },
    "approve-req": (id) => { const r = find(id); r.status = "approved"; store.save(); rerender(); },
    sent: (id) => { const r = find(id); r.status = "sent"; pushActivity("Review Desk", `review request for ${r.client} marked sent (manual).`, r.ws); store.save(); rerender(); },
    received: (id) => {
      const r = find(id);
      const quote = prompt("Paste the review text they left:");
      if (!quote) return;
      r.status = "received"; r.quote = quote.trim(); r.received = new Date().toISOString();
      pushActivity("Review Desk", `logged a received review from ${r.client}.`, r.ws);
      store.save(); rerender();
    },
    "queue-publish": (id) => {
      const r = find(id);
      store.state.approvals.unshift({ id: uid("app"), ws: r.ws, type: "publish-review", title: `Publish ${r.client} testimonial to site`, detail: "Publishing adds this quote to the site's reviews wall.", ref: r.id, status: "pending", requestedBy: "Review Desk", at: new Date().toISOString() });
      pushActivity("Review Desk", `queued publish approval for ${r.client}'s testimonial.`, r.ws);
      store.save(); rerender();
    },
  });
}

/* ============================= BOOKINGS ============================= */
function renderBookings(el, rerender) {
  const bookings = visible(store.state.bookings).slice().sort((a, b) => new Date(a.when) - new Date(b.when));
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Appointment drafts are prepared here. Nothing lands on a real calendar until approved — and calendar wiring stays off until you connect it.</p>
      <button class="btn btn-primary" data-act="add">+ Appointment draft</button>
    </div>
    <div class="stack">
      ${bookings.map((b) => `
        <article class="record record-wide">
          <button class="record-x" data-act="remove" data-id="${b.id}" aria-label="Remove booking draft">×</button>
          <div class="record-top">${wsTag(b.ws)}<h4>${esc(b.type)} — ${esc(b.client)} ${chip(b.status)}</h4><b class="record-price">${fmtDateTime(b.when)}</b></div>
          <p class="record-sub">${b.duration} min · ${esc(b.location)}</p>
          <p class="record-notes"><b>Booking copy:</b> ${esc(b.copy)}</p>
          <div class="record-actions">
            <button class="btn" data-act="copy" data-id="${b.id}">Copy booking copy</button>
            ${b.status === "draft" ? `<button class="btn btn-good" data-act="queue" data-id="${b.id}">Queue for approval</button>` : ""}
            ${b.status === "approved" ? `<button class="btn" data-act="confirm" data-id="${b.id}">Mark confirmed (manual)</button>` : ""}
            ${b.status === "confirmed" ? `<span class="hint-inline">Confirmed manually — calendar-ready when a connector exists.</span>` : ""}
          </div>
        </article>`).join("") || empty("No appointments in the pipe. Draft one, or ask Phantom AI to book a call.")}
    </div>`;
  const find = (id) => store.state.bookings.find((b) => b.id === id);
  bindActions(el, {
    add: () => {
      const client = prompt("Who is the appointment with?");
      if (!client) return;
      store.state.bookings.unshift({ id: uid("bk"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), client: client.trim(), type: "Discovery call", when: new Date(Date.now() + 2 * 86400000).toISOString(), duration: 30, status: "draft", copy: `${client.trim().split(" ")[0]} — grabbing 30 minutes to walk through next steps. What works this week?`, location: "Phone" });
      pushActivity("Booking Coordinator", `drafted an appointment with ${client.trim()}.`);
      store.save(); rerender();
    },
    copy: (id, btn) => copyText(btn, find(id).copy),
    remove: (id) => {
      const b = find(id);
      store.state.bookings = store.state.bookings.filter((item) => item.id !== id);
      if (b) pushActivity("Booking Coordinator", `removed booking draft: ${b.client}.`, b.ws);
      store.save(); rerender();
    },
    queue: (id) => {
      const b = find(id);
      store.state.approvals.unshift({ id: uid("app"), ws: b.ws, type: "booking", title: `Approve booking: ${b.type} with ${b.client}`, detail: `${fmtDateTime(b.when)} · ${b.duration} min · ${b.location}`, ref: b.id, status: "pending", requestedBy: "Booking Coordinator", at: new Date().toISOString() });
      pushActivity("Booking Coordinator", `queued booking approval for ${b.client}.`, b.ws);
      store.save(); rerender();
    },
    confirm: (id) => { const b = find(id); b.status = "confirmed"; pushActivity("Booking Coordinator", `confirmed ${b.type.toLowerCase()} with ${b.client}.`, b.ws); store.save(); rerender(); },
  });
}

/* ============================= MEDIA LAB ============================= */
function renderMedia(el, rerender) {
  const media = visible(store.state.media);
  const generatedStates = new Set(["generated", "delivered", "completed", "saved"]);
  const mediaState = (m) => generatedStates.has(m.status) ? "generated" : "pending";
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Media Lab tracks only two live states: pending generation and generated output. Paid generation never runs without sign-off.</p>
      <button class="btn btn-primary" data-act="add">+ Pending generation</button>
    </div>
    <div class="card-grid">
      ${media.map((m) => {
        const shots = Array.isArray(m.shots) ? m.shots : [];
        const updated = m.updated || new Date().toISOString();
        const state = mediaState(m);
        return `
        <article class="record">
          <button class="record-x" data-act="remove" data-id="${m.id}" aria-label="Remove media item">×</button>
          <div class="record-top">${wsTag(m.ws)}<h4>${esc(m.title || "Pending generation")}</h4></div>
          <p class="record-sub">${esc(m.type || "Media generation")} · ${chip(state)} · ${ago(updated)}</p>
          <p class="record-notes"><b>Prompt:</b> ${esc(m.angle || m.notes || m.prompt || "Prompt not saved yet.")}</p>
          <details class="shotlist"><summary>Details (${shots.length})</summary>
            <ol>${shots.map((s) => `<li>${esc(s)}</li>`).join("") || `<li>No saved production details.</li>`}</ol>
          </details>
          <p class="record-notes"><b>Caption:</b> ${esc(m.caption || "No caption saved.")}</p>
          ${m.proof ? `<p class="record-proof">Proof: <code>${esc(m.proof)}</code></p>` : ""}
          <div class="record-actions">
            <button class="btn" data-act="copy" data-id="${m.id}">Copy details</button>
            ${state === "pending" && isAdmin() ? `<button class="btn" data-act="request-gen" data-id="${m.id}">Queue generation approval</button>` : ""}
            ${m.status === "generation-approved" ? `<button class="btn btn-good" data-act="delivered" data-id="${m.id}">Mark generated</button>` : ""}
          </div>
        </article>`;
      }).join("") || empty("Media Lab is empty. Generate an image or video to start.")}
    </div>`;
  const find = (id) => store.state.media.find((m) => m.id === id);
  bindActions(el, {
    add: () => {
      const t = prompt("What is this creative for? (client / campaign)");
      if (!t) return;
      store.state.media.unshift({ id: uid("med"), ws: currentWs(), title: `${t.trim()} — pending video`, type: "Video generation", status: "pending", angle: "Hook in 2 seconds, one idea, end on the offer.", shots: ["Opening hook shot", "Detail pass", "People / reaction", "Offer card", "Logo sting"], caption: `${t.trim()} — caption starter.`, proof: null, updated: new Date().toISOString() });
      pushActivity("Media Factory", `added pending media: ${t.trim()}.`);
      store.save(); rerender();
    },
    copy: (id, btn) => {
      const m = find(id);
      const shots = Array.isArray(m.shots) ? m.shots : [];
      copyText(btn, `${m.title || "Pending generation"}\n${m.type || "Media generation"}\n\nPrompt: ${m.angle || m.notes || m.prompt || "Prompt not saved yet."}\n\nDetails:\n${shots.map((s, i) => `${i + 1}. ${s}`).join("\n") || "1. No saved production details."}\n\nCaption: ${m.caption || "No caption saved."}`);
    },
    remove: (id) => {
      const m = find(id);
      store.state.media = store.state.media.filter((item) => item.id !== id);
      if (m) pushActivity("Media Factory", `removed media item: ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    "request-gen": (id) => {
      const m = find(id);
      store.state.approvals.unshift({ id: uid("app"), ws: m.ws, type: "media-generation", title: `Run paid generation: ${m.title}`, detail: "One paid generation pass. Uses paid credits — approval required.", ref: m.id, status: "pending", requestedBy: "Media Factory", at: new Date().toISOString() });
      pushActivity("Media Factory", `queued generation approval for ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    delivered: (id) => { const m = find(id); m.status = "generated"; m.updated = new Date().toISOString(); pushActivity("Delivery Manager", `marked generated: ${m.title}.`, m.ws); store.save(); rerender(); },
  });
}

/* ========================= SITE + STORE STUDIO ========================= */
export function baseSiteDraft(title = "New website", kind = "Website") {
  const cleanTitle = title.trim() || "New website";
  const isStore = kind === "Store";
  return {
    id: uid("site"),
    ws: currentWs(),
    title: `${cleanTitle} — ${isStore ? "store" : "website"}`,
    kind,
    status: "draft",
    sections: isStore
      ? ["Hero", "Products", "Offer", "Reviews", "Checkout"]
      : ["Hero", "Services", "Proof", "Offer", "Contact"],
    url: null,
    updated: new Date().toISOString(),
    design: {
      brand: cleanTitle,
      headline: isStore ? `Shop ${cleanTitle}` : `${cleanTitle} helps customers take the next step`,
      subhead: isStore ? "Products, proof, and checkout in one clean page." : "A simple page that explains the offer, builds trust, and gets the lead.",
      offer: isStore ? "Featured product or service bundle" : "Book a call, request a quote, or send a message.",
      cta: isStore ? "Shop now" : "Get started",
      theme: "neon",
      style: "premium local",
      existingUrl: "",
      storeEnabled: isStore,
    },
    catalog: [],
    store: {
      enabled: isStore,
      currency: "USD",
      checkoutMode: "test",
      paymentsConnected: false,
      cart: {},
      orders: [],
    },
  };
}

export function ensureSiteDesign(site) {
  if (!site) return null;
  const brand = (site.title || "New website").replace(/\s+—\s+(website|landing page|store)$/i, "");
  site.sections = Array.isArray(site.sections) && site.sections.length ? site.sections : ["Hero", "Services", "Proof", "Offer", "Contact"];
  site.design = {
    brand,
    headline: site.sections[0] && !/hero/i.test(site.sections[0]) ? site.sections[0] : `${brand} helps customers take the next step`,
    subhead: "A simple page that explains the offer, builds trust, and gets the lead.",
    offer: site.kind === "Store" ? "Featured product or service bundle" : "Book a call, request a quote, or send a message.",
    cta: site.kind === "Store" ? "Shop now" : "Get started",
    theme: "neon",
    style: "premium local",
    existingUrl: site.url || "",
    storeEnabled: site.kind === "Store",
    ...(site.design || {}),
  };
  return site.design;
}

export function ensureSiteStore(site) {
  if (!site) return null;
  site.catalog = Array.isArray(site.catalog) ? site.catalog : [];
  /* products carry a fulfillment type. Everything that existed before this
     field is physical — digital is opt-in and unlocks delivery details. */
  site.catalog.forEach((product) => {
    product.type = product.type === "digital" ? "digital" : "physical";
    product.delivery_url = typeof product.delivery_url === "string" ? product.delivery_url : "";
    product.delivery_note = typeof product.delivery_note === "string" ? product.delivery_note : "";
  });
  site.store = {
    enabled: site.kind === "Store" || !!site.design?.storeEnabled,
    currency: "USD",
    checkoutMode: "test",
    paymentsConnected: false,
    cart: {},
    orders: [],
    ...(site.store || {}),
  };
  site.store.cart = site.store.cart && typeof site.store.cart === "object" ? site.store.cart : {};
  site.store.orders = Array.isArray(site.store.orders) ? site.store.orders : [];
  return site.store;
}

const SECTION_LABELS = [
  ["how it works", "How it works"], ["testimonials", "Testimonials"], ["pricing", "Pricing"],
  ["services", "Services"], ["store", "Store"], ["products", "Products"], ["about", "About"],
  ["frequently asked questions", "FAQ"], ["faq", "FAQ"], ["contact", "Contact"],
  ["privacy", "Privacy"], ["refunds", "Refunds"], ["checkout", "Checkout"],
  ["reviews", "Reviews"], ["proof", "Proof"], ["booking", "Booking"], ["home", "Home"],
];

function requestedSections(prompt) {
  const groups = [];
  for (const match of String(prompt || "").matchAll(/\binclude\s+(.+?)(?=\.\s|$)/gi)) {
    const clause = match[1].toLowerCase();
    const hits = SECTION_LABELS
      .map(([needle, label]) => ({ label, index: clause.indexOf(needle) }))
      .filter((hit) => hit.index >= 0)
      .sort((a, b) => a.index - b.index)
      .map((hit) => hit.label)
      .filter((label, index, all) => all.indexOf(label) === index);
    if (hits.length >= 3) groups.push(hits);
  }
  return groups[0] || [];
}

export function extractStoreProducts(promptText) {
  const prompt = String(promptText || "");
  if (!/\b(?:store|shop|product|package|sprint|checkout|price|pricing)\b/i.test(prompt)) return [];
  const products = [];
  const pattern = /(?:\b(?:add|include)\b|[,;]|\band\b)\s*(?:and\s+)?(?:an?\s+)?([a-z0-9][a-z0-9&'+/ -]{1,70}?)\s+(?:for|at)?\s*\$(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?!\d|,\d)(\s*(?:\/\s*mo(?:nth)?|per\s+month|monthly))?/gi;
  for (const match of prompt.matchAll(pattern)) {
    const name = match[1]
      .replace(/^(?:the|a|an|add|include)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const price = Number(match[2].replace(/,/g, ""));
    if (!name || name.length > 64 || !Number.isFinite(price) || price < 0) continue;
    const cadence = match[3] ? "monthly" : "one_time";
    products.push({
      id: uid("prod"),
      name,
      price,
      cadence,
      desc: cadence === "monthly" ? "Ongoing support billed monthly." : "One-time setup and delivery.",
      visible: true,
    });
  }
  return products.filter((product, index, all) => all.findIndex((item) => item.name.toLowerCase() === product.name.toLowerCase()) === index);
}

function firstSentence(value) {
  return String(value || "").split(/[.!?]/)[0].trim();
}

/* one place for the "/ month" · "/ year" price suffix — the store now sells
   yearly plans (Termina Pro), so every price renderer shares this. */
export function cadenceSuffix(cadence) {
  return cadence === "monthly" ? " / month" : cadence === "yearly" ? " / year" : "";
}

/* ---------------- store starters ----------------
   Real, ready-to-sell page presets the prompt flow can drop in whole. The
   first one sells Termina — our terminal organizer and AI prompter — as a
   genuine digital product: no lorem, digital fulfillment, honest test-mode
   checkout until payments are connected. */
export const SITE_TEMPLATES = {
  termina: {
    id: "termina",
    label: "Termina — terminal organizer & AI prompter",
    title: "Termina — store",
    kind: "Store",
    sections: ["Hero", "Organize sessions", "AI prompt composer", "Works in every shell", "Pricing", "FAQ", "Store", "Checkout"],
    design: {
      brand: "Termina",
      headline: "Your terminal, organized. Your prompts, on tap.",
      subhead: "Termina keeps every project's shells, tabs, and AI prompts one keystroke away — stop losing sessions, stop retyping prompts, start shipping.",
      offer: "Termina Personal — $29 once, yours forever. Termina Pro — $79/year with sync and shared prompt libraries.",
      cta: "Get Termina",
      theme: "neon",
      style: "product",
      storeEnabled: true,
    },
    copy: {
      "organize sessions": [
        "Group tabs by project, not by accident. Termina saves every window, tab, and working directory as a named session — close your laptop mid-deploy and reopen exactly where you left off.",
        "Pin the sessions you live in, search the ones you forgot, and jump between client work with a single shortcut. No more twelve identical tabs named zsh.",
      ].join("\n"),
      "ai prompt composer": [
        "Stop retyping the same prompts into a chat window. The composer keeps your best prompts as reusable templates with variables — pipe in the current directory, the last command, or the text you just selected.",
        "Send it to the model you already pay for, review the answer next to your shell, and paste the command back in without leaving the keyboard.",
      ].join("\n"),
      "works in every shell": [
        "bash, zsh, fish, PowerShell — Termina sits above your shell, not inside it. Your keybindings, sessions, and prompt templates follow you across machines, and everything works over SSH.",
        "Nothing to install on the server, no plugins to break on update. If your shell runs, Termina organizes it.",
      ].join("\n"),
      pricing: [
        "Termina Personal — $29, one-time. One license for one human, every 1.x update included, all core features: sessions, the prompt composer, and cross-shell support.",
        "Termina Pro — $79 per year. Everything in Personal, plus synced sessions across machines, shared prompt libraries for your team, and priority support.",
      ].join("\n"),
      faq: [
        "Is this a subscription?",
        "Personal is a one-time purchase — pay once, keep it. Pro renews yearly, and if you stop renewing you keep everything Personal includes.",
        "How is Termina delivered?",
        "It's a digital download. Your license key and download link are emailed to the address you use at checkout — no shipping, nothing physical.",
        "Which platforms are supported?",
        "macOS, Windows, and Linux. One license covers all three.",
        "Can I use my own AI provider?",
        "Yes — bring your own API key. Your prompts go straight to your provider; Termina never proxies them through our servers.",
      ].join("\n"),
    },
    products: [
      {
        name: "Termina Personal",
        price: 29,
        cadence: "one_time",
        type: "digital",
        desc: "One-time license for one person. Sessions, prompt composer, every shell — all 1.x updates included.",
        delivery_url: "",
        delivery_note: "Digital delivery: your Termina license key and download link (macOS, Windows, Linux) are emailed to your checkout address within a few minutes.",
      },
      {
        name: "Termina Pro",
        price: 79,
        cadence: "yearly",
        type: "digital",
        desc: "Everything in Personal, plus synced sessions across machines, shared team prompt libraries, and priority support.",
        delivery_url: "",
        delivery_note: "Digital delivery: your Termina Pro license key and download link are emailed to your checkout address within a few minutes.",
      },
    ],
  },
};

export function applySiteTemplate(site, templateId) {
  const template = SITE_TEMPLATES[String(templateId || "").toLowerCase()];
  if (!site || !template) return false;
  site.title = template.title;
  site.kind = template.kind;
  site.sections = [...template.sections];
  site.design = { ...ensureSiteDesign(site), ...template.design };
  site.copy = { ...(template.copy || {}) };
  /* keep product ids stable across re-applies so carts don't orphan */
  const existing = new Map((site.catalog || []).map((product) => [String(product.name || "").toLowerCase(), product]));
  site.catalog = template.products.map((product) => ({
    id: existing.get(product.name.toLowerCase())?.id || uid("prod"),
    visible: true,
    ...product,
  }));
  ensureSiteStore(site);
  site.store.enabled = true;
  site.templateId = template.id;
  site.updated = new Date().toISOString();
  return true;
}

export function applyWebsitePrompt(site, promptText) {
  const prompt = String(promptText || "").trim();
  if (!site || !prompt) return "Tell Phantom what to change first.";
  const design = ensureSiteDesign(site);
  const siteStore = ensureSiteStore(site);
  const lower = prompt.toLowerCase();
  const quoted = prompt.match(/["“](.+?)["”]/)?.[1];
  /* "…headline to X and add a testimonials section" must not make the whole
     tail the headline. Cut the captured phrase at the point a *new* instruction
     starts, so only X survives. */
  const trimToClause = (value) => String(value || "")
    .split(/\s*(?:,|;)?\s*\b(?:and|then|also|plus)\b\s+(?=add|make|change|set|use|include|remove|delete|create|update|put|swap)/i)[0]
    .replace(/[.?!]\s*$/, "")
    .trim();
  const afterTo = trimToClause(prompt.match(/\b(?:to|as|called)\s+(.{3,120})$/i)?.[1]);
  let changed = "";

  /* store starters: naming a template ("sell termina", "use the termina
     starter") drops in the whole ready-to-sell page — real copy, pricing,
     digital products, honest test-mode checkout. */
  for (const template of Object.values(SITE_TEMPLATES)) {
    /* never re-apply over a site already built from this template — later
       prompts that merely mention it must edit, not clobber */
    if (site.templateId !== template.id && new RegExp(`\\b${template.id}\\b`, "i").test(prompt)) {
      applySiteTemplate(site, template.id);
      return `Applied the ${template.label} starter: hero, feature sections, pricing, FAQ, and ${template.products.length} digital products wired for test checkout.`;
    }
  }

  const sections = requestedSections(prompt);
  if (sections.length) {
    site.sections = sections;
    changed = `Built ${sections.length} requested sections.`;
  }

  const parsedProducts = extractStoreProducts(prompt);
  if (parsedProducts.length) {
    const existing = new Map(site.catalog.map((product) => [String(product.name || "").toLowerCase(), product]));
    parsedProducts.forEach((product) => existing.set(product.name.toLowerCase(), { ...existing.get(product.name.toLowerCase()), ...product }));
    site.catalog = [...existing.values()];
    site.kind = "Store";
    design.storeEnabled = true;
    siteStore.enabled = true;
    changed = `${changed ? `${changed} ` : ""}Added ${parsedProducts.length} real product${parsedProducts.length === 1 ? "" : "s"}.`;
  }

  if (/store|shop|checkout|cart|product/.test(lower)) {
    site.kind = "Store";
    design.storeEnabled = true;
    siteStore.enabled = true;
    if (!site.sections.some((section) => /^(store|products)$/i.test(section))) site.sections.push("Products");
    if (!site.sections.some((section) => /^checkout$/i.test(section))) site.sections.push("Checkout");
    changed = `${changed ? `${changed} ` : ""}Enabled the store and checkout.`;
  }
  if (/landing|website|site|page/.test(lower) && !/store|shop/.test(lower)) {
    site.kind = /landing/.test(lower) ? "Landing page" : "Website";
    changed = /landing/.test(lower) ? "Set this up as a landing page." : "Set this up as a website.";
  }
  if (/existing|link|connect|current site|my site/.test(lower)) {
    const url = prompt.match(/https?:\/\/\S+|[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i)?.[0];
    if (url) {
      const safeUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      site.url = safeUrl;
      design.existingUrl = safeUrl;
      changed = "Saved the existing site URL for redesign planning. Import is not running yet.";
    }
  }
  if (/headline|title|main line/.test(lower)) {
    design.headline = quoted || afterTo || firstSentence(prompt.replace(/change|make|set|headline|title|main line/gi, ""));
    changed = "Changed the main headline.";
  } else if (/more premium|luxury|high end|expensive/.test(lower)) {
    design.style = "premium";
    design.headline = design.headline.replace(/\.$/, "");
    design.subhead = "Sharper proof, cleaner sections, and a stronger offer for serious buyers.";
    changed = "Made the page feel more premium.";
  } else if (/simple|clean|less words|shorter/.test(lower)) {
    design.style = "simple";
    design.subhead = "Clear offer. Clear proof. Easy next step.";
    changed = "Simplified the copy.";
  } else if (/sports|team|coach|trainer/.test(lower)) {
    design.style = "sports";
    design.subhead = "Built for signups, schedules, highlights, and parent-friendly updates.";
    changed = "Shifted the site toward sports/team use.";
  }
  if (/green|neon/.test(lower)) { design.theme = "neon"; changed = changed || "Changed the color to neon green."; }
  if (/blue/.test(lower)) { design.theme = "blue"; changed = changed || "Changed the color to blue."; }
  if (/gold|yellow/.test(lower)) { design.theme = "gold"; changed = changed || "Changed the color to gold."; }
  if (/red/.test(lower)) { design.theme = "red"; changed = changed || "Changed the color to red."; }
  if (/purple/.test(lower)) { design.theme = "purple"; changed = changed || "Changed the color to purple."; }
  if (/cta|button|call to action/.test(lower)) {
    const explicitButton = prompt.match(/\b(?:button|cta|call to action)\s+(?:text\s+|label\s+|says\s+)?(?:to\s+|as\s+|called\s+)?["“]?([^"”.,;]{2,50})/i)?.[1]?.trim();
    design.cta = quoted || explicitButton || (/book|booking/.test(lower) ? "Book a call" : /buy|shop/.test(lower) ? "Shop now" : "Get started");
    changed = "Updated the button.";
  }
  if (/offer|deal/.test(lower) && !parsedProducts.length) {
    design.offer = quoted || afterTo || firstSentence(prompt.replace(/offer|deal|package|make|set/gi, ""));
    changed = "Updated the offer.";
  }
  /* "add a testimonials section" matched none of the old patterns (they only
     covered "add section" / "add a section" / "section for"), so the request was
     silently dropped while the reply still reported success. */
  const namedSection = prompt.match(/\badd\s+(?:an?\s+)?([a-z0-9][a-z0-9 &/-]{1,40}?)\s+section\b/i)?.[1]?.trim();
  if (namedSection || /add section|section for|add a section/.test(lower)) {
    const section = namedSection || quoted || afterTo || prompt.replace(/add( a)? section( for)?/i, "").trim();
    const label = title(String(section || "").trim()).slice(0, 48);
    if (label && !site.sections.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
      site.sections.push(label);
      changed = changed ? `${changed} Added ${label} section.` : `Added ${label} section.`;
    }
  }
  if (/remove checkout|no checkout|hide checkout/.test(lower)) {
    design.storeEnabled = false;
    siteStore.enabled = false;
    site.sections = site.sections.filter((x) => !/checkout/i.test(x));
    changed = "Removed checkout from the preview.";
  }
  if (/phantomforce/i.test(prompt)) {
    design.brand = "PhantomForce";
    design.headline = /headline|title|main line/i.test(prompt) ? design.headline : "Run your business with a phantom workforce.";
    design.subhead = /subhead|subtitle/i.test(prompt)
      ? design.subhead
      : "Leads, content, websites, media, approvals, and operations in one private command center.";
    design.offer = parsedProducts.length ? "Choose the setup sprint that matches your business." : design.offer;
  }
  site.updated = new Date().toISOString();
  return changed || "I did not catch a site change yet. Try headline, store, color, premium, booking, product, or existing URL.";
}

export function renderWebsitePreview(site, products, opts = {}) {
  const design = ensureSiteDesign(site);
  const siteStore = ensureSiteStore(site);
  const theme = design.theme || "neon";
  const showProducts = design.storeEnabled || site.kind === "Store";
  const sections = site.sections.slice(0, 12);
  const listedProducts = products.filter((product) => product.visible !== false).slice(0, 12);
  const gallery = Array.isArray(site.gallery) ? site.gallery.slice(0, 6) : [];
  /* selectable: the editor passes selected (index) so a clicked section
     highlights and gets its own toolbar — plain preview callers omit it and
     get inert chips, exactly as before */
  const selectable = Number.isInteger(opts.selected);
  /* the badge counts only items that are still purchasable — quantities left
     behind by deleted/hidden products used to inflate it */
  const cartSource = opts.cart || siteStore.cart || {};
  const cartBadge = listedProducts.reduce((sum, product) => sum + Math.max(0, Number(cartSource[product.id] || 0)), 0);
  /* section copy: templates (and future prompt work) fill site.copy keyed by
     lowercased section name — render it as real page content, not chips */
  const copyBlocks = sections
    .map((section) => ({ section, text: site.copy?.[section.toLowerCase()] }))
    .filter((entry) => typeof entry.text === "string" && entry.text.trim());
  return `
    <div class="site-live-preview theme-${esc(theme)}">
      <div class="site-browser-bar"><span></span><span></span><span></span><b>${esc(design.existingUrl || `${design.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.com`)}</b><small>Editable preview</small>${showProducts ? `<button type="button" class="site-cart-button" data-ss-cart-open>Cart <b>${cartBadge}</b></button>` : ""}</div>
      <div class="site-preview-hero ${design.heroImage ? "has-media" : ""}">
        <div>
          <p>${esc(design.brand)}</p>
          <h3>${esc(design.headline)}</h3>
          <span>${esc(design.subhead)}</span>
          <button type="button">${esc(design.cta)}</button>
        </div>
        ${design.heroImage
          ? `<div class="site-preview-media"><img src="${esc(design.heroImage)}" alt=""/></div>`
          : `<div class="site-preview-orb" aria-hidden="true"><i></i></div>`}
      </div>
      <div class="site-preview-sections">
        ${sections.map((section, index) => selectable
          ? `<button type="button" class="site-preview-section ${opts.selected === index ? "is-selected" : ""}" data-ss-sec="${index}">${esc(section)}</button>`
          : `<span>${esc(section)}</span>`).join("")}
      </div>
      ${copyBlocks.length ? `
      <div class="ss-copy-blocks">
        ${copyBlocks.map(({ section, text }) => `
          <section class="ss-copy-block">
            <h4>${esc(section)}</h4>
            ${String(text).split(/\n+/).map((line) => `<p>${esc(line)}</p>`).join("")}
          </section>`).join("")}
      </div>` : ""}
      ${gallery.length ? `
        <div class="site-preview-gallery">
          ${gallery.map((g) => g.type === "video"
            ? `<video src="${esc(g.url)}" muted loop></video>`
            : `<img src="${esc(g.url)}" alt="${esc(g.title || "")}"/>`).join("")}
        </div>` : ""}
      ${showProducts ? `
        <div class="site-preview-products">
          ${listedProducts.length ? listedProducts.map((p) => `
            <article>
              ${p.imageUrl ? `<div class="site-preview-product-media"><img src="${esc(p.imageUrl)}" alt=""/></div>` : ""}
              <b>${esc(p.name)}</b>
              <em>${fmtMoney(p.price)}${cadenceSuffix(p.cadence)}</em>
              ${p.type === "digital" ? `<i class="ss-digital-tag">Digital download · no shipping</i>` : ""}
              <small>${esc(p.desc || "Ready for your details.")}</small>
              ${opts.interactive ? `<button type="button" data-ss-cart-add="${esc(p.id)}">Add to cart</button>` : ""}
            </article>`).join("") : `<div class="site-preview-products-empty"><b>Your store is ready for products.</b><span>Add the first item in the Store editor.</span></div>`}
        </div>` : `
        <div class="site-preview-offer"><b>${esc(design.offer)}</b><span>${esc(design.cta)}</span></div>`}
    </div>`;
}

/* ============================== PROTECT ============================== */
function renderProtect(el, rerender) {
  const secs = visible(store.state.security);
  el.innerHTML = `
    <div class="ws-toolbar"><p class="ws-note">Defensive posture only: monthly scan proofs, rotation reminders, breach checks on password change or reset. No secrets are stored or shown here.</p></div>
    <div class="card-grid">
      ${secs.map((s) => `
        <article class="record">
          <div class="record-top">${wsTag(s.ws)}<h4>${esc(wsName(s.ws))} posture ${chip(s.posture === "clean" ? "approved" : "pending")}</h4></div>
          ${kv("Last scan", `${fmtDate(s.lastScan)} · proof <code>${esc(s.proofId)}</code>`)}
          ${kv("Next scan", `${fmtDate(s.nextScan)} (in ${daysUntil(s.nextScan)} days — autonomous monthly cadence)`)}
          ${kv("Accounts tracked", `${s.accounts}`)}
          ${kv("Password rotation", `${daysUntil(s.rotationDue) <= 30 ? "⚠ " : ""}window closes ${fmtDate(s.rotationDue)} — rotate every 180 days, unique per account`)}
          ${kv("Phishing risk", esc(s.phishing))}
          ${kv("Breach check", esc(s.breachCheck))}
          <ul class="record-list">
            ${s.findings.map((f) => `<li class="finding-${f.level}">${f.level === "warn" ? "⚠" : "✓"} ${esc(f.text)}</li>`).join("")}
          </ul>
          <div class="record-actions">
            ${isAdmin() ? `<button class="btn" data-act="remind" data-id="${s.id}">Prepare rotation reminder</button>` : ""}
            <button class="btn btn-quiet" data-act="summary" data-id="${s.id}">Copy safe summary</button>
          </div>
        </article>`).join("")}
    </div>`;
  bindActions(el, {
    remind: (id) => {
      const s = store.state.security.find((x) => x.id === id);
      pushActivity("Security Watch", `prepared a password-rotation reminder for ${wsName(s.ws)} (due ${fmtDate(s.rotationDue)}).`, s.ws);
      store.save(); rerender();
    },
    summary: (id, btn) => {
      const s = store.state.security.find((x) => x.id === id);
      copyText(btn, `Security summary — ${wsName(s.ws)}\nPosture: ${s.posture}. Last scan ${fmtDate(s.lastScan)} (proof ${s.proofId}); next scan ${fmtDate(s.nextScan)}. ${s.findings.filter((f) => f.level === "warn").length || "No"} item(s) need attention.`);
    },
  });
}

/* =============================== MONEY =============================== */
const moneySigned = (value) => value < 0 ? `-${fmtMoney(Math.abs(value))}` : fmtMoney(value);
const financeCategoryOptions = (selected = "Uncategorized") =>
  FINANCE_CATEGORIES.map((category) => `<option value="${esc(category)}" ${category === selected ? "selected" : ""}>${esc(category)}</option>`).join("");
const todayInput = () => new Date().toISOString().slice(0, 10);
function financeDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? todayInput() : d.toISOString().slice(0, 10);
}
function parseCurrency(value) {
  const cleaned = String(value || "").replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { cells.push(cell.trim()); cell = ""; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}
function parseFinanceCsv(text, ws) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const idx = (...names) => headers.findIndex((h) => names.some((name) => h === name || h.includes(name)));
  const dateIdx = idx("date", "posted", "transactiondate");
  const descIdx = idx("description", "merchant", "name", "memo", "details");
  const amountIdx = idx("amount");
  const creditIdx = idx("credit", "deposit");
  const debitIdx = idx("debit", "withdrawal", "charge");
  const categoryIdx = idx("category", "type");
  const accountIdx = idx("account", "card");
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    let amount = amountIdx >= 0 ? parseCurrency(cells[amountIdx]) : 0;
    if (!amount && (creditIdx >= 0 || debitIdx >= 0)) amount = parseCurrency(cells[creditIdx]) - parseCurrency(cells[debitIdx]);
    const description = cells[descIdx] || "Imported transaction";
    const account = cells[accountIdx] || "CSV import";
    const category = FINANCE_CATEGORIES.includes(cells[categoryIdx]) ? cells[categoryIdx] : "Uncategorized";
    const date = financeDate(cells[dateIdx]);
    return {
      id: uid("txn"),
      ws,
      date,
      description: description.slice(0, 160),
      amount,
      category,
      account: account.slice(0, 80),
      source: "csv",
      externalId: `csv:${date}:${amount}:${description}:${account}`.toLowerCase(),
      createdAt: new Date().toISOString(),
    };
  }).filter((tx) => tx.amount !== 0);
}
function connectorLabel(connector) {
  if (connector.status === "ready") return "Ready";
  if (connector.status === "connected") return "Connected";
  if (connector.status === "requested") return "Setup requested";
  return "Not connected";
}

function renderMoney(el, rerender) {
  const m = moneyView();
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const recent = m.transactions.slice(0, 18);
  const actualCount = m.transactions.length;
  const proposalGoal = m.opportunity;
  el.innerHTML = `
    <section class="finance-shell">
      <div class="finance-toolbar">
        <button class="btn" type="button" data-act="export" aria-label="Export Accounting ledger as CSV">Export CSV</button>
      </div>
      <div class="stat-row finance-stats">
        <div class="stat"><span>Cash collected</span><b>${fmtMoney(m.cashIn)}</b><i>${actualCount ? "from real transactions" : "no income recorded"}</i></div>
        <div class="stat"><span>Operating spend</span><b>${fmtMoney(m.cashOut)}</b><i>${actualCount ? "expenses and withdrawals" : "no expenses recorded"}</i></div>
        <div class="stat"><span>Net cashflow</span><b>${moneySigned(m.netCash)}</b><i>${actualCount ? "income minus outflow" : "ledger empty"}</i></div>
        <div class="stat"><span>Book balance</span><b>${moneySigned(m.ledgerBalance)}</b><i>${m.uncategorizedCount} uncategorized</i></div>
      </div>

      <div class="finance-grid">
        <section class="finance-panel">
          <div class="finance-panel-head">
            <h3>Accounts & imports</h3>
            <span>${m.readySources} source${m.readySources === 1 ? "" : "s"} ready</span>
          </div>
          <div class="finance-connectors">
            ${m.connectors.map((connector) => `
              <article class="finance-connector finance-${esc(connector.status)}">
                <span class="finance-connector-kind">${esc(connector.type)}</span>
                <b>${esc(connector.name)}</b>
                <p>${connector.id === "manual"
                  ? "Manual entry and CSV import are active right now."
                  : `Live sync uses ${esc(connector.provider)} once backend credentials and secure token storage are configured.`}</p>
                <div class="finance-connector-foot">
                  <i>${esc(connectorLabel(connector))}</i>
                  ${connector.id === "manual"
                    ? `<label class="btn btn-quiet finance-import">Import CSV<input type="file" accept=".csv,text/csv" data-finance-import hidden /></label>`
                    : `<button class="btn btn-quiet" data-act="connector" data-id="${esc(connector.id)}" type="button">${connector.status === "requested" ? "Setup requested" : "Prepare setup"}</button>`}
                </div>
              </article>`).join("")}
          </div>
        </section>

        <section class="finance-panel">
          <div class="finance-panel-head">
            <h3>Add transaction</h3>
            <span>manual record</span>
          </div>
          <form class="finance-entry" data-finance-form>
            <label><span>Date</span><input type="date" name="date" value="${todayInput()}" required /></label>
            <label><span>Description</span><input type="text" name="description" placeholder="Stripe payout, Adobe, contractor..." required /></label>
            <label><span>Direction</span><select name="direction"><option value="income">Cash in</option><option value="expense">Cash out</option></select></label>
            <label><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label>
            <label><span>Category</span><select name="category">${financeCategoryOptions()}</select></label>
            <label><span>Account</span><input type="text" name="account" placeholder="Business checking / card" /></label>
            <button class="btn btn-primary" type="submit">Add transaction</button>
          </form>
        </section>
      </div>

      <section class="finance-panel">
        <div class="finance-panel-head">
          <h3>Accounting transaction reader</h3>
          <span>${actualCount} actual record${actualCount === 1 ? "" : "s"}</span>
        </div>
        <div class="finance-table" role="table" aria-label="Business transactions">
          ${recent.map((tx) => `
            <article class="finance-row ${tx.amount < 0 ? "is-out" : "is-in"}" role="row">
              <time>${esc(fmtDate(tx.date))}</time>
              <div>
                <b>${esc(tx.description)}</b>
                <i>${esc(tx.account)} · ${esc(tx.category)} · ${esc(tx.source)}</i>
              </div>
              <strong>${moneySigned(tx.amount)}</strong>
              <button class="record-x" data-act="delete-tx" data-id="${esc(tx.id)}" type="button" aria-label="Delete transaction">×</button>
            </article>`).join("") || empty("No transactions yet. Connect a bank/card, import a CSV export, or add the first one manually.")}
        </div>
      </section>

      <section class="finance-goal-note">
        <div>
          <p class="overlay-kicker">GOALS, NOT ACCOUNTING</p>
          <h3>Potential revenue belongs with missions.</h3>
          <p>Open quotes and won proposals guide business goals, but they do not count as accounting cash until a bank/card/manual transaction confirms movement.</p>
        </div>
        <div class="finance-goal-stats">
          <span><b>${fmtMoney(proposalGoal.pipeline)}</b><i>open quote potential</i></span>
          <span><b>${fmtMoney(proposalGoal.wonValue)}</b><i>won proposal value</i></span>
          <span><b>${fmtMoney(proposalGoal.retainerMonthly)}/mo</b><i>retainer goal</i></span>
        </div>
      </section>
    </section>`;
  // Read the live object on every handler run. Capturing it once goes stale as
  // soon as anything else re-derives finance state, and the write is lost.
  const financeNow = () => store.state.finance;
  const ensureAccount = (name) => {
    const finance = financeNow();
    const label = (name || "Manual ledger").trim().slice(0, 80);
    if (!finance.accounts.some((account) => account.ws === ws && account.name.toLowerCase() === label.toLowerCase())) {
      finance.accounts.unshift({ id: uid("acct"), ws, name: label, type: "manual", institution: "", status: "manual", lastSync: null });
    }
    return label;
  };
  const form = el.querySelector("[data-finance-form]");
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const rawAmount = Number(data.get("amount"));
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) return;
      const direction = data.get("direction") === "expense" ? -1 : 1;
      const account = ensureAccount(String(data.get("account") || "Manual ledger"));
      financeNow().transactions.unshift({
        id: uid("txn"),
        ws,
        date: financeDate(data.get("date")),
        description: String(data.get("description") || "Manual transaction").slice(0, 160),
        amount: direction * rawAmount,
        category: String(data.get("category") || "Uncategorized"),
        account,
        source: "manual",
        externalId: null,
        notes: "",
        createdAt: new Date().toISOString(),
      });
      pushActivity("Accounting Ledger", `added a ${direction > 0 ? "cash-in" : "cash-out"} transaction: ${moneySigned(direction * rawAmount)}.`, ws);
      store.save();
      rerender();
    };
  }
  const importInput = el.querySelector("[data-finance-import]");
  if (importInput) {
    importInput.onchange = async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const rows = parseFinanceCsv(await file.text(), ws);
      const existing = new Set((financeNow().transactions || []).map((tx) => tx.externalId).filter(Boolean));
      const fresh = rows.filter((tx) => !tx.externalId || !existing.has(tx.externalId));
      fresh.forEach((tx) => ensureAccount(tx.account));
      financeNow().transactions.unshift(...fresh);
      pushActivity("Accounting Ledger", `imported ${fresh.length} transaction${fresh.length === 1 ? "" : "s"} from ${file.name}.`, ws);
      store.save();
      rerender();
    };
  }
  el.querySelectorAll("[data-act='delete-tx']").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = event.currentTarget?.dataset?.id || button.getAttribute("data-id") || "";
      const tx = (financeNow().transactions || []).find((item) => String(item.id) === id);
      if (tx && !confirm(`Delete "${tx.description}" (${moneySigned(tx.amount)})? This cannot be undone.`)) return;
      const financeState = financeNow();
      financeState.transactions = (financeState.transactions || []).filter((item) => String(item.id) !== id);
      if (tx) pushActivity("Accounting Ledger", `deleted a transaction: ${tx.description} (${moneySigned(tx.amount)}).`, ws);
      store.save();
      rerender();
    };
  });
  bindActions(el, {
    connector: (id) => {
      const connector = financeNow().connectors.find((item) => item.id === id);
      if (!connector) return;
      connector.status = "requested";
      connector.requestedAt = new Date().toISOString();
      pushActivity("Accounting Ledger", `${connector.name} setup requested. Sync will stay off until the secure connector backend is configured.`, ws);
      store.save(); rerender();
    },
    export: (id, btn) => {
      const header = "date,description,amount,category,account,source";
      const rows = m.transactions.map((tx) => [tx.date, tx.description, tx.amount, tx.category, tx.account, tx.source]
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","));
      copyText(btn, [header, ...rows].join("\n"));
    },
  });
}

/* ============================= MEMORY ============================= */
function categoryLabel(category) {
  return MEMORY_CATEGORY_LABELS[category] || title(category).replace(/-/g, " ");
}

function memorySourceLabel(source = "") {
  return ({
    "saved-conversation": "saved chat",
    "history-promoted": "promoted history",
    "temporary-chat": "temporary chat",
  })[source] || String(source || "manual").replace(/-/g, " ");
}

function renderMemory(el, rerender) {
  const all = visible(store.state.memory || []);
  const historyAll = visible(store.state.chatHistory || []);
  const stats = memoryStats(all);
  const historyStats = chatHistoryStats(historyAll);
  const query = memoryUi.query.trim().toLowerCase();
  const counts = all.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  const historyCounts = historyAll.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  const categories = Object.keys(MEMORY_CATEGORY_LABELS).filter((category) => counts[category] || historyCounts[category]);
  const filtered = all.filter((item) => {
    const inCategory = memoryUi.category === "all" || item.category === memoryUi.category;
    const haystack = `${item.title} ${item.summary} ${item.text} ${(item.tags || []).join(" ")}`.toLowerCase();
    return inCategory && (!query || haystack.includes(query));
  });
  const filteredHistory = historyAll.filter((item) => {
    const inCategory = memoryUi.category === "all" || item.category === memoryUi.category;
    const haystack = `${item.title} ${item.summary} ${item.prompt} ${item.reply} ${item.mode} ${item.route}`.toLowerCase();
    return inCategory && (!query || haystack.includes(query));
  }).slice(0, 20);
  const remembered = all.filter((item) => item.pinnedByUser || item.pinnedByAi).slice(0, 5);
  const expiring = all.filter((item) => {
    if (item.pinnedByUser || item.pinnedByAi) return false;
    const ageDays = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / MEMORY_DAY);
    return MEMORY_RETENTION_DAYS - ageDays <= 5;
  }).slice(0, 4);
  el.innerHTML = `
    <div class="memory-shell">
      <section class="memory-hero">
        <div>
          <p class="overlay-kicker">LOCAL MEMORY</p>
          <h3>Saved memory stays valuable. Chat history shreds itself.</h3>
          <p>Durable memory is for facts, preferences, rules, and business context useful later. Temporary chat history is separate and shredded after ${CHAT_HISTORY_RETENTION_DAYS} days. Trivial chatter is never saved.</p>
        </div>
        <div class="memory-score">
          <b>${stats.total}</b>
          <span>saved memories</span>
        </div>
      </section>
      <div class="stat-row memory-stats">
        <div class="stat"><span>Saved memory</span><b>${stats.total}</b><i>long-term context</i></div>
        <div class="stat"><span>Remembered</span><b>${stats.remembered}</b><i>kept past ${MEMORY_RETENTION_DAYS} days</i></div>
        <div class="stat"><span>Temporary history</span><b>${historyStats.total}</b><i>${CHAT_HISTORY_RETENTION_DAYS}d shred</i></div>
        <div class="stat"><span>Shredding soon</span><b>${historyStats.expiresSoon}</b><i>history cleanup</i></div>
      </div>
      <div class="memory-controls">
        <label class="memory-search">
          <span>Search memory</span>
          <input type="search" data-memory-search value="${esc(memoryUi.query)}" placeholder="Search saved memories and temporary history..." />
        </label>
      </div>
      <form class="memory-add" data-memory-add>
        <textarea rows="3" data-memory-note placeholder="Add a note Phantom should remember for this workspace..."></textarea>
        <button class="btn btn-primary" type="submit">Save memory</button>
      </form>
      <div class="memory-cats" role="list" aria-label="Memory categories">
        <button class="memory-cat ${memoryUi.category === "all" ? "is-active" : ""}" data-memory-cat="all">All <b>${all.length}</b></button>
        ${categories.map((category) => `
          <button class="memory-cat ${memoryUi.category === category ? "is-active" : ""}" data-memory-cat="${esc(category)}">
            ${esc(categoryLabel(category))} <b>${counts[category]}</b>
          </button>`).join("")}
      </div>
      <div class="memory-layout">
        <section>
          <h3 class="ws-subhead">${memoryUi.category === "all" ? "Saved memory" : categoryLabel(memoryUi.category)}</h3>
          <div class="stack">
            ${filtered.map((item) => `
              <article class="record memory-record ${(item.pinnedByUser || item.pinnedByAi) ? "is-remembered" : ""}">
                <button class="record-x" data-act="remove-memory" data-id="${item.id}" aria-label="Remove memory">×</button>
                <div class="record-top">
                  ${wsTag(item.ws)}
                  <h4>${esc(item.title)}</h4>
                  <span class="memory-retention">${esc(memoryRetention(item))}</span>
                </div>
                <p class="record-sub">${esc(categoryLabel(item.category))} · ${esc(memorySourceLabel(item.source))} · ${ago(item.createdAt)}</p>
                <p class="record-notes">${esc(item.summary)}</p>
                <div class="memory-tags">${(item.tags || []).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
                <div class="record-actions">
                  <button class="btn ${item.pinnedByUser ? "btn-good" : ""}" data-act="pin-memory" data-id="${item.id}">${item.pinnedByUser ? "Unremember" : "Remember"}</button>
                  <button class="btn btn-quiet" data-act="forget-memory" data-id="${item.id}">Delete</button>
                </div>
              </article>`).join("") || empty(query ? "No saved memories matched that search." : "No saved memories yet. Add a note or let Phantom promote durable context automatically.")}
          </div>
          <h3 class="ws-subhead">Temporary history</h3>
          <p class="ws-note">Short-term chat context stays out of saved memory and shreds after ${CHAT_HISTORY_RETENTION_DAYS} days unless you explicitly save it.</p>
          <div class="stack">
            ${filteredHistory.map((item) => `
              <article class="record memory-record memory-record-history">
                <button class="record-x" data-act="forget-history" data-id="${item.id}" aria-label="Shred history">×</button>
                <div class="record-top">
                  ${wsTag(item.ws)}
                  <h4>${esc(item.title)}</h4>
                  <span class="memory-retention">${esc(chatHistoryRetention(item))}</span>
                </div>
                <p class="record-sub">${esc(categoryLabel(item.category))} · ${esc(item.mode)}${item.route ? ` · ${esc(item.route)}` : ""} · ${ago(item.createdAt)}</p>
                <p class="record-notes">${esc(item.summary)}</p>
                <div class="record-actions">
                  <button class="btn btn-good" data-act="save-history-memory" data-id="${item.id}">Save as memory</button>
                  <button class="btn btn-quiet" data-act="forget-history" data-id="${item.id}">Shred now</button>
                </div>
              </article>`).join("") || empty(query ? "No temporary history matched that search." : "No temporary history retained. Hellos, acks, and throwaway messages are shredded immediately.")}
          </div>
        </section>
        <aside class="memory-side">
          <article class="record">
            <h4>Research packages</h4>
            <p class="record-notes">Saved memory is grouped by topic. Temporary history is visible below but kept out of long-term context unless promoted.</p>
            <div class="memory-package-grid">
              ${Object.entries(MEMORY_CATEGORY_LABELS).map(([category, label]) => `
                <button class="memory-package" data-memory-cat="${esc(category)}">
                  <span>${esc(label)}</span><b>${counts[category] || 0}</b>
                </button>`).join("")}
            </div>
          </article>
          <article class="record">
            <h4>Remembered</h4>
            ${remembered.map((item) => `<p class="record-next">▸ ${esc(item.title)}</p>`).join("") || `<p class="record-notes">Nothing pinned yet. Phantom will pin durable business rules automatically, and you can pin any memory yourself.</p>`}
          </article>
          <article class="record">
            <h4>Cleanup watch</h4>
            ${expiring.map((item) => `<p class="record-next">▸ ${esc(item.title)} <i>${esc(memoryRetention(item))}</i></p>`).join("") || `<p class="record-notes">Saved memory is stable. Temporary history shreds separately after ${CHAT_HISTORY_RETENTION_DAYS} days.</p>`}
          </article>
        </aside>
      </div>
      ${isOwnerOperator() ? `
      <details class="memory-brain-panel" data-memory-brain-panel ${memoryUi.brainOpen ? "open" : ""}>
        <summary>
          <b>Phantom Brain — server memory vault</b>
          <span>What the live brain actually knows and injects into chat: editable memories, operator profile, and a context preview. Owner-only.</span>
        </summary>
        <div class="memory-brain-mount" data-memory-brain-mount>
          <p class="ws-note">Loading the brain panel…</p>
        </div>
      </details>` : ""}
    </div>`;

  const search = el.querySelector("[data-memory-search]");
  if (search) search.addEventListener("input", () => {
    memoryUi.query = search.value;
    renderMemory(el, rerender);
    const next = el.querySelector("[data-memory-search]");
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  });
  el.querySelectorAll("[data-memory-cat]").forEach((btn) => btn.addEventListener("click", () => {
    memoryUi.category = btn.dataset.memoryCat || "all";
    renderMemory(el, rerender);
  }));
  el.querySelector("[data-memory-add]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const note = el.querySelector("[data-memory-note]")?.value || "";
    if (!note.trim()) return;
    addMemory({ source: "manual", text: note, summary: note, pinnedByUser: true });
    pushActivity("Memory", "saved a private workspace memory.", currentWs());
    rerender();
  });
  /* Phantom Brain (server vault): brain.js is a complete UI over the real
     /phantom-ai/brain/* endpoints — the editable memory that composeBrainContext
     injects into every live chat reply. Mounted lazily on expand so the page
     stays instant, and dynamic-imported because brain.js imports esc from
     this module (a static import would be a cycle). */
  const brainPanel = el.querySelector("[data-memory-brain-panel]");
  if (brainPanel) {
    brainPanel.addEventListener("toggle", () => {
      memoryUi.brainOpen = brainPanel.open;
      if (!brainPanel.open || brainPanel.dataset.mounted) return;
      brainPanel.dataset.mounted = "1";
      const mount = brainPanel.querySelector("[data-memory-brain-mount]");
      import("./brain.js?v=phantom-live-20260714-253")
        .then((mod) => { if (mount && mount.isConnected) mod.renderPhantomBrain(mount); })
        .catch(() => { if (mount) mount.innerHTML = `<p class="ws-note">The brain panel could not load. Check that the backend on the admin PC is running, then reopen this section.</p>`; });
    });
    if (brainPanel.open && !brainPanel.dataset.mounted) {
      brainPanel.dispatchEvent(new Event("toggle"));
    }
  }
  bindActions(el, {
    "pin-memory": (id) => { toggleMemoryRemember(id); rerender(); },
    "forget-memory": (id) => {
      if (confirm("Delete this local memory?")) { forgetMemory(id); rerender(); }
    },
    "remove-memory": (id) => { forgetMemory(id); rerender(); },
    "save-history-memory": (id) => {
      const item = (store.state.chatHistory || []).find((entry) => entry.id === id);
      if (!item) return;
      const text = item.reply ? `User: ${item.prompt}\nPhantom: ${item.reply}` : `User: ${item.prompt}`;
      addMemory({
        source: "history-promoted",
        category: item.category,
        title: item.prompt,
        summary: item.summary || item.reply || item.prompt,
        text,
        tags: [item.mode, item.route, item.category].filter(Boolean),
        pinnedByUser: true,
        createdAt: item.createdAt,
      });
      forgetChatHistory(id);
      pushActivity("Memory", "promoted temporary history into saved memory.", currentWs());
      rerender();
    },
    "forget-history": (id) => { forgetChatHistory(id); rerender(); },
  });
}

/* ============================= TOOL SPINE ============================= */
function renderToolSpineCards({ compact = false } = {}) {
  const tools = store.state.toolSpine || [];
  return `
    <div class="${compact ? "tool-spine-compact" : "tool-spine-grid"}">
      ${tools.map((tool) => `
        <article class="record tool-card tool-mode-${esc(tool.mode)}">
          <div class="record-top">
            <h4><span class="agent-dot"></span>${esc(tool.name)}</h4>
            <span class="chip chip-${esc(tool.status)}">${esc(statusLabel(tool.status))}</span>
          </div>
          <p class="record-sub">${esc(tool.worker)}</p>
          <p class="record-next"><b>What it does:</b> ${esc(tool.role)}</p>
          <p class="record-notes"><b>Owner control:</b> ${esc(tool.ownerControl || "Available from admin Phantom when connected.")}</p>
          <div class="tool-meta">
            <span>${esc(statusLabel(tool.mode))}</span>
            <span>${esc(tool.internal)}</span>
          </div>
        </article>`).join("") || empty("No security scans have been run yet. Connect a scanner or start a real check before Phantom reports posture.")}
    </div>`;
}

/* ============================= WORKFORCE ============================= */
// Capability topology only. These records describe how work can be routed;
// they are not live autonomous workers unless a ledger/activity signal says so.
const WORKFORCE_EMPLOYEES = [
  {
    id: "maya-brooks",
    name: "Maya Brooks",
    title: "Client Success Operator",
    department: "Client Success",
    status: "available",
    focus: "Keeps customer notes clean, catches follow-up gaps, and prepares owner-ready check-ins.",
    skills: ["client care", "handoffs", "retention", "notes"],
    completed: 42,
    productivity: 94,
    workload: 38,
    response: "1.6m",
    lastActivity: "Ready now",
    employeeVisible: true,
  },
  {
    id: "leo-grant",
    name: "Leo Grant",
    title: "Lead Research Specialist",
    department: "Sales",
    status: "working",
    focus: "Researches prospects, enriches lead context, and drafts next-best outreach angles.",
    skills: ["lead research", "prospect notes", "follow-up prep", "pipeline"],
    completed: 57,
    productivity: 91,
    workload: 64,
    response: "2.1m",
    lastActivity: "2m ago",
    employeeVisible: true,
  },
  {
    id: "nina-cross",
    name: "Nina Cross",
    title: "Creator Producer",
    department: "Creator",
    status: "working",
    focus: "Turns ideas into captions, campaign media, generated assets, and approval-ready drafts.",
    skills: ["captions", "media", "campaigns", "creator queue"],
    completed: 36,
    productivity: 89,
    workload: 58,
    response: "2.4m",
    lastActivity: "5m ago",
    employeeVisible: true,
  },
  {
    id: "marcus-vale",
    name: "Marcus Vale",
    title: "Website Technician",
    department: "Websites",
    status: "reviewing",
    focus: "Prepares page changes, checks launch readiness, and flags anything that needs approval.",
    skills: ["site edits", "forms", "launch checks", "copy"],
    completed: 31,
    productivity: 87,
    workload: 52,
    response: "3.0m",
    lastActivity: "8m ago",
    employeeVisible: false,
  },
  {
    id: "ava-monroe",
    name: "Ava Monroe",
    title: "Scheduling Coordinator",
    department: "Operations",
    status: "available",
    focus: "Organizes booking drafts, reminders, and handoff timing without touching calendars directly.",
    skills: ["scheduling", "reminders", "handoffs", "ops"],
    completed: 28,
    productivity: 93,
    workload: 34,
    response: "1.9m",
    lastActivity: "Ready now",
    employeeVisible: true,
  },
  {
    id: "eli-rhodes",
    name: "Eli Rhodes",
    title: "Accounting Assistant",
    department: "Accounting",
    status: "available",
    focus: "Watches transactions, invoice readiness, unpaid items, and cash truth without pretending pipeline is money.",
    skills: ["ledger review", "quotes", "invoice prep", "cashflow"],
    completed: 24,
    productivity: 86,
    workload: 29,
    response: "3.2m",
    lastActivity: "Ready now",
    employeeVisible: false,
  },
  {
    id: "sofia-lane",
    name: "Sofia Lane",
    title: "Creator Ops Manager",
    department: "Creator",
    status: "reviewing",
    focus: "Packages creator drafts, post ideas, and campaign calendars for owner approval.",
    skills: ["creator drafts", "platform fit", "calendar prep", "reviews"],
    completed: 39,
    productivity: 90,
    workload: 47,
    response: "2.7m",
    lastActivity: "11m ago",
    employeeVisible: true,
  },
  {
    id: "theo-knight",
    name: "Theo Knight",
    title: "Security & Access Monitor",
    department: "Security",
    status: "available",
    focus: "Reviews access posture, risky routes, exposed-key warnings, and safety checklists.",
    skills: ["access checks", "risk notes", "route review", "security"],
    completed: 33,
    productivity: 92,
    workload: 41,
    response: "2.5m",
    lastActivity: "Ready now",
    employeeVisible: false,
  },
  {
    id: "iris-cole",
    name: "Iris Cole",
    title: "Proposal Writer",
    department: "Sales",
    status: "available",
    focus: "Drafts quote language, scope notes, and proposal packets that still need owner approval.",
    skills: ["proposal drafts", "offer framing", "scope", "pricing notes"],
    completed: 45,
    productivity: 95,
    workload: 44,
    response: "1.8m",
    lastActivity: "Ready now",
    employeeVisible: true,
  },
  {
    id: "roman-hayes",
    name: "Roman Hayes",
    title: "Operations Supervisor",
    department: "Operations",
    status: "working",
    focus: "Keeps departments coordinated and turns one Phantom request into the right internal route.",
    skills: ["routing", "quality checks", "ops map", "priorities"],
    completed: 61,
    productivity: 96,
    workload: 66,
    response: "1.4m",
    lastActivity: "1m ago",
    employeeVisible: false,
  },
  {
    id: "clara-min",
    name: "Clara Min",
    title: "Workflow Coordinator",
    department: "Operations",
    status: "reviewing",
    focus: "Plans repeatable workflows and safe handoffs, then parks execution behind approval gates.",
    skills: ["workflow drafts", "handoffs", "repeat tasks", "approval gates"],
    completed: 30,
    productivity: 88,
    workload: 46,
    response: "2.9m",
    lastActivity: "13m ago",
    employeeVisible: false,
  },
  {
    id: "owen-price",
    name: "Owen Price",
    title: "Media Systems Operator",
    department: "Creator",
    status: "available",
    focus: "Prepares image and video generation plans, credit estimates, and asset-library organization.",
    skills: ["media lab", "credit checks", "asset library", "render prep"],
    completed: 27,
    productivity: 84,
    workload: 32,
    response: "3.5m",
    lastActivity: "Ready now",
    employeeVisible: true,
  },
];

const WORKFORCE_FILTERS = ["All", "Operations", "Sales", "Creator", "Websites", "Accounting", "Security", "Client Success"];

const SWARM_SUBAGENT_TEMPLATES = [
  {
    id: "signal",
    name: "Signal",
    title: "Signal Scout",
    focus: "Watches incoming context for useful signals, gaps, and next-best routes.",
    skills: ["signal scan", "intake notes", "priority hints", "handoff prep"],
    status: "available",
    completedBoost: 9,
    workloadOffset: -18,
    productivityOffset: 1,
  },
  {
    id: "draft",
    name: "Draft",
    title: "Draft Builder",
    focus: "Turns the lead worker's lane into first-pass copy, plans, checklists, or packets.",
    skills: ["drafting", "structure", "packet prep", "copy pass"],
    status: "working",
    completedBoost: 13,
    workloadOffset: 8,
    productivityOffset: -1,
  },
  {
    id: "qa",
    name: "QA",
    title: "Quality Guard",
    focus: "Checks work for missing details, confusing language, and approval-sensitive risks.",
    skills: ["quality check", "risk notes", "owner review", "polish"],
    status: "reviewing",
    completedBoost: 7,
    workloadOffset: -6,
    productivityOffset: 2,
  },
  {
    id: "relay",
    name: "Relay",
    title: "Route Relay",
    focus: "Hands work to the next desk and keeps the owner approval path clear.",
    skills: ["routing", "handoffs", "queue sync", "approval path"],
    status: "available",
    completedBoost: 6,
    workloadOffset: -12,
    productivityOffset: 0,
  },
  {
    id: "ledger",
    name: "Ledger",
    title: "Receipt Keeper",
    focus: "Tracks what was prepared, why it matters, and what still needs human approval.",
    skills: ["receipts", "memory", "audit trail", "summary"],
    status: "available",
    completedBoost: 5,
    workloadOffset: -22,
    productivityOffset: 1,
  },
  {
    id: "research",
    name: "Research",
    title: "Context Scout",
    focus: "Pulls safe local context, docs, and ledger clues before the lane starts drafting.",
    skills: ["local context", "docs", "receipts", "research notes"],
    status: "available",
    completedBoost: 8,
    workloadOffset: -16,
    productivityOffset: 2,
  },
  {
    id: "plan",
    name: "Plan",
    title: "Sequence Planner",
    focus: "Breaks the work into approval-safe steps and picks the cleanest handoff path.",
    skills: ["planning", "steps", "route design", "risk order"],
    status: "available",
    completedBoost: 10,
    workloadOffset: -10,
    productivityOffset: 1,
  },
  {
    id: "proof",
    name: "Proof",
    title: "Proof Collector",
    focus: "Captures receipts, evidence, and the reason a route was chosen.",
    skills: ["proof log", "evidence", "receipts", "decision trail"],
    status: "available",
    completedBoost: 6,
    workloadOffset: -18,
    productivityOffset: 2,
  },
  {
    id: "feedback",
    name: "Feedback",
    title: "Learning Relay",
    focus: "Turns corrections and outcomes into future routing hints without external action.",
    skills: ["feedback", "corrections", "routing hints", "memory suggestions"],
    status: "available",
    completedBoost: 7,
    workloadOffset: -20,
    productivityOffset: 1,
  },
];

const NEURAL_CELL_TEMPLATES = [
  {
    id: "intake",
    name: "Intake Cell",
    title: "Input Classifier",
    layer: "input",
    focus: "Reads the ask, spots the business lane, and tags missing context.",
    skills: ["intent", "context tags", "missing info", "triage"],
    workloadOffset: -24,
    productivityOffset: 1,
  },
  {
    id: "memory",
    name: "Memory Cell",
    title: "Context Recall",
    layer: "memory",
    focus: "Pulls useful local memory and keeps private context attached to the route.",
    skills: ["memory", "context", "receipts", "workspace history"],
    workloadOffset: -20,
    productivityOffset: 2,
  },
  {
    id: "rank",
    name: "Rank Cell",
    title: "Priority Scorer",
    layer: "reasoning",
    focus: "Scores urgency, value, risk, and the next useful move.",
    skills: ["priority", "value score", "risk score", "next action"],
    workloadOffset: -10,
    productivityOffset: 1,
  },
  {
    id: "compose",
    name: "Compose Cell",
    title: "Draft Neuron",
    layer: "draft",
    focus: "Builds the first useful output chunk before QA sees it.",
    skills: ["draft", "structure", "copy", "artifact prep"],
    workloadOffset: 6,
    productivityOffset: -1,
  },
  {
    id: "verify",
    name: "Verify Cell",
    title: "Truth Check",
    layer: "review",
    focus: "Checks claims, labels assumptions, and catches mismatch before review.",
    skills: ["verification", "assumptions", "consistency", "review"],
    workloadOffset: -8,
    productivityOffset: 2,
  },
  {
    id: "guard",
    name: "Guard Cell",
    title: "Safety Gate",
    layer: "safety",
    focus: "Keeps sends, posts, uploads, payments, deploys, and access changes gated.",
    skills: ["guardrails", "approval", "risk", "external action block"],
    workloadOffset: -14,
    productivityOffset: 1,
  },
  {
    id: "route",
    name: "Route Cell",
    title: "Handoff Router",
    layer: "routing",
    focus: "Connects the output to the right workspace, worker, or approval packet.",
    skills: ["handoff", "workspace route", "queue", "owner review"],
    workloadOffset: -18,
    productivityOffset: 0,
  },
  {
    id: "archive",
    name: "Archive Cell",
    title: "Receipt Writer",
    layer: "ledger",
    focus: "Packages a clean receipt so Phantom remembers the useful parts.",
    skills: ["receipt", "summary", "local memory", "audit trail"],
    workloadOffset: -22,
    productivityOffset: 1,
  },
  {
    id: "feedback",
    name: "Feedback Cell",
    title: "Correction Learner",
    layer: "learning",
    focus: "Turns corrections, approvals, and rejects into lower-risk future routing hints.",
    skills: ["feedback", "correction", "profile hint", "owner preference"],
    workloadOffset: -16,
    productivityOffset: 2,
  },
  {
    id: "health",
    name: "Health Cell",
    title: "Tool Health Check",
    layer: "health",
    focus: "Checks connected tools and blocked/manual modes before work routes.",
    skills: ["health", "tool state", "manual mode", "blocked routes"],
    workloadOffset: -18,
    productivityOffset: 1,
  },
];

function workerInitials(name = "") {
  return String(name).split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "PF";
}

function clampWorkerMetric(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function buildEmployeeSubagents(employee) {
  const first = String(employee.name || "Phantom").split(/\s+/)[0] || "Phantom";
  return SWARM_SUBAGENT_TEMPLATES.map((template, index) => ({
    id: `${employee.id}-${template.id}`,
    name: `${first} ${template.name}`,
    title: template.title,
    department: employee.department,
    status: "mapped",
    focus: `${template.focus} Lead worker: ${employee.name}.`,
    skills: template.skills,
    completed: 0,
    productivity: null,
    workload: 0,
    response: "mapped",
    lastActivity: "Topology only",
    employeeVisible: employee.employeeVisible !== false && index < 3,
    parentId: employee.id,
    parentName: employee.name,
    workerType: "subagent",
  }));
}

function buildSubagentCells(employee, subagent) {
  return NEURAL_CELL_TEMPLATES.map((template, index) => ({
    id: `${subagent.id}-${template.id}`,
    name: `${subagent.name} ${template.name}`,
    title: template.title,
    department: employee.department,
    status: "mapped_cell",
    focus: `${template.focus} Parent subagent: ${subagent.name}. Root worker: ${employee.name}.`,
    skills: template.skills,
    completed: 0,
    productivity: null,
    workload: 0,
    response: "contract",
    lastActivity: "Mapped processing contract",
    employeeVisible: false,
    parentId: subagent.id,
    parentName: subagent.name,
    rootParentId: employee.id,
    rootParentName: employee.name,
    workerType: "cell",
    neuralLayer: template.layer,
  }));
}

function workerStatusLabel(status) {
  return ({
    available: "Available",
    working: "Working",
    reviewing: "Reviewing",
    observed: "Ledger signal",
    defined: "Defined",
    mapped: "Mapped",
    mapped_cell: "Mapped cell",
    blocked_by_parent: "Blocked by parent",
    "waiting-approval": "Waiting approval",
    offline: "Offline",
  })[status] || title(status);
}

export function buildWorkerRoster() {
  const activity = store.state.activity || [];
  const pendingApprovals = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const employees = WORKFORCE_EMPLOYEES.map((employee) => ({ ...employee, workerType: "employee" }));
  const network = employees.flatMap((employee) => {
    const subagents = buildEmployeeSubagents(employee);
    const cells = subagents.flatMap((subagent) => buildSubagentCells(employee, subagent));
    return [employee, ...subagents, ...cells];
  });
  return network.map((employee) => {
    const recent = activity.find((entry) =>
      String(entry.who || "").toLowerCase().includes(employee.name.toLowerCase())
      || String(entry.text || "").toLowerCase().includes(employee.department.toLowerCase()));
    const approvalRoot = employee.rootParentId || employee.parentId || employee.id;
    const waitingOnApproval = pendingApprovals > 0 && ["iris-cole", "sofia-lane", "marcus-vale"].includes(approvalRoot);
    const workerType = employee.workerType || "employee";
    const truthStatus = waitingOnApproval
      ? "waiting-approval"
      : recent
        ? "observed"
        : workerType === "cell"
          ? "mapped_cell"
          : workerType === "subagent"
            ? "mapped"
            : "defined";
    return {
      ...employee,
      worker_id: employee.id,
      display_name: employee.name,
      role: employee.title,
      current_task: employee.focus,
      capabilities: employee.skills,
      status: truthStatus,
      avatar: { initials: workerInitials(employee.name), tone: truthStatus },
      last_active_at: recent ? ago(recent.at) : "No ledger activity",
      has_activity: !!recent,
      completed: recent ? 1 : 0,
      productivity: null,
      workload: 0,
      response: "not live-measured",
      metric_source: recent ? "local activity ledger" : "workforce map only",
      approvals_required: waitingOnApproval ? pendingApprovals : 0,
      client_visible: employee.employeeVisible !== false,
      worker_type: workerType,
      parent_id: employee.parentId || null,
      parent_name: employee.parentName || null,
      root_parent_id: employee.rootParentId || null,
      root_parent_name: employee.rootParentName || null,
      neural_layer: employee.neuralLayer || null,
    };
  });
}

function workerMatchesFilter(worker) {
  if (workerUi.filter === "all") return true;
  if (workerUi.filter === "employees") return worker.worker_type === "employee";
  if (workerUi.filter === "subagents") return worker.worker_type === "subagent";
  if (workerUi.filter === "cells") return worker.worker_type === "cell";
  if (workerUi.filter === "approval") return worker.status === "waiting-approval";
  return worker.department.toLowerCase().replace(/\s+/g, "-") === workerUi.filter;
}

function workerSortScore(worker) {
  return ({ "waiting-approval": 0, observed: 1, defined: 2, mapped: 3, mapped_cell: 4, offline: 5 })[worker.status] || 6;
}

function workerPreviewTitle(kind, workerName) {
  if (kind === "safety") return `Approval rules - ${workerName}`;
  return `Work route - ${workerName}`;
}

function workerPreviewSteps(worker, kind) {
  if (kind === "safety") return [
    `${worker.display_name} can prepare, draft, research, organize, and recommend.`,
    "External moves like email, posting, uploads, deploys, payments, or client-visible changes still return to approval.",
    "Phantom shows the owner what changed before anything leaves the workspace.",
  ];
  return [
    "You tell Phantom AI the outcome you want.",
    `Phantom routes the right part of the work to ${worker.display_name} in ${worker.department}.`,
    "The employee prepares the work and brings important decisions back to the owner.",
  ];
}

function renderWorkerPreview(worker, kind = "delegate") {
  const name = worker?.display_name || "worker";
  return `
    <section class="worker-preview-panel">
      <div>
        <p class="worker-kicker">Preview only</p>
        <h4>${esc(workerPreviewTitle(kind, name))}</h4>
      </div>
      <ol>
        ${workerPreviewSteps(worker, kind).map((step) => `<li>${esc(step)}</li>`).join("")}
      </ol>
      <p class="worker-preview-safe">Visibility only - nothing was sent, posted, uploaded, charged, deployed, or exposed.</p>
      <div class="worker-actions">
        <button class="btn" data-act="worker-preview-close">Close</button>
        <button class="btn btn-quiet" disabled title="Approval-gated by design">Approval first</button>
      </div>
    </section>`;
}

function workerMeshTone(worker) {
  if (worker.status === "waiting-approval") return "approval";
  if (worker.status === "offline") return "blocked";
  if (worker.status === "observed" || worker.has_activity) return "live";
  if (worker.status === "mapped_cell") return "idle";
  if (worker.status === "mapped" || worker.status === "defined") return "ready";
  return "ready";
}

function workerMeshGroup(worker) {
  const dept = String(worker.department || "").toLowerCase();
  if (/content|creator/.test(dept)) return "media";
  if (/websites/.test(dept)) return "build";
  if (/security/.test(dept)) return "protect";
  if (/finance|accounting/.test(dept)) return "memory";
  if (/sales/.test(dept)) return "brain";
  return "ops";
}

function privateAdminRouteReached() {
  return /(^|\.)admin\.phantomforce\.online$/i.test(location.hostname);
}

function baselineWorkerCount(runtime) {
  if (!runtime) return LOCAL_CORE_WORKERS.length + (privateAdminRouteReached() ? 1 : 0);
  const workers = Array.isArray(runtime?.workers) ? runtime.workers : [];
  const reported = Number(runtime?.summary?.baseline_workers_online ?? runtime?.summary?.active_workers ?? 0);
  const routeAlreadyCounted = workers.some((worker) => worker.id === "gatekeeper" && worker.state === "active");
  return reported + (privateAdminRouteReached() && !routeAlreadyCounted ? 1 : 0);
}

// The interactive network stays inside the Workforce page. Smaller screens
// use the compact tap-to-select layout instead of pan/zoom.
function workerWebEnabled() {
  return !window.matchMedia("(max-width: 760px)").matches;
}

// Measures the actual rendered position of every node (post-layout, at the
// world's current zoom=1 baseline) and returns a pan/zoom that centers and
// fills the stage. Works regardless of node count, since it reads real
// bounding boxes rather than assuming the fixed 118/208px radii fill any
// particular stage size.
function computeWorkerWebAutoFit(stageEl, worldEl) {
  const stageRect = stageEl.getBoundingClientRect();
  // .worker-cell-dot (decorative helper-lane dust) deliberately excluded -
  // it extends much further out than the actual interactive nodes, and
  // including it just zooms everything out to make room for decoration.
  const nodes = worldEl.querySelectorAll(".worker-node");
  if (!nodes.length || !stageRect.width || !stageRect.height) {
    return { x: stageRect.width / 2, y: stageRect.height / 2, zoom: 1 };
  }
  // getBoundingClientRect() returns already-transformed screen coordinates.
  // Measuring while a prior pan/zoom is still applied compounds the error on
  // every re-fit after the first one (which happened to run at the identity
  // transform, so it looked correct) - selecting a subagent to reveal its
  // task tier, for example, would compute a wildly wrong pan/zoom because it
  // measured positions already skewed by the previous fit. Reset to identity
  // before measuring so every fit reads the same true, untransformed layout;
  // the caller overwrites this transform with the freshly computed one
  // immediately after, so there's no visible flicker.
  const previousTransform = worldEl.style.transform;
  worldEl.style.transform = "none";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((node) => {
    const r = node.getBoundingClientRect();
    minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right);
    minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
  });
  worldEl.style.transform = previousTransform;
  const contentW = maxX - minX || 1;
  const contentH = maxY - minY || 1;
  const padding = 0.82; // breathing room around the edges
  const zoom = Math.min((stageRect.width * padding) / contentW, (stageRect.height * padding) / contentH, 1.6);
  const contentCenterX = (minX + maxX) / 2 - stageRect.left;
  const contentCenterY = (minY + maxY) / 2 - stageRect.top;
  return {
    x: stageRect.width / 2 - contentCenterX * zoom,
    y: stageRect.height / 2 - contentCenterY * zoom,
    zoom,
  };
}

function applyWorkerWebTransform(worldEl) {
  worldEl.style.transform = `translate(${workerWebUi.pan.x}px, ${workerWebUi.pan.y}px) scale(${workerWebUi.zoom})`;
}

// Called once per real render (after el.innerHTML is set), not per pointer
// event - drag/wheel handlers below mutate workerWebUi and repaint the
// transform directly, skipping the full-page rerender() for smooth 60fps
// interaction.
function wireWorkerWeb(el, rerender) {
  if (!workerWebEnabled()) return;
  const stage = el.querySelector("[data-worker-web-stage]");
  const world = el.querySelector("[data-worker-web-world]");
  if (!stage || !world) return;

  if (workerWebUi._needsFit) {
    workerWebUi._needsFit = false;
    const fit = computeWorkerWebAutoFit(stage, world);
    workerWebUi.pan = { x: fit.x, y: fit.y };
    workerWebUi.zoom = fit.zoom;
  }
  applyWorkerWebTransform(world);

  const MIN_ZOOM = 0.4, MAX_ZOOM = 2.5;
  let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0, dragMoved = false;

  // Dragging can start anywhere on the canvas, including on top of a node -
  // in a dense web, requiring an empty-pixel starting point turns every pan
  // attempt into "click, drag, click" hunting for a gap. A stationary press
  // still opens that node (dragMoved stays false); a press that moves is a
  // pan, and the capture-phase click listener below swallows the resulting
  // click before the node's own click handler ever sees it.
  let captured = false;
  stage.onpointerdown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest(".worker-web-controls, .worker-web-search, .worker-mesh-foot")) return;
    dragging = true; dragMoved = false; captured = false;
    dragStartX = event.clientX; dragStartY = event.clientY;
    panStartX = workerWebUi.pan.x; panStartY = workerWebUi.pan.y;
    // Pointer capture is NOT taken here - only once movement proves this is a
    // real drag (below). Capturing immediately on every press would retarget
    // the eventual click event to the stage itself, so a plain tap on a node
    // (zero movement) would never reach that node's own click handler at all.
  };
  stage.onpointermove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragStartX, dy = event.clientY - dragStartY;
    if (!dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      dragMoved = true;
      stage.setPointerCapture(event.pointerId);
      captured = true;
    }
    if (!dragMoved) return;
    workerWebUi.pan = { x: panStartX + dx, y: panStartY + dy };
    applyWorkerWebTransform(world);
  };
  stage.onpointerup = (event) => {
    dragging = false;
    if (captured) { stage.releasePointerCapture(event.pointerId); captured = false; }
  };
  // Capture phase runs before the node button's own bubble-phase click
  // handler, so stopping it here actually prevents the select - a bubble-
  // phase listener on the stage would run too late (the button's handler
  // already fired by then).
  stage.addEventListener("click", (event) => {
    if (dragMoved) { event.stopPropagation(); event.preventDefault(); dragMoved = false; }
  }, true);
  stage.onwheel = (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const cursorX = event.clientX - rect.left, cursorY = event.clientY - rect.top;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.min(Math.max(workerWebUi.zoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
    const ratio = nextZoom / workerWebUi.zoom;
    // keep the point under the cursor visually fixed while zooming
    workerWebUi.pan = {
      x: cursorX - (cursorX - workerWebUi.pan.x) * ratio,
      y: cursorY - (cursorY - workerWebUi.pan.y) * ratio,
    };
    workerWebUi.zoom = nextZoom;
    applyWorkerWebTransform(world);
  };

  const searchInput = el.querySelector("[data-worker-web-search]");
  if (searchInput) {
    searchInput.oninput = () => {
      workerWebUi.search = searchInput.value;
      const query = workerWebUi.search.trim().toLowerCase();
      world.querySelectorAll(".worker-node").forEach((node) => {
        const label = (node.querySelector(".worker-node-label")?.textContent || "").toLowerCase();
        const isMatch = query.length > 0 && label.includes(query);
        node.classList.toggle("is-web-match", isMatch);
        node.classList.toggle("is-web-dimmed", query.length > 0 && !isMatch);
      });
    };
    searchInput.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      const firstMatch = world.querySelector(".worker-node.is-web-match");
      if (!firstMatch) return;
      const stageRect = stage.getBoundingClientRect();
      const nodeRect = firstMatch.getBoundingClientRect();
      const nodeCenterX = (nodeRect.left + nodeRect.right) / 2 - stageRect.left;
      const nodeCenterY = (nodeRect.top + nodeRect.bottom) / 2 - stageRect.top;
      const worldCenterX = (nodeCenterX - workerWebUi.pan.x) / workerWebUi.zoom;
      const worldCenterY = (nodeCenterY - workerWebUi.pan.y) / workerWebUi.zoom;
      const targetZoom = Math.min(Math.max(1.4, MIN_ZOOM), MAX_ZOOM);
      workerWebUi.zoom = targetZoom;
      workerWebUi.pan = {
        x: stageRect.width / 2 - worldCenterX * targetZoom,
        y: stageRect.height / 2 - worldCenterY * targetZoom,
      };
      applyWorkerWebTransform(world);
    };
  }

  if (workerWebEscapeHandler) document.removeEventListener("keydown", workerWebEscapeHandler);
  workerWebEscapeHandler = (event) => {
    if (event.key === "Escape" && workerUi.view === "map" && workerUi.selectedId) {
      workerUi.selectedId = "";
      rerender();
    }
  };
  document.addEventListener("keydown", workerWebEscapeHandler);
}

function renderWorkerMesh(workers, runtime = null, subagentsByParent = new Map(), cellsBySubagent = new Map()) {
  const employeeNodes = workers.filter((worker) => worker.worker_type === "employee");
  const subagentNodes = workers.filter((worker) => worker.worker_type === "subagent");
  const cellNodes = workers.filter((worker) => worker.worker_type === "cell");
  const mobileWeb = window.matchMedia("(max-width: 560px)").matches;
  const webEnabled = workerWebEnabled();
  // Desktop's fullscreen pan/zoom canvas can hold the real subagent
  // population (~100, not an arbitrary 28) - that was the actual complaint:
  // "1000+ workers, I see 50 circles." Mobile's small in-page box keeps a
  // modest cap since there's no pan/zoom room to escape into there.
  const cappedSubagents = mobileWeb ? subagentNodes.slice(0, 12) : subagentNodes;
  const overflowSubagents = subagentNodes.length - cappedSubagents.length;
  const paintedCells = webEnabled ? [] : cellNodes.slice(0, 360);
  const hiddenCells = cellNodes.length - paintedCells.length;

  const selectedWorker = workers.find((worker) => worker.worker_id === workerUi.selectedId);
  // Subagents only exist in the web when they're relevant: selecting an
  // employee reveals its own subagents; selecting a subagent reveals its
  // siblings (same parent). Nothing selected = just the employee circles.
  // This replaces always drawing the full ~100-subagent population, which
  // was the actual complaint - too much at once to read.
  const visibleParentId = selectedWorker?.worker_type === "employee" ? selectedWorker.worker_id
    : selectedWorker?.worker_type === "subagent" ? (selectedWorker.parent_id || null)
    : null;

  const CORE_RADIUS = visibleParentId ? 160 : 235;
  const MOBILE_CORE_RADIUS = 96;
  const MOBILE_SUBAGENT_RADIUS = 150;
  const SHELL_BASE_RADIUS = 285;
  const slicePerEmployee = 360 / Math.max(1, employeeNodes.length);
  const cappedSubagentIds = new Set(cappedSubagents.map((s) => s.worker_id));

  const subagentSlots = [];
  const visibleEmployeeIndex = visibleParentId ? employeeNodes.findIndex((e) => e.worker_id === visibleParentId) : -1;
  if (visibleEmployeeIndex >= 0) {
    const employeeAngle = visibleEmployeeIndex * slicePerEmployee;
    const kids = (subagentsByParent.get(visibleParentId) || []).filter((s) => cappedSubagentIds.has(s.worker_id));
    kids.forEach((subagent, i) => {
      const angle = employeeAngle + ((i + 0.5) / Math.max(1, kids.length)) * 360;
      subagentSlots.push({ worker: subagent, angle, radius: SHELL_BASE_RADIUS });
    });
  }

  // A selected subagent additionally reveals its own connected tasks (the
  // "cell"/helper-lane tier) - the thing actually asked for: click a worker,
  // then a subagent, and see what it's connected to and whether it's live.
  const cellSlots = [];
  const CELLS_PER_SHELL = 3;
  const CELL_SHELL_BASE = 370;
  const CELL_SHELL_STEP = 58;
  if (selectedWorker?.worker_type === "subagent") {
    const anchor = subagentSlots.find((slot) => slot.worker.worker_id === selectedWorker.worker_id);
    if (anchor) {
      const tasks = cellsBySubagent.get(selectedWorker.worker_id) || [];
      const taskFanSpread = 80;
      tasks.forEach((cell, i) => {
        const shell = Math.floor(i / CELLS_PER_SHELL);
        const shellStart = shell * CELLS_PER_SHELL;
        const slotsInShell = Math.min(CELLS_PER_SHELL, tasks.length - shellStart);
        const slotInShell = i - shellStart;
        const withinShell = slotsInShell > 1 ? (slotInShell / (slotsInShell - 1) - 0.5) : 0;
        const angle = anchor.angle + withinShell * taskFanSpread;
        const radius = CELL_SHELL_BASE + shell * CELL_SHELL_STEP;
        cellSlots.push({ worker: cell, angle, radius });
      });
    }
  }

  const webNode = (worker, angle, radius, mobileRadius, tier, index) => {
    const tone = workerMeshTone(worker);
    const group = workerMeshGroup(worker);
    // "Doing something right now" gets a visible pulse; idle nodes stay
    // still - motion should mean something, not run on every node all the
    // time regardless of whether there's anything actually happening.
    const isLive = tone === "live" || tone === "approval" || worker.has_activity;
    const isTask = tier === "task";
    const style = `--node-angle:${angle}deg; --node-radius:${radius}px; --node-mobile-radius:${mobileRadius}px; --node-delay:${(index % 7) * 0.28}s; --thread-delay:${(index % 9) * 0.4}s`;
    const subLabel = isTask ? workerStatusLabel(worker.status) : (tier !== "core" ? "subagent" : worker.department);
    return `
      <div class="worker-thread worker-thread-${esc(tone)} ${isLive ? "is-live" : ""}" style="${style}" aria-hidden="true"></div>
      <button type="button" class="worker-node worker-node-${esc(tone)} worker-node-${esc(group)} ${tier !== "core" ? "is-subagent" : ""} ${isTask ? "is-task" : ""} ${isLive ? "is-live" : ""} ${workerUi.selectedId === worker.worker_id ? "is-selected" : ""}" style="${style}" data-act="worker-select" data-id="${esc(worker.worker_id)}" aria-pressed="${workerUi.selectedId === worker.worker_id ? "true" : "false"}" aria-label="Open ${esc(worker.display_name)} worker details" title="${esc(worker.display_name)} — ${esc(worker.current_task || worker.role)}">
        <span class="worker-node-orb">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <span class="worker-node-label">${esc(worker.display_name)}</span>
        <i>${esc(subLabel)}</i>
      </button>`;
  };

  const cellDot = (worker, index) => {
    const layer = String(worker.neural_layer || "mapped").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "mapped";
    const group = workerMeshGroup(worker);
    const ring = index % 12;
    const angle = (index * 137.508 + ring * 9) % 360;
    const radius = (mobileWeb ? 184 : 720) + ring * (mobileWeb ? 7 : 32) + ((index % 5) - 2) * (mobileWeb ? 2 : 6);
    const size = mobileWeb ? 2 + (index % 3) : 2.4 + (index % 4) * 0.45;
    const alpha = 0.32 + (index % 5) * 0.07;
    const style = `--cell-angle:${angle}deg; --cell-radius:${radius}px; --cell-size:${size}px; --cell-alpha:${alpha}; --cell-delay:${(index % 17) * 0.18}s`;
    return `<span class="worker-cell-dot worker-cell-${esc(layer)} worker-cell-${esc(group)}" style="${style}" title="${esc(worker.display_name)} — ${esc(worker.role)}"></span>`;
  };

  const coreRingNodes = employeeNodes.map((worker, index) => webNode(worker, index * slicePerEmployee, CORE_RADIUS, MOBILE_CORE_RADIUS, "core", index)).join("");
  const outerRingNodes = subagentSlots.map((slot, index) => webNode(slot.worker, slot.angle, slot.radius, MOBILE_SUBAGENT_RADIUS, "subagent", index)).join("");
  const taskRingNodes = cellSlots.map((slot, index) => webNode(slot.worker, slot.angle, slot.radius, MOBILE_SUBAGENT_RADIUS, "task", index)).join("");
  const helperLaneDots = paintedCells.map((worker, index) => cellDot(worker, index)).join("");

  const observed = workers.filter((worker) => worker.has_activity).length;
  const waiting = workers.filter((worker) => worker.status === "waiting-approval").length;
  const mapped = workers.length;
  const departments = new Set(workers.map((worker) => worker.department)).size;
  const baselineOnline = runtime ? baselineWorkerCount(runtime) : null;
  const recentJobs = runtime?.summary?.tasks_in_window;

  return `
    <section class="worker-mesh" aria-label="Worker operations web">
      <div class="worker-mesh-stage ${webEnabled ? "is-web-active" : ""}" data-worker-web-stage>
        <div class="worker-web-world" data-worker-web-world ${webEnabled ? `style="transform: translate(${workerWebUi.pan.x}px, ${workerWebUi.pan.y}px) scale(${workerWebUi.zoom})"` : ""}>
          <div class="worker-mesh-rings" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="worker-cell-field" aria-hidden="true">
            ${helperLaneDots}
          </div>
          <div class="worker-node-field">
            ${coreRingNodes}
            ${outerRingNodes}
            ${taskRingNodes}
          </div>
          <div class="worker-core">
            <span>PF</span>
            <b>Phantom</b>
            <i>master router</i>
          </div>
        </div>
        ${webEnabled ? `
        <div class="worker-web-controls">
          <label class="worker-web-search">
            <input type="search" data-worker-web-search placeholder="Find a worker…" value="${esc(workerWebUi.search)}" aria-label="Search workers" />
          </label>
          <button class="worker-web-fit" type="button" data-act="worker-web-fit" aria-label="Fit the full worker network in view">Fit network</button>
        </div>
        ` : ""}
        <div class="worker-mesh-foot">
          <div class="worker-web-legend" aria-label="Legend">
            <span><i class="worker-legend-dot worker-legend-live"></i>Active</span>
            <span><i class="worker-legend-dot worker-legend-approval"></i>Waiting on you</span>
            <span><i class="worker-legend-dot worker-legend-ready"></i>Mapped</span>
            <span><i class="worker-legend-dot worker-legend-cell"></i>Helper lane</span>
            <span><i class="worker-legend-dot worker-legend-blocked"></i>Offline</span>
            ${overflowSubagents > 0 ? `<span class="worker-legend-more">+${overflowSubagents} more subagents</span>` : ""}
            ${hiddenCells > 0 ? `<span class="worker-legend-more">+${hiddenCells.toLocaleString()} helper lanes beyond mobile view</span>` : `<span class="worker-legend-more">${cellNodes.length.toLocaleString()} helper lanes rendered</span>`}
          </div>
        </div>
      </div>
    </section>`;
}

function renderBaselineWorkers(runtime) {
  if (workerRuntime.state === "loading" || workerRuntime.state === "idle") {
    return `<section class="worker-baseline"><div><p class="worker-kicker">Always-on crew</p><h4>Checking baseline services…</h4></div></section>`;
  }
  if (!runtime || workerRuntime.state === "error") {
    const services = [
      ...LOCAL_CORE_WORKERS,
      ...(privateAdminRouteReached() ? [{ name: "Private Route", note: "This session reached the protected Business Manager host" }] : []),
    ];
    return `
      <section class="worker-baseline worker-baseline-local">
        <div class="worker-baseline-copy">
          <p class="worker-kicker">Always-on crew</p>
          <h4>${services.length} core workers ready</h4>
          <p>Live job totals need the authenticated worker backend. Core local services are still available.</p>
        </div>
        <div class="worker-baseline-grid">
          ${services.map((service) => `<span class="worker-baseline-service"><i></i><b>${esc(service.name)}</b><small>${esc(service.note)}</small></span>`).join("")}
        </div>
        <button class="btn btn-quiet" data-act="worker-runtime-retry">Re-check live status</button>
      </section>`;
  }

  const workers = Array.isArray(runtime.workers) ? runtime.workers : [];
  const online = workers.filter((worker) => worker.state === "active");
  const recentJobs = Number(runtime.summary?.tasks_in_window || 0);
  const baselineOnline = baselineWorkerCount(runtime);
  const privateHostReached = privateAdminRouteReached();
  const services = [
    ...online.slice(0, 9).map((worker) => ({ name: worker.name, note: worker.role, live: true })),
    ...(privateHostReached && !online.some((worker) => worker.id === "gatekeeper")
      ? [{ name: "Private Route", note: "This session reached the protected Business Manager host", live: true }]
      : []),
  ];

  return `
    <section class="worker-baseline">
      <div class="worker-baseline-copy">
        <p class="worker-kicker">Always-on force</p>
        <h4>${baselineOnline} baseline workers online</h4>
        <p>${recentJobs ? `${recentJobs} real job${recentJobs === 1 ? "" : "s"} logged in the last 24 hours. The rest stays mapped, guarded, and ready without pretending to run work.` : "No customer jobs logged yet. Core services are still scanning, guarding, remembering, and routing."}</p>
      </div>
      <div class="worker-baseline-grid">
        ${services.map((service) => `<span class="worker-baseline-service"><i></i><b>${esc(service.name)}</b><small>${esc(service.note)}</small></span>`).join("")}
      </div>
    </section>`;
}

function renderWorkerCard(worker, _unused = [], options = {}) {
  const showActions = options.actions !== false;
  const previewOpen = workerUi.preview?.workerId === worker.worker_id;
  const previewExpanded = (kind) => previewOpen && workerUi.preview?.kind === kind;
  const meshTone = workerMeshTone(worker);
  return `
    <article class="worker-card worker-${esc(worker.status)} ${worker.worker_type === "subagent" ? "is-subagent" : "is-employee"}" role="listitem">
      <div class="worker-card-visual worker-card-visual-${esc(meshTone)}" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="worker-card-top">
        <span class="wf-avatar wf-avatar-${esc(worker.avatar?.tone || worker.status)}">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <div class="worker-id">
          <b>${esc(worker.display_name)}</b>
          <i>${esc(worker.role)}</i>
        </div>
        <span class="worker-status"><span></span>${esc(workerStatusLabel(worker.status))}</span>
      </div>
      <div class="worker-dept">${esc(worker.worker_type === "subagent" ? `${worker.department} subagent` : worker.department)}</div>
      ${worker.parent_name ? `<p class="worker-parent">Reports to ${esc(worker.parent_name)}</p>` : ""}
      <p class="worker-task">${esc(worker.current_task)}</p>
      <div class="worker-productivity">
        <span><b>${worker.has_activity ? "yes" : "no"}</b> ledger signal</span>
        <span><b>${worker.completed}</b> observed tasks</span>
        <span>${esc(worker.last_active_at)}</span>
      </div>
      <div class="worker-tags">
        ${worker.capabilities.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join("")}
      </div>
      <div class="worker-facts">
        <span>${worker.approvals_required ? "Waiting on approval" : "Approval-safe"}</span>
        <span>${worker.worker_type === "subagent" ? "Subagent" : "Lead worker"}</span>
        <span>No outside action alone</span>
      </div>
      ${showActions ? `
        <div class="worker-actions">
          <button class="btn" data-act="worker-preview" data-id="${esc(worker.worker_id)}" data-preview="route" aria-expanded="${previewExpanded("route") ? "true" : "false"}">View routing</button>
          <button class="btn btn-quiet" data-act="worker-preview" data-id="${esc(worker.worker_id)}" data-preview="safety" aria-expanded="${previewExpanded("safety") ? "true" : "false"}">Approval rules</button>
        </div>` : ""}
      ${previewOpen ? renderWorkerPreview(worker, workerUi.preview.kind) : ""}
    </article>`;
}

function renderWorkforceFlow() {
  const steps = [
    ["Ask Phantom", "You ask for an outcome, not a worker assignment."],
    ["Route Work", "Phantom chooses the right department and employee behind the scenes."],
    ["Prepare Draft", "The employee researches, organizes, writes, checks, or packages the work."],
    ["Approve Action", "Anything external comes back to the owner before it sends, posts, uploads, charges, or deploys."],
  ];
  return `
    <section class="worker-flow-card">
      <div>
        <p class="worker-kicker">How work moves</p>
        <h4>Phantom routes the work. You approve the moves.</h4>
      </div>
      <div class="worker-flow-steps">
        ${steps.map(([titleText, body]) => `<article><b>${esc(titleText)}</b><span>${esc(body)}</span></article>`).join("")}
      </div>
    </section>`;
}

function renderWorkerRoutingPanel({ realPrepared, pendingApprovals, ledgerSignalCount, baselineOnline, jobsLogged, mappedCount, departmentCount }) {
  const cards = [
    ["Route", "Phantom picks the right worker for the job.", `${baselineOnline || "—"} online`],
    ["Remember", "Workspace rules and preferences guide the answer.", `${mappedCount} mapped`],
    ["Prepare", realPrepared ? "Workers have staged work waiting for review." : "Workers are standing by with clean queues.", realPrepared ? `${realPrepared} staged` : "clean queue"],
    ["Prove", jobsLogged ? "The ledger shows real work moved in the last 24 hours." : "No fake motion. Signals appear only when work is logged.", jobsLogged ? `${jobsLogged} jobs · 24h` : "ledger quiet"],
  ];
  return `
    <section class="worker-routing-panel" aria-label="How Phantom routes work">
      <div>
        <p class="worker-kicker">PhantomOps</p>
        <h4>The force is already assembled.</h4>
        <p>Ask for an outcome and Phantom routes it through workers, memory, approvals, and proof. Capacity is mapped all the time; activity is counted only when the ledger proves it.</p>
      </div>
      <div class="worker-routing-cards">
        ${cards.map(([titleText, body, meta]) => `
          <article>
            <span>${esc(meta)}</span>
            <b>${esc(titleText)}</b>
            <p>${esc(body)}</p>
          </article>`).join("")}
      </div>
      <div class="worker-routing-proof">
        <span><b>${mappedCount}</b> mapped workers</span>
        <span><b>${departmentCount}</b> departments covered</span>
        <span><b>${pendingApprovals || "clear"}</b> approval queue</span>
        <span><b>${ledgerSignalCount || "quiet"}</b> verified signals</span>
      </div>
    </section>`;
}

function workerParentMatchesFilter(worker, subagents = [], cells = []) {
  if (workerUi.filter === "all" || workerUi.filter === "employees") return true;
  if (workerUi.filter === "subagents") return subagents.length > 0;
  if (workerUi.filter === "cells") return cells.length > 0;
  if (workerUi.filter === "approval") {
    return worker.status === "waiting-approval"
      || subagents.some((subagent) => subagent.status === "waiting-approval")
      || cells.some((cell) => cell.status === "waiting-approval");
  }
  return worker.department.toLowerCase().replace(/\s+/g, "-") === workerUi.filter;
}

function groupWorkersByDepartment(workers) {
  const groups = new Map();
  workers.forEach((worker) => {
    if (!groups.has(worker.department)) groups.set(worker.department, []);
    groups.get(worker.department).push(worker);
  });
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function shortSubagentFocus(subagent) {
  return String(subagent.current_task || subagent.focus || "")
    .replace(/\s*Parent (worker|subagent):.*$/i, "")
    .trim();
}

function workerLayerCounts(cells) {
  return cells.reduce((counts, cell) => {
    const layer = cell.neural_layer || "mapped";
    counts[layer] = (counts[layer] || 0) + 1;
    return counts;
  }, {});
}

function renderWorkerNetworkPanel(worker, subagents, cellsBySubagent, rootCells) {
  const layerCounts = workerLayerCounts(rootCells);
  const layers = ["input", "memory", "reasoning", "draft", "review", "safety", "routing", "ledger"];
  const paths = subagents.map((subagent) => {
    const cells = cellsBySubagent.get(subagent.worker_id) || [];
    const first = cells[0]?.display_name || `${subagent.display_name} intake`;
    const last = cells[cells.length - 1]?.display_name || `${subagent.display_name} receipt`;
    return { subagent, first, last, count: cells.length };
  });
  return `
    <div class="worker-network-panel">
      <div class="worker-network-head">
        <b>${esc(worker.display_name)} worker map</b>
        <span>${rootCells.length} helper lanes · ${subagents.length} subagents · ${paths.length * 2} routes</span>
      </div>
      <div class="worker-layer-grid">
        ${layers.map((layer) => `<span><b>${layerCounts[layer] || 0}</b><i>${esc(layer)}</i></span>`).join("")}
      </div>
      <div class="worker-synapse-list">
        ${paths.map(({ subagent, first, last, count }) => `
          <article>
            <b>${esc(subagent.display_name)}</b>
            <p>${esc(first)} -> ${esc(last)}</p>
            <span>${count} helper lanes</span>
          </article>`).join("")}
      </div>
    </div>`;
}

function workerTabContent(worker, subagents, cellsBySubagent, rootCells, activeTab) {
  if (activeTab === "subagents") {
    return `
      <div class="worker-subagent-list" role="list">
        ${subagents.map((subagent) => `
          <article class="worker-subagent-row worker-${esc(subagent.status)}" role="listitem">
            <span class="wf-avatar wf-avatar-${esc(subagent.avatar?.tone || subagent.status)}">${esc(subagent.avatar?.initials || workerInitials(subagent.display_name))}</span>
            <div>
              <b>${esc(subagent.display_name)}</b>
              <i>${esc(subagent.role)} · ${esc(workerStatusLabel(subagent.status))} · ${(cellsBySubagent.get(subagent.worker_id) || []).length} helper lanes</i>
              <p>${esc(shortSubagentFocus(subagent))}</p>
            </div>
          </article>`).join("")}
      </div>`;
  }

  if (activeTab === "network") return renderWorkerNetworkPanel(worker, subagents, cellsBySubagent, rootCells);

  if (activeTab === "safety") {
    return `
      <div class="worker-tab-copy">
        <b>Approval-safe lane</b>
        <p>${esc(worker.display_name)} and the attached subagents can organize, research, draft, review, and prepare work. Anything external still comes back to you before it sends, posts, uploads, charges, deploys, or changes access.</p>
        <div class="worker-safe-row">
          <span>No outside action alone</span>
          <span>Owner approval stays required</span>
          <span>Client-facing changes stay gated</span>
        </div>
      </div>`;
  }

  if (activeTab === "activity") {
    return `
      <div class="worker-tab-copy">
        <b>Current lane signal</b>
        <p>${esc(worker.last_active_at || "No ledger activity")} · ${esc(workerStatusLabel(worker.status))}. This view shows mapped capability plus local activity signals only.</p>
        <div class="worker-detail-stats">
          <span><b>${subagents.length}</b><i>subagents attached</i></span>
          <span><b>${rootCells.length}</b><i>helper lanes mapped</i></span>
          <span><b>${worker.has_activity ? "live" : "ready"}</b><i>activity signal</i></span>
          <span><b>${worker.approvals_required || 0}</b><i>approvals waiting</i></span>
        </div>
      </div>`;
  }

  return `
    <div class="worker-tab-copy">
      <b>${esc(worker.current_task)}</b>
      <p>Phantom routes matching work to this lead worker, then uses mapped helper lanes for signal, research, planning, drafting, QA, relay, proof, ledger, and feedback. These lanes are contracts unless a real route or ledger event activates them.</p>
      <div class="worker-detail-stats">
        <span><b>${esc(worker.department)}</b><i>department</i></span>
        <span><b>${subagents.length}</b><i>subagents</i></span>
        <span><b>${rootCells.length}</b><i>helper lanes</i></span>
        <span><b>${esc(worker.metric_source || "topology")}</b><i>metric source</i></span>
      </div>
    </div>`;
}

function renderWorkerExpansion(worker, subagents, cellsBySubagent, rootCells) {
  const tabs = [
    ["overview", "Overview"],
    ["subagents", "Subagents"],
    ["network", "Network"],
    ["safety", "Safety"],
    ["activity", "Activity"],
  ];
  const activeTab = tabs.some(([id]) => id === workerUi.tab) ? workerUi.tab : "overview";
  return `
    <div class="worker-shell-expand">
      <div class="worker-tab-row" role="tablist" aria-label="${esc(worker.display_name)} details">
        ${tabs.map(([id, label]) => `
          <button class="worker-tab ${activeTab === id ? "is-active" : ""}" data-act="worker-tab" data-id="${esc(worker.worker_id)}" data-tab="${esc(id)}" role="tab" aria-selected="${activeTab === id ? "true" : "false"}">${esc(label)}</button>`).join("")}
        <button class="worker-tab worker-tab-collapse" data-act="worker-collapse" data-id="${esc(worker.worker_id)}">Collapse</button>
      </div>
      <div class="worker-tab-panel" role="tabpanel">
        ${workerTabContent(worker, subagents, cellsBySubagent, rootCells, activeTab)}
      </div>
    </div>`;
}

function renderWorkerShell(worker, subagents, cellsBySubagent, rootCells) {
  const selected = workerUi.selectedId === worker.worker_id;
  const mapPct = Math.max(8, Math.min(100, Math.round((rootCells.length / Math.max(1, rootCells.length + subagents.length)) * 100)));
  return `
    <article class="worker-shell-card worker-${esc(worker.status)} ${selected ? "is-open" : ""}">
      <button class="worker-shell-main" data-act="worker-select" data-id="${esc(worker.worker_id)}" aria-expanded="${selected ? "true" : "false"}">
        <span class="wf-avatar wf-avatar-${esc(worker.avatar?.tone || worker.status)}">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <span class="worker-shell-name">
          <b>${esc(worker.display_name)}</b>
          <i>${esc(worker.role)}</i>
        </span>
        <span class="worker-shell-meta">
          <b>${rootCells.length}</b>
          <i>lanes</i>
        </span>
        <span class="worker-shell-status"><span></span>${esc(workerStatusLabel(worker.status))}</span>
      </button>
      <div class="worker-shell-bar" aria-hidden="true" title="Worker map density, not live workload"><i style="--worker-cap:${mapPct}%"></i></div>
      ${selected ? renderWorkerExpansion(worker, subagents, cellsBySubagent, rootCells) : ""}
    </article>`;
}

function buildWorkerGraph(allWorkers) {
  const subagentsByParent = new Map();
  const cellsBySubagent = new Map();
  const cellsByRoot = new Map();
  allWorkers.filter((worker) => worker.worker_type === "subagent").forEach((subagent) => {
    const key = subagent.parent_id || "";
    if (!subagentsByParent.has(key)) subagentsByParent.set(key, []);
    subagentsByParent.get(key).push(subagent);
  });
  allWorkers.filter((worker) => worker.worker_type === "cell").forEach((cell) => {
    const subagentKey = cell.parent_id || "";
    const rootKey = cell.root_parent_id || "";
    if (!cellsBySubagent.has(subagentKey)) cellsBySubagent.set(subagentKey, []);
    if (!cellsByRoot.has(rootKey)) cellsByRoot.set(rootKey, []);
    cellsBySubagent.get(subagentKey).push(cell);
    cellsByRoot.get(rootKey).push(cell);
  });
  return { subagentsByParent, cellsBySubagent, cellsByRoot };
}

function renderWorkerDirectory(parentWorkers, allWorkers) {
  const { subagentsByParent, cellsBySubagent, cellsByRoot } = buildWorkerGraph(allWorkers);
  const filteredParents = parentWorkers.filter((worker) =>
    workerParentMatchesFilter(worker, subagentsByParent.get(worker.worker_id) || [], cellsByRoot.get(worker.worker_id) || []));
  if (!filteredParents.some((worker) => worker.worker_id === workerUi.selectedId)) {
    workerUi.selectedId = "";
    workerUi.tab = "overview";
  }
  const groups = groupWorkersByDepartment(filteredParents);
  return `
    <section class="worker-directory" aria-label="Worker directory">
      ${groups.map(([department, group]) => `
        <section class="worker-department">
          <div class="worker-department-head">
            <span>${esc(department)}</span>
            <b>${group.length} parent${group.length === 1 ? "" : "s"}</b>
          </div>
          <div class="worker-shell-grid">
            ${group.map((worker) => renderWorkerShell(
              worker,
              subagentsByParent.get(worker.worker_id) || [],
              cellsBySubagent,
              cellsByRoot.get(worker.worker_id) || [],
            )).join("")}
          </div>
        </section>`).join("") || empty("No workers match this filter.")}
    </section>`;
}

function renderWorkerDrawer(worker, subagents, cellsBySubagent, rootCells) {
  return `
    <div class="worker-drawer-backdrop" data-act="worker-collapse" aria-hidden="true"></div>
    <aside class="worker-drawer" role="dialog" aria-label="${esc(worker.display_name)} details">
      <div class="worker-drawer-head">
        <span class="wf-avatar wf-avatar-${esc(worker.avatar?.tone || worker.status)}">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <div>
          <b>${esc(worker.display_name)}</b>
          <i>${esc(worker.role)} · ${esc(worker.department)}</i>
        </div>
        <span class="worker-shell-status"><span></span>${esc(workerStatusLabel(worker.status))}</span>
      </div>
      ${renderWorkerExpansion(worker, subagents, cellsBySubagent, rootCells)}
    </aside>`;
}

function renderWorkerMapDetail(worker, subagents, cellsBySubagent, rootCells) {
  // No instructional placeholder here - people click things to find out what
  // they do; a permanent "tap a worker" panel just occupies space and says
  // nothing. Show real content or nothing at all.
  if (!worker) return "";
  return `
    <section class="worker-map-detail worker-${esc(worker.status)}" aria-label="${esc(worker.display_name)} selected worker details">
      <div class="worker-map-detail-head">
        <span class="wf-avatar wf-avatar-${esc(worker.avatar?.tone || worker.status)}">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <div>
          <p class="worker-kicker">Selected worker</p>
          <h4>${esc(worker.display_name)}</h4>
          <span>${esc(worker.role)} · ${esc(worker.department)} · ${esc(worker.worker_type === "subagent" ? "Subagent lane" : "Lead worker")}</span>
        </div>
        <span class="worker-shell-status"><span></span>${esc(workerStatusLabel(worker.status))}</span>
      </div>
      ${renderWorkerExpansion(worker, subagents, cellsBySubagent, rootCells)}
    </section>`;
}

function renderWorkforce(el, rerender) {
  const allWorkers = buildWorkerRoster();
  const workers = isAdmin() ? allWorkers : allWorkers.filter((worker) => worker.client_visible);
  const validFilters = ["all", "employees", "subagents", "cells", "approval", ...WORKFORCE_FILTERS.slice(1).map((dept) => dept.toLowerCase().replace(/\s+/g, "-"))];
  if (!validFilters.includes(workerUi.filter)) workerUi.filter = "all";
  if (workerUi.view !== "list" && workerUi.view !== "map") workerUi.view = "map";
  const parentWorkers = workers
    .filter((worker) => worker.worker_type === "employee")
    .sort((a, b) => workerSortScore(a) - workerSortScore(b) || a.display_name.localeCompare(b.display_name));
  const pendingApprovals = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const realPrepared = [
    ...visible(store.state.leads),
    ...visible(store.state.proposals).filter((x) => x.status === "draft"),
    ...visible(store.state.media).filter((x) => x.status !== "delivered"),
    ...visible(store.state.sites).filter((x) => x.status === "draft" || x.status === "publish-ready"),
    ...visible(store.state.bookings).filter((x) => x.status !== "confirmed"),
  ].length;
  const mappedCount = workers.length;
  const ledgerSignalCount = workers.filter((worker) => worker.has_activity).length;
  const parentCount = workers.filter((worker) => worker.worker_type === "employee").length;
  const subagentCount = workers.filter((worker) => worker.worker_type === "subagent").length;
  const neuralCellCount = workers.filter((worker) => worker.worker_type === "cell").length;
  const departmentCount = new Set(workers.map((worker) => worker.department)).size;
  const filters = [
    ["all", "All workers"],
    ["employees", "Workers"],
    ["subagents", "Subagents"],
    ["cells", "Helper lanes"],
    ...WORKFORCE_FILTERS.slice(1).map((dept) => [dept.toLowerCase().replace(/\s+/g, "-"), dept]),
    ["approval", "Approval"],
  ];
  const isMap = workerUi.view === "map";
  const selectedWorker = workerUi.selectedId ? workers.find((worker) => worker.worker_id === workerUi.selectedId) : null;
  const { subagentsByParent, cellsBySubagent, cellsByRoot } = buildWorkerGraph(workers);
  const selectedSubagents = selectedWorker?.worker_type === "employee" ? (subagentsByParent.get(selectedWorker.worker_id) || []) : [];
  const selectedRootCells = selectedWorker?.worker_type === "subagent"
    ? (cellsBySubagent.get(selectedWorker.worker_id) || [])
    : selectedWorker
      ? (cellsByRoot.get(selectedWorker.worker_id) || [])
      : [];
  const runtime = workerRuntime.workforce;
  const baselineOnline = baselineWorkerCount(runtime);
  const jobsLogged = Number(runtime?.summary?.tasks_in_window || 0);

  el.innerHTML = `
    <section class="workers-hero">
      <div>
        <p class="worker-kicker">${isMap ? "Live workforce" : "Worker directory"}</p>
        <h3>${isMap ? "Worker Network" : "All Workers"}</h3>
        <p>${isMap
          ? "See who is available, what is active, and how work routes. Select a worker to inspect its real lanes and safety rules."
          : "Browse lead workers, subagents, helper lanes, and approval boundaries."}</p>
      </div>
      <div class="worker-view-toggle" role="tablist" aria-label="Workers view">
        <button class="worker-view-btn ${isMap ? "is-active" : ""}" data-act="worker-view" data-view="map" role="tab" aria-selected="${isMap ? "true" : "false"}">Network</button>
        <button class="worker-view-btn ${!isMap ? "is-active" : ""}" data-act="worker-view" data-view="list" role="tab" aria-selected="${!isMap ? "true" : "false"}">List view</button>
      </div>
    </section>
    ${workerUi.notice ? `<div class="worker-notice">${esc(workerUi.notice)} <button data-act="worker-notice-close" aria-label="Dismiss worker notice">×</button></div>` : ""}
    ${isMap ? `
      <div class="worker-map-view">
        <div class="worker-map-summary" aria-label="Live workforce summary">
          <span><i></i><b>${workerRuntime.state === "ready" ? baselineOnline : "—"}</b><small>baseline online</small></span>
          <span><b>${workerRuntime.state === "ready" ? jobsLogged : "—"}</b><small>jobs · 24h</small></span>
          <span><b>${mappedCount.toLocaleString()}</b><small>capacity mapped</small></span>
          <span class="${pendingApprovals ? "needs-attention" : ""}"><b>${pendingApprovals || "Clear"}</b><small>approval queue</small></span>
        </div>
        <div class="worker-map-layout ${selectedWorker ? "has-selection" : ""}">
          ${renderWorkerMesh(workers, runtime, subagentsByParent, cellsBySubagent)}
          ${renderWorkerMapDetail(selectedWorker, selectedSubagents, cellsBySubagent, selectedRootCells)}
        </div>
      </div>
    ` : `
      ${renderBaselineWorkers(runtime)}
      <div class="worker-scale">
        <span><b>${workerRuntime.state === "ready" ? baselineOnline : "—"}</b> baseline online</span>
        <span><b>${workerRuntime.state === "ready" ? jobsLogged : "—"}</b> jobs logged</span>
        <span><b>${mappedCount}</b> workers mapped</span>
        <span><b>${parentCount}</b> lead workers</span>
        <span><b>${subagentCount}</b> subagents</span>
        <span><b>${neuralCellCount}</b> helper lanes</span>
        <span><b>${departmentCount}</b> departments covered</span>
      </div>
      ${renderWorkerRoutingPanel({ realPrepared, pendingApprovals, ledgerSignalCount, baselineOnline, jobsLogged, mappedCount, departmentCount })}
      <div class="worker-metrics">
        <div class="worker-metric-primary"><span>Force Online</span><b>${workerRuntime.state === "ready" ? baselineOnline : "—"}</b></div>
        <div><span>Jobs Logged · 24h</span><b>${workerRuntime.state === "ready" ? jobsLogged : "—"}</b></div>
        <div><span>Workers Mapped</span><b>${mappedCount}</b></div>
        <div><span>Lead Workers</span><b>${parentCount}</b></div>
        <div><span>Subagents</span><b>${subagentCount}</b></div>
        <div><span>Helper Lanes</span><b>${neuralCellCount}</b></div>
        <div><span>Queue State</span><b>${realPrepared ? `${realPrepared} staged` : "Clear"}</b></div>
        <div><span>Approval Queue</span><b>${pendingApprovals || "Clear"}</b></div>
        <div><span>Departments Covered</span><b>${departmentCount}</b></div>
      </div>
      <div class="worker-filter-row">
        ${filters.map(([id, label]) => `<button class="worker-filter ${workerUi.filter === id ? "is-active" : ""}" data-act="worker-filter" data-filter="${esc(id)}" aria-pressed="${workerUi.filter === id ? "true" : "false"}">${esc(label)}</button>`).join("")}
      </div>
      ${renderWorkerDirectory(parentWorkers, workers)}
    `}`;
  bindActions(el, {
    "worker-runtime-retry": () => {
      workerRuntime.state = "idle";
      workerRuntime.error = "";
      rerender();
    },
    "worker-view": (_id, button) => {
      const nextView = button.dataset.view === "list" ? "list" : "map";
      if (nextView === "map" && workerUi.view !== "map") workerWebUi._needsFit = true;
      workerUi.view = nextView;
      workerUi.selectedId = "";
      rerender();
    },
    "worker-web-fit": () => {
      workerWebUi._needsFit = true;
      workerWebUi.search = "";
      rerender();
    },
    "worker-filter": (_id, button) => { workerUi.filter = button.dataset.filter || "all"; rerender(); },
    "worker-notice-close": () => { workerUi.notice = ""; rerender(); },
    "worker-preview-close": () => { workerUi.preview = null; rerender(); },
    "worker-select": (id) => {
      workerUi.selectedId = workerUi.selectedId === id ? "" : (id || workerUi.selectedId);
      workerUi.tab = "overview";
      workerUi.preview = null;
      // Selecting an employee/subagent reveals its subagents fresh into the
      // DOM - re-fit so they're actually visible instead of landing wherever
      // the current pan/zoom happens to be pointed.
      workerWebUi._needsFit = true;
      rerender();
    },
    "worker-collapse": () => {
      workerUi.selectedId = "";
      workerUi.tab = "overview";
      rerender();
    },
    "worker-tab": (id, button) => {
      workerUi.selectedId = id || workerUi.selectedId;
      workerUi.tab = button.dataset.tab || "overview";
      rerender();
    },
    "worker-preview": (id, button) => {
      const action = button.dataset.preview || "action";
      workerUi.preview = { workerId: id || null, kind: action };
      workerUi.notice = "";
      rerender();
    },
  });
  if (isMap) wireWorkerWeb(el, rerender);
  if (workerRuntime.state === "idle") {
    loadWorkerRuntime().finally(() => rerender());
  }
}

/* ============================= APPROVALS ============================= */
const approvalChangesFormOpen = new Set();
/* Server approvals: awaiting_approval agent runs for the active org —
   REAL external actions held by the backend until an org owner/admin (or
   the super-admin) decides. Rendered only for database-auth sessions;
   fetched live, never fabricated. */
async function hydrateServerApprovals(el, rerender) {
  const mount = el.querySelector("[data-server-approvals]");
  if (!mount) return;
  const runs = await fetchServerApprovals().catch(() => []);
  if (!document.body.contains(mount)) return;
  if (!runs.length) { mount.innerHTML = ""; return; }
  const manager = canManageActiveOrg();
  mount.innerHTML = `
    <h3 class="ws-subhead">Server actions waiting for approval</h3>
    <div class="stack">
      ${runs.map((run) => `
        <article class="record record-wide approval-card">
          <div class="record-top"><h4>${esc(run.title)}</h4><i class="record-time">${ago(run.created_at)}</i></div>
          <p class="record-notes">${esc(run.expected_effect || run.request)}</p>
          <p class="record-sub">Requested by ${esc(run.requested_by)} · scope: ${esc(run.scope)} · deadline: ${run.approval_deadline ? esc(new Date(run.approval_deadline).toLocaleString()) : "—"}</p>
          ${manager ? `
          <div class="record-actions">
            <button class="btn btn-good" data-server-run-approve="${esc(run.id)}">Approve &amp; execute</button>
            <button class="btn btn-quiet" data-server-run-reject="${esc(run.id)}">Reject</button>
          </div>` : `<p class="record-sub">Waiting for a business owner or admin to decide.</p>`}
        </article>`).join("")}
    </div>`;
  mount.querySelectorAll("[data-server-run-approve]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const result = await decideServerRun(btn.dataset.serverRunApprove, true);
      pushActivity("Approval Desk", result.ok ? "approved a server action — executing now." : `server approval failed: ${result.error}.`);
      store.save();
      rerender();
    };
  });
  mount.querySelectorAll("[data-server-run-reject]").forEach((btn) => {
    btn.onclick = async () => {
      const reason = prompt("Why is this rejected? (recorded on the run)") || undefined;
      btn.disabled = true;
      const result = await decideServerRun(btn.dataset.serverRunReject, false, reason);
      pushActivity("Approval Desk", result.ok ? "rejected a server action — nothing executed." : `server rejection failed: ${result.error}.`);
      store.save();
      rerender();
    };
  });
}

function renderApprovals(el, rerender) {
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending");
  const done = visible(store.state.approvals).filter((a) => a.status !== "pending").slice(0, 6);
  el.innerHTML = `
    <div class="ws-toolbar"><p class="ws-note">Only outward-facing moves land here: sends, bookings, publishing, paid generation, invoices, deploys. Drafting never waits on you. Workers prepare — you release, send back for changes, or say no.</p></div>
    ${isDatabaseSession() ? `<div data-server-approvals></div>` : ""}
    ${pending.length ? `<div class="stack">
      ${pending.map((a) => `
        <article class="record record-wide approval-card">
          <button class="record-x" data-act="remove" data-id="${a.id}" aria-label="Remove approval request">×</button>
          <div class="record-top">${wsTag(a.ws)}<h4>${esc(a.title)}</h4><i class="record-time">${ago(a.at)}</i></div>
          <p class="record-notes">${esc(a.detail)}</p>
          <p class="record-sub">Prepared by ${esc(a.requestedBy)} · goes to: ${esc(a.ws)} · action: ${esc(a.type)}</p>
          ${approvalChangesFormOpen.has(a.id) ? `
          <form class="approval-changes-form" data-act-changes-form="${a.id}">
            <label>What should change?</label>
            <textarea data-changes-notes rows="2" placeholder="Tell the worker what to fix before this goes out…" required></textarea>
            <div class="record-actions">
              <button class="btn btn-primary" type="submit" data-changes-decision="approve">Send back — approve once fixed</button>
              <button class="btn btn-quiet" type="submit" data-changes-decision="disapprove">Send back — no, needs rework</button>
              <button class="btn btn-quiet" type="button" data-act="cancel-changes" data-id="${a.id}">Cancel</button>
            </div>
          </form>` : `
          <div class="record-actions">
            <button class="btn btn-good" data-act="approve" data-id="${a.id}">Approve</button>
            <button class="btn btn-quiet" data-act="approve-changes" data-id="${a.id}">Approve with changes</button>
            <button class="btn btn-quiet" data-act="decline" data-id="${a.id}">Disapprove</button>
            <button class="btn btn-quiet" data-act="decline-changes" data-id="${a.id}">Disapprove with changes</button>
          </div>`}
        </article>`).join("")}
    </div>` : empty("Queue is clear. Nothing is waiting for approval.")}
    ${done.length ? `<h3 class="ws-subhead">Recent decisions</h3><div class="stack">
      ${done.map((a) => `<article class="record record-row"><button class="record-x" data-act="remove" data-id="${a.id}" aria-label="Remove approval record">×</button>${wsTag(a.ws)}<h4>${esc(a.title)}</h4>${chip(a.status)}${a.ownerNotes ? `<p class="record-sub">Owner notes: ${esc(a.ownerNotes)}</p>` : ""}</article>`).join("")}
    </div>` : ""}`;
  bindActions(el, {
    approve: (id) => { resolveApproval(id, true); rerender(); },
    decline: (id) => { resolveApproval(id, false); rerender(); },
    "approve-changes": (id) => { approvalChangesFormOpen.add(id); rerender(); },
    "decline-changes": (id) => { approvalChangesFormOpen.add(id); rerender(); },
    "cancel-changes": (id) => { approvalChangesFormOpen.delete(id); rerender(); },
    remove: (id) => {
      const a = store.state.approvals.find((item) => item.id === id);
      store.state.approvals = store.state.approvals.filter((item) => item.id !== id);
      approvalChangesFormOpen.delete(id);
      if (a) pushActivity("Approval Desk", `removed approval request: ${a.title}.`, a.ws);
      store.save(); rerender();
    },
  });
  el.querySelectorAll("[data-act-changes-form]").forEach((form) => {
    form.onsubmit = (event) => {
      event.preventDefault();
      const id = form.dataset.actChangesForm;
      const notes = form.querySelector("[data-changes-notes]")?.value.trim();
      const approved = event.submitter?.dataset.changesDecision === "approve";
      if (!notes) return;
      resolveApproval(id, approved, { changesRequested: true, notes });
      approvalChangesFormOpen.delete(id);
      rerender();
    };
  });
  if (isDatabaseSession()) hydrateServerApprovals(el, rerender);
}

/* ============================== PHANTOMOPS ============================== */
function renderAdmin(el, rerender) {
  if (!isAdmin()) { el.innerHTML = empty("This area belongs to your PhantomForce operator."); return; }
  const lanes = [
    ["Workforce intelligence", "ready", "planning / spec / build lanes loaded"],
    ["Memory & context", "ready", "backend context store reachable"],
    ["Model lanes A/B/C", "ready", "operator lanes standing by"],
    ["Automation lane", "setup-ready", "workflow runner ready for owner setup"],
    ["Media generation lane", "owner-controlled", "paid credits stay under owner control"],
    ["Private access gateway", "active", "admin + employee hosts enforced upstream"],
  ];
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Owner controls, diagnostics, and connector readiness. Clients only see what you choose to expose.</p>
    </div>
    <h3 class="ws-subhead">Active control layer</h3>
    <p class="ws-note">Every tool is mapped to a Phantom desk. “Ready” means available to the owner; external sends, paid runs, and account changes still need the right connector and owner mode.</p>
    ${renderToolSpineCards()}
    <h3 class="ws-subhead">Workspace states</h3>
    <div class="stack">
      ${store.state.workspaces.map((w) => {
        const leads = store.state.leads.filter((l) => l.ws === w.id && !["won", "lost"].includes(l.status)).length;
        const appr = store.state.approvals.filter((a) => a.ws === w.id && a.status === "pending").length;
        const props = store.state.proposals.filter((p) => p.ws === w.id && ["draft", "sent-ready"].includes(p.status)).length;
        return `<article class="record record-row"><h4>${esc(w.name)}</h4><p class="record-sub">${esc(w.tagline)}</p>
          <span class="admin-ws-stats">${leads} open leads · ${props} live proposals · ${appr} pending approvals</span></article>`;
      }).join("")}
    </div>
    <h3 class="ws-subhead">Owner-only lanes</h3>
    <div class="card-grid">
      ${lanes.map(([name, state, note]) => `
        <article class="record"><div class="record-top"><h4>${esc(name)}</h4>${chip(["ready", "active", "setup-ready", "owner-controlled"].includes(state) ? "approved" : "pending")}</div>
        <p class="record-sub">${esc(note)}</p></article>`).join("")}
    </div>
    <h3 class="ws-subhead">Access</h3>
    <div class="stack">
      <article class="record record-wide">
        ${kv("Business Manager host", "<code>admin.phantomforce.online</code> — full PhantomForce operator view")}
        ${kv("Team Workspace host", "<code>app.phantomforce.online</code> — focused workspace view, permission-scoped")}
        ${kv("Gateway", "private access gateway sits in front of both — auth is enforced there, never weakened here")}
      </article>
    </div>
    <h3 class="ws-subhead">Diagnostics</h3>
    <div class="record-actions">
      <button class="btn btn-quiet" data-act="reset">Reset local Phantom data</button>
      <span class="hint-inline">Clears local records and returns to a brand-new empty account. Local only.</span>
    </div>`;
  bindActions(el, {
    reset: () => { if (confirm("Reset local Phantom data to a blank account?")) { store.reset(); rerender(); } },
  });
}

/* ============================ PHANTOM CONSOLE ============================ */
/* Full-screen conversation surface — history handled by main.js, this is the shell. */
function renderPhantom(el) {
  el.innerHTML = `
    <div class="phantom-console">
      <div class="phantom-log" data-phantom-log></div>
      <form class="speakline" data-phantom-form>
        <span class="speak-caret">›</span>
        <input type="text" data-phantom-input autocomplete="off" spellcheck="false" placeholder="What do you want PhantomForce to do?" aria-label="Command PhantomForce" />
      </form>
    </div>`;
}

/* ============================ REGISTRY ============================ */
export const WORKSPACE_DEFS = {
  phantom: { title: "Phantom AI", kicker: "Business command surface", render: renderPhantom },
  leads: { title: "Client Pipeline", kicker: "Lead desk & follow-up intelligence", render: renderLeads },
  proposals: { title: "Offer Desk", kicker: "Quotes, scopes, and deal math", render: renderProposals },
  reviews: { title: "Review Desk", kicker: "Reputation engine", render: renderReviews },
  bookings: { title: "Bookings", kicker: "Schedule desk", render: renderBookings },
  media: { title: "Media Lab", kicker: "Creator production studio", render: renderMedia },
  protect: { title: "Protect", kicker: "Security watch", render: renderProtect },
  money: { title: "Accounting", kicker: "Books, transaction reader, and cash truth", render: renderMoney },
  memory: { title: "Memory", kicker: "Context intelligence database", render: renderMemory },
  workforce: { title: "Workforce", kicker: "Business ops network", render: renderWorkforce },
  approvals: { title: "Approvals", kicker: "Waiting on your call", render: renderApprovals },
  adminos: { title: "PhantomOps", kicker: "Operator controls", render: renderAdmin, adminOnly: true },
};

/* Mission-grid widgets: id → live stat line. Scales by adding entries. */
export function missionWidgets() {
  const leads = visible(store.state.leads);
  const openLeads = leads.filter((l) => !["won", "lost"].includes(l.status));
  const dueLeads = leads.filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
  const m = moneyView();
  const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
  const pendingMedia = visible(store.state.media).filter((x) => ["pending", "draft", "brief-ready", "generation-approved"].includes(x.status));
  const generatedMedia = visible(store.state.media).filter((x) => ["generated", "delivered", "completed", "saved"].includes(x.status));
  const pages = visible(store.state.sites);
  const sec = visible(store.state.security)[0];
  const revs = visible(store.state.reviews).filter((r) => r.status !== "published-ready");
  const bks = visible(store.state.bookings).filter((b) => b.status !== "confirmed");
  const activeTools = (store.state.toolSpine || []).filter((tool) => ["active", "standby", "gated", "sandbox", "setup-ready", "planning", "available", "owner-controlled"].includes(tool.mode)).length;
  const workerRoster = buildWorkerRoster();
  const onlineWorkers = workerRoster.filter((worker) => worker.status !== "offline");
  const subagentCount = workerRoster.filter((worker) => worker.worker_type === "subagent").length;
  const neuralCellCount = workerRoster.filter((worker) => worker.worker_type === "cell").length;

  const w = [
    { id: "leads", icon: "◉", title: "Client Pipeline", stat: `${openLeads.length} open`, sub: dueLeads.length ? `${dueLeads.length} due today` : "pipeline current", alert: dueLeads.length > 0 },
    { id: "proposals", icon: "◆", title: "Offer Desk", stat: `${m.open.length} live`, sub: `${fmtMoney(m.pipeline)} potential`, alert: false },
    { id: "media", icon: "▶", title: "Creator Studio", stat: `${pendingMedia.length} pending`, sub: `${generatedMedia.length} generated`, alert: false },
    { id: "sites", icon: "▦", title: "Site Portfolio", stat: `${pages.length} site${pages.length === 1 ? "" : "s"}`, sub: `${pages.filter((p) => p.domain || p.url || p.design?.existingUrl).length} domain${pages.filter((p) => p.domain || p.url || p.design?.existingUrl).length === 1 ? "" : "s"}`, alert: false },
    { id: "reviews", icon: "★", title: "Review Desk", stat: `${revs.length} in pipe`, sub: "request → publish", alert: false },
    { id: "bookings", icon: "◷", title: "Bookings", stat: `${bks.length} pending`, sub: "drafts & confirmations", alert: false },
    { id: "protect", icon: "⬡", title: "Security Watch", stat: sec ? (sec.posture === "clean" ? "clean" : "attention") : "—", sub: sec ? `next scan ${daysUntil(sec.nextScan)}d` : "", alert: sec?.posture !== "clean" },
    { id: "money", icon: "◈", title: "Accounting", stat: m.transactions.length ? moneySigned(m.netCash) : "books", sub: m.transactions.length ? `${m.transactions.length} transaction${m.transactions.length === 1 ? "" : "s"}` : "add/import transactions", alert: false },
    { id: "workforce", icon: "⬢", title: "Workforce", stat: `${onlineWorkers.length} workers`, sub: isAdmin() ? `${subagentCount} subagents · ${neuralCellCount} helper lanes` : "your support team", alert: false },
    { id: "approvals", icon: "✓", title: "Approvals", stat: `${pend.length} waiting`, sub: pend.length ? "needs your call" : "queue clear", alert: pend.length > 0 },
  ];
  if (isAdmin()) w.push({ id: "adminos", icon: "⌘", title: "PhantomOps", stat: "operator", sub: "workspaces · lanes · access", alert: false });
  return w;
}
