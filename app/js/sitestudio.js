/* PhantomForce Websites -- one website preview, one prompt, unlimited domains. */

import {
  store, uid, visible, currentWs, wsName, pushActivity, ago, fmtMoney,
} from "./store.js?v=phantom-live-20260718-35";
import {
  esc, baseSiteDraft, ensureSiteDesign, ensureSiteStore, applyWebsitePrompt, renderWebsitePreview,
  SITE_TEMPLATES, applySiteTemplate, cadenceSuffix,
} from "./workspaces.js?v=phantom-live-20260718-35";
import {
  isDatabaseSession, requestServerPublish, fetchServerRun,
} from "./orgs.js?v=phantom-live-20260718-35";

const siteUi = {
  activeSiteId: null, device: "desktop", selectedSection: -1,
  panel: "website", cartOpen: false, checkoutOpen: false, confirmation: null,
};

/* ---- version history: a real, persisted undo trail per site ----
   Every mutation (prompt apply, section op, domain change, publish request)
   snapshots the editable state first. Capped so localStorage stays sane. */
const HISTORY_CAP = 12;
function snapshotSite(site, label) {
  site.history = Array.isArray(site.history) ? site.history : [];
  site.history.unshift({
    at: new Date().toISOString(),
    label: String(label || "edit").slice(0, 70),
    data: {
      title: site.title,
      kind: site.kind,
      sections: [...(site.sections || [])],
      design: { ...(site.design || {}) },
      catalog: JSON.parse(JSON.stringify(site.catalog || [])),
      store: JSON.parse(JSON.stringify(site.store || {})),
      domain: site.domain || "",
      url: site.url || "",
    },
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
  site.updated = new Date().toISOString();
  /* drop the consumed snapshot (it now sits at index+1 after the unshift) */
  site.history.splice(index + 1, 1);
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
    pushActivity("Websites", `${site.title} is LIVE — deployment verified by the server (run ${run.id}).`, site.ws);
  }
  store.save();
  rerender();
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
  site.domains = Array.isArray(site.domains) ? site.domains : [];
  const domain = siteDomain(site);
  if (domain && !site.domains.includes(domain)) site.domains.unshift(domain);
  return site;
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
                <button type="button" data-ss-restore="${index}">
                  <b>${esc(snap.label)}</b>
                  <span>${ago(snap.at)}</span>
                </button>`).join("") || `<p>No versions yet — every edit saves one automatically.</p>`}
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

      <main class="ss-simple-main ${siteUi.panel === "store" ? "has-store-console" : ""}">
        <div class="ss-simple-preview ss-device-${esc(siteUi.device)}" data-ss-preview>${renderWebsitePreview(active, products, { selected: siteUi.selectedSection, interactive: true, cart: ensureSiteStore(active).cart })}</div>
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
    select.onchange = () => { siteUi.activeSiteId = select.value; siteUi.cartOpen = false; siteUi.checkoutOpen = false; siteUi.confirmation = null; rerender(); };
  });

  el.querySelectorAll("[data-ss-site]").forEach((button) => {
    button.onclick = () => { siteUi.activeSiteId = button.dataset.ssSite; siteUi.cartOpen = false; siteUi.checkoutOpen = false; siteUi.confirmation = null; rerender(); };
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
      if (active) snapshotSite(site, prompt.slice(0, 60));
      /* a selected section focuses the edit: its name is prepended so the
         prompt engine's section-aware rules see the target */
      const target = siteUi.selectedSection >= 0 && site.sections[siteUi.selectedSection] !== undefined
        ? `${site.sections[siteUi.selectedSection]}: ${prompt}`
        : prompt;
      applyWebsiteChange(site, target);
      if (site.catalog?.length) siteUi.panel = "store";
      store.save();
      rerender();
    };
  });

  /* ---- editor controls: device preview, undo, history, publish ---- */
  el.querySelectorAll("[data-ss-device]").forEach((button) => {
    button.onclick = () => { siteUi.device = button.dataset.ssDevice; rerender(); };
  });

  el.querySelectorAll("[data-ss-panel]").forEach((button) => {
    button.onclick = () => { siteUi.panel = button.dataset.ssPanel; siteUi.cartOpen = false; rerender(); };
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
    active.updated = new Date().toISOString();
    pushActivity("Websites", `undid the last edit on ${active.title}.`, active.ws);
    store.save();
    rerender();
  };

  el.querySelectorAll("[data-ss-restore]").forEach((button) => {
    button.onclick = () => {
      if (!active) return;
      if (restoreSnapshot(active, Number(button.dataset.ssRestore))) {
        pushActivity("Websites", `restored an earlier version of ${active.title}.`, active.ws);
        store.save();
        rerender();
      }
    };
  });

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
        pushActivity("Websites", `built v${result.buildVersion} of ${active.title} and requested publish approval (run ${result.run.id}).`, active.ws);
      } else {
        const why = result.error === "upgrade_required" ? "your current plan doesn't include publishing"
          : result.error === "build_validation_failed" ? "the build failed validation"
          : `the server refused (${result.error})`;
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
    store.save();
    rerender();
  };
  if (active) refreshServerPublish(active, rerender);

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
  if (promptInput && preview && active) {
    promptInput.addEventListener("input", () => {
      const clone = JSON.parse(JSON.stringify(active));
      applyWebsiteChange(clone, promptInput.value, false);
      preview.innerHTML = renderWebsitePreview(clone, productsFor(clone), { selected: siteUi.selectedSection, cart: clone.store?.cart || {} });
    });
  }
}
