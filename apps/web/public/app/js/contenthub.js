/* PhantomForce — Content Hub: every social post, video, image, and its full
   engagement, in one place. Tabs split by SOCIAL PLATFORM and by CONTENT/
   ENGAGEMENT type (images, videos, posts, likes, comments, reactions…).

   It owns a normalized content dataset (seeded once, persisted) and exposes a
   clean data API — loadContent() / analyze() — so the Analytics view (and
   anything else) can fetch the same numbers with zero coupling. */

const CH_KEY = "pf.contenthub.v2";
const DAY = 864e5;

export const PLATFORMS = [
  { id: "instagram", name: "Instagram", color: "#e1306c", handle: "@phantomforce", types: ["image", "carousel", "reel", "story"] },
  { id: "tiktok",    name: "TikTok",    color: "#ff2b55", handle: "@phantomforce", types: ["short", "video"] },
  { id: "youtube",   name: "YouTube",   color: "#ff3b30", handle: "PhantomForce", types: ["video", "short"] },
  { id: "facebook",  name: "Facebook",  color: "#1877f2", handle: "PhantomForce", types: ["image", "video", "text", "carousel"] },
  { id: "x",         name: "X",         color: "#9fb0bd", handle: "@phantomforce", types: ["text", "image", "video"] },
  { id: "linkedin",  name: "LinkedIn",  color: "#3b9dff", handle: "PhantomForce", types: ["text", "image", "article"] },
  { id: "pinterest", name: "Pinterest", color: "#e60023", handle: "PhantomForce", types: ["image", "carousel"] },
];
export const TYPES = { image: "Image", carousel: "Carousel", reel: "Reel", short: "Short", video: "Video", story: "Story", text: "Post", article: "Article" };
const plat = (id) => PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
const isVideo = (t) => ["reel", "short", "video"].includes(t);

/* ---------------- seeded generation (stable across reloads) ---------------- */
function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CAPTIONS = [
  "Your business, running while you sleep 👻", "One prompt. A whole campaign.", "Watch PhantomForce close a lead in real time",
  "The operator you couldn't afford to hire", "Before / after: an inbox on autopilot", "5 things PhantomForce did before your coffee",
  "How we turned a DM into a $2,400 booking", "The green ghost never misses a follow-up", "AI that drafts, you approve, it sends",
  "Behind the scenes: the Media Lab", "Threat watch caught this scam in 3 seconds", "From quote to paid in one thread",
  "Your calendar, booked without the back-and-forth", "Meet the phantom that runs the boring half", "We generated this ad in 11 seconds",
  "Nothing sends without you. Ever.", "The dashboard that reads your whole business", "Reels that write themselves",
  "Proof: 24/7 and never tired", "Ask for an outcome, not a task",
];
const COMMENTS = [
  ["marketing_mia", "okay this is actually insane 🔥", "pos"], ["deshawn.builds", "how much is it??", "neu"],
  ["the_realtor_kate", "just signed up, wish me luck", "pos"], ["gymowner_rob", "does it do DMs on IG too?", "neu"],
  ["skeptic_sam", "seems too good to be true tbh", "neg"], ["salonbyleah", "the follow-ups alone are worth it", "pos"],
  ["chicagoshots", "the media lab is unreal 👻", "pos"], ["frank_hvac", "finally something that just works", "pos"],
  ["nina.codes", "the privacy angle sold me", "pos"], ["coach_will", "can it post for me automatically?", "neu"],
  ["mant_detail", "booked 3 jobs this week off this", "pos"], ["quiet_lurker", "commenting so i remember this", "neu"],
];
const HASHTAGS = ["#AI", "#smallbusiness", "#automation", "#phantomforce", "#entrepreneur", "#marketing", "#solopreneur", "#contentcreation", "#business", "#productivity"];
const IDEA_BANK = [
  { title: "Founder proof clip", angle: "Show one before/after operator win in 30 seconds.", format: "Reel", platforms: ["instagram", "tiktok", "youtube"], next: "Record screen capture plus owner voiceover." },
  { title: "Client objection carousel", angle: "Turn the top sales objection into a five-card answer.", format: "Carousel", platforms: ["instagram", "linkedin"], next: "Pull the strongest objection from recent leads." },
  { title: "Behind the build", angle: "Show the cockpit, approvals, and safety gates without naming tools.", format: "Short", platforms: ["youtube", "x"], next: "Clip the dashboard and write a plain-language hook." },
  { title: "Offer breakdown", angle: "Explain what the Pro Plan actually handles for a business owner.", format: "Post", platforms: ["linkedin", "facebook"], next: "Draft three outcomes and one proof point." },
  { title: "Trend response", angle: "React to the current creator/business automation trend with a PhantomForce take.", format: "Text + image", platforms: ["x", "linkedin"], next: "Use Analytics trend signals before drafting." },
  { title: "Trust and safety note", angle: "Show that nothing sends, spends, or publishes without approval.", format: "Story", platforms: ["instagram", "facebook"], next: "Turn approval gates into a simple visual sequence." },
];
const PRODUCTION_STEPS = [
  ["Idea", "Choose the hook and business outcome."],
  ["Draft", "Write caption, visual direction, and CTA."],
  ["Asset", "Create or attach image/video source."],
  ["Review", "Owner checks claims, pricing, and safety."],
  ["Schedule", "Queue manually or wait for approved connector."],
];

function genPosts() {
  const rng = mulberry(20260705);
  const posts = [];
  const N = 34;
  for (let i = 0; i < N; i++) {
    const p = PLATFORMS[Math.floor(rng() * PLATFORMS.length)];
    const type = p.types[Math.floor(rng() * p.types.length)];
    const daysAgo = Math.floor(rng() * 44);
    const scheduled = i < 3;                 // a few upcoming
    const publishedAt = new Date(Date.now() + (scheduled ? (1 + i) * DAY : -daysAgo * DAY)).toISOString();
    // reach scaled by platform + type virality
    const base = { instagram: 5200, tiktok: 14000, youtube: 3800, facebook: 4200, x: 2600, linkedin: 3100, pinterest: 2200 }[p.id];
    const viral = 0.4 + rng() * (isVideo(type) ? 3.4 : 1.6);
    const reach = Math.round(base * viral);
    const impressions = Math.round(reach * (1.15 + rng() * 0.5));
    const erBase = { instagram: 0.045, tiktok: 0.09, youtube: 0.05, facebook: 0.03, x: 0.025, linkedin: 0.04, pinterest: 0.02 }[p.id];
    const er = erBase * (0.6 + rng() * 1.1);
    const likes = Math.round(reach * er);
    const comments = Math.round(likes * (0.05 + rng() * 0.12));
    const shares = Math.round(likes * (0.03 + rng() * 0.14));
    const saves = Math.round(likes * (0.06 + rng() * 0.22));
    const views = isVideo(type) ? Math.round(reach * (1.4 + rng() * 2.6)) : 0;
    const watch = isVideo(type) ? Math.round(6 + rng() * 44) : 0;
    const clicks = Math.round(reach * (0.008 + rng() * 0.03));
    const followersGained = Math.round((likes + shares * 4) * (0.01 + rng() * 0.05));
    const reactions = p.id === "facebook" || p.id === "linkedin"
      ? { like: Math.round(likes * 0.62), love: Math.round(likes * 0.2), haha: Math.round(likes * 0.08), wow: Math.round(likes * 0.06), sad: Math.round(likes * 0.02), angry: Math.round(likes * 0.02) }
      : null;
    const nc = 2 + Math.floor(rng() * 4);
    const cmts = [];
    for (let k = 0; k < nc; k++) { const c = COMMENTS[Math.floor(rng() * COMMENTS.length)]; cmts.push({ user: c[0], text: c[1], sentiment: c[2], at: new Date(Date.parse(publishedAt) + Math.floor(rng() * 6) * 3600e3).toISOString(), likes: Math.floor(rng() * 40) }); }
    const tags = HASHTAGS.slice().sort(() => rng() - 0.5).slice(0, 3 + Math.floor(rng() * 3));
    const hue = Math.floor(rng() * 360);
    posts.push({
      id: `post-${i}`, platform: p.id, type, caption: CAPTIONS[i % CAPTIONS.length],
      publishedAt, status: scheduled ? "scheduled" : "published", hue,
      hashtags: tags, mentions: [],
      metrics: { reach, impressions, likes, comments, shares, saves, views, watchAvg: watch, clicks, followersGained, engagementRate: +(100 * (likes + comments + shares + saves) / Math.max(1, reach)).toFixed(1), reactions },
      comments: cmts,
    });
  }
  return posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/* ---------------- data API (Analytics + Hub both use this) ---------------- */
export function loadContent() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(CH_KEY) || "null"); } catch {}
  if (saved && Array.isArray(saved.posts) && saved.posts.length) return saved;
  const data = { posts: genPosts(), updatedAt: Date.now() };
  try { localStorage.setItem(CH_KEY, JSON.stringify(data)); } catch {}
  return data;
}
export function analyze(posts) {
  const pub = posts.filter((p) => p.status === "published");
  const sum = (f) => pub.reduce((a, p) => a + f(p.metrics), 0);
  const totals = {
    posts: pub.length, reach: sum((m) => m.reach), impressions: sum((m) => m.impressions),
    likes: sum((m) => m.likes), comments: sum((m) => m.comments), shares: sum((m) => m.shares),
    saves: sum((m) => m.saves), views: sum((m) => m.views), clicks: sum((m) => m.clicks),
    followers: sum((m) => m.followersGained),
  };
  totals.engagement = totals.likes + totals.comments + totals.shares + totals.saves;
  totals.engagementRate = +(100 * totals.engagement / Math.max(1, totals.reach)).toFixed(1);
  const byPlatform = PLATFORMS.map((p) => {
    const rows = pub.filter((x) => x.platform === p.id);
    return { ...p, count: rows.length, reach: rows.reduce((a, x) => a + x.metrics.reach, 0), engagement: rows.reduce((a, x) => a + x.metrics.likes + x.metrics.comments + x.metrics.shares + x.metrics.saves, 0), followers: rows.reduce((a, x) => a + x.metrics.followersGained, 0) };
  }).filter((p) => p.count).sort((a, b) => b.reach - a.reach);
  const byType = Object.keys(TYPES).map((t) => {
    const rows = pub.filter((x) => x.type === t);
    return { type: t, label: TYPES[t], count: rows.length, reach: rows.reduce((a, x) => a + x.metrics.reach, 0) };
  }).filter((t) => t.count).sort((a, b) => b.count - a.count);
  // 30-day reach + engagement timeseries
  const days = 30, series = [];
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = Date.now() - d * DAY, dayEnd = dayStart + DAY;
    const rows = pub.filter((x) => { const t = Date.parse(x.publishedAt); return t >= dayStart && t < dayEnd; });
    series.push({ t: dayStart, reach: rows.reduce((a, x) => a + x.metrics.reach, 0), engagement: rows.reduce((a, x) => a + x.metrics.likes + x.metrics.comments, 0) });
  }
  const topPosts = pub.slice().sort((a, b) => (b.metrics.likes + b.metrics.comments + b.metrics.shares) - (a.metrics.likes + a.metrics.comments + a.metrics.shares)).slice(0, 6);
  return { totals, byPlatform, byType, series, topPosts };
}

/* ---------------- formatting + thumbs ---------------- */
const K = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n || 0);
function ago(iso) { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 0) return "in " + rel(-s); return rel(s) + " ago"; }
function rel(s) { if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m"; if (s < 86400) return Math.round(s / 3600) + "h"; return Math.round(s / 86400) + "d"; }
function thumb(post) {
  const c = plat(post.platform).color;
  return `background:
    radial-gradient(80% 90% at 25% 15%, hsla(${post.hue},70%,55%,0.5), transparent 60%),
    radial-gradient(70% 80% at 85% 90%, ${c}55, transparent 60%),
    linear-gradient(150deg, #08120e, #050b09);`;
}
const PGLYPH = { instagram: "◉", tiktok: "♪", youtube: "▶", facebook: "f", x: "𝕏", linkedin: "in", pinterest: "P" };
function svgIc(k) {
  const P = { heart: `<path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5.5 1.2C13.5 10 8 13.5 8 13.5z"/>`, chat: `<path d="M3 4h10v7H7l-3 2v-2H3z"/>`, share: `<path d="M11 5.5a2 2 0 1 0-2-2M5 8a2 2 0 1 0 0 .1M11 12.5a2 2 0 1 0-2-2M9.2 4.6L6.8 6.9M6.8 9.1l2.4 2.3"/>`, save: `<path d="M4 3h8v10l-4-2.5L4 13z"/>`, eye: `<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`, users: `<circle cx="6" cy="6" r="2.1"/><path d="M2.6 13c0-2 1.5-3.3 3.4-3.3S9.4 11 9.4 13"/>`, up: `<path d="M8 13V4M4.5 7.5L8 4l3.5 3.5"/>` };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}

/* =========================================================================
   CONTENT HUB
   ========================================================================= */
const chState = { tab: "ideas", platform: "all", ctype: "all", eng: "likes" };

export function renderContentHub(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const data = loadContent();
  const tabs = [["ideas", "New ideas"], ["drafts", "Draft queue"], ["calendar", "Calendar"], ["production", "Production"], ["library", "Library"]];
  el.innerHTML = `
    <div class="ch">
      <section class="ch-creator-head">
        <div>
          <p class="ch-eyebrow">Creator workspace</p>
          <h3>Plan the next useful thing to publish.</h3>
          <p>Content Hub is for ideas, drafts, creative direction, approval-ready posts, and scheduled content. Analytics handles performance and business trends.</p>
        </div>
        <button class="btn btn-primary" data-ch-action="new-idea">Capture idea</button>
      </section>
      <div class="ch-tabs">
        ${tabs.map(([id, l]) => `<button class="ch-tab ${chState.tab === id ? "is-active" : ""}" data-ch-tab="${id}">${l}</button>`).join("")}
        <span class="ch-src">${IDEA_BANK.length} ideas · ${data.posts.filter((p) => p.status === "scheduled").length} scheduled · updated ${ago(new Date(data.updatedAt).toISOString())}</span>
      </div>
      <div class="ch-body" data-ch-body></div>
    </div>`;
  el.querySelectorAll("[data-ch-tab]").forEach((b) => b.onclick = () => { chState.tab = b.dataset.chTab; renderContentHub(el, opts); });
  el.querySelector("[data-ch-action='new-idea']")?.addEventListener("click", () => {
    opts.notify?.("Content Hub", "New content idea capture prepared. No post was created or sent.");
    chState.tab = "ideas";
    renderContentHub(el, opts);
  });
  const body = el.querySelector("[data-ch-body]");
  const t = chState.tab;
  if (t === "ideas") renderCreatorIdeas(body, data, esc, el, opts);
  else if (t === "drafts") renderDraftQueue(body, data, esc, el, opts);
  else if (t === "calendar") renderContentCalendar(body, data, esc, el, opts);
  else if (t === "production") renderProductionBoard(body, data, esc, el, opts);
  else if (t === "library") renderContentLibrary(body, data, esc, el, opts);
}

function kpi(label, value, sub, tone) {
  return `<div class="ch-kpi ${tone || ""}"><span class="ch-kpi-k">${label}</span><b class="ch-kpi-v">${value}</b><span class="ch-kpi-s">${sub || ""}</span></div>`;
}
function ideaCard(idea, esc, i) {
  return `<article class="ch-idea-card">
    <div class="ch-idea-top"><span>${esc(idea.format)}</span><b>${esc(idea.title)}</b></div>
    <p>${esc(idea.angle)}</p>
    <div class="ch-idea-platforms">${idea.platforms.map((id) => `<span><i class="ch-dot" style="background:${plat(id).color}"></i>${esc(plat(id).name)}</span>`).join("")}</div>
    <div class="ch-idea-next"><b>Next:</b> ${esc(idea.next)}</div>
    <button class="btn btn-good" data-ch-action="draft" data-idea-i="${i}">Turn into draft</button>
  </article>`;
}
function renderCreatorIdeas(body, data, esc, root, opts) {
  const scheduled = data.posts.filter((p) => p.status === "scheduled").length;
  body.innerHTML = `
    <div class="ch-kpis">
      ${kpi("Ideas ready", IDEA_BANK.length, "creator backlog")}
      ${kpi("Draft prompts", 4, "ready to shape")}
      ${kpi("Scheduled", scheduled, "waiting to publish")}
      ${kpi("Approval-needed", 3, "claim and CTA review")}
      ${kpi("Creator mode", "Active", "content planning", "good")}
    </div>
    <div class="ch-creator-layout">
      <section class="ch-card">
        <div class="ch-card-h"><h3>Recommended next ideas</h3><span class="ch-src">AI-filtered for creator action</span></div>
        <div class="ch-idea-grid">${IDEA_BANK.slice(0, 4).map((idea, i) => ideaCard(idea, esc, i)).join("")}</div>
      </section>
      <aside class="ch-card ch-creator-side">
        <h3>Creator brief</h3>
        <p>Make content that helps a business owner understand the outcome, trust the system, and know what to approve next.</p>
        <div class="ch-brief-list">
          <span><b>Hook</b>Outcome first</span>
          <span><b>Proof</b>Show workflow, not tool names</span>
          <span><b>CTA</b>Ask for manual approval or discovery</span>
          <span><b>Guardrail</b>No fake live claims</span>
        </div>
      </aside>
    </div>`;
  wireCreatorActions(body, opts, root);
}
function renderDraftQueue(body, data, esc, root, opts) {
  const drafts = IDEA_BANK.slice(1, 5);
  body.innerHTML = `
    <div class="ch-card">
      <div class="ch-card-h"><h3>Draft queue</h3><span class="ch-src">Concepts waiting for copy, assets, and approval</span></div>
      <div class="ch-draft-list">
        ${drafts.map((idea, i) => `<article class="ch-draft">
          <span class="ch-draft-step">${i + 1}</span>
          <div>
            <h4>${esc(idea.title)}</h4>
            <p>${esc(idea.angle)}</p>
            <div class="ch-draft-meta"><span>${esc(idea.format)}</span><span>Needs caption</span><span>Needs asset direction</span></div>
          </div>
          <button class="btn" data-ch-action="approve-draft" data-idea-i="${i + 1}">Prepare approval</button>
        </article>`).join("")}
      </div>
    </div>`;
  wireCreatorActions(body, opts, root);
}
function renderContentCalendar(body, data, esc, root, opts) {
  const rows = data.posts.filter((p) => p.status === "scheduled").sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  body.innerHTML = `
    <div class="ch-card">
      <div class="ch-card-h"><h3>Upcoming content calendar</h3><span class="ch-src">Approval-only schedule view</span></div>
      ${rows.length ? `<div class="ch-calendar-list">${rows.map((p) => `<button class="ch-calendar-item" data-ch-open="${p.id}">
        <span class="ch-calendar-date">${ago(p.publishedAt)}</span>
        <span class="ch-tr-thumb" style="${thumb(p)}"></span>
        <span><b>${esc(p.caption)}</b><i>${esc(plat(p.platform).name)} · ${esc(TYPES[p.type])}</i></span>
        <em>scheduled</em>
      </button>`).join("")}</div>` : `<p class="empty-line">Nothing scheduled. Generate content in the Media Lab and queue it here.</p>`}
    </div>`;
  wirePostCards(body, data, esc, root, opts);
}
function renderProductionBoard(body, data, esc, root, opts) {
  body.innerHTML = `
    <div class="ch-card">
      <div class="ch-card-h"><h3>Production workflow</h3><span class="ch-src">Creator-side pipeline</span></div>
      <div class="ch-production">
        ${PRODUCTION_STEPS.map(([name, copy], i) => `<article class="ch-production-step">
          <span>${i + 1}</span>
          <h4>${esc(name)}</h4>
          <p>${esc(copy)}</p>
        </article>`).join("")}
      </div>
    </div>
    <div class="ch-card">
      <div class="ch-card-h"><h3>Asset requests</h3><span class="ch-src">ready for Media Lab</span></div>
      <div class="ch-draft-list">
        ${IDEA_BANK.slice(0, 3).map((idea, i) => `<article class="ch-draft">
          <span class="ch-draft-step">${i + 1}</span>
          <div><h4>${esc(idea.title)}</h4><p>${esc(idea.next)}</p><div class="ch-draft-meta"><span>${esc(idea.format)}</span><span>Media Lab optional</span></div></div>
          <button class="btn" data-open-ws="media">Open Media Lab</button>
        </article>`).join("")}
      </div>
    </div>`;
}
function renderContentLibrary(body, data, esc, root, opts) {
  const rows = data.posts.slice(0, 18);
  body.innerHTML = `
    <div class="ch-chips" data-ch-type>
      ${[["all", "All"], ["reel", "Reels"], ["video", "Video"], ["carousel", "Carousels"], ["text", "Posts"], ["image", "Images"]].map(([id, l]) => `<button class="ch-chip ${chState.ctype === id ? "is-on" : ""}" data-v="${id}">${esc(l)}</button>`).join("")}
    </div>
    <div class="ch-grid ch-grid-lg">${rows.filter((p) => chState.ctype === "all" || p.type === chState.ctype).map((p) => postCard(p, esc, { creator: true })).join("")}</div>`;
  body.querySelectorAll("[data-ch-type] button").forEach((b) => b.onclick = () => { chState.ctype = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}
function wireCreatorActions(body, opts, root) {
  body.querySelectorAll("[data-ch-action]").forEach((btn) => btn.addEventListener("click", () => {
    const idea = IDEA_BANK[Number(btn.dataset.ideaI || 0)] || IDEA_BANK[0];
    const action = btn.dataset.chAction === "approve-draft" ? "Approval preview prepared" : "Draft prepared";
    opts.notify?.("Content Hub", `${action} for ${idea.title}. No post was sent or published.`);
    if (root) renderContentHub(root, opts);
  }));
}
function renderOverview(body, data, esc, root, opts) {
  const a = analyze(data.posts);
  const maxP = Math.max(1, ...a.byPlatform.map((p) => p.reach));
  body.innerHTML = `
    <div class="ch-kpis">
      ${kpi("Total reach", K(a.totals.reach), `${K(a.totals.impressions)} impressions`)}
      ${kpi("Engagement", K(a.totals.engagement), `${a.totals.engagementRate}% rate`)}
      ${kpi("Likes", K(a.totals.likes), `${K(a.totals.comments)} comments`)}
      ${kpi("Video views", K(a.totals.views), "reels · shorts · video")}
      ${kpi("Followers gained", "+" + K(a.totals.followers), "last 45 days", "good")}
    </div>
    <div class="ch-cols">
      <div class="ch-card">
        <div class="ch-card-h"><h3>Reach by platform</h3></div>
        <div class="ch-bars">
          ${a.byPlatform.map((p) => `<div class="ch-bar-row"><span class="ch-bar-lab"><i class="ch-dot" style="background:${p.color}"></i>${esc(p.name)}</span>
            <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * p.reach / maxP)}%;background:${p.color}"></span></span>
            <b class="ch-bar-val">${K(p.reach)}</b></div>`).join("")}
        </div>
      </div>
      <div class="ch-card">
        <div class="ch-card-h"><h3>Content mix</h3></div>
        <div class="ch-mix">
          ${a.byType.map((t) => `<div class="ch-mix-row"><span>${esc(t.label)}</span><span class="ch-mix-bar"><span style="width:${Math.round(100 * t.count / a.totals.posts)}%"></span></span><b>${t.count}</b></div>`).join("")}
        </div>
      </div>
    </div>
    <div class="ch-card">
      <div class="ch-card-h"><h3>Top posts</h3><span class="ch-src">by engagement</span></div>
      <div class="ch-grid">${a.topPosts.map((p) => postCard(p, esc)).join("")}</div>
    </div>`;
  wirePostCards(body, data, esc, root, opts);
}

function renderPlatforms(body, data, esc, root, opts) {
  const counts = {}; data.posts.forEach((p) => counts[p.platform] = (counts[p.platform] || 0) + 1);
  const chips = [["all", "All", data.posts.length]].concat(PLATFORMS.filter((p) => counts[p.id]).map((p) => [p.id, p.name, counts[p.id]]));
  if (!chips.find((c) => c[0] === chState.platform)) chState.platform = "all";
  const rows = data.posts.filter((p) => chState.platform === "all" || p.platform === chState.platform);
  const sub = chState.platform === "all" ? null : platStrip(rows, esc);
  body.innerHTML = `
    <div class="ch-chips" data-ch-plat>
      ${chips.map(([id, l, n]) => `<button class="ch-chip ${chState.platform === id ? "is-on" : ""}" data-v="${id}">${id !== "all" ? `<i class="ch-dot" style="background:${plat(id).color}"></i>` : ""}${esc(l)} <em>${n}</em></button>`).join("")}
    </div>
    ${sub || ""}
    <div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("") || `<p class="empty-line">No posts on this platform.</p>`}</div>`;
  body.querySelectorAll("[data-ch-plat] button").forEach((b) => b.onclick = () => { chState.platform = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}
function platStrip(rows, esc) {
  const pub = rows.filter((r) => r.status === "published");
  const s = (f) => pub.reduce((a, x) => a + f(x.metrics), 0);
  const p = plat(rows[0].platform);
  return `<div class="ch-platstrip" style="--pc:${p.color}">
    ${kpi("Reach", K(s((m) => m.reach)), p.handle)}
    ${kpi("Likes", K(s((m) => m.likes)), "")}
    ${kpi("Comments", K(s((m) => m.comments)), "")}
    ${kpi("Shares", K(s((m) => m.shares)), "")}
    ${kpi("Saves", K(s((m) => m.saves)), "")}
    ${kpi("Followers", "+" + K(s((m) => m.followersGained)), "")}
  </div>`;
}

function renderContentTypes(body, data, esc, root, opts) {
  const groups = [["all", "All"], ["image", "Images"], ["carousel", "Carousels"], ["reel", "Reels"], ["short", "Shorts"], ["video", "Videos"], ["story", "Stories"], ["text", "Posts"], ["article", "Articles"]];
  const counts = {}; data.posts.forEach((p) => counts[p.type] = (counts[p.type] || 0) + 1);
  const avail = groups.filter(([id]) => id === "all" || counts[id]);
  if (!avail.find((c) => c[0] === chState.ctype)) chState.ctype = "all";
  const rows = data.posts.filter((p) => chState.ctype === "all" || p.type === chState.ctype);
  body.innerHTML = `
    <div class="ch-chips" data-ch-type>
      ${avail.map(([id, l]) => `<button class="ch-chip ${chState.ctype === id ? "is-on" : ""}" data-v="${id}">${esc(l)} <em>${id === "all" ? data.posts.length : counts[id]}</em></button>`).join("")}
    </div>
    <div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("")}</div>`;
  body.querySelectorAll("[data-ch-type] button").forEach((b) => b.onclick = () => { chState.ctype = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}

function renderEngagement(body, data, esc, root, opts) {
  const tabs = [["likes", "Likes"], ["comments", "Comments"], ["reactions", "Reactions"], ["shares", "Shares & saves"]];
  if (!tabs.find((t) => t[0] === chState.eng)) chState.eng = "likes";
  const pub = data.posts.filter((p) => p.status === "published");
  let inner = "";
  if (chState.eng === "likes") {
    const rows = pub.slice().sort((a, b) => b.metrics.likes - a.metrics.likes);
    inner = `<div class="ch-table"><div class="ch-tr ch-th"><span>Post</span><span>Platform</span><span>${svgIc("heart")} Likes</span><span>Rate</span></div>
      ${rows.map((p) => `<button class="ch-tr" data-ch-open="${p.id}"><span class="ch-tr-post"><i class="ch-tr-thumb" style="${thumb(p)}"></i>${esc(p.caption)}</span>
        <span><i class="ch-dot" style="background:${plat(p.platform).color}"></i>${plat(p.platform).name}</span><span class="ch-num">${K(p.metrics.likes)}</span><span class="ch-num">${p.metrics.engagementRate}%</span></button>`).join("")}</div>`;
  } else if (chState.eng === "comments") {
    const stream = [];
    pub.forEach((p) => p.comments.forEach((c) => stream.push({ ...c, post: p })));
    stream.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    inner = `<div class="ch-comments">${stream.slice(0, 40).map((c) => `<div class="ch-comment ch-s-${c.sentiment}">
      <span class="ch-c-av">${esc(c.user[0].toUpperCase())}</span>
      <span class="ch-c-body"><b>@${esc(c.user)} <span class="ch-c-sent">${c.sentiment === "pos" ? "positive" : c.sentiment === "neg" ? "critical" : "neutral"}</span></b>
        <span class="ch-c-text">${esc(c.text)}</span>
        <span class="ch-c-meta"><i class="ch-dot" style="background:${plat(c.post.platform).color}"></i>${plat(c.post.platform).name} · ${esc(c.post.caption.slice(0, 28))}… · ${ago(c.at)} · ${svgIc("heart")} ${c.likes}</span></span></div>`).join("")}</div>`;
  } else if (chState.eng === "reactions") {
    const R = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };
    pub.forEach((p) => { if (p.metrics.reactions) for (const k in R) R[k] += p.metrics.reactions[k]; });
    const total = Object.values(R).reduce((a, b) => a + b, 0) || 1;
    const EMO = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😠" };
    inner = `<div class="ch-react">${Object.entries(R).map(([k, v]) => `<div class="ch-react-row"><span class="ch-react-emo">${EMO[k]}</span><span class="ch-react-lab">${k}</span>
      <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * v / total)}%"></span></span><b>${K(v)}</b></div>`).join("")}
      <p class="ch-src">Reactions from Facebook & LinkedIn posts. Others report likes only.</p></div>`;
  } else {
    const rows = pub.slice().sort((a, b) => (b.metrics.shares + b.metrics.saves) - (a.metrics.shares + a.metrics.saves));
    inner = `<div class="ch-table"><div class="ch-tr ch-th"><span>Post</span><span>Platform</span><span>${svgIc("share")} Shares</span><span>${svgIc("save")} Saves</span></div>
      ${rows.map((p) => `<button class="ch-tr" data-ch-open="${p.id}"><span class="ch-tr-post"><i class="ch-tr-thumb" style="${thumb(p)}"></i>${esc(p.caption)}</span>
        <span><i class="ch-dot" style="background:${plat(p.platform).color}"></i>${plat(p.platform).name}</span><span class="ch-num">${K(p.metrics.shares)}</span><span class="ch-num">${K(p.metrics.saves)}</span></button>`).join("")}</div>`;
  }
  body.innerHTML = `<div class="ch-chips" data-ch-eng>${tabs.map(([id, l]) => `<button class="ch-chip ${chState.eng === id ? "is-on" : ""}" data-v="${id}">${l}</button>`).join("")}</div>${inner}`;
  body.querySelectorAll("[data-ch-eng] button").forEach((b) => b.onclick = () => { chState.eng = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}

function renderScheduled(body, data, esc) {
  const rows = data.posts.filter((p) => p.status === "scheduled").sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  body.innerHTML = rows.length ? `<div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("")}</div>` : `<p class="empty-line">Nothing scheduled. Generate content in the Media Lab and queue it here.</p>`;
}

function postCard(p, esc, options = {}) {
  const P = plat(p.platform);
  return `<button class="ch-post" data-ch-open="${p.id}">
    <span class="ch-post-thumb" style="${thumb(p)}">
      <span class="ch-post-plat" style="background:${P.color}">${PGLYPH[p.platform] || "●"}</span>
      <span class="ch-post-type">${TYPES[p.type]}</span>
      ${isVideo(p.type) ? `<span class="ch-post-play">▶</span>` : ""}
      ${p.status === "scheduled" ? `<span class="ch-post-sched">Scheduled ${ago(p.publishedAt)}</span>` : ""}
    </span>
    <span class="ch-post-cap">${esc(p.caption)}</span>
    <span class="ch-post-meta">${P.name} · ${p.status === "scheduled" ? "upcoming" : ago(p.publishedAt)}</span>
    ${options.creator ? `<span class="ch-post-stats ch-post-creator">
      <span>${esc(TYPES[p.type])}</span>
      <span>${p.hashtags.slice(0, 2).map((h) => esc(h)).join(" ")}</span>
    </span>` : `<span class="ch-post-stats">
      <span>${svgIc("eye")}${K(p.metrics.reach)}</span>
      <span>${svgIc("heart")}${K(p.metrics.likes)}</span>
      <span>${svgIc("chat")}${K(p.metrics.comments)}</span>
      <span>${svgIc("share")}${K(p.metrics.shares)}</span>
    </span>`}
  </button>`;
}

function wirePostCards(body, data, esc, root, opts) {
  body.querySelectorAll("[data-ch-open]").forEach((b) => b.onclick = () => openPost(data.posts.find((p) => p.id === b.dataset.chOpen), esc));
}
function openPost(p, esc) {
  if (!p) return;
  const P = plat(p.platform), m = p.metrics;
  let modal = document.querySelector("[data-ch-modal]");
  if (!modal) { modal = document.createElement("div"); modal.className = "ch-modal"; modal.setAttribute("data-ch-modal", ""); document.body.appendChild(modal); }
  const stat = (ic, lab, v) => `<div class="ch-dstat"><span>${svgIc(ic)} ${lab}</span><b>${K(v)}</b></div>`;
  modal.innerHTML = `<button class="ch-modal-bg" data-ch-x></button>
    <div class="ch-detail">
      <button class="ch-detail-x" data-ch-x>✕</button>
      <div class="ch-detail-media" style="${thumb(p)}"><span class="ch-post-plat" style="background:${P.color}">${PGLYPH[p.platform] || "●"}</span>${isVideo(p.type) ? `<span class="ch-post-play big">▶</span>` : ""}<span class="ch-post-type">${TYPES[p.type]}</span></div>
      <div class="ch-detail-side">
        <div class="ch-detail-h"><i class="ch-dot" style="background:${P.color}"></i><b>${P.name}</b><span>${P.handle}</span><em>${p.status === "scheduled" ? "Scheduled " + ago(p.publishedAt) : ago(p.publishedAt)}</em></div>
        <p class="ch-detail-cap">${esc(p.caption)}</p>
        <p class="ch-detail-tags">${p.hashtags.map((h) => `<span>${esc(h)}</span>`).join("")}</p>
        <div class="ch-dstats">
          ${stat("eye", "Reach", m.reach)}${stat("eye", "Impressions", m.impressions)}
          ${stat("heart", "Likes", m.likes)}${stat("chat", "Comments", m.comments)}
          ${stat("share", "Shares", m.shares)}${stat("save", "Saves", m.saves)}
          ${m.views ? stat("eye", "Views", m.views) : ""}${m.views ? `<div class="ch-dstat"><span>Avg watch</span><b>${m.watchAvg}s</b></div>` : ""}
          <div class="ch-dstat"><span>Eng. rate</span><b>${m.engagementRate}%</b></div>${stat("up", "Followers", m.followersGained)}
        </div>
        ${m.reactions ? `<div class="ch-detail-react">${Object.entries({ like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😠" }).map(([k, e]) => `<span>${e} ${K(m.reactions[k])}</span>`).join("")}</div>` : ""}
        <div class="ch-detail-cmh">Comments (${p.comments.length})</div>
        <div class="ch-detail-comments">${p.comments.map((c) => `<div class="ch-comment ch-s-${c.sentiment}"><span class="ch-c-av">${esc(c.user[0].toUpperCase())}</span><span class="ch-c-body"><b>@${esc(c.user)}</b><span class="ch-c-text">${esc(c.text)}</span><span class="ch-c-meta">${ago(c.at)} · ${svgIc("heart")} ${c.likes}</span></span></div>`).join("")}</div>
      </div>
    </div>`;
  modal.hidden = false;
  modal.querySelectorAll("[data-ch-x]").forEach((x) => x.onclick = () => { modal.hidden = true; modal.innerHTML = ""; });
}

/* =========================================================================
   ANALYTICS  (fetches the exact same data via analyze())
   ========================================================================= */
export function renderAnalytics(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const data = loadContent();
  const a = analyze(data.posts);
  const topPlatform = a.byPlatform[0];
  const topType = a.byType[0];
  const clickToLeadRate = +(100 * Math.max(1, Math.round(a.totals.clicks * 0.08)) / Math.max(1, a.totals.clicks)).toFixed(1);
  const modeledLeads = Math.max(1, Math.round(a.totals.clicks * 0.08));
  const modeledPipeline = modeledLeads * 850;
  const trendRows = [
    { label: "Short-form video", signal: `${K(a.totals.views)} views`, take: "Use reels and shorts for discovery, then retarget with offer posts." },
    { label: topPlatform ? `${topPlatform.name} reach` : "Channel reach", signal: topPlatform ? K(topPlatform.reach) : "-", take: "Put the strongest creator ideas on the channel already moving." },
    { label: topType ? `${topType.label} format` : "Content format", signal: topType ? `${topType.count} posts` : "-", take: "Keep the winning format in rotation before adding new experiments." },
    { label: "Audience intent", signal: `${K(a.totals.comments)} comments`, take: "Mine comments for objections, questions, and next content hooks." },
  ];
  const maxR = Math.max(1, ...a.series.map((s) => s.reach));
  const W = 640, H = 150;
  const pts = a.series.map((s, i) => [i / (a.series.length - 1) * W, H - (s.reach / maxR) * (H - 12) - 6]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const maxPlat = Math.max(1, ...a.byPlatform.map((p) => p.engagement));
  el.innerHTML = `
    <div class="an">
      <section class="an-hero">
        <div>
          <p class="ch-eyebrow">Business intelligence</p>
          <h3>What is trending, what is working, and what should change.</h3>
          <p>Analytics is the business view: performance, audience signals, channel trends, and modeled pipeline impact from local content data.</p>
        </div>
        <span class="an-src">${svgIc("up")} Source: <b>Content Hub data</b> · ${a.totals.posts} published items</span>
      </section>
      <div class="ch-kpis">
        ${kpi("Reach", K(a.totals.reach), "market attention")}
        ${kpi("Engagement rate", a.totals.engagementRate + "%", `${K(a.totals.engagement)} actions`)}
        ${kpi("Site clicks", K(a.totals.clicks), "intent signal")}
        ${kpi("Modeled leads", K(modeledLeads), `${clickToLeadRate}% of clicks`, "good")}
        ${kpi("Modeled pipeline", "$" + K(modeledPipeline), "estimate, not booked")}
      </div>
      <div class="ch-cols">
        <div class="ch-card an-wide">
          <div class="ch-card-h"><h3>Market attention trend</h3><span class="ch-src">reach over time</span></div>
          <svg class="an-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="an-area" d="${area}"/><path class="an-line" d="${line}"/></svg>
        </div>
        <div class="ch-card an-insight-card">
          <div class="ch-card-h"><h3>Top business read</h3></div>
          <b>${topPlatform ? esc(topPlatform.name) : "No channel"} is carrying attention.</b>
          <p>${topPlatform ? `${esc(topPlatform.name)} has the strongest current reach. Use it for proof-led posts and push experimental ideas elsewhere.` : "Publish more content before drawing a conclusion."}</p>
          <button class="section-link" data-open-ws="content">Plan next content -></button>
        </div>
      </div>
      <div class="an-business-grid">
        <section class="ch-card">
          <div class="ch-card-h"><h3>Trend signals</h3><span class="ch-src">what deserves attention</span></div>
          <div class="an-trend-list">
            ${trendRows.map((row) => `<article class="an-trend">
              <span>${esc(row.signal)}</span>
              <b>${esc(row.label)}</b>
              <p>${esc(row.take)}</p>
            </article>`).join("")}
          </div>
        </section>
        <section class="ch-card">
          <div class="ch-card-h"><h3>Channel performance</h3><span class="ch-src">engagement quality</span></div>
          <div class="ch-bars">${a.byPlatform.map((p) => `<div class="ch-bar-row"><span class="ch-bar-lab"><i class="ch-dot" style="background:${p.color}"></i>${esc(p.name)}</span>
            <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * p.engagement / maxPlat)}%;background:${p.color}"></span></span><b class="ch-bar-val">${K(p.engagement)}</b></div>`).join("")}</div>
        </section>
      </div>
      <div class="ch-card">
        <div class="ch-card-h"><h3>Business recommendations</h3><span class="ch-src">from content signals</span></div>
        <div class="an-reco-grid">
          <article><b>Double down</b><p>Keep publishing short-form proof and workflow clips where reach is already moving.</p></article>
          <article><b>Convert attention</b><p>Turn comments and clicks into follow-up prompts, lead magnets, and owner-approved offers.</p></article>
          <article><b>Test next</b><p>Run one objection carousel and one offer breakdown before changing the whole strategy.</p></article>
        </div>
      </div>
    </div>`;
  el.querySelectorAll("[data-ch-open]").forEach((b) => b.onclick = () => openPost(data.posts.find((p) => p.id === b.dataset.chOpen), esc));
}
