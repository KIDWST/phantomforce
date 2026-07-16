/* PhantomForce intent router.
   Classifies a message before Phantom answers it. Records (tasks,
   automations, drafts) are only created on explicit action language —
   casual chat and questions never create anything. */

const clean = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => clean(value).toLowerCase();

const EXPLICIT_TASK = /\b(create|add|make|assign|track|put|save|log)\s+(a\s+)?(task|todo|to-do|work item)\b|\b(make|add|put|save|track)\s+(this|that|it).{0,30}\b(task list|todo|to-do|tasks?)\b|\bmake\s+(this|that|it)\s+a\s+(todo|to-do|task)\b|\bturn\s+(this|that|it)\s+into\s+a\s+(task|todo|to-do)\b|\bassign\s+codex\s+a\s+task\b|\btrack this as\b/i;
const TASK_CANDIDATE = /\b(needs?|should|someone should|we need to|have to|must)\s+(to\s+)?(fix|fixing|update|change|improve|make|clean|polish|repair|redo|adjust|better)\b|\bneeds?\s+(better|fixing|spacing|polish|cleanup|work)\b|\bmake\s+.{2,80}\s+better\b|\b(is|looks|feels)\s+(broken|off|bad|ugly|wrong|annoying|confusing)\b/i;
const BRAINSTORM = /\b(we should|maybe|what if|it would be cool|i think|i want|could we|should we)\b/i;
const QUESTION = /\?|\b(what|why|how|when|where|who|can|could|should|would|is|are|do|does|did)\b/i;
const GREETING = /^(hey|hi|hello|yo|sup|gm|gn|good morning|good afternoon|good evening|what'?s up|wassup|you there|u there|ping|test)(\s+there)?([,\s]+(phantom(force)?|ghost|buddy|man|dude))?[\s.!?]*$/i;
const GRATITUDE = /^(thanks|thank you|appreciate it|bet|cool|nice|ok|okay|got it|perfect)[\s.!?]*$/i;
const IDENTITY = /\b(who are you|what are you|are you phantom|what is phantom|what'?s phantom|what is phantomforce|what'?s phantomforce|what is phantomforce ai|what'?s your job)\b/i;
const CAPABILITY = /\b(what can you do|how can you help|what are you able to do|what can phantom do|what can phantomforce do|how smart are you|are you smart|how (good|capable|powerful) are you|what makes you (smart|good|different)|how do you compare)\b/i;
const FEEDBACK = /\b(i hate|i don't like|this sucks|looks awful|looks bad|annoying|frustrating|disappointed|not what i wanted|too robotic|too cluttered)\b/i;
const PLAN = /\b(make|create|give|draft|build)\s+(me\s+)?(a\s+)?(plan|roadmap|breakdown|strategy)|\b(break this down|roadmap this|plan this|help me plan)\b/i;
const REMINDER = /\b(remind me|reminder|schedule (this|that|it)\b|check this every|every morning|every day|daily|weekly|monitor|tell me when|watch this)\b/i;
const AUTOMATION = /\b(automation|automate|workflow|autopilot|recurring|auto[- ]?follow|auto[- ]?post)\b/i;
const APPROVAL = /\b(approve|approval|sign off|waiting on me|pending|review queue|needs my call)\b/i;
const MEMORY = /\b(remember|save this memory|make sure you remember|from now on|always remember|forget this)\b/i;
/* "today" alone is NOT a status request — "I'm overwhelmed by everything
   today" is a person talking, not a report query. Only real status phrasing
   counts. */
const STATUS = /\b(status|catch me up|what'?s next|what is next|today'?s plan|plan for today|pipeline|queue|summary|report)\b/i;
/* the user is venting, not filing a request — answer like a person */
const VENT = /\b(i'?m|i am|im|feeling|been)\s+(so\s+|really\s+|pretty\s+)?(overwhelmed|stressed|burn(ed|t)?[\s-]*out|exhausted|drowning|swamped|frustrated|anxious|behind on everything)\b|\btoo much (going on|on my plate)\b|\blong (day|week)\b/i;
/* server agent runs — explicit "run a …" phrasing for the real, safe
   read-only operations the backend exposes (states + proof + artifact) */
const AGENT_RUN = /\brun\s+(a\s+|an\s+|the\s+)?(business\s+snapshot|snapshot\s+report|operational\s+snapshot|provider\s+health\s*(check)?|ai\s+health\s*(check)?|system\s+health\s*(check)?)\b/i;
/* live-world facts: these are QUESTIONS to answer (or route to a live brain),
   never tasks, plans, or board summaries — "what's the weather today" must
   not be hijacked by the \btoday\b status keyword */
const CURRENT_INFO = /\b(weather|forecast|temperature|rain|snow|humidity|news|headlines?|stock|crypto|bitcoin|price of|exchange rate|score|game (last night|today|tonight)|traffic|time (is it|in)\b|what day is|sports)\b/i;
/* Phantom Loop — a CHAT ROUTING toggle only (route this reply through another
   model, then bring the answer back). It is never a build packet, task, plan,
   or Site Studio action — explicit enable/disable phrasing only. */
const LOOP_ENABLE = /\b(start|enable|turn on|activate)\s+(phantom\s+loop|loopus|looper)\b|\bphantom\s+loop\s+on\b|\bloop\s+this\s+(through|with)\b|\broute\s+this\s+through\b/i;
const LOOP_DISABLE = /\b(stop|disable|turn off|deactivate)\s+(phantom\s+loop|loopus|looper)\b|\bphantom\s+loop\s+off\b/i;
/* looper packets now own only NON-website builds — website/site/landing/
   booking-page requests are real Websites projects (create_website below)
   and never become packets. */
const LOOPER_BUILD = /\b(start\s+(phantom\s+loop|loopus|looper)\s+for\s+.+|build\s+me\s+(a|an)\s+.+|create\s+(a|an)\s+(campaign|intake form|dashboard|portal|funnel)|make\s+(a|an)\s+(intake form|dashboard|portal|funnel)|turn\s+this\s+into\s+a\s+build\s+plan)\b/i;
const BUILD_TARGET = /\b(campaign|intake form|build plan|dashboard|portal|funnel)\b/i;
/* Websites are a REAL product surface (store.state.sites + the Websites
   page), not a guarded build packet. Any explicit "make/build/create a
   website/site/landing page [for X]" — including "build me a…" — creates
   the same record the Websites page edits, so chat and the builder are two
   doors into one project. Checked BEFORE looper_build so site requests
   never fall into the packet lane. */
const WEBSITE_CREATE = /\b(build|create|make|draft|design|spin up|start)\s+(me\s+|us\s+)?(a|an|another|new)\s+[^.?!]{0,40}?\b(website|web ?site|site|landing page|web ?page|home ?page|store ?front|online store)\b/i;
/* editing an existing site from chat: explicit site nouns + change verbs */
const WEBSITE_UPDATE = /\b(update|change|edit|redo|rework|improve|adjust|tweak|refresh)\b[^.?!]{0,40}\b(website|site|landing page|home ?page|hero|headline)\b|\bmake\s+(the\s+)?(site|website|hero|headline|page)\b[^.?!]{0,50}\b(premium|simpler|cleaner|shorter|better|blue|red|gold|purple|green|neon)\b|\b(site|website)\b[^.?!]{0,40}\b(more premium|cleaner|simpler)\b/i;
const EXPLICIT_ARTIFACT = /\b(create|draft|build|make|prepare|write|new)\b/i;
/* Termina (multi-agent command wall) — EXPLICIT phrasing only. A bare mention
   of "termina" in a question stays conversation. */
const TERMINA = /\b(open (this |that |it )?in termina|send (this|that|it) to termina|split (this|that|it) across (multiple )?(agents|workers)|run planner[\s,\/&-]*builder[\s,\/&-]*reviewer|create parallel workers?\b)/i;
/* Vacation Mode (bounded autonomous work) — EXPLICIT phrasing only. "what if
   we had vacation mode?" is a brainstorm, never a launch. */
const VACATION = /\b(start vacation mode|enable vacation mode|keep working while i'?m (gone|away|out)|run (this|these|it) while i'?m (gone|away)|let the agents (keep working|continue|keep going)|work autonomously on (this|these|the|my)|continue (this|working) for .{1,24}(hours?|minutes?) and report)\b/i;
const VACATION_CONFIRM = /^(confirm|yes[, ]+confirm|arm) vacation mode[\s.!]*$/i;
/* Risky/external execution verbs — these NEVER execute from chat. They go to
   the Approval Queue: publish, send, deploy, spend, final render, delete. */
const RISKY_ACTION = /\b(publish|post|deploy|ship|send)\s+(it|this|that|them|the\b|now)\b|\bsend the (email|invoice|proposal|campaign)\b|\bspend (the |my )?credits?\b|\brender (the )?final\b|\bconnect (the |my )?(account|bank|stripe|instagram|google)\b|\bchange (the )?billing\b|\bdelete (this|that|it|the|my)\b|\bcharge (the|my|his|her|their)\b/i;

function confidenceFor(kind, text) {
  if (kind === "unknown") return 0.35;
  if (EXPLICIT_TASK.test(text) || /remind me|check this every/i.test(text)) return 0.92;
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

function loopTargetIsOnlyGreeting(text) {
  const m = clean(text).match(/\bstart\s+(phantom\s+loop|loopus|looper)\s+for\s+(.+)$/i);
  return !!(m && GREETING.test(m[2]));
}

export function classifyPhantomIntent(raw = "") {
  const text = clean(raw);
  const s = lower(text);
  const result = {
    primaryIntent: "unknown",
    confidence: 0.35,
    /* conservative defaults: NOTHING autonomous happens unless the user
       explicitly asked for it — normal chat must stay normal */
    shouldCreateTask: false,
    shouldCreateAutomation: false,
    shouldEnableLoop: false,
    shouldDisableLoop: false,
    shouldStartLooper: false,
    shouldOpenTermina: false,
    shouldStartVacationMode: false,
    needsLiveData: false,
    shouldAskClarifyingQuestion: false,
    requiresUserConfirmation: false,
    requiresAdminApproval: false,
    reasonCode: "unknown",
    taskDraft: null,
    automationDraft: null,
  };

  if (!text) return { ...result, primaryIntent: "chat", confidence: 0.9, reasonCode: "empty_chat" };

  /* Website work routes to the real Websites surface first — one project,
     two doors (chat + builder). "Can you / could you / please" is a polite
     command, not a question; real questions ("how do I make a website?")
     stay questions. */
  const politeStripped = text.replace(/^(hey\s+|ok\s+|yo\s+)?(phantom[,\s]+)?(can|could|will|would)\s+you\s+(please\s+)?|^please\s+/i, "");
  const isHowWhatQuestion = /^(how|what|why|when|where|who|should|do|does|did|is|are)\b/i.test(politeStripped);
  if (WEBSITE_CREATE.test(politeStripped) && !isHowWhatQuestion) {
    return { ...result, primaryIntent: "create_website", confidence: 0.93, reasonCode: "explicit_website_create" };
  }
  if (WEBSITE_UPDATE.test(politeStripped) && !isHowWhatQuestion) {
    return { ...result, primaryIntent: "website_update", confidence: 0.86, reasonCode: "explicit_website_update" };
  }

  /* Server agent runs — explicit "run a …" phrasing only. These map to the
     real read-only operations Hermes exposes; nothing else in chat is allowed
     to claim an agent is "running". */
  if (AGENT_RUN.test(politeStripped) && !isHowWhatQuestion) {
    const wantsProviderHealth = /\b(provider|ai|system)\s+health\b/i.test(politeStripped);
    return {
      ...result,
      primaryIntent: "run_agent",
      confidence: 0.9,
      reasonCode: "explicit_agent_run",
      agentOperation: wantsProviderHealth ? "provider_health" : "business_snapshot",
    };
  }

  /* Phantom Loop is a chat-routing toggle, checked before greeting/gratitude
     so "turn off phantom loop" isn't swallowed, but it never fires on plain
     conversation — only this exact enable/disable phrasing. "How do I make a
     campaign?" is a question, never a build packet. */
  if (LOOPER_BUILD.test(politeStripped) && BUILD_TARGET.test(text) && !loopTargetIsOnlyGreeting(text) && !isHowWhatQuestion) {
    return { ...result, primaryIntent: "looper_build", confidence: 0.91, shouldStartLooper: true, reasonCode: "explicit_looper_build_request" };
  }
  if (loopTargetIsOnlyGreeting(text)) {
    return { ...result, primaryIntent: "greeting", confidence: 0.9, reasonCode: "loop_target_greeting_only" };
  }
  if (LOOP_ENABLE.test(text)) {
    return { ...result, primaryIntent: "phantom_loop_on", confidence: 0.95, shouldEnableLoop: true, shouldStartLooper: true, reasonCode: "explicit_loop_enable" };
  }
  if (LOOP_DISABLE.test(text)) {
    return { ...result, primaryIntent: "phantom_loop_off", confidence: 0.95, shouldDisableLoop: true, reasonCode: "explicit_loop_disable" };
  }

  if (GREETING.test(text)) {
    return { ...result, primaryIntent: "greeting", confidence: 0.96, reasonCode: "simple_greeting" };
  }
  if (GRATITUDE.test(text)) {
    return { ...result, primaryIntent: "gratitude", confidence: 0.94, reasonCode: "simple_gratitude" };
  }
  if (VENT.test(text) && !EXPLICIT_TASK.test(text)) {
    /* a person under pressure gets a person back — never a status dump,
       never an auto-generated task list */
    return { ...result, primaryIntent: "vent", confidence: 0.88, reasonCode: "user_is_venting" };
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
  if (RISKY_ACTION.test(text) && !EXPLICIT_TASK.test(text) && !REMINDER.test(text)) {
    /* direct execution commands with external consequences never run from
       chat — but "create a task to send the invoice" is still just a task */
    return {
      ...result,
      primaryIntent: "approval_request",
      confidence: 0.9,
      requiresAdminApproval: true,
      requiresUserConfirmation: true,
      reasonCode: "risky_action_requires_approval",
    };
  }
  if (APPROVAL.test(text)) {
    return { ...result, primaryIntent: "approval_request", confidence: confidenceFor("approval_request", text), reasonCode: "approval_keyword" };
  }
  if (VACATION_CONFIRM.test(text)) {
    return {
      ...result,
      primaryIntent: "vacation_mode",
      confidence: 0.95,
      shouldStartVacationMode: true,
      requiresUserConfirmation: false,
      requiresAdminApproval: true,
      reasonCode: "vacation_mode_confirmed",
    };
  }
  if (VACATION.test(text) && !QUESTION.test(text) && !BRAINSTORM.test(text)) {
    return {
      ...result,
      primaryIntent: "vacation_mode",
      confidence: 0.88,
      shouldStartVacationMode: false,      // armed only after explicit confirmation
      requiresUserConfirmation: true,
      requiresAdminApproval: true,
      reasonCode: "vacation_mode_requested_needs_confirmation",
    };
  }
  if (TERMINA.test(text)) {
    return {
      ...result,
      primaryIntent: "termina_parallel",
      confidence: 0.88,
      shouldOpenTermina: true,
      reasonCode: "explicit_termina_request",
    };
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
  if (/\b(handoff|operator|codex|claude|glm|qwen|ollama|openrouter|local model|backend)\b/i.test(text)
    || (/\b(connection|disconnected|offline|down|fallback)\b/i.test(text) && /\b(ai|model|brain|hermes|phantom|codex|claude|glm|qwen|backend|server)\b/i.test(text))) {
    return { ...result, primaryIntent: "internal_operator_handoff", confidence: 0.76, reasonCode: "operator_keyword" };
  }

  return { ...result, primaryIntent: "chat", confidence: 0.76, reasonCode: "default_chat" };
}

/* ============================================================================
   ACTION CONTRACT — the shape every caller should actually use.
   Phantom AI is an operator, not a debug router: casual chat/questions/
   brainstorming stay conversational (no task, no card, no router language);
   commands/workflows/approvals are the only lanes allowed to surface a card
   or create a record. Wrap every classifyPhantomIntent() call site with
   this before building a response. */
const LANE_BY_INTENT = {
  greeting: "conversation", gratitude: "conversation", chat: "conversation", unknown: "conversation",
  feedback: "conversation", vent: "conversation",
  identity: "answer", capability: "answer", question: "answer", status_check: "answer",
  internal_operator_handoff: "answer",
  brainstorm: "brainstorm", plan: "brainstorm",
  task_candidate: "clarification", automation_candidate: "clarification",
  create_task: "command", memory_update: "command", phantom_loop_on: "command", phantom_loop_off: "command",
  create_website: "command", website_update: "command", run_agent: "command",
  create_automation: "workflow", reminder: "workflow", termina_parallel: "workflow", vacation_mode: "workflow",
  looper_build: "workflow", approval_request: "approval",
};
const AREA_BY_INTENT = {
  create_task: "workers", memory_update: "memory", create_automation: "automations", reminder: "automations",
  termina_parallel: "workers", vacation_mode: "vacation", approval_request: "approvals",
  phantom_loop_on: "settings", phantom_loop_off: "settings", looper_build: "sites",
  create_website: "sites", website_update: "sites", run_agent: "workers",
};
/* Only these lanes are allowed to show a card by default — conversation/
   answer/brainstorm/clarification stay text-only unless a specific response
   builder has a genuine reason to attach one (e.g. a record it just created). */
const CARD_LANES = new Set(["command", "workflow", "approval"]);

export function deriveActionContract(result) {
  const userVisibleMode = LANE_BY_INTENT[result.primaryIntent] || "answer";
  return {
    ...result,
    userVisibleMode,
    shouldShowCard: CARD_LANES.has(userVisibleMode),
    requiredArea: AREA_BY_INTENT[result.primaryIntent] || null,
    requiresApproval: !!result.requiresAdminApproval,
    backendNeeded: !!result.needsLiveData,
    responseStyle: userVisibleMode,
  };
}
