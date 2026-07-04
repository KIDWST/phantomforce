/* PhantomForce Phantom — workspace surfaces.
   Every widget on the mission grid opens one of these as a focused overlay
   above the dashboard. Registry-driven so the grid can scale to hundreds
   of widgets without changing the shell. */

import {
  store, uid, session, visible, isAdmin, currentWs, wsName, pushActivity, pushToolPulse, resolveApproval,
  moneyView, fmtMoney, fmtDate, fmtDateTime, ago, daysUntil, statusLabel, executionMode,
  PACKAGES, RETAINERS,
} from "./store.js?v=phantom-mobile-chat-ux-20260704-01";
import {
  IMAGE_CROPS, IMAGE_FILTERS, downloadImage, editImageArtifact, imageStyle, makeImageArtifact,
} from "./media-image.js?v=phantom-mobile-chat-ux-20260704-01";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const chip = (status) => `<span class="chip chip-${esc(status)}">${esc(statusLabel(status))}</span>`;
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
const empty = (msg) => `<div class="ws-empty">${esc(msg)}</div>`;
const wsTag = (id) => (isAdmin() && currentWs() === "phantomforce") ? `<span class="ws-tag">${esc(wsName(id))}</span>` : "";
const imageFilterButtons = (asset = {}) => Object.keys(IMAGE_FILTERS).map((name) => (
  `<button class="mini-pill ${asset.filter === name ? "is-on" : ""}" data-act="image-filter" data-id="${asset.id || ""}" data-filter="${name}">${esc(name)}</button>`
)).join("");
const imageCropButtons = (asset = {}) => Object.keys(IMAGE_CROPS).map((name) => (
  `<button class="mini-pill ${asset.crop === name ? "is-on" : ""}" data-act="image-crop" data-id="${asset.id || ""}" data-crop="${name}">${esc(name)}</button>`
)).join("");
const connectorStateClass = (state = "") => `connector-${String(state).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

function imageToolchainFallbackHtml() {
  const connectors = [
    ["Prompt image draft", "active", "Visible image appears in chat and Media Lab."],
    ["Crop + PNG export", "active", "1:1, 4:5, 9:16, 16:9 saved from the editor."],
    ["Creative looks", "active", "Studio, punch, cinematic, neon, clean, mono."],
    ["Variant maker", "active", "Duplicate and re-seed concepts locally."],
    ["Local CLI stack", "check", "Load admin status for rembg, ffmpeg, ImageMagick, Python, GIF, WebP, upscale tools."],
    ["Provider bridge", "gated", "Paid generation remains separate and explicit."],
  ];
  return `
    <div class="image-tool-grid">
      ${connectors.map(([label, state, role]) => `
        <article class="image-tool ${connectorStateClass(state)}">
          <span>${esc(state)}</span>
          <b>${esc(label)}</b>
          <p>${esc(role)}</p>
        </article>
      `).join("")}
    </div>`;
}

function renderImageToolchainPayload(payload) {
  const stack = payload?.image_toolchain;
  if (!stack) return empty("Image stack status is unavailable.");
  const connectors = stack.connectors || [];
  const summary = stack.summary || {};
  return `
    <div class="image-tool-summary">
      <div><span>Total</span><b>${esc(summary.connectors_total ?? summary.visible_connectors ?? connectors.length)}</b></div>
      <div><span>Ready</span><b>${esc(summary.active_or_available ?? 0)}</b></div>
      <div><span>Local CLIs</span><b>${esc(summary.local_cli_available ?? "redacted")}</b></div>
      <div><span>Paid calls</span><b>${stack.safety_flags?.paid_job_called ? "ran" : "off"}</b></div>
    </div>
    <div class="image-tool-grid">
      ${connectors.map((tool) => `
        <article class="image-tool ${connectorStateClass(tool.state)}">
          <span>${esc(tool.state)}</span>
          <b>${esc(tool.label)}</b>
          <p>${esc(tool.role)}</p>
          ${tool.detected_path ? `<code>${esc(tool.detected_path)}</code>` : ""}
          ${tool.capabilities?.length ? `<small>${tool.capabilities.map(esc).join(" · ")}</small>` : ""}
        </article>
      `).join("")}
    </div>
    <p class="ws-note">Status only. No paid provider, upload, external send, or destructive action ran.</p>`;
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

function authHeaders() {
  const token = session.token();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderOwnerMemoryPayload(payload) {
  const memory = payload?.owner_memory;
  if (!memory) return `<div class="ws-empty">Owner memory status unavailable.</div>`;
  const sources = memory.sources || {};
  const sourceCards = Object.entries(sources).map(([key, source]) => `
    <article class="record">
      <div class="record-top"><h4>${esc(key.replaceAll("_", " "))}</h4>${chip(source.exists ? "approved" : "paused")}</div>
      <p class="record-sub">${esc(source.purpose || "")}</p>
      <p class="record-notes"><b>Path:</b> ${esc(source.path || "not configured")}</p>
      <p class="record-notes"><b>Bytes:</b> ${esc(source.bytes ?? 0)}</p>
    </article>`).join("");
  const artifacts = (memory.artifacts || []).slice(0, 12).map((artifact) => `
    <article class="record record-row">
      <h4>${esc(artifact.path)}</h4>
      <p class="record-sub">${esc(artifact.source)} · ${esc(artifact.bytes)} bytes</p>
      ${artifact.match_snippet ? `<p class="record-notes">${esc(artifact.match_snippet)}</p>` : ""}
    </article>`).join("");
  const receipts = (memory.recent_hermes_records || []).slice(0, 6).map((record) => `
    <article class="record record-row">
      <h4>${esc(record.tenant_id)} · ${esc(record.task_type)}</h4>
      <p class="record-sub">${esc(record.actor_user_id)} · ${esc(record.model_id)} · ${esc(record.estimated_tokens)} tokens</p>
      <p class="record-notes">${esc(record.result_summary || record.user_request_summary || "")}</p>
    </article>`).join("");

  return `
    <div class="stat-row">
      <div class="stat"><span>Owner tenant</span><b>${esc(memory.access_model.owner_default_tenant_id)}</b><i>Jordan/admin default</i></div>
      <div class="stat"><span>Raw operator internals</span><b>${memory.access_model.raw_operator_internal_memory_exposed ? "exposed" : "private"}</b><i>local artifacts only</i></div>
      <div class="stat"><span>Artifacts</span><b>${(memory.artifacts || []).length}</b><i>${memory.query ? `query: ${esc(memory.query)}` : "latest indexed"}</i></div>
      <div class="stat"><span>Clients</span><b>isolated</b><i>tenant-only memory</i></div>
    </div>
    <h4 class="ws-subhead">Sources</h4>
    <div class="card-grid">${sourceCards}</div>
    <h4 class="ws-subhead">Artifact matches</h4>
    <div class="stack">${artifacts || empty("No local owner-memory artifacts matched this search.")}</div>
    <h4 class="ws-subhead">Recent memory receipts</h4>
    <div class="stack">${receipts || empty("No memory receipts found yet.")}</div>
    <p class="ws-note">Safety: admin-only, local files only, redacted, no provider call, no upload/send.</p>`;
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
      <p class="ws-note">Image and video creation live here. Image prompts now create visible editable drafts: crop, tune, background pass, variants, save, and download.</p>
      <button class="btn btn-primary" data-act="add">+ Creative brief</button>
    </div>
    <section class="image-stack-panel">
      <div class="record-top">
        <div>
          <p class="ws-mini-kicker">Media Lab guts</p>
          <h4>Image power stack</h4>
        </div>
        <button class="btn" data-act="load-image-toolchain">Load local stack</button>
      </div>
      <p class="record-notes">Phantom can keep adding tools here without turning the chat into a tool menu. Browser edits run now; local CLI and provider bridges report their readiness separately.</p>
      <div data-image-toolchain-result>${imageToolchainFallbackHtml()}</div>
    </section>
    <div class="card-grid">
      ${media.map((m) => `
        <article class="record ${m.asset?.src ? "record-image" : ""}">
          <div class="record-top">${wsTag(m.ws)}<h4>${esc(m.title)}</h4></div>
          <p class="record-sub">${esc(m.type)} · ${esc(m.modality || "video")} · ${chip(m.status)} · ${ago(m.updated)}</p>
          ${m.asset?.src ? `
            <figure class="media-image-stage ${m.asset.bgRemoved ? "is-bg-removed" : ""}" style="${imageStyle(m.asset)}">
              <img src="${m.asset.src}" alt="${esc(m.title)}" loading="lazy">
            </figure>
            <div class="image-edit-strip">
              <div><b>Crop</b>${imageCropButtons({ ...m.asset, id: m.id })}</div>
              <div><b>Tweak</b>${imageFilterButtons({ ...m.asset, id: m.id })}</div>
            </div>
            <p class="record-notes"><b>Image chain:</b> local generator · canvas/SVG editor · rembg-ready background removal · variant saver.</p>
          ` : ""}
          <p class="record-notes"><b>Angle:</b> ${esc(m.angle)}</p>
          <details class="shotlist"><summary>${m.asset?.src ? "Creative recipe" : "Shot list"} (${(m.shots || []).length})</summary>
            <ol>${(m.shots || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          </details>
          <p class="record-notes"><b>Caption:</b> ${esc(m.caption)}</p>
          ${m.proof ? `<p class="record-proof">Proof: <code>${esc(m.proof)}</code></p>` : ""}
          <div class="record-actions">
            <button class="btn" data-act="copy" data-id="${m.id}">Copy brief</button>
            ${m.asset?.src ? `<button class="btn btn-good" data-act="save-image" data-id="${m.id}">Save image</button>
              <button class="btn" data-act="bg-remove" data-id="${m.id}">${m.asset.bgRemoved ? "Restore BG" : "Remove BG"}</button>
              <button class="btn" data-act="variant" data-id="${m.id}">Duplicate variant</button>
              <button class="btn btn-quiet" data-act="download-image" data-id="${m.id}">Download</button>` : ""}
            ${m.status === "draft" ? `<button class="btn btn-good" data-act="ready" data-id="${m.id}">Mark brief ready</button>` : ""}
            ${m.status === "brief-ready" && isAdmin() ? `<button class="btn" data-act="request-gen" data-id="${m.id}">Request ${esc(m.modality || "video")} generation</button>` : ""}
            ${m.status === "generation-approved" ? `<button class="btn" data-act="delivered" data-id="${m.id}">Mark delivered</button>` : ""}
          </div>
        </article>`).join("") || empty("Media Lab is quiet. Ask Phantom for an image, video, ad creative, or source analysis.")}
    </div>`;
  const find = (id) => store.state.media.find((m) => m.id === id);
  bindActions(el, {
    add: () => {
      const t = prompt("What is this creative for? (client / campaign)");
      if (!t) return;
      store.state.media.unshift({ id: uid("med"), ws: currentWs() === "phantomforce" ? "chicagoshots" : currentWs(), title: `${t.trim()} — creative brief`, type: "Image/video creative", modality: "video", status: "draft", angle: "Hook in 2 seconds, one idea, end on the offer.", shots: ["Opening hook", "Visual proof", "Offer moment", "Platform crop", "Delivery version"], caption: `${t.trim()} — draft caption.`, proof: null, generationProvider: "Media Lab", updated: new Date().toISOString() });
      pushActivity("Media Factory", `drafted a brief: ${t.trim()}.`);
      store.save(); rerender();
    },
    "load-image-toolchain": async (_id, btn) => {
      const result = el.querySelector("[data-image-toolchain-result]");
      if (!result) return;
      const prev = btn.textContent;
      btn.textContent = "Loading...";
      result.innerHTML = empty("Checking local image stack...");
      try {
        const response = await fetch("/phantom-ai/media-lab/image-toolchain/status", { headers: authHeaders() });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          result.innerHTML = empty(payload?.error || "Image stack requires signed-in backend access.");
        } else {
          result.innerHTML = renderImageToolchainPayload(payload);
          pushActivity("Image Creator", "refreshed Media Lab image stack status.");
          store.save();
        }
      } catch (error) {
        result.innerHTML = empty(`Image stack could not load: ${error?.message || "request failed"}`);
      } finally {
        btn.textContent = prev;
      }
    },
    copy: (id, btn) => { const m = find(id); copyText(btn, `${m.title}\n${m.type}\n\nAngle: ${m.angle}\n\nRecipe:\n${(m.shots || []).map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nCaption: ${m.caption}${m.asset?.prompt ? `\n\nPrompt: ${m.asset.prompt}` : ""}`); },
    "image-filter": (id, btn) => {
      const m = find(id);
      if (!m?.asset) return;
      m.asset = editImageArtifact(m.asset, { filter: btn.dataset.filter, label: `filter:${btn.dataset.filter}` });
      m.updated = new Date().toISOString();
      pushActivity("Image Creator", `applied ${btn.dataset.filter} look to ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    "image-crop": (id, btn) => {
      const m = find(id);
      if (!m?.asset) return;
      m.asset = editImageArtifact(m.asset, { crop: btn.dataset.crop, label: `crop:${btn.dataset.crop}` });
      m.updated = new Date().toISOString();
      pushActivity("Image Creator", `set ${btn.dataset.crop} crop for ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    "bg-remove": (id) => {
      const m = find(id);
      if (!m?.asset) return;
      m.asset = editImageArtifact(m.asset, { bgRemoved: !m.asset.bgRemoved, label: m.asset.bgRemoved ? "restore-background" : "background-removal-preview" });
      m.updated = new Date().toISOString();
      pushActivity("Image Creator", `${m.asset.bgRemoved ? "previewed background removal" : "restored background"} for ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    "save-image": (id) => {
      const m = find(id);
      if (!m?.asset) return;
      m.status = "asset-saved";
      m.proof = `Saved in Media Lab · ${m.asset.crop || "1:1"} · ${m.asset.filter || "studio"} · ${m.asset.bgRemoved ? "bg pass" : "full bg"}`;
      m.updated = new Date().toISOString();
      pushActivity("Image Creator", `saved image asset: ${m.title}.`, m.ws);
      store.save(); rerender();
    },
    variant: (id) => {
      const m = find(id);
      if (!m?.asset) return;
      const prompt = `${m.asset.prompt || m.title} alternate premium variant`;
      const variant = {
        ...m,
        id: uid("med"),
        title: `${m.title.replace(/\s+variant\s+\d+$/i, "")} variant`,
        status: "image-ready",
        asset: editImageArtifact(makeImageArtifact(prompt, `${m.title} variant`, { crop: m.asset.crop, filter: m.asset.filter }), { label: "variant-generated" }),
        proof: null,
        updated: new Date().toISOString(),
      };
      store.state.media.unshift(variant);
      pushActivity("Image Creator", `created image variant: ${variant.title}.`, variant.ws);
      store.save(); rerender();
    },
    "download-image": (id) => {
      const m = find(id);
      if (m?.asset) downloadImage(m.asset, m.title);
    },
    ready: (id) => { const m = find(id); m.status = "brief-ready"; m.updated = new Date().toISOString(); pushActivity("Media Factory", `brief ready: ${m.title}.`, m.ws); store.save(); rerender(); },
    "request-gen": (id) => {
      const m = find(id);
      store.state.approvals.unshift({ id: uid("app"), ws: m.ws, type: "media-generation", title: `Run ${m.modality || "video"} generation: ${m.title}`, detail: "One controlled generation pass on this brief. Paid provider credits require approval.", ref: m.id, status: "pending", requestedBy: "Media Factory", at: new Date().toISOString() });
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
      store.state.sites.unshift({ id: uid("site"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(), title: `${t.trim()} — landing page`, kind: "Landing page", status: "draft", sections: ["Hero with one clear promise", "Proof / reviews section", "Offer + pricing", "Call-to-action receipt lane"], url: null, updated: new Date().toISOString() });
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
    ${secs.length ? `<div class="card-grid">
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
            <button class="btn btn-quiet" data-act="summary" data-id="${s.id}">Copy client-safe summary</button>
          </div>
        </article>`).join("")}
    </div>` : empty("No scan proof yet. This workspace starts clean until a scan is run or imported.")}`;
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
    </ul>` : empty("No money actions yet. Quotes, wins, and invoices appear here after this workspace starts using Phantom.")}
    <p class="ws-note">Quote → approval → invoice-ready → payment-tracked. Real invoices and payment requests stay off until a payment connector is configured.</p>`;
}

/* ============================= TOOL SPINE ============================= */
function renderToolSpineCards({ compact = false } = {}) {
  const tools = store.state.toolSpine || [];
  return `
    <div class="${compact ? "tool-spine-compact" : "tool-spine-grid"}">
      ${tools.map((tool) => `
        <details class="record tool-card tool-mode-${esc(tool.mode)}">
          <summary class="tool-summary">
            <span>
              <b><span class="agent-dot"></span>${esc(tool.name)}</b>
              <i>${esc(tool.status)}</i>
            </span>
            <span class="chip chip-${esc(tool.status)}">${esc(statusLabel(tool.status))}</span>
          </summary>
          <p class="record-sub">Role: ${esc(tool.worker)}</p>
          <p class="record-next">▸ ${esc(tool.role)}</p>
          <p class="record-notes"><b>Doing now:</b> ${esc(tool.activity)}</p>
          <div class="tool-meta">
            <span>${esc(statusLabel(tool.mode))}</span>
            <span>${esc(statusLabel(tool.status))}</span>
          </div>
        </details>`).join("")}
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
        <div class="stat"><span>Service systems available</span><b>${active}</b><i>Phantom modules, not employees or user accounts</i></div>
        <div class="stat"><span>Deliverables in progress</span><b>${inflight}</b><i>moving through the pipeline</i></div>
        <div class="stat"><span>Confidence</span><b>●●●●○</b><i>on schedule</i></div>
      </div>
      <h3 class="ws-subhead">What's happening</h3>
      <div class="stack">
        ${visible(store.state.activity).slice(0, 8).map((a) => `<article class="record record-row"><h4>${esc(a.who)}</h4><p class="record-sub">${esc(a.text)}</p><i class="record-time">${ago(a.at)}</i></article>`).join("") || empty("Quiet right now.")}
      </div>
      <p class="ws-note">Next step: check Approvals for anything waiting on you.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="ws-toolbar"><p class="ws-note">Your Phantom systems. These are business capabilities, not employees or user accounts.</p></div>
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
          <p class="agent-bundle">${esc(a.bundle)}</p>
        </article>`).join("")}
    </div>
    <h3 class="ws-subhead">Private systems</h3>
    <p class="ws-note">Admin-only. Clients see outcomes, not internal programs.</p>
    ${renderToolSpineCards({ compact: true })}`;
}

/* ============================= APPROVALS ============================= */
function renderApprovals(el, rerender) {
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending");
  const done = visible(store.state.approvals).filter((a) => a.status !== "pending").slice(0, 6);
  el.innerHTML = `
    <div class="ws-toolbar"><p class="ws-note">Only outward-facing moves land here: sends, bookings, Drive files, publishing, paid generation, invoices, deploys. Drafting never waits on you.</p></div>
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
    </div>` : empty("Queue is clear. Everything else is moving on its own.")}
    ${done.length ? `<h3 class="ws-subhead">Recent decisions</h3><div class="stack">
      ${done.map((a) => `<article class="record record-row">${wsTag(a.ws)}<h4>${esc(a.title)}</h4>${chip(a.status)}</article>`).join("")}
    </div>` : ""}`;
  bindActions(el, {
    approve: (id) => { resolveApproval(id, true); rerender(); },
    decline: (id) => { resolveApproval(id, false); rerender(); },
  });
}

/* ========================= LIVING COMMAND MAP ========================= */
const MAP_W = 1000;
const MAP_H = 560;
let selectedLivingNodeId = "phantom";

const mapStatusLabels = {
  active: "Active",
  ready: "Ready",
  gated: "Controlled",
  manual: "Manual",
  planned: "Planned",
  needs_review: "Needs review",
  blocked: "Paused",
};

function edgePath(from, to, sag = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 48) {
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + dy * 0.4}, ${to.x} ${to.y - dy * 0.4}, ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} C ${from.x + dx * 0.42} ${from.y + sag}, ${to.x - dx * 0.42} ${to.y + sag}, ${to.x} ${to.y}`;
}

function nodeStatus({ count = 0, waiting = false, gated = false, planned = false, blocked = false } = {}) {
  if (blocked) return "blocked";
  if (waiting) return "needs_review";
  if (gated) return "gated";
  if (count > 0) return "active";
  if (planned) return "planned";
  return "ready";
}

function buildLivingMap() {
  const leads = visible(store.state.leads);
  const openLeads = leads.filter((l) => !["won", "lost"].includes(l.status));
  const dueLeads = leads.filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
  const proposals = visible(store.state.proposals);
  const liveProposals = proposals.filter((p) => ["draft", "sent-ready", "won", "invoice-ready"].includes(p.status));
  const media = visible(store.state.media);
  const mediaReady = media.filter((m) => ["brief-ready", "generation-approved"].includes(m.status));
  const pages = visible(store.state.sites);
  const livePages = pages.filter((p) => ["draft", "publish-ready", "approved-to-publish"].includes(p.status));
  const reviews = visible(store.state.reviews).filter((r) => r.status !== "published-ready");
  const bookings = visible(store.state.bookings).filter((b) => b.status !== "confirmed");
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending");
  const security = visible(store.state.security)[0];
  const money = moneyView();
  const activeAgents = store.state.agents.filter((a) => a.status === "active").length;
  const activeTools = (store.state.toolSpine || []).filter((tool) => tool.mode === "active").length;
  const connectors = store.state.postingConnectors || [];
  const readyConnectors = connectors.filter((c) => c.adminState === "ready" || c.state === "available").length;
  const currentName = wsName(currentWs());

  const nodes = [
    {
      id: "phantom",
      label: "Phantom",
      value: isAdmin() ? `${activeAgents} systems ready` : `${currentName} brain`,
      status: "active",
      workspace: "phantom",
      x: 500,
      y: 280,
      icon: "⌁",
      detail: "The command router. It turns one request into the right business move. Systems are Phantom capabilities, not people currently logged in.",
      inside: [
        { label: "Mode", state: isAdmin() ? executionMode.get() : "workspace" },
        { label: "Workspace", state: currentName },
        { label: "Memory", state: isAdmin() ? "owner" : "tenant" },
      ],
      safety: "Clients only see their own workspace. Admin sees all routes and controls.",
    },
    {
      id: "leads",
      label: "Follow-Up Desk",
      value: `${openLeads.length} open`,
      status: nodeStatus({ count: openLeads.length, waiting: dueLeads.length > 0 }),
      workspace: "leads",
      x: 150,
      y: 150,
      icon: "◉",
      detail: dueLeads.length ? `${dueLeads.length} lead follow-up is due now.` : "Captures leads, keeps the next follow-up clear, and feeds qualified work into quotes.",
      inside: [
        { label: "Open", state: openLeads.length },
        { label: "Due", state: dueLeads.length },
      ],
    },
    {
      id: "proposals",
      label: "Quote Forge",
      value: `${liveProposals.length} live`,
      status: nodeStatus({ count: liveProposals.length }),
      workspace: "proposals",
      x: 305,
      y: 95,
      icon: "◆",
      detail: "Builds scoped offers from the real offer ladder and moves them toward send-ready status.",
      inside: [
        { label: "Pipeline", state: fmtMoney(money.pipeline) },
        { label: "Retainers", state: fmtMoney(money.retainerMonthly) },
      ],
    },
    {
      id: "media",
      label: "Media Lab",
      value: `${mediaReady.length} ready`,
      status: nodeStatus({ count: mediaReady.length, gated: true }),
      workspace: "media",
      x: 715,
      y: 115,
      icon: "▶",
      detail: "Prepares video briefs, captions, shot lists, controlled generation, and content packages.",
      inside: [
        { label: "Briefs", state: media.length },
        { label: "Ready", state: mediaReady.length },
      ],
      safety: "Paid generation and posting stay behind receipts and configured connectors.",
    },
    {
      id: "sites",
      label: "Site + Store",
      value: `${livePages.length} builds`,
      status: nodeStatus({ count: livePages.length }),
      workspace: "sites",
      x: 870,
      y: 245,
      icon: "▦",
      detail: "Drafts pages, landing pages, product/service cards, store structure, and publish-ready site work.",
      inside: [
        { label: "Pages", state: pages.length },
        { label: "Builds", state: livePages.length },
      ],
    },
    {
      id: "protect",
      label: "Risk Radar",
      value: security ? (security.posture === "clean" ? "clean" : "attention") : "ready",
      status: nodeStatus({ count: security ? 1 : 0, waiting: security ? security.posture !== "clean" : false }),
      workspace: "protect",
      x: 845,
      y: 420,
      icon: "⬡",
      detail: "Tracks malware posture, password rotation windows, exposure checks, and proof of monthly scans.",
      inside: [
        { label: "Scan", state: security ? statusLabel(security.status || security.posture) : "fresh" },
        { label: "Cadence", state: "monthly" },
      ],
    },
    {
      id: "reviews",
      label: "Review Desk",
      value: `${reviews.length} in pipe`,
      status: nodeStatus({ count: reviews.length }),
      workspace: "reviews",
      x: 650,
      y: 475,
      icon: "★",
      detail: "Requests reviews after delivery, stages received testimonials, and queues publish approval.",
      inside: [
        { label: "Requests", state: reviews.length },
        { label: "Publish", state: "approval" },
      ],
    },
    {
      id: "bookings",
      label: "Bookings",
      value: `${bookings.length} pending`,
      status: nodeStatus({ count: bookings.length, gated: bookings.length > 0 }),
      workspace: "bookings",
      x: 360,
      y: 475,
      icon: "◷",
      detail: "Creates appointment drafts, confirmations, reschedules, and booking copy before calendar writes.",
      inside: [
        { label: "Drafts", state: bookings.length },
        { label: "Calendar", state: "controlled" },
      ],
    },
    {
      id: "money",
      label: "Money",
      value: fmtMoney(money.pipeline),
      status: nodeStatus({ count: money.open.length }),
      workspace: "money",
      x: 145,
      y: 390,
      icon: "◈",
      detail: "Shows open proposal value, wins, retainer path, and invoice-ready work without creating invoices automatically.",
      inside: [
        { label: "Won", state: fmtMoney(money.wonValue) },
        { label: "Monthly", state: fmtMoney(money.retainerMonthly) },
      ],
    },
    {
      id: "approvals",
      label: "Approvals",
      value: `${pending.length} waiting`,
      status: nodeStatus({ waiting: pending.length > 0 }),
      workspace: "approvals",
      x: 500,
      y: 360,
      icon: "✓",
      detail: "Only outward-facing actions wait here: sends, bookings, publishing, paid generation, deploys, invoices, and deletes.",
      inside: [
        { label: "Waiting", state: pending.length },
        { label: "Mode", state: executionMode.get() },
      ],
    },
    {
      id: "workforce",
      label: "Workforce",
      value: `${activeAgents} active`,
      status: "active",
      workspace: "workforce",
      x: 500,
      y: 150,
      icon: "⬢",
      detail: "The Phantom systems behind the app. You watch what each capability is doing instead of chatting with raw tools.",
      inside: [
        { label: "Systems", state: store.state.agents.length },
        { label: "Tools", state: activeTools },
      ],
    },
  ];

  if (isAdmin()) {
    nodes.push(
      {
        id: "connectors",
        label: "Connectors",
        value: `${readyConnectors}/${connectors.length} ready`,
        status: nodeStatus({ count: readyConnectors, gated: readyConnectors < connectors.length }),
        workspace: "adminos",
        x: 500,
        y: 525,
        icon: "⌬",
        detail: "Admin-only connector posture for Gmail, Calendar, Drive, YouTube, Instagram, Facebook, and TikTok.",
        inside: [
          { label: "Ready", state: readyConnectors },
          { label: "Total", state: connectors.length },
        ],
        safety: "Clients never see raw connector controls.",
      },
    );
  }

  const liveState = (id) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return "planned";
    if (node.status === "needs_review") return "gated";
    if (node.status === "active") return "live";
    if (node.status === "gated") return "gated";
    return "ready";
  };
  const edges = [
    ["phantom-workforce", "phantom", "workforce", "live", 0],
    ["phantom-leads", "phantom", "leads", liveState("leads"), -18],
    ["phantom-proposals", "phantom", "proposals", liveState("proposals"), -80],
    ["phantom-media", "phantom", "media", liveState("media"), -75],
    ["phantom-sites", "phantom", "sites", liveState("sites"), 10],
    ["phantom-protect", "phantom", "protect", liveState("protect"), 42],
    ["phantom-reviews", "phantom", "reviews", liveState("reviews"), 40],
    ["phantom-bookings", "phantom", "bookings", liveState("bookings"), 38],
    ["phantom-money", "phantom", "money", liveState("money"), 25],
    ["phantom-approvals", "phantom", "approvals", pending.length ? "gated" : "ready", 0],
    ["leads-proposals", "leads", "proposals", liveState("proposals"), 28],
    ["proposals-money", "proposals", "money", liveState("money"), 85],
    ["media-approvals", "media", "approvals", "gated", 40],
    ["sites-approvals", "sites", "approvals", "ready", -30],
    ["reviews-approvals", "reviews", "approvals", "ready", -20],
    ["bookings-approvals", "bookings", "approvals", "gated", 20],
    ["protect-approvals", "protect", "approvals", liveState("protect"), -15],
  ];
  if (isAdmin()) edges.push(["approvals-connectors", "approvals", "connectors", readyConnectors ? "ready" : "gated", 0]);

  return {
    nodes,
    edges: edges
      .map(([id, from, to, state, sag]) => ({ id, from, to, state, sag }))
      .filter((edge) => nodes.some((n) => n.id === edge.from) && nodes.some((n) => n.id === edge.to)),
    notice: pending.length
      ? `${pending.length} outward-facing move${pending.length === 1 ? "" : "s"} need review before execution.`
      : "Every business system is mapped. Click a node to open the workspace behind it.",
  };
}

export function livingMapHtml() {
  const { nodes, edges, notice } = buildLivingMap();
  if (!nodes.some((node) => node.id === selectedLivingNodeId)) selectedLivingNodeId = "phantom";
  const selected = nodes.find((node) => node.id === selectedLivingNodeId) || nodes[0];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const statuses = Object.keys(mapStatusLabels).filter((status) => nodes.some((node) => node.status === status));
  const connected = selected
    ? edges.flatMap((edge) => {
        if (edge.from !== selected.id && edge.to !== selected.id) return [];
        const other = byId.get(edge.from === selected.id ? edge.to : edge.from);
        return other ? [{ node: other, direction: edge.from === selected.id ? "out" : "in", state: edge.state }] : [];
      })
    : [];

  return `
    <section class="phantom-nervous-system brain-map" aria-label="PhantomForce living system map">
      <div class="nervous-head">
        <div>
          <span class="deck-label">Living command map</span>
          <h2>One request routes the whole business.</h2>
          <p>${esc(notice)}</p>
        </div>
        <div class="brain-legend" aria-label="Node status legend">
          ${statuses.map((status) => `<span class="status-${esc(status)}"><i></i>${esc(mapStatusLabels[status])}</span>`).join("")}
        </div>
      </div>
      <div class="brain-map-stage" role="group" aria-label="System nodes and flows">
        <svg class="brain-edges" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none" aria-hidden="true">
          ${edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return "";
            const dim = selected && edge.from !== selected.id && edge.to !== selected.id ? " dimmed" : "";
            const pathId = `living-edge-${edge.id}`;
            return `<g class="brain-edge ${esc(edge.state)}${dim}">
              <path id="${esc(pathId)}" d="${esc(edgePath(from, to, edge.sag || 0))}"></path>
              ${edge.state === "live" ? `<circle class="brain-pulse" r="3.2"><animateMotion dur="5.2s" repeatCount="indefinite"><mpath href="#${esc(pathId)}"></mpath></animateMotion></circle><circle class="brain-pulse faint" r="2.1"><animateMotion dur="5.2s" begin="-2.6s" repeatCount="indefinite"><mpath href="#${esc(pathId)}"></mpath></animateMotion></circle>` : ""}
            </g>`;
          }).join("")}
        </svg>
        ${nodes.map((node) => `
          <button class="brain-node status-${esc(node.status)}${node.id === "phantom" ? " hub" : ""}${selected?.id === node.id ? " selected" : ""}"
            style="left:${(node.x / MAP_W) * 100}%;top:${(node.y / MAP_H) * 100}%"
            type="button" data-map-node="${esc(node.id)}" title="${esc(node.detail)}">
            <span class="brain-node-icon">${esc(node.icon)}</span>
            <span class="brain-node-copy"><strong>${esc(node.label)}</strong><small>${esc(node.value)}</small></span>
            <i class="brain-node-dot" aria-hidden="true"></i>
          </button>
        `).join("")}
      </div>
      ${selected ? `
        <div class="brain-detail" aria-live="polite">
          <div class="brain-detail-head">
            <span class="brain-status-chip status-${esc(selected.status)}">${esc(mapStatusLabels[selected.status] || selected.status)}</span>
            <strong>${esc(selected.label)}</strong>
            <em>${esc(selected.value)}</em>
            <button class="brain-detail-open" type="button" data-open-ws="${esc(selected.workspace)}">Open workspace <span aria-hidden="true">→</span></button>
          </div>
          <p>${esc(selected.detail)}</p>
          ${selected.inside?.length ? `<div class="brain-detail-inside">${selected.inside.map((item) => `<span><strong>${esc(item.label)}</strong><em>${esc(item.state)}</em></span>`).join("")}</div>` : ""}
          ${connected.length ? `<div class="brain-detail-flows"><span>Flows</span>${connected.map((connection) => `<button type="button" data-map-node="${esc(connection.node.id)}">${connection.direction === "out" ? "→" : "←"} ${esc(connection.node.label)}<small>${esc(connection.state)}</small></button>`).join("")}</div>` : ""}
          ${selected.safety ? `<p class="brain-detail-safety"><span aria-hidden="true">◇</span>${esc(selected.safety)}</p>` : ""}
        </div>
      ` : ""}
    </section>`;
}

export function wireLivingMap(root, rerender) {
  root.querySelectorAll("[data-map-node]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedLivingNodeId = button.dataset.mapNode || "phantom";
      rerender();
    });
  });
}

function connectorChip(connector) {
  const state = connector.adminState || connector.state || "ready";
  return chip(state === "ready" || state === "available" ? "ready" : state);
}

function renderConnectorCards() {
  const connectors = store.state.postingConnectors || [];
  return `
    <div class="connector-grid">
      ${connectors.map((connector) => `
        <details class="record connector-card connector-${esc(connector.state)}">
          <summary class="connector-summary">
            <span>
              <b>${esc(connector.name)}</b>
              <i>${esc(connector.cadence)}</i>
            </span>
            ${connectorChip(connector)}
          </summary>
          <div class="connector-capabilities">
            ${(connector.capabilities || []).map((item) => `<span>${esc(item)}</span>`).join("")}
          </div>
          <p class="record-sub">${esc(connector.access)} · ${esc(connector.next)}</p>
          <div class="tool-meta"><span>Admin ${esc(statusLabel(connector.adminState || connector.state))}</span><span>Client ${esc(statusLabel(connector.clientState || "locked"))}</span></div>
        </details>`).join("")}
    </div>`;
}

function renderAutomationConfig() {
  const cfg = store.state.automationConfig || {};
  const rows = [
    ["Monthly security scans", cfg.monthlySecurityScans?.state || "ready", cfg.monthlySecurityScans?.cadence || "monthly", cfg.monthlySecurityScans?.nextRunLabel || "ready after workspace setup"],
    ["Daily content engine", cfg.dailyContentEngine?.state || "ready", cfg.dailyContentEngine?.cadence || "daily", cfg.dailyContentEngine?.mode || "draft-pack first, publish after connector approval"],
    ["Review engine", cfg.reviewEngine?.state || "ready", cfg.reviewEngine?.cadence || "after delivery", cfg.reviewEngine?.mode || "request, collect, approve, publish-ready"],
  ];
  return `
    <div class="config-mini-grid">
      ${rows.map(([name, state, cadence, detail]) => `
        <article class="record mini-config">
          <div class="record-top"><h4>${esc(name)}</h4>${chip(state === "ready" ? "ready" : state)}</div>
          <p class="record-sub">${esc(cadence)}</p>
          <p class="record-notes">${esc(detail)}</p>
        </article>`).join("")}
    </div>`;
}

function renderControlPanel(title, status, body, options = {}) {
  const open = options.open === true;
  return `
    <details class="config-panel" ${open ? "open" : ""}>
      <summary>
        <span>
          <b>${esc(title)}</b>
          ${options.sub ? `<i>${esc(options.sub)}</i>` : ""}
        </span>
        ${chip(status)}
      </summary>
      <div class="config-body">${body}</div>
    </details>`;
}

/* ============================== PHANTOMOPS ============================== */
function renderAdmin(el, rerender) {
  if (!isAdmin()) { el.innerHTML = empty("This area belongs to your PhantomForce operator."); return; }
  const activeAgents = store.state.agents.filter((a) => a.status === "active").length;
  const activeTools = (store.state.toolSpine || []).filter((tool) => tool.mode === "active").length;
  const connectors = store.state.postingConnectors || [];
  const readyConnectors = connectors.filter((c) => c.adminState === "ready" || c.state === "available").length;
  const activeWork = visible(store.state.tasks || []).filter((t) => ["new", "working"].includes(t.status));
  const operatorWork = activeWork.filter((t) => t.operatorMode || t.lane === "Phantom Operator");
  const buildWork = activeWork.filter((t) => t.buildPlan || t.lane === "Builder");
  const creativeWork = visible(store.state.media || []).filter((m) => ["image", "video", "analyze"].includes(m.modality || "video"));
  el.innerHTML = `
    <div class="ws-toolbar">
      <p class="ws-note">Admin Control. Configure Phantom memory, connectors, automations, access, publishing, and workspace boundaries.</p>
      <div class="record-actions">
        <span class="mode-readout">Mode: <b>${esc(executionMode.label())}</b></span>
        <span class="hint-inline">${esc(executionMode.description())}</span>
        <button class="btn ${executionMode.get() === "approval" ? "btn-primary" : ""}" data-act="set-mode-approval">Approval</button>
        <button class="btn ${executionMode.get() === "auto" ? "btn-primary" : ""}" data-act="set-mode-auto">Auto</button>
        <button class="btn btn-primary" data-act="pulse-tools">Pulse live bar</button>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><span>Phantom systems</span><b>${activeAgents}/${store.state.agents.length}</b><i>business modules ready</i></div>
      <div class="stat"><span>Private systems</span><b>${activeTools}/${(store.state.toolSpine || []).length}</b><i>active</i></div>
      <div class="stat"><span>Connectors</span><b>${readyConnectors}/${connectors.length}</b><i>ready or configurable</i></div>
      <div class="stat"><span>Active work</span><b>${activeWork.length}</b><i>captured from chat</i></div>
      <div class="stat"><span>Mode</span><b>${esc(executionMode.get())}</b><i>${esc(executionMode.description())}</i></div>
    </div>
    <div class="config-stack">
      ${renderControlPanel("Create + Build + Operate", "active", `
        <p class="record-notes">One command can become a visual, video brief, page, store, dashboard, workflow, or admin work item.</p>
        <div class="config-mini-grid">
          <article class="record mini-config">
            <div class="record-top"><h4>Images</h4>${chip("ready")}</div>
            <p class="record-notes">Generate, crop, tweak, save.</p>
          </article>
          <article class="record mini-config">
            <div class="record-top"><h4>Video</h4>${chip("ready")}</div>
            <p class="record-notes">Brief, generate, cut, caption.</p>
          </article>
          <article class="record mini-config">
            <div class="record-top"><h4>Builder</h4>${chip(buildWork.length ? "working" : "ready")}</div>
            <p class="record-notes">Sites, stores, apps, dashboards.</p>
          </article>
          <article class="record mini-config">
            <div class="record-top"><h4>Operator</h4>${chip(operatorWork.length ? "working" : "ready")}</div>
            <p class="record-notes">Admin-only computer work.</p>
          </article>
        </div>
      `, { sub: `${creativeWork.length} creative · ${buildWork.length} build · ${operatorWork.length} operator` })}
      ${renderControlPanel("Active work", activeWork.length ? "active" : "ready", `
        <p class="record-notes">Chat becomes work. Phantom picks the route.</p>
        <div class="stack">
          ${activeWork.slice(0, 10).map((t) => `<article class="record record-row">
            <h4>${esc(t.title)}</h4>
            <p class="record-sub">${esc(t.lane)} · ${esc(t.mode || "approval")}</p>
            <span class="admin-ws-stats">${esc(t.next || "Started from Phantom chat.")}</span>
          </article>`).join("") || empty("No active chat-captured work yet.")}
        </div>
      `, { sub: `${activeWork.length} work items` })}
      ${renderControlPanel("System map", "active", `
        <p class="record-notes">Leads, quotes, media, sites, reviews, bookings, protect, money, delivery, and cleanup.</p>
        <div class="record-actions">
          <button class="btn" data-open-ws="workforce">Open systems map</button>
          <button class="btn" data-act="pulse-tools">Pulse system activity</button>
        </div>
      `, { sub: `${activeAgents} systems ready` })}
      ${renderControlPanel("Connectors", readyConnectors ? "ready" : "configure", `
        <p class="record-notes">Connect once. Draft, schedule, publish, upload, file, and follow up per workspace.</p>
        ${renderConnectorCards()}
        <p class="ws-note">Rule: create in Phantom -> approve -> send/post/upload.</p>
      `, { sub: "Gmail · Calendar · Drive · socials" })}
      ${renderControlPanel("Automation cadence", "ready", `
        <p class="record-notes">Monthly scans, daily content drafts, review requests, and follow-up loops.</p>
        ${renderAutomationConfig()}
      `, { sub: "monthly scans · daily content · review engine" })}
      ${renderControlPanel("Memory and tenants", "ready", `
        <article class="record record-wide">
          <div class="record-top"><h4>Owner memory</h4>${chip("ready")}</div>
          <p class="record-notes">Jordan keeps owner context. Client bots start clean and stay isolated.</p>
          <div class="record-actions">
            <input class="inline-input" data-owner-memory-query placeholder="Search owner memory..." aria-label="Search owner memory" />
            <button class="btn btn-primary" data-act="load-owner-memory">Load owner memory</button>
          </div>
        </article>
        <div data-owner-memory-result>${empty("Owner memory is ready. Load it when you need the full admin picture.")}</div>
      `, { sub: "Jordan full context · clients isolated" })}
      ${renderControlPanel("Workspace states", "ready", `
        <div class="stack">
          ${store.state.workspaces.map((w) => {
            const leads = store.state.leads.filter((l) => l.ws === w.id && !["won", "lost"].includes(l.status)).length;
            const appr = store.state.approvals.filter((a) => a.ws === w.id && a.status === "pending").length;
            const props = store.state.proposals.filter((p) => p.ws === w.id && ["draft", "sent-ready"].includes(p.status)).length;
            return `<article class="record record-row"><h4>${esc(w.name)}</h4><p class="record-sub">${esc(w.tagline)}</p>
              <span class="admin-ws-stats">${leads} open leads · ${props} live proposals · ${appr} approvals</span></article>`;
          }).join("")}
        </div>
      `, { sub: "PhantomForce · ChicagoShots · Test Client" })}
      ${renderControlPanel("Tool spine", "active", `
        <p class="record-notes">Admin-only systems behind Phantom. Expand only when you need detail.</p>
        ${renderToolSpineCards()}
      `, { sub: `${activeTools} active` })}
      ${renderControlPanel("Private access gateway", "active", `
        <article class="record record-wide">
          ${kv("Admin host", "<code>admin.phantomforce.online</code> — full Phantom control")}
          ${kv("Client host", "<code>app.phantomforce.online</code> — workspace-scoped employee/client view")}
          ${kv("Gateway", "private access gateway sits in front of both — auth is enforced upstream and in the app session")}
        </article>
      `, { sub: "admin/client boundary" })}
    </div>
    <h3 class="ws-subhead">Diagnostics</h3>
    <div class="record-actions">
      <button class="btn btn-quiet" data-act="reset">Reset local Phantom data</button>
      <span class="hint-inline">Rebuilds the seeded workspace records. Local only.</span>
    </div>`;
  bindActions(el, {
    "set-mode-auto": () => { executionMode.set("auto"); pushActivity("PhantomOps", "switched Phantom to Auto.", "phantomforce"); store.save(); rerender(); },
    "set-mode-approval": () => { executionMode.set("approval"); pushActivity("PhantomOps", "switched Phantom to Review.", "phantomforce"); store.save(); rerender(); },
    "pulse-tools": () => { pushToolPulse(); store.save(); rerender(); },
    "load-owner-memory": async () => {
      const result = el.querySelector("[data-owner-memory-result]");
      const query = el.querySelector("[data-owner-memory-query]")?.value?.trim() || "";
      if (!result) return;
      result.innerHTML = empty("Loading owner memory...");
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        const url = `/phantom-ai/admin/owner-memory/status${params.toString() ? `?${params}` : ""}`;
        const response = await fetch(url, { headers: authHeaders() });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          result.innerHTML = empty(payload?.error || "Owner memory requires admin backend access.");
          return;
        }
        result.innerHTML = renderOwnerMemoryPayload(payload);
      } catch (error) {
        result.innerHTML = empty(`Owner memory could not load: ${error?.message || "request failed"}`);
      }
    },
    reset: () => { if (confirm("Reset local Phantom data to the seeded state?")) { store.reset(); rerender(); } },
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
        <input type="text" data-phantom-input autocomplete="off" spellcheck="false" placeholder="Tell Phantom what needs handled..." aria-label="Tell Phantom what needs handled" />
        <button class="speak-send" type="submit" aria-label="Send to Phantom">→</button>
      </form>
    </div>`;
}

/* ============================ REGISTRY ============================ */
export const WORKSPACE_DEFS = {
  phantom: { title: "Phantom AI", kicker: "Business brain", render: renderPhantom },
  leads: { title: "Leads & Follow-Up", kicker: "Pipeline system", render: renderLeads },
  proposals: { title: "Proposal Forge", kicker: "Quotes & offers", render: renderProposals },
  reviews: { title: "Review Studio", kicker: "Reputation engine", render: renderReviews },
  bookings: { title: "Bookings", kicker: "Schedule system", render: renderBookings },
  media: { title: "Media Lab", kicker: "Production phantom", render: renderMedia },
  sites: { title: "Site & Store Studio", kicker: "Build surface", render: renderSites },
  protect: { title: "Protect", kicker: "Security watch", render: renderProtect },
  money: { title: "Money", kicker: "Revenue phantom", render: renderMoney },
  workforce: { title: "Systems Map", kicker: "Phantom modules", render: renderWorkforce },
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
    { id: "leads", icon: "◉", title: "Follow-Up Desk", stat: `${openLeads.length} open`, sub: dueLeads.length ? `${dueLeads.length} due today` : "pipeline current", alert: dueLeads.length > 0 },
    { id: "proposals", icon: "◆", title: "Quote Forge", stat: `${m.open.length} live`, sub: `${fmtMoney(m.pipeline)} open`, alert: false },
    { id: "media", icon: "▶", title: "Media Lab", stat: `${briefs.length} ready`, sub: "briefs & generation", alert: false },
    { id: "sites", icon: "▦", title: "Site & Store Studio", stat: `${pages.length} builds`, sub: pages.some((p) => p.status === "publish-ready") ? "1+ publish-ready" : "drafting", alert: false },
    { id: "reviews", icon: "★", title: "Review Desk", stat: `${revs.length} in pipe`, sub: "request → publish", alert: false },
    { id: "bookings", icon: "◷", title: "Bookings", stat: `${bks.length} pending`, sub: "drafts & confirmations", alert: false },
    { id: "protect", icon: "⬡", title: "Risk Radar", stat: sec ? (sec.posture === "clean" ? "clean" : "attention") : "fresh", sub: sec ? `leaks · malware · habits` : "no scan yet", alert: sec ? sec.posture !== "clean" : false },
    { id: "money", icon: "◈", title: "Money", stat: fmtMoney(m.pipeline), sub: `${fmtMoney(m.retainerMonthly)}/mo retainers`, alert: false },
    { id: "workforce", icon: "⬢", title: "Systems Map", stat: `${activeAgents} systems`, sub: isAdmin() ? `${activeTools} internal tools mapped` : "available modules", alert: false },
    { id: "approvals", icon: "✓", title: "Approvals", stat: `${pend.length} waiting`, sub: pend.length ? "needs your call" : "queue clear", alert: pend.length > 0 },
  ];
  if (isAdmin()) w.push({ id: "adminos", icon: "⌘", title: "PhantomOps", stat: "operator", sub: "workspaces · systems · access", alert: false });
  return w;
}
