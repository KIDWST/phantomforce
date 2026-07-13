/* PhantomForce page worker prompts.
   Prompt-first local intelligence for major workspaces. This is not a
   questionnaire: one messy user ask becomes inferred intent, assumptions,
   draftable actions, and one blocking question max. Nothing external runs. */

import { store, visible, currentWs, wsName, pushActivity } from "./store.js?v=phantom-live-20260712-230";
import { createCrmProspectBuildout, isCrmProspectBuildout } from "./command.js?v=phantom-live-20260712-230";

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
  leads: {
    eyebrow: "Client intelligence",
    title: "Build the client base.",
    placeholder: "Ask for small businesses, coaches, gyms, creators, service companies, or warm prospects...",
    helper: "Phantom turns one prompt into draft prospect lanes, qualification tasks, and approval-safe next moves.",
    action: "Build local prospect map",
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
  "media",
  "sites",
  "content",
  "assets",
  "intelligence",
  "vacation",
  "phantomplay",
  "settings",
  "developer",
  "activity",
  "promptlibrary",
  "account",
  "customize",
]);

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
    leads: [
      "Create local draft prospect lanes in Clients when the prompt asks for a client base.",
      "Do not invent names, phone numbers, emails, or live relationships.",
      "Queue qualification and public/CRM enrichment as the next step before outreach.",
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
    || (/\b(start|create|generate|make|build|map|list|draft)\b/i.test(text)
      && /\b(client|lead|prospect|contact|small business|businesses|phantomforce)\b/i.test(text));
}

function runPageAction(pageId, prompt) {
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

function renderPlan(card, pageId, prompt) {
  const out = card.querySelector("[data-page-worker-output]");
  if (!out) return;
  const analysis = analyzePrompt(pageId, prompt);
  const pageAction = runPageAction(pageId, prompt);
  if (prompt.trim()) rememberPrompt(pageId, prompt, analysis);
  out.hidden = false;
  out.innerHTML = `
    <div class="page-worker-intel-head">
      <span>Aggressive intelligence mode</span>
      <b>${esc(analysis.intent)}</b>
      <em>${analysis.confidence}% inferred</em>
    </div>
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
      <b>${analysis.question ? "One blocking question" : "No more fields needed"}</b>
      <span>${esc(analysis.question || "Phantom has enough to draft locally. External moves still require approval.")}</span>
    </div>`;
  pushActivity("Page Intelligence", pageAction ? pageAction.summary : (analysis.question ? `needs one detail for ${analysis.intent.toLowerCase()}.` : `prepared ${analysis.intent.toLowerCase()} from one prompt.`));
  store.save();
  return { analysis, pageAction };
}

export function mountPageWorkers(root = document, opts = {}) {
  root.querySelectorAll("[data-page-worker-form]").forEach((form) => {
    if (form.dataset.pageWorkerBound) return;
    form.dataset.pageWorkerBound = "1";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const card = form.closest("[data-page-worker]");
      const pageId = card?.dataset.pageWorker || "page";
      const input = form.querySelector("[data-page-worker-input]");
      const prompt = input?.value || "";
      const result = renderPlan(card, pageId, prompt);
      opts.notify?.("Phantom", result?.pageAction?.summary || "I inferred the missing pieces from one prompt. No field-by-field setup.");
      if (result?.pageAction?.refreshWorkspace) {
        setTimeout(() => opts.openWorkspace?.(pageId), 320);
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

