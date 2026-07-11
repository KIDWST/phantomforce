/* PhantomForce Websites -- one website preview, one prompt, unlimited domains. */

import {
  store, uid, visible, currentWs, wsName, pushActivity, ago,
} from "./store.js?v=phantom-live-20260711-167";
import {
  esc, baseSiteDraft, ensureSiteDesign, applyWebsitePrompt, renderWebsitePreview,
} from "./workspaces.js?v=phantom-live-20260711-167";

const siteUi = { activeSiteId: null };

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
  site.domains = Array.isArray(site.domains) ? site.domains : [];
  const domain = siteDomain(site);
  if (domain && !site.domains.includes(domain)) site.domains.unshift(domain);
  return site;
}

function productsFor(site) {
  return visible(store.state.products || []).filter((product) => !site || product.ws === site.ws || currentWs() === "phantomforce");
}

function createWebsite(seed = "") {
  const domain = domainFromText(seed);
  const title = domain ? domainTitle(domain) : wsName(currentWs());
  const draft = baseSiteDraft(title, "Website");
  draft.id = uid("site");
  draft.ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  draft.status = "draft";
  draft.updated = new Date().toISOString();
  draft.domains = [];
  setSiteDomain(draft, domain);
  if (seed.trim()) applyWebsiteChange(draft, seed, false);
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
        <h3>Start a website.</h3>
        <form class="ss-simple-prompt" data-ss-prompt-form>
          <textarea data-ss-prompt rows="5" placeholder="Describe the website. Include the domain if you have one."></textarea>
          <button class="btn btn-primary" type="submit">Build website</button>
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

      <main class="ss-simple-main">
        <div class="ss-simple-preview" data-ss-preview>${renderWebsitePreview(active, products)}</div>
      </main>

      <form class="ss-simple-prompt" data-ss-prompt-form>
        <textarea data-ss-prompt rows="3" placeholder="Describe the change. Example: make the hero simpler, add testimonials, use chicagoshots.com"></textarea>
        <button class="btn btn-primary" type="submit">Update website</button>
      </form>

      <p class="ss-simple-status">Last edited ${ago(active.updated || new Date().toISOString())}</p>
    </section>`;
}

export function renderSiteStudio(el) {
  const rerender = () => renderSiteStudio(el);
  const sites = visible(store.state.sites).map(normalizeSite);
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
    select.onchange = () => { siteUi.activeSiteId = select.value; rerender(); };
  });

  el.querySelectorAll("[data-ss-site]").forEach((button) => {
    button.onclick = () => { siteUi.activeSiteId = button.dataset.ssSite; rerender(); };
  });

  el.querySelectorAll("[data-act='ss-new-site']").forEach((button) => {
    button.onclick = () => {
      createWebsite("");
      rerender();
    };
  });

  el.querySelectorAll("[data-act='ss-remove-site']").forEach((button) => {
    button.onclick = () => {
      const target = store.state.sites.find((site) => site.id === button.dataset.id);
      store.state.sites = store.state.sites.filter((site) => site.id !== button.dataset.id);
      siteUi.activeSiteId = store.state.sites[0]?.id || null;
      if (target) pushActivity("Websites", `deleted ${target.title}.`, target.ws);
      store.save();
      rerender();
    };
  });

  const domainForm = el.querySelector("[data-ss-domain-form]");
  if (domainForm && active) {
    domainForm.onsubmit = (event) => {
      event.preventDefault();
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
      const prompt = input?.value || "";
      const site = active || createWebsite(prompt);
      applyWebsiteChange(site, prompt);
      store.save();
      rerender();
    };
  });

  const promptInput = el.querySelector("[data-ss-prompt]");
  const preview = el.querySelector("[data-ss-preview]");
  if (promptInput && preview && active) {
    promptInput.addEventListener("input", () => {
      const clone = JSON.parse(JSON.stringify(active));
      applyWebsiteChange(clone, promptInput.value, false);
      preview.innerHTML = renderWebsitePreview(clone, productsFor(active));
    });
  }
}
