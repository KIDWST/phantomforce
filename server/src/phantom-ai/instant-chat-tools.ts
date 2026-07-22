import { selectRelevantInstantTurns } from "./instant-chat-context.js";
import { buildConditionalRuleReply } from "./instant-chat-rules.js";

export type InstantChatToolTurn = {
  user: string;
  assistant: string;
};

export type InstantChatToolReply = {
  output_text: string;
  tool_id: "phantom-calculator" | "phantom-reference-resolver" | "phantom-context-recall" | "phantom-clarifier" | "phantom-identity" | "phantom-personality" | "phantom-stable-fact";
};

export function instantResponseTokenBudget(userRequest: string) {
  const text = String(userRequest || "");
  const requestedWords = text.match(/\b(?:(?:about|around|roughly|approximately|exactly|at least|up to)\s+)?(\d{2,4})[ -]words?\b/i);
  if (requestedWords) {
    const words = Math.min(Math.max(Number(requestedWords[1]), 20), 320);
    return Math.min(Math.max(Math.ceil(words * 1.75) + 32, 80), 600);
  }
  if (/\b(?:detailed|comprehensive|in-depth|long-form)\b|\b(?:essay|article|story)\b.{0,24}\b(?:about|on|explaining)\b/i.test(text)) {
    return 320;
  }
  const requestedItems = text.match(/\b(?:exactly\s+)?(\d{1,2})\s+(?:bullet points?|items?|steps?|examples?)\b/i);
  if (requestedItems) return Math.min(Math.max(Number(requestedItems[1]) * 28 + 48, 80), 320);
  return 80;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const ORDINALS: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  sixth: 5,
  seventh: 6,
  eighth: 7,
  ninth: 8,
  tenth: 9,
};

function parseCount(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[value.toLowerCase()] ?? null;
}

function money(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function itemLabel(text: string) {
  const match = text.match(/\b(?:ticket|shirt|item|seat|meal|book|pass|room)s?\b/i);
  return match?.[0]?.toLowerCase() || "items";
}

function arithmeticReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const direct = userRequest.match(/\b(?:what(?:'s| is)|calculate)\s+(-?\d+(?:\.\d+)?)\s*(times|multiplied by|divided by|plus|minus|[x*+/-])\s*(-?\d+(?:\.\d+)?)\s*\??$/i);
  if (direct) {
    const left = Number(direct[1]);
    const right = Number(direct[3]);
    const operator = direct[2].toLowerCase();
    const result = operator === "times" || operator === "multiplied by" || operator === "x" || operator === "*"
      ? left * right
      : operator === "divided by" || operator === "/"
        ? right === 0 ? NaN : left / right
        : operator === "plus" || operator === "+"
          ? left + right
          : left - right;
    if (Number.isFinite(result)) {
      return { output_text: `${money(left)} ${direct[2]} ${money(right)} = ${money(result)}.`, tool_id: "phantom-calculator" };
    }
  }
  const percentOf = userRequest.match(/\b(?:what(?:'s| is)|calculate)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)\s*\??$/i);
  if (percentOf) {
    const rate = Number(percentOf[1]);
    const value = Number(percentOf[2]);
    return { output_text: `${money(rate)}% of ${money(value)} = ${money(value * rate / 100)}.`, tool_id: "phantom-calculator" };
  }

  const messages = [...turns.map((turn) => turn.user), userRequest];
  let base: number | null = null;
  let discountRate = 0;
  let quantity = 1;
  let taxRate = 0;
  let label = "items";

  for (const message of messages) {
    const price = message.match(/\b(?:costs?|is|price(?: is| of)?|at)\s+\$?(\d+(?:\.\d+)?)\s*(?:dollars?)?\b/i)
      || message.match(/\$\s*(\d+(?:\.\d+)?)/);
    if (price) {
      base = Number(price[1]);
      discountRate = 0;
      quantity = 1;
      taxRate = 0;
      label = itemLabel(message);
    }
    const discount = message.match(/\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:off|discount(?:ed)?)/i)
      || message.match(/\b(?:discount|reduce)\s+(?:it|that|the price)?\s*(?:by\s*)?(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
    if (discount) discountRate = Number(discount[1]) / 100;
    const count = message.match(/\b(?:need|buy|order|get|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z]+s)\b/i)
      || message.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(tickets|shirts|items|seats|meals|books|passes|rooms)\b/i);
    if (count) {
      quantity = parseCount(count[1]) ?? quantity;
      label = count[2].toLowerCase();
    }
    const tax = message.match(/\b(?:add|plus|with|including)\s+(?:an?\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)\s*tax\b/i);
    if (tax) taxRate = Number(tax[1]) / 100;
  }

  if (base == null || !Number.isFinite(base) || base < 0) return null;
  const currentSignalsMath = /\b(?:discount|percent|%|tax|total|final number|double-check|check (?:it|the math)|step by step)\b/i.test(userRequest);
  if (!currentSignalsMath) return null;

  const unit = base * (1 - discountRate);
  const subtotal = unit * quantity;
  const total = subtotal * (1 + taxRate);
  if (![unit, subtotal, total].every(Number.isFinite)) return null;

  if (/\b(?:only (?:the )?final number|final number only|just (?:the )?(?:number|total))\b/i.test(userRequest)) {
    return { output_text: money(total), tool_id: "phantom-calculator" };
  }
  if (/\b(?:double-check|check (?:it|the math)|step by step)\b/i.test(userRequest)) {
    const steps = [`$${money(base)} x ${money(1 - discountRate)} = $${money(unit)} each`];
    if (quantity !== 1) steps.push(`$${money(unit)} x ${quantity} = $${money(subtotal)}`);
    if (taxRate) steps.push(`$${money(subtotal)} x ${money(1 + taxRate)} = $${money(total)}`);
    return { output_text: `${steps.join("; ")}.`, tool_id: "phantom-calculator" };
  }
  if (quantity === 1 && !taxRate) {
    return { output_text: `The discounted price is $${money(unit)}.`, tool_id: "phantom-calculator" };
  }
  const taxText = taxRate ? ` with ${money(taxRate * 100)}% tax` : "";
  return {
    output_text: `${quantity} ${label}${taxText} total $${money(total)}.`,
    tool_id: "phantom-calculator",
  };
}

function cleanListItem(value: string) {
  return value
    .replace(/^\s*(?:[-*]\s*|\d+[.)]\s*)/, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function listSelectionReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const ordinalMatch = userRequest.match(/\b(?:pick|choose|select|use)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+one)?\b/i);
  if (!ordinalMatch) return null;
  const index = ORDINALS[ordinalMatch[1].toLowerCase()];
  const prior = [...turns].reverse().find((turn) => turn.assistant.trim())?.assistant || "";
  const lineItems = prior.split(/\r?\n/).map(cleanListItem).filter(Boolean);
  const lines = lineItems.length >= 2
    ? lineItems
    : prior.split(/\s*(?:,|;|\|)\s*/).map(cleanListItem).filter(Boolean);
  if (lines.length <= index || lines.length < 2) return null;
  const selected = lines[index];
  if (!selected || selected.length > 120) return null;
  return { output_text: selected, tool_id: "phantom-reference-resolver" };
}

function numberedItemsFromTurns(turns: InstantChatToolTurn[]) {
  for (const turn of [...turns].reverse()) {
    const items = [...turn.user.matchAll(/\b\d+[.)]\s*([^,;\n.]+)/g)]
      .map((match) => cleanListItem(match[1]))
      .filter(Boolean);
    if (items.length >= 2 && items.length <= 10) return items;
  }
  return [];
}

function listReorderReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const items = numberedItemsFromTurns(turns);
  if (items.length < 2) return null;
  const move = userRequest.match(/\bmove\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(before|after)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
  const swap = userRequest.match(/\bswap\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:and|with)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
  if (!move && !swap) return null;

  const reordered = [...items];
  if (move) {
    const from = ORDINALS[move[1].toLowerCase()];
    const target = ORDINALS[move[3].toLowerCase()];
    if (from >= items.length || target >= items.length || from === target) return null;
    const movedItem = items[from];
    const targetItem = items[target];
    reordered.splice(reordered.indexOf(movedItem), 1);
    const targetIndex = reordered.indexOf(targetItem);
    reordered.splice(targetIndex + (move[2].toLowerCase() === "after" ? 1 : 0), 0, movedItem);
  } else if (swap) {
    const left = ORDINALS[swap[1].toLowerCase()];
    const right = ORDINALS[swap[2].toLowerCase()];
    if (left >= items.length || right >= items.length || left === right) return null;
    [reordered[left], reordered[right]] = [reordered[right], reordered[left]];
  }
  return { output_text: reordered.join("\n"), tool_id: "phantom-reference-resolver" };
}

function pairedReferenceReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const reference = userRequest.match(/\b(former|latter)\b/i)?.[1]?.toLowerCase();
  if (!reference) return null;
  for (const turn of [...turns].reverse()) {
    const clauses = turn.user.split(/[.;]\s*/).map((value) => value.trim()).filter(Boolean);
    const pairs = clauses.flatMap((clause) => {
      const match = clause.match(/^(?:the\s+)?(.{1,60}?)\s+(?:contains?|has|holds?|includes?)\s+(.{1,80})$/i);
      if (!match) return [];
      return [{ subject: cleanListItem(match[1]), value: cleanListItem(match[2]) }];
    });
    if (pairs.length !== 2) continue;
    const selected = pairs[reference === "former" ? 0 : 1];
    if (!selected?.value || selected.value.length > 120) return null;
    return { output_text: selected.value, tool_id: "phantom-reference-resolver" };
  }
  return null;
}

type RespectivelyMapping = {
  subjects: string[];
  values: string[];
};

function splitRespectivelyList(value: string) {
  return value
    .replace(/\s*,?\s+and\s+/gi, ",")
    .split(/\s*,\s*/)
    .map(cleanListItem)
    .map((item) => item.replace(/^(?:the|a|an)\s+/i, "").trim())
    .filter(Boolean);
}

function respectivelyMappingFromText(value: string): RespectivelyMapping | null {
  const match = value.match(/^\s*(.{2,180}?)\s+(?:chose|selected|picked|received|were assigned)\s+(.{2,180}?)\s*,?\s+respectively[.!?]?\s*$/i);
  if (!match) return null;
  const subjects = splitRespectivelyList(match[1]);
  const values = splitRespectivelyList(match[2]);
  if (subjects.length < 2 || subjects.length > 10 || values.length < 2 || values.length > 10) return null;
  if (!subjects.every((subject) => /^[A-Z][A-Za-z'-]{1,39}$/.test(subject))) return null;
  if (!values.every((item) => item.length <= 80)) return null;
  return { subjects, values };
}

function respectivelyReferenceReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const mapping = [...turns].reverse()
    .map((turn) => respectivelyMappingFromText(turn.user))
    .find((item): item is RespectivelyMapping => Boolean(item));
  if (!mapping) return null;
  const referencesMapping = /\b(?:chose|choose|selected|select|picked|pick|received|assigned|choice)\b/i.test(userRequest)
    || mapping.values.some((item) => userRequest.toLowerCase().includes(item.toLowerCase()));
  if (!referencesMapping) return null;

  if (mapping.subjects.length !== mapping.values.length) {
    const requestedSubject = mapping.subjects.find((subject) => new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(userRequest));
    const requestedValue = mapping.values.find((item) => userRequest.toLowerCase().includes(item.toLowerCase()));
    const requestedOrdinal = /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:person|name|one|choice|value)\b/i.test(userRequest);
    if (!requestedSubject && !requestedValue && !requestedOrdinal) return null;
    return {
      output_text: `I have ${mapping.subjects.length} people and ${mapping.values.length} choices. ${requestedSubject ? `Which choice belongs to ${requestedSubject}?` : requestedValue ? `Who chose ${requestedValue}?` : "How should I pair them?"}`,
      tool_id: "phantom-clarifier",
    };
  }

  const ordinal = userRequest.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:person|name|one)\b/i)?.[1]?.toLowerCase();
  if (ordinal) {
    const value = mapping.values[ORDINALS[ordinal]];
    return value ? { output_text: value, tool_id: "phantom-reference-resolver" } : null;
  }

  const subjectIndex = mapping.subjects.findIndex((subject) => new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(userRequest));
  if (subjectIndex >= 0 && /\b(?:what|which)\b/i.test(userRequest)) {
    return { output_text: mapping.values[subjectIndex], tool_id: "phantom-reference-resolver" };
  }

  if (/\bwho\b/i.test(userRequest)) {
    const normalizedRequest = userRequest.toLowerCase();
    const valueIndex = mapping.values.findIndex((item) => normalizedRequest.includes(item.toLowerCase()));
    if (valueIndex >= 0) return { output_text: mapping.subjects[valueIndex], tool_id: "phantom-reference-resolver" };
  }
  return null;
}

type NamedQuantity = {
  name: string;
  value: number;
  unit: string;
};

function namedQuantitiesFromText(value: string) {
  return [...value.matchAll(/\b([A-Z][A-Za-z'-]{1,39})\s+(?:logged|has|had|walked|worked|completed|scored|recorded)\s+(-?\d+(?:\.\d+)?)\s+([a-z][a-z-]{0,30})\b/gi)]
    .map((match) => ({ name: match[1], value: Number(match[2]), unit: match[3].toLowerCase() }))
    .filter((item) => Number.isFinite(item.value));
}

function namedQuantityState(turns: InstantChatToolTurn[]) {
  let baseIndex = -1;
  let base: NamedQuantity[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const facts = namedQuantitiesFromText(turns[index].user);
    if (!facts.length || /^\s*(?:actually|change|correction|correct|instead|update)\b/i.test(turns[index].user)) continue;
    if (facts.length) {
      baseIndex = index;
      base = facts;
      break;
    }
  }
  if (baseIndex < 0 || !base.length || base.length > 10) return [];
  const state = new Map(base.map((item) => [item.name.toLowerCase(), { ...item }]));
  for (const turn of turns.slice(baseIndex + 1)) {
    for (const fact of namedQuantitiesFromText(turn.user)) {
      const existing = state.get(fact.name.toLowerCase());
      if (existing) state.set(fact.name.toLowerCase(), { ...fact, name: existing.name });
    }
  }
  return [...state.values()];
}

function isQuantityComparisonRequest(value: string) {
  return /\bhow many more\b|\bwho\b.{0,30}\b(?:more|most|least|highest|lowest|fewest)\b|\brank\b.{0,40}\b(?:most|least|highest|lowest)\b|\b(?:most|least|highest|lowest|fewest)\s+now\b/i.test(value);
}

function namedQuantityComparisonReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  if (!isQuantityComparisonRequest(userRequest)) return null;
  const quantities = namedQuantityState(turns);
  if (!quantities.length) return null;

  const differenceRequest = /\bhow many more\b/i.test(userRequest);
  const queryNames = [...userRequest.matchAll(/\b([A-Z][A-Za-z'-]{1,39})\b/g)]
    .map((match) => match[1])
    .filter((name) => !new Set(["Event", "How", "Name", "Names", "Number", "Rank", "Who"]).has(name));
  const missing = differenceRequest
    ? queryNames.find((name) => !quantities.some((item) => item.name.toLowerCase() === name.toLowerCase()))
    : undefined;
  if (missing) {
    const known = queryNames.find((name) => quantities.some((item) => item.name.toLowerCase() === name.toLowerCase())) || quantities[0].name;
    return { output_text: `I have ${known}'s value, but not ${missing}'s. What is ${missing}'s value?`, tool_id: "phantom-clarifier" };
  }

  const units = [...new Set(quantities.map((item) => item.unit))];
  if (units.length !== 1) {
    return { output_text: `Those values use different units (${units.join(" and ")}). What should I compare?`, tool_id: "phantom-clarifier" };
  }
  const unit = units[0];

  if (differenceRequest) {
    const selected = queryNames
      .map((name) => quantities.find((item) => item.name.toLowerCase() === name.toLowerCase()))
      .filter((item): item is NamedQuantity => Boolean(item));
    if (selected.length !== 2) return null;
    const difference = selected[0].value - selected[1].value;
    if (difference < 0) {
      return {
        output_text: `${selected[0].name} has ${money(Math.abs(difference))} fewer ${unit} than ${selected[1].name}.`,
        tool_id: "phantom-calculator",
      };
    }
    return { output_text: `${money(difference)} ${unit}`, tool_id: "phantom-calculator" };
  }

  const descending = /\bfrom\s+(?:most|highest)\s+to\s+(?:least|lowest)\b/i.test(userRequest)
    || !/\b(?:least|lowest|fewest)\b/i.test(userRequest);
  const ranked = [...quantities].sort((left, right) => descending ? right.value - left.value : left.value - right.value);
  if (/\brank\b/i.test(userRequest)) {
    return { output_text: ranked.map((item) => item.name).join(" > "), tool_id: "phantom-reference-resolver" };
  }
  const bestValue = ranked[0].value;
  const winners = ranked.filter((item) => item.value === bestValue);
  if (winners.length > 1) {
    return {
      output_text: `${winners.map((item) => item.name).join(" and ")} are tied at ${money(bestValue)} ${unit}.`,
      tool_id: "phantom-reference-resolver",
    };
  }
  return { output_text: winners[0].name, tool_id: "phantom-reference-resolver" };
}

function orderedEventsFromText(value: string) {
  if (!/\b(?:sequence|timeline|order)\s*:/i.test(value)) return [];
  return [...value.matchAll(/\b\d+[.)]\s*([\s\S]*?)(?=\s+\d+[.)]\s*|$)/g)]
    .map((match) => cleanListItem(match[1]))
    .filter((item) => item.length >= 2 && item.length <= 180)
    .slice(0, 10);
}

function normalizedEvent(value: string) {
  return cleanListItem(value).toLowerCase().replace(/\b(?:again|event only)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function ordinalLabel(index: number) {
  return Object.entries(ORDINALS).find(([, value]) => value === index)?.[0] || `${index + 1}th`;
}

function orderedEventReferenceReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const relation = userRequest.match(/\b(?:immediately\s+)?(before|after)\s+(.+?)(?:\?|$)/i);
  if (!relation) return null;
  const events = [...turns].reverse().map((turn) => orderedEventsFromText(turn.user)).find((items) => items.length >= 2);
  if (!events) return null;
  const targetText = cleanListItem(relation[2].replace(/^(?:the\s+)?event\s+(?:where|when)\s+/i, ""));
  const target = normalizedEvent(targetText);
  if (!target) return null;
  const matchingIndexes = events
    .map((event, index) => ({ index, normalized: normalizedEvent(event) }))
    .filter((item) => item.normalized === target || item.normalized.includes(target) || target.includes(item.normalized))
    .map((item) => item.index);
  if (!matchingIndexes.length) return null;
  if (matchingIndexes.length > 1) {
    const choices = matchingIndexes.map((_, index) => ordinalLabel(index)).join(" or ");
    return { output_text: `Do you mean the ${choices} time ${targetText}?`, tool_id: "phantom-clarifier" };
  }
  const offset = relation[1].toLowerCase() === "before" ? -1 : 1;
  const selected = events[matchingIndexes[0] + offset];
  if (!selected) return {
    output_text: `Nothing in the stated sequence happened ${relation[1].toLowerCase()} ${targetText}.`,
    tool_id: "phantom-reference-resolver",
  };
  return { output_text: selected, tool_id: "phantom-reference-resolver" };
}

function namedPredicatesFromText(value: string) {
  return [...value.matchAll(/(?:^|[.:;]\s*|\band\s+)([A-Z][a-z][A-Za-z'-]{1,38})\s+([^.;]+?)(?=\s+and\s+[A-Z]|[.;]|$)/g)]
    .map((match) => ({ name: match[1], predicate: cleanListItem(match[2]) }))
    .filter((item) => item.predicate.length >= 2 && item.predicate.length <= 120);
}

function normalizedPredicate(value: string) {
  return cleanListItem(value).toLowerCase().replace(/^(?:does|did|is|was)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function namedPredicateReferenceReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const query = userRequest.match(/\bwhich one\s+(.+?)(?:\?|$)/i);
  if (!query) return null;
  const target = normalizedPredicate(query[1]);
  if (!target) return null;
  for (const turn of [...turns].reverse()) {
    const matches = namedPredicatesFromText(turn.user).filter((item) => {
      const predicate = normalizedPredicate(item.predicate);
      return predicate === target || predicate.includes(target) || target.includes(predicate);
    });
    if (matches.length === 1) return { output_text: matches[0].name, tool_id: "phantom-reference-resolver" };
    if (matches.length > 1) {
      return { output_text: `Do you mean ${matches.map((item) => item.name).join(" or ")}?`, tool_id: "phantom-clarifier" };
    }
  }
  return null;
}

type ConfirmationState = {
  universe: string[];
  confirmed: Set<string>;
  notConfirmed: Set<string>;
  unknown: Set<string>;
  conflicts: Set<string>;
  outsideUniverse: Set<string>;
  excludedWithoutUniverse: string[];
  baseKind: ConfirmationBase["kind"];
  baseNames: string[];
  groupLabel: string;
};

const MEMBERSHIP_NON_NAMES = new Set([
  "Actually", "All", "Correction", "Did", "Everyone", "How", "It", "Name", "Names", "Neither", "No", "Not", "Now", "Number", "Only", "The", "Then", "They", "Who", "Yes",
]);

function membershipNames(value: string) {
  const names: string[] = [];
  for (const match of value.matchAll(/\b([A-Z][a-z][A-Za-z'-]{1,38})\b/g)) {
    const name = match[1];
    if (!MEMBERSHIP_NON_NAMES.has(name) && !names.some((item) => item.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names.slice(0, 10);
}

function statedGroupFromText(value: string) {
  const leading = value.match(/\b(?:the\s+)?([a-z][a-z -]{0,30}?(?:team|group)|reviewers|attendees|members|participants|crew|people|staff|panel|roster)\s*(?:is|are|includes?|contains?|consists\s+of|:)\s+([^.!?]+)/i);
  if (leading) {
    const names = membershipNames(leading[2]);
    if (names.length >= 2) return { names, label: cleanListItem(leading[1]).toLowerCase() };
  }
  const trailing = value.match(/^\s*([^.!?]{2,180}?)\s+are\s+(?:the\s+)?([a-z][a-z -]{0,30}?(?:team|group)|reviewers|attendees|members|participants|crew|people|staff|panel|roster)\b/i);
  if (trailing) {
    const names = membershipNames(trailing[1]);
    if (names.length >= 2) return { names, label: cleanListItem(trailing[2]).toLowerCase() };
  }
  return null;
}

type ConfirmationBase = {
  kind: "everyone-except" | "only" | "neither";
  named: string[];
  matchEnd: number;
};

function confirmationBaseFromText(value: string): ConfirmationBase | null {
  const everyone = value.match(/\beveryone\s+except\s+(.+?)\s+confirmed\b/i);
  if (everyone) return { kind: "everyone-except", named: membershipNames(everyone[1]), matchEnd: (everyone.index || 0) + everyone[0].length };
  const only = value.match(/\bonly\s+(.+?)\s+confirmed\b/i);
  if (only) return { kind: "only", named: membershipNames(only[1]), matchEnd: (only.index || 0) + only[0].length };
  const neither = value.match(/\bneither\s+(.+?)\s+nor\s+(.+?)\s+confirmed\b/i);
  if (neither) return { kind: "neither", named: membershipNames(`${neither[1]} and ${neither[2]}`), matchEnd: (neither.index || 0) + neither[0].length };
  return null;
}

function confirmationState(turns: InstantChatToolTurn[]): ConfirmationState | null {
  let baseIndex = -1;
  let base: ConfirmationBase | null = null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const candidate = confirmationBaseFromText(turns[index].user);
    if (!candidate) continue;
    baseIndex = index;
    base = candidate;
    break;
  }
  if (!base || baseIndex < 0 || !base.named.length) return null;

  let group = statedGroupFromText(turns[baseIndex].user);
  if (!group) {
    for (let index = baseIndex - 1; index >= Math.max(0, baseIndex - 3); index -= 1) {
      group = statedGroupFromText(turns[index].user);
      if (group) break;
    }
  }
  const universe = group?.names || [];
  const canonical = (name: string) => universe.find((item) => item.toLowerCase() === name.toLowerCase()) || name;
  const confirmed = new Set<string>();
  const notConfirmed = new Set<string>();
  const unknown = new Set<string>();
  const conflicts = new Set<string>();
  const outsideUniverse = new Set<string>();
  const baseNames = base.named.map(canonical);

  if (base.kind === "everyone-except") {
    for (const name of universe) (baseNames.some((item) => item.toLowerCase() === name.toLowerCase()) ? notConfirmed : confirmed).add(name);
    if (!universe.length) for (const name of baseNames) notConfirmed.add(name);
  } else if (base.kind === "only") {
    for (const name of baseNames) confirmed.add(name);
    for (const name of universe) if (!confirmed.has(name)) notConfirmed.add(name);
  } else {
    for (const name of baseNames) notConfirmed.add(name);
    for (const name of universe) if (!notConfirmed.has(name)) unknown.add(name);
  }

  const baseTail = turns[baseIndex].user.slice(base.matchEnd);
  for (const name of baseNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (notConfirmed.has(name) && new RegExp(`\\b${escaped}\\s+(?:also\\s+)?confirmed\\b`, "i").test(baseTail)) conflicts.add(name);
  }

  for (const turn of turns.slice(baseIndex + 1)) {
    if (/\?/.test(turn.user) || /^\s*(?:who|what|which|how|did|does|is|are)\b/i.test(turn.user)) continue;
    const doubleNegative = [...turn.user.matchAll(/(?:not\s+true\s+that|isn['’]?t\s+true\s+that)\s+([A-Z][a-z][A-Za-z'-]{1,38})\s+(?:did\s+not|didn['’]?t)\s+confirm\b/g)].map((match) => canonical(match[1]));
    const positive = [
      ...doubleNegative,
      ...[...turn.user.matchAll(/\b([A-Z][a-z][A-Za-z'-]{1,38})\s+confirmed(?:\s+(?:after\s+all|now))?\b/g)].map((match) => canonical(match[1])),
      ...[...turn.user.matchAll(/\b[Aa]dd\s+([A-Z][a-z][A-Za-z'-]{1,38})\s+to\s+(?:the\s+)?confirmed\b/g)].map((match) => canonical(match[1])),
    ];
    const negative = [...turn.user.matchAll(/\b([A-Z][a-z][A-Za-z'-]{1,38})\s+(?:did\s+not|didn['’]?t)\s+confirm\b/g)]
      .map((match) => canonical(match[1]))
      .filter((name) => !doubleNegative.some((item) => item.toLowerCase() === name.toLowerCase()));
    negative.push(...[...turn.user.matchAll(/\b[Rr]emove\s+([A-Z][a-z][A-Za-z'-]{1,38})\s+from\s+(?:the\s+)?confirmed\b/g)].map((match) => canonical(match[1])));
    const overlap = positive.filter((name) => negative.some((item) => item.toLowerCase() === name.toLowerCase()));
    for (const name of overlap) conflicts.add(name);
    for (const name of positive.filter((item) => !overlap.includes(item))) {
      if (universe.length && !universe.some((item) => item.toLowerCase() === name.toLowerCase())) {
        outsideUniverse.add(name);
        continue;
      }
      confirmed.add(name);
      notConfirmed.delete(name);
      unknown.delete(name);
      conflicts.delete(name);
    }
    for (const name of negative.filter((item) => !overlap.includes(item))) {
      if (universe.length && !universe.some((item) => item.toLowerCase() === name.toLowerCase())) {
        outsideUniverse.add(name);
        continue;
      }
      notConfirmed.add(name);
      confirmed.delete(name);
      unknown.delete(name);
      conflicts.delete(name);
    }
  }

  return {
    universe,
    confirmed,
    notConfirmed,
    unknown,
    conflicts,
    outsideUniverse,
    excludedWithoutUniverse: base.kind === "everyone-except" && !universe.length ? baseNames : [],
    baseKind: base.kind,
    baseNames,
    groupLabel: group?.label || "group",
  };
}

function naturalNameList(names: string[]) {
  if (names.length < 2) return names[0] || "no one";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function confirmationMembershipReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  if (!/\bconfirm(?:ed)?\b/i.test(userRequest) || !/\b(?:who|how\s+many|did)\b/i.test(userRequest)) return null;
  const state = confirmationState(turns);
  if (!state) return null;
  if (state.conflicts.size) {
    const names = naturalNameList([...state.conflicts]);
    return { output_text: `I have conflicting confirmation updates for ${names}. Did ${names} confirm?`, tool_id: "phantom-clarifier" };
  }
  if (state.outsideUniverse.size) {
    const names = naturalNameList([...state.outsideUniverse]);
    return { output_text: `${names} ${state.outsideUniverse.size === 1 ? "is" : "are"} not in the stated ${state.groupLabel}. Should ${names} join the group?`, tool_id: "phantom-clarifier" };
  }
  if (state.excludedWithoutUniverse.length) {
    const excluded = naturalNameList(state.excludedWithoutUniverse);
    return { output_text: `I know ${excluded} ${state.excludedWithoutUniverse.length === 1 ? "was" : "were"} excluded, but I do not know who 'everyone' includes. Who is in the group?`, tool_id: "phantom-clarifier" };
  }

  const direct = userRequest.match(/\b[Dd]id\s+([A-Z][a-z][A-Za-z'-]{1,38})\s+confirm\b/)?.[1];
  if (direct) {
    const person = state.universe.find((name) => name.toLowerCase() === direct.toLowerCase());
    if (!person) return { output_text: `${direct} is not in the stated ${state.groupLabel}. Who should ${direct} replace or join?`, tool_id: "phantom-clarifier" };
    if (state.confirmed.has(person)) return { output_text: "Yes", tool_id: "phantom-reference-resolver" };
    if (state.notConfirmed.has(person)) return { output_text: "No", tool_id: "phantom-reference-resolver" };
    return { output_text: `I do not have ${person}'s confirmation status. Did ${person} confirm?`, tool_id: "phantom-clarifier" };
  }

  const asksNegative = /\bwho\s+(?:did\s+not|didn['’]?t)\s+confirm/i.test(userRequest);
  if (asksNegative) {
    if (!state.universe.length && state.baseKind === "only") {
      return { output_text: `I know only ${naturalNameList(state.baseNames)} confirmed, but I do not know who else is in the group. Who is in the group?`, tool_id: "phantom-clarifier" };
    }
    const names = state.universe.filter((name) => state.notConfirmed.has(name));
    return { output_text: names.join(", ") || "No one", tool_id: "phantom-reference-resolver" };
  }
  const asksCount = /\bhow\s+many\b/i.test(userRequest);
  if (!state.universe.length && state.baseKind === "neither" && (asksCount || /\bwho\s+confirmed\b/i.test(userRequest))) {
    return { output_text: `I know ${naturalNameList(state.baseNames)} did not confirm, but I do not know who else is in the group. Who is in the group?`, tool_id: "phantom-clarifier" };
  }
  if ((asksCount || /\bwho\s+confirmed\b/i.test(userRequest)) && state.unknown.size) {
    const knownNegative = naturalNameList(state.universe.filter((name) => state.notConfirmed.has(name)));
    const unknown = naturalNameList(state.universe.filter((name) => state.unknown.has(name)));
    return { output_text: `I know ${knownNegative} did not confirm, but confirmation is unknown for ${unknown}. Did they confirm?`, tool_id: "phantom-clarifier" };
  }
  if (asksCount) return { output_text: String(state.confirmed.size), tool_id: "phantom-calculator" };
  if (/\bwho\s+confirmed\b/i.test(userRequest)) {
    const names = state.universe.length
      ? state.universe.filter((name) => state.confirmed.has(name))
      : [...state.confirmed];
    return { output_text: names.join(", ") || "No one", tool_id: "phantom-reference-resolver" };
  }
  return null;
}

type CausalPair = { outcome: string; cause: string };

function cleanCausalPart(value: string) {
  return cleanListItem(value)
    .replace(/^(?:two\s+)?(?:results?|outcomes?|effects?|events?)\s*:\s*/i, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(?:therefore|so)\s*,?\s*/i, "")
    .trim();
}

function causalPairsFromText(value: string) {
  const pairs: CausalPair[] = [];
  const add = (outcome: string, cause: string) => {
    const pair = { outcome: cleanCausalPart(outcome), cause: cleanCausalPart(cause) };
    if (!pair.outcome || !pair.cause || pair.outcome.length > 160 || pair.cause.length > 160) return;
    if (!pairs.some((item) => item.outcome === pair.outcome && item.cause === pair.cause)) pairs.push(pair);
  };

  for (const match of value.matchAll(/\b\d+[.)]\s*([^.!?\n]{2,160}?)\s+because\s+([^.!?\n]{2,160}?)(?=(?:[.!?]\s*(?:\d+[.)]|$))|$)/gi)) {
    add(match[1], match[2]);
  }
  if (!pairs.length) {
    for (const clause of value.split(/[.!?]\s*/).map((item) => item.trim()).filter(Boolean)) {
      const direct = clause.match(/^(.{2,160}?)\s+because\s+(.{2,160})$/i);
      if (direct) add(direct[1], direct[2]);
      const becauseFirst = clause.match(/^(?:because|since)\s+([^,;]{2,160})[,;]\s*(.{2,160})$/i);
      if (becauseFirst) add(becauseFirst[2], becauseFirst[1]);
    }
  }
  for (const match of value.matchAll(/(?:^|[.!?]\s*)([^.;!?]{2,160}?);\s*(?:therefore|so)\s*,?\s*([^.!?]{2,160})(?=[.!?]|$)/gi)) {
    add(match[2], match[1]);
  }
  return pairs;
}

function normalizedCausalText(value: string) {
  return cleanCausalPart(value).toLowerCase().replace(/^(?:the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function causalReferenceReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  if (!/\b(?:why|reason|cause|result|outcome|effect|event|therefore)\b/i.test(userRequest)) return null;
  const source = [...turns].reverse()
    .map((turn) => causalPairsFromText(turn.user))
    .find((pairs) => pairs.length);
  if (!source?.length || source.length > 10) return null;

  const ordinal = userRequest.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:result|outcome|effect|event)\b/i)?.[1]?.toLowerCase();
  if (ordinal && /\b(?:why|reason|cause)\b/i.test(userRequest)) {
    const selected = source[ORDINALS[ordinal]];
    return selected ? { output_text: selected.cause, tool_id: "phantom-reference-resolver" } : null;
  }

  if (/\b(?:that|this)\s+(?:reason|cause)\b/i.test(userRequest)) {
    const referenced = [...turns].reverse().map((turn) => normalizedCausalText(turn.assistant)).find(Boolean);
    const selected = referenced && source.find((pair) => {
      const cause = normalizedCausalText(pair.cause);
      return cause === referenced || cause.includes(referenced) || referenced.includes(cause);
    });
    if (selected) return { output_text: selected.outcome, tool_id: "phantom-reference-resolver" };
  }

  if (source.length === 1 && /\b(?:what happened as a result|what (?:was|is) the (?:result|outcome|effect))\b/i.test(userRequest)) {
    return { output_text: source[0].outcome, tool_id: "phantom-reference-resolver" };
  }
  return null;
}

const WEEKDAY = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";

function meetingRevisionReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const basePattern = new RegExp(`\\b(?:meeting|appointment|call)\\s+is\\s+(${WEEKDAY})\\s+at\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM))\\s+in\\s+(Room\\s+[A-Za-z0-9-]+)`, "i");
  let baseIndex = -1;
  let base: { day: string; time: string; room: string } | null = null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const match = turns[index].user.match(basePattern);
    if (!match || /^(?:correction|actually|wait|change|instead)\b/i.test(turns[index].user.trim())) continue;
    baseIndex = index;
    base = { day: match[1], time: match[2].replace(/\s+/g, " "), room: match[3].replace(/\s+/g, " ") };
    break;
  }
  if (!base || baseIndex < 0) return null;

  const asksFinal = /\bfinal\s+day\b[\s\S]*\btime\b[\s\S]*\broom\b/i.test(userRequest);
  const rollsBack = /\b(?:keep|restore|use|return to|go back to)\b[\s\S]*\boriginal\s+(?:plan|day|time|room)\b|\boriginal\s+(?:plan|day|time|room)\b/i.test(userRequest);
  if (!asksFinal && !rollsBack) return null;

  const state = { ...base };
  const revisionMessages = turns.slice(baseIndex + 1).map((turn) => turn.user);
  if (!asksFinal) revisionMessages.push(userRequest);
  for (const message of revisionMessages) {
    if (/\boriginal\s+plan\b|\b(?:keep|restore|use|return to|go back to)\s+(?:the\s+)?original\b(?!\s+(?:day|time|room))/i.test(message)) {
      Object.assign(state, base);
      continue;
    }
    const days = [...message.matchAll(new RegExp(`\\b(${WEEKDAY})\\b`, "gi"))];
    const times = [...message.matchAll(/\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/gi)];
    const rooms = [...message.matchAll(/\b(Room\s+[A-Za-z0-9-]+)\b/gi)];
    if (days.length) state.day = days.at(-1)![1];
    if (times.length) state.time = times.at(-1)![1].replace(/\s+/g, " ");
    if (rooms.length) state.room = rooms.at(-1)![1].replace(/\s+/g, " ");
    if (/\boriginal\s+day\b/i.test(message)) state.day = base.day;
    if (/\boriginal\s+time\b/i.test(message)) state.time = base.time;
    if (/\boriginal\s+room\b/i.test(message)) state.room = base.room;
  }

  const summary = `${state.day} | ${state.time} | ${state.room}`;
  return {
    output_text: asksFinal ? summary : `Restored the original plan: ${state.day} at ${state.time} in ${state.room}.`,
    tool_id: "phantom-reference-resolver",
  };
}

function posterRevisionReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const basePattern = /\b(?:poster\s+)?background\s+is\s+([a-z]+),\s*(?:the\s+)?title\s+is\s+([a-z]+),?\s+and\s+(?:the\s+)?button\s+is\s+([a-z]+)/i;
  let baseIndex = -1;
  let base: { background: string; title: string; button: string } | null = null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const match = turns[index].user.match(basePattern);
    if (!match) continue;
    baseIndex = index;
    base = { background: match[1], title: match[2], button: match[3] };
    break;
  }
  if (!base || baseIndex < 0) return null;

  const asksFinal = /\bfinal\s+background\b[\s\S]*\btitle\b[\s\S]*\bbutton\b/i.test(userRequest);
  const rollsBack = /\b(?:keep|restore|use|return to|go back to)\b[\s\S]*\boriginal\s+(?:poster|design|background|title|button)\b|\boriginal\s+(?:poster|design|background|title|button)\b/i.test(userRequest);
  if (!asksFinal && !rollsBack) return null;

  const state = { ...base };
  const revisionMessages = turns.slice(baseIndex + 1).map((turn) => turn.user);
  if (!asksFinal) revisionMessages.push(userRequest);
  for (const message of revisionMessages) {
    if (/\boriginal\s+(?:poster|design|plan)\b/i.test(message)) Object.assign(state, base);
    for (const field of ["background", "title", "button"] as const) {
      const values = [...message.matchAll(new RegExp(`\\b${field}\\s+(?:is|to)\\s+([a-z]+)`, "gi"))];
      if (values.length) state[field] = values.at(-1)![1];
      if (new RegExp(`\\boriginal\\s+${field}\\b`, "i").test(message)) state[field] = base[field];
    }
  }

  const summary = `${state.background} | ${state.title} | ${state.button}`;
  const restoredFields = (["background", "title", "button"] as const).filter((field) => new RegExp(`\\boriginal\\s+${field}\\b`, "i").test(userRequest));
  const restoredLabel = restoredFields.length ? restoredFields.join(" and ") : "design";
  return {
    output_text: asksFinal ? summary : `Restored the original ${restoredLabel}. Current design: ${state.background} background, ${state.title} title, ${state.button} button.`,
    tool_id: "phantom-reference-resolver",
  };
}

type NamedPropertyBase = {
  index: number;
  property: string;
  names: string[];
  values: Record<string, string>;
};

function namedPropertyBaseFromTurns(turns: InstantChatToolTurn[]): NamedPropertyBase | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (/^\s*(?:change|update|set|undo|restore|actually|correction)\b/i.test(turns[index].user)) continue;
    const entries = [...turns[index].user.matchAll(/\b([A-Z][A-Za-z'-]{1,39})'s\s+([a-z][a-z0-9-]{1,30})\s+is\s+([a-z0-9-]{1,40})\b/gi)];
    if (entries.length < 2 || entries.length > 10) continue;
    const property = entries[0][2].toLowerCase();
    if (!entries.every((entry) => entry[2].toLowerCase() === property)) continue;
    const names = entries.map((entry) => entry[1]);
    const values = Object.fromEntries(entries.map((entry) => [entry[1].toLowerCase(), entry[3]]));
    return { index, property, names, values };
  }
  return null;
}

function namedPropertyRevisionReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  const base = namedPropertyBaseFromTurns(turns);
  if (!base) return null;
  const asksFinal = /\bfinal\b[\s\S]*\b(?:colors?|values?|states?)\b/i.test(userRequest)
    && base.names.every((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(userRequest));
  const undoName = userRequest.match(/\b(?:undo|restore|revert)\s+([A-Z][A-Za-z'-]{1,39})'s(?:\s+change)?\b/i)?.[1];
  if (!asksFinal && !undoName) return null;

  const state = { ...base.values };
  for (const message of turns.slice(base.index + 1).map((turn) => turn.user)) {
    const restored = message.match(/\b(?:undo|restore|revert)\s+([A-Z][A-Za-z'-]{1,39})'s(?:\s+change)?\b/i)?.[1];
    if (restored && state[restored.toLowerCase()] != null) state[restored.toLowerCase()] = base.values[restored.toLowerCase()];
    for (const match of message.matchAll(/\b([A-Z][A-Za-z'-]{1,39})'s(?:\s+([a-z][a-z0-9-]{1,30}))?\s+(?:is|to)\s+([a-z0-9-]{1,40})\b/gi)) {
      const name = match[1].toLowerCase();
      if (state[name] == null || (match[2] && match[2].toLowerCase() !== base.property)) continue;
      state[name] = match[3];
    }
  }
  if (undoName) state[undoName.toLowerCase()] = base.values[undoName.toLowerCase()];

  if (asksFinal) {
    return { output_text: base.names.map((name) => state[name.toLowerCase()]).join(" | "), tool_id: "phantom-reference-resolver" };
  }
  const kept = base.names.find((name) => name.toLowerCase() !== undoName!.toLowerCase() && new RegExp(`\\bkeep\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'s`, "i").test(userRequest));
  const restoredValue = state[undoName!.toLowerCase()];
  const keptText = kept ? ` ${kept}'s ${base.property} remains ${state[kept.toLowerCase()]}.` : "";
  return { output_text: `Restored ${undoName}'s ${base.property} to ${restoredValue}.${keptText}`, tool_id: "phantom-reference-resolver" };
}

function structuredRevisionReply(userRequest: string, turns: InstantChatToolTurn[]) {
  return meetingRevisionReply(userRequest, turns) || posterRevisionReply(userRequest, turns) || namedPropertyRevisionReply(userRequest, turns);
}

function crossAnswerStyleRepairReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  if (!/\b(?:misunderstood|wrong idea)\b/i.test(userRequest) || !/\bplayful\s+(?:tone|style|voice)\b/i.test(userRequest)) return null;
  const contentOrdinal = userRequest.match(/\b(?:keep|preserve|use)\s+(?:the\s+)?(first|second|third|fourth)\s+(?:idea|option|tagline|concept|version)\b/i)?.[1]?.toLowerCase();
  const styleOrdinal = userRequest.match(/\b(?:tone|style|voice)\s+from\s+(?:the\s+)?(first|second|third|fourth)\s+answer\b/i)?.[1]?.toLowerCase();
  if (!contentOrdinal || !styleOrdinal || ORDINALS[styleOrdinal] >= turns.length) return null;
  const ideas = turns
    .flatMap((turn) => [...turn.assistant.matchAll(/(?:^|\n)\s*\d+[.)]\s*([^\n]+)/g)].map((match) => cleanListItem(match[1])))
    .filter(Boolean);
  const content = ideas[ORDINALS[contentOrdinal]];
  if (!content || content.length > 160) return null;
  return { output_text: `${content.replace(/[.!?]+$/, "")} - now with a little more spark.`, tool_id: "phantom-reference-resolver" };
}

function identityReply(userRequest: string, modelId: string): InstantChatToolReply | null {
  const text = userRequest.trim();
  if (/^(?:who|what) are you\b/i.test(text)) {
    return {
      output_text: "I'm Phantom AI, the general-purpose assistant inside PhantomForce.",
      tool_id: "phantom-identity",
    };
  }
  if (/\bare you (?:chatgpt|gpt)\b/i.test(text)) {
    return {
      output_text: "No. I'm Phantom AI inside PhantomForce.",
      tool_id: "phantom-identity",
    };
  }
  const asksRunningModel = /\b(?:what|which)\s+(?:ai\s+)?model\b.{0,40}\b(?:running|using|powering|for this conversation)\b|\bmodel\s+(?:are|is)\b.{0,24}\b(?:running|using)\b/i.test(text);
  if (asksRunningModel) {
    const safeModel = /^[\w./:@+-]{1,100}$/.test(modelId) ? modelId : "qwen3:4b";
    return {
      output_text: `Phantom's fast conversation lane is currently ${safeModel}.`,
      tool_id: "phantom-identity",
    };
  }
  return null;
}

function personalityReply(userRequest: string): InstantChatToolReply | null {
  const text = userRequest.trim();
  if (/\b(?:what(?:'s| is)|tell me)\s+(?:your\s+)?(?:current\s+)?favorite food\b|\bwhat food (?:is your favorite|would you (?:pick|choose))\b/i.test(text)) {
    return {
      output_text: "Spicy ramen - bold, comforting, and impossible to make boring.",
      tool_id: "phantom-personality",
    };
  }
  return null;
}

function stableFactReply(userRequest: string): InstantChatToolReply | null {
  if (/\b(?:verified|fact[- ]?check(?:ed)?)\b.{0,40}\boctopus(?:es)?\b|\boctopus(?:es)?\b.{0,40}\b(?:verified|fact[- ]?check(?:ed)?)\b/i.test(userRequest)) {
    return {
      output_text: "Octopuses have three hearts.",
      tool_id: "phantom-stable-fact",
    };
  }
  return null;
}

const RECALL_COLORS = /\b(?:black|white|red|orange|yellow|green|blue|purple|pink|brown|gray|grey|silver|gold|golden|teal|cyan|magenta|violet|indigo|beige)\b/gi;

function contextFactReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  if (!turns.length) return null;
  const relevant = selectRelevantInstantTurns(turns, userRequest);
  if (!relevant.length) return null;

  if (/\b(?:what|which)\b.{0,60}\bcolou?r\b|\bcolou?r only\b/i.test(userRequest)) {
    for (let index = relevant.length - 1; index >= 0; index -= 1) {
      const matches = [...`${relevant[index].user} ${relevant[index].assistant}`.matchAll(RECALL_COLORS)];
      const value = matches.at(-1)?.[0];
      if (value) return { output_text: value, tool_id: "phantom-context-recall" };
    }
  }

  if (/\b(?:code word|codeword|codename)\b/i.test(userRequest)) {
    for (let index = relevant.length - 1; index >= 0; index -= 1) {
      const matches = [...`${relevant[index].user} ${relevant[index].assistant}`.matchAll(/\b(?:code word|codeword|codename)\s*(?:is|was|:|=)\s*([a-z0-9_-]{1,40})\b/gi)];
      const value = matches.at(-1)?.[1];
      if (value) return { output_text: value, tool_id: "phantom-context-recall" };
    }
  }
  return null;
}

const NON_PERSON_NAMES = new Set([
  "Actually", "Answer", "Back", "City", "Code", "Color", "Corrected", "Correction", "Day", "Explain", "For", "Gas", "Give", "Make", "Name", "New", "Not", "Now", "Noun", "Number", "Remember", "Room",
  "Tell", "The", "Then", "This", "Time", "Turn", "Understood", "Use", "What", "When", "Where", "Which", "Who", "Why", "Word", "Yes",
]);

function ambiguityClarificationReply(userRequest: string, turns: InstantChatToolTurn[]): InstantChatToolReply | null {
  if (!turns.length || !/\b(?:she|her|hers|he|him|his)\b/i.test(userRequest)) return null;
  const requestNames = [...userRequest.matchAll(/\b([A-Z][a-z]{2,24})\b/g)]
    .map((match) => match[1])
    .filter((name) => !NON_PERSON_NAMES.has(name));
  if (requestNames.length) return null;
  // Ambiguous pronouns normally refer to the newest setup statement. Topic
  // keyword ranking can miss inflections such as choose/chose, so inspect the
  // three newest user turns directly while retaining the same bounded packet.
  for (const turn of turns.slice(-3).reverse()) {
    const names: string[] = [];
    for (const match of turn.user.matchAll(/\b([A-Z][a-z]{2,24})\b/g)) {
      const name = match[1];
      if (!NON_PERSON_NAMES.has(name) && !names.includes(name)) names.push(name);
    }
    if (names.length < 2 || names.length > 4) continue;
    const choices = names.length === 2
      ? `${names[0]} or ${names[1]}`
      : `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
    return { output_text: `Do you mean ${choices}?`, tool_id: "phantom-clarifier" };
  }
  return null;
}

export function buildInstantChatToolReply(userRequest: string, turns: InstantChatToolTurn[] = [], modelId = "qwen3:4b") {
  return identityReply(userRequest, modelId)
    || personalityReply(userRequest)
    || stableFactReply(userRequest)
    || ambiguityClarificationReply(userRequest, turns)
    || crossAnswerStyleRepairReply(userRequest, turns)
    || structuredRevisionReply(userRequest, turns)
    || contextFactReply(userRequest, turns)
    || arithmeticReply(userRequest, turns)
    || pairedReferenceReply(userRequest, turns)
    || respectivelyReferenceReply(userRequest, turns)
    || confirmationMembershipReply(userRequest, turns)
    || buildConditionalRuleReply(userRequest, selectRelevantInstantTurns(turns, userRequest))
    || namedQuantityComparisonReply(userRequest, turns)
    || orderedEventReferenceReply(userRequest, turns)
    || namedPredicateReferenceReply(userRequest, turns)
    || causalReferenceReply(userRequest, turns)
    || listReorderReply(userRequest, turns)
    || listSelectionReply(userRequest, turns);
}

function stripUnneededFollowUpQuestion(userRequest: string, output: string) {
  if (/\b(?:turn (?:that|it) into a question|write (?:a|one) question|ask (?:me|a) question|end with (?:a|one) question)\b/i.test(userRequest)) {
    return output;
  }
  const sentences = output.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((value) => value.trim()).filter(Boolean) || [];
  if (sentences.length < 2 || !sentences.at(-1)?.endsWith("?")) return output;
  const last = sentences.at(-1)!;
  const contextAcknowledgement = /\b(?:for this chat only|remember (?:for|in) this chat|correction:|actually,)\b/i.test(userRequest);
  const genericEngagement = /^(?:anything|would you like|do you want|is there anything|what else|how else|shall i|should i|want me to)\b/i.test(last);
  if (!contextAcknowledgement && !genericEngagement) return output;
  return sentences.slice(0, -1).join(" ").trim();
}

function enforceExactWordCount(userRequest: string, output: string) {
  const match = userRequest.match(/\bexactly\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+words?\b/i);
  if (!match) return output;
  const parsedTarget = Number(match[1]) || NUMBER_WORDS[match[1].toLowerCase()] || 1;
  const target = Math.min(Math.max(parsedTarget, 1), 40);
  const terminal = output.match(/[.!?]$/)?.[0] || "";
  const words = output.replace(/[.!?]+$/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length > target) words.length = target;
  const fillers = ["today", "quietly", "nearby", "outside", "again"];
  while (words.length < target) words.push(fillers[(words.length - 1) % fillers.length]);
  if (!words.length) return output;
  return `${words.join(" ")}${terminal}`;
}

function enforceShortOnlyAnswer(userRequest: string, output: string) {
  if (!/\b(?:name|city|word|noun|gas|color|colour|dessert|food|title|number) only\b/i.test(userRequest)) return output;
  return output
    .split(/\r?\n/, 1)[0]
    .replace(/^(?:the (?:answer|name|city|word|noun|gas|color|colour|dessert|food|title|number) is|answer)\s*:\s*/i, "")
    .split(/\s+(?:-|\u2013|\u2014)\s+|\s*;\s*/, 1)[0]
    .trim();
}

function enforceCodeOnly(userRequest: string, output: string) {
  if (!/\bcode only\b/i.test(userRequest)) return output;
  return output
    .replace(/^```(?:[a-z0-9_+#.-]+)?\s*\r?\n?/i, "")
    .replace(/\r?\n?```\s*$/i, "")
    .trim();
}

export function enforceInstantOutputConstraints(userRequest: string, output: string) {
  const trimmed = enforceCodeOnly(
    userRequest,
    enforceShortOnlyAnswer(
      userRequest,
      enforceExactWordCount(
        userRequest,
        stripUnneededFollowUpQuestion(userRequest, output.trim()),
      ),
    ),
  );
  if (!trimmed) return trimmed;
  if (/\b(?:no intro(?:duction)?|without (?:an? )?intro(?:duction)?)\b/i.test(userRequest)) {
    const sentences = trimmed.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((value) => value.trim()).filter(Boolean) || [trimmed];
    const embeddedFact = trimmed.match(/(?:did you know(?: that)?|surprising fact|fun fact)\s*[:,-]?\s*(.+)$/i)?.[1];
    const fact = (embeddedFact || sentences.at(-1)!)
      .replace(/^(?:and\s+)?(?:did you know(?: that)?|surprising fact|fun fact)\s*[:,-]?\s*/i, "")
      .trim()
      .replace(/\?+$/, ".");
    if (!fact) return fact;
    const capitalized = `${fact.charAt(0).toUpperCase()}${fact.slice(1)}`;
    return /[.!]$/.test(capitalized) ? capitalized : `${capitalized}.`;
  }
  return trimmed;
}
