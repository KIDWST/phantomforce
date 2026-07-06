/* PhantomForce Phantom — workspace surfaces.
   Every widget on the mission grid opens one of these as a focused overlay
   above the dashboard. Registry-driven so the grid can scale to hundreds
   of widgets without changing the shell. */

import {
  store, uid, visible, isAdmin, currentWs, wsName, pushActivity, resolveApproval,
  moneyView, fmtMoney, fmtDate, fmtDateTime, ago, daysUntil, statusLabel,
  PACKAGES, RETAINERS, MEMORY_CATEGORY_LABELS, MEMORY_RETENTION_DAYS,
  addMemory, toggleMemoryRemember, forgetMemory, memoryStats, memoryRetention,
} from "./store.js?v=phantom-live-20260706-08";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const title = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());

const chip = (status) => `<span class="chip chip-${esc(status)}">${esc(statusLabel(status))}</span>`;
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
const empty = (msg) => `<div class="ws-empty">${esc(msg)}</div>`;
const wsTag = (id) => (isAdmin() && currentWs() === "phantomforce") ? `<span class="ws-tag">${esc(wsName(id))}</span>` : "";
const memoryUi = { query: "", category: "all" };
const workerUi = { filter: "all", notice: "", preview: null };
const MEMORY_DAY = 86400000;

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
function renderLeads(el, rerender) {
  const leads = visible(store.state.leads);
  const lanes = [
    ["new", "New"], ["follow-up", "Follow-up"], ["proposal", "Proposal out"], ["won", "Won"], ["lost", "Lost"],
  ];
  el.innerHTML = `
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
              ${wsTag(l.ws)}
              <h4>${esc(l.name)}</h4>
              <p class="record-sub">${esc(l.company)} · ${esc(l.source)} · ${fmtMoney(l.value)}</p>
              <p class="record-next">▸ ${esc(l.next)}${["new", "follow-up"].includes(l.status) ? ` <i>(${daysUntil(l.due) <= 0 ? "due today" : "in " + daysUntil(l.due) + "d"})</i>` : ""}</p>
              <p class="record-notes">${esc(l.notes)}</p>
              <div class="record-actions">
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
  bindActions(el, {
    add: () => {
      const name = prompt("Lead name (person or business):");
      if (!name) return;
      store.state.leads.unshift({ id: uid("lead"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), name: name.trim(), company: name.trim(), source: "Manual capture", status: "new", value: 750, next: "Qualify the need and the budget", due: new Date(Date.now() + 86400000).toISOString(), owner: "Lead Hunter", notes: "", proposalId: null });
      pushActivity("Lead Hunter", `captured a new lead: ${name.trim()}.`);
      store.save(); rerender();
    },
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
    won: (id) => { const l = find(id); l.status = "won"; l.next = "Kick off delivery"; const p = store.state.proposals.find((x) => x.id === l.proposalId); if (p) p.status = "won"; pushActivity("Revenue Tracker", `marked ${l.company} as won.`, l.ws); store.save(); rerender(); },
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
            ${p.status === "invoice-ready" ? `<span class="hint-inline">Invoice-ready — payment connector not wired, tracked in Money.</span>` : ""}
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
    ready: (id) => { const p = find(id); p.status = "sent-ready"; p.updated = new Date().toISOString(); pushActivity("Proposal Forge", `moved ${p.client} to send-ready.`, p.ws); store.save(); rerender(); },
    won: (id) => { const p = find(id); p.status = "won"; pushActivity("Revenue Tracker", `${p.client} proposal won — ${fmtMoney(p.price)}.`, p.ws); store.save(); rerender(); },
    lost: (id) => { const p = find(id); p.status = "lost"; store.save(); rerender(); },
    invoice: (id) => { const p = find(id); p.status = "invoice-ready"; pushActivity("Revenue Tracker", `${p.client} marked invoice-ready.`, p.ws); store.save(); rerender(); },
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
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Controlled creative work: request → approval → generation → proof → delivery. Paid generation never runs without sign-off.</p>
      <button class="btn btn-primary" data-act="add">+ Video request</button>
    </div>
    <div class="card-grid">
      ${media.map((m) => `
        <article class="record">
          <button class="record-x" data-act="remove" data-id="${m.id}" aria-label="Remove video request">×</button>
          <div class="record-top">${wsTag(m.ws)}<h4>${esc(m.title)}</h4></div>
          <p class="record-sub">${esc(m.type)} · ${chip(m.status)} · ${ago(m.updated)}</p>
          <p class="record-notes"><b>Angle:</b> ${esc(m.angle)}</p>
          <details class="shotlist"><summary>Video plan (${m.shots.length})</summary>
            <ol>${m.shots.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          </details>
          <p class="record-notes"><b>Caption:</b> ${esc(m.caption)}</p>
          ${m.proof ? `<p class="record-proof">Proof: <code>${esc(m.proof)}</code></p>` : ""}
          <div class="record-actions">
            <button class="btn" data-act="copy" data-id="${m.id}">Copy plan</button>
            ${m.status === "draft" ? `<button class="btn btn-good" data-act="ready" data-id="${m.id}">Ready to produce</button>` : ""}
            ${m.status === "brief-ready" && isAdmin() ? `<button class="btn" data-act="request-gen" data-id="${m.id}">Request generation (approval)</button>` : ""}
            ${m.status === "generation-approved" ? `<button class="btn" data-act="delivered" data-id="${m.id}">Mark delivered</button>` : ""}
          </div>
        </article>`).join("") || empty("Media Lab is quiet. Create a video request to get rolling.")}
    </div>`;
  const find = (id) => store.state.media.find((m) => m.id === id);
  bindActions(el, {
    add: () => {
      const t = prompt("What is this creative for? (client / campaign)");
      if (!t) return;
      store.state.media.unshift({ id: uid("med"), ws: currentWs(), title: `${t.trim()} — video request`, type: "Reel (vertical, 30s)", status: "draft", angle: "Hook in 2 seconds, one idea, end on the offer.", shots: ["Opening hook shot", "Detail pass", "People / reaction", "Offer card", "Logo sting"], caption: `${t.trim()} — draft caption.`, proof: null, updated: new Date().toISOString() });
      pushActivity("Media Factory", `created a video request: ${t.trim()}.`);
      store.save(); rerender();
    },
    copy: (id, btn) => { const m = find(id); copyText(btn, `${m.title}\n${m.type}\n\nAngle: ${m.angle}\n\nShots:\n${m.shots.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nCaption: ${m.caption}`); },
    ready: (id) => { const m = find(id); m.status = "brief-ready"; m.updated = new Date().toISOString(); pushActivity("Media Factory", `ready to produce: ${m.title}.`, m.ws); store.save(); rerender(); },
    remove: (id) => {
      const m = find(id);
      store.state.media = store.state.media.filter((item) => item.id !== id);
      if (m) pushActivity("Media Factory", `removed video request: ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    "request-gen": (id) => {
      const m = find(id);
      store.state.approvals.unshift({ id: uid("app"), ws: m.ws, type: "media-generation", title: `Run paid generation: ${m.title}`, detail: "One generation pass on this video request. Uses paid credits — approval required.", ref: m.id, status: "pending", requestedBy: "Media Factory", at: new Date().toISOString() });
      pushActivity("Media Factory", `requested a generation pass on ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    delivered: (id) => { const m = find(id); m.status = "delivered"; m.updated = new Date().toISOString(); pushActivity("Delivery Manager", `delivered ${m.title}.`, m.ws); store.save(); rerender(); },
  });
}

/* ========================= SITE + STORE STUDIO ========================= */
function baseSiteDraft(title = "New website", kind = "Website") {
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
  };
}

function ensureSiteDesign(site) {
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

function firstSentence(value) {
  return String(value || "").split(/[.!?]/)[0].trim();
}

function applyWebsitePrompt(site, promptText) {
  const prompt = String(promptText || "").trim();
  if (!site || !prompt) return "Tell Phantom what to change first.";
  const design = ensureSiteDesign(site);
  const lower = prompt.toLowerCase();
  const quoted = prompt.match(/["“](.+?)["”]/)?.[1];
  const afterTo = prompt.match(/\b(?:to|as|called)\s+(.{3,90})$/i)?.[1]?.replace(/[.?!]\s*$/, "").trim();
  let changed = "";

  if (/store|shop|checkout|cart|product/.test(lower)) {
    site.kind = "Store";
    design.storeEnabled = true;
    site.sections = Array.from(new Set([...site.sections, "Products", "Checkout"]));
    changed = "Added store sections and checkout planning.";
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
    design.cta = quoted || afterTo || (/book/.test(lower) ? "Book now" : /buy|shop/.test(lower) ? "Shop now" : "Get started");
    changed = "Updated the button.";
  }
  if (/offer|deal|package/.test(lower)) {
    design.offer = quoted || afterTo || firstSentence(prompt.replace(/offer|deal|package|make|set/gi, ""));
    changed = "Updated the offer.";
  }
  if (/add section|section for|add a section/.test(lower)) {
    const section = quoted || afterTo || prompt.replace(/add( a)? section( for)?/i, "").trim();
    if (section) {
      site.sections.push(title(section).slice(0, 48));
      changed = `Added ${title(section)} section.`;
    }
  }
  if (/remove checkout|no checkout|hide checkout/.test(lower)) {
    design.storeEnabled = false;
    site.sections = site.sections.filter((x) => !/checkout/i.test(x));
    changed = "Removed checkout from the preview.";
  }
  site.updated = new Date().toISOString();
  return changed || "I did not catch a site change yet. Try headline, store, color, premium, booking, product, or existing URL.";
}

function renderWebsitePreview(site, products) {
  const design = ensureSiteDesign(site);
  const theme = design.theme || "neon";
  const showProducts = design.storeEnabled || site.kind === "Store";
  const sections = site.sections.slice(0, 6);
  const listedProducts = products.slice(0, 3);
  return `
    <div class="site-live-preview theme-${esc(theme)}">
      <div class="site-browser-bar"><span></span><span></span><span></span><b>${esc(design.existingUrl || `${design.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.com`)}</b><small>mockup preview</small></div>
      <div class="site-preview-hero">
        <div>
          <p>${esc(design.brand)}</p>
          <h3>${esc(design.headline)}</h3>
          <span>${esc(design.subhead)}</span>
          <button type="button">${esc(design.cta)}</button>
        </div>
        <div class="site-preview-orb" aria-hidden="true"><i></i></div>
      </div>
      <div class="site-preview-sections">
        ${sections.map((section) => `<span>${esc(section)}</span>`).join("")}
      </div>
      ${showProducts ? `
        <div class="site-preview-products">
          ${(listedProducts.length ? listedProducts : [
            { name: "Featured offer", price: 99, desc: design.offer },
            { name: "Starter package", price: 199, desc: "Simple entry point" },
          ]).map((p) => `
            <article>
              <b>${esc(p.name)}</b>
              <em>${fmtMoney(p.price)}</em>
              <small>${esc(p.desc || "Ready for your details.")}</small>
            </article>`).join("")}
        </div>` : `
        <div class="site-preview-offer"><b>${esc(design.offer)}</b><span>${esc(design.cta)}</span></div>`}
    </div>`;
}

function renderSites(el, rerender) {
  const sites = visible(store.state.sites);
  const products = visible(store.state.products);
  const active = sites[0] || null;
  if (active) ensureSiteDesign(active);
  el.innerHTML = `
    <section class="site-builder">
      <div class="site-builder-head">
        <div>
          <p class="overlay-kicker">AI SITE BUILDER</p>
          <h3>Build or edit a website by telling Phantom what to change.</h3>
          <p>Use plain English. The preview updates here before anything publishes.</p>
        </div>
        <div class="site-builder-actions">
          <button class="btn btn-primary" data-act="start-site">New website</button>
          <button class="btn btn-primary" data-act="start-store">New store</button>
        </div>
      </div>
      ${!active ? `
        <div class="site-start-grid">
          <button class="site-start-card" data-act="start-site"><b>Start a website</b><span>Services, proof, booking, contact.</span></button>
          <button class="site-start-card" data-act="start-store"><b>Start a store</b><span>Products, offers, checkout plan.</span></button>
          <button class="site-start-card" data-act="focus-existing"><b>Use an existing site</b><span>Paste a URL and plan the upgrade.</span></button>
        </div>` : `
        <div class="site-builder-grid">
          <div class="site-command-panel">
            <div class="site-active-card">
              <span>${chip(active.status)}</span>
              <h4>${esc(active.title)}</h4>
              <p>${esc(active.kind)} · updated ${ago(active.updated)}</p>
            </div>
            <form class="site-ai-box" data-site-ai>
              <label for="sitePrompt">Tell Phantom what to change</label>
              <textarea id="sitePrompt" data-site-prompt rows="4" placeholder="Example: make this a premium plumbing site with emergency service, reviews, and a book-now button"></textarea>
              <button class="btn btn-primary" type="submit">Update preview</button>
            </form>
            <details class="site-help">
              <summary>Help me start</summary>
              <div class="site-help-grid">
                <button data-act="ask-service">Service business</button>
                <button data-act="ask-store">Online store</button>
                <button data-act="ask-booking">Booking page</button>
                <button data-act="ask-sports">Sports/team site</button>
              </div>
            </details>
            <div class="site-link-card">
              <label>Existing site URL</label>
              <div>
                <input type="url" data-existing-url placeholder="https://your-site.com" value="${esc(active.design.existingUrl || active.url || "")}" />
                <button class="btn btn-quiet" data-act="link-existing">Link</button>
              </div>
            </div>
            <div class="site-mini-actions">
              <button class="btn btn-quiet" data-act="make-premium">Make premium</button>
              <button class="btn btn-quiet" data-act="enable-store">Add store</button>
              <button class="btn btn-quiet" data-act="add-product-quick">Add sample product</button>
            </div>
          </div>
          <div class="site-preview-panel">
            <div class="site-preview-top">
              <span>Design preview</span>
              <b>${esc(active.design.style)} · ${esc(active.design.theme)}</b>
            </div>
            <div data-site-preview-mount>${renderWebsitePreview(active, products)}</div>
          </div>
        </div>`}
      <h3 class="ws-subhead">Drafts</h3>
      <div class="card-grid">
        ${sites.map((s) => `
          <article class="record">
            <div class="record-top">${wsTag(s.ws)}<h4>${esc(s.title)}</h4></div>
            <p class="record-sub">${esc(s.kind)} · ${chip(s.status)} · ${ago(s.updated)}</p>
            <div class="page-preview">${s.sections.map((x) => `<div class="page-preview-row">${esc(x)}</div>`).join("")}</div>
            ${s.url ? `<p class="record-proof">Existing site saved: <code>${esc(s.url)}</code></p>` : ""}
            <div class="record-actions">
              ${s.status === "draft" ? `<button class="btn btn-good" data-act="ready" data-id="${s.id}">Mark ready</button>` : ""}
              ${s.status === "publish-ready" && isAdmin() ? `<button class="btn" data-act="queue" data-id="${s.id}">Queue publish approval</button>` : ""}
              ${s.status === "approved-to-publish" ? `<span class="hint-inline">Approved. Publish connector still has to run.</span>` : ""}
              <button class="btn btn-quiet" data-act="focus-site" data-id="${s.id}">Edit here</button>
              <button class="btn btn-quiet" data-act="section" data-id="${s.id}">Add section</button>
            </div>
          </article>`).join("") || empty("No website yet. Start one above.")}
      </div>
      <h3 class="ws-subhead">Products / services</h3>
      <div class="card-grid">
        ${products.map((p) => `
          <article class="record">
            <div class="record-top">${wsTag(p.ws)}<h4>${esc(p.name)}</h4><b class="record-price">${fmtMoney(p.price)}</b></div>
            <p class="record-sub">${esc(p.category)} · publish: ${chip(p.publish)} · checkout: ${chip(p.checkout)}</p>
            <p class="record-notes">${esc(p.desc)}</p>
            <p class="record-sub">Delivery: ${esc(p.fulfillment)}</p>
            <div class="record-actions">
              ${p.publish === "draft" ? `<button class="btn btn-good" data-act="pub-ready" data-id="${p.id}">Mark ready</button>` : ""}
            </div>
          </article>`).join("")}
        <article class="record record-ghostcard">
          <h4>Add product or service</h4>
          <div class="mini-form">
            <input type="text" data-prod-name placeholder="Name" />
            <input type="number" data-prod-price placeholder="Price" min="0" />
            <input type="text" data-prod-cat placeholder="Category" />
            <textarea data-prod-desc placeholder="Short description" rows="2"></textarea>
            <button class="btn btn-primary" data-act="add-prod">Add</button>
          </div>
        </article>
      </div>
    </section>`;
  const createDraft = (name, kind) => {
    const draft = baseSiteDraft(name, kind);
    store.state.sites.unshift(draft);
    pushActivity(kind === "Store" ? "Store Builder" : "Site Builder", `started ${draft.title}.`, draft.ws);
    store.save(); rerender();
  };
  bindActions(el, {
    "start-site": () => createDraft(`${wsName(currentWs())} site`, "Website"),
    "start-store": () => createDraft(`${wsName(currentWs())} store`, "Store"),
    "focus-existing": () => createDraft("Existing site rebuild", "Website"),
    "ask-service": () => { if (active) { applyWebsitePrompt(active, "make this a simple service business site with services, reviews, quote request, and clear contact button"); store.save(); rerender(); } },
    "ask-store": () => { if (active) { applyWebsitePrompt(active, "turn this into an online store with products, offer, reviews, and checkout plan"); store.save(); rerender(); } },
    "ask-booking": () => { if (active) { applyWebsitePrompt(active, "add booking, schedule, reminders, and a book now button"); store.save(); rerender(); } },
    "ask-sports": () => { if (active) { applyWebsitePrompt(active, "make this a sports team site with signups, schedule, highlights, parent updates, and merch"); store.save(); rerender(); } },
    "make-premium": () => { if (active) { applyWebsitePrompt(active, "make this more premium and simple with less words"); store.save(); rerender(); } },
    "enable-store": () => { if (active) { applyWebsitePrompt(active, "add store products and checkout sections"); store.save(); rerender(); } },
    "add-product-quick": () => {
      store.state.products.unshift({ id: uid("prod"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), name: "Featured offer", price: 99, category: "Offer", desc: "Edit this into the real product or service.", fulfillment: "Define delivery before publish", checkout: "not-wired", publish: "draft" });
      pushActivity("Store Builder", "added a sample product to the catalog.");
      store.save(); rerender();
    },
    "link-existing": () => {
      if (!active) return;
      const input = el.querySelector("[data-existing-url]");
      const url = input?.value?.trim();
      if (!url) return;
      applyWebsitePrompt(active, `link existing site ${url}`);
      store.save(); rerender();
    },
    ready: (id) => { const s = store.state.sites.find((x) => x.id === id); s.status = "publish-ready"; s.updated = new Date().toISOString(); pushActivity("Site Builder", `${s.title} is publish-ready.`, s.ws); store.save(); rerender(); },
    "focus-site": (id) => {
      const index = store.state.sites.findIndex((x) => x.id === id);
      if (index <= 0) return;
      const [site] = store.state.sites.splice(index, 1);
      store.state.sites.unshift(site);
      pushActivity("Site Builder", `${site.title} is now in the live builder.`, site.ws);
      store.save(); rerender();
    },
    queue: (id) => {
      const s = store.state.sites.find((x) => x.id === id);
      store.state.approvals.unshift({ id: uid("app"), ws: s.ws, type: "publish-page", title: `Publish ${s.title}`, detail: "Reviewed draft. Publishing makes it live.", ref: s.id, status: "pending", requestedBy: "Site Builder", at: new Date().toISOString() });
      pushActivity("Site Builder", `queued publish approval for ${s.title}.`, s.ws);
      store.save(); rerender();
    },
    section: (id) => {
      const s = store.state.sites.find((x) => x.id === id);
      applyWebsitePrompt(s, "add section Frequently Asked Questions");
      store.save(); rerender();
    },
    "add-prod": () => {
      const name = el.querySelector("[data-prod-name]")?.value.trim();
      const price = Number(el.querySelector("[data-prod-price]")?.value || 0);
      const cat = el.querySelector("[data-prod-cat]")?.value.trim() || "Service";
      const desc = el.querySelector("[data-prod-desc]")?.value.trim() || "";
      if (!name) return;
      store.state.products.unshift({ id: uid("prod"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), name, price, category: cat, desc, fulfillment: "Define fulfillment before publish", checkout: "not-wired", publish: "draft" });
      pushActivity("Store Builder", `added ${name} to the catalog.`);
      store.save(); rerender();
    },
    "pub-ready": (id) => { const p = store.state.products.find((x) => x.id === id); p.publish = "publish-ready"; store.save(); rerender(); },
  });
  const ai = el.querySelector("[data-site-ai]");
  if (ai && active) {
    const input = el.querySelector("[data-site-prompt]");
    const previewMount = el.querySelector("[data-site-preview-mount]");
    input?.addEventListener("input", () => {
      if (!previewMount) return;
      const previewDraft = JSON.parse(JSON.stringify(active));
      applyWebsitePrompt(previewDraft, input.value);
      previewMount.innerHTML = renderWebsitePreview(previewDraft, products);
    });
    ai.onsubmit = (event) => {
      event.preventDefault();
      const result = applyWebsitePrompt(active, input?.value || "");
      pushActivity("Site Builder", result, active.ws);
      store.save(); rerender();
    };
  }
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
function renderMoney(el, rerender) {
  const m = moneyView();
  const invoiceReady = visible(store.state.proposals).filter((p) => p.status === "invoice-ready");
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat"><span>Open pipeline</span><b>${fmtMoney(m.pipeline)}</b><i>${m.open.length} proposal${m.open.length === 1 ? "" : "s"}</i></div>
      <div class="stat"><span>Won</span><b>${fmtMoney(m.wonValue)}</b><i>${m.won.length} closed</i></div>
      <div class="stat"><span>Retainers attached</span><b>${fmtMoney(m.retainerMonthly)}/mo</b><i>recurring once live</i></div>
      <div class="stat"><span>Invoice-ready</span><b>${invoiceReady.length}</b><i>payment connector not wired</i></div>
    </div>
    <h3 class="ws-subhead">Open proposals by value</h3>
    <div class="stack">
      ${m.open.slice().sort((a, b) => b.price - a.price).map((p) => `
        <article class="record record-row">
          ${wsTag(p.ws)}<h4>${esc(p.client)}</h4>${chip(p.status)}<b class="record-price">${fmtMoney(p.price)}</b>
        </article>`).join("") || empty("No open proposals — pipeline is either closed or waiting to be built.")}
    </div>
    <h3 class="ws-subhead">Next money actions</h3>
    ${m.open.length || m.won.length || invoiceReady.length ? `<ul class="record-list record-list-lg">
      ${m.open.filter((p) => p.status === "sent-ready").map((p) => `<li>▸ ${esc(p.client)} is send-ready — get it in front of them and set the follow-up.</li>`).join("")}
      ${m.won.filter((p) => !p.retainer).map((p) => `<li>▸ ${esc(p.client)} closed without a retainer — pitch Keeper ($150/mo) at delivery.</li>`).join("")}
      ${invoiceReady.map((p) => `<li>▸ ${esc(p.client)} is invoice-ready — track payment manually until the connector exists.</li>`).join("")}
      <li>▸ Price-tier check: anything scoped over 20 hours should quote at Pro ($2,500), not Core.</li>
    </ul>` : empty("No money actions yet. Real proposals and invoices will appear here after you create them.")}
    <p class="ws-note">Quote → approval → invoice-ready → payment-tracked. Real invoices and payment requests stay off until a payment connector is configured.</p>`;
}

/* ============================= MEMORY ============================= */
function categoryLabel(category) {
  return MEMORY_CATEGORY_LABELS[category] || title(category).replace(/-/g, " ");
}

function renderMemory(el, rerender) {
  const all = visible(store.state.memory || []);
  const stats = memoryStats(all);
  const query = memoryUi.query.trim().toLowerCase();
  const counts = all.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  const categories = Object.keys(MEMORY_CATEGORY_LABELS).filter((category) => counts[category]);
  const filtered = all.filter((item) => {
    const inCategory = memoryUi.category === "all" || item.category === memoryUi.category;
    const haystack = `${item.title} ${item.summary} ${item.text} ${(item.tags || []).join(" ")}`.toLowerCase();
    return inCategory && (!query || haystack.includes(query));
  });
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
          <h3>Everything Phantom should know, organized for research.</h3>
          <p>Conversations and manual notes stay in this browser. Normal memories auto-expire after ${MEMORY_RETENTION_DAYS} days unless you or Phantom mark them to remember.</p>
        </div>
        <div class="memory-score">
          <b>${stats.total}</b>
          <span>saved</span>
        </div>
      </section>
      <div class="stat-row memory-stats">
        <div class="stat"><span>Categories</span><b>${stats.categories}</b><i>auto-organized</i></div>
        <div class="stat"><span>Remembered</span><b>${stats.remembered}</b><i>kept past 30 days</i></div>
        <div class="stat"><span>Expiring soon</span><b>${stats.expiresSoon}</b><i>normal cleanup</i></div>
      </div>
      <div class="memory-controls">
        <label class="memory-search">
          <span>Search memory</span>
          <input type="search" data-memory-search value="${esc(memoryUi.query)}" placeholder="Search conversations, clients, sites, security, money..." />
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
                <div class="record-top">
                  ${wsTag(item.ws)}
                  <h4>${esc(item.title)}</h4>
                  <span class="memory-retention">${esc(memoryRetention(item))}</span>
                </div>
                <p class="record-sub">${esc(categoryLabel(item.category))} · ${esc(item.source)} · ${ago(item.createdAt)}</p>
                <p class="record-notes">${esc(item.summary)}</p>
                <div class="memory-tags">${(item.tags || []).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
                <div class="record-actions">
                  <button class="btn ${item.pinnedByUser ? "btn-good" : ""}" data-act="pin-memory" data-id="${item.id}">${item.pinnedByUser ? "Unremember" : "Remember"}</button>
                  <button class="btn btn-quiet" data-act="forget-memory" data-id="${item.id}">Delete</button>
                </div>
              </article>`).join("") || empty(query ? "No memories matched that search." : "No memories yet. Ask Phantom something or capture a manual note.")}
          </div>
        </section>
        <aside class="memory-side">
          <article class="record">
            <h4>Research packages</h4>
            <p class="record-notes">Phantom groups memory by topic so the database stays searchable instead of becoming a long chat log.</p>
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
            ${expiring.map((item) => `<p class="record-next">▸ ${esc(item.title)} <i>${esc(memoryRetention(item))}</i></p>`).join("") || `<p class="record-notes">Nothing is about to expire. Normal cleanup keeps the account lightweight.</p>`}
          </article>
        </aside>
      </div>
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
  bindActions(el, {
    "pin-memory": (id) => { toggleMemoryRemember(id); rerender(); },
    "forget-memory": (id) => {
      if (confirm("Delete this local memory?")) { forgetMemory(id); rerender(); }
    },
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
const WORKER_SUBAGENTS = [
  {
    parent: "code-intelligence",
    name: "Repo Scout",
    role: "Previews repo health checks and outdated dependency findings.",
    status: "needs-approval",
    task: "Waiting for owner approval before any repo pull or scan.",
    capabilities: ["repo preview", "dependency review", "malware-check plan"],
    risk: "high",
  },
  {
    parent: "media-engine",
    name: "Content Brief Runner",
    role: "Turns campaign ideas into draft briefs and asset checklists.",
    status: "idle",
    task: "Ready to draft content tasks without publishing anything.",
    capabilities: ["briefs", "asset lists", "content queue"],
    risk: "low",
  },
  {
    parent: "automation-desk",
    name: "Follow-Up Drafter",
    role: "Prepares manual follow-up messages and next-step reminders.",
    status: "ready",
    task: "Ready to draft next-safe-actions for leads. No sends enabled.",
    capabilities: ["follow-up drafts", "approval routing", "lead notes"],
    risk: "medium",
  },
  {
    parent: "operating-standards",
    name: "Stale Tool Sweeper",
    role: "Finds outdated tools and proposes retirement plans.",
    status: "blocked",
    task: "Blocked from removing anything until approval execution exists.",
    capabilities: ["tool inventory", "retirement preview", "risk notes"],
    risk: "high",
  },
];

function workerInitials(name = "") {
  return String(name).split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "PF";
}

function workerStatusFromTool(tool) {
  if (["setup-ready", "standby"].includes(tool.mode)) return "idle";
  if (tool.mode === "owner-controlled") return "needs-approval";
  if (tool.mode === "blocked" || tool.status === "blocked") return "blocked";
  return "ready";
}

function workerStatusLabel(status) {
  return ({
    ready: "Ready",
    working: "Drafting",
    idle: "Idle",
    blocked: "Blocked",
    "needs-approval": "Needs approval",
    human: "Human",
  })[status] || title(status);
}

function workerRiskLabel(risk) {
  return ({ low: "Low risk", medium: "Needs sign-off", high: "High risk" })[risk] || title(risk);
}

function workerTypeLabel(type) {
  return ({ bot: "Bot worker", human: "Human", agent: "Agent", subagent: "Subagent", system: "System" })[type] || title(type);
}

function buildWorkerRoster() {
  const tools = store.state.toolSpine || [];
  const activity = store.state.activity || [];
  const owner = {
    worker_id: "human-owner-operator",
    display_name: "Jordan",
    worker_type: "human",
    role: "Owner operator and final approval layer.",
    parent_agent_id: null,
    avatar: { initials: "JO", tone: "human" },
    status: "human",
    current_task: "Final decisions, approvals, and client-facing control.",
    capabilities: ["owner approval", "client judgment", "final control"],
    tools_available: ["PhantomForce cockpit"],
    risk_level: "low",
    last_active_at: "Approval layer",
    has_activity: true,
    approvals_required: 0,
    can_delegate: true,
    can_create_subagents: false,
    execution_enabled: false,
    preview_only: false,
    capacity_used: 0,
    capacity_total: 1,
    client_visible: true,
  };
  const bots = tools.map((tool) => {
    const status = workerStatusFromTool(tool);
    const highRisk = /code|gateway|brain|standards|process|private|model/i.test(`${tool.id} ${tool.internal} ${tool.role}`);
    const recent = activity.find((entry) =>
      String(entry.who || "").toLowerCase() === String(tool.worker || "").toLowerCase()
      || String(entry.text || "").toLowerCase().includes(String(tool.worker || "").toLowerCase()));
    return {
      worker_id: `bot-${tool.id}`,
      display_name: tool.worker || tool.name,
      worker_type: "bot",
      role: tool.role,
      parent_agent_id: null,
      avatar: { initials: workerInitials(tool.worker || tool.name), tone: status === "needs-approval" ? "approval" : status },
      status,
      current_task: tool.activity || tool.ownerControl || "Ready for owner-directed work.",
      capabilities: [tool.name, tool.internal, statusLabel(tool.mode)].filter(Boolean).slice(0, 4),
      tools_available: [tool.path || "Private backend", tool.name].filter(Boolean),
      risk_level: highRisk || status === "needs-approval" ? "medium" : "low",
      last_active_at: recent ? ago(recent.at) : "No runs yet",
      has_activity: !!recent,
      approvals_required: status === "needs-approval" || tool.mode === "setup-ready" ? 1 : 0,
      can_delegate: status !== "blocked",
      can_create_subagents: false,
      execution_enabled: false,
      preview_only: true,
      capacity_used: 0,
      capacity_total: 3,
      client_visible: tool.visibleToClients === true,
    };
  });
  const subagents = WORKER_SUBAGENTS.map((sub) => ({
    worker_id: `subagent-${sub.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    display_name: sub.name,
    worker_type: "subagent",
    role: sub.role,
    parent_agent_id: `bot-${sub.parent}`,
    avatar: { initials: workerInitials(sub.name), tone: sub.status },
    status: sub.status,
    current_task: sub.task,
    capabilities: sub.capabilities,
    tools_available: ["Preview lane only"],
    risk_level: sub.risk,
    last_active_at: "No runs yet",
    has_activity: false,
    approvals_required: sub.status === "needs-approval" || sub.status === "blocked" ? 1 : 0,
    can_delegate: false,
    can_create_subagents: false,
    execution_enabled: false,
    preview_only: true,
    capacity_used: 0,
    capacity_total: 1,
    client_visible: false,
  }));
  return [owner, ...bots, ...subagents];
}

function workerMatchesFilter(worker) {
  if (workerUi.filter === "all") return true;
  if (workerUi.filter === "bots") return worker.worker_type !== "human";
  if (workerUi.filter === "humans") return worker.worker_type === "human";
  if (workerUi.filter === "subagents") return worker.worker_type === "subagent";
  if (workerUi.filter === "attention") return worker.status === "blocked" || worker.status === "needs-approval";
  return worker.status === workerUi.filter;
}

function workerSortScore(worker) {
  if (worker.worker_type === "human") return 0;
  return ({ "needs-approval": 1, blocked: 2, ready: 3, working: 3, idle: 4 })[worker.status] || 5;
}

function workerPreviewTitle(kind, workerName) {
  if (kind === "subagent") return `Helper draft — ${workerName}`;
  if (kind === "retire") return `Retirement proposal — ${workerName}`;
  if (kind === "create") return "New worker design";
  return `Delegation preview — ${workerName}`;
}

function workerPreviewSteps(kind) {
  if (kind === "subagent") return ["Name the helper and the narrow job.", "Confirm allowed tools, limits, and tenant scope.", "Hold for owner approval before the helper exists."];
  if (kind === "retire") return ["List what the worker owns today.", "Show replacement or pause impact.", "Hold for owner approval before anything is retired."];
  if (kind === "create") return ["Define the business outcome.", "Choose capabilities, risk level, and approval rules.", "Hold as a design until the execution lane exists."];
  return ["Define the outcome.", "Confirm allowed tools and limits.", "Send to approvals only after a real execution lane exists."];
}

function renderWorkerPreview(worker, kind = "delegate") {
  const name = worker?.display_name || "new worker";
  return `
    <section class="worker-preview-panel">
      <div>
        <p class="worker-kicker">Preview only</p>
        <h4>${esc(workerPreviewTitle(kind, name))}</h4>
      </div>
      <ol>
        ${workerPreviewSteps(kind).map((step) => `<li>${esc(step)}</li>`).join("")}
      </ol>
      <p class="worker-preview-safe">Preview only — nothing was created, queued, executed, sent, scanned, pulled, retired, or deployed.</p>
      <div class="worker-actions">
        <button class="btn" data-act="worker-preview-close">Close</button>
        <button class="btn btn-quiet" disabled title="Execution lane not built yet">Send to Approvals</button>
      </div>
    </section>`;
}

function workerMeshTone(worker) {
  if (worker.worker_type === "human") return "human";
  if (worker.status === "blocked") return "blocked";
  if (worker.status === "needs-approval") return "approval";
  if (worker.status === "idle") return "idle";
  if (worker.has_activity) return "live";
  return "ready";
}

function workerMeshGroup(worker) {
  const text = `${worker.worker_id} ${worker.display_name} ${worker.role} ${worker.capabilities?.join(" ") || ""}`.toLowerCase();
  if (/n8n|automation|workflow/.test(text)) return "automation";
  if (/ruflo|loop|squad|swarm|handoff/.test(text)) return "loop";
  if (/media|video|content/.test(text)) return "media";
  if (/code|repo|build|spec/.test(text)) return "build";
  if (/memory|vault|context/.test(text)) return "memory";
  if (/gateway|access|security|sentinel|scanner/.test(text)) return "protect";
  if (/model|brain|phantom/.test(text)) return "brain";
  return "ops";
}

function renderWorkerMesh(workers) {
  const topWorkers = workers.filter((worker) => worker.worker_type !== "subagent");
  const rings = topWorkers.map((worker, index) => {
    const tone = workerMeshTone(worker);
    const group = workerMeshGroup(worker);
    const style = `--node-index:${index}; --node-delay:${(index % 7) * 0.28}s`;
    return `
      <button class="worker-node worker-node-${esc(tone)} worker-node-${esc(group)}" style="${style}" data-act="worker-filter" data-filter="${esc(worker.worker_type === "human" ? "humans" : worker.status)}" title="${esc(worker.display_name)}">
        <span class="worker-node-orb">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <span class="worker-node-label">${esc(worker.display_name)}</span>
        <i>${esc(worker.status === "human" ? "approval" : worker.status)}</i>
      </button>`;
  }).join("");
  const connected = topWorkers.filter((worker) => worker.status !== "blocked").length;
  const gated = topWorkers.filter((worker) => worker.status === "needs-approval" || worker.status === "idle").length;
  const blocked = topWorkers.filter((worker) => worker.status === "blocked").length;
  return `
    <section class="worker-mesh" aria-label="Worker operations mesh">
      <div class="worker-mesh-stage">
        <div class="worker-mesh-rings" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="worker-core">
          <span>PF</span>
          <b>Phantom</b>
          <i>router</i>
        </div>
        <div class="worker-links" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="worker-node-field">
          ${rings}
        </div>
      </div>
      <div class="worker-mesh-readout">
        <span><b>${connected}</b> wired lanes</span>
        <span><b>${gated}</b> gated/setup</span>
        <span><b>${blocked}</b> blocked</span>
      </div>
    </section>`;
}

function renderWorkerCard(worker, subagents = [], options = {}) {
  const showActions = options.actions !== false && worker.worker_type !== "human";
  const capPct = Math.max(0, Math.min(100, Math.round((worker.capacity_used / Math.max(1, worker.capacity_total)) * 100)));
  const previewOpen = workerUi.preview?.workerId === worker.worker_id;
  const previewExpanded = (kind) => previewOpen && workerUi.preview?.kind === kind;
  const meshTone = workerMeshTone(worker);
  return `
    <article class="worker-card worker-${esc(worker.status)} worker-type-${esc(worker.worker_type)}" role="listitem">
      <div class="worker-card-visual worker-card-visual-${esc(meshTone)}" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="worker-card-top">
        <span class="wf-avatar wf-avatar-${esc(worker.avatar?.tone || worker.status)}">${esc(worker.avatar?.initials || workerInitials(worker.display_name))}</span>
        <div class="worker-id">
          <b>${esc(worker.display_name)}</b>
          <i>${esc(workerTypeLabel(worker.worker_type))} · ${esc(worker.role)}</i>
        </div>
        <span class="worker-status"><span></span>${esc(workerStatusLabel(worker.status))}</span>
      </div>
      <p class="worker-task">${esc(worker.current_task)}</p>
      <div class="worker-capacity">
        <span><b>${worker.capacity_used}/${worker.capacity_total}</b> capacity slots in use — nothing active</span>
        <i style="--worker-cap:${capPct}%"></i>
      </div>
      <div class="worker-tags">
        ${worker.capabilities.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join("")}
      </div>
      ${subagents.length ? `
        <div class="worker-subagents">
          <small>Subagents</small>
          ${subagents.map((sub) => `<span class="worker-subchip worker-subchip-${esc(sub.status)}">${esc(sub.display_name)}</span>`).join("")}
        </div>` : ""}
      <div class="worker-facts">
        <span>${esc(workerRiskLabel(worker.risk_level))}</span>
        <span>${worker.approvals_required ? "Waiting on your approval" : "Nothing waiting on you"}</span>
        <span>${worker.execution_enabled ? "Execution on" : "Preview only — can't act alone"}</span>
        <span>${esc(worker.last_active_at)}</span>
      </div>
      ${worker.worker_type === "human" ? `<p class="worker-human-note">You're the approval layer. Everything routes through you.</p>` : ""}
      ${showActions ? `
        <div class="worker-actions">
          <button class="btn" data-act="worker-preview" data-id="${esc(worker.worker_id)}" data-preview="delegate" aria-expanded="${previewExpanded("delegate") ? "true" : "false"}">Preview a delegation</button>
          <button class="btn" data-act="worker-preview" data-id="${esc(worker.worker_id)}" data-preview="subagent" aria-expanded="${previewExpanded("subagent") ? "true" : "false"}">Draft a helper</button>
          <button class="btn btn-quiet" data-act="worker-preview" data-id="${esc(worker.worker_id)}" data-preview="retire" aria-expanded="${previewExpanded("retire") ? "true" : "false"}">Plan retirement</button>
        </div>` : ""}
      ${previewOpen ? renderWorkerPreview(worker, workerUi.preview.kind) : ""}
    </article>`;
}

function renderWorkforce(el, rerender) {
  const workers = buildWorkerRoster();
  const clientWorkers = workers.filter((worker) => worker.client_visible || worker.worker_type === "human");
  if (!isAdmin()) {
    const active = clientWorkers.filter((worker) => worker.status === "ready" || worker.worker_type === "human").length;
    const inflight = visible(store.state.media).filter((x) => x.status !== "delivered").length + visible(store.state.sites).filter((x) => x.status === "draft").length;
    el.innerHTML = `
      <div class="stat-row">
        <div class="stat"><span>Workers on your account</span><b>${active}</b><i>ready or active</i></div>
        <div class="stat"><span>Deliverables in progress</span><b>${inflight}</b><i>moving through the pipeline</i></div>
        <div class="stat"><span>Approvals waiting</span><b>${visible(store.state.approvals).filter((a) => a.status === "pending").length}</b><i>real queue only</i></div>
      </div>
      <h3 class="ws-subhead">Your visible workers</h3>
      <div class="worker-grid worker-grid-client" role="list">
        ${clientWorkers.map((worker) => renderWorkerCard({ ...worker, capabilities: worker.capabilities.slice(0, 3) }, [], { actions: false })).join("")}
      </div>
      <p class="ws-note">Your workers draft and prepare. Anything that touches the outside world waits for approval first.</p>`;
    return;
  }
  const visibleWorkers = workers.filter(workerMatchesFilter).sort((a, b) => workerSortScore(a) - workerSortScore(b));
  const subByParent = workers.reduce((acc, worker) => {
    if (worker.parent_agent_id) (acc[worker.parent_agent_id] ||= []).push(worker);
    return acc;
  }, {});
  const botCount = workers.filter((worker) => worker.worker_type !== "human").length;
  const humanCount = workers.filter((worker) => worker.worker_type === "human").length;
  const readyCount = workers.filter((worker) => worker.status === "ready" || worker.worker_type === "human").length;
  const attentionCount = workers.filter((worker) => worker.status === "blocked" || worker.status === "needs-approval").length;
  const filters = [
    ["all", "All"],
    ["bots", "Bots"],
    ["humans", "Humans"],
    ["subagents", "Subagents"],
    ["ready", "Ready"],
    ["idle", "Idle"],
    ["attention", "Waiting on you"],
  ];
  el.innerHTML = `
    <section class="workers-hero">
      <div>
        <p class="worker-kicker">Workers</p>
        <h3>Your team, at a glance</h3>
        <p>Every worker here is real, scoped, and waits for your go-ahead. Nothing runs, sends, scans, pulls, retires, or spends without approval.</p>
      </div>
      <div class="worker-scale">
        <span><b>${workers.length}</b> on the roster</span>
      </div>
    </section>
    ${workerUi.notice ? `<div class="worker-notice">${esc(workerUi.notice)} <button data-act="worker-notice-close" aria-label="Dismiss worker notice">×</button></div>` : ""}
    ${renderWorkerMesh(workers)}
    <div class="worker-metrics">
      <div><span>Total workers</span><b>${workers.length}</b></div>
      <div><span>Bot workers</span><b>${botCount}</b></div>
      <div><span>Humans</span><b>${humanCount}</b></div>
      <div><span>Ready</span><b>${readyCount}</b></div>
      <div><span>Waiting on you</span><b>${attentionCount}</b></div>
    </div>
    <div class="worker-filter-row">
      ${filters.map(([id, label]) => `<button class="worker-filter ${workerUi.filter === id ? "is-active" : ""}" data-act="worker-filter" data-filter="${esc(id)}" aria-pressed="${workerUi.filter === id ? "true" : "false"}">${esc(label)}</button>`).join("")}
      <button class="worker-filter worker-filter-propose" data-act="worker-preview" data-preview="create">Design a new worker</button>
    </div>
    ${workerUi.preview?.kind === "create" ? renderWorkerPreview(null, "create") : ""}
    <div class="worker-grid" role="list">
      ${visibleWorkers.map((worker) => renderWorkerCard(worker, subByParent[worker.worker_id] || [])).join("") || empty("No workers match this filter.")}
    </div>
    <section class="worker-enterprise">
      <div class="worker-safety-list">
        <span>Subagent creation: preview-only</span>
        <span>Repo pulls and malware scans: approval-gated</span>
        <span>Deletes, deploys, sends, billing: blocked here</span>
      </div>
      <div>
        <p class="worker-kicker">Future scale</p>
        <h4>Built to grow. Gated on purpose.</h4>
        <p>Add workers as the business grows — from a handful to a full fleet. Every new worker inherits the same rule: preview first, approve before anything real happens.</p>
      </div>
    </section>`;
  bindActions(el, {
    "worker-filter": (_id, button) => { workerUi.filter = button.dataset.filter || "all"; rerender(); },
    "worker-notice-close": () => { workerUi.notice = ""; rerender(); },
    "worker-preview-close": () => { workerUi.preview = null; rerender(); },
    "worker-preview": (id, button) => {
      const action = button.dataset.preview || "action";
      workerUi.preview = { workerId: id || null, kind: action };
      workerUi.notice = "";
      rerender();
    },
  });
}

/* ============================= APPROVALS ============================= */
function renderApprovals(el, rerender) {
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending");
  const done = visible(store.state.approvals).filter((a) => a.status !== "pending").slice(0, 6);
  el.innerHTML = `
    <div class="ws-toolbar"><p class="ws-note">Only outward-facing moves land here: sends, bookings, publishing, paid generation, invoices, deploys. Drafting never waits on you.</p></div>
    ${pending.length ? `<div class="stack">
      ${pending.map((a) => `
        <article class="record record-wide approval-card">
          <div class="record-top">${wsTag(a.ws)}<h4>${esc(a.title)}</h4><i class="record-time">${ago(a.at)}</i></div>
          <p class="record-notes">${esc(a.detail)}</p>
          <p class="record-sub">Requested by ${esc(a.requestedBy)} · type: ${esc(a.type)}</p>
          <div class="record-actions">
            <button class="btn btn-good" data-act="approve" data-id="${a.id}">Approve</button>
            <button class="btn btn-quiet" data-act="decline" data-id="${a.id}">Decline</button>
          </div>
        </article>`).join("")}
    </div>` : empty("Queue is clear. Nothing is waiting for approval.")}
    ${done.length ? `<h3 class="ws-subhead">Recent decisions</h3><div class="stack">
      ${done.map((a) => `<article class="record record-row">${wsTag(a.ws)}<h4>${esc(a.title)}</h4>${chip(a.status)}</article>`).join("")}
    </div>` : ""}`;
  bindActions(el, {
    approve: (id) => { resolveApproval(id, true); rerender(); },
    decline: (id) => { resolveApproval(id, false); rerender(); },
  });
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
        ${kv("Admin host", "<code>admin.phantomforce.online</code> — full phantom, this view")}
        ${kv("Employee host", "<code>app.phantomforce.online</code> — limited workspace view, permission-scoped")}
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
  phantom: { title: "Phantom AI", kicker: "Command brain", render: renderPhantom },
  leads: { title: "Leads & Follow-Up", kicker: "Pipeline desk", render: renderLeads },
  proposals: { title: "Proposal Forge", kicker: "Quotes & offers", render: renderProposals },
  reviews: { title: "Review Desk", kicker: "Reputation engine", render: renderReviews },
  bookings: { title: "Bookings", kicker: "Schedule desk", render: renderBookings },
  media: { title: "Media Lab", kicker: "Production phantom", render: renderMedia },
  sites: { title: "Site & Store Studio", kicker: "Build surface", render: renderSites },
  protect: { title: "Protect", kicker: "Security watch", render: renderProtect },
  money: { title: "Money", kicker: "Revenue phantom", render: renderMoney },
  memory: { title: "Memory", kicker: "Local context database", render: renderMemory },
  workforce: { title: "Workers", kicker: "Agents, humans, and subagents", render: renderWorkforce },
  approvals: { title: "Approvals", kicker: "Waiting on you", render: renderApprovals },
  adminos: { title: "PhantomOps", kicker: "Operator controls", render: renderAdmin, adminOnly: true },
};

/* Mission-grid widgets: id → live stat line. Scales by adding entries. */
export function missionWidgets() {
  const leads = visible(store.state.leads);
  const openLeads = leads.filter((l) => !["won", "lost"].includes(l.status));
  const dueLeads = leads.filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
  const m = moneyView();
  const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
  const videoRequests = visible(store.state.media).filter((x) => ["brief-ready", "generation-approved"].includes(x.status));
  const pages = visible(store.state.sites);
  const sec = visible(store.state.security)[0];
  const revs = visible(store.state.reviews).filter((r) => r.status !== "published-ready");
  const bks = visible(store.state.bookings).filter((b) => b.status !== "confirmed");
  const activeAgents = store.state.agents.filter((a) => a.status === "active").length;
  const activeTools = (store.state.toolSpine || []).filter((tool) => ["active", "standby", "gated", "sandbox", "setup-ready", "planning", "available", "owner-controlled"].includes(tool.mode)).length;

  const w = [
    { id: "leads", icon: "◉", title: "Handle Leads", stat: `${openLeads.length} open`, sub: dueLeads.length ? `${dueLeads.length} due today` : "pipeline current", alert: dueLeads.length > 0 },
    { id: "proposals", icon: "◆", title: "Build Quotes", stat: `${m.open.length} live`, sub: `${fmtMoney(m.pipeline)} open`, alert: false },
    { id: "media", icon: "▶", title: "Media Lab", stat: `${videoRequests.length} ready`, sub: "video requests & generation", alert: false },
    { id: "sites", icon: "▦", title: "Site & Store Studio", stat: `${pages.length} builds`, sub: pages.some((p) => p.status === "publish-ready") ? "1+ publish-ready" : "drafting", alert: false },
    { id: "reviews", icon: "★", title: "Review Desk", stat: `${revs.length} in pipe`, sub: "request → publish", alert: false },
    { id: "bookings", icon: "◷", title: "Bookings", stat: `${bks.length} pending`, sub: "drafts & confirmations", alert: false },
    { id: "protect", icon: "⬡", title: "Run Security Check", stat: sec ? (sec.posture === "clean" ? "clean" : "attention") : "—", sub: sec ? `next scan ${daysUntil(sec.nextScan)}d` : "", alert: sec?.posture !== "clean" },
    { id: "money", icon: "◈", title: "Money", stat: fmtMoney(m.pipeline), sub: `${fmtMoney(m.retainerMonthly)}/mo retainers`, alert: false },
    { id: "workforce", icon: "⬢", title: "Workers", stat: `${activeTools || activeAgents} active`, sub: isAdmin() ? "bots · humans · subagents" : "on your account", alert: false },
    { id: "approvals", icon: "✓", title: "Approvals", stat: `${pend.length} waiting`, sub: pend.length ? "needs your call" : "queue clear", alert: pend.length > 0 },
  ];
  if (isAdmin()) w.push({ id: "adminos", icon: "⌘", title: "PhantomOps", stat: "operator", sub: "workspaces · lanes · access", alert: false });
  return w;
}
