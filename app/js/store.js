/* PhantomForce Phantom — data core.
   Everything runs locally in the browser (localStorage). No sends, no posts,
   no payments, no provider calls happen from here — records move through
   draft → approval → *-ready states and stop there until a connector exists. */

const DB_KEY = "pf.phantom.v4";
const SESSION_KEY = "pf.session.v3";
const DAY = 86400000;

export const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 8)}${(Date.now() % 100000).toString(36)}`;
const days = (n) => new Date(Date.now() + n * DAY).toISOString();
export const fmtDate = (iso, opts = {}) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", ...opts });
export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString();
export const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
export const daysUntil = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

/* ---------------- offer ladder ---------------- */
export const PACKAGES = [
  { id: "starter", name: "Starter", price: 750, blurb: "Landing page or content sprint. One clear outcome, fast." },
  { id: "core", name: "Core", price: 1500, blurb: "Site + lead capture + follow-up system. The working baseline." },
  { id: "pro", name: "Pro", price: 2500, blurb: "Full build: site, store, media plan, review engine, Phantom setup." },
];
export const RETAINERS = [
  { id: "keeper", name: "Keeper", price: 150, blurb: "Monthly upkeep, security scan, review requests." },
  { id: "operator", name: "Operator", price: 300, blurb: "Upkeep + lead follow-up desk + monthly content drop." },
  { id: "partner", name: "Partner", price: 625, range: "$500–$750", blurb: "Full workforce running weekly: media, pipeline, protection." },
];

/* ---------------- seed ---------------- */
function seed() {
  const workspaces = [
    { id: "phantomforce", name: "PhantomForce", kind: "HQ", tagline: "The agency itself — command level." },
    { id: "chicagoshots", name: "ChicagoShots", kind: "Brand", tagline: "Media brand workspace inside PhantomForce." },
    { id: "test-client", name: "Test Client", kind: "Client", tagline: "What every client sees. Use it to preview the portal." },
  ];

  const leads = [
    { id: "lead-rivera", ws: "test-client", name: "Marisol Rivera", company: "Rivera Family Dental", source: "Instagram DM", status: "new", value: 1500, next: "Send intro + booking link", due: days(0), owner: "Follow-Up Desk", notes: "Asked about a new site + review push. Trust-sensitive: previous vendor ghosted her.", proposalId: "prop-rivera" },
    { id: "lead-okafor", ws: "test-client", name: "Sam Okafor", company: "Okafor Fitness", source: "Referral — Marcus", status: "follow-up", value: 2500, next: "Follow up with gym walkthrough offer", due: days(1), owner: "Lead Hunter", notes: "Wants store page for merch + class booking. Compare vs Mindbody pricing.", proposalId: null },
    { id: "lead-chen", ws: "chicagoshots", name: "Grace Chen", company: "Chen & Park Realty", source: "Website form", status: "proposal", value: 2500, next: "Proposal awaiting her review — nudge Thursday", due: days(2), owner: "Proposal Forge", notes: "Listing video packages, 4 properties/month. High retainer potential.", proposalId: "prop-chen" },
    { id: "lead-dobrev", ws: "chicagoshots", name: "Nina Dobrev", company: "Halsted Coffee Co.", source: "Walk-in / QR card", status: "won", value: 750, next: "Kick off content sprint — shot list Monday", due: days(4), owner: "Delivery Manager", notes: "Starter package signed. Wants reels + menu photos.", proposalId: "prop-dobrev" },
    { id: "lead-brooks", ws: "phantomforce", name: "Terry Brooks", company: "Brooks Plumbing", source: "Google Business", status: "follow-up", value: 1500, next: "Second touch: send the missed-call math", due: days(0), owner: "Follow-Up Desk", notes: "Misses ~10 calls/week. Core package pitch: capture + auto follow-up.", proposalId: null },
    { id: "lead-ade", ws: "phantomforce", name: "Folake Adeyemi", company: "Ade Events", source: "TikTok comment", status: "new", value: 750, next: "Qualify: event volume + current booking flow", due: days(1), owner: "Lead Hunter", notes: "Runs 3–4 events/month, currently books via DMs only.", proposalId: null },
    { id: "lead-lost", ws: "phantomforce", name: "Dan Whitfield", company: "Whitfield Auto", source: "Cold outreach", status: "lost", value: 1500, next: "Re-engage in 90 days with case study", due: days(60), owner: "Follow-Up Desk", notes: "Went with nephew's friend. Keep warm — that usually comes back.", proposalId: null },
  ];

  const proposals = [
    { id: "prop-rivera", ws: "test-client", client: "Rivera Family Dental", contact: "Marisol Rivera", pkg: "core", price: 1500, retainer: "keeper", status: "draft", pain: "New patients find her on Instagram but the booking trail dies in DMs; old vendor left the site half-finished.", scope: ["5-page site rebuild with online booking", "Review engine: request → approve → publish flow", "Lead capture wired to follow-up desk", "30-day post-launch watch"], timeline: "2 weeks build, launch on week 3", updated: days(-1) },
    { id: "prop-chen", ws: "chicagoshots", client: "Chen & Park Realty", contact: "Grace Chen", pkg: "pro", price: 2500, retainer: "partner", status: "sent-ready", pain: "Listings sit for weeks without video; competitors run cinematic walkthroughs and win sellers on the listing appointment.", scope: ["4 listing videos/month (shoot + edit + captions)", "Agent brand page with lead capture", "Monthly market-update reel", "Review requests after each closing"], timeline: "First shoot within 7 days of signing", updated: days(0) },
    { id: "prop-dobrev", ws: "chicagoshots", client: "Halsted Coffee Co.", contact: "Nina Dobrev", pkg: "starter", price: 750, retainer: null, status: "won", pain: "Beautiful shop, invisible online. Menu photos are from 2021.", scope: ["Half-day shoot: space, menu, staff", "12 edited photos + 3 reels", "Google Business refresh"], timeline: "Shoot Monday, deliverables Friday", updated: days(-2) },
  ];

  const reviews = [
    { id: "rev-dobrev", ws: "chicagoshots", client: "Nina Dobrev — Halsted Coffee", status: "draft", channel: "Google", draft: "Nina — it was a blast shooting the shop. If the photos brought the space to life for you, a quick Google review helps other owners find us. Link below, two sentences is plenty.", link: "g.page/r/phantom-demo/review", received: null, quote: null },
    { id: "rev-marcus", ws: "phantomforce", client: "Marcus Reed — Reed Landscaping", status: "received", channel: "Google", draft: "Marcus — glad the new booking flow is saving your evenings. Would you drop a quick review?", link: "g.page/r/phantom-demo/review", received: days(-3), quote: "PhantomForce built our site and now runs our follow-ups. I stopped losing jobs to missed calls. Worth every dollar." },
    { id: "rev-tania", ws: "phantomforce", client: "Tania Flores — Flores Catering", status: "publish-ready", channel: "Website", draft: null, link: null, received: days(-9), quote: "They turned my DMs into an actual pipeline. Booked out six weekends straight after the site went live." },
  ];

  const bookings = [
    { id: "bk-okafor", ws: "test-client", client: "Sam Okafor", type: "Discovery call", when: days(1.2), duration: 30, status: "draft", copy: "Sam — locking a 30-min walkthrough of what the store + booking build would look like for the gym. Does Thursday 2pm work?", location: "Phone" },
    { id: "bk-dobrev", ws: "chicagoshots", client: "Halsted Coffee Co.", type: "Shoot — content sprint", when: days(4.5), duration: 180, status: "approved", copy: "Confirmed: Monday 9am at the shop. We'll cover space, menu, and staff. Please have the seasonal menu items ready by 9:30.", location: "On site — 3312 N Halsted" },
    { id: "bk-chen", ws: "chicagoshots", client: "Chen & Park Realty", type: "Proposal review call", when: days(2.3), duration: 20, status: "draft", copy: "Grace — 20 minutes to walk the listing-video proposal and pick the first property. Thursday or Friday morning?", location: "Zoom" },
  ];

  const media = [
    { id: "med-halsted", ws: "chicagoshots", title: "Halsted Coffee — launch reel", type: "Reel (vertical, 30s)", status: "brief-ready", angle: "Morning ritual: the first pour, steam, regulars arriving. Warm + fast cuts.", shots: ["Espresso pull close-up", "Steam over cup, backlit window", "Barista handoff + smile", "Latte art top-down", "Sign + street at golden hour"], caption: "The best 8am in Lakeview isn't an accident. ☕ #chicagocoffee #lakeview", proof: null, updated: days(0) },
    { id: "med-chen", ws: "chicagoshots", title: "Chen & Park — listing walkthrough template", type: "Video brief (60–90s)", status: "draft", angle: "Cinematic arrival → hero rooms → lifestyle detail → agent close. Repeatable per property.", shots: ["Drone or gimbal approach", "Door open reveal", "Kitchen slider", "Primary suite light pass", "Agent piece-to-camera"], caption: "New on the market in Lincoln Park — walk it in 60 seconds.", proof: null, updated: days(-1) },
    { id: "med-pf", ws: "phantomforce", title: "PhantomForce — 'missed call math' promo", type: "Short (45s)", status: "generation-approved", angle: "One missed call = one lost job. Count the cost on screen, then show Phantom catching it.", shots: ["Phone ringing unanswered (staged)", "Counter: $1,500 gone", "Phantom ticker catching the lead", "Follow-up draft appearing", "Logo sting"], caption: "Your phone is leaking money. We built the thing that catches it.", proof: "phantomcut/queue/pf-promo-004", updated: days(0) },
    { id: "med-test", ws: "test-client", title: "Grand-opening announcement post", type: "Static + caption", status: "delivered", angle: "Clean product hero with launch-week offer.", shots: ["Hero product on brand color", "Offer overlay"], caption: "Doors open Saturday. First 20 customers get the founder's discount.", proof: "delivered/test-client/open-post-final.png", updated: days(-4) },
  ];

  const sites = [
    { id: "site-rivera", ws: "test-client", title: "Rivera Dental — 5-page rebuild", kind: "Website", status: "draft", sections: ["Hero: 'A dentist your kids ask to visit'", "Services grid (6 cards)", "Reviews wall (pulls from Review Desk)", "Insurance + FAQ", "Booking CTA (approval-gated)"], url: null, updated: days(-1) },
    { id: "site-okafor-store", ws: "test-client", title: "Okafor Fitness — merch + classes store", kind: "Store", status: "draft", sections: ["Storefront hero", "Merch grid (products below)", "Class pass cards", "Checkout — payment connector not wired yet"], url: null, updated: days(0) },
    { id: "site-cs", ws: "chicagoshots", title: "ChicagoShots — booking landing page", kind: "Landing page", status: "publish-ready", sections: ["Showreel hero", "3 packages with prices", "Recent work grid", "Booking form (approval-gated)"], url: "chicagoshots.online/book", updated: days(-2) },
  ];

  const products = [
    { id: "prod-tee", ws: "test-client", name: "Okafor Fitness tee", price: 28, category: "Merch", desc: "Heavyweight cotton, gym logo front, 'no shortcuts' back print.", fulfillment: "Print-on-demand partner — not yet connected", checkout: "not-wired", publish: "draft" },
    { id: "prod-pass", ws: "test-client", name: "10-class pass", price: 120, category: "Classes", desc: "Ten group sessions, 90-day window, transferable once.", fulfillment: "Redeemed at front desk", checkout: "not-wired", publish: "draft" },
    { id: "prod-shoot", ws: "chicagoshots", name: "Listing video — single property", price: 450, category: "Service", desc: "Shoot + edit + vertical cut, 72-hour turnaround.", fulfillment: "Scheduled via Booking Coordinator", checkout: "invoice-ready", publish: "publish-ready" },
  ];

  /* PhantomPlay: Phantom's game catalog, platform-wide (not scoped to one
     client workspace — every account sees the same catalog). Kids-tagged
     titles stay out of the default view until the Kids filter is on;
     pending-review submissions stay hidden from non-admin accounts until
     approved. */
  const games = [
    { id: "slither-io", ws: "phantomforce", name: "Slither.io", genre: "Arcade", audience: "general", active: true, plays30d: 812, status: "live" },
    { id: "phantom-rumble", ws: "phantomforce", name: "Phantom Rumble", genre: "Battle Arena", audience: "general", active: true, plays30d: 1204, status: "live" },
    { id: "neon-drift", ws: "phantomforce", name: "Neon Drift", genre: "Arcade Shooter", audience: "general", active: true, plays30d: 956, status: "live" },
    { id: "kingdom-breakers", ws: "phantomforce", name: "Kingdom Breakers", genre: "PvP Siege", audience: "general", active: true, plays30d: 640, status: "live" },
    { id: "phantom-ages", ws: "phantomforce", name: "Phantom Ages", genre: "Strategy", audience: "general", active: true, plays30d: 0, status: "new" },
    { id: "penalty-kick", ws: "phantomforce", name: "Penalty Kick", genre: "Sports", audience: "general", active: false, plays30d: 12, status: "retired" },
    { id: "shape-sorter-jr", ws: "phantomforce", name: "Shape Sorter Jr.", genre: "Puzzle", audience: "kids", active: true, plays30d: 340, status: "live" },
    { id: "counting-critters", ws: "phantomforce", name: "Counting Critters", genre: "Educational", audience: "kids", active: true, plays30d: 285, status: "live" },
  ];

  /* PhantomStore: PhantomForce's own product marketplace — templates,
     account add-ons, PhantomPlay dev boosts. Distinct from the "Site &
     Store Studio" workspace, which builds a CLIENT's own storefront. */
  const storeItems = [
    { id: "store-template-launch", ws: "phantomforce", name: "Launch Page Template Pack", price: 49, category: "Templates", desc: "5 conversion-tested landing page templates, drop-in ready.", status: "live", sales30d: 18 },
    { id: "store-workforce-seat", ws: "phantomforce", name: "Extra Workforce Seat", price: 99, category: "Add-on", desc: "One additional AI desk on your account, billed monthly.", status: "live", sales30d: 6 },
    { id: "store-dev-boost", ws: "phantomforce", name: "PhantomPlay Dev Boost", price: 29, category: "PhantomPlay", desc: "Priority review-queue placement for your submitted game.", status: "live", sales30d: 11 },
    { id: "store-priority-support", ws: "phantomforce", name: "Priority Support", price: 39, category: "Support", desc: "Skip the queue — same-day human response on any ticket.", status: "draft", sales30d: 0 },
  ];

  const security = [
    { id: "sec-pf", ws: "phantomforce", lastScan: days(-11), nextScan: days(19), proofId: "PF-SCAN-2026-06", posture: "clean", findings: [{ level: "ok", text: "No malware or exposed data found across monitored surfaces." }, { level: "warn", text: "2 admin passwords pass 180-day rotation window in 24 days." }, { level: "ok", text: "Domain + DNS posture unchanged since last scan." }], accounts: 6, rotationDue: days(24), phishing: "low", breachCheck: "Runs on password change or reset" },
    { id: "sec-cs", ws: "chicagoshots", lastScan: days(-11), nextScan: days(19), proofId: "CS-SCAN-2026-06", posture: "clean", findings: [{ level: "ok", text: "Brand accounts clean. No credential reuse detected in tracked set." }], accounts: 3, rotationDue: days(51), phishing: "low", breachCheck: "Runs on password change or reset" },
    { id: "sec-test", ws: "test-client", lastScan: days(-6), nextScan: days(24), proofId: "TC-SCAN-2026-06", posture: "attention", findings: [{ level: "warn", text: "Website contact form has no spam protection — recommend adding the shield before launch." }, { level: "ok", text: "No breaches found for tracked business email." }], accounts: 2, rotationDue: days(120), phishing: "medium", breachCheck: "Runs on password change or reset" },
  ];

  const approvals = [
    { id: "app-rev", ws: "phantomforce", type: "publish-review", title: "Publish Tania Flores testimonial to site", detail: "Quote is approved by Tania over text. Publishing adds it to the reviews wall.", ref: "rev-tania", status: "pending", requestedBy: "Review Desk", at: days(-0.2) },
    { id: "app-media", ws: "chicagoshots", type: "media-generation", title: "Run paid generation: Halsted launch reel", detail: "Media Lab wants one generation pass on the launch reel brief. Uses paid credits.", ref: "med-halsted", status: "pending", requestedBy: "Media Factory", at: days(-0.5) },
    { id: "app-send", ws: "test-client", type: "send-message", title: "Send intro + booking link to Marisol Rivera", detail: "Draft is ready in the lead record. Sending marks first touch on a new lead.", ref: "lead-rivera", status: "pending", requestedBy: "Follow-Up Desk", at: days(-0.1) },
    { id: "app-page", ws: "chicagoshots", type: "publish-page", title: "Publish ChicagoShots booking landing page", detail: "Page draft is complete and reviewed. Publishing makes it live at chicagoshots.online/book.", ref: "site-cs", status: "pending", requestedBy: "Site Builder", at: days(-1) },
  ];

  const agents = [
    { id: "ag-router", name: "Command Router", role: "Reads every request and routes it to the right desk.", status: "active", mission: "Standing by for your next command.", d1: 14, d7: 96, d30: 388, tokens: "212k", cost: "$1.84", last: "Routed 'draft proposal for Chen & Park' to Proposal Forge.", next: "—", bundle: "PhantomOps router · model lane A" },
    { id: "ag-leads", name: "Lead Hunter", role: "Watches every channel for new business and qualifies it.", status: "active", mission: "Qualifying Ade Events (event volume, booking flow).", d1: 6, d7: 41, d30: 163, tokens: "301k", cost: "$2.61", last: "Found 2 follow-up opportunities in the missed-lead pile.", next: "Qualify Folake Adeyemi by tomorrow.", bundle: "PhantomOps + intake specs" },
    { id: "ag-forge", name: "Proposal Forge", role: "Turns qualified leads into priced, scoped proposals.", status: "waiting", mission: "Chen & Park proposal is send-ready — waiting on approval.", d1: 3, d7: 12, d30: 47, tokens: "188k", cost: "$1.55", last: "Prepared Pro-tier quote for Chen & Park Realty ($2,500 + Partner retainer).", next: "Nudge Grace Chen Thursday if unopened.", bundle: "Spec templates + pricing ladder" },
    { id: "ag-media", name: "Media Factory", role: "Briefs, shot lists, captions, and controlled generation.", status: "needs-approval", mission: "Halsted launch reel brief ready — generation pass needs sign-off.", d1: 4, d7: 22, d30: 90, tokens: "540k", cost: "$4.92", last: "Halsted Coffee launch-reel brief with 5-shot list.", next: "Generation pass once approved.", bundle: "PhantomCut lane (paid, approval-gated)" },
    { id: "ag-site", name: "Site Builder", role: "Drafts pages, landing pages, and site rebuilds.", status: "active", mission: "Rivera Dental 5-page rebuild in draft.", d1: 5, d7: 18, d30: 71, tokens: "233k", cost: "$2.02", last: "Drafted ChicagoShots booking landing page (publish-ready).", next: "Reviews-wall section for Rivera Dental.", bundle: "Build lane + section library" },
    { id: "ag-store", name: "Store Builder", role: "Catalogs, product cards, and checkout readiness.", status: "active", mission: "Okafor Fitness merch + classes storefront draft.", d1: 2, d7: 9, d30: 25, tokens: "84k", cost: "$0.71", last: "Drafted 2 products for Okafor Fitness store.", next: "Class-pass pricing options for Sam's review.", bundle: "Catalog specs · checkout unwired" },
    { id: "ag-sec", name: "Security Watch", role: "Monthly scans, breach checks, rotation reminders.", status: "idle", mission: "Next monthly scan in 19 days. Watching quietly.", d1: 1, d7: 4, d30: 19, tokens: "44k", cost: "$0.38", last: "Completed monthly scan proof PF-SCAN-2026-06 — clean.", next: "Flag 2 password rotations due in 24 days.", bundle: "Scan cadence + posture checks" },
    { id: "ag-review", name: "Review Desk", role: "Requests, collects, and stages testimonials.", status: "waiting", mission: "Tania Flores quote staged — publish approval pending.", d1: 2, d7: 7, d30: 31, tokens: "58k", cost: "$0.49", last: "Staged Tania Flores testimonial for the site reviews wall.", next: "Draft request for Nina Dobrev after delivery.", bundle: "Request→approve→publish pipeline" },
    { id: "ag-follow", name: "Follow-Up Desk", role: "Nothing goes quiet. Chases every open thread.", status: "active", mission: "2 follow-ups due today (Rivera intro, Brooks second touch).", d1: 7, d7: 38, d30: 149, tokens: "176k", cost: "$1.47", last: "Drafted the 'missed call math' second touch for Brooks Plumbing.", next: "Rivera intro is approval-gated — waiting on you.", bundle: "Cadence engine + drafts" },
    { id: "ag-money", name: "Revenue Tracker", role: "Pipeline, proposals, retainers, and what's unpaid.", status: "active", mission: "Tracking $8,250 open pipeline across 3 workspaces.", d1: 3, d7: 16, d30: 63, tokens: "91k", cost: "$0.76", last: "Flagged Chen & Park as highest-value open proposal.", next: "Retainer upsell note for Halsted after delivery.", bundle: "Ledger view · invoicing unwired" },
    { id: "ag-book", name: "Booking Coordinator", role: "Appointment drafts, confirmations, reschedules.", status: "waiting", mission: "2 booking drafts waiting for approval.", d1: 2, d7: 11, d30: 42, tokens: "63k", cost: "$0.54", last: "Confirmed Halsted shoot — Monday 9am on site.", next: "Okafor discovery call draft awaiting approval.", bundle: "Calendar lane (approval-gated)" },
    { id: "ag-deliver", name: "Delivery Manager", role: "Keeps sold work moving to done.", status: "active", mission: "Halsted content sprint kickoff — shot list Monday.", d1: 4, d7: 15, d30: 58, tokens: "102k", cost: "$0.88", last: "Marked Test Client grand-opening post delivered.", next: "Prep Halsted delivery folder structure.", bundle: "Task + deliverable tracking" },
    { id: "ag-clean", name: "Data Cleaner", role: "Dedupes, tags, and keeps every record tidy.", status: "idle", mission: "Records clean. Next sweep tonight.", d1: 1, d7: 9, d30: 44, tokens: "37k", cost: "$0.31", last: "Merged 2 duplicate lead records (Brooks Plumbing).", next: "Nightly sweep at 2am.", bundle: "Hygiene rules + memory sync" },
  ];

  const activity = [
    { id: uid("act"), ws: "phantomforce", who: "Lead Hunter", text: "found 2 follow-up opportunities in the missed-lead pile.", at: days(-0.05) },
    { id: uid("act"), ws: "chicagoshots", who: "Proposal Forge", text: "prepared the Chen & Park quote — send-ready, waiting on approval.", at: days(-0.1) },
    { id: uid("act"), ws: "phantomforce", who: "Security Watch", text: "completed monthly scan proof PF-SCAN-2026-06 — posture clean.", at: days(-0.3) },
    { id: uid("act"), ws: "chicagoshots", who: "Media Factory", text: "has 1 video brief ready (Halsted launch reel).", at: days(-0.15) },
    { id: uid("act"), ws: "phantomforce", who: "Review Desk", text: "is waiting on 1 approval to publish the Flores testimonial.", at: days(-0.2) },
    { id: uid("act"), ws: "chicagoshots", who: "Site Builder", text: "drafted the booking landing page — publish-ready.", at: days(-0.4) },
    { id: uid("act"), ws: "test-client", who: "Follow-Up Desk", text: "drafted the Rivera intro — send-ready once you approve.", at: days(-0.08) },
    { id: uid("act"), ws: "chicagoshots", who: "Booking Coordinator", text: "confirmed the Halsted shoot for Monday 9am.", at: days(-0.6) },
  ];

  return { version: 4, workspaces, leads, proposals, reviews, bookings, media, sites, products, games, storeItems, security, approvals, agents, activity };
}

/* ---------------- store ---------------- */
function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 4) return d;
    }
  } catch {}
  return seed();
}

const listeners = new Set();
export const store = {
  state: load(),
  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.state)); } catch {}
    listeners.forEach((fn) => fn());
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reset() { try { localStorage.removeItem(DB_KEY); } catch {} this.state = seed(); this.save(); },
};

/* ---------------- session (preview access; production access is enforced
   at the private gateway in front of the app — this never weakens it) ---- */
export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  },
  set(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} },
  clear() { try { localStorage.removeItem(SESSION_KEY); } catch {} },
};

export function resolveSession() {
  const q = new URLSearchParams(location.search);
  const key = (q.get("session") || "").toLowerCase();
  if (key === "owner-admin" || key === "admin" || key === "jordan") {
    const s = { role: "admin", name: "Jordan", ws: "phantomforce" };
    session.set(s); return s;
  }
  if (key === "client" || key === "test-client" || key === "client-test") {
    const s = { role: "client", name: "Test Client", ws: "test-client" };
    session.set(s); return s;
  }
  return session.get();
}

/* ---------------- selectors ---------------- */
export const ctx = { session: null };
export const isAdmin = () => ctx.session?.role === "admin";
export const currentWs = () => ctx.session?.ws || "phantomforce";
export const setWorkspace = (id) => { if (!isAdmin()) return; ctx.session.ws = id; session.set(ctx.session); store.save(); };

/* Admin at HQ sees everything; admin inside a workspace or any client sees
   only that workspace's records. */
export function visible(list) {
  const ws = currentWs();
  if (isAdmin() && ws === "phantomforce") return list;
  return list.filter((r) => r.ws === ws);
}
export const wsName = (id) => store.state.workspaces.find((w) => w.id === id)?.name || id;

export function pushActivity(who, text, ws = currentWs()) {
  store.state.activity.unshift({ id: uid("act"), ws, who, text, at: new Date().toISOString() });
  store.state.activity = store.state.activity.slice(0, 60);
}

/* ---------------- derived: money ---------------- */
export function moneyView() {
  const props = visible(store.state.proposals);
  const open = props.filter((p) => ["draft", "sent-ready", "sent"].includes(p.status));
  const won = props.filter((p) => p.status === "won");
  const lost = props.filter((p) => p.status === "lost");
  const pipeline = open.reduce((s, p) => s + p.price, 0);
  const wonValue = won.reduce((s, p) => s + p.price, 0);
  const retainerMonthly = props.filter((p) => p.retainer && p.status !== "lost")
    .reduce((s, p) => s + (RETAINERS.find((r) => r.id === p.retainer)?.price || 0), 0);
  return { open, won, lost, pipeline, wonValue, retainerMonthly };
}

/* ---------------- derived: today's plan ---------------- */
export function todaysPlan() {
  const items = [];
  visible(store.state.approvals).filter((a) => a.status === "pending")
    .forEach((a) => items.push({ icon: "◈", text: a.title, kind: "approval", open: "approvals" }));
  visible(store.state.leads).filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0)
    .forEach((l) => items.push({ icon: "▸", text: `${l.next} — ${l.name}`, kind: "lead", open: "leads" }));
  visible(store.state.proposals).filter((p) => p.status === "sent-ready")
    .forEach((p) => items.push({ icon: "▸", text: `Proposal send-ready: ${p.client}`, kind: "proposal", open: "proposals" }));
  visible(store.state.media).filter((m) => m.status === "brief-ready")
    .forEach((m) => items.push({ icon: "▸", text: `Media brief ready: ${m.title}`, kind: "media", open: "media" }));
  visible(store.state.security).forEach((s) => {
    if (daysUntil(s.rotationDue) <= 30) items.push({ icon: "⚠", text: `Password rotation window closes in ${daysUntil(s.rotationDue)} days`, kind: "security", open: "protect" });
  });
  return items.slice(0, 7);
}

/* ---------------- approvals ---------------- */
export function resolveApproval(id, approved) {
  const a = store.state.approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return;
  a.status = approved ? "approved" : "declined";
  a.resolvedAt = new Date().toISOString();
  if (approved) {
    if (a.type === "publish-review") { const r = store.state.reviews.find((x) => x.id === a.ref); if (r) r.status = "published-ready"; }
    if (a.type === "send-message") { const l = store.state.leads.find((x) => x.id === a.ref); if (l) { l.status = "follow-up"; l.next = "Message approved — send-ready in your outbox"; } }
    if (a.type === "publish-page") { const s = store.state.sites.find((x) => x.id === a.ref); if (s) s.status = "approved-to-publish"; }
    if (a.type === "media-generation") { const m = store.state.media.find((x) => x.id === a.ref); if (m) m.status = "generation-approved"; }
    if (a.type === "booking") { const b = store.state.bookings.find((x) => x.id === a.ref); if (b) b.status = "approved"; }
  }
  pushActivity("Command Router", `${approved ? "approved" : "declined"}: ${a.title}`, a.ws);
  store.save();
}

export const STATUS_LABEL = {
  "new": "New", "follow-up": "Follow-up", "proposal": "Proposal out", "won": "Won", "lost": "Lost",
  "draft": "Draft", "sent-ready": "Send-ready", "sent": "Sent", "approved": "Approved",
  "brief-ready": "Brief ready", "generation-approved": "Generation approved", "delivered": "Delivered",
  "publish-ready": "Publish-ready", "approved-to-publish": "Approved to publish", "published-ready": "Published-ready",
  "received": "Received", "pending": "Pending", "declined": "Declined", "not-wired": "Not wired", "invoice-ready": "Invoice-ready",
  "live": "Live", "pending-review": "Pending review", "retired": "Retired",
};
export const statusLabel = (s) => STATUS_LABEL[s] || s;
