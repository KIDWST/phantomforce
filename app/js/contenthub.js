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
const chState = { tab: "overview", platform: "all", ctype: "all", eng: "likes" };

export function renderContentHub(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const data = loadContent();
  const tabs = [["overview", "Overview"], ["platforms", "Social platforms"], ["content", "Content types"], ["engagement", "Engagement"], ["scheduled", "Scheduled"]];
  el.innerHTML = `
    <div class="ch">
      <div class="ch-tabs">
        ${tabs.map(([id, l]) => `<button class="ch-tab ${chState.tab === id ? "is-active" : ""}" data-ch-tab="${id}">${l}</button>`).join("")}
        <span class="ch-src">${data.posts.length} items · updated ${ago(new Date(data.updatedAt).toISOString())}</span>
      </div>
      <div class="ch-body" data-ch-body></div>
    </div>`;
  el.querySelectorAll("[data-ch-tab]").forEach((b) => b.onclick = () => { chState.tab = b.dataset.chTab; renderContentHub(el, opts); });
  const body = el.querySelector("[data-ch-body]");
  const t = chState.tab;
  if (t === "overview") renderOverview(body, data, esc, el, opts);
  else if (t === "platforms") renderPlatforms(body, data, esc, el, opts);
  else if (t === "content") renderContentTypes(body, data, esc, el, opts);
  else if (t === "engagement") renderEngagement(body, data, esc, el, opts);
  else if (t === "scheduled") renderScheduled(body, data, esc);
}

function kpi(label, value, sub, tone) {
  return `<div class="ch-kpi ${tone || ""}"><span class="ch-kpi-k">${label}</span><b class="ch-kpi-v">${value}</b><span class="ch-kpi-s">${sub || ""}</span></div>`;
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

function postCard(p, esc) {
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
    <span class="ch-post-stats">
      <span>${svgIc("eye")}${K(p.metrics.reach)}</span>
      <span>${svgIc("heart")}${K(p.metrics.likes)}</span>
      <span>${svgIc("chat")}${K(p.metrics.comments)}</span>
      <span>${svgIc("share")}${K(p.metrics.shares)}</span>
    </span>
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
  const maxR = Math.max(1, ...a.series.map((s) => s.reach));
  const W = 640, H = 150;
  const pts = a.series.map((s, i) => [i / (a.series.length - 1) * W, H - (s.reach / maxR) * (H - 12) - 6]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const maxPlat = Math.max(1, ...a.byPlatform.map((p) => p.engagement));
  const typeTotal = a.byType.reduce((s, t) => s + t.count, 0) || 1;
  let acc = 0;
  const donut = a.byType.map((t, i) => { const frac = t.count / typeTotal; const seg = { off: acc, len: frac, hue: 150 + i * 26 }; acc += frac; return seg; });
  el.innerHTML = `
    <div class="an">
      <div class="an-src">${svgIc("up")} Live from <b>Content Hub</b> · ${a.totals.posts} published items · updated ${ago(new Date(data.updatedAt).toISOString())}</div>
      <div class="ch-kpis">
        ${kpi("Reach", K(a.totals.reach), "30-day")}
        ${kpi("Engagement rate", a.totals.engagementRate + "%", `${K(a.totals.engagement)} actions`)}
        ${kpi("Followers gained", "+" + K(a.totals.followers), "net new", "good")}
        ${kpi("Video views", K(a.totals.views), "watch-through")}
        ${kpi("Top platform", a.byPlatform[0] ? a.byPlatform[0].name : "—", a.byPlatform[0] ? K(a.byPlatform[0].reach) + " reach" : "")}
      </div>
      <div class="ch-cols">
        <div class="ch-card an-wide">
          <div class="ch-card-h"><h3>Reach — last 30 days</h3></div>
          <svg class="an-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="an-area" d="${area}"/><path class="an-line" d="${line}"/></svg>
        </div>
        <div class="ch-card">
          <div class="ch-card-h"><h3>Content mix</h3></div>
          <div class="an-donut-wrap">
            <svg class="an-donut" viewBox="0 0 42 42">${donut.map((s) => `<circle class="an-seg" cx="21" cy="21" r="15.9" fill="none" stroke="hsl(${s.hue},80%,55%)" stroke-width="6" stroke-dasharray="${(s.len * 100).toFixed(2)} ${(100 - s.len * 100).toFixed(2)}" stroke-dashoffset="${(25 - s.off * 100).toFixed(2)}"/>`).join("")}<text x="21" y="22.5" class="an-donut-c">${a.totals.posts}</text></svg>
            <div class="an-legend">${a.byType.map((t, i) => `<span><i style="background:hsl(${150 + i * 26},80%,55%)"></i>${esc(t.label)} <b>${t.count}</b></span>`).join("")}</div>
          </div>
        </div>
      </div>
      <div class="ch-card">
        <div class="ch-card-h"><h3>Engagement by platform</h3></div>
        <div class="ch-bars">${a.byPlatform.map((p) => `<div class="ch-bar-row"><span class="ch-bar-lab"><i class="ch-dot" style="background:${p.color}"></i>${esc(p.name)}</span>
          <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * p.engagement / maxPlat)}%;background:${p.color}"></span></span><b class="ch-bar-val">${K(p.engagement)}</b></div>`).join("")}</div>
      </div>
      <div class="ch-card">
        <div class="ch-card-h"><h3>Top performing</h3><button class="section-link" data-open-ws="content">Open Content Hub →</button></div>
        <div class="ch-grid">${a.topPosts.map((p) => postCard(p, esc)).join("")}</div>
      </div>
    </div>`;
  el.querySelectorAll("[data-ch-open]").forEach((b) => b.onclick = () => openPost(data.posts.find((p) => p.id === b.dataset.chOpen), esc));
}
