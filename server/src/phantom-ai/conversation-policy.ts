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
