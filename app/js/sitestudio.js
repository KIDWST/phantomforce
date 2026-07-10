/* PhantomForce Site Studio — AI website & store builder.
   Webflow-style shell: the live preview is the dominant surface at all
   times; every control (build prompt, page settings, pages, design,
   content, SEO, integrations, publish, activity) lives in a single
   collapsible left rail so nothing ever overlaps or replaces the canvas. */

import {
  store, uid, visible, isAdmin, currentWs, wsName, pushActivity, ago, fmtMoney, statusLabel,
} from "./store.js?v=phantom-live-20260710-143";
import {
  esc, baseSiteDraft, ensureSiteDesign, applyWebsitePrompt, renderWebsitePreview,
} from "./workspaces.js?v=phantom-live-20260710-143";
import { loadContentAssets } from "./contenthub.js?v=phantom-live-20260710-143";

const cap = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
const firstSentence = (value) => String(value || "").split(/[.!?]/)[0].trim();

const THEME_PRESETS = [
  { id: "neon", name: "Phantom", note: "Signature green/black" },
  { id: "blue", name: "Atlas", note: "Cool blue, high contrast" },
  { id: "gold", name: "Elegant", note: "Warm gold accents" },
  { id: "red", name: "Bold", note: "High-energy red" },
  { id: "purple", name: "Vibrant", note: "Purple gradient" },
];

const INTEGRATION_DEFS = [
  { id: "analytics", name: "Google Analytics", field: "Measurement ID", placeholder: "G-XXXXXXX" },
  { id: "pixel", name: "Facebook Pixel", field: "Pixel ID", placeholder: "1234567890" },
  { id: "stripe", name: "Stripe", field: "Publishable key", placeholder: "pk_live_…" },
  { id: "email", name: "Email marketing", field: "List / webhook URL", placeholder: "https://…" },
  { id: "crm", name: "CRM", field: "Webhook URL", placeholder: "https://…" },
  { id: "automation", name: "Flow Relay", field: "Webhook URL", placeholder: "https://…" },
  { id: "booking", name: "Booking / calendar", field: "Booking link", placeholder: "https://…" },
];

const COMMAND_CHIPS = [
  "Build a coaching site", "Add a merch store", "Make the hero premium",
  "Add booking", "Improve mobile layout", "Write better copy",
];

const PUBLISH_COPY = {
  draft: "Still drafting. Mark ready when the page looks right.",
  "publish-ready": "Ready — queue it for publish approval.",
  "approved-to-publish": "Approved. Publish connector still has to run.",
};

/* Accordion open state — Build/Page settings start open, everything else
   starts collapsed per the "more website, less UI" direction. Persisted in
   module state (not the DOM) since every interaction re-renders the shell
   and native <details> would otherwise forget what the user opened. */
const ssUi = {
  activeSiteId: null, device: "desktop", selected: "page", setup: null, picker: null,
  open: { page: true, quick: false, templates: false, pages: false, design: false, content: false, seo: false, integrations: false, publish: false, activity: false },
};

function ssIcon(k) {
  const P = {
    desktop: `<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13.5h4M8 11v2.5"/>`,
    tablet: `<rect x="4" y="2" width="8" height="12" rx="1.3"/><path d="M7.4 12.2h1.2"/>`,
    mobile: `<rect x="5.2" y="1.6" width="5.6" height="12.8" rx="1.2"/><path d="M7.4 12.1h1.2"/>`,
    close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
    globe: `<circle cx="8" cy="8" r="5.3"/><path d="M2.7 8h10.6M8 2.7c1.6 1.4 2.5 3.3 2.5 5.3s-.9 3.9-2.5 5.3c-1.6-1.4-2.5-3.3-2.5-5.3S6.4 4.1 8 2.7z"/>`,
    check: `<path d="M3 8.5l3 3 7-7"/>`,
  };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}

/* ---------------- data model (lazy, backward compatible) ---------------- */
function ensureSiteExtras(site) {
  if (!Array.isArray(site.pages) || !site.pages.length) {
    site.pages = [{ id: uid("page"), name: "Home", slug: "/", home: true, status: "published" }];
  }
  site.seo = site.seo || { title: "", description: "", keywords: "" };
  site.integrations = site.integrations || {};
  INTEGRATION_DEFS.forEach((d) => {
    if (!site.integrations[d.id]) site.integrations[d.id] = { status: "not-connected", value: "" };
  });
  site.gallery = Array.isArray(site.gallery) ? site.gallery : [];
  return site;
}

function pickableAssets() {
  return loadContentAssets().filter((a) => a.url);
}

function freshSetup() {
  return {
    step: 1, biz: "", desc: "", audience: "", notes: "", theme: "neon",
    goals: { "Get more leads": true, "Sell products or services": false, "Build brand awareness": false, "Share information": false },
    features: { "Booking": false, "Store / checkout": false, "Testimonials": false, "Blog": false, "FAQ": false },
  };
}

/* ---------------------------- small pieces ---------------------------- */
function emptyState() {
  return `
    <div class="ss-empty">
      <p class="ss-empty-kicker">Site Studio</p>
      <h2>No site yet.</h2>
      <p>Tell Phantom what to build, or answer a few quick questions and let AI draft the first version.</p>
      <div class="ss-empty-actions">
        <button class="btn btn-primary" type="button" data-act="ss-open-setup">Create with AI</button>
        <button class="btn btn-quiet" type="button" data-act="ss-start-blank">Start blank</button>
      </div>
    </div>`;
}

function header(active, sites) {
  return `
    <div class="ss-header">
      <div class="ss-header-left">
        <select class="ss-site-switch" data-ss-switch-site ${sites.length <= 1 ? "disabled" : ""} aria-label="Active site">
          ${sites.map((s) => `<option value="${s.id}" ${s.id === active.id ? "selected" : ""}>${esc(s.title)}</option>`).join("")}
        </select>
        <span class="ml-chip is-ready"><i></i>Saved</span>
      </div>
      <div class="ss-header-right">
        <div class="ml-topbar-tools" role="group" aria-label="Preview size">
          <button class="ml-topbar-ic ${ssUi.device === "desktop" ? "is-active" : ""}" type="button" data-act="ss-device" data-id="desktop" title="Desktop preview">${ssIcon("desktop")}</button>
          <button class="ml-topbar-ic ${ssUi.device === "tablet" ? "is-active" : ""}" type="button" data-act="ss-device" data-id="tablet" title="Tablet preview">${ssIcon("tablet")}</button>
          <button class="ml-topbar-ic ${ssUi.device === "mobile" ? "is-active" : ""}" type="button" data-act="ss-device" data-id="mobile" title="Mobile preview">${ssIcon("mobile")}</button>
        </div>
        <button class="btn btn-quiet" type="button" data-act="ss-open-setup">+ New site</button>
        <button class="btn btn-primary" type="button" data-act="ss-goto-publish">Publish</button>
      </div>
    </div>`;
}

/* ------------------------------ rail sections ------------------------------ */
function pageSettingsBody(active) {
  const design = active.design;
  const sel = ssUi.selected || "page";
  const tabs = [["page", "Page"], ["hero", "Hero"], ["offer", "Offer / CTA"], ["sections", "Sections"]];
  let body = "";
  if (sel === "page") {
    body = `
      <label class="ss-field"><span>Theme color</span>
        <select data-ss-set="theme">${["neon", "blue", "gold", "red", "purple"].map((t) => `<option value="${t}" ${design.theme === t ? "selected" : ""}>${cap(t)}</option>`).join("")}</select>
      </label>
      <label class="ss-field"><span>Style</span>
        <select data-ss-set="style">${["premium local", "premium", "simple", "sports"].map((s) => `<option value="${s}" ${design.style === s ? "selected" : ""}>${cap(s)}</option>`).join("")}</select>
      </label>
      <label class="ss-toggle"><input type="checkbox" data-ss-set-bool="storeEnabled" ${design.storeEnabled ? "checked" : ""}/> Store mode (products + checkout)</label>`;
  } else if (sel === "hero") {
    body = `
      <label class="ss-field"><span>Headline</span><input data-ss-set="headline" value="${esc(design.headline)}"/></label>
      <label class="ss-field"><span>Subhead</span><textarea data-ss-set="subhead" rows="3">${esc(design.subhead)}</textarea></label>
      <div class="ss-field"><span>Hero image</span>
        ${design.heroImage ? `
          <div class="ss-hero-thumb"><span class="ch-asset-thumb"><img src="${esc(design.heroImage)}" alt=""/></span>
            <div class="ss-hero-thumb-actions">
              <button class="btn btn-quiet" type="button" data-act="ss-pick-hero">Change</button>
              <button class="btn btn-quiet" type="button" data-act="ss-remove-hero">Remove</button>
            </div>
          </div>` : `<button class="btn btn-primary" type="button" data-act="ss-pick-hero">Choose from Content Hub</button>`}
      </div>`;
  } else if (sel === "offer") {
    body = `
      <label class="ss-field"><span>Offer</span><input data-ss-set="offer" value="${esc(design.offer)}"/></label>
      <label class="ss-field"><span>Button text</span><input data-ss-set="cta" value="${esc(design.cta)}"/></label>`;
  } else {
    body = `
      <p class="ss-note">Sections on this page</p>
      <div class="ss-section-list">
        ${active.sections.map((s, i) => `<span class="ss-section-row">${esc(s)}${active.sections.length > 1 ? `<button type="button" data-act="ss-remove-section" data-id="${i}" aria-label="Remove section">×</button>` : ""}</span>`).join("")}
      </div>`;
  }
  return `
    <div class="ss-inspector-tabs">
      ${tabs.map(([id, label]) => `<button class="ss-mini-tab ${sel === id ? "is-active" : ""}" type="button" data-act="ss-select" data-id="${id}">${label}</button>`).join("")}
    </div>
    ${body}`;
}

function readinessItems(active, products) {
  const items = [
    { label: "Hero image added", done: !!active.design.heroImage },
    { label: "Offer & CTA written", done: !!(active.design.offer || "").trim() },
    { label: "SEO title set", done: !!(active.seo.title || "").trim() },
  ];
  if (active.design.storeEnabled) items.push({ label: "At least 1 product added", done: products.length > 0 });
  items.push({ label: "Domain connected", done: !!(active.design.existingUrl || active.url) });
  return items;
}

function readinessCard(active, products) {
  const items = readinessItems(active, products);
  const done = items.filter((i) => i.done).length;
  return `
    <div class="ss-readiness">
      <div class="ss-readiness-head"><p class="ss-suggest-label">Ready to publish</p><span class="ss-readiness-count">${done}/${items.length}</span></div>
      <div class="ss-readiness-list">
        ${items.map((i) => `<div class="ss-readiness-row ${i.done ? "is-done" : ""}"><span class="ss-readiness-dot">${i.done ? ssIcon("check") : ""}</span>${esc(i.label)}</div>`).join("")}
      </div>
      <button class="btn btn-quiet ss-readiness-btn" type="button" data-act="ss-goto-publish">Go to Publish</button>
    </div>`;
}

function pagesBody(active) {
  return `
    <div class="ss-pages-head"><span class="ss-note">${active.pages.length} page${active.pages.length === 1 ? "" : "s"}</span><button class="btn btn-quiet" type="button" data-act="ss-add-page">+ Add page</button></div>
    <div class="ss-pages-list">
      ${active.pages.map((p) => `
        <div class="ss-page-row ${p.home ? "is-home" : ""}">
          <div class="ss-page-info"><b>${esc(p.name)}</b><i>${esc(p.slug)}</i></div>
          <span class="chip chip-${esc(p.status)}">${esc(statusLabel(p.status))}</span>
          ${p.home ? `<span class="ss-home-tag">Home</span>` : `<button class="btn btn-quiet" type="button" data-act="ss-set-home" data-id="${p.id}">Set home</button>`}
          <button class="btn btn-quiet" type="button" data-act="ss-rename-page" data-id="${p.id}">Rename</button>
          <button class="btn btn-quiet" type="button" data-act="ss-dup-page" data-id="${p.id}">Duplicate</button>
          ${active.pages.length > 1 ? `<button class="ss-page-x" type="button" data-act="ss-del-page" data-id="${p.id}" aria-label="Delete page">×</button>` : ""}
        </div>`).join("")}
    </div>`;
}

function siteTemplatesBody(active) {
  return `
    <p class="ss-note">Swap the whole look in one click.</p>
    <div class="ss-theme-grid">
      ${THEME_PRESETS.map((t) => `<button class="ss-theme-card theme-${t.id} ${active.design.theme === t.id ? "is-active" : ""}" type="button" data-act="ss-theme" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.note)}</span></button>`).join("")}
    </div>`;
}

function designBody(active) {
  const design = active.design;
  return `
    <label class="ss-field"><span>Style preset</span>
      <select data-ss-set="style">${["premium local", "premium", "simple", "sports"].map((s) => `<option value="${s}" ${design.style === s ? "selected" : ""}>${cap(s)}</option>`).join("")}</select>
    </label>
    <label class="ss-toggle"><input type="checkbox" data-ss-set-bool="storeEnabled" ${design.storeEnabled ? "checked" : ""}/> Store mode (products + checkout)</label>`;
}

function contentBody(active, products) {
  return `
    <div class="ss-card">
      <h3>Business info</h3>
      <label class="ss-field"><span>Brand name</span><input data-ss-set="brand" value="${esc(active.design.brand)}"/></label>
      <label class="ss-field"><span>Audience</span><input data-ss-meta="audience" value="${esc(active.audience || "")}"/></label>
      <label class="ss-field"><span>Anything else Phantom should know</span><textarea data-ss-meta="notes" rows="3">${esc(active.notes || "")}</textarea></label>
    </div>
    <div class="ss-card">
      <h3>Products / services</h3>
      <div class="ss-mini-form">
        <input data-prod-name placeholder="Name"/>
        <input data-prod-price placeholder="Price" type="number" min="0"/>
        <input data-prod-cat placeholder="Category"/>
        <textarea data-prod-desc placeholder="Short description" rows="2"></textarea>
        <button class="btn btn-primary" type="button" data-act="ss-add-product">Add</button>
      </div>
      <div class="ss-product-list">
        ${products.map((p) => `
          <div class="ss-product-row">
            ${p.imageUrl ? `<span class="ch-asset-thumb ss-product-thumb"><img src="${esc(p.imageUrl)}" alt=""/></span>` : ""}
            <b>${esc(p.name)}</b><i>${fmtMoney(p.price)}</i>
            <span class="chip chip-${esc(p.publish)}">${esc(statusLabel(p.publish))}</span>
            <button class="btn btn-quiet" type="button" data-act="ss-pick-product" data-id="${p.id}">${p.imageUrl ? "Change image" : "Add image"}</button>
            ${p.publish === "draft" ? `<button class="btn btn-quiet" type="button" data-act="ss-product-ready" data-id="${p.id}">Mark ready</button>` : ""}
            <button class="ss-page-x" type="button" data-act="ss-remove-product" data-id="${p.id}" aria-label="Remove product">×</button>
          </div>`).join("") || `<p class="ss-empty-note">No products yet. Add one above.</p>`}
      </div>
    </div>
    <div class="ss-card">
      <div class="ss-card-head-row"><h3>Gallery</h3><button class="btn btn-primary" type="button" data-act="ss-pick-gallery">+ Add</button></div>
      <div class="ss-gallery-grid">
        ${active.gallery.map((g) => `
          <div class="ss-gallery-item">
            <span class="ch-asset-thumb">${g.type === "video" ? `<video src="${esc(g.url)}" muted></video>` : `<img src="${esc(g.url)}" alt="${esc(g.title || "")}"/>`}</span>
            <button class="ss-page-x" type="button" data-act="ss-remove-gallery" data-id="${g.id}" aria-label="Remove from gallery">×</button>
          </div>`).join("") || `<p class="ss-empty-note">No gallery images yet. Pull generated media straight from Content Hub.</p>`}
      </div>
    </div>`;
}

function seoBody(active) {
  const seo = active.seo;
  const home = active.pages.find((p) => p.home) || active.pages[0];
  return `
    <label class="ss-field"><span>Page title</span><input data-ss-seo="title" value="${esc(seo.title || active.design.headline)}"/></label>
    <label class="ss-field"><span>Meta description</span><textarea data-ss-seo="description" rows="3">${esc(seo.description || active.design.subhead)}</textarea></label>
    <label class="ss-field"><span>Keywords</span><input data-ss-seo="keywords" value="${esc(seo.keywords || "")}" placeholder="comma, separated, keywords"/></label>
    <label class="ss-field"><span>Slug</span><input data-ss-seo="slug" value="${esc(seo.slug || home.slug)}"/></label>
    <div class="ss-actions-row">
      <button class="btn btn-primary" type="button" data-act="ss-seo-generate">AI rewrite from page content</button>
      <button class="btn btn-quiet" type="button" data-act="ss-seo-save">Save SEO</button>
    </div>
    <p class="ss-note">Open-graph image generation and structured data aren't wired yet — everything else here saves for real.</p>`;
}

function integrationsBody(active) {
  return `
    <div class="ss-integration-grid">
      ${INTEGRATION_DEFS.map((d) => {
        const rec = active.integrations[d.id];
        const connected = rec.status === "connected";
        return `
          <div class="ss-integration-card ${connected ? "is-on" : ""}">
            <div class="ss-integration-top"><b>${esc(d.name)}</b><span class="chip chip-${connected ? "active" : "not-wired"}">${connected ? "Connected" : "Not connected"}</span></div>
            <label class="ss-field"><span>${esc(d.field)}</span><input data-ss-integration="${d.id}" placeholder="${esc(d.placeholder)}" value="${esc(rec.value || "")}" ${connected ? "disabled" : ""}/></label>
            <div class="ss-integration-actions">
              ${connected
                ? `<button class="btn btn-quiet" type="button" data-act="ss-integration-disconnect" data-id="${d.id}">Disconnect</button>`
                : `<button class="btn btn-primary" type="button" data-act="ss-integration-connect" data-id="${d.id}">Connect</button>`}
            </div>
          </div>`;
      }).join("")}
    </div>
    <p class="ss-note">Connecting saves the ID/URL locally and marks it live for Publish checks. PhantomForce never stores production secrets in the browser.</p>`;
}

function publishBody(active) {
  const url = active.design.existingUrl || active.url;
  return `
    <div class="ss-publish-status">
      <span class="chip chip-${esc(active.status)}">${esc(statusLabel(active.status))}</span>
      <p>${PUBLISH_COPY[active.status] || ""}</p>
    </div>
    <div class="ss-publish-actions">
      ${active.status === "draft" ? `<button class="btn btn-good" type="button" data-act="ss-ready">Mark ready to publish</button>` : ""}
      ${active.status === "publish-ready" ? `<button class="btn btn-primary" type="button" data-act="ss-queue">Queue publish approval</button>` : ""}
      ${url
        ? `<button class="btn btn-primary" type="button" data-act="ss-open-live">${ssIcon("globe")} Open live site</button>`
        : `<button class="btn btn-quiet" type="button" disabled title="Connect a domain in Integrations or link an existing site first">${ssIcon("globe")} Open live site</button>`}
    </div>
    <div class="ss-publish-meta">
      <div class="kv"><span>Domain</span><b>${esc(url || "Not connected")}</b></div>
      <div class="kv"><span>Last updated</span><b>${ago(active.updated)}</b></div>
      <div class="kv"><span>Pages</span><b>${active.pages.length}</b></div>
    </div>`;
}

function activityBody(active) {
  const brand = (active.title || "").split(" — ")[0];
  const rows = (store.state.activity || []).filter((a) => a.text && brand && a.text.includes(brand)).slice(0, 30);
  return rows.length
    ? `<div class="ss-activity">${rows.map((a) => `<div class="ss-activity-row"><b>${esc(a.who)}</b><span>${esc(a.text)}</span><i>${ago(a.at)}</i></div>`).join("")}</div>`
    : `<p class="ss-empty-note">No activity yet for this site.</p>`;
}

/* ------------------------------ rail + canvas ------------------------------ */
function accordion(id, label, bodyHtml, badge = "") {
  return `
    <details class="ss-accordion" data-ss-acc="${id}" ${ssUi.open[id] ? "open" : ""}>
      <summary>${esc(label)}${badge}</summary>
      <div class="ss-accordion-body">${bodyHtml}</div>
    </details>`;
}

function buildTab(active, products) {
  const design = active.design;
  const home = active.pages.find((p) => p.home) || active.pages[0];
  return `
    <div class="ss-build">
      <div class="ss-col ss-rail">
        <form class="ss-command" data-ss-command>
          <label for="ssPrompt">Tell Phantom what to build, change, or fix</label>
          <textarea id="ssPrompt" data-ss-prompt rows="3" placeholder="Tell Phantom what to build, change, or fix…"></textarea>
          <div class="ss-chips">
            ${COMMAND_CHIPS.map((c) => `<button type="button" class="ss-chip" data-ss-chip="${esc(c)}">${esc(c)}</button>`).join("")}
          </div>
          <button class="btn btn-primary" type="submit">Update site</button>
        </form>
        ${accordion("page", "Page settings", pageSettingsBody(active))}
        ${accordion("quick", "Quick sections", `<div class="ss-suggest-grid">${["Testimonials", "Pricing", "FAQ", "Gallery", "CTA", "Team"].map((s) => `<button class="ss-suggest" type="button" data-act="ss-add-section" data-id="${esc(s)}">+ ${esc(s)}</button>`).join("")}</div>`)}
        ${accordion("templates", "Site templates", siteTemplatesBody(active))}
        ${accordion("pages", "Pages", pagesBody(active), ` <i class="ss-acc-count">${active.pages.length}</i>`)}
        ${accordion("design", "Design", designBody(active))}
        ${accordion("content", "Content", contentBody(active, products))}
        ${accordion("seo", "SEO", seoBody(active))}
        ${accordion("integrations", "Integrations", integrationsBody(active))}
        ${accordion("publish", "Publish", publishBody(active))}
        ${accordion("activity", "Activity", activityBody(active))}
        ${readinessCard(active, products)}
      </div>
      <div class="ss-col ss-col-preview">
        <div class="ss-preview-top">
          <span>${esc(design.style)} · ${esc(design.theme)}</span>
          <b>${esc(home.name)}</b>
        </div>
        <div class="ss-preview-frame ss-device-${ssUi.device}" data-ss-preview-mount>${renderWebsitePreview(active, products)}</div>
      </div>
    </div>`;
}

/* --------------------------- AI setup drawer --------------------------- */
function setupDrawerMarkup(setup) {
  const stepNames = ["Business Info", "Style", "Features", "Review"];
  let body = "";
  if (setup.step === 1) {
    body = `
      <label class="ss-field"><span>Business / brand name</span><input data-ss-setup="biz" value="${esc(setup.biz)}"/></label>
      <label class="ss-field"><span>What does your business do?</span><textarea data-ss-setup="desc" rows="3">${esc(setup.desc)}</textarea></label>
      <p class="ss-suggest-label">Main goals</p>
      <div class="ss-goal-grid">
        ${Object.keys(setup.goals).map((g) => `<label class="ss-toggle"><input type="checkbox" data-ss-setup-goal="${esc(g)}" ${setup.goals[g] ? "checked" : ""}/> ${esc(g)}</label>`).join("")}
      </div>
      <label class="ss-field"><span>Describe your ideal audience</span><textarea data-ss-setup="audience" rows="2">${esc(setup.audience)}</textarea></label>`;
  } else if (setup.step === 2) {
    body = `
      <p class="ss-suggest-label">Pick a style</p>
      <div class="ss-theme-grid">${THEME_PRESETS.map((t) => `<button class="ss-theme-card theme-${t.id} ${setup.theme === t.id ? "is-active" : ""}" type="button" data-act="ss-setup-theme" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.note)}</span></button>`).join("")}</div>`;
  } else if (setup.step === 3) {
    body = `
      <p class="ss-suggest-label">Features</p>
      ${Object.keys(setup.features).map((f) => `<label class="ss-toggle"><input type="checkbox" data-ss-setup-feature="${esc(f)}" ${setup.features[f] ? "checked" : ""}/> ${esc(f)}</label>`).join("")}
      <label class="ss-field"><span>Anything else AI should know?</span><textarea data-ss-setup="notes" rows="2">${esc(setup.notes)}</textarea></label>`;
  } else {
    const goals = Object.keys(setup.goals).filter((g) => setup.goals[g]);
    const features = Object.keys(setup.features).filter((f) => setup.features[f]);
    body = `
      <p class="ss-suggest-label">Review</p>
      <div class="ss-review">
        <b>${esc(setup.biz) || "Untitled business"}</b>
        <span>${esc(setup.desc) || "No description yet."}</span>
        <i>${goals.join(" · ") || "No goals selected"}</i>
        <i>${features.join(" · ") || "No extra features selected"}</i>
      </div>`;
  }
  return `
    <div class="ml-drawer-backdrop" data-act="ss-close-setup"></div>
    <aside class="ml-drawer ss-setup-drawer">
      <div class="ml-drawer-head">
        <b>Create your website with AI</b>
        <button class="ml-drawer-x" type="button" data-act="ss-close-setup">${ssIcon("close")}</button>
      </div>
      <div class="ml-drawer-body">
        <p class="ml-drawer-note">Answer a few questions and let AI build your site.</p>
        <div class="ss-steps">${stepNames.map((s, i) => `<span class="ss-step ${setup.step === i + 1 ? "is-active" : setup.step > i + 1 ? "is-done" : ""}">${i + 1}. ${s}</span>`).join("")}</div>
        ${body}
        <div class="ss-setup-nav">
          ${setup.step > 1 ? `<button class="btn btn-quiet" type="button" data-act="ss-setup-back">Back</button>` : `<span></span>`}
          ${setup.step < 4 ? `<button class="btn btn-primary" type="button" data-act="ss-setup-next">Continue</button>` : `<button class="btn btn-primary" type="button" data-act="ss-setup-generate">Generate my website</button>`}
        </div>
        ${setup.step === 1 ? `<button class="ml-link" type="button" data-act="ss-setup-skip">Skip — start blank</button>` : ""}
      </div>
    </aside>`;
}

/* --------------------------- media picker drawer --------------------------- */
function mediaPickerMarkup() {
  const assets = pickableAssets();
  return `
    <div class="ml-drawer-backdrop" data-act="ss-media-close"></div>
    <aside class="ml-drawer ss-media-drawer">
      <div class="ml-drawer-head">
        <b>Choose from Content Hub</b>
        <button class="ml-drawer-x" type="button" data-act="ss-media-close">${ssIcon("close")}</button>
      </div>
      <div class="ml-drawer-body">
        ${assets.length ? `
          <div class="ss-media-grid">
            ${assets.map((a) => `
              <button class="ss-media-card" type="button" data-act="ss-media-pick" data-id="${esc(a.id)}" title="${esc(a.title)}">
                <span class="ch-asset-thumb">${a.type === "video" ? `<video src="${esc(a.url)}" muted></video>` : `<img src="${esc(a.url)}" alt="${esc(a.title)}"/>`}<b>${a.type === "video" ? "Video" : "Image"}</b></span>
                <i>${esc(a.title)}</i>
              </button>`).join("")}
          </div>` : `<p class="ml-drawer-note">No generated media yet. Create something in Media Lab, then come back to attach it here.</p>`}
      </div>
    </aside>`;
}

/* -------------------------------- shell -------------------------------- */
function shellMarkup(active, sites, products) {
  return `
    <div class="ss-shell">
      <div class="ss-toolbar">${header(active, sites)}</div>
      <div class="ss-panel" data-ss-panel>${buildTab(active, products)}</div>
    </div>
    ${ssUi.setup ? setupDrawerMarkup(ssUi.setup) : ""}
    ${ssUi.picker ? mediaPickerMarkup() : ""}`;
}

/* -------------------------------- actions -------------------------------- */
function createDraft(name, kind) {
  const draft = baseSiteDraft(name, kind);
  ensureSiteExtras(draft);
  store.state.sites.unshift(draft);
  ssUi.activeSiteId = draft.id;
  pushActivity(kind === "Store" ? "Site Studio" : "Site Studio", `started ${draft.title}.`, draft.ws);
  store.save();
}

function bindActions(root, handlers) {
  root.querySelectorAll("[data-act]").forEach((el) => {
    el.addEventListener("click", () => {
      const fn = handlers[el.dataset.act];
      if (fn) fn(el.dataset.id, el);
    });
  });
}

export function renderSiteStudio(el, opts = {}) {
  const rerender = () => renderSiteStudio(el, opts);
  const sites = visible(store.state.sites);
  const products = visible(store.state.products);

  if (!ssUi.activeSiteId || !sites.find((s) => s.id === ssUi.activeSiteId)) {
    ssUi.activeSiteId = sites[0]?.id || null;
  }
  const active = sites.find((s) => s.id === ssUi.activeSiteId) || null;
  if (active) { ensureSiteDesign(active); ensureSiteExtras(active); }

  if (!active) {
    el.innerHTML = emptyState() + (ssUi.setup ? setupDrawerMarkup(ssUi.setup) : "");
  } else {
    el.innerHTML = shellMarkup(active, sites, products);
  }

  const setup = ssUi.setup;

  // Accordions track their own open/closed state via the native <details>
  // "toggle" event (silent — no rerender) so a later rerender (e.g. typing
  // in a field) doesn't snap a section the user opened back shut.
  el.querySelectorAll("[data-ss-acc]").forEach((d) => {
    d.addEventListener("toggle", () => { ssUi.open[d.dataset.ssAcc] = d.open; });
  });

  bindActions(el, {
    "ss-open-setup": () => { ssUi.setup = freshSetup(); rerender(); },
    "ss-close-setup": () => { ssUi.setup = null; rerender(); },
    "ss-start-blank": () => { createDraft("New site", "Website"); rerender(); },
    "ss-setup-skip": () => { createDraft(setup.biz || "New site", setup.features["Store / checkout"] ? "Store" : "Website"); ssUi.setup = null; rerender(); },
    "ss-setup-back": () => { setup.step = Math.max(1, setup.step - 1); rerender(); },
    "ss-setup-next": () => { setup.step = Math.min(4, setup.step + 1); rerender(); },
    "ss-setup-theme": (id) => { setup.theme = id; rerender(); },
    "ss-setup-generate": () => {
      const kind = setup.features["Store / checkout"] ? "Store" : "Website";
      const draft = baseSiteDraft(setup.biz || "New site", kind);
      draft.design.theme = setup.theme || "neon";
      draft.audience = setup.audience;
      draft.notes = setup.notes;
      if (setup.desc) draft.design.headline = firstSentence(setup.desc) || draft.design.headline;
      if (setup.features["Booking"]) applyWebsitePrompt(draft, "add booking, schedule, reminders, and a book now button");
      if (setup.features["Testimonials"]) draft.sections.push("Testimonials");
      if (setup.features["Blog"]) draft.sections.push("Blog");
      if (setup.features["FAQ"]) draft.sections.push("FAQ");
      ensureSiteExtras(draft);
      store.state.sites.unshift(draft);
      ssUi.activeSiteId = draft.id;
      ssUi.setup = null;
      pushActivity("Site Studio", `generated a new site draft for ${draft.title} from the AI setup flow.`, draft.ws);
      store.save(); rerender();
    },
    "ss-device": (id) => { ssUi.device = id; rerender(); },
    "ss-goto-publish": () => { ssUi.open.publish = true; rerender(); requestAnimationFrame(() => el.querySelector('[data-ss-acc="publish"]')?.scrollIntoView({ behavior: "smooth", block: "start" })); },
    "ss-select": (id) => { ssUi.selected = id; rerender(); },
    "ss-add-section": (id) => { if (active) { active.sections.push(id); active.updated = new Date().toISOString(); pushActivity("Site Studio", `added ${id} section to ${active.title}.`, active.ws); store.save(); rerender(); } },
    "ss-remove-section": (id) => { if (active) { active.sections.splice(Number(id), 1); active.updated = new Date().toISOString(); store.save(); rerender(); } },
    "ss-theme": (id) => { if (active) { active.design.theme = id; store.save(); rerender(); } },
    "ss-add-page": () => {
      if (!active) return;
      const name = window.prompt("New page name (e.g. About, Contact)")?.trim();
      if (!name) return;
      active.pages.push({ id: uid("page"), name, slug: `/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, home: false, status: "draft" });
      pushActivity("Site Studio", `added the ${name} page to ${active.title}.`, active.ws);
      store.save(); rerender();
    },
    "ss-rename-page": (id) => {
      const page = active?.pages.find((p) => p.id === id);
      if (!page) return;
      const name = window.prompt("Rename page", page.name)?.trim();
      if (!name) return;
      page.name = name;
      store.save(); rerender();
    },
    "ss-dup-page": (id) => {
      const page = active?.pages.find((p) => p.id === id);
      if (!page) return;
      active.pages.push({ ...page, id: uid("page"), name: `${page.name} copy`, home: false, slug: `${page.slug}-copy` });
      pushActivity("Site Studio", `duplicated the ${page.name} page.`, active.ws);
      store.save(); rerender();
    },
    "ss-set-home": (id) => {
      if (!active) return;
      active.pages.forEach((p) => { p.home = p.id === id; });
      store.save(); rerender();
    },
    "ss-del-page": (id) => {
      const page = active?.pages.find((p) => p.id === id);
      if (!page || active.pages.length <= 1) return;
      if (!window.confirm(`Delete "${page.name}"? This cannot be undone.`)) return;
      active.pages = active.pages.filter((p) => p.id !== id);
      if (page.home && active.pages.length) active.pages[0].home = true;
      pushActivity("Site Studio", `deleted the ${page.name} page.`, active.ws);
      store.save(); rerender();
    },
    "ss-add-product": () => {
      const name = el.querySelector("[data-prod-name]")?.value.trim();
      const price = Number(el.querySelector("[data-prod-price]")?.value || 0);
      const category = el.querySelector("[data-prod-cat]")?.value.trim() || "Service";
      const desc = el.querySelector("[data-prod-desc]")?.value.trim() || "";
      if (!name) return;
      store.state.products.unshift({ id: uid("prod"), ws: currentWs(), name, price, category, desc, fulfillment: "Define fulfillment before publish", checkout: "not-wired", publish: "draft" });
      pushActivity("Site Studio", `added ${name} to the catalog.`, currentWs());
      store.save(); rerender();
    },
    "ss-product-ready": (id) => { const p = store.state.products.find((x) => x.id === id); if (p) { p.publish = "publish-ready"; store.save(); rerender(); } },
    "ss-remove-product": (id) => {
      const p = store.state.products.find((x) => x.id === id);
      store.state.products = store.state.products.filter((item) => item.id !== id);
      if (p) pushActivity("Site Studio", `removed product: ${p.name}.`, p.ws);
      store.save(); rerender();
    },
    "ss-pick-hero": () => { ssUi.picker = { kind: "hero" }; rerender(); },
    "ss-pick-product": (id) => { ssUi.picker = { kind: "product", id }; rerender(); },
    "ss-pick-gallery": () => { ssUi.picker = { kind: "gallery" }; rerender(); },
    "ss-media-close": () => { ssUi.picker = null; rerender(); },
    "ss-media-pick": (assetId) => {
      const asset = pickableAssets().find((a) => a.id === assetId);
      const target = ssUi.picker;
      if (!asset || !target || !active) { ssUi.picker = null; rerender(); return; }
      if (target.kind === "hero") {
        active.design.heroImage = asset.url;
        pushActivity("Site Studio", `attached "${asset.title}" as the hero image for ${active.title}.`, active.ws);
      } else if (target.kind === "product") {
        const p = store.state.products.find((x) => x.id === target.id);
        if (p) { p.imageUrl = asset.url; pushActivity("Site Studio", `attached "${asset.title}" to ${p.name}.`, active.ws); }
      } else if (target.kind === "gallery") {
        active.gallery.push({ id: asset.id, url: asset.url, type: asset.type, title: asset.title });
        pushActivity("Site Studio", `added "${asset.title}" to the ${active.title} gallery.`, active.ws);
      }
      active.updated = new Date().toISOString();
      ssUi.picker = null;
      store.save(); rerender();
    },
    "ss-remove-hero": () => { if (active) { active.design.heroImage = ""; store.save(); rerender(); } },
    "ss-remove-gallery": (id) => { if (active) { active.gallery = active.gallery.filter((g) => g.id !== id); store.save(); rerender(); } },
    "ss-seo-generate": () => {
      if (!active) return;
      active.seo.title = `${active.design.brand} — ${active.design.headline}`.slice(0, 60);
      active.seo.description = `${active.design.subhead} ${active.design.offer}`.trim().slice(0, 155);
      pushActivity("Site Studio", `generated SEO for ${active.title}.`, active.ws);
      store.save(); rerender();
    },
    "ss-seo-save": () => { if (active) { pushActivity("Site Studio", `saved SEO settings for ${active.title}.`, active.ws); store.save(); rerender(); } },
    "ss-integration-connect": (id) => {
      const input = el.querySelector(`[data-ss-integration="${id}"]`);
      const value = input?.value.trim();
      const def = INTEGRATION_DEFS.find((d) => d.id === id);
      if (!value) return;
      active.integrations[id] = { status: "connected", value };
      pushActivity("Site Studio", `connected ${def.name} on ${active.title}.`, active.ws);
      store.save(); rerender();
    },
    "ss-integration-disconnect": (id) => {
      const def = INTEGRATION_DEFS.find((d) => d.id === id);
      active.integrations[id] = { status: "not-connected", value: "" };
      pushActivity("Site Studio", `disconnected ${def.name} on ${active.title}.`, active.ws);
      store.save(); rerender();
    },
    "ss-ready": () => { if (active) { active.status = "publish-ready"; active.updated = new Date().toISOString(); pushActivity("Site Studio", `${active.title} is publish-ready.`, active.ws); store.save(); rerender(); } },
    "ss-queue": () => {
      if (!active) return;
      store.state.approvals.unshift({ id: uid("app"), ws: active.ws, type: "publish-page", title: `Publish ${active.title}`, detail: "Reviewed draft. Publishing makes it live.", ref: active.id, status: "pending", requestedBy: "Site Studio", at: new Date().toISOString() });
      pushActivity("Site Studio", `queued publish approval for ${active.title}.`, active.ws);
      store.save(); rerender();
    },
    "ss-open-live": () => {
      const url = active?.design.existingUrl || active?.url;
      if (url) window.open(/^https?:\/\//i.test(url) ? url : `https://${url}`, "_blank", "noopener,noreferrer");
    },
  });

  el.querySelectorAll("[data-ss-switch-site]").forEach((s) => s.onchange = () => { ssUi.activeSiteId = s.value; rerender(); });
  el.querySelectorAll("[data-ss-set]").forEach((input) => {
    input.addEventListener("change", () => { active.design[input.dataset.ssSet] = input.value; active.updated = new Date().toISOString(); store.save(); rerender(); });
  });
  el.querySelectorAll("[data-ss-set-bool]").forEach((input) => {
    input.addEventListener("change", () => { active.design[input.dataset.ssSetBool] = input.checked; store.save(); rerender(); });
  });
  el.querySelectorAll("[data-ss-meta]").forEach((input) => {
    input.addEventListener("change", () => { active[input.dataset.ssMeta] = input.value; store.save(); rerender(); });
  });
  el.querySelectorAll("[data-ss-seo]").forEach((input) => {
    input.addEventListener("change", () => { active.seo[input.dataset.ssSeo] = input.value; store.save(); });
  });
  el.querySelectorAll("[data-ss-setup]").forEach((input) => {
    input.addEventListener("input", () => { setup[input.dataset.ssSetup] = input.value; });
  });
  el.querySelectorAll("[data-ss-setup-goal]").forEach((input) => {
    input.addEventListener("change", () => { setup.goals[input.dataset.ssSetupGoal] = input.checked; });
  });
  el.querySelectorAll("[data-ss-setup-feature]").forEach((input) => {
    input.addEventListener("change", () => { setup.features[input.dataset.ssSetupFeature] = input.checked; });
  });
  el.querySelectorAll("[data-ss-chip]").forEach((chip) => {
    chip.addEventListener("click", () => { const ta = el.querySelector("[data-ss-prompt]"); if (ta) ta.value = chip.dataset.ssChip; });
  });

  const commandForm = el.querySelector("[data-ss-command]");
  if (commandForm) {
    commandForm.onsubmit = (event) => {
      event.preventDefault();
      const input = el.querySelector("[data-ss-prompt]");
      const result = applyWebsitePrompt(active, input?.value || "");
      pushActivity("Site Studio", result, active.ws);
      store.save(); rerender();
    };
  }
}
