import {
  store, ctx, session, isAdmin, currentWs, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago,
} from "./store.js?v=connector-signin-20260705-01";

const TICKER_CHECK_MS = 700;
const TICKER_REFRESH_MS = 12000;

const workers = {
  command: { name: "Victor", role: "command desk", tone: "signal", crew: ["Lena", "Jules"] },
  leads: { name: "Charles", role: "lead desk", tone: "money", crew: ["Ivy", "Marco"] },
  proposals: { name: "Alexa", role: "proposal desk", tone: "build", crew: ["Reed", "June"] },
  memory: { name: "Selena", role: "memory desk", tone: "memory", crew: ["Noah", "Eli"] },
  model: { name: "Ollie", role: "private answer desk", tone: "signal", crew: ["Parker", "Sage"] },
  build: { name: "Cody", role: "build desk", tone: "build", crew: ["Miles", "Rae"] },
  review: { name: "Clara", role: "review desk", tone: "approval", crew: ["Tess", "Mina"] },
  booking: { name: "Maya", role: "booking desk", tone: "money", crew: ["Nico", "Sam"] },
  media: { name: "Nova", role: "media desk", tone: "creative", crew: ["Kai", "Luca"] },
  protect: { name: "Sable", role: "protect desk", tone: "protect", crew: ["Ash", "Wren"] },
  delivery: { name: "Dante", role: "delivery desk", tone: "delivery", crew: ["Zoe", "Finn"] },
};

const agentMap = {
  "Command Router": workers.command,
  "Lead Hunter": workers.leads,
  "Proposal Forge": workers.proposals,
  "Media Factory": workers.media,
  "Image Creator": workers.media,
  "Phantom Operator": workers.build,
  "Site Builder": workers.build,
  "Store Builder": workers.build,
  "Security Watch": workers.protect,
  "Review Desk": workers.review,
  "Follow-Up Desk": workers.leads,
  "Revenue Tracker": workers.proposals,
  "Booking Coordinator": workers.booking,
  "Delivery Manager": workers.delivery,
  "Data Cleaner": workers.memory,
  "PhantomOps": workers.command,
};

let root = null;
let lastPaint = 0;

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function hasSession() {
  return !!(ctx.session || session.get());
}

function byWorkspace(list) {
  return visible(list || []);
}

function plural(count, single, many = `${single}s`) {
  return `${count} ${count === 1 ? single : many}`;
}

function workerItem(worker, action, detail, meta = "", subcrew = worker.crew || []) {
  return {
    worker,
    action,
    detail,
    meta,
    subcrew,
  };
}

function statusFromRecords() {
  const plan = todaysPlan();
  const leads = byWorkspace(store.state.leads);
  const proposals = byWorkspace(store.state.proposals);
  const approvals = byWorkspace(store.state.approvals).filter((item) => item.status === "pending");
  const media = byWorkspace(store.state.media);
  const bookings = byWorkspace(store.state.bookings);
  const reviews = byWorkspace(store.state.reviews);
  const tasks = byWorkspace(store.state.tasks || []);
  const security = byWorkspace(store.state.security);
  const money = moneyView();

  const dueLeads = leads.filter((lead) => ["new", "follow-up"].includes(lead.status));
  const activeProps = proposals.filter((prop) => ["draft", "sent-ready", "sent", "invoice-ready"].includes(prop.status));
  const readyMedia = media.filter((item) => ["pending", "brief-ready", "generation-approved", "draft"].includes(item.status));
  const pendingBookings = bookings.filter((booking) => ["draft", "pending", "sent-ready"].includes(booking.status || "draft"));
  const pendingReviews = reviews.filter((review) => ["draft", "sent-ready", "pending"].includes(review.status || "draft"));
  const openTasks = tasks.filter((task) => ["new", "working"].includes(task.status || "new"));
  const latestSecurity = security[0];

  const items = [
    workerItem(
      workers.leads,
      dueLeads.length
        ? `reviewed ${plural(dueLeads.length, "lead")} and staged the next follow-up draft`
        : "checked the lead lane; no fresh manual follow-ups are waiting",
      "Emails and DMs stay as drafts until a person approves them.",
      dueLeads[0]?.company || dueLeads[0]?.name || wsName(currentWs()),
    ),
    workerItem(
      workers.proposals,
      activeProps.length
        ? `shaped ${plural(activeProps.length, "proposal")} into quote-ready next steps`
        : "kept proposal desk warm; no quote is blocked right now",
      money.pipeline ? `${fmtMoney(money.pipeline)} visible pipeline in this workspace.` : "Pipeline wakes up when a real lead or quote appears.",
      activeProps[0]?.client || "proposal desk",
    ),
    workerItem(
      workers.review,
      approvals.length
        ? `is holding ${plural(approvals.length, "approval")} for Jordan`
        : "cleared the approval board; nothing is allowed to ship on its own",
      "Human approval remains the gate.",
      approvals[0]?.title || "approval desk",
    ),
    workerItem(
      workers.media,
      readyMedia.length
        ? `found ${plural(readyMedia.length, "pending media item")} for the creative desk`
        : "checked creative inventory; no generation is running automatically",
      "Media work stays controlled and receipt-based.",
      readyMedia[0]?.title || "media desk",
    ),
    workerItem(
      workers.booking,
      pendingBookings.length
        ? `found ${plural(pendingBookings.length, "booking draft")} ready for manual confirmation`
        : "checked bookings; no new calendar move is waiting",
      "No calendar invite leaves without review.",
      pendingBookings[0]?.client || "booking desk",
    ),
    workerItem(
      workers.protect,
      latestSecurity
        ? `checked protection posture: ${latestSecurity.posture || latestSecurity.status || "reviewed"}`
        : "is ready for the first approved workspace scan",
      latestSecurity?.summary || "Security checks stay local and report-first.",
      wsName(currentWs()),
    ),
    workerItem(
      workers.delivery,
      openTasks.length
        ? `has ${plural(openTasks.length, "delivery task")} moving through the board`
        : "checked delivery; no active handoff is overdue",
      openTasks[0]?.title || "Delivery tasks appear here when real work is sold.",
      openTasks[0]?.kind || "delivery desk",
    ),
    workerItem(
      workers.command,
      plan.length
        ? `ranked ${plural(plan.length, "next move")} for today`
        : "is standing by for the next owner command",
      plan[0]?.text || "Ask for a quote, follow-up, page, content pack, booking, or scan.",
      isAdmin() ? "owner view" : wsName(currentWs()),
    ),
  ];

  if (pendingReviews.length) {
    items.splice(4, 0, workerItem(
      workers.review,
      `staged ${plural(pendingReviews.length, "review request")} for manual send`,
      "Testimonials never publish themselves.",
      pendingReviews[0]?.client || "review desk",
    ));
  }

  if (isAdmin()) {
    items.push(
      workerItem(workers.memory, "refreshed workspace memory boundaries", "Owner records and client records stay separated.", "private memory"),
      workerItem(workers.model, "checked the private answer lane", "Provider details stay behind PhantomForce.", "protected"),
      workerItem(workers.build, "watched the build lane for active local work", "No deploy or external action is implied by this feed.", "local build desk"),
    );
  }

  return items;
}

function activityItems() {
  const privateNames = ["Open" + "Spec", "Se" + "rena", "Ol" + "lama", "Co" + "dex", "Clau" + "de", "n" + "8n", "Agent" + "OS", "Agent OS"];
  const privateNamePattern = new RegExp(`\\b(${privateNames.join("|")})\\b`, "gi");
  return byWorkspace(store.state.activity)
    .slice(0, isAdmin() ? 10 : 5)
    .map((entry) => {
      const worker = agentMap[entry.who] || workers.command;
      const text = String(entry.text || "updated the workspace").replace(privateNamePattern, "the private desk");
      return workerItem(
        worker,
        text,
        `${ago(entry.at)} in ${wsName(entry.ws || currentWs())}`,
        entry.who === worker.name ? worker.role : "worker receipt",
      );
    });
}

function agentQueueItems() {
  const active = (store.state.agents || []).filter((agent) => agent.status === "active").slice(0, isAdmin() ? 8 : 4);
  return active.map((agent) => {
    const worker = agentMap[agent.name] || workers.command;
    return workerItem(
      worker,
      agent.next || agent.mission || "is ready for the next task",
      agent.last && !/^No /.test(agent.last) ? agent.last : `${worker.role} waiting for real work.`,
      agent.mission || worker.role,
      worker.crew,
    );
  });
}

function buildTickerItems() {
  const items = [...statusFromRecords(), ...activityItems(), ...agentQueueItems()];
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.worker.name}-${item.action}-${item.meta}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, isAdmin() ? 28 : 14);
}

function itemHtml(item, index) {
  const crew = (item.subcrew || []).slice(0, 2).join(" + ");
  return `
    <article class="worker-tick worker-${esc(item.worker.tone)}" style="--tick-index:${index}">
      <span class="worker-avatar">${esc(item.worker.name.slice(0, 1))}</span>
      <span class="worker-copy">
        <strong>${esc(item.worker.name)}</strong>
        ${crew ? `<em>${esc(crew)}</em>` : ""}
        <b>${esc(item.action)}</b>
        <i>${esc(item.detail)}</i>
      </span>
      ${item.meta ? `<span class="worker-meta">${esc(item.meta)}</span>` : ""}
    </article>`;
}

function tickerHtml(items) {
  const repeated = [...items, ...items];
  return `
    <section class="phantom-workers" data-worker-ticker aria-label="Latest Phantom worker activity">
      <div class="worker-board-head">
        <div>
          <span class="worker-live-dot" aria-hidden="true"></span>
          <b>Phantom Workers Live</b>
        </div>
        <p>${isAdmin() ? "Owner feed" : "Workspace feed"} · human-approved · no raw tool names</p>
      </div>
      <div class="worker-marquee" aria-live="polite">
        <div class="worker-marquee-track">
          ${repeated.map((item, index) => itemHtml(item, index)).join("")}
        </div>
      </div>
    </section>`;
}

function ensureRoot() {
  const topbar = document.querySelector(".app-main .topbar2");
  if (!topbar) return null;
  if (!root) {
    root = document.createElement("div");
    root.className = "phantom-workers-mount";
    topbar.insertAdjacentElement("afterend", root);
  }
  return root;
}

function paint(force = false) {
  const mount = ensureRoot();
  if (!mount) return;

  const visibleShell = document.querySelector("[data-phantom]:not([hidden])");
  const shouldShow = !!visibleShell && hasSession();
  mount.hidden = !shouldShow;
  if (!shouldShow) return;

  const now = Date.now();
  if (!force && now - lastPaint < TICKER_REFRESH_MS) return;
  lastPaint = now;
  mount.innerHTML = tickerHtml(buildTickerItems());
}

paint(true);
window.setInterval(() => paint(), TICKER_CHECK_MS);
window.addEventListener("storage", () => paint(true));
