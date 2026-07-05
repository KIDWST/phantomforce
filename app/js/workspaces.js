/* PhantomForce Phantom — workspace surfaces.
   Every widget on the mission grid opens one of these as a focused overlay
   above the dashboard. Registry-driven so the grid can scale to hundreds
   of widgets without changing the shell. */

import {
  store, uid, visible, isAdmin, currentWs, wsName, pushActivity, resolveApproval,
  moneyView, fmtMoney, fmtDate, fmtDateTime, ago, daysUntil, statusLabel,
  PACKAGES, RETAINERS,
} from "./store.js?v=phantom-live-20260705-14";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const chip = (status) => `<span class="chip chip-${esc(status)}">${esc(statusLabel(status))}</span>`;
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
const empty = (msg) => `<div class="ws-empty">${esc(msg)}</div>`;
const wsTag = (id) => (isAdmin() && currentWs() === "phantomforce") ? `<span class="ws-tag">${esc(wsName(id))}</span>` : "";

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
      <p class="ws-note">Controlled creative generation: brief → approval → generation → proof → delivery. Paid generation never runs without sign-off.</p>
      <button class="btn btn-primary" data-act="add">+ Video brief</button>
    </div>
    <div class="card-grid">
      ${media.map((m) => `
        <article class="record">
          <div class="record-top">${wsTag(m.ws)}<h4>${esc(m.title)}</h4></div>
          <p class="record-sub">${esc(m.type)} · ${chip(m.status)} · ${ago(m.updated)}</p>
          <p class="record-notes"><b>Angle:</b> ${esc(m.angle)}</p>
          <details class="shotlist"><summary>Shot list (${m.shots.length})</summary>
            <ol>${m.shots.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          </details>
          <p class="record-notes"><b>Caption:</b> ${esc(m.caption)}</p>
          ${m.proof ? `<p class="record-proof">Proof: <code>${esc(m.proof)}</code></p>` : ""}
          <div class="record-actions">
            <button class="btn" data-act="copy" data-id="${m.id}">Copy brief</button>
            ${m.status === "draft" ? `<button class="btn btn-good" data-act="ready" data-id="${m.id}">Mark brief ready</button>` : ""}
            ${m.status === "brief-ready" && isAdmin() ? `<button class="btn" data-act="request-gen" data-id="${m.id}">Request generation (approval)</button>` : ""}
            ${m.status === "generation-approved" ? `<button class="btn" data-act="delivered" data-id="${m.id}">Mark delivered</button>` : ""}
          </div>
        </article>`).join("") || empty("Media Lab is quiet. Ask Phantom AI for a video brief to get rolling.")}
    </div>`;
  const find = (id) => store.state.media.find((m) => m.id === id);
  bindActions(el, {
    add: () => {
      const t = prompt("What is this creative for? (client / campaign)");
      if (!t) return;
      store.state.media.unshift({ id: uid("med"), ws: currentWs() === "phantomforce" ? "chicagoshots" : currentWs(), title: `${t.trim()} — video brief`, type: "Reel (vertical, 30s)", status: "draft", angle: "Hook in 2 seconds, one idea, end on the offer.", shots: ["Opening hook shot", "Detail pass", "People / reaction", "Offer card", "Logo sting"], caption: `${t.trim()} — draft caption.`, proof: null, updated: new Date().toISOString() });
      pushActivity("Media Factory", `drafted a brief: ${t.trim()}.`);
      store.save(); rerender();
    },
    copy: (id, btn) => { const m = find(id); copyText(btn, `${m.title}\n${m.type}\n\nAngle: ${m.angle}\n\nShots:\n${m.shots.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nCaption: ${m.caption}`); },
    ready: (id) => { const m = find(id); m.status = "brief-ready"; m.updated = new Date().toISOString(); pushActivity("Media Factory", `brief ready: ${m.title}.`, m.ws); store.save(); rerender(); },
    "request-gen": (id) => {
      const m = find(id);
      store.state.approvals.unshift({ id: uid("app"), ws: m.ws, type: "media-generation", title: `Run paid generation: ${m.title}`, detail: "One generation pass on this brief. Uses paid credits — approval required.", ref: m.id, status: "pending", requestedBy: "Media Factory", at: new Date().toISOString() });
      pushActivity("Media Factory", `requested a generation pass on ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    delivered: (id) => { const m = find(id); m.status = "delivered"; m.updated = new Date().toISOString(); pushActivity("Delivery Manager", `delivered ${m.title}.`, m.ws); store.save(); rerender(); },
  });
}

/* ========================= SITE + STORE STUDIO ========================= */
function renderSites(el, rerender) {
  const sites = visible(store.state.sites);
  const products = visible(store.state.products);
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Pages and stores are built as drafts with a publish-readiness state. Checkout shows as “not wired” until a payment connector exists — no fake live claims.</p>
      <span><button class="btn btn-primary" data-act="add-page">+ Page draft</button> <button class="btn btn-primary" data-act="add-store">+ Store draft</button></span>
    </div>
    <h3 class="ws-subhead">Pages & stores</h3>
    <div class="card-grid">
      ${sites.map((s) => `
        <article class="record">
          <div class="record-top">${wsTag(s.ws)}<h4>${esc(s.title)}</h4></div>
          <p class="record-sub">${esc(s.kind)} · ${chip(s.status)} · ${ago(s.updated)}</p>
          <div class="page-preview">${s.sections.map((x) => `<div class="page-preview-row">${esc(x)}</div>`).join("")}</div>
          ${s.url ? `<p class="record-proof">Target: <code>${esc(s.url)}</code></p>` : ""}
          <div class="record-actions">
            ${s.status === "draft" ? `<button class="btn btn-good" data-act="ready" data-id="${s.id}">Mark publish-ready</button>` : ""}
            ${s.status === "publish-ready" && isAdmin() ? `<button class="btn" data-act="queue" data-id="${s.id}">Queue publish approval</button>` : ""}
            ${s.status === "approved-to-publish" ? `<span class="hint-inline">Approved — goes live when the publish connector runs.</span>` : ""}
            <button class="btn btn-quiet" data-act="section" data-id="${s.id}">+ Section</button>
          </div>
        </article>`).join("") || empty("No page drafts yet.")}
    </div>
    <h3 class="ws-subhead">Store catalog</h3>
    <div class="card-grid">
      ${products.map((p) => `
        <article class="record">
          <div class="record-top">${wsTag(p.ws)}<h4>${esc(p.name)}</h4><b class="record-price">${fmtMoney(p.price)}</b></div>
          <p class="record-sub">${esc(p.category)} · publish: ${chip(p.publish)} · checkout: ${chip(p.checkout)}</p>
          <div class="product-thumb" aria-hidden="true">▨ asset placeholder</div>
          <p class="record-notes">${esc(p.desc)}</p>
          <p class="record-sub">Fulfillment: ${esc(p.fulfillment)}</p>
          <div class="record-actions">
            ${p.publish === "draft" ? `<button class="btn btn-good" data-act="pub-ready" data-id="${p.id}">Mark publish-ready</button>` : ""}
          </div>
        </article>`).join("")}
      <article class="record record-ghostcard">
        <h4>+ Add product or service</h4>
        <div class="mini-form">
          <input type="text" data-prod-name placeholder="Name — e.g. Gym tee, Listing video" />
          <input type="number" data-prod-price placeholder="Price" min="0" />
          <input type="text" data-prod-cat placeholder="Category — Merch / Service / Classes" />
          <textarea data-prod-desc placeholder="Short description" rows="2"></textarea>
          <button class="btn btn-primary" data-act="add-prod">Add to catalog</button>
        </div>
      </article>
    </div>`;
  bindActions(el, {
    "add-page": () => {
      const t = prompt("Page for which client / purpose?");
      if (!t) return;
      store.state.sites.unshift({ id: uid("site"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), title: `${t.trim()} — landing page`, kind: "Landing page", status: "draft", sections: ["Hero with one clear promise", "Proof / reviews section", "Offer + pricing", "Call-to-action (approval-gated)"], url: null, updated: new Date().toISOString() });
      pushActivity("Site Builder", `drafted a landing page for ${t.trim()}.`);
      store.save(); rerender();
    },
    "add-store": () => {
      const t = prompt("Store for which client / brand?");
      if (!t) return;
      store.state.sites.unshift({ id: uid("site"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), title: `${t.trim()} — store`, kind: "Store", status: "draft", sections: ["Storefront hero", "Product grid", "Offer section", "Checkout — payment connector not wired yet"], url: null, updated: new Date().toISOString() });
      pushActivity("Store Builder", `drafted a storefront for ${t.trim()}.`);
      store.save(); rerender();
    },
    ready: (id) => { const s = store.state.sites.find((x) => x.id === id); s.status = "publish-ready"; s.updated = new Date().toISOString(); pushActivity("Site Builder", `${s.title} is publish-ready.`, s.ws); store.save(); rerender(); },
    queue: (id) => {
      const s = store.state.sites.find((x) => x.id === id);
      store.state.approvals.unshift({ id: uid("app"), ws: s.ws, type: "publish-page", title: `Publish ${s.title}`, detail: "Reviewed draft. Publishing makes it live.", ref: s.id, status: "pending", requestedBy: "Site Builder", at: new Date().toISOString() });
      pushActivity("Site Builder", `queued publish approval for ${s.title}.`, s.ws);
      store.save(); rerender();
    },
    section: (id) => {
      const s = store.state.sites.find((x) => x.id === id);
      const sec = prompt("New section:");
      if (!sec) return;
      s.sections.push(sec.trim()); s.updated = new Date().toISOString();
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
          <p class="record-sub">${esc(tool.worker)} · internal: ${esc(tool.internal)}</p>
          <p class="record-next">▸ ${esc(tool.role)}</p>
          <p class="record-notes"><b>Role:</b> ${esc(tool.role)}</p>
          <div class="tool-meta">
            <span>${esc(statusLabel(tool.mode))}</span>
            <span>${esc(tool.path)}</span>
          </div>
        </article>`).join("") || empty("No security scans have been run yet. Connect a scanner or start a real check before Phantom reports posture.")}
    </div>`;
}

/* ============================= WORKFORCE ============================= */
function renderWorkforce(el, rerender) {
  const agents = store.state.agents;
  if (!isAdmin()) {
    const active = agents.filter((a) => a.status === "active").length;
    const inflight = visible(store.state.media).filter((x) => x.status !== "delivered").length + visible(store.state.sites).filter((x) => x.status === "draft").length;
    el.innerHTML = `
      <div class="stat-row">
        <div class="stat"><span>Workers on your account</span><b>${active}</b><i>active right now</i></div>
        <div class="stat"><span>Deliverables in progress</span><b>${inflight}</b><i>moving through the pipeline</i></div>
        <div class="stat"><span>Approvals waiting</span><b>${visible(store.state.approvals).filter((a) => a.status === "pending").length}</b><i>real queue only</i></div>
      </div>
      <h3 class="ws-subhead">What's happening</h3>
      <div class="stack">
        ${visible(store.state.activity).slice(0, 8).map((a) => `<article class="record record-row"><h4>${esc(a.who)}</h4><p class="record-sub">${esc(a.text)}</p><i class="record-time">${ago(a.at)}</i></article>`).join("") || empty("Quiet right now.")}
      </div>
      <p class="ws-note">New accounts start empty. Real activity appears here after your team creates work.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="ws-toolbar"><p class="ws-note">Your AI workforce, desk by desk. Statuses: active · idle · waiting · blocked · needs approval.</p></div>
    <div class="card-grid">
      ${agents.map((a) => `
        <article class="record agent-card agent-${esc(a.status)}">
          <div class="record-top"><h4><span class="agent-dot"></span>${esc(a.name)}</h4>${chip(a.status === "needs-approval" ? "pending" : a.status)}</div>
          <p class="record-sub">${esc(a.role)}</p>
          <p class="record-next">▸ ${esc(a.mission)}</p>
          <div class="agent-stats">
            <span><b>${a.d1}</b> 24h</span><span><b>${a.d7}</b> 7d</span><span><b>${a.d30}</b> 30d</span>
            <span><b>${esc(a.tokens)}</b> tokens</span><span><b>${esc(a.cost)}</b> cost</span>
          </div>
          <p class="record-notes"><b>Last output:</b> ${esc(a.last)}</p>
          ${a.next && a.next !== "—" ? `<p class="record-notes"><b>Next:</b> ${esc(a.next)}</p>` : ""}
          <p class="agent-bundle">internal lane: ${esc(a.bundle)}</p>
        </article>`).join("") || empty("No workers have produced real activity yet. Connect a tool or create the first task to populate this board.")}
    </div>
    <h3 class="ws-subhead">Tool spine powering the workers</h3>
    <p class="ws-note">These are the internal programs behind the desks. Employees see only the outcomes they are allowed to access.</p>
    ${renderToolSpineCards({ compact: true })}`;
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
    ["Automation lane", "standby", "workflow runner configured, not armed"],
    ["Media generation lane", "gated", "paid — every run needs approval"],
    ["Private access gateway", "active", "admin + employee hosts enforced upstream"],
  ];
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Deep controls, diagnostics, and provider readiness. None of this surfaces to employees unless you grant access.</p>
    </div>
    <h3 class="ws-subhead">Active tool spine</h3>
    <p class="ws-note">Every tool is mapped to a worker lane. “Active” means visible and available to PhantomOps; external actions still require the right connector and approval.</p>
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
    <h3 class="ws-subhead">Internal lanes (hidden from employees by default)</h3>
    <div class="card-grid">
      ${lanes.map(([name, state, note]) => `
        <article class="record"><div class="record-top"><h4>${esc(name)}</h4>${chip(state === "ready" || state === "active" ? "approved" : "pending")}</div>
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
  workforce: { title: "Workforce", kicker: "Your AI team", render: renderWorkforce },
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
  const briefs = visible(store.state.media).filter((x) => ["brief-ready", "generation-approved"].includes(x.status));
  const pages = visible(store.state.sites);
  const sec = visible(store.state.security)[0];
  const revs = visible(store.state.reviews).filter((r) => r.status !== "published-ready");
  const bks = visible(store.state.bookings).filter((b) => b.status !== "confirmed");
  const activeAgents = store.state.agents.filter((a) => a.status === "active").length;
  const activeTools = (store.state.toolSpine || []).filter((tool) => ["active", "standby", "gated", "sandbox"].includes(tool.mode)).length;

  const w = [
    { id: "leads", icon: "◉", title: "Handle Leads", stat: `${openLeads.length} open`, sub: dueLeads.length ? `${dueLeads.length} due today` : "pipeline current", alert: dueLeads.length > 0 },
    { id: "proposals", icon: "◆", title: "Build Quotes", stat: `${m.open.length} live`, sub: `${fmtMoney(m.pipeline)} open`, alert: false },
    { id: "media", icon: "▶", title: "Media Lab", stat: `${briefs.length} ready`, sub: "briefs & generation", alert: false },
    { id: "sites", icon: "▦", title: "Site & Store Studio", stat: `${pages.length} builds`, sub: pages.some((p) => p.status === "publish-ready") ? "1+ publish-ready" : "drafting", alert: false },
    { id: "reviews", icon: "★", title: "Review Desk", stat: `${revs.length} in pipe`, sub: "request → publish", alert: false },
    { id: "bookings", icon: "◷", title: "Bookings", stat: `${bks.length} pending`, sub: "drafts & confirmations", alert: false },
    { id: "protect", icon: "⬡", title: "Run Security Check", stat: sec ? (sec.posture === "clean" ? "clean" : "attention") : "—", sub: sec ? `next scan ${daysUntil(sec.nextScan)}d` : "", alert: sec?.posture !== "clean" },
    { id: "money", icon: "◈", title: "Money", stat: fmtMoney(m.pipeline), sub: `${fmtMoney(m.retainerMonthly)}/mo retainers`, alert: false },
    { id: "workforce", icon: "⬢", title: "Workforce", stat: `${activeAgents} agents`, sub: isAdmin() ? `${activeTools} tools mapped` : "on your account", alert: false },
    { id: "approvals", icon: "✓", title: "Approvals", stat: `${pend.length} waiting`, sub: pend.length ? "needs your call" : "queue clear", alert: pend.length > 0 },
  ];
  if (isAdmin()) w.push({ id: "adminos", icon: "⌘", title: "PhantomOps", stat: "operator", sub: "workspaces · lanes · access", alert: false });
  return w;
}
