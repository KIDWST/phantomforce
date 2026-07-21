export type InstantRuleTurn = {
  user: string;
  assistant: string;
};

export type InstantRuleReply = {
  output_text: string;
  tool_id: "phantom-reference-resolver" | "phantom-clarifier";
};

type RuleKind = "if" | "requires" | "unless";

type ConditionalRule = {
  kind: RuleKind;
  condition: string;
  conditionLabel: string;
  outcome: string;
  outcomeLabel: string;
  effect: boolean;
  replaces?: string;
};

type RuleState = {
  rules: ConditionalRule[];
  facts: Map<string, boolean>;
  conflicts: Map<string, ConditionalRule[]>;
};

function cleanClause(value: string) {
  return String(value || "")
    .replace(/^\s*(?:rules?|correction)\s*:\s*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function normalizedClause(value: string) {
  return cleanClause(value)
    .toLowerCase()
    .replace(/\b(?:does|did|will)\s+not\b|\b(?:doesn['’]?t|didn['’]?t|won['’]?t|cannot|can['’]?t)\b/g, "")
    .replace(/\bopens?\b|\bopened\b/g, "open")
    .replace(/\bruns?\b|\bran\b/g, "run")
    .replace(/\bcompleted\b/g, "complete")
    .replace(/\b(?:happened|happens|happen|occurred|occurs|occur|proceeds|proceed)\b/g, "")
    .replace(/\b(?:is|are|was|were)\b/g, "")
    .replace(/\b(?:the|a|an)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleLabel(value: string) {
  const clean = cleanClause(value).replace(/^(?:the|a|an)\s+/i, "").trim();
  return clean ? `${clean[0].toUpperCase()}${clean.slice(1)}` : clean;
}

function lowerLabel(value: string) {
  const clean = cleanClause(value);
  return clean ? `${clean[0].toLowerCase()}${clean.slice(1)}` : clean;
}

function splitStatements(value: string) {
  return String(value || "")
    .split(/(?<=[.!?])\s+/)
    .map(cleanClause)
    .filter(Boolean)
    .slice(0, 12);
}

function negativeEffect(value: string) {
  return /\b(?:does|did|will)\s+not\b|\b(?:doesn['’]?t|didn['’]?t|won['’]?t|cannot|can['’]?t)\b/i.test(value);
}

function rulesFromText(value: string) {
  const rules: ConditionalRule[] = [];
  for (const statement of splitStatements(value)) {
    const conditional = statement.match(/^if\s+(.+?),\s*(.+)$/i);
    if (conditional) {
      rules.push({
        kind: "if",
        condition: normalizedClause(conditional[1]),
        conditionLabel: lowerLabel(conditional[1]),
        outcome: normalizedClause(conditional[2]),
        outcomeLabel: lowerLabel(conditional[2].replace(/\b(?:does|did|will)\s+not\b|\b(?:doesn['’]?t|didn['’]?t|won['’]?t)\b/gi, "")),
        effect: !negativeEffect(conditional[2]),
      });
      continue;
    }

    const requires = statement.match(/^(.+?)\s+requires\s+(.+?)(?:\s+instead\s+of\s+(.+))?$/i);
    if (requires) {
      rules.push({
        kind: "requires",
        condition: normalizedClause(requires[2]),
        conditionLabel: titleLabel(requires[2]),
        outcome: normalizedClause(requires[1]),
        outcomeLabel: titleLabel(requires[1]),
        effect: true,
        replaces: requires[3] ? normalizedClause(requires[3]) : undefined,
      });
      continue;
    }

    const unless = statement.match(/^(.+?)\s+unless\s+(.+)$/i);
    if (unless) {
      rules.push({
        kind: "unless",
        condition: normalizedClause(unless[2]),
        conditionLabel: lowerLabel(unless[2]),
        outcome: normalizedClause(unless[1]),
        outcomeLabel: lowerLabel(unless[1]),
        effect: true,
      });
    }
  }
  return rules.filter((rule) => rule.condition && rule.outcome && rule.condition !== rule.outcome);
}

function addFact(facts: Map<string, boolean>, key: string, value: boolean) {
  if (key) facts.set(key, value);
}

function factsFromText(value: string) {
  const facts = new Map<string, boolean>();
  for (const statement of splitStatements(value)) {
    if (rulesFromText(statement).length || /^(?:who|what|which|how|why|can|does|did|will|is|was|are)\b/i.test(statement)) continue;
    const status = statement.match(/^(?:the\s+)?(.+?)\s+(?:is|are)\s+(not\s+)?(active|inactive|ready|valid|complete|completed|verified|open|closed|available|done|present|enabled|missing|blocked|granted)$/i);
    if (status) {
      const subject = normalizedClause(status[1]);
      const adjective = status[3].toLowerCase().replace("completed", "complete");
      const negative = Boolean(status[2]) || ["inactive", "missing", "blocked"].includes(adjective);
      addFact(facts, subject, !negative);
      addFact(facts, normalizedClause(`${status[1]} ${adjective}`), !Boolean(status[2]));
      if (adjective === "inactive") addFact(facts, normalizedClause(`${status[1]} active`), false);
      if (status[2]) addFact(facts, normalizedClause(`${status[1]} ${adjective}`), false);
      continue;
    }

    const negativeAction = statement.match(/^(.+?)\s+(?:does|did|will)\s+not\s+(open|run|happen|occur|proceed)$/i);
    if (negativeAction) {
      addFact(facts, normalizedClause(`${negativeAction[1]} ${negativeAction[2]}`), false);
      continue;
    }
    const positiveAction = statement.match(/^(.+?)\s+(opens?|opened|runs?|ran|happened|occurred|proceeds?|completed)$/i);
    if (positiveAction) addFact(facts, normalizedClause(`${positiveAction[1]} ${positiveAction[2]}`), true);
  }
  return facts;
}

function buildRuleState(turns: InstantRuleTurn[]) {
  const rules: ConditionalRule[] = [];
  const facts = new Map<string, boolean>();
  for (const turn of turns.slice(-10)) {
    for (const rule of rulesFromText(turn.user)) {
      if (rule.kind === "requires" && rule.replaces) {
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          if (rules[index].kind === "requires" && rules[index].outcome === rule.outcome && rules[index].condition === rule.replaces) rules.splice(index, 1);
        }
      }
      rules.push(rule);
    }
    for (const [key, fact] of factsFromText(turn.user)) facts.set(key, fact);
  }
  if (!rules.length) return null;

  const conflicts = new Map<string, ConditionalRule[]>();
  for (const rule of rules.filter((item) => item.kind === "if")) {
    const matching = rules.filter((item) => item.kind === "if" && item.condition === rule.condition && item.outcome === rule.outcome);
    if (matching.some((item) => item.effect) && matching.some((item) => !item.effect)) conflicts.set(rule.outcome, matching);
  }

  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (const rule of rules) {
      let inferred: boolean | undefined;
      if (rule.kind === "if" && facts.get(rule.condition) === true) inferred = rule.effect;
      if (rule.kind === "unless" && facts.has(rule.condition)) inferred = facts.get(rule.condition) === false;
      if (rule.kind === "requires" && facts.get(rule.outcome) === true) inferred = true;
      const target = rule.kind === "requires" ? rule.condition : rule.outcome;
      if (inferred === undefined || facts.get(target) === inferred) continue;
      if (facts.has(target) && facts.get(target) !== inferred && !conflicts.has(target)) conflicts.set(target, [rule]);
      facts.set(target, inferred);
      changed = true;
    }
    if (!changed) break;
  }
  return { rules, facts, conflicts } satisfies RuleState;
}

function questionTarget(userRequest: string) {
  const request = cleanClause(userRequest)
    .replace(/\?\s*(?:yes\s+or\s+no\s+only|requirement\s+only)?$/i, "")
    .trim();
  const blocking = request.match(/^(?:what\s+is\s+blocking|why\s+is)\s+(.+?)(?:\s+blocked)?(?:\s+requirement\s+only)?$/i);
  if (blocking) return { mode: "blocking" as const, key: normalizedClause(blocking[1]) };
  const required = request.match(/^what\s+is\s+required\s+before\s+(.+?)(?:\s+use\s+a\s*>\s*b)?$/i);
  if (required) return { mode: "required" as const, key: normalizedClause(required[1]) };
  const whatRequires = request.match(/^what\s+does\s+(.+?)\s+require$/i);
  if (whatRequires) return { mode: "required" as const, key: normalizedClause(whatRequires[1]) };
  const can = request.match(/^can\s+(.+?)(?:\s+(?:happen|occur|proceed))?$/i);
  if (can) return { mode: "can" as const, key: normalizedClause(can[1]) };
  const does = request.match(/^(?:does|will)\s+(.+?)(?:\s+(?:happen|occur))?$/i);
  if (does) return { mode: "truth" as const, key: normalizedClause(does[1]) };
  const did = request.match(/^did\s+(.+?)\s+(?:happen|occur|open|run)$/i);
  if (did) return { mode: "occurred" as const, key: normalizedClause(did[1]) };
  const status = request.match(/^(?:is|was)\s+(.+?)\s+(active|ready|valid|complete|verified|open|available|done|present|enabled|granted)$/i);
  if (status) return { mode: "status" as const, key: normalizedClause(status[1]), fullKey: normalizedClause(`${status[1]} ${status[2]}`) };
  return null;
}

function requirementRules(state: RuleState, outcome: string) {
  return state.rules.filter((rule) => rule.kind === "requires" && rule.outcome === outcome);
}

function ruleLabel(state: RuleState, key: string) {
  const rule = state.rules.find((item) => item.condition === key || item.outcome === key);
  if (!rule) return titleLabel(key);
  return rule.condition === key ? rule.conditionLabel : rule.outcomeLabel;
}

function requirementPath(state: RuleState, root: string) {
  const path = [root];
  const visiting = new Set<string>();
  let cycle: string[] | null = null;
  const visit = (node: string) => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      cycle = path.slice(Math.max(start, 0));
      return;
    }
    visiting.add(node);
    const dependencies = requirementRules(state, node);
    for (const dependency of dependencies) {
      path.push(dependency.condition);
      visit(dependency.condition);
      if (cycle) return;
      path.pop();
    }
    visiting.delete(node);
  };
  visit(root);
  const detectedCycle = cycle as string[] | null;
  if (detectedCycle) return { cycle: detectedCycle, dependencies: [] as string[] };
  const dependencies: string[] = [];
  const collect = (node: string, seen = new Set<string>()) => {
    for (const dependency of requirementRules(state, node)) {
      if (seen.has(dependency.condition)) continue;
      seen.add(dependency.condition);
      dependencies.push(dependency.condition);
      collect(dependency.condition, seen);
    }
  };
  collect(root);
  return { cycle: null, dependencies };
}

function conditionQuestion(label: string) {
  const copula = lowerLabel(label).match(/^(the\s+)?(.+?)\s+is\s+(.+)$/i);
  if (copula) return `Is ${copula[1] || ""}${copula[2]} ${copula[3]}?`;
  return `Is ${lowerLabel(label)}?`;
}

export function buildConditionalRuleReply(userRequest: string, turns: InstantRuleTurn[]): InstantRuleReply | null {
  const query = questionTarget(userRequest);
  if (!query) return null;
  const state = buildRuleState(turns);
  if (!state) return null;

  if (query.mode === "required") {
    const known = state.rules.some((rule) => rule.outcome === query.key || rule.condition === query.key);
    if (!known) return { output_text: `${titleLabel(query.key)} is not in the stated rules. What rule should connect ${titleLabel(query.key)}?`, tool_id: "phantom-clarifier" };
    const graph = requirementPath(state, query.key);
    if (graph.cycle) {
      return {
        output_text: `The stated requirements contain a cycle: ${graph.cycle.map((key) => ruleLabel(state, key)).join(" > ")}. Which dependency should change?`,
        tool_id: "phantom-clarifier",
      };
    }
    if (!graph.dependencies.length) return { output_text: `${ruleLabel(state, query.key)} has no stated prerequisite.`, tool_id: "phantom-reference-resolver" };
    return { output_text: graph.dependencies.map((key) => ruleLabel(state, key)).join(" > "), tool_id: "phantom-reference-resolver" };
  }

  const conflictRules = state.conflicts.get(query.key);
  if (conflictRules?.length) {
    const rule = conflictRules[0];
    return {
      output_text: `The stated rules conflict about whether ${rule.outcomeLabel} when ${rule.conditionLabel}. Which rule should I use?`,
      tool_id: "phantom-clarifier",
    };
  }

  if (query.mode === "blocking" || query.mode === "can" || query.mode === "occurred") {
    const dependencies = requirementRules(state, query.key);
    if (dependencies.length) {
      const failed = dependencies.find((rule) => state.facts.get(rule.condition) === false);
      if (failed) {
        if (query.mode === "blocking") return { output_text: failed.conditionLabel, tool_id: "phantom-reference-resolver" };
        return { output_text: `No. ${ruleLabel(state, query.key)} is blocked because ${failed.conditionLabel.toLowerCase()} is missing.`, tool_id: "phantom-reference-resolver" };
      }
      const unknown = dependencies.find((rule) => !state.facts.has(rule.condition));
      if (unknown) {
        return { output_text: `I know ${ruleLabel(state, query.key)} requires ${unknown.conditionLabel.toLowerCase()}, but I do not have ${unknown.conditionLabel.toLowerCase()}'s status. Is ${unknown.conditionLabel.toLowerCase()} complete?`, tool_id: "phantom-clarifier" };
      }
      if (query.mode === "blocking") return { output_text: "No stated requirement is currently blocking it.", tool_id: "phantom-reference-resolver" };
      if (query.mode === "can") return { output_text: "Yes", tool_id: "phantom-reference-resolver" };
      if (!state.facts.has(query.key)) {
        const labels = dependencies.map((rule) => rule.conditionLabel).join(" and ");
        return { output_text: `${labels} ${dependencies.length === 1 ? "is" : "are"} satisfied, but that does not prove ${ruleLabel(state, query.key).toLowerCase()} happened. Did ${ruleLabel(state, query.key).toLowerCase()} happen?`, tool_id: "phantom-clarifier" };
      }
    }
  }

  const queryKeys = query.mode === "status" ? [query.fullKey, query.key] : [query.key];
  const factKey = queryKeys.find((key) => state.facts.has(key)) || queryKeys[0];
  if (state.facts.has(factKey)) return { output_text: state.facts.get(factKey) ? "Yes" : "No", tool_id: "phantom-reference-resolver" };

  const producingRule = state.rules.find((rule) => rule.kind !== "requires" && queryKeys.includes(rule.outcome));
  if (producingRule) {
    if (state.conflicts.has(producingRule.outcome)) {
      return { output_text: `The stated rules conflict about whether ${producingRule.outcomeLabel} when ${producingRule.conditionLabel}. Which rule should I use?`, tool_id: "phantom-clarifier" };
    }
    if (!state.facts.has(producingRule.condition)) {
      const connector = producingRule.kind === "unless" ? "unless" : "if";
      return {
        output_text: `I know ${producingRule.outcomeLabel} ${connector} ${producingRule.conditionLabel}, but I do not know whether ${producingRule.conditionLabel}. ${conditionQuestion(producingRule.conditionLabel)}`,
        tool_id: "phantom-clarifier",
      };
    }
    if (producingRule.kind === "if" && state.facts.get(producingRule.condition) === false) {
      return { output_text: `The rule only says ${producingRule.outcomeLabel} if ${producingRule.conditionLabel}. A false condition does not prove the outcome is false. Does ${producingRule.outcomeLabel}?`, tool_id: "phantom-clarifier" };
    }
  }

  const converseRule = state.rules.find((rule) => rule.kind === "if" && queryKeys.includes(rule.condition) && state.facts.get(rule.outcome) === true);
  if (converseRule) {
    return {
      output_text: `The rule only says: if ${converseRule.conditionLabel}, ${converseRule.outcomeLabel}. It does not prove the converse. ${conditionQuestion(converseRule.conditionLabel)}`,
      tool_id: "phantom-clarifier",
    };
  }
  return null;
}
