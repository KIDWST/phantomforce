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
const INSTANT_ALWAYS_BLOCKED = /\b(?:diagnos(?:e|is)|medical advice|legal advice)\b|\b(?:what(?:'s| is)|how(?:'s| is)|check|show me|give me)\b.{0,28}\b(?:weather|forecast|temperature|humidity)\b|\b(?:weather|forecast|temperature|humidity)\b.{0,28}\b(?:today|tonight|tomorrow|now|current|latest|outside|near me|in\s+[a-z])\b|\b(?:latest|current|today'?s?|breaking|live)\b.{0,28}\b(?:news|headlines?|score|result|traffic|price|quote|exchange rate|weather|forecast)\b|\b(?:news|headlines?|score|result|traffic)\b.{0,28}\b(?:latest|current|today|tonight|now|live|last night)\b|\b(?:stock|share|crypto|bitcoin|ethereum)\b.{0,28}\b(?:price|quote|value|rate|today|now|current|latest)\b|\b(?:price|quote|value|rate)\b.{0,28}\b(?:stock|share|crypto|bitcoin|ethereum)\b|\b(?:price of|exchange rate)\b/i;
const INSTANT_BUSINESS_ACTION = /\b(?:build|create|draft|write|fix|debug|code|implement|research|plan|strategize|design|make|generate|schedule|automate|review|open)\s+(?:me\s+|us\s+)?(?:(?:an?|the|my|our|this)\s+)?(?:proposal|website|site|automation|task|client|customer|lead|transaction|accounting|invoice|payment|security scan|contract|tenant|organization|phantomforce)\b|\b(?:generate|create|edit|enhance|upload|publish|remove (?:the )?background)\s+(?:an?|the|my|our|this)?\s*(?:content|video|image|media)\b/i;
const INSTANT_EXTERNAL_ACTION = /(?:^|\b(?:please|can you|could you|would you|will you|i need you to|go ahead and)\s+)(?:deploy|delete|send|post|upload|publish)\b/i;
const INSTANT_PRIVATE_BUSINESS = /\b(?:my|our|this)\s+(?:business|company|workspace|proposal|website|site|automation|task|client|customer|lead|transaction|accounting|bank(?: account)?|invoice|payment|security|contract|tenant|organization)\b/i;
const INSTANT_DEEP_REASONING = /\b(?:strategy|strategic|think through|reason through|roadmap|business model|moat|positioning|prioriti[sz]e|critique)\b|\bcompare(?!\s+(?:them|these|those|it)\b)/i;

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
  if (!INSTANT_TASKS.has(input.task_type)) return false;
  if (!text || text.length > 1200 || text.split(/\s+/).filter(Boolean).length > 180) return false;
  return INSTANT_DEEP_REASONING.test(text)
    && !INSTANT_ALWAYS_BLOCKED.test(text)
    && !INSTANT_BUSINESS_ACTION.test(text)
    && !INSTANT_EXTERNAL_ACTION.test(text)
    && !INSTANT_PRIVATE_BUSINESS.test(text);
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
