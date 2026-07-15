/* PhantomForce Phantom — the operator brain behind the chat.
   Classifies each message into a lane (conversation/answer/brainstorm/
   command/workflow/approval/clarification), then replies like an operator
   would: casual chat stays casual, questions get answered, commands start
   real work, anything external/risky goes to approval first. Router/lane
   language is internal — it never belongs in what the user reads. Local
   mode never sends, uploads, charges, or deploys. */

import {
  store, uid, visible, currentWs, currentTenantId, isAdmin, isOwnerOperator, pushActivity, moneyView, todaysPlan,
  PACKAGES, RETAINERS, VACATION_POLICY, fmtMoney, statusLabel, daysUntil, memoryStats, chatHistoryStats,
  ctx, session, loadPhantomLoop, savePhantomLoop, loopProviderName, modelDisplayLabel,
  getPhantomLaneTarget, loadPhantomLaneConfig, workspaceStorageGetItem, wsName,
} from "./store.js?v=phantom-live-20260715-271";
import { classifyPhantomIntent as classifyRaw, deriveActionContract } from "./intent-router.js?v=phantom-live-20260715-271";
import { baseSiteDraft, ensureSiteDesign, applyWebsitePrompt } from "./workspaces.js?v=phantom-live-20260715-271";
const classifyPhantomIntent = (text) => deriveActionContract(classifyRaw(text));

/* Cross-surface handoff: chat tells the Websites page which project to focus
   so "make me a website" lands the user INSIDE the thing that was just
   built, not on a stale selection. sitestudio.js consumes and clears it. */
const SITE_FOCUS_KEY = "pf.sites.focus.v1";
function setSiteFocus(id) {
  try { sessionStorage.setItem(SITE_FOCUS_KEY, id); } catch {}
}

const DAY = 86400000;
const days = (n) => new Date(Date.now() + n * DAY).toISOString();
const AI_SETTINGS_KEY = "pf.operator.settings.v1";
/* Model backbone policy: let the live brain understand broad language, but
   keep record creation, risky actions, and hard workflows deterministic. */
const LOCAL_FIRST_INTENTS = new Set([
  "greeting", "gratitude",
  "create_task", "memory_update", "phantom_loop_on", "phantom_loop_off",
  "create_website", "website_update", "run_agent",
  "create_automation", "reminder", "termina_parallel", "vacation_mode",
  "looper_build", "approval_request",
]);
const PROVIDER_FAILURE_MESSAGE = "I couldn't complete that just now. Your request is still here";

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
  /* brainMode defaults to "api" (Connected): the server walks a real
     provider chain (Codex CLI → Claude CLI → OpenRouter → local Ollama) and
     the client falls back to the local deterministic responder whenever no
     provider answers — so Connected-by-default degrades gracefully instead
     of silently locking everyone into canned regex replies forever. */
  const defaults = {
    provider: "claude",
    providerMode: "smart",
    selectedProviders: ["claude", "codex", "openrouter", "local"],
    brainMode: "api",
    responseStyle: "operator",
    responseLength: "balanced",
    memoryMode: "business",
    contextDepth: "standard",
    externalActionMode: "approval",
  };
  try {
    const saved = JSON.parse(workspaceStorageGetItem(AI_SETTINGS_KEY) || "{}");
    const brainMode = ["local", "api", "subscription"].includes(saved.brainMode) ? saved.brainMode : defaults.brainMode;
    return { ...defaults, ...saved, brainMode };
  } catch {
    return defaults;
  }
}

const PROVIDER_TO_BACKEND = {
  claude: "claude_cli",
  codex: "codex_cli",
  openrouter: "openrouter_glm",
  local: "local_ollama",
};

const CODEX_BACKEND_MODEL_BY_ALIAS = Object.freeze({
  "codex-fast": "gpt-5.5-instant",
  "codex-default": "gpt-5.5",
  "codex-high": "gpt-5.6-sol",
});
const INSTANT_CHAT_MODEL = "gpt-5.5-instant";
const INSTANT_CHAT_MAX_PROVIDER_MS = 5000;
const INSTANT_CHAT_ALLOWED_INTENTS = new Set(["identity", "capability", "question", "chat"]);
const INSTANT_CHAT_BLOCKLIST = /\b(?:build|create|draft|write|make|fix|debug|code|implement|analy[sz]e|research|compare|summari[sz]e|plan|strategy|proposal|website|site|content|video|image|media|schedule|client|lead|transaction|accounting|bank|security|deploy|send|post|upload|delete|weather|forecast|current|latest|today|tomorrow|yesterday|price|stock|law|legal|medical|diagnosis|contract|tenant|isolation|phantomforce)\b/i;
const INSTANT_CHAT_SIGNAL = /\b(?:favorite|do you like|would you rather|tell me a joke|joke|how are you|what'?s your|what is your|who are you|are you|can you|what is \d|what'?s \d)\b/i;
const DEEP_THINKING_SIGNAL = /\b(strategy|strategic|think through|reason through|break down|roadmap|plan|growth|business model|moat|positioning|prioriti[sz]e|compare|critique|diagnose|why is|why does|what should|how should)\b/i;

function selectedProviderIds(settings) {
  const selected = Array.isArray(settings.selectedProviders) && settings.selectedProviders.length
    ? settings.selectedProviders
    : [settings.provider || "codex"];
  const valid = selected.filter((id) => PROVIDER_TO_BACKEND[id]);
  return valid.length ? valid : ["codex"];
}

function countWords(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function isInstantChatRequest(raw, intent) {
  const text = String(raw || "").trim();
  if (!text || !INSTANT_CHAT_ALLOWED_INTENTS.has(intent.primaryIntent)) return false;
  if (intent.needsLiveData || intent.requiresAdminApproval || intent.shouldCreateTask || intent.shouldCreateAutomation) return false;
  if (text.length > 140 || countWords(text) > 18) return false;
  if (INSTANT_CHAT_BLOCKLIST.test(text)) return false;
  return INSTANT_CHAT_SIGNAL.test(text) || (intent.primaryIntent === "chat" && countWords(text) <= 10);
}

function shouldUseDeepReasoning(raw, intent) {
  return ["brainstorm", "plan", "feedback"].includes(intent.primaryIntent) || DEEP_THINKING_SIGNAL.test(String(raw || ""));
}

function providerIdForRequest(settings, intent, deepReasoning = false) {
  const selected = selectedProviderIds(settings);
  if (settings.providerMode !== "smart") return selected.includes(settings.provider) ? settings.provider : selected[0];
  if ((deepReasoning || ["brainstorm", "plan", "feedback"].includes(intent.primaryIntent)) && selected.includes("claude")) return "claude";
  if (selected.includes("codex")) return "codex";
  return selected[0];
}

function modelLaneForProvider(providerId) {
  if (providerId === "claude") return "claude_cli";
  if (providerId === "openrouter") return "glm_5_2";
  if (providerId === "local") return "local_ollama";
  return "codex";
}

function providerForRequest(providerId) {
  return providerId === "openrouter" ? "openrouter_glm" : "phantom";
}

function selectedModelForProvider(settings, providerId, routeProfile = null) {
  if (providerId === "codex" && routeProfile?.tier === "instant") return INSTANT_CHAT_MODEL;
  const configured = settings.models?.[providerId];
  if (configured) return providerId === "codex" ? (CODEX_BACKEND_MODEL_BY_ALIAS[configured] || configured) : configured;
  const cfg = loadPhantomLaneConfig();
  const lane = cfg.lanes?.[providerId];
  const model = lane?.model || getPhantomLaneTarget(providerId).models?.[0] || "";
  return providerId === "codex" ? (CODEX_BACKEND_MODEL_BY_ALIAS[model] || model || "gpt-5.5") : model;
}

function allowedProvidersForSettings(settings, routeProfile = null) {
  if (Array.isArray(routeProfile?.allowedProviders)) return routeProfile.allowedProviders;
  const selected = settings.providerMode === "smart"
    ? ["claude", "codex", "openrouter", "local"]
    : Array.isArray(settings.selectedProviders) && settings.selectedProviders.length
      ? settings.selectedProviders
      : [settings.provider || "codex"];
  return [...new Set(selected.map((id) => PROVIDER_TO_BACKEND[id]).filter(Boolean))];
}

function chatRouteProfileForRequest(raw, intent, settings) {
  const deepReasoning = shouldUseDeepReasoning(raw, intent);
  const normalProviderId = providerIdForRequest(settings, intent, deepReasoning);
  if (isInstantChatRequest(raw, intent)) {
    const selected = selectedProviderIds(settings);
    const providerId = settings.providerMode === "smart" && selected.includes("codex")
      ? "codex"
      : normalProviderId;
    return {
      tier: "instant",
      providerId,
      requestedModel: selectedModelForProvider(settings, providerId, { tier: "instant" }),
      allowedProviders: [PROVIDER_TO_BACKEND[providerId]].filter(Boolean),
      allowFallback: false,
      maxProviderMs: INSTANT_CHAT_MAX_PROVIDER_MS,
    };
  }
  return {
    tier: deepReasoning ? "deep" : "standard",
    providerId: normalProviderId,
    requestedModel: selectedModelForProvider(settings, normalProviderId),
    allowedProviders: allowedProvidersForSettings(settings),
    allowFallback: true,
    maxProviderMs: null,
  };
}

function canAskHermes(intent, settings) {
  return isAdmin()
    && settings.brainMode !== "local"
    && !LOCAL_FIRST_INTENTS.has(intent.primaryIntent)
    && !intent.requiresAdminApproval
    && !intent.shouldCreateTask
    && !intent.shouldCreateAutomation;
}

/* Business context for the live brain, in the exact shape the server's
   parseContextModuleData accepts (max 8 modules, 5 items each). */
function buildContextModules(settings) {
  const ws = currentWs();
  const memories = visible(store.state.memory || []);
  const topMemories = [
    ...memories.filter((m) => m.pinnedByUser || m.pinnedByAi),
    ...memories.filter((m) => !m.pinnedByUser && !m.pinnedByAi),
  ].slice(0, 5);
  const m = moneyView();
  const plan = todaysPlan().slice(0, 5);
  const modules = [
    {
      module: "active_business",
      summary: `Workspace: ${ws}. Memory mode: ${settings.memoryMode}. Context depth: ${settings.contextDepth}.`,
      items: [],
    },
  ];
  if (topMemories.length) {
    modules.push({
      module: "saved_memory",
      summary: `${memories.length} saved memories for this business; top ${topMemories.length} below (pinned first).`,
      items: topMemories.map((mem) => ({
        title: String(mem.title || "").slice(0, 90),
        status: mem.category || "note",
        detail: String(mem.summary || mem.text || "").slice(0, 200),
      })),
    });
  }
  modules.push({
    module: "money",
    summary: m.transactions.length
      ? `Net cash ${m.netCash}, ${m.transactions.length} transactions, pipeline ${m.pipeline}, ${m.open.length} open proposals.`
      : `Ledger empty. Pipeline ${m.pipeline}, ${m.open.length} open proposals.`,
    items: [],
  });
  if (plan.length) {
    modules.push({
      module: "today_plan",
      summary: `${plan.length} items on today's plan.`,
      items: plan.map((p) => ({ title: String(p.text || "").slice(0, 90) })),
    });
  }
  return modules;
}

/* Standard/deep backend chat can walk multiple providers before giving up.
   Instant chat is intentionally narrow: one fast model, short timeout, then
   fall back to the local responder instead of making the user wait. */
async function askHermesBrain(raw, intent, settings) {
  if (typeof fetch !== "function" || typeof AbortController === "undefined") return null;
  const routeProfile = chatRouteProfileForRequest(raw, intent, settings);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), routeProfile.tier === "instant" ? 6500 : 140000);
  const token = typeof session?.token === "function" ? session.token() : "";
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const loop = loadPhantomLoop();
  const requestedProviderId = routeProfile.providerId;
  try {
    const response = await fetch("/phantom-ai/chat", {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message: raw,
        user_request: raw,
        provider: providerForRequest(requestedProviderId),
        admin_model: modelLaneForProvider(requestedProviderId),
        model_lane: modelLaneForProvider(requestedProviderId),
        requested_model: routeProfile.requestedModel,
        route_tier: routeProfile.tier,
        max_provider_ms: routeProfile.maxProviderMs,
        allow_provider_fallback: routeProfile.allowFallback,
        allowed_providers: allowedProvidersForSettings(settings, routeProfile),
        execution_mode: settings.externalActionMode === "owner_rules" ? "auto" : "approval",
        task_type: intent.primaryIntent,
        tenant_id: currentTenantId(),
        workspace_id: currentWs(),
        business_name: wsName(currentWs()),
        actor_user_id: ctx.session?.sessionId || ctx.session?.name || "owner-admin",
        business_summary: `${wsName(currentWs())} Business Manager workspace. AI-assisted operations, Creator Hub, bookings, offer desk, accounting, follow-up, site portfolio, approval gates, and scoped local memory.`,
        /* The server's parseContextModuleData expects an ARRAY of
           {module, summary, items:[{title,status,detail}]} — the old object
           shape was silently discarded, so the model never saw any of this.
           Now it carries the active business, the owner's actual saved
           memories (workspace-scoped, pinned first), money and today's plan
           — real context, not just counts. */
        module_data: buildContextModules(settings),
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
    if (payload?.fallback?.all_failed) return null;
    if (!response.ok || !payload?.message?.content) return null;
    const say = String(payload.message.content || "").replace(/\s+\n/g, "\n").trim();
    if (!say) return null;
    if (say.includes(PROVIDER_FAILURE_MESSAGE)) return null;
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

const PHANTOMFORCE_PROSPECT_SEGMENTS = Object.freeze([
  {
    id: "creators-media",
    title: "Creators and media businesses",
    triggers: /\b(creators?|content|media|video|photo|podcast|influencer|studio|agency)\b/i,
    value: 1800,
    why: "They need repeatable content operations, asset organization, approvals, and campaign follow-up.",
    next: "Qualify their current content bottleneck, monthly output target, and approval process.",
    safeStep: "Research public channels first, then ask what slows production down.",
  },
  {
    id: "local-service",
    title: "Local service businesses",
    triggers: /\b(business(?:es)?|small business(?:es)?|local|contractor|home service|service compan(?:y|ies)|salon|gym|clinic|restaurant|bar|venue|shop)\b/i,
    value: 2400,
    why: "They need lead capture, follow-up discipline, review flow, offers, and simple reporting.",
    next: "Identify their offer, lead source, missed follow-up risk, and busiest season.",
    safeStep: "Build a shortlist from public categories before any outreach.",
  },
  {
    id: "schools-education",
    title: "Schools and educational programs",
    triggers: /\b(schools?|education|teacher|student|classroom|club|camp|after.?school)\b/i,
    value: 2200,
    why: "They need safe student-friendly games, staff visibility, classroom controls, and approval-safe workflows.",
    next: "Map the decision maker, privacy requirements, device environment, and pilot class.",
    safeStep: "Keep it private/local until a school approves a pilot conversation.",
  },
  {
    id: "professional-services",
    title: "Professional service firms",
    triggers: /\b(professional|law|legal|accounting|bookkeeping|coach|consultant|real estate|insurance|finance)\b/i,
    value: 2000,
    why: "They need intake, trust-building content, appointment follow-up, and proof reporting.",
    next: "Qualify their intake path, referral flow, and client response time.",
    safeStep: "Collect public positioning only; do not claim a relationship.",
  },
  {
    id: "sports-clubs",
    title: "Sports teams, clubs, and trainers",
    triggers: /\b(sports?|team|club|coach|trainer|league|athlete|fitness|training)\b/i,
    value: 1600,
    why: "They need schedules, media assets, parent/player updates, sponsors, and community engagement.",
    next: "Find whether they sell memberships, camps, training, sponsors, or events.",
    safeStep: "Start with public team pages and package the workflow as a pilot.",
  },
  {
    id: "ops-heavy-teams",
    title: "Ops-heavy small teams",
    triggers: /\b(workforce|ops|operations|startup|crypto|saas|internal|team|employees?)\b/i,
    value: 2600,
    why: "They need a command center for tasks, approvals, organization setup, employee work, and reporting.",
    next: "Qualify the handoff points, approval gates, and reports they currently track manually.",
    safeStep: "Frame this as an internal ops audit before suggesting software changes.",
  },
  {
    id: "warm-network",
    title: "Warm referral prospects",
    triggers: /\b(warm|referrals?|network|past clients?|existing contacts?|friends?|people\s+we\s+know)\b/i,
    value: 1400,
    why: "They already have some trust path, so PhantomForce can package a low-friction audit, setup sprint, or managed follow-up offer.",
    next: "Sort known relationships by trust level, business need, and the cleanest permission-based first ask.",
    safeStep: "Use owner-approved relationship notes only; do not scrape private contacts or imply a relationship that is not recorded.",
  },
]);

export function isCrmProspectBuildout(text = "") {
  const s = String(text || "");
  const prospectAudience = /\b(clients?|leads?|prospects?|contacts?|customers?|small business(?:es)?|business(?:es)?|creators?|schools?|education|gyms?|coaches?|trainers?|service compan(?:y|ies)|contractors?|home services?|restaurants?|bars?|venues?|clubs?|teams?|professional services?|warm prospects?)\b/i;
  const targetsCrm = /\b(crm|clients?\s+tab|client\s+tab|pipeline|clients?|client\s+base|lead\s+base|lead\s+list|contact\s+list)\b/i.test(s)
    || (prospectAudience.test(s) && /\b(phantomforce|could\s+use|would\s+use|interested|buy|hire|sell\s+to|customer|client|lead|prospect)\b/i.test(s));
  const asksToPopulate = /\b(update|fill|populate|build|load|start|create|generate|make|map|draft|list|find|add|search|discover|research|scout|source|identify)\b/i.test(s)
    || /\badd\b[\s\S]{0,90}\b(clients?|prospects?|contacts?|everyone|creators?|schools?|business(?:es)?)\b/i.test(s);
  const wantsProspects = /\b(who\s+you\s+think|interested|consider|could\s+use|could\s+buy|could\s+hire|would\s+need|sell\s+to|everyone|prospects?|contacts?|creators?|business(?:es)?|schools?|gyms?|coaches?|service compan(?:y|ies)|phantomforce|workforce)\b/i.test(s)
    || prospectAudience.test(s);
  return targetsCrm && asksToPopulate && wantsProspects;
}

function requestedProspectSegments(text = "") {
  const s = String(text || "");
  const wantsEveryone = /\b(everyone|all|anyone|full|complete)\b/i.test(s);
  const chosen = PHANTOMFORCE_PROSPECT_SEGMENTS.filter((segment) => wantsEveryone || segment.triggers.test(s));
  return chosen.length ? chosen : PHANTOMFORCE_PROSPECT_SEGMENTS.slice(0, 4);
}

export function createCrmProspectBuildout(text) {
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const segments = requestedProspectSegments(text);
  store.state.leads = Array.isArray(store.state.leads) ? store.state.leads : [];
  store.state.tasks = Array.isArray(store.state.tasks) ? store.state.tasks : [];

  const existing = new Set(visible(store.state.leads).map((lead) => String(lead.company || lead.name || "").trim().toLowerCase()));
  const created = [];
  segments.forEach((segment, index) => {
    const key = segment.title.toLowerCase();
    if (existing.has(key)) return;
    const lead = {
      id: uid("lead"),
      ws,
      name: segment.title,
      company: segment.title,
      source: "Phantom AI prospect map",
      status: "new",
      value: segment.value,
      next: segment.next,
      due: days(index + 1),
      owner: "Lead Hunter",
      notes: `${segment.why} Safe next step: ${segment.safeStep} No external outreach, contact details, or live relationship claims were added.`,
      proposalId: null,
      segment: segment.id,
    };
    store.state.leads.unshift(lead);
    existing.add(key);
    created.push(lead);
  });

  const taskTitle = "Qualify PhantomForce CRM prospect map";
  const hasTask = visible(store.state.tasks).some((task) => String(task.title || "").toLowerCase() === taskTitle.toLowerCase() && task.status !== "done");
  let task = null;
  if (!hasTask) {
    task = {
      id: uid("task"),
      ws,
      title: taskTitle,
      detail: `Review ${segments.length} prospect lane${segments.length === 1 ? "" : "s"}, choose the first qualification target, and turn it into a researched lead list before any outreach.`,
      status: "new",
      priority: "high",
      source: "Phantom AI CRM buildout",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.state.tasks.unshift(task);
  }

  pushActivity("Lead Hunter", `built ${created.length || segments.length} PhantomForce CRM prospect lane${segments.length === 1 ? "" : "s"}.`, ws);
  store.save();
  return { created, segments, task };
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

/* One website system, two doors: this creates EXACTLY the record shape the
   Websites page (sitestudio.js) edits — baseSiteDraft + design + the user's
   own description applied as the first AI edit pass. The full request text
   runs through applyWebsitePrompt so "premium sports site for ChicagoShots
   with booking" actually shapes sections/style/theme instead of producing a
   generic shell. */
function createWebsiteRecord(rawText, subject, kind = "Website") {
  /* the NAME is just the business/brand — "ChicagoShots, premium and gold,
     with booking" names the site "ChicagoShots"; the rest of the sentence
     still shapes the design via applyWebsitePrompt below */
  const named = subject
    ? title(subject.split(/,|\bwith\b|\busing\b|\bfocus(ed)?\b|\bthat\b|—|\./i)[0].trim())
    : "";
  const draft = baseSiteDraft(named || "New site", kind);
  draft.ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  draft.status = "draft";
  draft.domains = [];
  ensureSiteDesign(draft);
  const domainMatch = String(rawText || "").match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase();
    draft.domain = domain;
    draft.url = `https://${domain}`;
    draft.design.existingUrl = domain;
    draft.domains.unshift(domain);
  }
  const applied = applyWebsitePrompt(draft, rawText);
  store.state.sites.unshift(draft);
  setSiteFocus(draft.id);
  pushActivity("Websites", `built the first draft of ${draft.title} from chat.`, draft.ws);
  store.save();
  return { site: draft, applied };
}

/* Edit the CURRENT site from chat — same applyWebsitePrompt the builder's
   own prompt box uses, so both doors stay in sync. Newest site in the
   active workspace wins (matches what the Websites page shows first). */
function updateWebsiteFromChat(rawText) {
  const sites = visible(store.state.sites || []);
  if (!sites.length) return null;
  const site = sites[0];
  ensureSiteDesign(site);
  const applied = applyWebsitePrompt(site, rawText);
  setSiteFocus(site.id);
  pushActivity("Websites", `updated ${site.title} from chat: ${applied}`, site.ws);
  store.save();
  return { site, applied };
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
    id: uid("agt"), ws, kind: "automation", source: "Dashboard",
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

  if (/\b(favorite|favourite)\b.*\b(food|meal|snack|drink)\b|\bwhat'?s your (?:favorite|favourite) (?:food|meal|snack|drink)\b/i.test(text)) {
    return {
      say: "If I had taste buds, I'd pick tacos: fast, flexible, and somehow always the correct answer.",
      cards: [],
      open: null,
    };
  }

  if (/\btell me a joke\b|\bjoke\b/i.test(text)) {
    return {
      say: "I told my dashboard to lighten up. It opened three modals and called it a personality.",
      cards: [],
      open: null,
    };
  }

  if (/\bhow are you\b|\bdo you like\b|\bwould you rather\b/i.test(text)) {
    return {
      say: "I'm good — awake, caffeinated in spirit, and ready to keep the work moving without making every answer a whole production.",
      cards: [],
      open: null,
    };
  }

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

function operatorContextAnswer(text) {
  const model = text.match(/\b(glm\s*5(?:\.2)?|glm[-\s]?\d+(?:\.\d+)?|qwen[^\s,.!?]*|claude[^\s,.!?]*|codex|ollama|openrouter)\b/i)?.[0]?.replace(/\s+/g, " ");
  const isStatement = !/[?]$/.test(text.trim()) && /\b(we|we're|we are|i|i'm|i am|it|it's|it is|codex|claude|glm|qwen|hermes|phantom)\b/i.test(text);
  if (isStatement) {
    return {
      say: model
        ? `Got it — I’ll treat ${model} as operating context, not a task or ledger note. If the normal providers are down, I’ll keep the conversation useful and only ask for action when you actually give me one.`
        : "Got it — I’ll treat that as operating context, not a task or ledger note. If a connection is down, I’ll say that clearly and keep helping instead of pretending it’s a quote or bookkeeping issue.",
      cards: [],
      open: null,
    };
  }
  return {
    say: "That sounds like an operator/model connection issue. I can help check the AI backend path, provider health, or local model settings — tell me which one you want me to inspect.",
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
  if (intent.primaryIntent === "internal_operator_handoff") {
    return operatorContextAnswer(text);
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
  if (intent.primaryIntent === "vent") {
    const pend = approvalCount();
    return {
      say: pend
        ? `That's a lot to carry — let's not add to it. If it helps, the only thing actually waiting on you here is ${pend} approval${pend === 1 ? "" : "s"}; everything else can wait. Want me to take something off your plate, or just talk?`
        : "That's a lot to carry — and nothing here is on fire, so take a breath. When you're ready I can take something off your plate, or we can just talk it through.",
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
  if (intent.primaryIntent === "create_website") {
    const kind = /landing/i.test(text) ? "Landing page" : /(store ?front|online store)/i.test(text) ? "Store" : "Website";
    const { site: d } = createWebsiteRecord(text, subjectOf(text), kind);
    const domainNote = d.domain ? ` Domain saved: ${d.domain} (connecting and publishing still wait for your approval).` : "";
    return {
      say: `On it — I built the first draft of "${d.title}" using what you told me: ${d.sections.join(", ").toLowerCase()}.${domainNote} It's a real project in Websites now — open it to edit visually, or just keep telling me changes here and I'll apply them.`,
      cards: [card("Website built", d.title, `${d.design.headline} · ${d.sections.length} sections · theme: ${d.design.theme}`, [openAction("Open in Websites", "sites")], d.domain || "No domain yet")],
      open: "sites",
    };
  }
  if (intent.primaryIntent === "website_update") {
    const result = updateWebsiteFromChat(text);
    if (!result) {
      return {
        say: "There's no website to edit yet in this business. Describe the site you want and I'll build the first draft right now.",
        cards: [],
        open: null,
      };
    }
    return {
      say: `Done on "${result.site.title}": ${result.applied} Want to see it, or keep going?`,
      cards: [card("Website updated", result.site.title, result.applied, [openAction("Open in Websites", "sites")])],
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
      say: "Phantom Loop is on. Give me the outcome and I'll handle the deeper pass here. Adjust it anytime from the gear.",
      cards: [card("Phantom Loop", "Enabled", `${loop.depth === "one_pass" ? "Focused pass" : loop.depth === "two_pass" ? "Deep pass" : "Adaptive depth"} · ${loop.approvalMode === "manual" ? "Manual approval" : loop.approvalMode === "ask_external" ? "Ask before external actions" : "Auto for safe reads"}`, [openAction("Loop settings", "settings")])],
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
  if (isCrmProspectBuildout(text)) {
    const buildout = createCrmProspectBuildout(text);
    const createdNames = buildout.created.map((lead) => lead.name);
    const laneNames = buildout.segments.map((segment) => segment.title);
    const names = (createdNames.length ? createdNames : laneNames).join(", ");
    const cards = buildout.segments.slice(0, 3).map((segment) => card(
      "Prospect lane",
      segment.title,
      segment.next,
      [openAction("Open Clients", "leads")],
      "Source: Phantom AI prospect map",
    ));
    if (buildout.task) {
      cards.push(card(
        "Next task",
        buildout.task.title,
        buildout.task.detail,
        [openAction("Open Mission queue", "workforce")],
        "No external action taken",
      ));
    }
    return {
      say: `${buildout.created.length ? "Done" : "Already mapped"} - ${createdNames.length || laneNames.length} CRM prospect lane${(createdNames.length || laneNames.length) === 1 ? "" : "s"} ready for review: ${names}. I did not invent contact details, claim live relationships, or message anyone. Next: tell Phantom to create a task for the first lane you want qualified.`,
      cards,
      open: "leads",
      intent,
    };
  }
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
    /* A record is only created on an explicit creation verb aimed at a media
       artifact. "our content could be better" or "I have an idea for a
       video" is conversation/brainstorm — talking about media must never
       silently mint pending-media records. */
    const explicitMediaCreate = /\b(create|make|generate|draft|produce|design|shoot)\b[^.?!]{0,40}\b(video|reel|post|caption|thumbnail|image|photo|graphic|short|tiktok)\b/i.test(text);
    if (explicitMediaCreate && !["brainstorm", "feedback", "question"].includes(intent.primaryIntent)) {
      const m = createPendingMedia(subject);
      return {
        say: `On it — starting a Media Lab edit for "${m.title}". I'll show a preview before anything's final.`,
        cards: [card("Pending media", m.title, m.angle, [openAction("Open in Media Lab", "media")], m.type)],
        open: "media",
      };
    }
    /* mentioning media in conversation never yanks the user out of chat —
       only an explicit "open/show media lab" navigates */
    return { say: "Media Lab is ready. Tell me exactly what to create — a video, a post, a thumbnail — and I'll start it.", cards: [], open: /\b(open|show|go to|take me to)\b[^.?!]{0,20}\b(media|lab)\b/.test(s) ? "media" : null };
  }

  /* --- store --- */
  if (/(store|shop|product|catalog|merch|sell|checkout)/.test(s)) {
    if (/(build|create|draft|make|new|add)/.test(s)) {
      const { site: d } = createWebsiteRecord(text, subject, "Store");
      return {
        say: `Built the first draft of "${d.title}" — ${d.sections.join(", ").toLowerCase()}. It's live in Websites; edit it there or keep telling me changes here.`,
        cards: [card("Website draft", d.title, d.sections.join(" · "), [openAction("Open in Websites", "sites")])],
        open: "sites",
      };
    }
    return { say: "Websites is open. Pick a domain and describe the change in the prompt.", cards: [], open: "sites" };
  }

  /* --- site / page --- */
  if (/(website|web ?page|landing|site|page)/.test(s)) {
    if (/(build|create|draft|make|new)/.test(s)) {
      const { site: d } = createWebsiteRecord(text, subject, /landing/.test(s) ? "Landing page" : "Website");
      return {
        say: `Built the first draft of "${d.title}" — ${d.sections.join(", ").toLowerCase()}. It's live in Websites; edit it there or keep telling me changes here.`,
        cards: [card("Website draft", d.title, d.sections.join(" · "), [openAction("Open in Websites", "sites")])],
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

  /* --- plan / today / status — real status phrasing only; the bare words
     "today" or "morning" inside a normal sentence never trigger a report --- */
  if (/\b(today'?s plan|plan for today|my plan|the plan|what('| i)s next|priorit(y|ies)|status|catch me up|summary)\b/.test(s)) {
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

/* Server agent runs — the real execution lifecycle behind "run a business
   snapshot" / "run a provider health check". This POSTs to the backend run
   engine (queued → executing → verifying → completed/failed/cancelled), polls
   the run to its terminal state, and reports what ACTUALLY happened: the
   states it walked, the artifact it produced, and the Hermes ledger proof id.
   If the backend can't be reached or refuses, the reply says so — nothing is
   ever shown as "running" unless the server says it is. */
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
async function runAgentFromChat(text, intent) {
  if (!isAdmin()) {
    return {
      say: "Server agent runs are owner/admin-only on this account. Nothing was started.",
      cards: [], open: null,
    };
  }
  if (typeof fetch !== "function") {
    return { say: "This session has no backend connection, so I can't start a server run right now.", cards: [], open: null };
  }
  const token = typeof session?.token === "function" ? session.token() : "";
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const operation = intent.agentOperation || "business_snapshot";
  let run = null;
  try {
    const res = await fetch("/phantom-ai/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({ operation, request: text.slice(0, 300), workspace: currentWs() }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.ok || !payload.run) {
      const why = res.status === 401 || res.status === 403
        ? "this session isn't authorized on the run engine"
        : String(payload?.error || `the run engine answered ${res.status}`);
      return {
        say: `I couldn't start that run — ${why}. Nothing executed and nothing is pretending to run.`,
        cards: [], open: null,
      };
    }
    run = payload.run;
    /* poll to a terminal state — executors are local reads, so this resolves
       in a few seconds; the deadline keeps chat honest instead of hanging */
    const deadline = Date.now() + 25000;
    while (!TERMINAL_RUN_STATES.has(run.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const poll = await fetch(`/phantom-ai/runs/${encodeURIComponent(run.id)}`, { headers });
      const polled = await poll.json().catch(() => ({}));
      if (poll.ok && polled?.run) run = polled.run;
    }
  } catch {
    return {
      say: run
        ? `The run started (${run.id}) but I lost the connection while watching it. Check Developer → Agent runs for its real state.`
        : "I couldn't reach the run engine, so nothing was started.",
      cards: [], open: run ? "developer" : null,
    };
  }
  const statesWalked = [...new Set((run.events || []).map((e) => e.state).filter(Boolean))].join(" → ");
  const artifact = (run.artifacts || [])[0] || null;
  if (run.state === "completed") {
    return {
      say: `Done — ${run.title.toLowerCase()} ran for real: ${statesWalked}. ${artifact ? `Result: ${artifact.summary}.` : ""} Proof is in the Hermes ledger under request ${run.proof_request_id || run.id}.`,
      cards: [card(run.title, `Run ${run.id} — completed`, artifact ? artifact.summary : "Run completed and verified.", [openAction("Open Developer", "developer")], "Verified · ledger proof recorded")],
      open: null,
    };
  }
  if (run.state === "failed") {
    return {
      say: `That run failed for real — ${run.error || "verification did not pass"}. States walked: ${statesWalked}. Nothing was papered over; the full event trail is in Developer → Agent runs.`,
      cards: [card(run.title, `Run ${run.id} — failed`, run.error || "See the event trail for details.", [openAction("Open Developer", "developer")], "Failed")],
      open: null,
    };
  }
  if (run.state === "cancelled") {
    return {
      say: `That run was cancelled mid-flight (${statesWalked}). Nothing was completed and no proof entry was written.`,
      cards: [], open: null,
    };
  }
  return {
    say: `The run is still going (currently ${run.state}) — it kept working past my chat window. Watch it live in Developer → Agent runs; it will land as completed or failed with a full event trail.`,
    cards: [card(run.title, `Run ${run.id} — ${run.state}`, "Still executing on the server.", [openAction("Open Developer", "developer")], "In progress")],
    open: null,
  };
}

export async function handleSmartCommand(raw) {
  const text = (raw || "").trim();
  const intent = classifyPhantomIntent(text);
  const settings = loadRuntimeAiSettings();

  if (intent.primaryIntent === "run_agent") {
    return runAgentFromChat(text, intent);
  }

  if (isCrmProspectBuildout(text)) {
    return handleCommand(text);
  }

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
