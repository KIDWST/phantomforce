/* PhantomForce Websites -- one website preview, one prompt, unlimited domains. */

import {
  store, uid, visible, currentWs, wsName, pushActivity, ago,
} from "./store.js?v=phantom-live-20260711-182";
import {
  esc, baseSiteDraft, ensureSiteDesign, applyWebsitePrompt, renderWebsitePreview,
} from "./workspaces.js?v=phantom-live-20260711-182";

const siteUi = { activeSiteId: null, device: "desktop", selectedSection: -1 };

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
  site.updated = new Date().toISOString();
  /* drop the consumed snapshot (it now sits at index+1 after the unshift) */
  site.history.splice(index + 1, 1);
  return true;
}

/* publish state, honestly: approval-gated, and never claims "live" —
   deployment is not connected, and the UI says so. */
function publishState(site) {
  const approval = (store.state.approvals || []).find((a) => a.type === "publish-page" && a.ref === site.id && a.status === "pending");
  if (approval) return { key: "waiting", label: "Publish approval pending", detail: "Waiting in the Approval Queue." };
  if (site.status === "approved-to-publish") return { key: "approved", label: "Approved to publish", detail: "Deployment isn't connected yet — nothing is live." };
  return { key: "draft", label: "Draft", detail: "Request approval when it's ready to go out." };
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

      <div class="ss-editbar">
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
            return `<span class="ss-publish-chip ss-publish-${state.key}" title="${esc(state.detail)}">${esc(state.label)}</span>`;
          })()}
        </div>
      </div>

      <main class="ss-simple-main">
        <div class="ss-simple-preview ss-device-${esc(siteUi.device)}" data-ss-preview>${renderWebsitePreview(active, products, { selected: siteUi.selectedSection })}</div>
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

      <p class="ss-simple-status">Last edited ${ago(active.updated || new Date().toISOString())}</p>
    </section>`;
}

export function renderSiteStudio(el) {
  const rerender = () => renderSiteStudio(el);
  const sites = visible(store.state.sites).map(normalizeSite);
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
      store.save();
      rerender();
    };
  });

  /* ---- editor controls: device preview, undo, history, publish ---- */
  el.querySelectorAll("[data-ss-device]").forEach((button) => {
    button.onclick = () => { siteUi.device = button.dataset.ssDevice; rerender(); };
  });

  const undoBtn = el.querySelector("[data-act='ss-undo']");
  if (undoBtn && active) undoBtn.onclick = () => {
    /* undo = restore the newest snapshot */
    const snap = (active.history || [])[0];
    if (!snap) return;
    const kept = active.history.slice(1);
    Object.assign(active, snap.data, { history: kept });
    active.design = { ...snap.data.design };
    active.sections = [...snap.data.sections];
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
  if (publishBtn && active) publishBtn.onclick = () => {
    snapshotSite(active, "publish requested");
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
      preview.innerHTML = renderWebsitePreview(clone, productsFor(active), { selected: siteUi.selectedSection });
    });
  }
}
