/* PhantomForce Phantom — the Phantom AI command engine.
   Everything router: classify each prompt, then answer, route, draft, create,
   automate, recall memory, or hand off. Local mode never sends, uploads,
   charges, or deploys. */

import {
  store, uid, visible, currentWs, isAdmin, pushActivity, moneyView, todaysPlan,
  PACKAGES, RETAINERS, fmtMoney, statusLabel, daysUntil, memoryStats,
  ctx, session,
} from "./store.js?v=phantom-live-20260707-44";
import { classifyPhantomIntent } from "./intent-router.js?v=phantom-live-20260707-44";

const DAY = 86400000;
const days = (n) => new Date(Date.now() + n * DAY).toISOString();
const AI_SETTINGS_KEY = "pf.operator.settings.v1";
const SAFE_BACKEND_INTENTS = new Set(["identity", "capability", "question", "brainstorm", "plan", "chat"]);

/* Pull a subject out of phrases like "draft a proposal for Sarah's gym". */
function subjectOf(text) {
  const m = text.match(/\b(?:for|to|about|called|named)\s+(.{2,60})$/i);
  if (!m) return null;
  return m[1].replace(/[.?!]\s*$/, "").replace(/^(the|a|an)\s+/i, "").trim();
}
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function card(kicker, name, body, actions = [], meta = "") {
  return { kicker, title: name, body, actions, meta };
}
const openAction = (label, ws) => ({ label, open: ws });

function loadRuntimeAiSettings() {
  const defaults = {
    provider: "claude",
    brainMode: "local",
    responseStyle: "operator",
    responseLength: "balanced",
    memoryMode: "business",
    contextDepth: "standard",
    externalActionMode: "approval",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || "{}");
    const brainMode = ["local", "api", "subscription"].includes(saved.brainMode) ? saved.brainMode : defaults.brainMode;
    return { ...defaults, ...saved, brainMode };
  } catch {
    return defaults;
  }
}

function modelLaneForSettings(settings) {
  if (settings.provider === "openrouter") return "glm_5_2";
  if (settings.provider === "local") return "glm_5_2";
  if (settings.provider === "claude") return "claude_cli";
  return "codex";
}

function backendLabel(settings) {
  if (settings.brainMode === "api") return "Hermes/API";
  if (settings.brainMode === "subscription") return "Subscription brain";
  return "Local brain";
}

function canAskHermes(intent, settings) {
  return isAdmin()
    && settings.brainMode !== "local"
    && SAFE_BACKEND_INTENTS.has(intent.primaryIntent)
    && !intent.shouldCreateTask
    && !intent.shouldCreateAutomation
    && !intent.shouldStartLooper;
}

async function askHermesBrain(raw, intent, settings) {
  if (typeof fetch !== "function" || typeof AbortController === "undefined") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  const token = typeof session?.token === "function" ? session.token() : "";
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch("/phantom-ai/chat", {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message: raw,
        user_request: raw,
        provider: settings.provider === "openrouter" ? "openrouter_glm" : "phantom",
        admin_model: modelLaneForSettings(settings),
        model_lane: modelLaneForSettings(settings),
        execution_mode: settings.externalActionMode === "owner_rules" ? "auto" : "approval",
        task_type: intent.primaryIntent,
        business_name: "PhantomForce",
        actor_user_id: ctx.session?.sessionId || ctx.session?.name || "owner-admin",
        business_summary: "PhantomForce admin console. AI-assisted operations, media, leads, booking, content, quotes, follow-up, client dashboards, approval gates, and local owner memory.",
        module_data: {
          workspace: currentWs(),
          memory: memoryStats(),
          money: moneyView(),
          today: todaysPlan().slice(0, 5),
          runtime_settings: {
            brain_mode: settings.brainMode,
            response_style: settings.responseStyle,
            response_length: settings.responseLength,
            memory_mode: settings.memoryMode,
            context_depth: settings.contextDepth,
          },
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.message?.content) return null;
    const say = String(payload.message.content || "").replace(/\s+\n/g, "\n").trim();
    if (!say) return null;
    return {
      say,
      cards: [
        card(
          "Brain route",
          `${backendLabel(settings)} answered`,
          `Hermes context ${payload.hermes?.context_used ? "was used" : "was not used"}; no sends, uploads, charges, deploys, or approvals were executed.`,
          [openAction("Open Memory", "memory"), openAction("Open Settings", "settings")],
          payload.live_provider_called ? "Live provider called" : "No live provider call reported",
        ),
      ],
      open: null,
      intent,
      hermes: payload.hermes || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------- artifact builders ---------------- */
function createLead(subject) {
  const name = subject ? title(subject) : "New lead";
  const lead = {
    id: uid("lead"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    name, company: name, source: "Phantom AI command", status: "new", value: 750,
    next: "Qualify: what do they need, by when, and what's it worth?",
    due: days(1), owner: "Lead Hunter", notes: "Captured from a command. Add details, then convert to a proposal.", proposalId: null,
  };
  store.state.leads.unshift(lead);
  pushActivity("Lead Hunter", `captured a new lead: ${name}.`, lead.ws);
  store.save();
  return lead;
}

function createProposal(subject) {
  const client = subject ? title(subject) : "New client";
  const pkg = PACKAGES[1];
  const p = {
    id: uid("prop"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    client, contact: client, pkg: pkg.id, price: pkg.price, retainer: "keeper", status: "draft",
    pain: "Describe the pain in one sentence — the proposal leads with it.",
    scope: ["Site or page build scoped to the outcome", "Lead capture wired to Follow-Up Desk", "Review engine setup", "30-day post-launch watch"],
    timeline: "2 weeks build, launch week 3", updated: new Date().toISOString(),
  };
  store.state.proposals.unshift(p);
  pushActivity("Proposal Forge", `opened a ${pkg.name} draft for ${client}.`, p.ws);
  store.save();
  return p;
}

function createMediaBrief(subject) {
  const t = subject ? title(subject) : "New creative";
  const m = {
    id: uid("med"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    title: `${t} — video request`, type: "Reel (vertical, 30s)", status: "draft",
    angle: "Hook in 2 seconds, one idea, end on the offer.",
    shots: ["Opening hook shot", "Detail pass", "People / reaction", "Offer card", "Logo sting"],
    caption: `${t} — draft caption. Punch it up before approval.`, proof: null, updated: new Date().toISOString(),
  };
  store.state.media.unshift(m);
  pushActivity("Media Factory", `created a video request: ${m.title}.`, m.ws);
  store.save();
  return m;
}

function createPageDraft(subject, kind) {
  const t = subject ? title(subject) : "New build";
  const s = {
    id: uid("site"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    title: `${t} — ${kind.toLowerCase()}`, kind, status: "draft",
    sections: kind === "Store"
      ? ["Storefront hero", "Product grid", "Offer section", "Checkout — payment connector not wired yet"]
      : ["Hero with one clear promise", "Proof / reviews section", "Offer + pricing", "Call-to-action (approval-gated)"],
    url: null, updated: new Date().toISOString(),
  };
  store.state.sites.unshift(s);
  pushActivity("Site Builder", `drafted ${s.title}.`, s.ws);
  store.save();
  return s;
}

function createReviewRequest(subject) {
  const client = subject ? title(subject) : "Recent client";
  const r = {
    id: uid("rev"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    client, status: "draft", channel: "Google",
    draft: `${client.split(" ")[0]} — loved working on this with you. If it moved the needle, a short review helps the next owner find us. Two sentences is plenty — link below.`,
    link: "review-link-ready", received: null, quote: null,
  };
  store.state.reviews.unshift(r);
  pushActivity("Review Desk", `drafted a review request for ${client}.`, r.ws);
  store.save();
  return r;
}

function createBooking(subject) {
  const client = subject ? title(subject) : "New appointment";
  const b = {
    id: uid("bk"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    client, type: "Discovery call", when: days(2), duration: 30, status: "draft",
    copy: `${client.split(" ")[0]} — grabbing 30 minutes to walk through what this would look like. What works this week?`,
    location: "Phone",
  };
  store.state.bookings.unshift(b);
  pushActivity("Booking Coordinator", `drafted an appointment with ${client}.`, b.ws);
  store.save();
  return b;
}

function createTaskDraft(draft) {
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const t = {
    id: uid("task"), ws,
    title: draft?.title || "New task",
    detail: draft?.detail || draft?.title || "Created from Phantom chat.",
    status: "new",
    priority: /high priority|urgent|asap/i.test(draft?.detail || "") ? "high" : "normal",
    source: "Phantom AI command",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.tasks = Array.isArray(store.state.tasks) ? store.state.tasks : [];
  store.state.tasks.unshift(t);
  pushActivity("Task Router", `created task "${t.title}".`, ws);
  store.save();
  return t;
}

function createAutomation(subject, raw) {
  const clean = (subject || raw || "New automation")
    .replace(/\b(create|make|build|draft|set up|setup|add|an?|the|automation|workflow|for|to)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = clean ? title(clean).slice(0, 72) : "New automation";
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const a = {
    id: uid("agt"), ws, kind: "automation", source: "Phantom dashboard",
    name, mission: raw, status: "idle",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  store.state.agents.unshift(a);
  store.state.approvals.unshift({
    id: uid("app"), ws, type: "automation",
    title: `Enable automation: ${name}`, detail: raw,
    ref: a.id, status: "pending", requestedBy: "Phantom AI", at: new Date().toISOString(),
  });
  pushActivity("Automation", `drafted automation "${name}" — waiting on approval.`, ws);
  store.save();
  return a;
}

function looperPlan(draft) {
  const steps = [
    "Clarify the goal and audience.",
    "Draft the structure, copy, and required inputs.",
    "Review risk: publish/send/deploy/payment stays blocked.",
    "Prepare the approval packet.",
  ];
  return {
    title: draft?.output ? title(draft.output) : "Build Plan",
    goal: draft?.goal || "New build request",
    steps,
  };
}

function createLooperBuildPacket(plan, draft) {
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const packet = {
    id: uid("loop"),
    ws,
    title: plan.title || "Build Plan",
    goal: plan.goal,
    output: draft?.output || "build plan",
    status: "draft",
    risk: "approval-gated",
    steps: plan.steps,
    safeguards: [
      "No publish, deploy, send, charge, account connection, or production write.",
      "Owner reviews the packet before any outside-world action.",
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.looperPlans = Array.isArray(store.state.looperPlans) ? store.state.looperPlans : [];
  store.state.looperPlans.unshift(packet);
  pushActivity("Phantom Loop", `drafted build packet "${packet.title}".`, ws);
  store.save();
  return packet;
}

function intentResponse(intent, text) {
  if (intent.primaryIntent === "greeting") {
    return {
      say: isAdmin()
        ? "Ready, Jordan. Give me a command, question, file/context, or objective."
        : "Ready. Ask for status, approvals, deliverables, or the next action.",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "gratitude") {
    return {
      say: "Standing by.",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "identity") {
    return {
      say: "I’m the PhantomForce admin brain: operator router, memory layer, draft engine, and approval gate. I classify the request, then route it to the right lane.",
      cards: [card("Identity", "Phantom admin brain", "Local mode answers instantly. Hermes/API and subscription modes can add backend reasoning and memory context when enabled in Settings.", [openAction("Open Settings", "settings"), openAction("Open Memory", "memory")])],
      open: null,
    };
  }
  if (intent.primaryIntent === "capability") {
    return {
      say: "I can answer, route, draft, create, track, summarize, recall memory, prep approvals, build guarded Phantom Loop packets, and hand work to the right admin lane. External sends and live actions still need approval.",
      cards: [
        card("Core modes", "Everything router", "Questions get answers. Commands create or route work. Explicit create/draft/build/schedule/track verbs make records.", [openAction("Open Settings", "settings")]),
        card("Memory", "Business context", "Local memory is active. Hermes/API or subscription backend can add deeper context when enabled.", [openAction("Open Memory", "memory")]),
      ],
      open: null,
    };
  }
  if (intent.primaryIntent === "question") {
    return {
      say: "Question received. I won’t create records from a question alone. Add an action verb if you want it drafted, tracked, assigned, scheduled, or built.",
      cards: [card("No record created", "Question route", "This stayed in the answer/reasoning lane because it was phrased as a question.", [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "brainstorm") {
    return {
      say: "That sounds like a direction, not a task yet. I can brainstorm it, turn it into a plan, or create a task if you tell me which path you want.",
      cards: [card("Idea captured safely", "No task created", "Say 'make this a task', 'make me a plan', or 'start Phantom Loop' when you want it converted.", [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "feedback") {
    return {
      say: "Heard. I’m treating that as feedback, not a task. If you want it tracked, say 'create a task to fix this' and I’ll put it on the list.",
      cards: [card("Feedback", "No task created", text, [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "plan") {
    return {
      say: "I’ll keep this as a plan, not a task list. Here’s the clean path: define the outcome, choose the owner, break it into approval-safe steps, then decide what should become tasks.",
      cards: [card("Plan mode", "Draft plan only", "No tasks were created. Ask 'create tasks from this plan' when you want records added.", [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "task_candidate") {
    return {
      say: "That sounds task-worthy, but I won’t create it from wording alone. Say 'create a task for this' if you want it tracked.",
      cards: [card("Task candidate", intent.taskDraft?.title || "Possible task", "Needs explicit confirmation before it becomes a task.", [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "automation_candidate") {
    return {
      say: "That sounds like an automation idea. I won’t create it until you explicitly ask me to set it up.",
      cards: [card("Automation candidate", intent.automationDraft?.title || "Possible automation", "Say 'create this automation' when you want it drafted for approval.", [openAction("Open Automation", "automation")])],
      open: null,
    };
  }
  if (intent.primaryIntent === "create_task") {
    const t = createTaskDraft(intent.taskDraft);
    return {
      say: `Task created: "${t.title}". It is local and ready for owner review.`,
      cards: [card("Task", t.title, t.detail, [openAction("Open Workers", "workforce")], `Priority: ${t.priority}`)],
      open: null,
    };
  }
  if (intent.primaryIntent === "create_automation" || intent.primaryIntent === "reminder") {
    if (intent.shouldAskClarifyingQuestion) {
      return {
        say: "I can make that an automation, but I need the cadence or time first. Tell me when it should run.",
        cards: [card("Automation needs timing", intent.automationDraft?.title || "Automation draft", "Example: daily at 9am, every Friday, or tomorrow morning.", [])],
        open: null,
      };
    }
    const a = createAutomation(intent.automationDraft?.title || null, text);
    return {
      say: `Automation drafted: "${a.name}". It is waiting for approval before anything runs.`,
      cards: [card("Automation draft", a.name, a.mission, [openAction("Review approval", "approvals"), openAction("Open Automation", "automation")], "Approval required")],
      open: "automation",
    };
  }
  if (intent.primaryIntent === "looper_build") {
    if (!isAdmin()) {
      return {
        say: "Phantom Loop is an Elite feature. Ask the workspace owner to enable Elite access before starting a loop.",
        cards: [card("Elite feature", "Phantom Loop", "Loop mode creates guarded build packets from bigger goals. It stays locked unless this workspace has Elite/admin access.", [openAction("Open Account", "account")], "Elite only")],
        open: null,
      };
    }
    const plan = looperPlan(intent.looperDraft);
    const packet = createLooperBuildPacket(plan, intent.looperDraft);
    return {
      say: `Phantom Loop drafted a guarded build packet for "${plan.goal}". I’ll keep it in review mode until approval.`,
      cards: [card("Phantom Loop packet", packet.title, plan.steps.join(" "), [openAction("Open Site Creator", "sites")], "Elite guarded mode")],
      open: null,
    };
  }
  return null;
}

/* ---------------- the router ---------------- */
export function handleCommand(raw) {
  const text = (raw || "").trim();
  const s = text.toLowerCase();
  const subject = subjectOf(text);
  const admin = isAdmin();
  const intent = classifyPhantomIntent(text);
  const guarded = intentResponse(intent, text);
  if (guarded) return { ...guarded, intent };

  /* --- money / pipeline --- */
  if (/pipeline|revenue|money|how much.*(made|worth|owed)|unpaid|invoice|cash/.test(s)) {
    const m = moneyView();
    return {
      say: `Pipeline is ${fmtMoney(m.pipeline)} open across ${m.open.length} proposal${m.open.length === 1 ? "" : "s"}, ${fmtMoney(m.wonValue)} won, and ${fmtMoney(m.retainerMonthly)}/mo in retainers attached.`,
      cards: [card("Money", "Pipeline snapshot",
        `${m.open.length} open · ${m.won.length} won · ${m.lost.length} lost. Highest-value open: ${m.open[0] ? `${m.open[0].client} (${fmtMoney(m.open[0].price)})` : "none"}.`,
        [openAction("Open Money", "money"), openAction("Open proposals", "proposals")])],
      open: null,
    };
  }

  /* --- proposals / quotes --- */
  if (/(proposal|quote|pricing|estimate)/.test(s)) {
    if (/(draft|build|create|make|write|new|prepare|prep)/.test(s)) {
      const p = createProposal(subject);
      return {
        say: `Proposal Forge opened a ${PACKAGES.find((x) => x.id === p.pkg).name} draft for ${p.client}. It's in the pipeline as a draft — shape the scope, then move it to send-ready.`,
        cards: [card("Proposal draft", p.client, `${fmtMoney(p.price)} · ${p.timeline}. Starter scope uses the standard Core build — edit inside the workspace.`,
          [openAction("Open in Proposal Forge", "proposals")], `Status: ${statusLabel(p.status)}`)],
        open: "proposals",
      };
    }
    return { say: "Proposal Forge is open — every quote, its status, and what it's waiting on.", cards: [], open: "proposals" };
  }

  /* --- leads / follow-up / CRM --- */
  if (/(lead|prospect|inquir|crm|follow.?up|chase)/.test(s)) {
    if (/(add|new|create|capture|save|log)/.test(s)) {
      const l = createLead(subject);
      return {
        say: `Captured. ${l.name} is in the pipeline as a new lead with Lead Hunter on qualification.`,
        cards: [card("New lead", l.name, l.next, [openAction("Open in Leads", "leads")], "Source: Phantom AI command")],
        open: "leads",
      };
    }
    const due = visible(store.state.leads).filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
    return {
      say: due.length
        ? `${due.length} lead${due.length === 1 ? " needs" : "s need"} a touch today. Opening the pipeline.`
        : "Pipeline is current — nothing overdue. Opening Leads.",
      cards: due.slice(0, 3).map((l) => card("Follow-up due", l.name, l.next, [openAction("Handle in Leads", "leads")], l.company)),
      open: "leads",
    };
  }

  /* --- media / content / video --- */
  if (/(video|reel|content|post|caption|shoot|media|creative|tiktok|short)/.test(s)) {
    if (/(brief|plan|draft|create|make|new|idea)/.test(s) || subject) {
      const m = createMediaBrief(subject);
      return {
        say: `Media Factory created "${m.title}" — angle, five-shot list, and a starter caption. Generation stays approval-gated.`,
        cards: [card("Video request", m.title, m.angle, [openAction("Open in Media Lab", "media")], m.type)],
        open: "media",
      };
    }
    return { say: "Media Lab is open — video requests, shot lists, and what's ready to produce.", cards: [], open: "media" };
  }

  /* --- store --- */
  if (/(store|shop|product|catalog|merch|sell|checkout)/.test(s)) {
    if (/(build|create|draft|make|new|add)/.test(s)) {
      const d = createPageDraft(subject, "Store");
      return {
        say: `Store Builder drafted "${d.title}" — storefront, product grid, and offer sections scaffolded. Checkout shows as not wired until a payment connector exists.`,
        cards: [card("Store draft", d.title, d.sections.join(" · "), [openAction("Open in Site & Store Studio", "sites")])],
        open: "sites",
      };
    }
    return { say: "Site & Store Studio is open — drafts, products, and publish readiness.", cards: [], open: "sites" };
  }

  /* --- site / page --- */
  if (/(website|web ?page|landing|site|page)/.test(s)) {
    if (/(build|create|draft|make|new)/.test(s)) {
      const d = createPageDraft(subject, /landing/.test(s) ? "Landing page" : "Website");
      return {
        say: `Site Builder drafted "${d.title}". Publishing stays approval-gated.`,
        cards: [card("Page draft", d.title, d.sections.join(" · "), [openAction("Open in Site & Store Studio", "sites")])],
        open: "sites",
      };
    }
    return { say: "Site & Store Studio is open.", cards: [], open: "sites" };
  }

  /* --- security --- */
  if (/(security|scan|breach|malware|phish|password|protect|hack|threat)/.test(s)) {
    const sec = visible(store.state.security)[0];
    return {
      say: sec
        ? `Protection posture: ${sec.posture === "clean" ? "clean" : "needs attention"}. Last scan proof ${sec.proofId}, next scan in ${daysUntil(sec.nextScan)} days.`
        : "Opening Protect.",
      cards: sec ? [card("Security check", `Scan proof ${sec.proofId}`,
        sec.findings.map((f) => f.text).join(" "), [openAction("Open Protect", "protect")],
        `Next scan: ${daysUntil(sec.nextScan)} days`)] : [],
      open: "protect",
    };
  }

  /* --- reviews --- */
  if (/(review|testimonial|stars|reputation)/.test(s)) {
    if (/(request|ask|draft|prepare|get|new)/.test(s)) {
      const r = createReviewRequest(subject);
      return {
        say: `Review Desk drafted the request for ${r.client}. It sits in the queue until you approve it to go out.`,
        cards: [card("Review request", r.client, r.draft, [openAction("Open Review Desk", "reviews")], "Status: Draft")],
        open: "reviews",
      };
    }
    return { say: "Review Desk is open — requests, received quotes, and the publish queue.", cards: [], open: "reviews" };
  }

  /* --- bookings --- */
  if (/(book|appointment|schedule|calendar|meeting|call with)/.test(s)) {
    if (/(book|new|create|draft|set ?up|schedule)/.test(s)) {
      const b = createBooking(subject);
      return {
        say: `Booking Coordinator drafted the appointment with ${b.client}. Nothing lands on a calendar until you approve it.`,
        cards: [card("Booking draft", `${b.type} — ${b.client}`, b.copy, [openAction("Open Bookings", "bookings")], "Status: Draft")],
        open: "bookings",
      };
    }
    return { say: "Bookings is open.", cards: [], open: "bookings" };
  }

  /* --- approvals --- */
  if (/(approv|sign.?off|waiting on me|pending|queue)/.test(s)) {
    const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
    return {
      say: pend.length ? `${pend.length} decision${pend.length === 1 ? "" : "s"} waiting on you. Other queues are unchanged.` : "Approval queue is clear.",
      cards: pend.slice(0, 3).map((a) => card("Needs your call", a.title, a.detail, [openAction("Review in Approvals", "approvals")], `Requested by ${a.requestedBy}`)),
      open: "approvals",
    };
  }

  /* --- memory --- */
  if (/(memory|remember|saved context|what do you know|knowledge|database|local data|past conversations)/.test(s)) {
    const mem = memoryStats();
    return {
      say: mem.total
        ? `Memory has ${mem.total} saved item${mem.total === 1 ? "" : "s"} across ${mem.categories || 1} categor${mem.categories === 1 ? "y" : "ies"}.`
        : "Memory is empty right now. New conversations start saving locally from here.",
      cards: [card("Memory", "Local context database",
        "Conversations auto-organize into categories. Normal memories expire after 30 days unless you or Phantom mark them to remember.",
        [openAction("Open Memory", "memory")],
        mem.remembered ? `${mem.remembered} remembered` : "Private and local")],
      open: "memory",
    };
  }

  /* --- automations created from Phantom chat --- */
  if (/(automation|automate|workflow|autopilot|recurring|every\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|remind me|auto[- ]?follow|auto[- ]?post)/.test(s)) {
    if (/(create|make|build|draft|set ?up|setup|add|automate|every|when|remind)/.test(s)) {
      const a = createAutomation(subject, text);
      return {
        say: `I drafted "${a.name}" as an automation. It will wait for approval before anything runs.`,
        cards: [card("Automation draft", a.name, a.mission, [
          openAction("View Automation", "automation"),
          openAction("Review approval", "approvals"),
        ], "Approval required")],
        open: "automation",
      };
    }
    const autos = visible(store.state.agents || []);
    return {
      say: autos.length
        ? `${autos.length} automation${autos.length === 1 ? "" : "s"} exist on this workspace. Opening Automation.`
        : "No automations have been created yet. Tell me what should repeat and I'll draft it for approval.",
      cards: autos.slice(0, 3).map((a) => card("Automation", a.name, a.mission || "No mission saved.", [openAction("Open Automation", "automation")], `Status: ${statusLabel(a.status || "idle")}`)),
      open: "automation",
    };
  }

  /* --- workforce --- */
  if (/(workforce|agents?|team|who('| i)s working|workers)/.test(s)) {
    const active = (store.state.toolSpine || []).filter((tool) => ["active", "owner-controlled", "available", "planning"].includes(tool.mode)).length;
    const total = Math.max(1, (store.state.toolSpine || []).length + 1);
    return {
      say: admin
        ? `${active} of ${total} workers are active or ready. Opening the Workers cockpit.`
        : `${active} workers are ready on your account. Opening your Workers view.`,
      cards: [], open: "workforce",
    };
  }

  /* --- plan / today / status --- */
  if (/(today|plan|what('| i)s next|priorit|status|morning|catch me up|summary)/.test(s)) {
    const plan = todaysPlan();
    return {
      say: plan.length ? `${plan.length} thing${plan.length === 1 ? "" : "s"} on today's plan. Top of the list below.` : "No real tasks are loaded yet. Start by adding a lead, drafting a proposal, or creating a video request.",
      cards: plan.slice(0, 3).map((p) => card("Today", p.text, "", [openAction("Open", p.open)])),
      open: null,
    };
  }

  /* --- help / what can you do --- */
  if (/(help|what can you|how do|what do you do|\?$)/.test(s) && s.length < 60) {
    return {
      say: "Ask in plain business language. I route it to the right desk and hand you something real — a draft, a plan, or the workspace it lives in.",
      cards: [card("Try one of these", "Commands that create things",
        "Draft a proposal · Create a video request · Build a store · Run a security check · What's my pipeline?", [])],
      open: null,
    };
  }

  /* --- fallback: still useful --- */
  const plan = todaysPlan();
  return {
    say: subject
      ? `Intent unclear for “${text}.” Tell me the lane: answer, lead, proposal, media brief, page, booking, task, automation, memory, or approval.`
      : "Intent unclear. Give me a command, question, objective, or target lane.",
    cards: [
      card("Quick routes", "Where this usually goes",
        "Answer · Check pipeline · Draft proposal · Create media brief · Build page or store · Review approvals",
        [openAction("Leads", "leads"), openAction("Proposal Forge", "proposals"), openAction("Media Lab", "media")]),
      ...(plan.length ? [card("Meanwhile — today", plan[0].text, "", [openAction("Open", plan[0].open)])] : []),
    ],
    open: null,
  };
}

export async function handleSmartCommand(raw) {
  const text = (raw || "").trim();
  const intent = classifyPhantomIntent(text);
  const settings = loadRuntimeAiSettings();

  if (canAskHermes(intent, settings)) {
    const backend = await askHermesBrain(text, intent, settings);
    if (backend) return backend;
  }

  return handleCommand(text);
}

/* Suggestion chips under the command input. */
export function commandSuggestions() {
  return isAdmin()
    ? ["Catch me up", "What do you remember?", "Stage Protect Sweep", "Reputation Radar", "Social Trend Lab", "Create a video request"]
    : ["What's happening on my account?", "Show my deliverables", "Draft a review request", "Book a call with my team", "Run a security check"];
}
