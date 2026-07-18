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
const INSTANT_BLOCKLIST = /\b(?:debug|code|research|strategy|proposal|website|site|content|video|image|media|schedule|automation|task|client|customer|lead|transaction|accounting|bank|invoice|payment|security|deploy|send|post|upload|delete|weather|forecast|current|latest|stock|law|legal|medical|diagnosis|contract|tenant|isolation|phantomforce)\b|\bprice\s+of\b/i;

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
  return !INSTANT_BLOCKLIST.test(text);
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
