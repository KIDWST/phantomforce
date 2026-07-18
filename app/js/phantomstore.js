import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260718-1";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const CATEGORIES = ["All", "AI Tool", "Agent", "CLI", "Library", "Extension", "Model", "Template", "Dataset"];
const INSTALL_METHODS = ["manual", "npm", "pip", "git", "docker", "brew", "binary"];
const cssEscape = (value) => globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
const safeHref = (value) => {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
};

const ui = {
  tab: "discover",
  loading: true,
  busy: false,
  error: "",
  message: "",
  query: "",
  category: "All",
  snapshot: null,
  installToolId: "",
  installMessage: "",
  buyingProductId: "",
  buyMessage: "",
  /* In-app product detail view (sub-view state, same pattern PhantomPlay uses
     for game detail: internal state, marked with a data attribute — the shell
     router only routes #ws/<workspace> so sub-views stay in-workspace). */
  productId: "",
  variantChoice: {},
  /* Admin product editor ("" closed, "new" creating, else product id). */
  adminProductId: "",
  adminProductMessage: "",
};

/* Deterministic branded tile for products that have no real image asset yet:
   generated in code from the product name, clearly a brand tile (initials +
   PhantomStore wordmark), never a fabricated photo and never hotlinked. */
const BRAND_ACCENTS = ["#41ffa1", "#42e9ff", "#ff6d83", "#ffd166", "#b28dff"];
function brandTileUrl(product) {
  const name = String(product?.name || "Product");
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const accent = BRAND_ACCENTS[hash % BRAND_ACCENTS.length];
  const initials = name.split(/\s+/).map((word) => word[0] || "").join("").slice(0, 3).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img">
    <rect width="640" height="360" fill="#04100c"/>
    <rect x="6" y="6" width="628" height="348" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
    <circle cx="536" cy="72" r="120" fill="${accent}" fill-opacity="0.08"/>
    <text x="48" y="86" fill="${accent}" font-family="monospace" font-size="20" font-weight="700" letter-spacing="6">PHANTOMSTORE</text>
    <text x="44" y="228" fill="${accent}" font-family="monospace" font-size="120" font-weight="800">${esc(initials)}</text>
    <text x="48" y="300" fill="#eafff4" font-family="monospace" font-size="28" font-weight="700">${esc(name.slice(0, 30))}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function productImageUrl(product) {
  const url = String(product?.imageUrl || "").trim();
  if (/^\/(?!\/)[\w\-./]+$/.test(url)) return url;
  return safeHref(url) || brandTileUrl(product);
}

function inventoryOf(product) {
  const inventory = product?.inventory && typeof product.inventory === "object" ? product.inventory : { mode: "unlimited" };
  return inventory.mode === "tracked" ? { mode: "tracked", stock: Math.max(0, Number(inventory.stock || 0)) } : { mode: "unlimited" };
}

function outOfStock(product) {
  const inventory = inventoryOf(product);
  return inventory.mode === "tracked" && inventory.stock <= 0;
}

function inventoryLabel(product) {
  if (product?.status === "quality_hold") return "Quality hold — purchasing paused";
  const inventory = inventoryOf(product);
  if (inventory.mode === "tracked") return inventory.stock > 0 ? `${inventory.stock} in stock` : "Out of stock";
  return "Digital delivery — always in stock";
}

function productVariants(product) {
  return Array.isArray(product?.variants) ? product.variants : [];
}

function selectedVariant(product) {
  const variants = productVariants(product);
  if (!variants.length) return null;
  const chosenId = ui.variantChoice[product.id];
  return variants.find((variant) => variant.id === chosenId) || variants.find((variant) => variant.available) || variants[0];
}

function priceUsdLabel(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return "";
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

function productBuyable(product) {
  if (product?.status !== "available" || outOfStock(product)) return false;
  const variant = selectedVariant(product);
  return !variant || variant.available === true;
}

let mountedRoot = null;
let searchTimer = 0;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load PhantomStore.", fallbackPrefix: "PhantomStore request failed" }));
  }
  return payload;
}

async function hydrate() {
  ui.loading = true;
  ui.error = "";
  render();
  try {
    ui.snapshot = await api(`/api/phantomstore?tenant_id=${encodeURIComponent(currentTenantId())}`);
  } catch (error) {
    ui.error = error instanceof Error ? error.message : "PhantomStore is unavailable.";
    ui.snapshot = null;
  } finally {
    ui.loading = false;
    render();
  }
}

function statusLabel(status) {
  return String(status || "draft").replaceAll("_", " ");
}

function visibleCatalog() {
  const tools = Array.isArray(ui.snapshot?.catalog) ? ui.snapshot.catalog : [];
  const q = ui.query.trim().toLowerCase();
  return tools.filter((tool) => {
    const matchesCategory = ui.category === "All" || tool.category === ui.category;
    const haystack = `${tool.name || ""} ${tool.summary || ""} ${tool.description || ""} ${(tool.tags || []).join(" ")} ${tool.developerName || ""}`.toLowerCase();
    return matchesCategory && (!q || haystack.includes(q));
  }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || Number(b.installClicks || 0) - Number(a.installClicks || 0) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function visibleProducts() {
  const products = Array.isArray(ui.snapshot?.products) ? ui.snapshot.products : [];
  const q = ui.query.trim().toLowerCase();
  return products.filter((product) => {
    const haystack = `${product.name || ""} ${product.summary || ""} ${product.description || ""} ${(product.tags || []).join(" ")} ${product.seller?.name || ""}`.toLowerCase();
    return !q || haystack.includes(q);
  }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || Number(b.rating || 0) - Number(a.rating || 0));
}

function visibleSellers() {
  const sellers = Array.isArray(ui.snapshot?.sellers) ? ui.snapshot.sellers : [];
  const q = ui.query.trim().toLowerCase();
  return sellers.filter((seller) => {
    const haystack = `${seller.name || ""} ${seller.tagline || ""} ${seller.summary || ""}`.toLowerCase();
    return !q || haystack.includes(q);
  }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || Number(b.rating || 0) - Number(a.rating || 0));
}

function reviewList(reviews = []) {
  return reviews.length ? `<div class="ps-reviews">${reviews.slice(0, 2).map((review) => `
    <blockquote>
      <b>${esc(review.rating || 0)} / 5 · ${esc(review.title || "Review")}</b>
      <span>${esc(review.body || "")}</span>
      <small>${esc(review.authorName || "Verified buyer")}${review.verified ? " / verified" : ""}</small>
    </blockquote>`).join("")}</div>` : "";
}

function productCard(product) {
  const seller = product.seller || {};
  const buyUrl = safeHref(product.buyUrl);
  const isBuying = ui.buyingProductId === product.id;
  const available = productBuyable(product);
  return `<article class="ps-product ${product.featured ? "is-featured" : ""}">
    <button type="button" class="ps-product-media" data-ps-detail="${esc(product.id)}" aria-label="Open ${esc(product.name)} details">
      <img src="${productImageUrl(product)}" alt="${esc(product.name)} product image" loading="lazy" />
    </button>
    <header>
      <div>
        <p class="ps-kicker">${esc(product.category)} / ${esc(product.delivery || "Digital delivery")}</p>
        <h3><button type="button" class="ps-title-link" data-ps-detail="${esc(product.id)}">${esc(product.name)}</button></h3>
      </div>
      <span>${esc(product.priceLabel || "Contact")}</span>
    </header>
    <p>${esc(product.summary)}</p>
    <div class="ps-product-proof">
      <b>${esc(product.rating || "New")} / 5</b>
      <span>${Number(product.reviewCount || 0)} product reviews</span>
      <span>Seller: ${esc(seller.name || "Seller")}</span>
      <span>${esc(inventoryLabel(product))}</span>
    </div>
    <div class="ps-tags">${(product.badges || product.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    <small>${esc(product.qualityNote || "")}</small>
    <div class="ps-card-actions">
      <button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${available ? "" : "disabled"}>${isBuying ? "Preparing..." : esc(product.buyLabel || "Buy now")}</button>
      <button type="button" class="ps-secondary" data-ps-detail="${esc(product.id)}">View details</button>
      ${buyUrl ? `<a class="ps-secondary" href="${esc(buyUrl)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ""}
    </div>
    ${ui.buyingProductId === product.id && ui.buyMessage ? `<div class="ps-buy-note">${esc(ui.buyMessage)}</div>` : ""}
    ${reviewList(product.reviews || [])}
  </article>`;
}

function renderProductDetail(product) {
  const seller = product.seller || {};
  const buyUrl = safeHref(product.buyUrl);
  const isBuying = ui.buyingProductId === product.id;
  const available = productBuyable(product);
  const variants = productVariants(product);
  const chosen = selectedVariant(product);
  const gallery = (Array.isArray(product.gallery) ? product.gallery : []).map((entry) => productImageUrl({ ...product, imageUrl: entry }));
  const websiteUrl = safeHref(seller.websiteUrl);
  const supportUrl = safeHref(seller.supportUrl);
  return `<section class="ps-detail" data-ps-product-view="${esc(product.id)}">
    <button type="button" class="ps-secondary ps-detail-back" data-ps-back>&larr; Back to Discover</button>
    <div class="ps-detail-grid">
      <div class="ps-detail-media">
        <img src="${productImageUrl(product)}" alt="${esc(product.name)} product image" />
        ${gallery.length ? `<div class="ps-detail-gallery">${gallery.map((src, index) => `<img src="${src}" alt="${esc(product.name)} gallery image ${index + 1}" loading="lazy" />`).join("")}</div>` : ""}
      </div>
      <div class="ps-detail-info">
        <p class="ps-kicker">${esc(product.category)} / ${esc(product.delivery || "Digital delivery")} / v${esc(product.version || "1.0.0")}</p>
        <h2>${esc(product.name)}</h2>
        <p class="ps-detail-summary">${esc(product.summary)}</p>
        <div class="ps-detail-price">
          <b>${esc(chosen ? priceUsdLabel(chosen.priceUsd) || product.priceLabel : product.priceLabel || "Contact")}</b>
          <span>${esc(product.priceLabel || "")}</span>
        </div>
        <div class="ps-product-proof">
          <b>${esc(product.rating || "New")} / 5</b>
          <span>${Number(product.reviewCount || 0)} product reviews</span>
          <span>${esc(inventoryLabel(product))}</span>
        </div>
        ${variants.length ? `<div class="ps-variants" role="radiogroup" aria-label="Choose a variant">
          <p class="ps-kicker">VARIANT</p>
          ${variants.map((variant) => `<label class="ps-variant ${chosen?.id === variant.id ? "is-active" : ""} ${variant.available ? "" : "is-unavailable"}">
            <input type="radio" name="ps-variant-${esc(product.id)}" value="${esc(variant.id)}" data-ps-variant="${esc(product.id)}" ${chosen?.id === variant.id ? "checked" : ""} ${variant.available ? "" : "disabled"} />
            <span>${esc(variant.label)}</span>
            <b>${esc(priceUsdLabel(variant.priceUsd) || "—")}</b>
            ${variant.available ? "" : "<i>Unavailable</i>"}
          </label>`).join("")}
        </div>` : ""}
        <div class="ps-card-actions">
          <button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${available ? "" : "disabled"}>${isBuying ? "Preparing..." : esc(product.buyLabel || "Buy now")}</button>
          ${buyUrl ? `<a class="ps-secondary" href="${esc(buyUrl)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ""}
        </div>
        ${ui.buyingProductId === product.id && ui.buyMessage ? `<div class="ps-buy-note">${esc(ui.buyMessage)}</div>` : ""}
        <small>${esc(product.qualityNote || "")}</small>
        <div class="ps-detail-seller">
          <p class="ps-kicker">SELLER</p>
          <b>${esc(seller.name || "Seller")}</b>
          <span>${esc(seller.tagline || "")}</span>
          <div class="ps-card-actions">
            ${websiteUrl ? `<a class="ps-secondary" href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
            ${supportUrl ? `<a class="ps-secondary" href="${esc(supportUrl)}" target="_blank" rel="noopener noreferrer">Support</a>` : ""}
          </div>
        </div>
      </div>
    </div>
    <div class="ps-detail-description">
      <p class="ps-kicker">ABOUT THIS PRODUCT</p>
      <p>${esc(product.description || product.summary || "")}</p>
      <div class="ps-tags">${(product.badges || []).concat(product.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    </div>
    ${reviewList(product.reviews || [])}
  </section>`;
}

function sellerCard(seller) {
  const websiteUrl = safeHref(seller.websiteUrl);
  const supportUrl = safeHref(seller.supportUrl);
  return `<article class="ps-seller">
    <header>
      <div>
        <p class="ps-kicker">${esc(seller.handle || "@seller")}</p>
        <h3>${esc(seller.name)}</h3>
      </div>
      <span>${esc(seller.rating || "New")} / 5</span>
    </header>
    <p>${esc(seller.tagline || seller.summary || "")}</p>
    <small>${Number(seller.productCount || 0)} products / ${Number(seller.reviewCount || 0)} seller reviews</small>
    ${reviewList(seller.reviews || [])}
    <div class="ps-card-actions">
      ${websiteUrl ? `<a class="ps-secondary" href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
      ${supportUrl ? `<a class="ps-secondary" href="${esc(supportUrl)}" target="_blank" rel="noopener noreferrer">Support</a>` : ""}
    </div>
  </article>`;
}

function toolCard(tool) {
  const active = ui.installToolId === tool.id;
  const homepageUrl = safeHref(tool.homepageUrl);
  const repoUrl = safeHref(tool.repoUrl);
  return `<article class="ps-tool ${tool.featured ? "is-featured" : ""}">
    <header>
      <div>
        <p class="ps-kicker">${esc(tool.category)} / v${esc(tool.version || "1.0.0")}</p>
        <h3>${esc(tool.name)}</h3>
      </div>
      <span>${tool.featured ? "Featured" : `${Number(tool.installClicks || 0)} installs`}</span>
    </header>
    <p>${esc(tool.summary)}</p>
    <div class="ps-tags">${(tool.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    <small>By ${esc(tool.developerName || "Developer")} / ${esc(tool.installMethod || "manual")}</small>
    <div class="ps-card-actions">
      <button type="button" class="ps-primary" data-ps-install="${esc(tool.id)}">${active ? "Install details open" : "View install"}</button>
      ${homepageUrl ? `<a class="ps-secondary" href="${esc(homepageUrl)}" target="_blank" rel="noopener noreferrer">Homepage</a>` : ""}
      ${repoUrl ? `<a class="ps-secondary" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
    </div>
    ${active ? installPanel(tool) : ""}
  </article>`;
}

function installPanel(tool) {
  const repoUrl = safeHref(tool.repoUrl);
  return `<div class="ps-install-panel">
    <p><b>Safe install boundary:</b> PhantomStore does not run this code. Review the source, then install it in your own environment.</p>
    <code>${esc(tool.installCommand || "Manual install: review the source repo first.")}</code>
    <div>
      ${tool.installCommand ? `<button type="button" class="ps-secondary" data-ps-copy="${esc(tool.id)}">Copy command</button>` : ""}
      ${repoUrl ? `<a class="ps-primary" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">Open source repo</a>` : ""}
    </div>
    ${ui.installMessage ? `<span>${esc(ui.installMessage)}</span>` : ""}
  </div>`;
}

function emptyState(title, copy) {
  return `<div class="ps-empty"><b>*</b><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;
}

function renderDiscover() {
  const catalog = visibleCatalog();
  const products = visibleProducts();
  const sellers = visibleSellers();
  return `<section class="ps-discover">
    <div class="ps-market-hero">
      <div>
        <p class="ps-kicker">AI MARKETPLACE</p>
        <h2>PhantomStore</h2>
        <p>Buy PhantomForce products, browse seller proof, and find AI tools, agents, templates, models, and operator utilities approved for discovery. This is not Site Builder. This is not Store Builder. PhantomStore is its own AI marketplace.</p>
      </div>
      <div class="ps-market-rules">
        <span>Seller + product reviews</span>
        <span>Products ready to buy</span>
        <span>No code auto-runs</span>
        <span>Source link required</span>
        <span>Admin review before listing</span>
      </div>
    </div>
    <div class="ps-tools">
      <label class="ps-search">
        <span>Search store</span>
        <input data-ps-search value="${esc(ui.query)}" placeholder="Termina, sellers, agents, CLI, templates..." />
      </label>
    </div>
    <div class="ps-section-head ps-section-gap">
      <div>
        <p class="ps-kicker">PRODUCTS</p>
        <h2>Ready to buy</h2>
      </div>
      <span>${products.length} products</span>
    </div>
    <div class="ps-product-grid">${products.length ? products.map(productCard).join("") : emptyState("No products match", "Clear the search to see current PhantomForce products.")}</div>
    <div class="ps-section-head ps-section-gap">
      <div>
        <p class="ps-kicker">SELLERS</p>
        <h2>Seller directory</h2>
      </div>
      <span>${sellers.length} sellers</span>
    </div>
    <div class="ps-seller-grid">${sellers.length ? sellers.map(sellerCard).join("") : emptyState("No sellers match", "Seller profiles appear here with their products and reviews.")}</div>
    <div class="ps-tools">
      <div class="ps-section-head">
        <div>
          <p class="ps-kicker">COMMUNITY AI TOOLS</p>
          <h2>Approved discovery catalog</h2>
        </div>
        <span>${catalog.length} tools</span>
      </div>
      <div class="ps-categories">${CATEGORIES.map((cat) => `<button type="button" class="${ui.category === cat ? "is-active" : ""}" data-ps-category="${esc(cat)}">${esc(cat)}</button>`).join("")}</div>
    </div>
    <div class="ps-grid">${catalog.length ? catalog.map(toolCard).join("") : emptyState("No approved tools yet", "Submitted tools appear here only after review. PhantomStore is ready; the catalog is just waiting for approved AI tools.")}</div>
  </section>`;
}

function renderSubmit() {
  const remaining = Math.max(0, Number(ui.snapshot?.submissionLimit || 0) - Number((ui.snapshot?.submissions || []).length));
  return `<section class="ps-submit-layout">
    <form class="ps-form" data-ps-tool-form>
      <header>
        <div>
          <p class="ps-kicker">SUBMIT AI TOOL</p>
          <h2>Add to PhantomStore review</h2>
        </div>
        <span>${remaining} slots left</span>
      </header>
      <label>Name<input name="name" maxlength="90" required placeholder="Agent Brief Builder" /></label>
      <label>One-line summary<input name="summary" maxlength="220" required placeholder="Turns messy notes into clean operator briefs." /></label>
      <label>Description<textarea name="description" rows="5" maxlength="4000" required placeholder="What it does, who it helps, setup notes, and why it belongs in an AI marketplace."></textarea></label>
      <div class="ps-row">
        <label>Category<select name="category">${CATEGORIES.filter((cat) => cat !== "All").map((cat) => `<option>${esc(cat)}</option>`).join("")}</select></label>
        <label>Install method<select name="installMethod">${INSTALL_METHODS.map((method) => `<option>${esc(method)}</option>`).join("")}</select></label>
        <label>Version<input name="version" maxlength="40" value="1.0.0" /></label>
      </div>
      <label>Source / repo URL<input name="repoUrl" type="url" required placeholder="https://github.com/you/tool" /></label>
      <label>Homepage URL<input name="homepageUrl" type="url" placeholder="https://yourtool.example" /></label>
      <label>Install command<input name="installCommand" maxlength="400" placeholder="npm install -g your-tool" /></label>
      <div class="ps-row ps-row-small">
        <label>Tags<input name="tags" maxlength="240" placeholder="agent, crm, captions" /></label>
        <label>License<input name="license" maxlength="60" placeholder="MIT" /></label>
      </div>
      <div class="ps-form-actions">
        <button type="submit" class="ps-secondary" data-submit-mode="draft" ${ui.busy ? "disabled" : ""}>Save draft</button>
        <button type="submit" class="ps-primary" data-submit-mode="submit" ${ui.busy ? "disabled" : ""}>Submit for review</button>
      </div>
      <p data-ps-form-message>${esc(ui.message)}</p>
    </form>
    <aside class="ps-boundary">
      <p class="ps-kicker">HARD BOUNDARY</p>
      <h3>Marketplace, not malware launcher.</h3>
      <ul>
        <li>PhantomStore does not upload or host submitted code.</li>
        <li>Nothing installs, runs, posts, or connects externally without the user choosing it.</li>
        <li>Every public listing needs a real source URL and review approval.</li>
      </ul>
    </aside>
  </section>`;
}

function submissionCard(tool) {
  const canModerate = !!ui.snapshot?.canModerate;
  return `<article class="ps-submission">
    <header>
      <div>
        <p>${esc(tool.developerName || "Developer")} / ${esc(tool.category)}</p>
        <h3>${esc(tool.name || "Untitled tool")}</h3>
      </div>
      <span class="is-${esc(tool.status)}">${esc(statusLabel(tool.status))}</span>
    </header>
    <p>${esc(tool.summary || "No summary yet.")}</p>
    <div class="ps-tags">${(tool.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    ${tool.moderationNote ? `<blockquote>${esc(tool.moderationNote)}</blockquote>` : ""}
    ${canModerate ? `<div class="ps-moderate">
      <input data-ps-note="${esc(tool.id)}" maxlength="1000" placeholder="Review note" />
      <label><input type="checkbox" data-ps-featured="${esc(tool.id)}" ${tool.featured ? "checked" : ""}/> Featured</label>
      <button type="button" data-ps-moderate="approved" data-id="${esc(tool.id)}">Approve</button>
      <button type="button" data-ps-moderate="changes_requested" data-id="${esc(tool.id)}">Request changes</button>
      <button type="button" data-ps-moderate="rejected" data-id="${esc(tool.id)}">Reject</button>
      <button type="button" data-ps-moderate="disabled" data-id="${esc(tool.id)}">Disable</button>
    </div>` : ""}
  </article>`;
}

const PRODUCT_CATEGORIES = ["Desktop App", "AI Suite", "Plugin", "Automation", "Creative Tool"];
const PRODUCT_STATUSES = ["available", "quality_hold"];

/* Variants edit as one line each: id | label | priceUsd | yes/no (available).
   Line format keeps the admin form honest and diffable without a JSON editor. */
function variantLines(product) {
  return productVariants(product).map((variant) => `${variant.id} | ${variant.label} | ${Number(variant.priceUsd) || 0} | ${variant.available === false ? "no" : "yes"}`).join("\n");
}

function parseVariantLines(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id = "", label = "", priceUsd = "", available = "yes"] = line.split("|").map((part) => part.trim());
    return { id, label, priceUsd: Number(priceUsd) || 0, available: available.toLowerCase() !== "no" };
  });
}

function adminProductForm(product) {
  const isNew = !product;
  const p = product || { status: "available", category: "Desktop App", inventory: { mode: "unlimited" } };
  const inventory = inventoryOf(p);
  return `<form class="ps-form ps-product-form" data-ps-product-form data-product-id="${esc(isNew ? "" : p.id)}">
    <header>
      <div>
        <p class="ps-kicker">${isNew ? "NEW PRODUCT" : "EDIT PRODUCT"}</p>
        <h3>${esc(isNew ? "Create store product" : p.name)}</h3>
      </div>
      <span>Admin only</span>
    </header>
    <label>Name<input name="name" maxlength="90" required value="${esc(p.name || "")}" /></label>
    <label>Summary<input name="summary" maxlength="300" required value="${esc(p.summary || "")}" /></label>
    <label>Description<textarea name="description" rows="4" maxlength="4000">${esc(p.description || "")}</textarea></label>
    <div class="ps-row">
      <label>Category<select name="category">${PRODUCT_CATEGORIES.map((cat) => `<option ${p.category === cat ? "selected" : ""}>${esc(cat)}</option>`).join("")}</select></label>
      <label>Status<select name="status">${PRODUCT_STATUSES.map((status) => `<option ${p.status === status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label>
      <label>Version<input name="version" maxlength="40" value="${esc(p.version || "1.0.0")}" /></label>
    </div>
    <div class="ps-row">
      <label>Price label<input name="priceLabel" maxlength="60" value="${esc(p.priceLabel || "")}" /></label>
      <label>Buy label<input name="buyLabel" maxlength="40" value="${esc(p.buyLabel || "")}" /></label>
      <label>Delivery<input name="delivery" maxlength="120" value="${esc(p.delivery || "")}" /></label>
    </div>
    <label>Buy URL<input name="buyUrl" type="url" value="${esc(p.buyUrl || "")}" placeholder="https://..." /></label>
    <label>Image URL (app asset path or https)<input name="imageUrl" value="${esc(p.imageUrl || "")}" placeholder="/app/assets/... or https://... — blank uses the branded tile" /></label>
    <label>Quality note<input name="qualityNote" maxlength="500" value="${esc(p.qualityNote || "")}" /></label>
    <div class="ps-row ps-row-small">
      <label>Tags (comma-separated)<input name="tags" maxlength="240" value="${esc((p.tags || []).join(", "))}" /></label>
      <label>Badges (comma-separated)<input name="badges" maxlength="240" value="${esc((p.badges || []).join(", "))}" /></label>
    </div>
    <label>Variants (one per line: id | label | priceUsd | yes/no)<textarea name="variants" rows="3" placeholder="termina-early-access | Early access license | 20 | yes">${esc(variantLines(p))}</textarea></label>
    <div class="ps-row ps-row-small">
      <label>Inventory mode<select name="inventoryMode"><option ${inventory.mode === "unlimited" ? "selected" : ""}>unlimited</option><option ${inventory.mode === "tracked" ? "selected" : ""}>tracked</option></select></label>
      <label>Stock (tracked only)<input name="inventoryStock" type="number" min="0" step="1" value="${esc(inventory.mode === "tracked" ? inventory.stock : "")}" /></label>
    </div>
    <label class="ps-check"><input type="checkbox" name="featured" ${p.featured ? "checked" : ""} /> Featured</label>
    <div class="ps-form-actions">
      <button type="submit" class="ps-primary" ${ui.busy ? "disabled" : ""}>${isNew ? "Create product" : "Save product"}</button>
      <button type="button" class="ps-secondary" data-ps-product-cancel>Cancel</button>
    </div>
    <p data-ps-form-message>${esc(ui.adminProductMessage)}</p>
  </form>`;
}

function adminProductsPanel() {
  const products = Array.isArray(ui.snapshot?.products) ? ui.snapshot.products : [];
  return `<div class="ps-admin-products">
    <div class="ps-section-head">
      <div>
        <p class="ps-kicker">PRODUCTS / ADMIN EDITOR</p>
        <h2>Edit store products</h2>
      </div>
      <button type="button" class="ps-secondary" data-ps-product-edit="new">New product</button>
    </div>
    ${ui.adminProductId === "new" ? adminProductForm(null) : ""}
    <div class="ps-admin-product-list">${products.map((product) => {
      const variantClicks = product.variantBuyClicks && typeof product.variantBuyClicks === "object" ? Object.entries(product.variantBuyClicks).map(([id, count]) => `${id}: ${Number(count) || 0}`).join(", ") : "";
      return `<article class="ps-admin-product">
        <header>
          <div>
            <p class="ps-kicker">${esc(product.category)} / ${esc(product.status)}${product.featured ? " / featured" : ""}</p>
            <h3>${esc(product.name)}</h3>
          </div>
          <span>${esc(product.priceLabel || "")}</span>
        </header>
        <small>${Number(product.buyClicks || 0)} buy clicks${variantClicks ? ` (${esc(variantClicks)})` : ""} / ${esc(inventoryLabel(product))}</small>
        <div class="ps-card-actions">
          <button type="button" class="ps-secondary" data-ps-product-edit="${esc(product.id)}">${ui.adminProductId === product.id ? "Close editor" : "Edit"}</button>
        </div>
        ${ui.adminProductId === product.id ? adminProductForm(product) : ""}
      </article>`;
    }).join("")}</div>
  </div>`;
}

function renderSubmissions() {
  const submissions = Array.isArray(ui.snapshot?.submissions) ? ui.snapshot.submissions : [];
  return `<section class="ps-review">
    ${ui.snapshot?.canModerate ? adminProductsPanel() : ""}
    <div class="ps-section-head">
      <div>
        <p class="ps-kicker">${ui.snapshot?.canModerate ? "MODERATION QUEUE" : "YOUR BUILDS"}</p>
        <h2>${ui.snapshot?.canModerate ? "Review AI marketplace submissions" : "Your PhantomStore submissions"}</h2>
      </div>
      <span>${Number(ui.snapshot?.pendingReviewCount || 0)} pending</span>
    </div>
    <div class="ps-submission-list">${submissions.length ? submissions.map(submissionCard).join("") : emptyState("No submissions yet", "Save a draft or submit an AI tool/app for review.")}</div>
  </section>`;
}

function renderContent() {
  if (ui.loading) return `<div class="ps-loading"><i></i><b>Loading PhantomStore...</b></div>`;
  if (ui.error) return `<div class="ps-error"><b>PhantomStore is not available.</b><span>${esc(ui.error)}</span><button type="button" data-ps-refresh>Try again</button></div>`;
  if (ui.tab === "submit") return renderSubmit();
  if (ui.tab === "review") return renderSubmissions();
  if (ui.productId) {
    const product = (ui.snapshot?.products || []).find((item) => item.id === ui.productId);
    if (product) return renderProductDetail(product);
    ui.productId = "";
  }
  return renderDiscover();
}

function render() {
  if (!mountedRoot) return;
  mountedRoot.innerHTML = `<section class="ps-shell">
    <header class="ps-top">
      <div>
        <p class="ps-kicker">PHANTOMSTORE / AI MARKETPLACE</p>
        <h1>Approved AI tools, agents, and operator apps.</h1>
        <span>Separate from Websites, Site Builder, Store Builder, and PhantomPlay.</span>
      </div>
      <div class="ps-top-stats">
        <span><b>${Number(ui.snapshot?.products?.length || 0)}</b><i>products</i></span>
        <span><b>${Number(ui.snapshot?.sellers?.length || 0)}</b><i>sellers</i></span>
        <span><b>${Number(ui.snapshot?.catalog?.length || 0)}</b><i>tools</i></span>
        <span><b>${Number(ui.snapshot?.submissions?.length || 0)}</b><i>${ui.snapshot?.canModerate ? "queue" : "yours"}</i></span>
      </div>
    </header>
    <nav class="ps-tabs" aria-label="PhantomStore sections">
      ${[["discover", "Discover"], ["submit", "Submit"], ["review", ui.snapshot?.canModerate ? "Review" : "My tools"]].map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-ps-tab="${id}">${label}</button>`).join("")}
    </nav>
    ${renderContent()}
  </section>`;
  bind();
}

async function submitForm(form, submit) {
  ui.busy = true;
  ui.message = submit ? "Submitting to review..." : "Saving draft...";
  render();
  try {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.tags = String(payload.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    payload.submit = submit;
    const result = await api("/api/phantomstore/tools", { method: "POST", body: JSON.stringify(payload) });
    ui.message = submit ? "Submitted for review." : `Draft saved. ${result.issues?.length ? result.issues.join(" ") : ""}`;
    ui.tab = submit ? "review" : "submit";
    await hydrate();
  } catch (error) {
    ui.message = error instanceof Error ? error.message : "Tool could not be saved.";
    render();
  } finally {
    ui.busy = false;
    render();
  }
}

async function recordInstall(id) {
  ui.installToolId = id;
  ui.installMessage = "Opening safe install details...";
  render();
  try {
    const result = await api(`/api/phantomstore/tools/${encodeURIComponent(id)}/install`, { method: "POST" });
    ui.installMessage = `Install interest recorded (${Number(result.installClicks || 0)}).`;
    const tool = ui.snapshot?.catalog?.find((item) => item.id === id);
    if (tool) tool.installClicks = result.installClicks;
  } catch (error) {
    ui.installMessage = error instanceof Error ? error.message : "Install details could not be opened.";
  }
  render();
}

async function recordBuy(id) {
  ui.buyingProductId = id;
  ui.buyMessage = "Preparing checkout...";
  render();
  try {
    const product = ui.snapshot?.products?.find((item) => item.id === id);
    const variant = product ? selectedVariant(product) : null;
    const result = await api(`/api/phantomstore/products/${encodeURIComponent(id)}/buy`, { method: "POST", body: JSON.stringify(variant ? { variantId: variant.id } : {}) });
    if (product) {
      product.buyClicks = result.buyClicks;
      if (result.variantId && result.variantBuyClicks != null) {
        product.variantBuyClicks = { ...(product.variantBuyClicks || {}), [result.variantId]: result.variantBuyClicks };
      }
    }
    ui.buyMessage = result.checkout?.note || "Purchase intent recorded.";
    const url = safeHref(result.checkout?.url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    ui.buyMessage = error instanceof Error ? error.message : "Checkout could not be prepared.";
  }
  render();
}

async function saveProduct(form) {
  ui.busy = true;
  ui.adminProductMessage = "Saving product...";
  render();
  try {
    const data = new FormData(form);
    const csv = (name) => String(data.get(name) || "").split(",").map((item) => item.trim()).filter(Boolean);
    const inventoryMode = String(data.get("inventoryMode") || "unlimited");
    const payload = {
      name: String(data.get("name") || ""),
      summary: String(data.get("summary") || ""),
      description: String(data.get("description") || ""),
      category: String(data.get("category") || ""),
      status: String(data.get("status") || "available"),
      version: String(data.get("version") || ""),
      priceLabel: String(data.get("priceLabel") || ""),
      buyLabel: String(data.get("buyLabel") || ""),
      delivery: String(data.get("delivery") || ""),
      buyUrl: String(data.get("buyUrl") || ""),
      imageUrl: String(data.get("imageUrl") || ""),
      qualityNote: String(data.get("qualityNote") || ""),
      tags: csv("tags"),
      badges: csv("badges"),
      variants: parseVariantLines(data.get("variants")),
      inventory: inventoryMode === "tracked" ? { mode: "tracked", stock: Number(data.get("inventoryStock")) || 0 } : { mode: "unlimited" },
      featured: data.get("featured") === "on",
    };
    const productId = form.dataset.productId || "";
    await api(productId ? `/api/phantomstore/products/${encodeURIComponent(productId)}` : "/api/phantomstore/products", {
      method: productId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    ui.adminProductMessage = productId ? "Product saved." : "Product created.";
    ui.adminProductId = "";
    await hydrate();
  } catch (error) {
    ui.adminProductMessage = error instanceof Error ? error.message : "Product could not be saved.";
    render();
  } finally {
    ui.busy = false;
    render();
  }
}

async function moderate(id, decision) {
  ui.message = "Saving moderation decision...";
  render();
  try {
    const note = mountedRoot?.querySelector(`[data-ps-note="${cssEscape(id)}"]`)?.value || "";
    const featured = !!mountedRoot?.querySelector(`[data-ps-featured="${cssEscape(id)}"]`)?.checked;
    await api(`/api/phantomstore/tools/${encodeURIComponent(id)}/moderate`, { method: "POST", body: JSON.stringify({ decision, note, featured }) });
    ui.message = "Moderation saved.";
    await hydrate();
  } catch (error) {
    ui.message = error instanceof Error ? error.message : "Moderation could not be saved.";
    render();
  }
}

async function copyInstall(id) {
  const tool = ui.snapshot?.catalog?.find((item) => item.id === id);
  const command = tool?.installCommand || "";
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    ui.installMessage = "Command copied.";
  } catch {
    ui.installMessage = command;
  }
  render();
}

function bind() {
  mountedRoot.querySelectorAll("[data-ps-tab]").forEach((button) => {
    button.onclick = () => { ui.tab = button.dataset.psTab || "discover"; ui.message = ""; ui.productId = ""; render(); };
  });
  mountedRoot.querySelector("[data-ps-refresh]")?.addEventListener("click", hydrate);
  mountedRoot.querySelector("[data-ps-search]")?.addEventListener("input", (event) => {
    ui.query = event.target.value || "";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const cursor = event.target.selectionStart ?? ui.query.length;
      render();
      const search = mountedRoot?.querySelector("[data-ps-search]");
      search?.focus({ preventScroll: true });
      search?.setSelectionRange?.(cursor, cursor);
    }, 120);
  });
  mountedRoot.querySelectorAll("[data-ps-category]").forEach((button) => {
    button.onclick = () => { ui.category = button.dataset.psCategory || "All"; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-install]").forEach((button) => {
    button.onclick = () => recordInstall(button.dataset.psInstall || "");
  });
  mountedRoot.querySelectorAll("[data-ps-buy]").forEach((button) => {
    button.onclick = () => recordBuy(button.dataset.psBuy || "");
  });
  mountedRoot.querySelectorAll("[data-ps-detail]").forEach((button) => {
    button.onclick = () => { ui.productId = button.dataset.psDetail || ""; ui.buyMessage = ""; ui.buyingProductId = ""; render(); };
  });
  mountedRoot.querySelector("[data-ps-back]")?.addEventListener("click", () => { ui.productId = ""; ui.buyMessage = ""; ui.buyingProductId = ""; render(); });
  mountedRoot.querySelectorAll("[data-ps-variant]").forEach((input) => {
    input.onchange = () => {
      ui.variantChoice = { ...ui.variantChoice, [input.dataset.psVariant || ""]: input.value };
      render();
    };
  });
  mountedRoot.querySelectorAll("[data-ps-product-edit]").forEach((button) => {
    button.onclick = () => {
      const target = button.dataset.psProductEdit || "";
      ui.adminProductId = ui.adminProductId === target ? "" : target;
      ui.adminProductMessage = "";
      render();
    };
  });
  mountedRoot.querySelectorAll("[data-ps-product-cancel]").forEach((button) => {
    button.onclick = () => { ui.adminProductId = ""; ui.adminProductMessage = ""; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-product-form]").forEach((productForm) => {
    productForm.onsubmit = (event) => { event.preventDefault(); saveProduct(productForm); };
  });
  mountedRoot.querySelectorAll("[data-ps-copy]").forEach((button) => {
    button.onclick = () => copyInstall(button.dataset.psCopy || "");
  });
  mountedRoot.querySelectorAll("[data-ps-moderate]").forEach((button) => {
    button.onclick = () => moderate(button.dataset.id || "", button.dataset.psModerate || "");
  });
  const form = mountedRoot.querySelector("[data-ps-tool-form]");
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      const submitter = event.submitter;
      submitForm(form, submitter?.dataset?.submitMode === "submit");
    };
  }
}

export function renderPhantomStore(root) {
  mountedRoot = root;
  hydrate();
}
