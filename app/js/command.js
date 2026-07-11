/* PhantomForce Phantom — the operator brain behind the chat.
   Classifies each message into a lane (conversation/answer/brainstorm/
   command/workflow/approval/clarification), then replies like an operator
   would: casual chat stays casual, questions get answered, commands start
   real work, anything external/risky goes to approval first. Router/lane
   language is internal — it never belongs in what the user reads. Local
   mode never sends, uploads, charges, or deploys. */

import {
  store, uid, visible, currentWs, isAdmin, isOwnerOperator, pushActivity, moneyView, todaysPlan,
  PACKAGES, RETAINERS, VACATION_POLICY, fmtMoney, statusLabel, daysUntil, memoryStats, chatHistoryStats,
  ctx, session, loadPhantomLoop, savePhantomLoop, loopProviderName, modelDisplayLabel,
  getPhantomLaneTarget, loadPhantomLaneConfig,
} from "./store.js?v=phantom-live-20260711-168";
import { classifyPhantomIntent as classifyRaw, deriveActionContract } from "./intent-router.js?v=phantom-live-20260711-168";
const classifyPhantomIntent = (text) => deriveActionContract(classifyRaw(text));

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
const signedMoney = (value) => value < 0 ? `-${fmtMoney(Math.abs(value))}` : fmtMoney(value);

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
  return getPhantomLaneTarget(settings.provider).id;
}

function providerForSettings(settings) {
  return getPhantomLaneTarget(settings.provider).provider || "phantom";
}

function selectedLaneModelForSettings(settings) {
  const cfg = loadPhantomLaneConfig();
  const lane = cfg.lanes?.[settings.provider];
  return lane?.model || getPhantomLaneTarget(settings.provider).models?.[0] || "";
}

function canAskHermes(intent, settings) {
  return isAdmin()
    && settings.brainMode !== "local"
    && SAFE_BACKEND_INTENTS.has(intent.primaryIntent)
    && !intent.shouldCreateTask
    && !intent.shouldCreateAutomation;
}

/* The backend chat route can walk up to 4 providers (Codex, Claude CLI,
   OpenRouter, local Ollama) before giving up, each capped at 20-30s server
   side — worst case lands around 110s. This timeout must stay above that or
   the UI aborts before the backend's own fallback chain finishes and silently
   drops to the local canned responder in handleCommand() below. */
async function askHermesBrain(raw, intent, settings) {
  if (typeof fetch !== "function" || typeof AbortController === "undefined") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 140000);
  const token = typeof session?.token === "function" ? session.token() : "";
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const loop = loadPhantomLoop();
  try {
    const response = await fetch("/phantom-ai/chat", {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message: raw,
        user_request: raw,
        provider: providerForSettings(settings),
        admin_model: modelLaneForSettings(settings),
        model_lane: modelLaneForSettings(settings),
        requested_model: selectedLaneModelForSettings(settings),
        execution_mode: settings.externalActionMode === "owner_rules" ? "auto" : "approval",
        task_type: intent.primaryIntent,
        business_name: "PhantomForce",
        actor_user_id: ctx.session?.sessionId || ctx.session?.name || "owner-admin",
        business_summary: "PhantomForce Business Manager. AI-assisted operations, Creator Hub, client pipeline, bookings, offer desk, accounting, follow-up, site portfolio, approval gates, and local owner memory.",
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
            lane_target: modelLaneForSettings(settings),
            lane_model: selectedLaneModelForSettings(settings),
          },
        },
        phantom_loop: loop.enabled ? {
          target_provider: loop.targetProvider,
          target_model: loop.targetModel,
          depth: loop.depth,
          approval_mode: loop.approvalMode,
          max_cost_per_response: loop.maxCostPerResponse,
          routing_mode: loop.advanced.routingMode,
          max_passes: loop.advanced.maxPasses,
          timeout_ms: loop.advanced.timeoutMs,
          share_private_context: loop.advanced.sharePrivateContext,
          allow_tool_calls: loop.advanced.allowToolCalls,
        } : null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.message?.content) return null;
    const say = String(payload.message.content || "").replace(/\s+\n/g, "\n").trim();
    if (!say) return null;
    return {
      say,
      cards: [],
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

function createPendingMedia(subject) {
  const t = subject ? title(subject) : "New creative";
  const m = {
    id: uid("med"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    title: `${t} — pending video`, type: "Video generation", status: "pending",
    angle: "Hook in 2 seconds, one idea, end on the offer.",
    shots: ["Opening hook shot", "Detail pass", "People / reaction", "Offer card", "Logo sting"],
    caption: `${t} — caption starter. Punch it up before approval.`, proof: null, updated: new Date().toISOString(),
  };
  store.state.media.unshift(m);
  pushActivity("Media Factory", `added pending media: ${m.title}.`, m.ws);
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
  pushActivity("Websites", `drafted ${s.title}.`, s.ws);
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
    id: uid("agt"), ws, kind: "automation", source: "Business HQ",
    name, mission: raw, status: "idle",
    allowedDuringVacation: true, requiresApprovalDuringVacation: true,
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

function createLooperPlan(raw) {
  const cleaned = String(raw || "New build packet")
    .replace(/\b(start\s+(phantom\s+loop|loopus|looper)\s+for|build\s+me|create|make|turn\s+this\s+into)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const plan = {
    id: uid("loop"),
    ws,
    title: title(cleaned || "Guarded build packet").slice(0, 90),
    request: String(raw || "").slice(0, 300),
    status: "draft",
    safety: "No render, publish, or send. External actions require approval.",
    steps: [
      "Clarify the business outcome and target user.",
      "Create a local draft or implementation plan.",
      "Verify locally before any public action.",
      "Queue publish/send/deploy/spend decisions for approval.",
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.looperPlans = Array.isArray(store.state.looperPlans) ? store.state.looperPlans : [];
  store.state.looperPlans.unshift(plan);
  pushActivity("Phantom Loop", `drafted guarded build packet: ${plan.title}.`, ws);
  store.save();
  return plan;
}

function createVacationModeRun(raw) {
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const run = {
    id: uid("vac"),
    ws,
    title: "Vacation Mode coverage run",
    request: String(raw || "").slice(0, 300),
    status: "approval_required",
    policy: { ...VACATION_POLICY },
    blockedActions: ["render", "publish", "send", "deploy", "spend", "delete", "external"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const agent = {
    id: uid("agt"),
    ws,
    kind: "vacation-run",
    name: "Vacation Mode Coverage",
    mission: "Draft, plan, organize, prepare, summarize, and queue approvals while the owner is away.",
    status: "approval_required",
    allowedDuringVacation: true,
    requiresApprovalDuringVacation: true,
    ref: run.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const approval = {
    id: uid("app"),
    ws,
    type: "vacation-mode",
    title: "Approve Vacation Mode coverage",
    detail: "Local coverage run prepared. External actions and credits remain blocked until explicit approval.",
    ref: run.id,
    status: "pending",
    requestedBy: "Phantom AI",
    at: new Date().toISOString(),
  };
  store.state.vacationRuns = Array.isArray(store.state.vacationRuns) ? store.state.vacationRuns : [];
  store.state.vacationRuns.unshift(run);
  store.state.agents.unshift(agent);
  store.state.approvals.unshift(approval);
  pushActivity("Vacation Mode", "prepared an approval-gated coverage run.", ws);
  store.save();
  return run;
}

function approvalCount() {
  return visible(store.state.approvals).filter((a) => a.status === "pending").length;
}

function operatorSnapshot() {
  const m = moneyView();
  const plan = todaysPlan();
  return {
    pipeline: m.pipeline,
    openProposals: m.open.length,
    wonValue: m.wonValue,
    retainerMonthly: m.retainerMonthly,
    netCash: m.netCash,
    transactionCount: m.transactions.length,
    approvals: approvalCount(),
    today: plan.length,
    topPlan: plan[0] || null,
  };
}

function readinessLine() {
  const snap = operatorSnapshot();
  const pieces = [
    snap.transactionCount ? `${signedMoney(snap.netCash)} net cashflow` : "ledger empty",
    `${fmtMoney(snap.pipeline)} quote potential`,
    `${snap.openProposals} open proposal${snap.openProposals === 1 ? "" : "s"}`,
    `${snap.approvals} approval${snap.approvals === 1 ? "" : "s"}`,
    `${snap.today} item${snap.today === 1 ? "" : "s"} on today's board`,
  ];
  return `Ready, Jordan. ${pieces.join(" · ")}. Ask, draft, build, track, recall, approve, or route anything.`;
}

function currentInfoAnswer(text, settings = null) {
  const s = text.toLowerCase();
  if (!/\b(weather|forecast|temperature|rain|snow|news|headlines?|latest|current|score|stock|crypto|price of|exchange rate|traffic|sports)\b/.test(s)) {
    return null;
  }
  const cfg = settings || loadRuntimeAiSettings();
  if (cfg.brainMode === "local") {
    return {
      say: "That's a live, real-time question, and I won't fake an answer. Connect a live backend in Settings and ask me again.",
      cards: [card("Setup needed", "Live answers need a connected backend", "Weather, news, prices, and scores need real-time data, not just your workspace. Turn on Connected mode in Settings.", [openAction("Open Settings", "settings")])],
      open: null,
    };
  }
  /* backend mode was on but the live brain did not answer (we only reach
     here after the backend attempt) — be honest instead of re-lecturing */
  return {
    say: "That didn't come back just now, and I won't invent an answer. Try again in a moment.",
    cards: [],
    open: null,
  };
}

function localQuestionAnswer(text, settings = null) {
  const s = text.toLowerCase();
  const live = currentInfoAnswer(text, settings);
  if (live) return live;

  if (/\b(proposals?|quotes?|pricing|estimates?|deals?)\b/.test(s)) {
    const m = moneyView();
    const top = m.open[0];
    return {
      say: top
        ? `${m.open.length} proposal${m.open.length === 1 ? "" : "s"} open. Top one: ${top.client} at ${fmtMoney(top.price)}. Say "draft a proposal" if you want a new one started.`
        : "No open proposals right now. Say who it's for and I'll draft one.",
      cards: [],
      open: null,
    };
  }

  if (/\b(lead|prospect|inquir|follow.?up|crm)\b/.test(s)) {
    const leads = visible(store.state.leads || []);
    const due = leads.filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
    return {
      say: due.length
        ? `${due.length} lead${due.length === 1 ? " needs" : "s need"} attention now. Want me to open Leads, draft a follow-up, or track it as a task?`
        : `${leads.length} lead${leads.length === 1 ? "" : "s"} loaded, nothing overdue.`,
      cards: [],
      open: null,
    };
  }

  if (/\b(approval|approve|pending|waiting on me|review queue)\b/.test(s)) {
    const pend = visible(store.state.approvals || []).filter((a) => a.status === "pending");
    return {
      say: pend.length ? `${pend.length} approval${pend.length === 1 ? "" : "s"} waiting on you. I won't approve anything from chat — that's your call, in the queue.` : "Approval queue is clear.",
      cards: [],
      open: null,
    };
  }

  if (/\b(website|site|landing|page|store|shop|checkout)\b/.test(s)) {
    return {
      say: "Treat the site as the offer path, not decoration — lead with the outcome, show proof fast, make the CTA obvious. Say \"build\" and I'll start a draft; publishing still waits for your approval.",
      cards: [],
      open: null,
    };
  }

  if (/\b(content|video|reel|shoot|caption|post|media)\b/.test(s)) {
    const media = visible(store.state.media || []);
    return {
      say: media.length
        ? `${media.length} media item${media.length === 1 ? "" : "s"} loaded in Media Lab. Tell me what to create or edit and I'll get moving — nothing sends or posts without your OK.`
        : "Media Lab is ready and empty. Tell me what to create and I'll get moving.",
      cards: [],
      open: null,
    };
  }

  if (/\b(how do i|how should i|what should i|what do you think|why is|why are|explain|compare)\b/.test(s)) {
    return {
      say: "Here's my take on that — if you want it turned into real work after, just say build, draft, or track and I'll take it from there.",
      cards: [],
      open: null,
    };
  }

  const snap = operatorSnapshot();
  return {
    say: `Right now: ${snap.transactionCount ? `${signedMoney(snap.netCash)} net cashflow` : "ledger empty"}, ${fmtMoney(snap.pipeline)} in quote potential, ${snap.approvals} approval${snap.approvals === 1 ? "" : "s"} waiting, ${snap.today} thing${snap.today === 1 ? "" : "s"} on today's plan. Ask me anything, or tell me what to build, post, automate, or check.`,
    cards: [],
    open: null,
  };
}

function intentResponse(intent, text, settings = null) {
  if (intent.primaryIntent === "greeting") {
    /* a greeting is a greeting — no status dump, no task, no cards */
    return {
      say: isAdmin()
        ? "I'm online. What are we working on — building, posting, editing, automating, or checking the business?"
        : "I'm online. Tell me what you want to build, fix, post, automate, or check.",
      cards: [],
      open: null,
    };
  }
  /* "chat" intent deliberately has no case here — it still needs a chance to
     match routeCommand()'s business-keyword cascade below (e.g. "make a
     thumbnail for this" classifies as generic "chat" but must still reach
     the media branch). Genuinely unmatched chat lands on routeCommand()'s
     own fallback, which is conversational, not a router prompt. */
  if (intent.primaryIntent === "gratitude") {
    return {
      say: "Anytime. What's next?",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "identity") {
    return {
      say: "I'm PhantomForce's operator, not just a chatbot. I run the workers, media, sites, automations, and approvals in this workspace — you tell me the outcome, I handle the work and bring anything risky back to you first.",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "capability") {
    return {
      say: "I'm built to be your operator, not just a chatbot. I can answer questions, plan work, use your business memory, prepare media, route workers, build sites, create automations, and queue approvals. The more your accounts, assets, and memory are connected, the more I can actually do.",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "question") {
    return localQuestionAnswer(text, settings);
  }
  if (intent.primaryIntent === "brainstorm") {
    return {
      say: "Let's think it through — I'm not turning this into work unless you ask. What's the version of this that would actually matter?",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "feedback") {
    return {
      say: "Yeah, that shouldn't happen. Want me to turn this into a fix task, or just talk through what feels wrong?",
      cards: [],
      open: null,
    };
  }
  if (intent.primaryIntent === "plan") {
    return {
      say: "Plan lane. Define the outcome, list the constraints, choose the owner, break it into approval-safe steps, then decide which steps become records. No tasks were created.",
      cards: [card("Plan mode", "Draft plan only", "Ask for a proposal, task list, build packet, or approval queue when you want the plan converted.", [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "looper_build") {
    if (!isAdmin()) {
      return {
        say: "Phantom Loop build packets are admin-only. Nothing launched, no task was created, and no external action ran.",
        cards: [],
        open: null,
      };
    }
    const plan = createLooperPlan(text);
    return {
      say: `Looper draft created: "${plan.title}". No render, publish, or send. This is a guarded local build packet waiting for owner review.`,
      cards: [card("Looper draft", plan.title, plan.safety, [openAction("Open build plans", "sites"), openAction("Review approvals", "approvals")], "Draft only")],
      open: null,
    };
  }
  if (intent.primaryIntent === "task_candidate") {
    return {
      say: "I can make that a task, turn it into a plan, or just talk it through. What do you want?",
      cards: [card("If you want it tracked", intent.taskDraft?.title || "Possible task", "Say 'create a task for this' and it goes on the list — otherwise we're just talking.", [])],
      open: null,
    };
  }
  if (intent.primaryIntent === "approval_request" && intent.reasonCode === "risky_action_requires_approval") {
    return {
      say: "That's an external action — publish/send/deploy/spend/delete never fire from chat. It goes to the Approval Queue first, and nothing has been executed.",
      cards: [card("Approval required", "External action held", "Review and approve it in the queue when you're ready. No credits spent, nothing sent.", [openAction("Open Approvals", "approvals")], "Nothing executed")],
      open: null,
    };
  }
  if (intent.primaryIntent === "termina_parallel") {
    return {
      say: "Termina lane: I'd split this across planner, builder, and reviewer workers. The multi-agent wall isn't wired on this box yet, so nothing launched — I can stage it as a guarded plan in Workers instead.",
      cards: [card("Termina", "Parallel split staged, not launched", "Planner → Builder → Reviewer. Say 'stage it in Workers' to keep it as a guarded plan until Termina is connected.", [openAction("Open Workers", "workforce")], "No agents launched")],
      open: null,
    };
  }
  if (intent.primaryIntent === "vacation_mode") {
    /* Vacation Mode is a separate system from Automation — it is real,
       backend-tracked away-coverage (vacation.js, /api/vacation-mode/*),
       not a chat-fabricated automation record. Chat can prepare a local
       approval-gated coverage run, but it never starts external work. */
    if (intent.shouldStartVacationMode) {
      const run = createVacationModeRun(text);
      return {
        say: `Vacation Mode run armed as approval-gated draft "${run.title}". Allowed: draft, plan, organize, prepare, summarize, and report. Blocked until approval: render, publish, send, deploy, spend, delete, and external actions.`,
        cards: [card("Vacation Mode — approval required", run.title, "A local coverage run was prepared and placed in the Approval Queue. No external action started.", [openAction("Open Vacation Mode", "vacation"), openAction("Review approval", "approvals")], "Approval-gated")],
        open: "vacation",
      };
    }
    return {
      say: "Vacation Mode is away-coverage, not the same thing as your automations — it drafts, plans, organizes, preps assets, and writes reports while you're away, with publish/send/deploy/spend/delete always queued for approval. Say 'confirm vacation mode' and I'll take you there to turn it on.",
      cards: [card("Vacation Mode — awaiting confirmation", "Go live your life. Phantom keeps the work moving.", "Allowed: draft · plan · summarize · organize · prepare · report · queue approvals. Requires approval: publish · send · deploy · spend · delete · external. Your automations keep running independently of this.", [openAction("Open Vacation Mode", "vacation")], "Not started")],
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
      say: `Done — created task "${t.title}". Priority: ${t.priority === "high" ? "High" : "Normal"}. Source: explicit request. No external actions.`,
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
      say: `Automation drafted: "${a.name}". It is waiting for approval before anything runs — we can keep talking here.`,
      cards: [card("Automation draft", a.name, a.mission, [openAction("Review approval", "approvals"), openAction("Open Automation", "automation")], "Approval required")],
      open: null,
    };
  }
  if (intent.primaryIntent === "phantom_loop_on") {
    const loop = savePhantomLoop({ ...loadPhantomLoop(), enabled: true });
    pushActivity("Phantom Loop", `enabled — routing through ${loopProviderName(loop.targetProvider)}.`);
    return {
      say: `Phantom Loop is on. Replies now route through ${loopProviderName(loop.targetProvider)} (${modelDisplayLabel(loop.targetModel)}) and bring the answer back here. Adjust routing anytime from the chat composer or Settings.`,
      cards: [card("Phantom Loop", "Enabled", `${loopProviderName(loop.targetProvider)} · ${loop.depth === "one_pass" ? "1 pass" : loop.depth === "two_pass" ? "2 passes" : "Auto"} · ${loop.approvalMode === "manual" ? "Manual approval" : loop.approvalMode === "ask_external" ? "Ask before external calls" : "Auto for safe reads"}`, [openAction("Advanced routing", "settings")])],
      open: null,
    };
  }
  if (intent.primaryIntent === "phantom_loop_off") {
    savePhantomLoop({ ...loadPhantomLoop(), enabled: false });
    pushActivity("Phantom Loop", "disabled.");
    return { say: "Phantom Loop is off. Replies stay with Phantom only.", cards: [], open: null };
  }
  return null;
}

/* ---------------- response shaping: the settings you pick actually change
   how Phantom talks. Length trims or extends; style recolors the voice. --- */
function shapeResponse(response, settings) {
  if (!response || !response.say) return response;
  let say = response.say;
  if (settings.responseLength === "short") {
    const sentences = say.match(/[^.!?]+[.!?]+/g) || [say];
    say = sentences.slice(0, Math.max(1, sentences.length > 2 ? 1 : sentences.length)).join(" ").trim();
  } else if (settings.responseLength === "deep" && response.cards?.length) {
    say = `${say} Details are on the card${response.cards.length === 1 ? "" : "s"} below — tell me which thread to pull.`;
  }
  if (settings.responseStyle === "coach" && !/^Here's the thinking/i.test(say)) {
    say = `Here's the thinking: ${say}`;
  } else if (settings.responseStyle === "sales" && !/pipeline|money|revenue|\$/.test(say)) {
    say = `${say} Business angle: keep this tied to a measurable outcome.`;
  } else if (settings.responseStyle === "technical" && response.intent?.reasonCode && isOwnerOperator()) {
    /* raw intent/lane diagnostics are owner-only — everyone else picking
       "Technical" style just gets a slightly more precise, less chatty tone */
    say = `${say} [lane: ${response.intent.userVisibleMode || response.intent.primaryIntent} · ${response.intent.reasonCode}]`;
  }
  return { ...response, say };
}

/* ---------------- the router ---------------- */
export function handleCommand(raw) {
  const settings = loadRuntimeAiSettings();
  return shapeResponse(routeCommand(raw, settings), settings);
}

function routeCommand(raw, settings) {
  const text = (raw || "").trim();
  const s = text.toLowerCase();
  const subject = subjectOf(text);
  const admin = isAdmin();
  const intent = classifyPhantomIntent(text);
  const guarded = intentResponse(intent, text, settings);
  if (guarded) return { ...guarded, intent };

  /* --- actual accounting ledger --- */
  if (/\b(money|cash|cashflow|cash flow|transaction|transactions|expense|expenses|accounting|ledger|bank|credit card|card spend|unpaid|invoice|paid|payment)\b/.test(s)) {
    const m = moneyView();
    const line = m.transactions.length
      ? `${signedMoney(m.netCash)} net cashflow across ${m.transactions.length} actual transaction${m.transactions.length === 1 ? "" : "s"}: ${fmtMoney(m.cashIn)} in, ${fmtMoney(m.cashOut)} out.`
      : "Your accounting ledger has no transactions yet. Add one manually or import a bank/card CSV; live bank sync should stay marked not connected until the secure connector backend is configured.";
    return {
      say: line,
      cards: [card("Accounting", "Actual transaction ledger",
        m.transactions.length
          ? `${m.uncategorizedCount} uncategorized · latest: ${m.latestTransaction?.description || "none"}.`
          : "Accounting only counts confirmed transaction records here. Potential revenue belongs in goals and quotes.",
        [openAction("Open Accounting", "money")])],
      open: "money",
    };
  }

  /* --- opportunity / goals, not ledger cash --- */
  if (/\b(pipeline|revenue goal|potential revenue|open quotes?|won proposals?|retainers?)\b/.test(s)) {
    const m = moneyView();
    return {
      say: `${fmtMoney(m.pipeline)} is open quote potential, ${fmtMoney(m.wonValue)} is won proposal value, and ${fmtMoney(m.retainerMonthly)}/mo is retainer goal value. None of that counts as Accounting until a real transaction confirms cash moved.`,
      cards: [card("Goals", "Opportunity snapshot",
        `${m.open.length} open · ${m.won.length} won · ${m.lost.length} lost. Highest-value open: ${m.open[0] ? `${m.open[0].client} (${fmtMoney(m.open[0].price)})` : "none"}.`,
        [openAction("Open quotes", "proposals"), openAction("Open Accounting", "money")])],
      open: "proposals",
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
  if (/(video|reel|content|post|caption|shoot|media|creative|tiktok|short|thumbnail|image|photo|graphic)/.test(s)) {
    if (/(plan|draft|create|make|new|idea|fix|edit|cinematic|better)/.test(s) || subject) {
      const m = createPendingMedia(subject);
      return {
        say: `On it — starting a Media Lab edit for "${m.title}". I'll show a preview before anything's final.`,
        cards: [card("Pending media", m.title, m.angle, [openAction("Open in Media Lab", "media")], m.type)],
        open: "media",
      };
    }
    return { say: "Media Lab is open — pending generations and generated outputs.", cards: [], open: "media" };
  }

  /* --- store --- */
  if (/(store|shop|product|catalog|merch|sell|checkout)/.test(s)) {
    if (/(build|create|draft|make|new|add)/.test(s)) {
      const d = createPageDraft(subject, "Store");
      return {
        say: `Website drafted "${d.title}". Open Websites and describe the store changes in the prompt.`,
        cards: [card("Website draft", d.title, d.sections.join(" · "), [openAction("Open Websites", "sites")])],
        open: "sites",
      };
    }
    return { say: "Websites is open. Pick a domain and describe the change in the prompt.", cards: [], open: "sites" };
  }

  /* --- site / page --- */
  if (/(website|web ?page|landing|site|page)/.test(s)) {
    if (/(build|create|draft|make|new)/.test(s)) {
      const d = createPageDraft(subject, /landing/.test(s) ? "Landing page" : "Website");
      return {
        say: `Website drafted "${d.title}". Open it and keep shaping it with the prompt.`,
        cards: [card("Website draft", d.title, d.sections.join(" · "), [openAction("Open Websites", "sites")])],
        open: "sites",
      };
    }
    return { say: "Websites is open.", cards: [], open: "sites" };
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
    const hist = chatHistoryStats();
    return {
      say: mem.total
        ? `Memory has ${mem.total} saved item${mem.total === 1 ? "" : "s"} across ${mem.categories || 1} categor${mem.categories === 1 ? "y" : "ies"}. Temporary history has ${hist.total} item${hist.total === 1 ? "" : "s"} waiting for its 10-day shred.`
        : `Saved memory is empty right now. Temporary history has ${hist.total} item${hist.total === 1 ? "" : "s"} and shreds after 10 days.`,
      cards: [card("Memory", "Local context database",
        "Saved memory is durable context. Temporary chat history is separate, expires after 10 days, and throwaway greetings are never stored.",
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
      say: plan.length ? `${plan.length} thing${plan.length === 1 ? "" : "s"} on today's plan. Top of the list below.` : "No real tasks are loaded yet. Start by adding a lead, drafting a proposal, or generating media.",
      cards: plan.slice(0, 3).map((p) => card("Today", p.text, "", [openAction("Open", p.open)])),
      open: null,
    };
  }

  /* --- developer diagnostics — owner-only, never leaked to anyone else --- */
  if (/\b(developer logs?|dev logs?|backend logs?|system logs?|diagnostics|raw logs?|developer (mode|diagnostics|panel))\b/.test(s)) {
    if (!isOwnerOperator()) {
      return { say: "That's owner-only diagnostics — not something I can open for this account.", cards: [], open: null };
    }
    return { say: "Opening Developer.", cards: [], open: "developer" };
  }

  /* --- help / what can you do --- */
  if (/(help|what can you|how do|what do you do|\?$)/.test(s) && s.length < 60) {
    return {
      say: "Ask me anything, or tell me what to build, fix, post, automate, or check — leads, proposals, media, sites, security, whatever's real. I'll handle it or tell you what's missing.",
      cards: [],
      open: null,
    };
  }

  /* --- fallback: a genuine clarifying question, not a router prompt --- */
  return {
    say: subject
      ? `Not sure what you want me to do with "${subject}" — want me to look into it, or turn it into something (a task, a draft, a build)?`
      : "Say a bit more about what you want — or point me at leads, proposals, media, a site, or the business overall and I'll take it from there.",
    cards: [],
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
    ? ["Catch me up", "What do you remember?", "Stage Protect Sweep", "Reputation Radar", "Social Trend Lab", "Generate a video"]
    : ["What's happening on my account?", "Show my deliverables", "Draft a review request", "Book a call with my team", "Run a security check"];
}
