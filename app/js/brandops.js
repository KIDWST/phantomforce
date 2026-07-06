/* PhantomForce — Brand Memory + Automation workspaces.
   Two real pages that were previously mislabeled nav aliases of Workforce.
   Self-contained: owns its own localStorage state (brand facts, asset vault,
   memory notes) and renders Automation honestly from the live store (agents +
   tool spine). No fabricated records — drafts and notes are real, local data. */

import { store, visible, pushActivity, uid, ago, TOOL_SPINE } from "./store.js?v=phantom-live-20260706-17";

const BRAND_KEY = "pf.brand.v1";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- brand state ---------------- */
function loadBrand() {
  try {
    const d = JSON.parse(localStorage.getItem(BRAND_KEY) || "null");
    if (d && d.v === 1) return d;
  } catch {}
  return {
    v: 1,
    facts: { name: "PhantomForce", tagline: "The private cyber-AI that runs your business.", voice: "Confident, direct, a little theatrical. Never corporate filler.", audience: "Owner-operators who want leverage without headcount.", palette: ["#41ffa1", "#1ef0ff", "#05080d"] },
    assets: [],
    memory: [],
  };
}
function saveBrand(b) { try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)); } catch {} }

/* counts used by the dashboard statcard so "Brand Memory" reports its own data */
export function brandCounts() {
  const b = loadBrand();
  return { assets: b.assets.length, memory: b.memory.length, total: b.assets.length + b.memory.length };
}

const ASSET_KINDS = ["Logo", "Font", "Palette", "Photo", "Video", "Copy doc", "Guideline"];

/* ======================================================================
   BRAND MEMORY — the private, local brand brain
   ====================================================================== */
export function renderBrandMemory(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const b = loadBrand();
  const paint = () => renderBrandMemory(el, opts);

  el.innerHTML = `
    <div class="bm">
      <div class="bm-note"><i></i>Private &amp; local — everything on this page lives in your browser. Nothing is uploaded or sent anywhere.</div>

      <div class="bm-grid">
        <section class="bm-card">
          <div class="bm-card-h"><h3>Brand facts</h3><span class="bm-hint">what Phantom writes from</span></div>
          <form class="bm-facts" data-bm-facts>
            <label><span>Brand name</span><input name="name" value="${esc(b.facts.name)}" /></label>
            <label><span>Tagline</span><input name="tagline" value="${esc(b.facts.tagline)}" /></label>
            <label><span>Voice</span><textarea name="voice" rows="2">${esc(b.facts.voice)}</textarea></label>
            <label><span>Audience</span><textarea name="audience" rows="2">${esc(b.facts.audience)}</textarea></label>
            <div class="bm-palette">
              <span>Palette</span>
              <div class="bm-swatches">${b.facts.palette.map((c) => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join("")}</div>
            </div>
            <button class="btn bm-save" type="submit">Save brand facts</button>
            <em class="bm-saved" data-bm-saved hidden>Saved.</em>
          </form>
        </section>

        <section class="bm-card">
          <div class="bm-card-h"><h3>Asset vault</h3><span class="bm-hint">${b.assets.length} asset${b.assets.length === 1 ? "" : "s"}</span></div>
          <form class="bm-add" data-bm-asset>
            <select name="kind">${ASSET_KINDS.map((k) => `<option>${k}</option>`).join("")}</select>
            <input name="label" placeholder="Asset name — e.g. Primary logo (SVG)" required />
            <button class="btn" type="submit">Add</button>
          </form>
          <div class="bm-assets">
            ${b.assets.length ? b.assets.map((a) => `
              <div class="bm-asset">
                <span class="bm-asset-kind">${esc(a.kind)}</span>
                <span class="bm-asset-label">${esc(a.label)}</span>
                <span class="bm-asset-at">${ago(a.at)}</span>
                <button class="bm-x" data-bm-del-asset="${a.id}" aria-label="Remove asset">✕</button>
              </div>`).join("") : `<p class="bm-empty">No assets catalogued yet. Add your logo, fonts, and key photos so Phantom knows what exists.</p>`}
          </div>
        </section>

        <section class="bm-card bm-wide">
          <div class="bm-card-h"><h3>Memory</h3><span class="bm-hint">facts Phantom should never forget</span></div>
          <form class="bm-add" data-bm-mem>
            <input name="note" placeholder="e.g. Never discount below 20%. Fridays we post reels." required />
            <button class="btn" type="submit">Remember</button>
          </form>
          <div class="bm-mems">
            ${b.memory.length ? b.memory.map((m) => `
              <div class="bm-mem">
                <i class="bm-mem-dot"></i>
                <span>${esc(m.note)}</span>
                <em>${ago(m.at)}</em>
                <button class="bm-x" data-bm-del-mem="${m.id}" aria-label="Forget">✕</button>
              </div>`).join("") : `<p class="bm-empty">Nothing remembered yet. Rules, preferences, and hard limits go here.</p>`}
          </div>
        </section>
      </div>
    </div>`;

  el.querySelector("[data-bm-facts]").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    b.facts.name = String(f.get("name") || "").trim() || b.facts.name;
    b.facts.tagline = String(f.get("tagline") || "").trim();
    b.facts.voice = String(f.get("voice") || "").trim();
    b.facts.audience = String(f.get("audience") || "").trim();
    saveBrand(b);
    notify("Memory Keeper", "updated brand facts.");
    const ok = el.querySelector("[data-bm-saved]");
    if (ok) { ok.hidden = false; setTimeout(() => { ok.hidden = true; }, 1600); }
  };
  el.querySelector("[data-bm-asset]").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const label = String(f.get("label") || "").trim();
    if (!label) return;
    b.assets.unshift({ id: uid("ast"), kind: String(f.get("kind") || "Logo"), label, at: new Date().toISOString() });
    saveBrand(b);
    notify("Memory Keeper", `catalogued brand asset: ${label}.`);
    paint();
  };
  el.querySelector("[data-bm-mem]").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const note = String(f.get("note") || "").trim();
    if (!note) return;
    b.memory.unshift({ id: uid("mem"), note, at: new Date().toISOString() });
    saveBrand(b);
    notify("Memory Keeper", "stored a new brand memory.");
    paint();
  };
  el.querySelectorAll("[data-bm-del-asset]").forEach((x) => x.onclick = () => {
    b.assets = b.assets.filter((a) => a.id !== x.dataset.bmDelAsset); saveBrand(b); paint();
  });
  el.querySelectorAll("[data-bm-del-mem]").forEach((x) => x.onclick = () => {
    b.memory = b.memory.filter((m) => m.id !== x.dataset.bmDelMem); saveBrand(b); paint();
  });
}

/* ======================================================================
   AUTOMATION — approved workflows only; honest view of agents + lanes
   ====================================================================== */
const AGENT_STATE = {
  active: { label: "RUNNING", cls: "on" },
  waiting: { label: "WAITING", cls: "gate" },
  "needs-approval": { label: "APPROVE", cls: "gate" },
  blocked: { label: "BLOCKED", cls: "hold" },
  idle: { label: "DRAFT", cls: "idle" },
};

export function renderAutomation(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const paint = () => renderAutomation(el, opts);
  const agents = visible(store.state.agents || []);
  const lanes = (store.state.toolSpine || TOOL_SPINE).filter((t) => ["automation-desk", "build-planner", "squad-planner", "brain-router", "operating-standards"].includes(t.id) || t.mode !== "active");

  el.innerHTML = `
    <div class="au">
      <div class="bm-note au-note"><i></i>Nothing runs without your approval. Drafts stay drafts until you approve them in Approvals.</div>

      <section class="bm-card">
        <div class="bm-card-h"><h3>Your automations</h3><span class="bm-hint">${agents.length} configured</span></div>
        <form class="bm-add" data-au-add>
          <input name="name" placeholder="Name the automation — e.g. Friday reel reminder" required />
          <input name="mission" placeholder="What should it do?" required />
          <button class="btn" type="submit">Draft automation</button>
        </form>
        <div class="au-list">
          ${agents.length ? agents.map((a) => {
            const st = AGENT_STATE[a.status] || AGENT_STATE.idle;
            return `<div class="au-item">
              <span class="aops-led aops-${st.cls === "on" ? "on" : st.cls === "idle" ? "idle" : st.cls === "hold" ? "hold" : "gate"}"><i></i></span>
              <span class="au-item-main"><b>${esc(a.name)}</b><i>${esc(a.mission || a.role || "")}</i></span>
              <span class="aops-agent-mode aops-m-${st.cls === "on" ? "on" : st.cls === "idle" ? "idle" : st.cls === "hold" ? "hold" : "gate"}">${st.label}</span>
            </div>`;
          }).join("") : `<p class="bm-empty">No automations yet. Draft one above — it lands here as a draft, then goes through Approvals before anything runs.</p>`}
        </div>
      </section>

      <section class="bm-card">
        <div class="bm-card-h"><h3>Automation lanes</h3><span class="bm-hint">infrastructure standing by</span></div>
        <div class="au-lanes">
          ${lanes.map((t) => `
            <div class="au-lane">
              <div class="au-lane-top"><b>${esc(t.name)}</b><span class="aops-agent-mode aops-m-${t.mode === "active" ? "on" : t.mode === "standby" ? "idle" : t.mode === "gated" ? "gate" : "hold"}">${esc(String(t.mode).toUpperCase())}</span></div>
              <p class="au-lane-role">${esc(t.role)}</p>
              <p class="au-lane-act"><i></i>${esc(t.activity)}</p>
            </div>`).join("")}
        </div>
      </section>
    </div>`;

  el.querySelector("[data-au-add]").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const mission = String(f.get("mission") || "").trim();
    if (!name || !mission) return;
    const agentId = uid("agt");
    store.state.agents.unshift({ id: agentId, ws: "phantomforce", name, mission, status: "idle" });
    store.state.approvals.unshift({
      id: uid("app"), ws: "phantomforce", type: "automation",
      title: `Enable automation: ${name}`, detail: mission,
      ref: agentId, status: "pending", requestedBy: "Automation Desk", at: new Date().toISOString(),
    });
    pushActivity("Automation Desk", `drafted automation "${name}" — waiting on approval.`);
    store.save();
    notify("Automation Desk", `drafted "${name}".`);
    paint();
  };
}
