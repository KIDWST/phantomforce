/* PhantomForce page worker prompts.
   AI-backed page intelligence for major workspaces. This is not a
   questionnaire: one messy user ask becomes inferred intent, backend analysis,
   draftable actions, and one blocking question max. External actions stay
   approval-gated. */

import { store, visible, currentWs, wsName, pushActivity, session, currentTenantId } from "./store.js?v=phantom-live-20260723-34";
import { createCrmProspectBuildout, isCrmProspectBuildout } from "./command.js?v=phantom-live-20260723-34";

const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const PAGE_WORKERS = {
  automation: {
    eyebrow: "Automation intelligence",
    title: "Prompt it. Phantom fills the blanks.",
    placeholder: "Enter your automation here and we’ll go through what we can do for you...",
    helper: "No forms first. Phantom infers trigger, tools, safety rules, and the smallest runnable draft.",
    action: "Draft approval-gated automation",
  },
  sites: {
    eyebrow: "Website intelligence",
    title: "Prompt the site change.",
    placeholder: "Describe the page, store, section, form, or offer you want...",
    helper: "Phantom assumes structure, copy, layout, and proof needs from the prompt and current workspace.",
    action: "Draft site or store update",
  },
  content: {
    eyebrow: "Creator intelligence",
    title: "Prompt the campaign.",
    placeholder: "Ask for posts, ideas, captions, a schedule, or a campaign plan...",
    helper: "Phantom infers platform, format, caption angle, approval path, and next draft without asking for every field.",
    action: "Create campaign draft",
  },
  assets: {
    eyebrow: "Asset intelligence",
    title: "Prompt the asset move.",
    placeholder: "Ask to sort files, find a logo, tag assets, or clean up a folder...",
    helper: "Phantom infers file type, business, tags, safe copies, and cleanup intent.",
    action: "Prepare asset plan",
  },
  intelligence: {
    eyebrow: "Research intelligence",
    title: "Prompt the watch mission.",
    placeholder: "Name a competitor, offer, market, or customer question...",
    helper: "Phantom turns a vague target into public-signal research, hypotheses, and safe next moves.",
    action: "Run public research plan",
  },
  analytics: {
    eyebrow: "Analytics intelligence",
    title: "Prompt the business question.",
    placeholder: "Ask why a post worked, what changed, or what to do next...",
    helper: "Phantom answers from connected data and local activity first, then says exactly what is missing.",
    action: "Analyze performance question",
  },
  money: {
    eyebrow: "Accounting intelligence",
    title: "Prompt the money question.",
    placeholder: "Ask about cash flow, invoices, expenses, packages, or what needs cleanup...",
    helper: "Phantom separates real ledger records from missing bank/payment connectors and keeps charges or sends approval-gated.",
    action: "Analyze accounting workflow",
  },
  memory: {
    eyebrow: "Memory intelligence",
    title: "Prompt the memory check.",
    placeholder: "Ask what Phantom remembers, what changed, or what should be corrected...",
    helper: "Phantom checks scoped workspace memory, recent notes, contradictions, and what needs a durable note.",
    action: "Review workspace memory",
  },
  leads: {
    eyebrow: "Client intelligence",
    title: "Run the CRM.",
    placeholder: "Tell Phantom: pull 5 new clients per day, add a warm lead, or update a client record...",
    helper: "Phantom keeps CRM records scoped to this organization with social handles, notes, and approval-safe next moves.",
    action: "Update CRM",
  },
  approvals: {
    eyebrow: "Approval intelligence",
    title: "Prompt the risk review.",
    placeholder: "Ask what needs approval, what is safe, or why something is blocked...",
    helper: "Phantom explains the risk, owner decision, required evidence, and what cannot execute before approval.",
    action: "Review approval gate",
  },
  workforce: {
    eyebrow: "Workforce intelligence",
    title: "Prompt the worker route.",
    placeholder: "Ask which worker should handle it, what is stuck, or what task to create...",
    helper: "Phantom maps the outcome to workers, tasks, review lanes, and proof without launching unsafe work.",
    action: "Route workforce task",
  },
  vacation: {
    eyebrow: "Away intelligence",
    title: "Prompt the coverage plan.",
    placeholder: "Describe what should keep moving while you’re gone...",
    helper: "Phantom infers safe coverage, review gates, and urgent alerts without opening a control panel first.",
    action: "Draft Away Mode coverage",
  },
  phantomplay: {
    eyebrow: "Play intelligence",
    title: "Ask PhantomPlay for the right break.",
    placeholder: "Ask for a quick focus game, saved progress, or a game type...",
    helper: "Phantom picks the shortest useful break and keeps it separate from business execution.",
    action: "Choose focused break",
  },
};

const DEFAULT_WORKER = {
  eyebrow: "Page intelligence",
  title: "Prompt the outcome.",
  placeholder: "Ask for the outcome you want on this page...",
  helper: "Phantom infers what matters, fills missing details from context, and keeps risky actions approval-gated.",
  action: "Infer next action",
};

const SKIP_PAGES = new Set([
  "settings",
  "developer",
  "activity",
  "promptlibrary",
  "account",
  "customize",
  "sites",
  "media",
  "content",
  "analytics",
  "leads",
]);

const BACKEND_TIMEOUT_MS = 45000;
const THINKING_LINES = [
  "Phantom is asking the backend brain and trying not to look too dramatic about it.",
  "Checking context, memory, and page intent before we make a confident mess.",
  "Running the real AI path now. The local heuristic has been asked to sit down.",
  "Thinking through the boring safety stuff first so the useful answer can be sharp.",
  "Consulting the private brain, then I’ll bring back the clean version.",
];

function workerFor(pageId) {
  return PAGE_WORKERS[pageId] || DEFAULT_WORKER;
}

export function pageWorkerHtml(pageId, def = {}) {
  if (SKIP_PAGES.has(pageId) || def.ownerOnly) return "";
  const worker = workerFor(pageId);
  return `
    <section class="page-worker" data-page-worker="${esc(pageId)}">
      <div class="page-worker-copy">
        <p>${esc(worker.eyebrow)}</p>
        <h3>${esc(worker.title)}</h3>
        <span>${esc(worker.helper)}</span>
      </div>
      <form class="page-worker-form" data-page-worker-form>
        <textarea data-page-worker-input rows="1" placeholder="${esc(worker.placeholder)}" aria-label="${esc(worker.title)}"></textarea>
        <button type="submit" aria-label="Run page intelligence">Run</button>
      </form>
      <div class="page-worker-output" data-page-worker-output hidden></div>
    </section>`;
}

const HISTORY_KEY = "pf.pageworker.intelligence.v1";
const STOP_WORDS = new Set("the a an and or but to for from with without into onto of in on at by is are was were be been being it this that these those me my our your you we they he she them then than as do does did can could should would will just really very".split(" "));
const PLATFORM_PATTERNS = [
  ["Instagram", /\b(instagram|ig|reels?)\b/i],
  ["TikTok", /\b(tiktok|tik tok)\b/i],
  ["YouTube", /\b(youtube|shorts?)\b/i],
  ["Facebook", /\b(facebook|fb|meta)\b/i],
  ["LinkedIn", /\b(linkedin)\b/i],
  ["Website", /\b(website|site|landing page|store)\b/i],
];
const RISKY = /\b(send|publish|post|deploy|delete|charge|spend|email|dm|message|upload|public|live)\b/i;
const URGENT = /\b(now|today|asap|tonight|this week|urgent|quick|fast|same day|immediately)\b/i;
const MONEY = /\$[\d,]+|\b\d+\s?(?:dollars|bucks|usd)\b/i;
const URL = /\bhttps?:\/\/[^\s]+|\b[a-z0-9-]+\.(?:com|online|net|org|co)\b/i;
const CRM_PAGE_ACTION_VERB = /\b(add|find|search|discover|source|scout|research|identify|update|fill|populate|build|load|start|create|generate|make|map|draft|list)\b/i;
const CRM_PAGE_AUDIENCE = /\b(clients?|leads?|prospects?|contacts?|customers?|small business(?:es)?|business(?:es)?|creators?|schools?|education|gyms?|coaches?|trainers?|service compan(?:y|ies)|contractors?|home services?|restaurants?|bars?|venues?|clubs?|teams?|professional services?|warm prospects?|everyone)\b/i;

function tokenize(value = "") {
  return String(value).toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((word) => !STOP_WORDS.has(word)) || [];
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}") || {}; }
  catch { return {}; }
}

function writeHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
}

function rememberPrompt(pageId, prompt, analysis) {
  const ws = currentWs();
  const history = readHistory();
  const bucket = Array.isArray(history[ws]?.[pageId]) ? history[ws][pageId] : [];
  const next = [{
    prompt: String(prompt || "").slice(0, 420),
    intent: analysis.intent,
    summary: analysis.understood,
    createdAt: Date.now(),
  }, ...bucket].slice(0, 8);
  history[ws] = { ...(history[ws] || {}), [pageId]: next };
  writeHistory(history);
}

function historyFor(pageId) {
  const ws = currentWs();
  return (readHistory()[ws]?.[pageId] || []).slice(0, 3);
}

function relevantMemory(prompt, pageId) {
  const words = new Set(tokenize(`${prompt} ${pageId}`));
  if (!words.size) return [];
  const rows = [
    ...visible(store.state.memory || []).map((item) => ({
      title: item.title || item.category || "Memory",
      body: item.summary || item.text || "",
      source: "Saved memory",
    })),
    ...historyFor(pageId).map((item) => ({
      title: item.intent || "Recent prompt",
      body: item.summary || item.prompt || "",
      source: "Recent page prompt",
    })),
  ];
  return rows
    .map((item) => {
      const haystack = tokenize(`${item.title} ${item.body}`);
      const score = haystack.reduce((sum, word) => sum + (words.has(word) ? 1 : 0), 0);
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function detectedPlatforms(prompt) {
  return PLATFORM_PATTERNS.filter(([, pattern]) => pattern.test(prompt)).map(([name]) => name);
}

function inferredIntent(pageId, prompt) {
  const text = prompt.toLowerCase();
  if (/\b(caption|post|reel|campaign|content|publish|schedule)\b/.test(text)) return "Content campaign";
  if (/\b(website|site|landing|store|page|checkout|booking)\b/.test(text)) return "Website/store build";
  if (/\b(automate|automation|every|recurring|workflow|autopilot)\b/.test(text)) return "Automation draft";
  if (/\b(lead|client|follow[- ]?up|proposal|quote|close)\b/.test(text)) return "Revenue operation";
  if (/\b(analy[sz]e|analytics|metric|views|reach|engagement|why)\b/.test(text)) return "Performance analysis";
  if (/\b(asset|logo|file|folder|image|photo|edit|organize)\b/.test(text)) return "Asset operation";
  return workerFor(pageId).action || "Workspace operation";
}

function compactPrompt(prompt) {
  const clean = String(prompt || "").trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, 180) + (clean.length > 180 ? "..." : "") : "";
}

function extractedSignals(prompt, pageId) {
  const platforms = detectedPlatforms(prompt);
  const signals = [
    ["Workspace", wsName(currentWs())],
    ["Surface", workerFor(pageId).eyebrow.replace(/\s*intelligence$/i, "")],
    ["Urgency", URGENT.test(prompt) ? "fast lane" : "normal"],
    ["Risk gate", RISKY.test(prompt) ? "approval required" : "safe draft first"],
  ];
  if (platforms.length) signals.push(["Platforms", platforms.join(", ")]);
  const money = prompt.match(MONEY)?.[0];
  if (money) signals.push(["Money", money]);
  const url = prompt.match(URL)?.[0];
  if (url) signals.push(["Reference", url]);
  return signals;
}

function assumptionsFor(pageId, prompt, memoryHits) {
  const assumptions = [
    `Use ${wsName(currentWs())} as the active business unless the prompt names another one.`,
    "Do not send, post, deploy, delete, charge, or expose anything without approval.",
    "Prefer draft/output first, then review, then approved execution.",
  ];
  if (!detectedPlatforms(prompt).length && pageId === "content") assumptions.push("Default platforms: enabled social accounts first, then Instagram/TikTok style if no account is chosen.");
  if (pageId === "automation") assumptions.push("Default trigger is manual/approval-gated until the user explicitly enables a schedule.");
  if (pageId === "sites") assumptions.push("Default deliverable is a previewable section/page draft, not a public publish.");
  if (memoryHits.length) assumptions.push(`Use ${memoryHits.length} relevant saved/recent context hint${memoryHits.length === 1 ? "" : "s"} before asking more.`);
  return assumptions;
}

function actionDrafts(pageId, prompt, intent) {
  const text = compactPrompt(prompt) || "the requested outcome";
  const common = [
    `Parse the prompt into: goal, audience, asset/input, deadline, and approval risk.`,
    `Create a first draft for "${text}" using page context instead of a blank form.`,
  ];
  const byPage = {
    automation: [
      "Infer trigger, condition, action, review gate, and off switch.",
      "Put risky output into Approvals; keep the automation disabled until reviewed.",
      "Show the user the editable workflow name and mission after the draft exists.",
    ],
    content: [
      "Infer platform set, caption angle, CTA, format, and preview state.",
      "Generate the caption plus platform-specific variants and keep publishing gated.",
      "Place the result in Draft Queue or Post/Publish composer, not scattered notes.",
    ],
    sites: [
      "Infer page type, section order, offer, proof, CTA, and visual tone.",
      "Draft the section/page locally and keep publish/deploy locked.",
      "Show a preview with the smallest editable fields after the draft exists.",
    ],
    analytics: [
      "Answer from connected data and first-party local activity before requesting imports.",
      "Separate real metrics from missing connectors and give one next move.",
      "Flag the exact connector/report only if it is truly missing.",
    ],
    money: [
      "Check local ledger records, packages, invoices, and account connector status before estimating.",
      "Separate real dollar records from missing bank/payment data; never invent revenue or charges.",
      "Prepare cleanup, invoice, or offer-desk tasks without sending bills or charging cards.",
    ],
    memory: [
      "Search scoped workspace memory and recent page prompts before answering.",
      "Identify contradictions, stale notes, and facts that need user confirmation.",
      "Suggest the smallest durable memory update instead of saving every chat line.",
    ],
    leads: [
      "Immediately create local CRM prospect cards in Clients when the prompt asks to find or add a client base.",
      "Do not invent names, phone numbers, emails, or live relationships.",
      "Queue qualification and public/CRM enrichment as the next step before outreach.",
    ],
    approvals: [
      "Explain what action is blocked, who can approve it, and what evidence is missing.",
      "Never execute the underlying action from the prompt result itself.",
      "Prepare an approve/reject summary and a safer draft-only alternative.",
    ],
    workforce: [
      "Route the request to the right worker lane and define what proof that worker must return.",
      "Create a draft task only when the user explicitly asks for tracking.",
      "Keep external execution separate from planning, assignment, and review.",
    ],
    intelligence: [
      "Use public-safe research framing and separate facts from guesses.",
      "Extract competitor, offer, customer pain, and response opportunity.",
      "Return a short attack plan for positioning, content, or sales.",
    ],
    assets: [
      "Infer asset category, usage, tags, and whether to copy instead of mutate originals.",
      "Prepare a clean working set and note missing assets.",
      "Use Asset Cloud/Media Lab paths before asking for uploads.",
    ],
    vacation: [
      "Infer what can continue safely and what must wait for approval.",
      "Create coverage buckets: drafts, alerts, follow-ups, and blockers.",
      "Keep external actions locked unless Away Mode explicitly allows them.",
    ],
    phantomplay: [
      "Choose a focused break, classroom-safe game, or private playtest path based on the prompt.",
      "Keep social play inside same-workspace/private-room boundaries.",
      "Flag child-safety, moderation, and owner-control requirements before any public multiplayer feature.",
    ],
  };
  return [...common, ...(byPage[pageId] || [
    `Route this as ${intent}.`,
    "Use the current page tools automatically before asking the user to hunt for controls.",
    "Return a visible draft/action packet with approval status.",
  ])];
}

function isLeadsProspectPrompt(pageId, prompt = "") {
  if (pageId !== "leads") return false;
  const text = String(prompt || "");
  return isCrmProspectBuildout(text)
    || (CRM_PAGE_ACTION_VERB.test(text) && CRM_PAGE_AUDIENCE.test(text))
    || (/\b(who|companies|businesses|people|organizations)\b[\s\S]{0,80}\b(interested|could\s+use|would\s+need|could\s+buy|could\s+hire|need\s+phantomforce)\b/i.test(text));
}

export function runPageAction(pageId, prompt) {
  if (!isLeadsProspectPrompt(pageId, prompt)) return null;
  const buildout = createCrmProspectBuildout(
    /\b(client|lead|crm|pipeline|prospect|contact)\b/i.test(prompt)
      ? prompt
      : `start a client base prospect list for ${prompt}`,
  );
  const createdNames = buildout.created.map((lead) => lead.name);
  const laneNames = buildout.segments.map((segment) => segment.title);
  const names = (createdNames.length ? createdNames : laneNames).join(", ");
  return {
    type: "prospect-buildout",
    title: buildout.created.length ? "Prospect lanes created" : "Prospect lanes already mapped",
    summary: `${createdNames.length || laneNames.length} draft lane${(createdNames.length || laneNames.length) === 1 ? "" : "s"} ready in Clients: ${names}.`,
    notes: [
      "No outreach, upload, deploy, or public action happened.",
      "No fake contact details were generated.",
      "Next: qualify one lane with public/CRM research before adding real business names.",
    ],
    refreshWorkspace: true,
  };
}

function pageActionHtml(action) {
  if (!action) return "";
  return `
    <div class="page-worker-action-result">
      <span>Local action completed</span>
      <b>${esc(action.title)}</b>
      <p>${esc(action.summary)}</p>
      <ul>${action.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>
    </div>`;
}

function blockingQuestion(prompt, pageId) {
  const words = tokenize(prompt);
  if (!prompt.trim()) return "What outcome do you want on this page?";
  if (words.length <= 2) return "Give me one sentence with the outcome, and I’ll infer the rest.";
  if (pageId === "analytics" && /\b(why|what worked|performance)\b/i.test(prompt) && !visible(store.state.socialAccounts || []).length) {
    return "Which account or channel should I treat as the source if no connector is live yet?";
  }
  return "";
}

function analyzePrompt(pageId, prompt) {
  const memoryHits = relevantMemory(prompt, pageId);
  const intent = inferredIntent(pageId, prompt);
  const question = blockingQuestion(prompt, pageId);
  const signals = extractedSignals(prompt, pageId);
  const assumptions = assumptionsFor(pageId, prompt, memoryHits);
  const understood = prompt.trim()
    ? `Phantom understood this as ${intent.toLowerCase()}: ${compactPrompt(prompt)}`
    : "Phantom is waiting for one outcome prompt. No field-by-field setup needed.";
  const confidence = question ? 58 : Math.min(94, 72 + signals.length * 3 + memoryHits.length * 4);
  return {
    intent,
    understood,
    confidence,
    signals,
    assumptions,
    actions: actionDrafts(pageId, prompt, intent),
    memoryHits,
    question,
  };
}

function thinkingLine(pageId, prompt) {
  const key = `${currentWs()}:${pageId}:${prompt}`;
  let hash = 0;
  for (const char of key) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return THINKING_LINES[Math.abs(hash) % THINKING_LINES.length];
}

function renderThinking(out, pageId, prompt, pageAction = null) {
  out.hidden = false;
  out.classList.add("is-thinking");
  const detail = pageAction
    ? `${pageAction.summary} The local CRM update is done; Phantom is checking the backend for the cleaner report now.`
    : "Pulling page context, scoped memory, and safety gates before reporting the result.";
  out.innerHTML = `
    <div class="page-worker-thinking">
      <span>AI backend thinking</span>
      <b>${esc(thinkingLine(pageId, prompt))}</b>
      <p>${esc(detail)}</p>
      <i aria-hidden="true"></i>
    </div>`;
}

function backendTextFrom(payload) {
  return String(
    payload?.message?.content
    || payload?.content
    || payload?.output_text
    || payload?.reply
    || "",
  ).trim();
}

function backendStatusLabel(backend) {
  const payload = backend?.payload || {};
  return backend?.provider
    || payload.admin_model_label
    || payload.model_id
    || (payload.live_provider_called ? "live provider" : "backend answered");
}

function backendContentHtml(content) {
  return String(content || "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function sessionActorId() {
  const saved = typeof session?.get === "function" ? session.get() : null;
  return saved?.sessionId || saved?.name || saved?.email || "owner-admin";
}

function pageContextModules(pageId, prompt, analysis) {
  const worker = workerFor(pageId);
  const modules = [{
    module: "page_worker_request",
    summary: `User is on ${worker.title} for ${wsName(currentWs())}. Answer the outcome prompt with concise, useful next steps.`,
    items: [
      { title: "Prompt", status: analysis.intent, detail: compactPrompt(prompt) || "No prompt entered yet." },
      { title: "Safety", status: RISKY.test(prompt) ? "approval_required" : "draft_safe", detail: "Do not send, post, deploy, delete, charge, upload, expose, or message externally." },
      { title: "Page", status: pageId, detail: worker.helper },
    ],
  }];
  if (analysis.memoryHits.length) {
    modules.push({
      module: "workspace_memory_hits",
      summary: `${analysis.memoryHits.length} relevant saved or recent context hints were available.`,
      items: analysis.memoryHits.map((hit) => ({
        title: String(hit.title || hit.source || "Memory").slice(0, 90),
        status: String(hit.source || "memory").slice(0, 40),
        detail: String(hit.body || "").slice(0, 220),
      })),
    });
  }
  const socialAccounts = visible(store.state.socialAccounts || []).slice(0, 8).map((account) => ({
    title: String(account.platform || account.network || account.name || "Social account").slice(0, 80),
    status: String(account.connected || account.oauthConnected ? "connected" : account.status || "saved").slice(0, 50),
    detail: [account.handle, account.username, account.displayName, account.label].filter(Boolean).join(" · ").slice(0, 180),
  }));
  if (socialAccounts.length) {
    modules.push({
      module: "saved_social_accounts",
      summary: `${socialAccounts.length} saved account profile${socialAccounts.length === 1 ? "" : "s"} are visible for this workspace.`,
      items: socialAccounts,
    });
  }
  const recent = historyFor(pageId).map((item) => ({
    title: String(item.intent || "Recent page prompt").slice(0, 90),
    status: "recent",
    detail: String(item.summary || item.prompt || "").slice(0, 220),
  }));
  if (recent.length) {
    modules.push({
      module: "recent_page_outcomes",
      summary: `${recent.length} recent page prompt${recent.length === 1 ? "" : "s"} from this workspace.`,
      items: recent,
    });
  }
  return modules;
}

function backendPrompt(pageId, prompt, analysis) {
  const worker = workerFor(pageId);
  const pageContract = pageId === "leads"
    ? [
      "Clients page contract: this prompter's job is to find and add CRM-safe prospect lanes, then explain how to qualify them.",
      "If the prompt asks for clients, leads, prospects, audiences, schools, creators, gyms, service companies, or warm prospects, treat it as a CRM/prospect buildout.",
      "Do not invent real names, emails, phone numbers, private contacts, or claim outreach. The local action creates draft lanes and a qualification task only.",
    ]
    : [];
  return [
    "You are PhantomForce's page outcome worker inside Jordan's private business command center.",
    "Use the provided page context, saved memory hints, and safety gates to answer the user's outcome prompt.",
    "Be direct, useful, and slightly funny, but do not ramble.",
    "Never say the work is queued. If you cannot execute something directly, say what draft/result you can prepare now.",
    "Never claim that you posted, sent, uploaded, deployed, charged, scraped private data, or changed external systems.",
    "If exactly one detail blocks the work, end with: Before we proceed, answer this: <one question>.",
    "If there is enough context, start with: Done: <result>.",
    "",
    `Workspace: ${wsName(currentWs())}`,
    `Page: ${worker.title} (${pageId})`,
    `Local intent: ${analysis.intent}`,
    `Local confidence: ${analysis.confidence}%`,
    `User outcome prompt: ${prompt}`,
    "",
    ...pageContract,
    ...(pageContract.length ? [""] : []),
    "Local draft path:",
    analysis.actions.slice(0, 6).map((step, index) => `${index + 1}. ${step}`).join("\n"),
  ].join("\n");
}

async function askBackendForPageOutcome(pageId, prompt, analysis) {
  if (!String(prompt || "").trim()) return { content: "", error: "" };
  if (typeof fetch !== "function") return { content: "", error: "AI backend fetch is unavailable in this browser." };
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS) : null;
  const token = typeof session?.token === "function" ? session.token() : "";
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch("/phantom-ai/chat", {
      method: "POST",
      headers,
      signal: controller?.signal,
      body: JSON.stringify({
        message: backendPrompt(pageId, prompt, analysis),
        user_request: prompt,
        provider: "phantom",
        admin_model: "private",
        model_lane: "private",
        route_tier: "standard",
        max_provider_ms: BACKEND_TIMEOUT_MS,
        allow_provider_fallback: true,
        execution_mode: "approval",
        task_type: `page_outcome_${pageId}`,
        tenant_id: currentTenantId(),
        workspace_id: currentWs(),
        business_name: wsName(currentWs()),
        actor_user_id: sessionActorId(),
        business_summary: `${wsName(currentWs())} workspace page worker. Convert one outcome prompt into an answer, safe draft path, and at most one blocking question.`,
        module_data: pageContextModules(pageId, prompt, analysis),
      }),
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { payload = { message: { content: raw } }; }
    if (!response.ok) {
      return { content: "", error: `AI backend returned HTTP ${response.status}.`, payload };
    }
    const content = backendTextFrom(payload);
    if (!content) return { content: "", error: "AI backend returned no message content.", payload };
    return {
      content,
      provider: payload.admin_model_label || payload.model_id || payload.provider_choice || "",
      payload,
    };
  } catch (error) {
    return {
      content: "",
      error: error?.name === "AbortError"
        ? "AI backend took too long to answer."
        : `AI backend could not be reached: ${error?.message || "unknown error"}.`,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function renderPageWorkerResult(out, analysis, pageAction, backend) {
  const hasBackendAnswer = Boolean(backend?.content);
  out.classList.remove("is-thinking");
  out.innerHTML = `
    <div class="page-worker-intel-head">
      <span>${hasBackendAnswer ? "AI backend result" : "Local fallback result"}</span>
      <b>${esc(analysis.intent)}</b>
      <em>${esc(hasBackendAnswer ? backendStatusLabel(backend) : (backend?.error || "needs prompt"))}</em>
    </div>
    ${hasBackendAnswer ? `
      <div class="page-worker-backend-result">
        <span>Report</span>
        ${backendContentHtml(backend.content)}
      </div>` : backend?.error ? `
      <div class="page-worker-backend-result is-fallback">
        <span>Backend check</span>
        <p>${esc(backend.error)} Phantom kept the local result visible instead of going blank.</p>
      </div>` : ""}
    <p class="page-worker-understood">${esc(analysis.understood)}</p>
    <div class="page-worker-intel-grid">
      <article>
        <span>Signals</span>
        <div class="page-worker-chips">
          ${analysis.signals.map(([k, v]) => `<i><b>${esc(k)}</b>${esc(v)}</i>`).join("")}
        </div>
      </article>
      <article>
        <span>Assumptions Phantom will use</span>
        <ul>${analysis.assumptions.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
      </article>
      <article>
        <span>Draftable next moves</span>
        <ul>${analysis.actions.map((step) => `<li>${esc(step)}</li>`).join("")}</ul>
      </article>
    </div>
    ${pageActionHtml(pageAction)}
    ${analysis.memoryHits.length ? `<div class="page-worker-memory"><span>Context used</span>${analysis.memoryHits.map((hit) => `<p><b>${esc(hit.source)}:</b> ${esc(hit.title)} — ${esc(String(hit.body || "").slice(0, 120))}</p>`).join("")}</div>` : ""}
    <div class="page-worker-gate ${analysis.question ? "needs-input" : "ready"}">
      <b>${analysis.question ? "Before we proceed, answer this:" : "Done. Ready to draft."}</b>
      <span>${esc(analysis.question || "Phantom has enough to draft locally. External moves still require approval.")}</span>
    </div>`;
}

function currentWorkerOutput(card, pageId) {
  const liveCard = card?.isConnected
    ? card
    : document.querySelector(`[data-page-worker="${String(pageId || "page").replace(/"/g, '\\"')}"]`);
  return liveCard?.querySelector("[data-page-worker-output]") || card?.querySelector("[data-page-worker-output]") || null;
}

async function renderPlan(card, pageId, prompt) {
  let out = currentWorkerOutput(card, pageId);
  if (!out) return;
  const analysis = analyzePrompt(pageId, prompt);
  const pageAction = runPageAction(pageId, prompt);
  out = currentWorkerOutput(card, pageId);
  if (!out) return { analysis, pageAction, backend: null };
  renderThinking(out, pageId, prompt, pageAction);
  const backend = await askBackendForPageOutcome(pageId, prompt, analysis);
  out = currentWorkerOutput(card, pageId);
  if (!out) return { analysis, pageAction, backend };
  if (prompt.trim()) rememberPrompt(pageId, prompt, analysis);
  renderPageWorkerResult(out, analysis, pageAction, backend);
  pushActivity("Page Intelligence", pageAction ? pageAction.summary : (analysis.question ? `needs one detail for ${analysis.intent.toLowerCase()}.` : `${backend?.content ? "AI backend answered" : "Local fallback prepared"} ${analysis.intent.toLowerCase()} from one prompt.`));
  store.save();
  return { analysis, pageAction, backend };
}

export function mountPageWorkers(root = document, opts = {}) {
  root.querySelectorAll("[data-page-worker-form]").forEach((form) => {
    if (form.dataset.pageWorkerBound) return;
    form.dataset.pageWorkerBound = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = form.closest("[data-page-worker]");
      if (!card) return;
      const pageId = card?.dataset.pageWorker || "page";
      const input = form.querySelector("[data-page-worker-input]");
      const button = form.querySelector("button");
      const prompt = input?.value || "";
      if (form.dataset.pageWorkerBusy === "1") return;
      form.dataset.pageWorkerBusy = "1";
      card?.setAttribute("aria-busy", "true");
      if (button) button.disabled = true;
      try {
        const result = await renderPlan(card, pageId, prompt);
        opts.notify?.("Phantom", result?.pageAction?.summary || (result?.backend?.content
          ? "AI backend analyzed the prompt and reported the result."
          : "I could not get a backend answer, so I kept the local fallback result visible."));
        if (result?.pageAction?.refreshWorkspace) {
          setTimeout(() => opts.openWorkspace?.(pageId), 320);
        }
      } finally {
        delete form.dataset.pageWorkerBusy;
        card?.removeAttribute("aria-busy");
        if (button) button.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-page-worker-input]").forEach((input) => {
    if (input.dataset.pageWorkerAutosize) return;
    input.dataset.pageWorkerAutosize = "1";
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(120, Math.max(40, input.scrollHeight))}px`;
    });
  });
}
