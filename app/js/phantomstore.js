import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260722-16";

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
  editingToolId: "",
};

// Local asset paths (e.g. /app/assets/...) are safe to render as-is; anything
// else must survive the same http(s) parse as external marketplace links.
const safeAssetHref = (value) => {
  const url = String(value ?? "").trim();
  if (url.startsWith("/app/")) return url;
  return safeHref(url);
};

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
  const available = product.status === "available";
  const imageUrl = safeAssetHref(product.imageUrl);
  const referenceUrl = safeAssetHref(product.referenceImageUrl);
  return `<article class="ps-product ${product.featured ? "is-featured" : ""}">
    ${imageUrl ? `<div class="ps-product-media"><img src="${esc(imageUrl)}" alt="${esc(product.name)} key art" loading="lazy" />${referenceUrl ? `<span class="ps-media-note">AI key art from the real product UI · <a href="${esc(referenceUrl)}" target="_blank" rel="noopener noreferrer">View real UI</a></span>` : ""}</div>` : ""}
    <header>
      <div>
        <p class="ps-kicker">${esc(product.category)} / ${esc(product.delivery || "Digital delivery")}</p>
        <h3>${esc(product.name)}</h3>
      </div>
      <span>${esc(product.priceLabel || "Contact")}</span>
    </header>
    <p>${esc(product.summary)}</p>
    <div class="ps-product-proof">
      <b>${esc(product.rating || "New")} / 5</b>
      <span>${Number(product.reviewCount || 0)} product reviews</span>
      <span>Seller: ${esc(seller.name || "Seller")}</span>
    </div>
    <div class="ps-tags">${(product.badges || product.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    <small>${esc(product.qualityNote || "")}</small>
    <div class="ps-card-actions">
      <button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${available ? "" : "disabled"}>${isBuying ? "Preparing..." : esc(product.buyLabel || "Buy now")}</button>
      ${buyUrl ? `<a class="ps-secondary" href="${esc(buyUrl)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ""}
    </div>
    ${ui.buyingProductId === product.id && ui.buyMessage ? `<div class="ps-buy-note">${esc(ui.buyMessage)}</div>` : ""}
    ${reviewList(product.reviews || [])}
  </article>`;
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
  const editing = ui.editingToolId ? (ui.snapshot?.submissions || []).find((tool) => tool.id === ui.editingToolId) : null;
  return `<section class="ps-submit-layout">
    <form class="ps-form" data-ps-tool-form data-ps-editing="${esc(editing?.id || "")}">
      <header>
        <div>
          <p class="ps-kicker">${editing ? "EDIT AI TOOL" : "SUBMIT AI TOOL"}</p>
          <h2>${editing ? `Revise "${esc(editing.name || "Untitled tool")}"` : "Add to PhantomStore review"}</h2>
        </div>
        <span>${editing ? esc(statusLabel(editing.status)) : `${remaining} slots left`}</span>
      </header>
      ${editing?.moderationNote ? `<blockquote class="ps-edit-note">Reviewer note: ${esc(editing.moderationNote)}</blockquote>` : ""}
      <label>Name<input name="name" maxlength="90" required placeholder="Agent Brief Builder" value="${esc(editing?.name || "")}" /></label>
      <label>One-line summary<input name="summary" maxlength="220" required placeholder="Turns messy notes into clean operator briefs." value="${esc(editing?.summary || "")}" /></label>
      <label>Description<textarea name="description" rows="5" maxlength="4000" required placeholder="What it does, who it helps, setup notes, and why it belongs in an AI marketplace.">${esc(editing?.description || "")}</textarea></label>
      <div class="ps-row">
        <label>Category<select name="category">${CATEGORIES.filter((cat) => cat !== "All").map((cat) => `<option ${editing?.category === cat ? "selected" : ""}>${esc(cat)}</option>`).join("")}</select></label>
        <label>Install method<select name="installMethod">${INSTALL_METHODS.map((method) => `<option ${editing?.installMethod === method ? "selected" : ""}>${esc(method)}</option>`).join("")}</select></label>
        <label>Version<input name="version" maxlength="40" value="${esc(editing?.version || "1.0.0")}" /></label>
      </div>
      <label>Source / repo URL<input name="repoUrl" type="url" required placeholder="https://github.com/you/tool" value="${esc(editing?.repoUrl || "")}" /></label>
      <label>Homepage URL<input name="homepageUrl" type="url" placeholder="https://yourtool.example" value="${esc(editing?.homepageUrl || "")}" /></label>
      <label>Install command<input name="installCommand" maxlength="400" placeholder="npm install -g your-tool" value="${esc(editing?.installCommand || "")}" /></label>
      <div class="ps-row ps-row-small">
        <label>Tags<input name="tags" maxlength="240" placeholder="agent, crm, captions" value="${esc((editing?.tags || []).join(", "))}" /></label>
        <label>License<input name="license" maxlength="60" placeholder="MIT" value="${esc(editing?.license || "")}" /></label>
      </div>
      <div class="ps-form-actions">
        ${editing ? `<button type="button" class="ps-secondary" data-ps-cancel-edit ${ui.busy ? "disabled" : ""}>Cancel edit</button>` : ""}
        <button type="submit" class="ps-secondary" data-submit-mode="draft" ${ui.busy ? "disabled" : ""}>Save draft</button>
        <button type="submit" class="ps-primary" data-submit-mode="submit" ${ui.busy ? "disabled" : ""}>${editing ? "Resubmit for review" : "Submit for review"}</button>
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
  const isMine = tool.developerId === ui.snapshot?.actorId;
  const editable = (isMine || canModerate) && (canModerate || !["approved", "disabled"].includes(tool.status));
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
    ${editable ? `<div class="ps-card-actions"><button type="button" class="ps-secondary" data-ps-edit="${esc(tool.id)}">Edit &amp; resubmit</button></div>` : ""}
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

function renderSubmissions() {
  const submissions = Array.isArray(ui.snapshot?.submissions) ? ui.snapshot.submissions : [];
  return `<section class="ps-review">
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
  const editingId = form.dataset.psEditing || "";
  ui.message = submit ? "Submitting to review..." : "Saving draft...";
  render();
  try {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.tags = String(payload.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    payload.submit = submit;
    const endpoint = editingId ? `/api/phantomstore/tools/${encodeURIComponent(editingId)}` : "/api/phantomstore/tools";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    ui.message = submit ? (editingId ? "Resubmitted for review." : "Submitted for review.") : `Draft saved. ${result.issues?.length ? result.issues.join(" ") : ""}`;
    ui.editingToolId = "";
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
    const result = await api(`/api/phantomstore/products/${encodeURIComponent(id)}/buy`, { method: "POST" });
    const product = ui.snapshot?.products?.find((item) => item.id === id);
    if (product) product.buyClicks = result.buyClicks;
    ui.buyMessage = result.checkout?.note || "Purchase intent recorded.";
    const url = safeHref(result.checkout?.url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    ui.buyMessage = error instanceof Error ? error.message : "Checkout could not be prepared.";
  }
  render();
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
    button.onclick = () => { ui.tab = button.dataset.psTab || "discover"; ui.message = ""; if (ui.tab !== "submit") ui.editingToolId = ""; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-edit]").forEach((button) => {
    button.onclick = () => { ui.editingToolId = button.dataset.psEdit || ""; ui.message = ""; ui.tab = "submit"; render(); };
  });
  mountedRoot.querySelector("[data-ps-cancel-edit]")?.addEventListener("click", () => {
    ui.editingToolId = "";
    ui.message = "";
    ui.tab = "review";
    render();
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
