/* PhantomForce intent router.
   Everything router: classify first, then answer, route, draft, create, recall,
   or ask for the missing lane. Records are created only on explicit action. */

const clean = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => clean(value).toLowerCase();

const EXPLICIT_TASK = /\b(create|add|make|assign|track|put|save|log)\s+(a\s+)?(task|todo|to-do|work item)\b|\b(make|add|put|save|track)\s+(this|that|it).{0,30}\b(task list|todo|to-do|tasks?)\b|\bmake\s+(this|that|it)\s+a\s+(todo|to-do|task)\b|\bassign\s+codex\s+a\s+task\b|\btrack this as\b/i;
const TASK_CANDIDATE = /\b(needs?|should|someone should|we need to|have to|must)\s+(to\s+)?(fix|fixing|update|change|improve|make|clean|polish|repair|redo|adjust|better)\b|\bneeds?\s+(better|fixing|spacing|polish|cleanup|work)\b|\bmake\s+.{2,80}\s+better\b|\b(is|looks|feels)\s+(broken|off|bad|ugly|wrong|annoying|confusing)\b/i;
const BRAINSTORM = /\b(we should|maybe|what if|it would be cool|i think|i want|could we|should we)\b/i;
const QUESTION = /\?|\b(what|why|how|when|where|who|can|could|should|would|is|are|do|does|did)\b/i;
const GREETING = /^(hey|hi|hello|yo|sup|gm|gn|good morning|good afternoon|good evening|what'?s up|wassup|you there|u there|ping|test)[\s.!?]*$/i;
const GRATITUDE = /^(thanks|thank you|appreciate it|bet|cool|nice|ok|okay|got it|perfect)[\s.!?]*$/i;
const IDENTITY = /\b(who are you|what are you|are you phantom|what is phantom|what is phantomforce ai|what's your job)\b/i;
const CAPABILITY = /\b(what can you do|how can you help|what are you able to do|what can phantom do|what can phantomforce do)\b/i;
const FEEDBACK = /\b(i hate|i don't like|this sucks|looks awful|looks bad|annoying|frustrating|disappointed|not what i wanted|too robotic|too cluttered)\b/i;
const PLAN = /\b(make|create|give|draft|build)\s+(me\s+)?(a\s+)?(plan|roadmap|breakdown|strategy)|\b(break this down|roadmap this|plan this|help me plan)\b/i;
const REMINDER = /\b(remind me|reminder|check this every|every morning|every day|daily|weekly|monitor|tell me when|watch this)\b/i;
const AUTOMATION = /\b(automation|automate|workflow|autopilot|recurring|auto[- ]?follow|auto[- ]?post)\b/i;
const APPROVAL = /\b(approve|approval|sign off|waiting on me|pending|review queue|needs my call)\b/i;
const MEMORY = /\b(remember|save this memory|make sure you remember|from now on|always remember|forget this)\b/i;
const STATUS = /\b(status|catch me up|what's next|what is next|today|pipeline|queue|summary|report)\b/i;
/* live-world facts: these are QUESTIONS to answer (or route to a live brain),
   never tasks, plans, or board summaries — "what's the weather today" must
   not be hijacked by the \btoday\b status keyword */
const CURRENT_INFO = /\b(weather|forecast|temperature|rain|snow|humidity|news|headlines?|stock|crypto|bitcoin|price of|exchange rate|score|game (last night|today|tonight)|traffic|time (is it|in)\b|what day is|sports)\b/i;
const LOOPER = /\b(start\s+(phantom\s+loop|loopus|looper)|phantom\s+loop|loopus|looper|build me|build a|create a campaign|make an intake form|create an intake form|turn this into a build plan|build plan|landing page|website build|site build|proposal|campaign|crm workflow|booking flow|dashboard idea|website copy)\b/i;
const EXPLICIT_ARTIFACT = /\b(create|draft|build|make|prepare|write|new)\b/i;

function confidenceFor(kind, text) {
  if (kind === "unknown") return 0.35;
  if (EXPLICIT_TASK.test(text) || /start\s+(phantom\s+loop|loopus|looper)|remind me|check this every/i.test(text)) return 0.92;
  if (TASK_CANDIDATE.test(text) || BRAINSTORM.test(text)) return 0.74;
  return 0.82;
}

function taskDraft(text) {
  const title = clean(text)
    .replace(/^.*?\b(task|todo|to-do|work item)\s*(to|:)?\s*/i, "")
    .replace(/^assign\s+codex\s+a\s+task\s+(to|for)?\s*/i, "")
    .replace(/^track this as\s+/i, "")
    .trim();
  return {
    title: (title || "New task").slice(0, 90),
    detail: clean(text).slice(0, 260),
    source: "phantom-intent-router",
  };
}

function automationDraft(text) {
  return {
    title: clean(text).replace(/\b(create|make|set up|setup|add|an?|automation|workflow)\b/gi, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "New automation",
    detail: clean(text).slice(0, 260),
    source: "phantom-intent-router",
  };
}

function looperDraft(text) {
  return {
    goal: clean(text).slice(0, 220),
    output: /proposal/i.test(text) ? "proposal draft" :
      /campaign|content/i.test(text) ? "campaign plan" :
      /intake|form/i.test(text) ? "intake form spec" :
      /crm|workflow/i.test(text) ? "workflow spec" :
      /landing|website|site|page/i.test(text) ? "page build packet" :
      "build plan",
    source: "phantom-intent-router",
  };
}

export function classifyPhantomIntent(raw = "") {
  const text = clean(raw);
  const s = lower(text);
  const result = {
    primaryIntent: "unknown",
    confidence: 0.35,
    shouldCreateTask: false,
    shouldCreateAutomation: false,
    shouldStartLooper: false,
    needsLiveData: false,
    shouldAskClarifyingQuestion: false,
    requiresUserConfirmation: false,
    requiresAdminApproval: false,
    reasonCode: "unknown",
    taskDraft: null,
    automationDraft: null,
    looperDraft: null,
  };

  if (!text) return { ...result, primaryIntent: "chat", confidence: 0.9, reasonCode: "empty_chat" };

  if (GREETING.test(text)) {
    return { ...result, primaryIntent: "greeting", confidence: 0.96, reasonCode: "simple_greeting" };
  }
  if (GRATITUDE.test(text)) {
    return { ...result, primaryIntent: "gratitude", confidence: 0.94, reasonCode: "simple_gratitude" };
  }
  if (IDENTITY.test(text)) {
    return { ...result, primaryIntent: "identity", confidence: 0.9, reasonCode: "identity_question" };
  }
  if (CAPABILITY.test(text)) {
    return { ...result, primaryIntent: "capability", confidence: 0.9, reasonCode: "capability_question" };
  }
  if (MEMORY.test(text)) {
    return { ...result, primaryIntent: "memory_update", confidence: confidenceFor("memory_update", text), reasonCode: "memory_keyword" };
  }
  if (APPROVAL.test(text)) {
    return { ...result, primaryIntent: "approval_request", confidence: confidenceFor("approval_request", text), reasonCode: "approval_keyword" };
  }
  if (EXPLICIT_TASK.test(text)) {
    return {
      ...result,
      primaryIntent: "create_task",
      confidence: confidenceFor("create_task", text),
      shouldCreateTask: true,
      requiresUserConfirmation: false,
      reasonCode: "explicit_task_request",
      taskDraft: taskDraft(text),
    };
  }
  if (REMINDER.test(text)) {
    return {
      ...result,
      primaryIntent: "reminder",
      confidence: confidenceFor("reminder", text),
      shouldCreateAutomation: true,
      shouldAskClarifyingQuestion: !/\b(tomorrow|today|daily|weekly|every|morning|evening|at\s+\d)/i.test(text),
      requiresUserConfirmation: true,
      requiresAdminApproval: true,
      reasonCode: "reminder_or_monitor_request",
      automationDraft: automationDraft(text),
    };
  }
  if (AUTOMATION.test(text) && EXPLICIT_ARTIFACT.test(text)) {
    return {
      ...result,
      primaryIntent: "create_automation",
      confidence: confidenceFor("create_automation", text),
      shouldCreateAutomation: true,
      requiresAdminApproval: true,
      reasonCode: "explicit_automation_request",
      automationDraft: automationDraft(text),
    };
  }
  if (LOOPER.test(text) && (EXPLICIT_ARTIFACT.test(text) || /\b(start\s+(phantom\s+loop|loopus|looper)|phantom\s+loop|loopus)\b/i.test(text)) && !QUESTION.test(text)) {
    return {
      ...result,
      primaryIntent: "looper_build",
      confidence: confidenceFor("looper_build", text),
      shouldStartLooper: true,
      reasonCode: "explicit_build_request",
      looperDraft: looperDraft(text),
    };
  }
  if (CURRENT_INFO.test(text)) {
    /* checked after task/reminder/automation so "remind me to check the
       weather every morning" still becomes an automation — but a bare
       "what's the weather today?" is a live question, full stop */
    return { ...result, primaryIntent: "question", needsLiveData: true, confidence: 0.9, reasonCode: "live_data_question" };
  }
  if (PLAN.test(text)) {
    return { ...result, primaryIntent: "plan", confidence: confidenceFor("plan", text), reasonCode: "planning_request" };
  }
  if (FEEDBACK.test(text)) {
    return {
      ...result,
      primaryIntent: "feedback",
      confidence: confidenceFor("feedback", text),
      shouldAskClarifyingQuestion: TASK_CANDIDATE.test(text),
      requiresUserConfirmation: TASK_CANDIDATE.test(text),
      reasonCode: "feedback_not_task",
      taskDraft: TASK_CANDIDATE.test(text) ? taskDraft(text) : null,
    };
  }
  if (BRAINSTORM.test(text)) {
    return {
      ...result,
      primaryIntent: "brainstorm",
      confidence: confidenceFor("brainstorm", text),
      shouldAskClarifyingQuestion: false,
      reasonCode: "soft_brainstorm_language",
    };
  }
  if (TASK_CANDIDATE.test(text)) {
    return {
      ...result,
      primaryIntent: "task_candidate",
      confidence: confidenceFor("task_candidate", text),
      shouldAskClarifyingQuestion: true,
      requiresUserConfirmation: true,
      reasonCode: "task_candidate_without_create_verb",
      taskDraft: taskDraft(text),
    };
  }
  if (STATUS.test(text)) {
    return { ...result, primaryIntent: "status_check", confidence: confidenceFor("status_check", text), reasonCode: "status_keyword" };
  }
  if (QUESTION.test(text)) {
    return { ...result, primaryIntent: "question", confidence: confidenceFor("question", text), reasonCode: "question_not_action" };
  }
  if (AUTOMATION.test(text)) {
    return {
      ...result,
      primaryIntent: "automation_candidate",
      confidence: confidenceFor("automation_candidate", text),
      requiresUserConfirmation: true,
      reasonCode: "automation_without_create_verb",
      automationDraft: automationDraft(text),
    };
  }
  if (/handoff|operator|codex|claude|internal/i.test(text)) {
    return { ...result, primaryIntent: "internal_operator_handoff", confidence: 0.76, reasonCode: "operator_keyword" };
  }

  return { ...result, primaryIntent: "chat", confidence: 0.76, reasonCode: "default_chat" };
}
