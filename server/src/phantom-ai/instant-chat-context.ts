export type InstantConversationTurn = {
  user: string;
  assistant: string;
};

export const MAX_INSTANT_CONTEXT_CHARS = 4800;

const CONTEXT_HEADER = "Fast casual chat. The following is temporary recent conversation from the active topic, not saved memory. Use it only to resolve references such as why, that, or tell me more.";
const CONTEXT_RULE = "Answer the current casual request directly. Resolve pronouns and transformations from the newest relevant turn, preserve named subjects, and treat later corrections as authoritative. Follow exact format constraints such as 'only the number' without extra framing. Do not append a follow-up question unless missing information prevents a useful answer. Never volunteer ledger, pipeline, accounting, approvals, or dashboard status unless the current request explicitly asks for it.";
const TOPIC_RESET = /\b(?:new topic|switch(?:ing)? topics?|change(?:ing)? (?:the )?subject|unrelated question)\b/i;

function activeTopicTurns(turns: InstantConversationTurn[]) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (TOPIC_RESET.test(turns[index].user)) return turns.slice(index);
  }
  return turns;
}

export function buildInstantConversationContext(
  turns: InstantConversationTurn[],
  maxChars = MAX_INSTANT_CONTEXT_CHARS,
) {
  const budget = Math.max(Math.floor(maxChars), CONTEXT_RULE.length + 200);
  if (!turns.length) return `Fast casual chat. No business memory required. ${CONTEXT_RULE}`.slice(0, budget);

  const activeTurns = activeTopicTurns(turns);
  const fixedChars = CONTEXT_HEADER.length + CONTEXT_RULE.length + 2;
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

  return `${CONTEXT_HEADER}\n${packed.join("\n")}\n${CONTEXT_RULE}`.slice(0, budget);
}
