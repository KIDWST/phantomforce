/* PhantomForce Websites -- one website preview, one prompt, unlimited domains. */

import {
  store, uid, visible, currentWs, wsName, pushActivity, ago, fmtMoney, workspaceStorageGetItem,
} from "./store.js?v=phantom-live-20260723-51";
import {
  esc, baseSiteDraft, ensureSiteDesign, ensureSiteStore, applyWebsitePrompt, renderWebsitePreview,
  SITE_TEMPLATES, applySiteTemplate, cadenceSuffix,
} from "./workspaces.js?v=phantom-live-20260723-51";
import {
  isDatabaseSession, requestServerPublish, fetchServerRun, fetchServerSites,
  addServerSiteDomain, verifyServerSiteDomain, rollbackServerSite,
} from "./orgs.js?v=phantom-live-20260723-51";

const siteUi = {
  activeSiteId: null, device: "desktop", selectedSection: -1,
  panel: "website", editorMode: "easy", inspectTarget: "hero",
  previewMode: "live", compareIndex: -1, proposal: null,
  cartOpen: false, checkoutOpen: false, confirmation: null,
  serverLoading: new Set(), notice: null,
};
const PHANTOMFORCE_PUBLIC_SOURCE = {
  domain: "phantomforce.online",
  previewUrl: "https://phantomforce.online/",
  files: ["/index.html", "/void.css", "/void.js"],
};
const publicSourceUi = {
  loading: false,
  loaded: false,
  selected: "/index.html",
  error: "",
  files: {},
};
const CONTENT_ASSETS_KEY = "pf.contenthub.assets.v1";
const SITE_INSPECT_TARGETS = [
  { id: "hero", label: "Hero headline", top: 42, left: 50, prompt: "Rewrite the public homepage hero to be clearer, more premium, and more direct without changing the live site until approval." },
  { id: "cta", label: "Primary CTA", top: 72, left: 50, prompt: "Improve the primary call-to-action button copy, spacing, and contrast so it feels obvious and owner-ready." },
  { id: "prompt", label: "AI prompt bar", top: 66, left: 50, prompt: "Make the homepage AI prompt bar feel like a real Phantom web bot that can receive site changes, files, and owner requests." },
  { id: "proof", label: "Proof cards", top: 35, left: 82, prompt: "Add sharper proof cards and social proof language while staying honest about what is live, drafted, or approval-gated." },
  { id: "visual", label: "Hero visual", top: 30, left: 50, prompt: "Refresh the homepage visual treatment using PhantomForce Media Lab assets and a cleaner modern editing surface." },
];
const SITE_STYLE_ACTIONS = [
  ["premium", "Make premium", "Make the selected website area cleaner, more premium, and less cluttered."],
  ["direct", "Make direct", "Rewrite the selected area so a business owner instantly understands the offer and next step."],
  ["contrast", "Fix contrast", "Improve spacing, contrast, and hierarchy for the selected area without changing the brand."],
  ["cta", "Upgrade CTA", "Improve the selected call-to-action copy, hover state, and surrounding support text."],
  ["mobile", "Mobile polish", "Tighten this area for mobile, with no overlapping text or oversized panels."],
  ["fun", "Add Phantom play", "Add a subtle PhantomForce playful touch that keeps the business page professional."],
];
const SITE_QUICK_ELEMENTS = [
  ["asset-hero", "Hero media slot", "Add a hero-ready Media Pool asset slot with alt text, crop controls, and approval before publish."],
  ["proof-card", "Proof card", "Add an honest proof card for missed calls, replies, bookings, or approvals."],
  ["offer-strip", "Offer strip", "Add a clean offer/package strip connected to the Store catalog."],
  ["lead-bot", "Web bot prompt", "Add a Phantom web bot prompt that accepts requests, files, and page-change instructions."],
  ["testimonial", "Review bubble", "Add a review/testimonial bubble placeholder that requires owner approval before publishing."],
  ["section-template", "Section template", "Add a reusable section template from the current PhantomForce style system."],
];

/* ---- version history: a real, persisted undo trail per site ----
   Every mutation (prompt apply, section op, domain change, publish request)
   snapshots the editable state first. Capped so localStorage stays sane. */
const HISTORY_CAP = 12;
const SITE_DIRECT_FIELDS = {
  hero: ["headline", "Headline"],
  cta: ["cta", "Button text"],
  prompt: ["subhead", "Supporting copy"],
  proof: ["offer", "Proof statement"],
  visual: ["style", "Visual direction"],
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function editableSiteState(site) {
  return {
    title: site.title,
    kind: site.kind,
    sections: [...(site.sections || [])],
    design: cloneValue(site.design || {}),
    catalog: cloneValue(site.catalog || []),
    store: cloneValue(site.store || {}),
    copy: cloneValue(site.copy || {}),
    domain: site.domain || "",
    url: site.url || "",
  };
}

function snapshotSite(site, label) {
  site.history = Array.isArray(site.history) ? site.history : [];
  site.history.unshift({
    at: new Date().toISOString(),
    label: String(label || "edit").slice(0, 70),
    data: editableSiteState(site),
  });
  site.history = site.history.slice(0, HISTORY_CAP);
}
function restoreSnapshot(site, index) {
  const snap = (site.history || [])[index];
  if (!snap) return false;
  /* restoring is itself undoable */
  snapshotSite(site, "before restore");
  const kept = site.history;
  Object.assign(site, snap.data, { history: kept });
  site.design = { ...snap.data.design };
  site.sections = [...snap.data.sections];
  site.catalog = JSON.parse(JSON.stringify(snap.data.catalog || []));
  site.store = JSON.parse(JSON.stringify(snap.data.store || {}));
  site.copy = JSON.parse(JSON.stringify(snap.data.copy || {}));
  site.updated = new Date().toISOString();
  /* drop the consumed snapshot (it now sits at index+1 after the unshift) */
  site.history.splice(index + 1, 1);
  return true;
}

export function compareSiteVersion(site, index) {
  const snapshot = (site?.history || [])[index];
  if (!site || !snapshot) return [];
  const before = snapshot.data || {};
  const after = editableSiteState(site);
  const changes = [];
  const add = (label, from, to) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ label, from, to });
  };
  add("Title", before.title || "", after.title || "");
  add("Domain", before.domain || "", after.domain || "");
  add("Sections", before.sections || [], after.sections || []);
  add("Headline", before.design?.headline || "", after.design?.headline || "");
  add("Supporting copy", before.design?.subhead || "", after.design?.subhead || "");
  add("Call to action", before.design?.cta || "", after.design?.cta || "");
  add("Theme", before.design?.theme || "", after.design?.theme || "");
  add("Products", (before.catalog || []).map((item) => `${item.name}:${item.price}`), (after.catalog || []).map((item) => `${item.name}:${item.price}`));
  return changes;
}

export function websiteReadiness(site, databaseMode = false) {
  if (!site) return { ready: false, passed: 0, total: 0, checks: [] };
  const design = ensureSiteDesign(site);
  const products = Array.isArray(site.catalog) ? site.catalog : [];
  const checks = [
    { id: "title", label: "Site title", pass: String(site.title || "").trim().length >= 2, fix: "Add a clear site title." },
    { id: "sections", label: "Page structure", pass: Array.isArray(site.sections) && site.sections.length >= 2, fix: "Add at least two page sections." },
    { id: "headline", label: "Hero message", pass: Boolean(String(design.headline || "").trim()), fix: "Add a hero headline." },
    { id: "cta", label: "Primary action", pass: Boolean(String(design.cta || "").trim()), fix: "Add a primary call to action." },
    { id: "products", label: "Catalog integrity", pass: products.every((item) => String(item.name || "").trim() && Number.isFinite(Number(item.price)) && Number(item.price) >= 0), fix: "Repair incomplete product names or prices." },
    { id: "history", label: "Recovery point", pass: Array.isArray(site.history) && site.history.length > 0, fix: "Make one saved edit so the draft has a recovery point." },
    { id: "publishing", label: databaseMode ? "Verified publishing path" : "Publishing mode disclosed", pass: databaseMode || !site.serverPublish, fix: "Sign in to the server-backed workspace before publishing." },
  ];
  return { ready: checks.every((check) => check.pass), passed: checks.filter((check) => check.pass).length, total: checks.length, checks };
}

function createSiteProposal(site, prompt, label, scope) {
  const candidate = cloneValue(site);
  ensureSiteDesign(candidate);
  ensureSiteStore(candidate);
  const foundDomain = domainFromText(prompt);
  if (foundDomain) setSiteDomain(candidate, foundDomain);
  const result = applyWebsitePrompt(candidate, prompt);
  const before = { ...site, history: [{ data: editableSiteState(site) }] };
  const proxy = { ...candidate, history: before.history };
  const diff = compareSiteVersion(proxy, 0);
  return {
    id: uid("site-proposal"),
    label: String(label || "Website edit").slice(0, 80),
    prompt,
    scope: scope || "Whole site",
    result,
    candidate: editableSiteState(candidate),
    diff,
  };
}

function applyProposal(site, proposal) {
  if (!site || !proposal) return false;
  snapshotSite(site, proposal.label);
  Object.assign(site, cloneValue(proposal.candidate));
  site.updated = new Date().toISOString();
  return true;
}

/* publish state, honestly. With the multi-tenant backend (database auth)
   publishing is REAL: builds validate server-side, publishing waits for an
   org owner/admin approval, and "Live" appears only after the server
   verified the deployment. Without that backend, the old truthful local
   states remain — nothing ever claims "live" unless the server said so. */
function publishState(site) {
  const sp = site.serverPublish;
  if (sp) {
    if (sp.state === "awaiting_approval") return { key: "waiting", label: "Publish approval pending", detail: "A real server action is waiting in Approvals." };
    if (sp.state === "approved" || sp.state === "queued" || sp.state === "executing" || sp.state === "verifying") {
      return { key: "waiting", label: "Publishing…", detail: `Server run ${sp.runId} is ${sp.state}.` };
    }
    if (sp.state === "succeeded") return { key: "live", label: `Live · v${sp.buildVersion}`, detail: `Deployed and verified. Public URL: ${sp.publicPath}` };
    if (sp.state === "rejected") return { key: "draft", label: "Publish rejected", detail: sp.reason ? `Rejected: ${sp.reason}` : "Rejected — edit and request again." };
    if (sp.state === "expired") return { key: "draft", label: "Approval expired", detail: "The approval window passed. Request publish again." };
    if (sp.state === "failed") return { key: "draft", label: "Publish failed", detail: sp.error || "The server run failed — see Developer → Agent runs." };
  }
  const approval = (store.state.approvals || []).find((a) => a.type === "publish-page" && a.ref === site.id && a.status === "pending");
  if (approval) return { key: "waiting", label: "Publish approval pending", detail: "Waiting in the Approval Queue." };
  if (site.status === "approved-to-publish") return { key: "approved", label: "Approved to publish", detail: "Deployment isn't connected yet — nothing is live." };
  return { key: "draft", label: "Draft", detail: "Request approval when it's ready to go out." };
}

/* Non-terminal server publishes refresh their real state on render. */
const TERMINAL_PUBLISH_STATES = new Set(["succeeded", "rejected", "expired", "failed", "cancelled"]);
async function refreshServerPublish(site, rerender) {
  const sp = site.serverPublish;
  if (!sp || TERMINAL_PUBLISH_STATES.has(sp.state)) return;
  const run = await fetchServerRun(sp.runId).catch(() => null);
  if (!run || run.state === sp.state) return;
  sp.state = run.state;
  sp.reason = run.rejection_reason || null;
  sp.error = run.error || null;
  if (run.state === "succeeded") {
    sp.publicPath = `/public/sites/${sp.serverSiteId}`;
    site.url = sp.publicPath;
    const record = (await fetchServerSites().catch(() => [])).find((item) => item.id === sp.serverSiteId);
    if (record) site.serverRecord = record;
    pushActivity("Websites", `${site.title} is LIVE — deployment verified by the server (run ${run.id}).`, site.ws);
  }
  store.save();
  rerender();
}

async function hydrateServerRecord(site, rerender, force = false) {
  if (!isDatabaseSession() || !site?.serverSiteId) return;
  if (!force && site.serverRecord) return;
  if (siteUi.serverLoading.has(site.id)) return;
  const siteId = site.id;
  siteUi.serverLoading.add(siteId);
  try {
    const record = (await fetchServerSites()).find((item) => item.id === site.serverSiteId);
    if (record && siteUi.activeSiteId === siteId) {
      site.serverRecord = record;
      store.save();
      rerender();
    }
  } finally {
    siteUi.serverLoading.delete(siteId);
  }
}

function slugText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9.-]+/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function domainFromText(value) {
  const match = String(value || "").match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  return match ? slugText(match[0]) : "";
}

function domainTitle(domain) {
  const root = String(domain || "Website").replace(/^www\./, "").split(".")[0] || "Website";
  return root.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function siteDomain(site) {
  const design = ensureSiteDesign(site);
  return slugText(site.domain || design.existingUrl || site.url || "");
}

function setSiteDomain(site, value) {
  const domain = slugText(value);
  const design = ensureSiteDesign(site);
  site.domain = domain;
  site.url = domain ? `https://${domain}` : "";
  design.existingUrl = domain;
  return domain;
}

function normalizeSite(site) {
  ensureSiteDesign(site);
  ensureSiteStore(site);
  const legacyTerminaStarter = /termina\s*-\s*terminal workflow manager store/i.test(String(site.title || ""))
    || siteDomain(site) === "termina.phantomforce.online";
  if (legacyTerminaStarter && site.design.migrationVersion !== "phantomforce-public-v1") {
    snapshotSite(site, "legacy Termina starter");
    applySiteTemplate(site, "phantomforce");
    setSiteDomain(site, PHANTOMFORCE_PUBLIC_SOURCE.domain);
    site.design.migrationVersion = "phantomforce-public-v1";
    site.updated = new Date().toISOString();
    pushActivity("Websites", "migrated the retired Termina starter to the PhantomForce public-site workspace.", site.ws);
    store.save();
  }
  site.domains = Array.isArray(site.domains) ? site.domains : [];
  const domain = siteDomain(site);
  if (domain && !site.domains.includes(domain)) site.domains.unshift(domain);
  return site;
}

function isPhantomForcePublicSite(site) {
  if (!site) return false;
  const design = ensureSiteDesign(site);
  return siteDomain(site) === PHANTOMFORCE_PUBLIC_SOURCE.domain
    || design.sourceKind === "phantomforce_public_source";
}

async function loadPublicSiteSource(rerender) {
  if (publicSourceUi.loading) return;
  publicSourceUi.loading = true;
  publicSourceUi.error = "";
  try {
    const pairs = await Promise.all(PHANTOMFORCE_PUBLIC_SOURCE.files.map(async (path) => {
      const response = await fetch(`${path}?pf-site-source=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${path} returned ${response.status}`);
      return [path, await response.text()];
    }));
    publicSourceUi.files = Object.fromEntries(pairs);
    publicSourceUi.loaded = true;
    if (!PHANTOMFORCE_PUBLIC_SOURCE.files.includes(publicSourceUi.selected)) {
      publicSourceUi.selected = PHANTOMFORCE_PUBLIC_SOURCE.files[0];
    }
  } catch (error) {
    publicSourceUi.error = error?.message || "Could not read the local public site source.";
  } finally {
    publicSourceUi.loading = false;
    rerender?.();
  }
}

function loadSiteMediaAssets() {
  let raw = null;
  try { raw = JSON.parse(workspaceStorageGetItem(CONTENT_ASSETS_KEY) || "null"); } catch {}
  const list = Array.isArray(raw?.assets) ? raw.assets : Array.isArray(raw) ? raw : [];
  return list
    .filter((asset) => asset && asset.removed !== true)
    .slice(0, 8)
    .map((asset) => ({
      id: asset.id || uid("asset"),
      title: asset.title || asset.name || "Media Pool asset",
      type: asset.type || asset.kind || "asset",
      source: asset.source || "Media Pool",
      url: asset.url || asset.previewUrl || asset.thumbnail || asset.thumbnailUrl || "",
    }));
}

function selectedInspectTarget() {
  return SITE_INSPECT_TARGETS.find((target) => target.id === siteUi.inspectTarget) || SITE_INSPECT_TARGETS[0];
}

function siteAssetRailMarkup() {
  const assets = loadSiteMediaAssets();
  const realAssets = assets.length ? assets : [];
  return `
    <section class="ss-asset-bank" aria-label="Media Lab assets and quick elements">
      <div class="ss-editor-heading">
        <p>Assets & quick elements</p>
        <b>${realAssets.length ? `${realAssets.length} Media Pool item${realAssets.length === 1 ? "" : "s"}` : "Template presets"}</b>
      </div>
      ${realAssets.length ? `
        <div class="ss-asset-grid">
          ${realAssets.slice(0, 4).map((asset) => `
            <button type="button" class="ss-asset-card" data-ss-asset-preset="Use the Media Pool asset named '${esc(asset.title)}' in the selected website area. Make it crop-safe, add alt text, and keep the change approval-gated.">
              ${asset.url ? `<img src="${esc(asset.url)}" alt="">` : `<span>${esc(String(asset.type || "asset").slice(0, 1).toUpperCase())}</span>`}
              <b>${esc(asset.title)}</b>
              <small>${esc(asset.source)} · ${esc(asset.type)}</small>
            </button>`).join("")}
        </div>` : `
        <div class="ss-quick-grid">
          ${SITE_QUICK_ELEMENTS.map(([id, label, prompt]) => `
            <button type="button" data-ss-asset-preset="${esc(prompt)}" aria-label="${esc(label)}">
              <b>${esc(label)}</b><span>${esc(id.replace(/-/g, " "))}</span>
            </button>`).join("")}
        </div>`}
    </section>`;
}

function siteEasyEditorMarkup(site) {
  const target = selectedInspectTarget();
  const design = ensureSiteDesign(site);
  const [field, fieldLabel] = SITE_DIRECT_FIELDS[target.id] || SITE_DIRECT_FIELDS.hero;
  const fieldValue = design[field] || "";
  return `
    <aside class="ss-site-editor-panel" aria-label="AI website editor">
      <div class="ss-editor-tabs" role="tablist" aria-label="Website editor mode">
        <button type="button" class="${siteUi.editorMode === "easy" ? "is-active" : ""}" data-ss-editor-mode="easy">Easy edit</button>
        <button type="button" class="${siteUi.editorMode === "code" ? "is-active" : ""}" data-ss-editor-mode="code">Code</button>
      </div>
      ${siteUi.editorMode === "code" ? siteSourceCodeMarkup(site) : `
        <div class="ss-editor-heading">
          <p>AI Website Editor</p>
          <h3>${esc(target.label)}</h3>
          <span>Click a page region, choose a smart change, or type the exact outcome. Phantom drafts it first; publish still requires approval.</span>
        </div>
        <div class="ss-inspector-list" aria-label="Clickable page regions">
          ${SITE_INSPECT_TARGETS.map((item) => `
            <button type="button" class="${item.id === target.id ? "is-active" : ""}" data-ss-inspect-target="${esc(item.id)}">
              <b>${esc(item.label)}</b><span>${esc(item.id)}</span>
            </button>`).join("")}
        </div>
        <form class="ss-direct-editor" data-ss-direct-form data-field="${esc(field)}">
          <label for="ss-direct-${esc(field)}">${esc(fieldLabel)}</label>
          <textarea id="ss-direct-${esc(field)}" data-ss-direct-value rows="3">${esc(fieldValue)}</textarea>
          <button type="submit">Save ${esc(target.label)}</button>
        </form>
        <div class="ss-ai-option-grid" aria-label="AI edit suggestions">
          ${SITE_STYLE_ACTIONS.map(([id, label, prompt]) => `
            <button type="button" data-ss-ai-style="${esc(`${target.prompt} ${prompt}`)}">
              <b>${esc(label)}</b><span>${esc(id)}</span>
            </button>`).join("")}
        </div>
        ${siteAssetRailMarkup()}
      `}
    </aside>`;
}

function siteSourceCodeMarkup(site) {
  const design = ensureSiteDesign(site);
  const files = Array.isArray(design.sourceFiles) && design.sourceFiles.length
    ? design.sourceFiles
    : PHANTOMFORCE_PUBLIC_SOURCE.files;
  const selected = files.includes(publicSourceUi.selected) ? publicSourceUi.selected : files[0];
  const code = publicSourceUi.files[selected] || "";
  return `
    <div class="ss-public-source-code">
      <div>
        <p>Actual source</p>
        <b>${esc(design.sourceRoot || "/")}</b>
      </div>
      <div class="ss-public-source-tabs">
        ${files.map((path) => `<button type="button" class="${path === selected ? "is-active" : ""}" data-ss-source-file="${esc(path)}">${esc(path.replace(/^\//, ""))}</button>`).join("")}
      </div>
      ${publicSourceUi.error ? `<p class="ss-source-error">${esc(publicSourceUi.error)}</p>` : ""}
      ${publicSourceUi.loaded
        ? `<textarea readonly spellcheck="false">${esc(code)}</textarea>`
        : `<div class="ss-source-quiet">
             <button class="btn btn-ghost" type="button" data-ss-source-load>${publicSourceUi.loading ? "Reading source..." : "Read source files"}</button>
             <span>Code is available when you need it. Easy edit stays first so owners can work visually.</span>
           </div>`}
    </div>`;
}

function publicSourcePreviewMarkup(site) {
  const draft = siteUi.previewMode === "draft";
  return `
    <div class="ss-public-source">
      <div class="ss-public-source-frame">
        <div class="site-browser-bar">
          <span></span><span></span><span></span>
          <b>${esc(PHANTOMFORCE_PUBLIC_SOURCE.domain)}</b>
          <div class="ss-preview-toggle" role="group" aria-label="Preview source">
            <button type="button" class="${draft ? "" : "is-active"}" data-ss-preview-mode="live">Live</button>
            <button type="button" class="${draft ? "is-active" : ""}" data-ss-preview-mode="draft">Draft</button>
          </div>
        </div>
        <div class="ss-frame-stage">
          <div class="ss-live-hotspots" aria-label="Website click-to-edit regions">
            ${SITE_INSPECT_TARGETS.map((target) => `
              <button type="button" class="${target.id === siteUi.inspectTarget ? "is-active" : ""}" style="--top:${target.top}%;--left:${target.left}%;" data-ss-inspect-target="${esc(target.id)}">
                <span>${esc(target.label)}</span>
              </button>`).join("")}
          </div>
          ${draft
            ? `<div class="ss-structured-draft" aria-label="Structured website draft preview">${renderWebsitePreview(site, productsFor(site), { selected: siteUi.selectedSection, interactive: true, cart: ensureSiteStore(site).cart })}</div>`
            : `<iframe src="${esc(PHANTOMFORCE_PUBLIC_SOURCE.previewUrl)}?pf-site-preview=${Date.now()}" title="Live PhantomForce public website preview" loading="lazy"></iframe>`}
        </div>
      </div>
      ${siteEasyEditorMarkup(site)}
    </div>`;
}

function productsFor(site) {
  if (!site) return [];
  return (site.catalog || []).filter((product) => product.visible !== false);
}

function cartItems(site) {
  const cart = ensureSiteStore(site).cart;
  return productsFor(site)
    .map((product) => ({ product, qty: Math.max(0, Number(cart[product.id] || 0)) }))
    .filter((item) => item.qty > 0);
}

function cartCount(site) {
  return cartItems(site).reduce((sum, item) => sum + item.qty, 0);
}

function cartTotal(site) {
  return cartItems(site).reduce((sum, item) => sum + (Number(item.product.price || 0) * item.qty), 0);
}

function cadenceOptions(selected) {
  return [["one_time", "One time"], ["monthly", "Monthly"], ["yearly", "Yearly"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value || (value === "one_time" && !["monthly", "yearly"].includes(selected)) ? "selected" : ""}>${label}</option>`).join("");
}

function typeOptions(selected) {
  return `<option value="physical" ${selected === "digital" ? "" : "selected"}>Physical — ships</option>
    <option value="digital" ${selected === "digital" ? "selected" : ""}>Digital — link/email</option>`;
}

function orderItemCount(order) {
  return (order.items || []).reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
}

function productEditorMarkup(site) {
  const products = productsFor(site);
  const allOrders = ensureSiteStore(site).orders;
  const orders = allOrders.slice(0, 5);
  return `
    <aside class="ss-store-console" aria-label="Store editor">
      <header>
        <div><p>Store editor</p><h3>${products.length} product${products.length === 1 ? "" : "s"}</h3></div>
        <span>Test checkout · no payment</span>
      </header>
      <form class="ss-product-add" data-ss-product-add>
        <input name="name" placeholder="Product or service" aria-label="Product name" required />
        <div><input name="price" type="number" min="0" step="0.01" placeholder="Price" aria-label="Price" required />
          <select name="cadence" aria-label="Billing">${cadenceOptions("one_time")}</select></div>
        <select name="type" aria-label="Fulfillment">${typeOptions("physical")}</select>
        <input name="desc" placeholder="Short description" aria-label="Product description" />
        <button class="btn btn-primary" type="submit">Add product</button>
      </form>
      <div class="ss-product-list">
        ${products.map((product) => `
          <article data-ss-product-row="${esc(product.id)}">
            <button type="button" class="ss-product-delete" data-ss-product-delete="${esc(product.id)}" aria-label="Remove ${esc(product.name)}">×</button>
            <input name="name" value="${esc(product.name)}" aria-label="Product name" />
            <div><input name="price" type="number" min="0" step="0.01" value="${esc(product.price)}" aria-label="Price" />
              <select name="cadence" aria-label="Billing">${cadenceOptions(product.cadence)}</select></div>
            <select name="type" aria-label="Fulfillment" data-ss-product-type="${esc(product.id)}">${typeOptions(product.type)}</select>
            <input name="desc" value="${esc(product.desc || "")}" aria-label="Description" />
            ${product.type === "digital" ? `
            <div class="ss-delivery-fields">
              <small>Digital delivery — shown on the buyer's receipt</small>
              <input name="delivery_url" value="${esc(product.delivery_url || "")}" placeholder="Delivery link (download or license portal)" aria-label="Delivery link" />
              <input name="delivery_note" value="${esc(product.delivery_note || "")}" placeholder="Delivery note (e.g. license key emailed within minutes)" aria-label="Delivery note" />
            </div>` : ""}
            <button class="btn btn-quiet" type="button" data-ss-product-save="${esc(product.id)}">Save</button>
          </article>`).join("") || `<p class="ss-store-empty">No placeholder products. Add the first real offer above.</p>`}
      </div>
      <section class="ss-test-orders">
        <div><b>Test orders</b><span>${allOrders.length}</span></div>
        ${orders.map((order) => `<p><b>${esc(order.receipt)}</b><span>${orderItemCount(order)} item${orderItemCount(order) === 1 ? "" : "s"} · ${fmtMoney(order.total)} · ${ago(order.at)} · test — no charge</span></p>`).join("") || `<small>Place a test order to prove the cart and checkout.</small>`}
        ${allOrders.length > orders.length ? `<small>Showing the latest ${orders.length} of ${allOrders.length} test orders.</small>` : ""}
      </section>
    </aside>`;
}

function cartMarkup(site) {
  const items = cartItems(site);
  return `
    <aside class="ss-cart" data-ss-cart>
      <header><div><p>Store test</p><h3>Your cart</h3></div><button type="button" data-ss-cart-close aria-label="Close cart">×</button></header>
      <div class="ss-cart-items">
        ${items.map(({ product, qty }) => `<article>
          <div><b>${esc(product.name)}</b><span>${fmtMoney(product.price)}${cadenceSuffix(product.cadence)}</span></div>
          ${product.type === "digital" ? `<i class="ss-digital-tag">Digital download · no shipping</i>` : ""}
          <div class="ss-cart-qty"><button type="button" data-ss-cart-dec="${esc(product.id)}" aria-label="Decrease quantity">−</button><b>${qty}</b><button type="button" data-ss-cart-inc="${esc(product.id)}" aria-label="Increase quantity">+</button><button type="button" data-ss-cart-remove="${esc(product.id)}">Remove</button></div>
        </article>`).join("") || `<p class="ss-store-empty">Your cart is empty. Add a product from the preview.</p>`}
      </div>
      <footer><span>Total</span><b>${fmtMoney(cartTotal(site))}</b></footer>
      <button class="btn btn-primary" type="button" data-ss-checkout-open ${items.length ? "" : "disabled"}>Start test checkout</button>
      <small>No card details. No payment will be charged.</small>
    </aside>`;
}

function checkoutMarkup(site) {
  const items = cartItems(site);
  /* digital-only orders skip shipping entirely — email is the delivery
     address. Any physical item brings the shipping block back. */
  const needsShipping = items.some(({ product }) => product.type !== "digital");
  return `
    <div class="ss-checkout-backdrop" data-ss-checkout-backdrop>
      <section class="ss-checkout" role="dialog" aria-modal="true" aria-labelledby="ss-checkout-title">
        <header><div><p>Safe store proof</p><h3 id="ss-checkout-title">Test checkout</h3></div><button type="button" data-ss-checkout-close aria-label="Close checkout">×</button></header>
        <div class="ss-checkout-summary">${items.map(({ product, qty }) => `<p><span>${qty} × ${esc(product.name)}${product.type === "digital" ? " (digital)" : ""}</span><b>${fmtMoney(product.price * qty)}</b></p>`).join("")}</div>
        <form data-ss-checkout-form>
          <label>Name<input name="name" autocomplete="name" required placeholder="Jordan West" /></label>
          <label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com" /></label>
          ${needsShipping ? `
          <div class="ss-checkout-shipping">
            <span>Shipping</span>
            <label>Address<input name="address" autocomplete="street-address" required placeholder="Street address" /></label>
            <label>City<input name="city" autocomplete="address-level2" required placeholder="City" /></label>
            <label>Postal code<input name="postal" autocomplete="postal-code" required placeholder="Postal code" /></label>
          </div>` : `
          <p class="ss-checkout-digital">Digital order — nothing ships. Delivery details appear on your receipt and go to the email above.</p>`}
          <div class="ss-checkout-total"><span>Total</span><b>${fmtMoney(cartTotal(site))}</b></div>
          <p class="ss-testmode-chip" role="note">Test mode — no real charge</p>
          <button class="btn btn-primary" type="submit">Place test order</button>
          <small>This verifies the storefront flow only. No payment is collected or sent anywhere.</small>
        </form>
      </section>
    </div>`;
}

function confirmationMarkup(confirmation) {
  const digital = Array.isArray(confirmation.digital) ? confirmation.digital : [];
  return `
    <div class="ss-order-confirmation is-receipt" role="status">
      <div class="ss-receipt-head">
        <b>Test order confirmed · ${esc(confirmation.receipt)}</b>
        <span class="ss-testmode-chip">Test mode — no real charge</span>
      </div>
      <span>${fmtMoney(confirmation.total)} · receipt sent to ${esc(confirmation.email || "the checkout email")} · No payment was charged.</span>
      ${digital.length ? `
      <div class="ss-receipt-delivery">
        <b>Your digital delivery</b>
        ${digital.map((item) => `<p><b>${esc(item.name)}</b>${item.delivery_url ? ` — <a href="${esc(item.delivery_url)}" target="_blank" rel="noopener">access link</a>` : ""}${item.delivery_note ? ` — ${esc(item.delivery_note)}` : (item.delivery_url ? "" : " — the store owner will email your access details.")}</p>`).join("")}
      </div>` : ""}
    </div>`;
}

function createWebsite(seed = "") {
  const text = String(seed || "").trim();
  const defaultPublicSite = !text;
  const domain = domainFromText(defaultPublicSite ? "phantomforce.online" : text);
  const title = defaultPublicSite ? "PhantomForce" : domain ? domainTitle(domain) : wsName(currentWs());
  const draft = baseSiteDraft(title, "Website");
  draft.id = uid("site");
  draft.ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  draft.status = "draft";
  draft.updated = new Date().toISOString();
  draft.domains = [];
  setSiteDomain(draft, domain);
  if (defaultPublicSite) {
    applySiteTemplate(draft, "phantomforce");
    setSiteDomain(draft, "phantomforce.online");
  } else {
    applyWebsiteChange(draft, text, false);
  }
  store.state.sites.unshift(draft);
  siteUi.activeSiteId = draft.id;
  pushActivity("Websites", `created ${draft.title}.`, draft.ws);
  store.save();
  return draft;
}

function applyWebsiteChange(site, prompt, touch = true) {
  const text = String(prompt || "").trim();
  if (!site || !text) return "Tell Phantom what to change first.";
  const foundDomain = domainFromText(text);
  if (foundDomain) setSiteDomain(site, foundDomain);
  const result = applyWebsitePrompt(site, text);
  if (touch) {
    site.updated = new Date().toISOString();
    pushActivity("Websites", result, site.ws);
  }
  return result;
}

function siteOptionLabel(site) {
  const domain = siteDomain(site);
  return domain ? `${site.title} - ${domain}` : site.title;
}

function valueSummary(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value || "Not set");
}

function siteProposalMarkup(proposal) {
  if (!proposal) return "";
  return `
    <section class="ss-proposal" aria-label="Proposed website change" aria-live="polite">
      <header>
        <div><p>Preview before applying</p><h3>${esc(proposal.label)}</h3><span>${esc(proposal.scope)}</span></div>
        <span>${proposal.diff.length} change${proposal.diff.length === 1 ? "" : "s"}</span>
      </header>
      <div class="ss-proposal-diff">
        ${proposal.diff.map((change) => `
          <article>
            <b>${esc(change.label)}</b>
            <div><span>Before</span><p>${esc(valueSummary(change.from))}</p></div>
            <div><span>After</span><p>${esc(valueSummary(change.to))}</p></div>
          </article>`).join("") || `<p>No material change was produced. Refine the instruction or discard this proposal.</p>`}
      </div>
      <footer>
        <p>${esc(proposal.result || "Draft prepared.")}</p>
        <button class="btn btn-quiet" type="button" data-act="ss-proposal-discard">Discard</button>
        <button class="btn btn-primary" type="button" data-act="ss-proposal-apply" ${proposal.diff.length ? "" : "disabled"}>Apply draft</button>
      </footer>
    </section>`;
}

function versionCompareMarkup(site) {
  if (siteUi.compareIndex < 0) return "";
  const snap = (site.history || [])[siteUi.compareIndex];
  if (!snap) return "";
  const changes = compareSiteVersion(site, siteUi.compareIndex);
  return `
    <section class="ss-version-compare" aria-label="Version comparison">
      <header>
        <div><p>Version compare</p><h3>Current draft vs ${esc(snap.label)}</h3><span>${ago(snap.at)}</span></div>
        <button type="button" aria-label="Close version comparison" data-act="ss-compare-close">×</button>
      </header>
      <div>
        ${changes.map((change) => `
          <article><b>${esc(change.label)}</b><span>${esc(valueSummary(change.from))}</span><i>→</i><strong>${esc(valueSummary(change.to))}</strong></article>`).join("")
          || `<p>The current draft matches this recovery point.</p>`}
      </div>
      <footer>
        <button class="btn btn-quiet" type="button" data-ss-restore="${siteUi.compareIndex}">Restore this version</button>
      </footer>
    </section>`;
}

function siteReadinessMarkup(site) {
  const readiness = websiteReadiness(site, isDatabaseSession());
  const firstBlocker = readiness.checks.find((check) => !check.pass);
  return `
    <details class="ss-readiness" ${readiness.ready ? "" : "open"}>
      <summary>
        <span>Launch readiness</span>
        <b>${readiness.passed}/${readiness.total}</b>
        <i>${readiness.ready ? "Ready for verified publish" : esc(firstBlocker?.fix || "Review required")}</i>
      </summary>
      <div>
        ${readiness.checks.map((check) => `
          <p class="${check.pass ? "is-pass" : "is-blocked"}"><b>${check.pass ? "✓" : "!"}</b><span>${esc(check.label)}</span><small>${check.pass ? "Ready" : esc(check.fix)}</small></p>`).join("")}
      </div>
    </details>`;
}

function serverLifecycleMarkup(site) {
  const record = site.serverRecord;
  const domains = record?.domains || [];
  const deployments = record?.deployments || [];
  const current = deployments.find((item) => item.status === "published") || deployments[0];
  const customDomain = siteDomain(site);
  if (!isDatabaseSession() && !site.serverPublish) return "";
  return `
    <section class="ss-release-receipt" aria-label="Publishing and domain evidence">
      <header><div><p>Release evidence</p><h3>${site.serverPublish?.state === "succeeded" ? "Verified deployment" : "Server publishing"}</h3></div>
        ${site.serverPublish?.runId ? `<code>${esc(site.serverPublish.runId)}</code>` : ""}</header>
      <div class="ss-receipt-grid">
        <p><span>Build</span><b>${site.serverPublish?.buildVersion ? `v${esc(site.serverPublish.buildVersion)}` : "Not built"}</b></p>
        <p><span>State</span><b>${esc(site.serverPublish?.state || "Not requested")}</b></p>
        <p><span>Public path</span><b>${esc(record?.publicPath || site.serverPublish?.publicPath || "Not live")}</b></p>
        <p><span>Deployment</span><b>${esc(current?.id || "None")}</b></p>
      </div>
      ${customDomain ? `
        <div class="ss-domain-evidence">
          <b>${esc(customDomain)}</b>
          ${domains.length ? domains.map((domain) => `
            <p><span>${esc(domain.state)} · SSL ${esc(domain.sslState || "unknown")}</span>
              <button class="btn btn-quiet" type="button" data-ss-verify-domain="${esc(domain.id)}">Verify DNS</button></p>
            ${domain.verificationToken ? `<code>_phantomforce-verify.${esc(domain.domain)} TXT ${esc(domain.verificationToken)}</code>` : ""}`).join("")
            : site.serverSiteId
              ? `<button class="btn btn-quiet" type="button" data-act="ss-connect-domain">Connect and verify domain</button>`
              : `<span>Build the site once before connecting this domain.</span>`}
        </div>` : ""}
      ${deployments.filter((item) => item.status === "published" || item.status === "rolled_back").length > 1
        ? `<button class="btn btn-quiet" type="button" data-act="ss-rollback-live">Rollback to previous live version</button>` : ""}
    </section>`;
}

function emptyMarkup() {
  return `
    <section class="ss-simple is-empty">
      <div class="ss-simple-empty">
        <div class="ss-simple-empty-copy">
          <p>phantomforce.online</p>
          <h3>Edit the public site.</h3>
          <span>Start from the PhantomForce public site, then keep refining copy, sections, store items, and checkout proof from here.</span>
        </div>
        <form class="ss-simple-prompt" data-ss-prompt-form>
          <textarea data-ss-prompt rows="8" placeholder="Describe what to change on phantomforce.online..."></textarea>
          <button class="btn btn-primary" type="submit">Open PhantomForce site</button>
          <div class="ss-template-row">
            <p>Public-site starter:</p>
            ${Object.values(SITE_TEMPLATES).map((template) => `<button class="btn btn-quiet" type="button" data-ss-template="${esc(template.id)}">${esc(template.label)}</button>`).join("")}
          </div>
        </form>
      </div>
    </section>`;
}

function shellMarkup(active, sites, products) {
  const domain = siteDomain(active);
  return `
    <section class="ss-simple">
      <header class="ss-simple-top">
        <div class="ss-simple-switcher">
          <select data-ss-switch aria-label="Website">
            ${sites.map((site) => `<option value="${site.id}" ${site.id === active.id ? "selected" : ""}>${esc(siteOptionLabel(site))}</option>`).join("")}
          </select>
          <span>${sites.length} website${sites.length === 1 ? "" : "s"}</span>
        </div>
        <div class="ss-simple-actions">
          <details class="ss-template-picker">
            <summary>Templates</summary>
            <div>${Object.values(SITE_TEMPLATES).map((template) => `<button type="button" data-ss-template="${esc(template.id)}">${esc(template.label)}</button>`).join("")}</div>
          </details>
          <button class="btn btn-quiet" type="button" data-act="ss-new-site">New website</button>
          <button class="btn btn-quiet" type="button" data-act="ss-remove-site" data-id="${esc(active.id)}">Delete</button>
        </div>
      </header>

      <div class="ss-simple-sites" aria-label="Websites">
        ${sites.map((site) => `
          <button class="ss-simple-site ${site.id === active.id ? "is-active" : ""}" type="button" data-ss-site="${esc(site.id)}">
            <b>${esc(site.title)}</b>
            <span>${esc(siteDomain(site) || "No domain yet")}</span>
          </button>`).join("")}
      </div>

      <div class="ss-simple-domain">
        <form data-ss-domain-form>
          <label>
            <span>Domain</span>
            <input data-ss-domain value="${esc(domain)}" placeholder="yourdomain.com" />
          </label>
          <button class="btn btn-quiet" type="submit">Save domain</button>
        </form>
      </div>

      <div class="ss-editbar">
        <div class="ss-modebar" role="tablist" aria-label="Website tools">
          <button type="button" role="tab" aria-selected="${siteUi.panel === "website"}" class="${siteUi.panel === "website" ? "is-active" : ""}" data-ss-panel="website">Website</button>
          <button type="button" role="tab" aria-selected="${siteUi.panel === "store"}" class="${siteUi.panel === "store" ? "is-active" : ""}" data-ss-panel="store">Store <span>${products.length}</span></button>
        </div>
        <div class="ss-devbar" role="group" aria-label="Preview device">
          ${[["desktop", "Desktop"], ["tablet", "Tablet"], ["phone", "Phone"]].map(([id, label]) =>
            `<button type="button" class="${siteUi.device === id ? "is-active" : ""}" data-ss-device="${id}">${label}</button>`).join("")}
        </div>
        <div class="ss-editbar-actions">
          <button class="btn btn-quiet" type="button" data-act="ss-undo" ${(active.history || []).length ? "" : "disabled"}>Undo</button>
          <details class="ss-history" data-ss-history>
            <summary>History (${(active.history || []).length})</summary>
            <div class="ss-history-list">
              ${(active.history || []).map((snap, index) => `
                <article>
                  <div><b>${esc(snap.label)}</b><span>${ago(snap.at)}</span></div>
                  <button type="button" data-ss-compare="${index}">Compare</button>
                  <button type="button" data-ss-restore="${index}">Restore</button>
                </article>`).join("") || `<p>No versions yet — every edit saves one automatically.</p>`}
            </div>
          </details>
          ${(() => {
            const state = publishState(active);
            if (state.key === "draft") return `<button class="btn btn-quiet" type="button" data-act="ss-request-publish" title="${esc(state.detail)}">Request publish approval</button>`;
            if (state.key === "live") return `
              <a class="ss-publish-chip ss-publish-live" href="${esc(active.serverPublish?.publicPath || "#")}" target="_blank" rel="noopener" title="${esc(state.detail)}">${esc(state.label)}</a>
              <button class="btn btn-quiet" type="button" data-act="ss-request-publish" title="Build and publish the current edits (approval required)">Publish update</button>`;
            return `<span class="ss-publish-chip ss-publish-${state.key}" title="${esc(state.detail)}">${esc(state.label)}</span>`;
          })()}
        </div>
      </div>

      ${siteUi.notice ? `<p class="ss-lifecycle-notice ${siteUi.notice.kind === "error" ? "is-error" : ""}" role="status">${esc(siteUi.notice.text)}</p>` : ""}
      ${siteProposalMarkup(siteUi.proposal)}
      ${versionCompareMarkup(active)}
      ${siteReadinessMarkup(active)}

      <main class="ss-simple-main ${siteUi.panel === "store" ? "has-store-console" : ""}">
        <div class="ss-simple-preview ss-device-${esc(siteUi.device)}" data-ss-preview>${isPhantomForcePublicSite(active) ? publicSourcePreviewMarkup(active) : renderWebsitePreview(active, products, { selected: siteUi.selectedSection, interactive: true, cart: ensureSiteStore(active).cart })}</div>
        ${siteUi.panel === "store" ? productEditorMarkup(active) : ""}
        ${siteUi.cartOpen ? cartMarkup(active) : ""}
      </main>

      ${siteUi.selectedSection >= 0 && active.sections[siteUi.selectedSection] !== undefined ? `
      <div class="ss-section-toolbar" data-ss-section-toolbar>
        <b>Section: ${esc(active.sections[siteUi.selectedSection])}</b>
        <input data-ss-section-name value="${esc(active.sections[siteUi.selectedSection])}" aria-label="Rename section" />
        <button class="btn btn-quiet" type="button" data-act="ss-section-rename">Rename</button>
        <button class="btn btn-quiet" type="button" data-act="ss-section-up" ${siteUi.selectedSection === 0 ? "disabled" : ""}>Move up</button>
        <button class="btn btn-quiet" type="button" data-act="ss-section-down" ${siteUi.selectedSection >= active.sections.length - 1 ? "disabled" : ""}>Move down</button>
        <button class="btn btn-quiet ss-section-remove" type="button" data-act="ss-section-remove">Remove</button>
        <button class="btn btn-quiet" type="button" data-act="ss-section-done">Done</button>
      </div>` : `
      <p class="ss-select-hint">Click a section in the preview to rename, reorder, or remove it.</p>`}

      <form class="ss-simple-prompt" data-ss-prompt-form>
        <textarea data-ss-prompt rows="3" placeholder="${siteUi.selectedSection >= 0 && active.sections[siteUi.selectedSection] !== undefined
          ? `Describe a change for the ${esc(active.sections[siteUi.selectedSection])} section — or the whole site.`
          : "Describe the change. Example: make the hero simpler, add testimonials, use chicagoshots.com"}"></textarea>
        <button class="btn btn-primary" type="submit">Update website</button>
      </form>

      ${siteUi.confirmation ? confirmationMarkup(siteUi.confirmation) : ""}

      ${serverLifecycleMarkup(active)}
      <p class="ss-simple-status">Last edited ${ago(active.updated || new Date().toISOString())}</p>
      ${siteUi.checkoutOpen ? checkoutMarkup(active) : ""}
    </section>`;
}

export function renderSiteStudio(el) {
  const rerender = () => renderSiteStudio(el);
  let sites = visible(store.state.sites).map(normalizeSite);
  if (!sites.length) {
    createWebsite("");
    sites = visible(store.state.sites).map(normalizeSite);
  }
  /* chat handoff: when Phantom just built or edited a site from the chat,
     it leaves a one-shot focus hint so this page opens ON that project —
     one website system, two doors. */
  try {
    const focus = sessionStorage.getItem("pf.sites.focus.v1");
    if (focus && sites.some((site) => site.id === focus)) {
      siteUi.activeSiteId = focus;
      sessionStorage.removeItem("pf.sites.focus.v1");
    }
  } catch {}
  if (!siteUi.activeSiteId || !sites.some((site) => site.id === siteUi.activeSiteId)) {
    siteUi.activeSiteId = sites[0]?.id || null;
  }
  const active = sites.find((site) => site.id === siteUi.activeSiteId) || null;

  if (!active) {
    el.innerHTML = emptyMarkup();
  } else {
    el.innerHTML = shellMarkup(active, sites, productsFor(active));
  }

  el.querySelectorAll("[data-ss-switch]").forEach((select) => {
    select.onchange = () => {
      siteUi.activeSiteId = select.value;
      siteUi.cartOpen = false; siteUi.checkoutOpen = false; siteUi.confirmation = null;
      siteUi.proposal = null; siteUi.compareIndex = -1; siteUi.notice = null;
      rerender();
    };
  });

  el.querySelectorAll("[data-ss-site]").forEach((button) => {
    button.onclick = () => {
      siteUi.activeSiteId = button.dataset.ssSite;
      siteUi.cartOpen = false; siteUi.checkoutOpen = false; siteUi.confirmation = null;
      siteUi.proposal = null; siteUi.compareIndex = -1; siteUi.notice = null;
      rerender();
    };
  });

  el.querySelectorAll("[data-ss-template]").forEach((button) => {
    button.onclick = () => {
      const templateId = button.dataset.ssTemplate;
      const site = active || createWebsite("");
      snapshotSite(site, `apply ${templateId} starter`);
      if (!applySiteTemplate(site, templateId)) return;
      if (templateId === "phantomforce") setSiteDomain(site, "phantomforce.online");
      siteUi.activeSiteId = site.id;
      siteUi.panel = "store";
      siteUi.cartOpen = false;
      siteUi.checkoutOpen = false;
      siteUi.confirmation = null;
      siteUi.proposal = null;
      siteUi.compareIndex = -1;
      siteUi.previewMode = "draft";
      pushActivity("Websites", `applied the ${templateId} public-site starter to ${site.title}.`, site.ws);
      store.save();
      rerender();
    };
  });

  el.querySelectorAll("[data-act='ss-new-site']").forEach((button) => {
    button.onclick = () => {
      createWebsite("");
      siteUi.panel = "website";
      siteUi.cartOpen = false;
      siteUi.checkoutOpen = false;
      siteUi.confirmation = null;
      siteUi.proposal = null;
      siteUi.compareIndex = -1;
      rerender();
    };
  });

  el.querySelectorAll("[data-act='ss-remove-site']").forEach((button) => {
    button.onclick = () => {
      const target = store.state.sites.find((site) => site.id === button.dataset.id);
      // Deleting a whole site is irreversible and sat one misclick away.
      if (target && !confirm(`Delete the website "${target.title}"? This removes its content and revision history and cannot be undone.`)) return;
      store.state.sites = store.state.sites.filter((site) => site.id !== button.dataset.id);
      siteUi.activeSiteId = store.state.sites[0]?.id || null;
      siteUi.cartOpen = false;
      siteUi.checkoutOpen = false;
      siteUi.confirmation = null;
      siteUi.proposal = null;
      siteUi.compareIndex = -1;
      if (target) pushActivity("Websites", `deleted ${target.title}.`, target.ws);
      store.save();
      rerender();
    };
  });

  const domainForm = el.querySelector("[data-ss-domain-form]");
  if (domainForm && active) {
    domainForm.onsubmit = (event) => {
      event.preventDefault();
      snapshotSite(active, "domain change");
      const domain = setSiteDomain(active, el.querySelector("[data-ss-domain]")?.value || "");
      active.updated = new Date().toISOString();
      pushActivity("Websites", domain ? `set ${domain} as the website domain.` : "cleared the website domain.", active.ws);
      store.save();
      rerender();
    };
  }

  el.querySelectorAll("[data-ss-prompt-form]").forEach((form) => {
    form.onsubmit = (event) => {
      event.preventDefault();
      const input = form.querySelector("[data-ss-prompt]");
      const prompt = (input?.value || "").trim();
      if (!prompt) return;
      const site = active || createWebsite(prompt);
      /* a selected section focuses the edit: its name is prepended so the
         prompt engine's section-aware rules see the target */
      const section = siteUi.selectedSection >= 0 && site.sections[siteUi.selectedSection] !== undefined
        ? site.sections[siteUi.selectedSection]
        : "";
      const target = section ? `${section}: ${prompt}` : prompt;
      siteUi.proposal = createSiteProposal(site, target, prompt.slice(0, 60), section || "Whole site");
      siteUi.notice = { kind: "info", text: "Draft prepared. Review the before/after changes, then apply or discard." };
      rerender();
    };
  });

  /* ---- editor controls: device preview, undo, history, publish ---- */
  el.querySelectorAll("[data-ss-device]").forEach((button) => {
    button.onclick = () => { siteUi.device = button.dataset.ssDevice; rerender(); };
  });
  el.querySelectorAll("[data-ss-preview-mode]").forEach((button) => {
    button.onclick = () => {
      siteUi.previewMode = button.dataset.ssPreviewMode === "draft" ? "draft" : "live";
      rerender();
    };
  });

  el.querySelectorAll("[data-ss-panel]").forEach((button) => {
    button.onclick = () => { siteUi.panel = button.dataset.ssPanel; siteUi.cartOpen = false; rerender(); };
  });

  el.querySelectorAll("[data-ss-editor-mode]").forEach((button) => {
    button.onclick = () => {
      siteUi.editorMode = button.dataset.ssEditorMode === "code" ? "code" : "easy";
      rerender();
    };
  });
  el.querySelectorAll("[data-ss-inspect-target]").forEach((button) => {
    button.onclick = () => {
      siteUi.inspectTarget = button.dataset.ssInspectTarget || SITE_INSPECT_TARGETS[0].id;
      rerender();
    };
  });
  const applyPublicSitePrompt = (prompt, label = "AI website edit") => {
    if (!active || !prompt) return;
    siteUi.proposal = createSiteProposal(active, prompt, label, selectedInspectTarget().label);
    siteUi.notice = { kind: "info", text: "AI proposal prepared. Nothing changed yet." };
    rerender();
  };
  el.querySelectorAll("[data-ss-ai-style]").forEach((button) => {
    button.onclick = () => applyPublicSitePrompt(button.dataset.ssAiStyle || "", selectedInspectTarget().label);
  });
  el.querySelectorAll("[data-ss-asset-preset]").forEach((button) => {
    button.onclick = () => applyPublicSitePrompt(`${selectedInspectTarget().prompt} ${button.dataset.ssAssetPreset || ""}`, "asset-assisted website edit");
  });
  const directForm = el.querySelector("[data-ss-direct-form]");
  if (directForm && active) directForm.onsubmit = (event) => {
    event.preventDefault();
    const field = directForm.dataset.field;
    if (!Object.values(SITE_DIRECT_FIELDS).some(([candidate]) => candidate === field)) return;
    const next = directForm.querySelector("[data-ss-direct-value]")?.value.trim() || "";
    if (!next) return;
    snapshotSite(active, `edit ${selectedInspectTarget().label}`);
    ensureSiteDesign(active)[field] = next.slice(0, field === "style" ? 120 : 300);
    active.updated = new Date().toISOString();
    siteUi.previewMode = "draft";
    siteUi.notice = { kind: "info", text: `${selectedInspectTarget().label} saved to the draft. Live remains unchanged until approved publishing succeeds.` };
    pushActivity("Websites", `updated ${selectedInspectTarget().label.toLowerCase()} on ${active.title}.`, active.ws);
    store.save();
    rerender();
  };

  const applyProposalButton = el.querySelector("[data-act='ss-proposal-apply']");
  if (applyProposalButton && active) applyProposalButton.onclick = () => {
    const proposal = siteUi.proposal;
    if (!proposal || !applyProposal(active, proposal)) return;
    siteUi.proposal = null;
    siteUi.previewMode = "draft";
    siteUi.notice = { kind: "info", text: "Draft applied and recovery point saved. The live site is unchanged." };
    pushActivity("Websites", `applied ${proposal.label.toLowerCase()} to the draft for ${active.title}.`, active.ws);
    if (active.catalog?.length) siteUi.panel = "store";
    store.save();
    rerender();
  };
  const discardProposalButton = el.querySelector("[data-act='ss-proposal-discard']");
  if (discardProposalButton) discardProposalButton.onclick = () => {
    siteUi.proposal = null;
    siteUi.notice = { kind: "info", text: "Proposal discarded. The draft was not changed." };
    rerender();
  };

  el.querySelectorAll("[data-ss-source-file]").forEach((button) => {
    button.onclick = () => {
      publicSourceUi.selected = button.dataset.ssSourceFile || PHANTOMFORCE_PUBLIC_SOURCE.files[0];
      rerender();
    };
  });
  el.querySelectorAll("[data-ss-source-load]").forEach((button) => {
    button.onclick = () => loadPublicSiteSource(rerender);
  });

  const productAdd = el.querySelector("[data-ss-product-add]");
  if (productAdd && active) productAdd.onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(productAdd);
    const name = String(data.get("name") || "").trim();
    const price = Number(data.get("price"));
    if (!name || !Number.isFinite(price) || price < 0) return;
    snapshotSite(active, `add product ${name}`);
    const cadence = ["monthly", "yearly"].includes(data.get("cadence")) ? data.get("cadence") : "one_time";
    active.catalog.push({
      id: uid("prod"), name: name.slice(0, 64), price, cadence,
      type: data.get("type") === "digital" ? "digital" : "physical",
      delivery_url: "", delivery_note: "",
      desc: String(data.get("desc") || "").trim().slice(0, 180), visible: true,
    });
    active.kind = "Store";
    active.design.storeEnabled = true;
    active.store.enabled = true;
    if (!active.sections.some((section) => /^(store|products)$/i.test(section))) active.sections.push("Store");
    if (!active.sections.some((section) => /^checkout$/i.test(section))) active.sections.push("Checkout");
    active.updated = new Date().toISOString();
    pushActivity("Websites", `added ${name} to ${active.title}.`, active.ws);
    store.save(); rerender();
  };

  const saveProductRow = (productId, row) => {
    if (!active || !row) return;
    const product = active.catalog.find((item) => item.id === productId);
    if (!product) return;
    const name = row.querySelector("[name='name']")?.value.trim();
    const price = Number(row.querySelector("[name='price']")?.value);
    if (!name || !Number.isFinite(price) || price < 0) return;
    snapshotSite(active, `edit product ${product.name}`);
    product.name = name.slice(0, 64);
    product.price = price;
    const cadence = row.querySelector("[name='cadence']")?.value;
    product.cadence = ["monthly", "yearly"].includes(cadence) ? cadence : "one_time";
    product.type = row.querySelector("[name='type']")?.value === "digital" ? "digital" : "physical";
    product.desc = row.querySelector("[name='desc']")?.value.trim().slice(0, 180) || "";
    if (product.type === "digital") {
      product.delivery_url = row.querySelector("[name='delivery_url']")?.value.trim().slice(0, 600) ?? product.delivery_url ?? "";
      product.delivery_note = row.querySelector("[name='delivery_note']")?.value.trim().slice(0, 300) ?? product.delivery_note ?? "";
    }
    active.updated = new Date().toISOString();
    store.save(); rerender();
  };
  el.querySelectorAll("[data-ss-product-save]").forEach((button) => {
    button.onclick = () => saveProductRow(button.dataset.ssProductSave, button.closest("[data-ss-product-row]"));
  });
  /* flipping Physical ↔ Digital saves the row immediately so the delivery
     fields appear/disappear without a separate Save click */
  el.querySelectorAll("[data-ss-product-type]").forEach((select) => {
    select.onchange = () => saveProductRow(select.dataset.ssProductType, select.closest("[data-ss-product-row]"));
  });

  el.querySelectorAll("[data-ss-product-delete]").forEach((button) => {
    button.onclick = () => {
      if (!active) return;
      const product = active.catalog.find((item) => item.id === button.dataset.ssProductDelete);
      if (!product) return;
      snapshotSite(active, `remove product ${product.name}`);
      active.catalog = active.catalog.filter((item) => item.id !== product.id);
      delete active.store.cart[product.id];
      active.updated = new Date().toISOString();
      store.save(); rerender();
    };
  });

  el.querySelectorAll("[data-ss-cart-add]").forEach((button) => {
    button.onclick = () => {
      if (!active) return;
      const id = button.dataset.ssCartAdd;
      active.store.cart[id] = Number(active.store.cart[id] || 0) + 1;
      siteUi.cartOpen = true;
      siteUi.confirmation = null;
      store.save(); rerender();
    };
  });
  el.querySelectorAll("[data-ss-cart-open]").forEach((button) => { button.onclick = () => { siteUi.cartOpen = true; rerender(); }; });
  el.querySelectorAll("[data-ss-cart-close]").forEach((button) => { button.onclick = () => { siteUi.cartOpen = false; rerender(); }; });
  const updateCart = (id, next) => {
    if (!active) return;
    /* quantities are whole numbers, clamped 0–99 — NaN or absurd values from
       stale state can no longer wedge the total */
    const qty = Math.min(99, Math.max(0, Math.floor(Number(next) || 0)));
    if (qty <= 0) delete active.store.cart[id]; else active.store.cart[id] = qty;
    store.save(); rerender();
  };
  el.querySelectorAll("[data-ss-cart-inc]").forEach((button) => { button.onclick = () => updateCart(button.dataset.ssCartInc, Number(active?.store.cart[button.dataset.ssCartInc] || 0) + 1); });
  el.querySelectorAll("[data-ss-cart-dec]").forEach((button) => { button.onclick = () => updateCart(button.dataset.ssCartDec, Number(active?.store.cart[button.dataset.ssCartDec] || 0) - 1); });
  el.querySelectorAll("[data-ss-cart-remove]").forEach((button) => { button.onclick = () => updateCart(button.dataset.ssCartRemove, 0); });
  el.querySelectorAll("[data-ss-checkout-open]").forEach((button) => { button.onclick = () => { siteUi.checkoutOpen = true; siteUi.cartOpen = false; rerender(); }; });
  el.querySelectorAll("[data-ss-checkout-close]").forEach((button) => { button.onclick = () => { siteUi.checkoutOpen = false; rerender(); }; });
  /* clicking the dimmed backdrop closes the checkout, like every other modal */
  const checkoutBackdrop = el.querySelector("[data-ss-checkout-backdrop]");
  if (checkoutBackdrop) checkoutBackdrop.onclick = (event) => {
    if (event.target === checkoutBackdrop) { siteUi.checkoutOpen = false; rerender(); }
  };

  const checkoutForm = el.querySelector("[data-ss-checkout-form]");
  if (checkoutForm && active) checkoutForm.onsubmit = (event) => {
    event.preventDefault();
    const items = cartItems(active);
    if (!items.length) { siteUi.checkoutOpen = false; rerender(); return; }
    const data = new FormData(checkoutForm);
    const needsShipping = items.some(({ product }) => product.type !== "digital");
    const email = String(data.get("email") || "").trim();
    const receipt = `PF-TEST-${Date.now().toString(36).toUpperCase()}`;
    active.store.orders.unshift({
      id: uid("order"), receipt, at: new Date().toISOString(), status: "test_confirmed", testMode: true,
      customer: { name: String(data.get("name") || "").trim(), email },
      /* digital-only orders carry no shipping — email is the delivery address */
      shipping: needsShipping ? {
        address: String(data.get("address") || "").trim(),
        city: String(data.get("city") || "").trim(),
        postal: String(data.get("postal") || "").trim(),
      } : null,
      items: items.map(({ product, qty }) => ({
        productId: product.id, name: product.name, price: product.price, cadence: product.cadence, qty,
        type: product.type === "digital" ? "digital" : "physical",
        delivery_url: product.type === "digital" ? (product.delivery_url || "") : "",
        delivery_note: product.type === "digital" ? (product.delivery_note || "") : "",
      })),
      total: cartTotal(active),
    });
    active.store.cart = {};
    active.updated = new Date().toISOString();
    siteUi.checkoutOpen = false;
    siteUi.confirmation = {
      receipt,
      email,
      total: active.store.orders[0].total,
      digital: active.store.orders[0].items.filter((item) => item.type === "digital"),
    };
    pushActivity("Websites", `completed test checkout ${receipt} on ${active.title}; no payment was charged.`, active.ws);
    store.save(); rerender();
  };

  const undoBtn = el.querySelector("[data-act='ss-undo']");
  if (undoBtn && active) undoBtn.onclick = () => {
    /* undo = restore the newest snapshot */
    const snap = (active.history || [])[0];
    if (!snap) return;
    const kept = active.history.slice(1);
    Object.assign(active, snap.data, { history: kept });
    active.design = { ...snap.data.design };
    active.sections = [...snap.data.sections];
    active.catalog = JSON.parse(JSON.stringify(snap.data.catalog || []));
    active.store = JSON.parse(JSON.stringify(snap.data.store || {}));
    active.copy = JSON.parse(JSON.stringify(snap.data.copy || {}));
    active.updated = new Date().toISOString();
    pushActivity("Websites", `undid the last edit on ${active.title}.`, active.ws);
    store.save();
    rerender();
  };

  el.querySelectorAll("[data-ss-restore]").forEach((button) => {
    button.onclick = () => {
      if (!active) return;
      if (restoreSnapshot(active, Number(button.dataset.ssRestore))) {
        siteUi.compareIndex = -1;
        siteUi.proposal = null;
        siteUi.previewMode = "draft";
        pushActivity("Websites", `restored an earlier version of ${active.title}.`, active.ws);
        store.save();
        rerender();
      }
    };
  });
  el.querySelectorAll("[data-ss-compare]").forEach((button) => {
    button.onclick = () => {
      siteUi.compareIndex = Number(button.dataset.ssCompare);
      rerender();
    };
  });
  const closeCompare = el.querySelector("[data-act='ss-compare-close']");
  if (closeCompare) closeCompare.onclick = () => {
    siteUi.compareIndex = -1;
    rerender();
  };

  const publishBtn = el.querySelector("[data-act='ss-request-publish']");
  if (publishBtn && active) publishBtn.onclick = async () => {
    snapshotSite(active, "publish requested");
    if (isDatabaseSession()) {
      /* the REAL pipeline: server-side build + validation, then an
         approval-gated publish run — nothing goes live until approved */
      publishBtn.disabled = true;
      const result = await requestServerPublish(active);
      if (result.ok) {
        active.serverSiteId = result.serverSiteId;
        active.serverPublish = {
          runId: result.run.id,
          state: result.run.state,
          buildId: result.buildId,
          buildVersion: result.buildVersion,
          serverSiteId: result.serverSiteId,
          publicPath: null,
          reason: null,
          error: null,
        };
        siteUi.notice = { kind: "info", text: `Build v${result.buildVersion} validated. Publish run ${result.run.id} is waiting for approval.` };
        pushActivity("Websites", `built v${result.buildVersion} of ${active.title} and requested publish approval (run ${result.run.id}).`, active.ws);
      } else {
        const why = result.error === "upgrade_required" ? "your current plan doesn't include publishing"
          : result.error === "build_validation_failed" ? "the build failed validation"
          : `the server refused (${result.error})`;
        siteUi.notice = { kind: "error", text: `Publish did not start: ${why}. Your draft is preserved.` };
        pushActivity("Websites", `publish request for ${active.title} did not start: ${why}.`, active.ws);
      }
      store.save();
      rerender();
      return;
    }
    store.state.approvals.unshift({
      id: uid("app"), ws: active.ws, type: "publish-page",
      title: `Publish website: ${active.title}`,
      detail: `${siteDomain(active) ? `Domain: ${siteDomain(active)}. ` : ""}Approving marks it approved-to-publish. Deployment is not connected yet — nothing goes live automatically.`,
      ref: active.id, status: "pending", requestedBy: "Websites", at: new Date().toISOString(),
    });
    pushActivity("Websites", `requested publish approval for ${active.title}.`, active.ws);
    siteUi.notice = { kind: "info", text: "Approval requested. This local workspace cannot claim a live deployment." };
    store.save();
    rerender();
  };
  if (active) refreshServerPublish(active, rerender);
  if (active) hydrateServerRecord(active, rerender);

  const connectDomain = el.querySelector("[data-act='ss-connect-domain']");
  if (connectDomain && active) connectDomain.onclick = async () => {
    const domain = siteDomain(active);
    if (!domain || !active.serverSiteId) return;
    connectDomain.disabled = true;
    const result = await addServerSiteDomain(active.serverSiteId, domain);
    if (result.ok) {
      siteUi.notice = { kind: "info", text: result.domain.instructions || "Domain registered. Add the verification TXT record, then verify DNS." };
      active.serverRecord = null;
      await hydrateServerRecord(active, rerender, true);
    } else {
      siteUi.notice = { kind: "error", text: ["upgrade_required", "feature_not_available"].includes(result.error) ? "Custom domains require an eligible plan." : `Domain connection failed: ${result.error}.` };
      rerender();
    }
  };
  el.querySelectorAll("[data-ss-verify-domain]").forEach((button) => {
    button.onclick = async () => {
      if (!active?.serverSiteId) return;
      button.disabled = true;
      const result = await verifyServerSiteDomain(active.serverSiteId, button.dataset.ssVerifyDomain);
      siteUi.notice = result.ok
        ? { kind: result.domain.state === "verified" ? "info" : "error", text: result.check?.detail || `Domain state: ${result.domain.state}.` }
        : { kind: "error", text: `Domain verification failed: ${result.error}.` };
      active.serverRecord = null;
      await hydrateServerRecord(active, rerender, true);
    };
  });
  const rollbackLive = el.querySelector("[data-act='ss-rollback-live']");
  if (rollbackLive && active) rollbackLive.onclick = async () => {
    if (!active.serverSiteId || !confirm("Rollback the public site to its previous verified deployment?")) return;
    rollbackLive.disabled = true;
    const result = await rollbackServerSite(active.serverSiteId);
    if (result.ok) {
      siteUi.notice = { kind: "info", text: `Rollback verified. Deployment ${result.deployment.id} is now live.` };
      active.serverRecord = null;
      await hydrateServerRecord(active, rerender, true);
    } else {
      siteUi.notice = { kind: "error", text: `Rollback failed: ${result.error}. The current deployment was not changed.` };
      rerender();
    }
  };

  /* ---- section selection + toolbar ---- */
  const preview = el.querySelector("[data-ss-preview]");
  if (preview) {
    preview.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-ss-sec]");
      if (!chip) return;
      const index = Number(chip.dataset.ssSec);
      siteUi.selectedSection = siteUi.selectedSection === index ? -1 : index;
      rerender();
    });
  }
  if (active && siteUi.selectedSection >= 0) {
    const nameInput = el.querySelector("[data-ss-section-name]");
    const bind = (act, fn) => { const b = el.querySelector(`[data-act='${act}']`); if (b) b.onclick = fn; };
    bind("ss-section-rename", () => {
      const next = (nameInput?.value || "").trim();
      if (!next) return;
      snapshotSite(active, `rename section to ${next}`);
      active.sections[siteUi.selectedSection] = next.slice(0, 48);
      active.updated = new Date().toISOString();
      store.save(); rerender();
    });
    bind("ss-section-up", () => {
      const i = siteUi.selectedSection;
      if (i <= 0) return;
      snapshotSite(active, `move ${active.sections[i]} up`);
      [active.sections[i - 1], active.sections[i]] = [active.sections[i], active.sections[i - 1]];
      siteUi.selectedSection = i - 1;
      active.updated = new Date().toISOString();
      store.save(); rerender();
    });
    bind("ss-section-down", () => {
      const i = siteUi.selectedSection;
      if (i >= active.sections.length - 1) return;
      snapshotSite(active, `move ${active.sections[i]} down`);
      [active.sections[i + 1], active.sections[i]] = [active.sections[i], active.sections[i + 1]];
      siteUi.selectedSection = i + 1;
      active.updated = new Date().toISOString();
      store.save(); rerender();
    });
    bind("ss-section-remove", () => {
      snapshotSite(active, `remove ${active.sections[siteUi.selectedSection]} section`);
      active.sections.splice(siteUi.selectedSection, 1);
      siteUi.selectedSection = -1;
      active.updated = new Date().toISOString();
      store.save(); rerender();
    });
    bind("ss-section-done", () => { siteUi.selectedSection = -1; rerender(); });
  }

  const promptInput = el.querySelector("[data-ss-prompt]");
  if (promptInput && preview && active && !isPhantomForcePublicSite(active)) {
    promptInput.addEventListener("input", () => {
      const clone = JSON.parse(JSON.stringify(active));
      applyWebsiteChange(clone, promptInput.value, false);
      preview.innerHTML = renderWebsitePreview(clone, productsFor(clone), { selected: siteUi.selectedSection, cart: clone.store?.cart || {} });
    });
  }
}
