export type InstantConversationTurn = {
  user: string;
  assistant: string;
};

export const MAX_INSTANT_CONTEXT_CHARS = 4800;

const CONTEXT_HEADER = "Fast casual chat. The following is temporary recent conversation from the active topic, not saved memory. Use it only to resolve references such as why, that, or tell me more.";
const CONTEXT_RULE = "Answer the current casual request directly. Resolve pronouns and transformations from the newest relevant turn, preserve named subjects, and treat later corrections as authoritative, including explicit negation. When the user says you misunderstood, repair the answer from their latest instruction instead of defending or repeating yourself. When combining one answer's idea or content with another answer's tone or style, preserve the requested source idea and borrow only the requested stylistic traits; never substitute the style-source content. When the user asks for a replacement, shorter version, final item, or one new fact, return the replacement only instead of repeating earlier material. Follow exact format constraints such as 'only the number' without extra framing. When an approximate word count is requested, aim within 20 percent of it instead of stopping early. For factual claims, use stable knowledge and never invent a plausible-sounding detail; say when you are unsure. Ask one concise clarification question only when multiple interpretations are genuinely plausible; otherwise answer without a follow-up question. Never volunteer ledger, pipeline, accounting, approvals, or dashboard status unless the current request explicitly asks for it.";
const TOPIC_RESET = /\b(?:new topic|switch(?:ing)? topics?|change(?:ing)? (?:the )?subject|unrelated question)\b/i;
const FOLLOW_UP_SIGNAL = /^(?:why\s+(?:that|it|this|so|them|those|one)\b|why\s*\?|how (?:so|come|about)\b|another\b|more\b|shorter\b|longer\b|again\b|continue\b|go on\b|now\b|actually\b|correction\b|instead\b|same\b|pick\b|choose\b|use\b|do you agree\b|is that true\b|are you sure\b|make (?:it|that|this|them|(?:the )?(?:comparison|answer|sentence|story|list|version))\b|turn (?:it|that|this)\b|answer (?:it|that|the question)\b|what about\b|tell me more\b|(?:give|show) me (?:an? )?example\b|give me .{0,20}\bmore\b|give me (?:only )?(?:the )?(?:corrected|final|next|same|other|another|more)\b|end with\b|double-check\b|ahora\b|dilo\b|otra\b|m[a\u00e1]s corto\b)/i;
const IMPLICIT_FOLLOW_UP = /^(?:how long should i (?:stay|wait|spend|plan for)\b|what should i (?:know|do|try|learn|read|watch|buy|make|say|ask|pick|choose)\s*(?:first|next)?\s*\??$|where should i (?:start|begin|go)\b|what (?:would|do) you recommend\s*\??$|any (?:advice|tips|recommendations?)\s*\??$)/i;
const CONTEXT_REFERENCE = /\b(?:it|that|this|them|those|these|former|latter|above|previous|earlier|last answer|same one|which one|the other|her|hers|him|they|there|corrected|final)\b/i;
const CONTEXT_OPERATION = /\b(?:then|also|instead|add|apply|remove|rephrase|rewrite|translate|summarize|simplify|expand|combine|compare them)\b/i;
const CROSS_ANSWER_REFERENCE = /\b(?:first|second|third|fourth)\s+(?:idea|option|tagline|concept|version)\b[\s\S]*\b(?:first|second|third|fourth)\s+answer\b/i;
const PAIRED_REFERENCE = /\b(?:former|latter)\b/i;
const PLURAL_REFERENCE = /\b(?:they|them|their|theirs|those|these)\b/i;
const CONTEXT_STOP_WORDS = new Set([
  "about", "after", "again", "answer", "back", "before", "could", "current", "does", "explain", "favorite", "first", "from", "give", "have", "into", "just", "know", "latest", "make", "more", "next", "only", "please", "question", "recommend", "sentence", "should", "something", "stay", "tell", "that", "their", "then", "there", "these", "thing", "this", "those", "what", "when", "where", "which", "would", "write", "your",
]);

const ORDINAL_INDEX: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
};

function correctionSourceBrief(turns: InstantConversationTurn[], userRequest: string) {
  if (!/\b(?:misunderstood|wrong idea|keep|preserve)\b/i.test(userRequest)
    || !/\b(?:tone|style|voice)\b/i.test(userRequest)) return "";

  const contentOrdinal = userRequest.match(/\b(first|second|third|fourth)\s+(?:idea|option|tagline|concept|version)\b/i)?.[1]?.toLowerCase();
  const styleAnswerOrdinal = userRequest.match(/\b(?:tone|style|voice)\s+from\s+(?:the\s+)?(first|second|third|fourth)\s+answer\b/i)?.[1]?.toLowerCase();
  if (!contentOrdinal || !styleAnswerOrdinal) return "";

  const numberedIdeas = turns
    .flatMap((turn) => [...turn.assistant.matchAll(/(?:^|\n)\s*\d+[.)]\s*([^\n]+)/g)].map((match) => match[1].trim()))
    .filter(Boolean);
  const content = numberedIdeas[ORDINAL_INDEX[contentOrdinal]];
  const style = turns[ORDINAL_INDEX[styleAnswerOrdinal]]?.assistant.trim();
  if (!content || !style) return "";

  return [
    "Authoritative correction brief:",
    `CONTENT TO PRESERVE: ${content}`,
    `STYLE REFERENCE ONLY: ${style}`,
    "Rewrite the content-to-preserve in the style reference's tone. Do not reuse or substitute the style reference's subject, claim, or wording.",
  ].join("\n");
}

export function buildInstantConversationUserMessage(turns: InstantConversationTurn[], userRequest: string) {
  const correctionBrief = correctionSourceBrief(turns, userRequest);
  if (!correctionBrief) return userRequest;
  const content = correctionBrief.match(/^CONTENT TO PRESERVE:\s*(.+)$/m)?.[1]?.trim();
  const requestedTone = userRequest.match(/\b(?:use|with|in)\s+(?:the\s+)?([a-z][a-z -]{0,30}?)\s+(?:tone|style|voice)\b/i)?.[1]?.trim();
  if (!content) return userRequest;
  return [
    "Correction task. Rewrite this exact content while preserving its meaning and subject:",
    content,
    `Requested tone: ${requestedTone || "match the referenced answer's stylistic traits only"}.`,
    userRequest.match(/\bone sentence\b/i) ? "Format: one sentence." : "",
    "Return only the rewrite. Do not mention, quote, or substitute any other prior idea.",
  ].filter(Boolean).join("\n");
}

function meaningfulTerms(value: string) {
  return new Set((value.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((term) => !CONTEXT_STOP_WORDS.has(term)));
}

function hasTopicOverlap(turns: InstantConversationTurn[], userRequest: string) {
  const requestTerms = meaningfulTerms(userRequest);
  if (!requestTerms.size) return false;
  const priorTerms = meaningfulTerms(turns.slice(-3).map((turn) => `${turn.user} ${turn.assistant}`).join(" "));
  return [...requestTerms].some((term) => priorTerms.has(term));
}

export function needsInstantConversationContext(turns: InstantConversationTurn[], userRequest: string) {
  const text = userRequest.trim();
  if (!turns.length || !text || TOPIC_RESET.test(text)) return false;
  return FOLLOW_UP_SIGNAL.test(text)
    || IMPLICIT_FOLLOW_UP.test(text)
    || CONTEXT_REFERENCE.test(text)
    || CONTEXT_OPERATION.test(text)
    || hasTopicOverlap(turns, text);
}

export function selectActiveInstantTopicTurns(turns: InstantConversationTurn[]) {
  let topicStart = 0;
  for (let index = 0; index < turns.length; index += 1) {
    if (TOPIC_RESET.test(turns[index].user)) {
      topicStart = index;
      continue;
    }
    if (index > topicStart && !needsInstantConversationContext(turns.slice(topicStart, index), turns[index].user)) {
      topicStart = index;
    }
  }
  return turns.slice(topicStart);
}

export function selectRelevantInstantTurns(turns: InstantConversationTurn[], userRequest = "") {
  if (CROSS_ANSWER_REFERENCE.test(userRequest)) return turns.slice(-6);
  const activeTurns = selectActiveInstantTopicTurns(turns);
  if (PAIRED_REFERENCE.test(userRequest) || PLURAL_REFERENCE.test(userRequest)) return activeTurns.slice(-6);
  const requestTerms = meaningfulTerms(userRequest);
  if (!requestTerms.size) return activeTurns;

  const matchingIndexes: number[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turnTerms = meaningfulTerms(`${turns[index].user} ${turns[index].assistant}`);
    if ([...requestTerms].some((term) => turnTerms.has(term))) matchingIndexes.push(index);
  }
  if (!matchingIndexes.length) return activeTurns;

  const selected = new Set<number>();
  for (const index of matchingIndexes) {
    selected.add(index);
    // A correction or transformation immediately after a named turn often
    // carries only a pronoun ("actually, it is purple"). Keep that local
    // continuation, but stop as soon as the conversation starts a new topic.
    for (let next = index + 1; next < Math.min(turns.length, index + 3); next += 1) {
      if (TOPIC_RESET.test(turns[next].user)) break;
      if (!needsInstantConversationContext(turns.slice(index, next), turns[next].user)) break;
      selected.add(next);
    }
  }

  const relevant = turns.filter((_, index) => selected.has(index));
  return relevant.length ? relevant.slice(-6) : activeTurns;
}

export function buildInstantConversationContext(
  turns: InstantConversationTurn[],
  userRequest = "",
  maxChars = MAX_INSTANT_CONTEXT_CHARS,
) {
  const budget = Math.max(Math.floor(maxChars), CONTEXT_RULE.length + 200);
  if (!turns.length || (userRequest && !needsInstantConversationContext(turns, userRequest))) {
    return `Fast casual chat. The current request is standalone; do not carry over prior topics. No business memory required. ${CONTEXT_RULE}`.slice(0, budget);
  }

  const activeTurns = selectRelevantInstantTurns(turns, userRequest);
  const correctionBrief = correctionSourceBrief(turns, userRequest);
  const fixedChars = CONTEXT_HEADER.length + CONTEXT_RULE.length + correctionBrief.length + (correctionBrief ? 3 : 2);
  let remaining = Math.max(budget - fixedChars, 0);
  const packed: string[] = [];

  for (let index = activeTurns.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const turnNumber = index + 1;
    const block = `Turn ${turnNumber} user: ${activeTurns[index].user}\nTurn ${turnNumber} assistant: ${activeTurns[index].assistant}`;
    const separatorChars = packed.length ? 1 : 0;
    if (block.length + separatorChars <= remaining) {
      packed.unshift(block);
      remaining -= block.length + separatorChars;
      continue;
    }
    if (!packed.length) {
      const newestUser = `Turn ${turnNumber} user: ${activeTurns[index].user}`;
      const assistantPrefix = `\nTurn ${turnNumber} assistant: `;
      const assistantBudget = Math.max(remaining - newestUser.length - assistantPrefix.length, 0);
      const assistantTail = assistantBudget > 0 ? activeTurns[index].assistant.slice(-assistantBudget) : "";
      packed.unshift(`${newestUser}${assistantPrefix}${assistantTail}`);
    }
    break;
  }

  return `${CONTEXT_HEADER}\n${packed.join("\n")}${correctionBrief ? `\n${correctionBrief}` : ""}\n${CONTEXT_RULE}`.slice(0, budget);
}
