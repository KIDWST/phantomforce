export type ConversationContextModule = {
  module: string;
  summary: string;
  items?: Array<{ title: string; status?: string; detail?: string }>;
};

const BUSINESS_TERMS = /\b(?:business|company|workspace|client|customer|lead|crm|proposal|quote|invoice|payment|revenue|expense|profit|cash|bank|card|transaction|accounting|ledger|budget|tax|website|domain|content|campaign|media|automation|approval|planner|schedule|task|project|goal|competitor|organization|organisation|phantomforce|chicagoshots)\b/i;
const BUSINESS_TASKS = new Set([
  "create_task", "create_website", "website_update", "create_automation", "approval_request",
  "plan", "brainstorm", "feedback", "memory_update", "run_agent",
]);
const INSTANT_TASKS = new Set(["identity", "capability", "question", "chat"]);
const REASONING_TASKS = new Set(["identity", "capability", "question", "chat", "brainstorm", "feedback", "plan"]);
const ADVISORY_TASKS = new Set(["brainstorm", "feedback", "plan"]);
const INSTANT_ALWAYS_BLOCKED = /\b(?:diagnos(?:e|is)|medical advice|legal advice)\b|\b(?:what(?:'s| is)|how(?:'s| is)|check|show me|give me)\b.{0,28}\b(?:weather|forecast|temperature|humidity)\b|\b(?:weather|forecast|temperature|humidity)\b.{0,28}\b(?:today|tonight|tomorrow|now|current|latest|outside|near me|in\s+[a-z])\b|\b(?:latest|current|today'?s?|breaking|live)\b.{0,28}\b(?:news|headlines?|score|result|traffic|price|quote|exchange rate|weather|forecast)\b|\b(?:news|headlines?|score|result|traffic)\b.{0,28}\b(?:latest|current|today|tonight|now|live|last night)\b|\b(?:stock|share|crypto|bitcoin|ethereum)\b.{0,28}\b(?:price|quote|value|rate|today|now|current|latest)\b|\b(?:price|quote|value|rate)\b.{0,28}\b(?:stock|share|crypto|bitcoin|ethereum)\b|\b(?:price of|exchange rate)\b/i;
const INSTANT_BUSINESS_ACTION = /\b(?:build|create|draft|write|fix|debug|code|implement|research|plan|strategize|design|make|generate|schedule|automate|review|open|capture|add|import|log|record|convert|book|assign|update|track|sync|move|put)\s+(?:me\s+|us\s+|them\s+|these\s+|those\s+)?(?:(?:an?|the|my|our|this|these|those|some|all|every)\s+)?(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a couple(?: of)?|a few|several|many)\s+)?(?:new\s+)?(?:proposals?|websites?|sites?|automations?|tasks?|clients?|customers?|leads?|contacts?|prospects?|deals?|bookings?|transactions?|accounting|invoices?|payments?|crm|security scans?|contracts?|tenants?|organizations?|phantomforce)\b|\b(?:generate|create|edit|enhance|upload|publish|remove (?:the )?background)\s+(?:an?|the|my|our|this)?\s*(?:content|video|image|media)\b/i;
const INSTANT_EXTERNAL_ACTION = /(?:^|\b(?:please|can you|could you|would you|will you|i need you to|go ahead and)\s+)(?:deploy|delete|send|post|upload|publish)\b/i;
const INSTANT_PRIVATE_BUSINESS = /\b(?:my|our|this)\s+(?:business|company|workspace|proposals?|websites?|sites?|automations?|tasks?|clients?|customers?|leads?|contacts?|prospects?|deals?|bookings?|transactions?|accounting|bank(?: accounts?)?|invoices?|payments?|security|contracts?|tenants?|organizations?|crm|pipeline)\b/i;
const INSTANT_DEEP_REASONING = /\b(?:strategy|strategic|think through|reason through|roadmap|business model|moat|positioning|prioriti[sz]e|critique)\b|\bcompare(?!\s+(?:them|these|those|it)\b)/i;
const ADVISORY_PRIVATE_BUSINESS = /\b(?:my|our|this|the)\s+(?:[a-z]+\s+){0,2}(?:business|company|workspace|brand|proposal|website|site|pipeline|crm|client|customer|lead|accounting|content|campaign|calendar|project|team|offer|product|service|organization)\b/i;

const MODULE_RELEVANCE: Record<string, RegExp> = {
  money: /\b(?:money|cash|bank|card|transaction|accounting|ledger|invoice|payment|revenue|expense|profit|budget|tax|proposal|quote)\b/i,
  today_plan: /\b(?:plan|planner|schedule|calendar|task|project|goal|priority|deadline|due|today|tomorrow|week)\b/i,
  asset_library: /\b(?:asset|image|video|media|logo|brand|content|creative|file)\b/i,
  workspace_pulse: BUSINESS_TERMS,
};

function hasLexicalOverlap(module: ConversationContextModule, userRequest: string) {
  const requestTerms = new Set(userRequest.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  if (!requestTerms.size) return false;
  const moduleText = `${module.summary} ${(module.items || []).map((item) => `${item.title} ${item.status || ""} ${item.detail || ""}`).join(" ")}`;
  const moduleTerms = new Set(moduleText.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  return [...requestTerms].some((term) => moduleTerms.has(term));
}

export function needsBusinessContext(userRequest: string, taskType = "") {
  return BUSINESS_TASKS.has(taskType) || BUSINESS_TERMS.test(userRequest);
}

export function isSafeInstantConversationRequest(input: { task_type: string; user_request: string }) {
  const text = input.user_request.trim();
  if (!INSTANT_TASKS.has(input.task_type)) return false;
  if (!text || text.length > 600 || text.split(/\s+/).filter(Boolean).length > 90) return false;
  return !INSTANT_ALWAYS_BLOCKED.test(text)
    && !INSTANT_BUSINESS_ACTION.test(text)
    && !INSTANT_EXTERNAL_ACTION.test(text)
    && !INSTANT_PRIVATE_BUSINESS.test(text)
    && !INSTANT_DEEP_REASONING.test(text);
}

export function isSafeReasoningConversationRequest(input: { task_type: string; user_request: string }) {
  const text = input.user_request.trim();
  if (!REASONING_TASKS.has(input.task_type)) return false;
  if (!text || text.length > 1200 || text.split(/\s+/).filter(Boolean).length > 180) return false;
  return (INSTANT_DEEP_REASONING.test(text) || ADVISORY_TASKS.has(input.task_type))
    && !ADVISORY_PRIVATE_BUSINESS.test(text)
    && !INSTANT_ALWAYS_BLOCKED.test(text)
    && !INSTANT_BUSINESS_ACTION.test(text)
    && !INSTANT_EXTERNAL_ACTION.test(text)
    && !INSTANT_PRIVATE_BUSINESS.test(text);
}

export function isSafeAdvisoryConversationRequest(input: { task_type: string; user_request: string }) {
  const text = input.user_request.trim();
  if (!ADVISORY_TASKS.has(input.task_type) || !ADVISORY_PRIVATE_BUSINESS.test(text)) return false;
  if (!text || text.length > 1200 || text.split(/\s+/).filter(Boolean).length > 180) return false;
  return !INSTANT_ALWAYS_BLOCKED.test(text)
    && !INSTANT_BUSINESS_ACTION.test(text)
    && !INSTANT_EXTERNAL_ACTION.test(text);
}

/* Mission-worthy heuristic --------------------------------------------
   Detects a request that reads as real, multi-step, agentic execution work
   (build/implement/refactor something substantial, run it "in parallel",
   spin up workers, explicit Termina phrasing) as opposed to a question, a
   request for advice, or a request for a plan only. This heuristic is used
   ONLY to decide whether the chat handler should ASK "want this as a
   background mission?" — it is never consulted when actually starting a
   mission (that path requires a separate, explicit approval regardless of
   how the run was proposed). A false positive here costs nothing but an
   extra question, so it can stay generous; it does not need to be
   adversarially robust the way an execution gate would.

   `task_type` classification for the *client's own message* already happens
   upstream, in the browser (app/js/intent-router.js), which recognizes
   explicit Termina phrasing ("split this across workers", "run planner /
   builder / reviewer", …) as `termina_parallel`, and safe read-only agent
   runs as `run_agent`. Since task_type arrives here as caller-supplied
   input, it is treated as a hint, not authoritative — this function also
   re-checks the raw text server-side with its own regex so the ask-to-
   mission behavior does not depend entirely on trusting the client. */
const EXPLICIT_MISSION_PHRASING =
  /\b(?:open (?:this |that |it )?in termina|send (?:this|that|it) to termina|run (?:this|that|it) (?:as|through) a (?:background )?mission|split (?:this|that|it) across (?:multiple )?(?:agents|workers)|spin up (?:multiple )?(?:agents|workers)|create parallel workers?|dispatch (?:a |the )?mission|run planner[\s,/&-]*builder[\s,/&-]*reviewer)\b/i;
const MISSION_HINT_TASK_TYPES = new Set(["termina_parallel"]);

export function isMissionWorthyRequest(input: { task_type: string; user_request: string }) {
  const text = input.user_request.trim();
  if (!text) return false;
  if (MISSION_HINT_TASK_TYPES.has(input.task_type)) return true;
  return EXPLICIT_MISSION_PHRASING.test(text);
}

/* The one phrase-set allowed to move a mission from "proposed" to
   "approved" via chat. Deliberately narrow and anchored — mirrors this
   codebase's own VACATION_CONFIRM pattern (app/js/intent-router.js) for a
   similarly irreversible, real-world action: exact short affirmations only,
   never a loose substring match, so a longer message that happens to
   contain the word "yes" cannot be misread as a confirmation. Same as
   VACATION_CONFIRM's own `yes[, ]+confirm`, an optional leading "yes"
   joined by a comma/space is allowed before the core phrase, so the
   extremely common natural phrasing "yes, run it" (with the comma real
   users actually type) is recognized -- without that, a real confirmation
   would silently fail to match and fall through to a normal, non-mission
   chat answer instead of confirming, which is worse for safety than
   recognizing it: a would-be-confirmed mission stays stuck.

   this remains just as narrow as before: the ENTIRE trimmed message must
   still be nothing but this optional prefix plus exactly one recognized
   short phrase, plus optional trailing punctuation -- still no bare
   substring matching, still rejects any longer sentence. */
const EXPLICIT_MISSION_CONFIRMATION =
  /^(?:yes[, ]+)?(?:yes|yep|yeah|y|confirm|confirmed|approve|approved|do it|go ahead|run it|dispatch it|start it|launch it)[\s.!]*$/i;

export function isExplicitMissionConfirmation(text: string) {
  return EXPLICIT_MISSION_CONFIRMATION.test(text.trim());
}

export function filterConversationModules<T extends ConversationContextModule>(
  modules: T[],
  userRequest: string,
  taskType = "",
) {
  const businessRelevant = needsBusinessContext(userRequest, taskType);
  return modules.filter((entry) => {
    if (entry.module === "recent_conversation") return true;
    if (!businessRelevant) return false;
    if (entry.module === "saved_memory") {
      return /\b(?:remember|memory|preference|rule|always|never|previous business|last project)\b/i.test(userRequest)
        || hasLexicalOverlap(entry, userRequest);
    }
    const relevance = MODULE_RELEVANCE[entry.module];
    return relevance ? relevance.test(userRequest) : entry.module === "active_business";
  });
}
