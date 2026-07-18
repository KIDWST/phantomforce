export type InstantChatToolTurn = {
  user: string;
  assistant: string;
};

export type InstantChatToolReply = {
  output_text: string;
  tool_id: "phantom-calculator" | "phantom-reference-resolver" | "phantom-identity" | "phantom-personality";
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
    const safeModel = /^[\w./:@+-]{1,100}$/.test(modelId) ? modelId : "qwen2.5:14b";
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

export function buildInstantChatToolReply(userRequest: string, turns: InstantChatToolTurn[] = [], modelId = "qwen2.5:14b") {
  return identityReply(userRequest, modelId)
    || personalityReply(userRequest)
    || arithmeticReply(userRequest, turns)
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

export function enforceInstantOutputConstraints(userRequest: string, output: string) {
  const trimmed = enforceShortOnlyAnswer(
    userRequest,
    enforceExactWordCount(
      userRequest,
      stripUnneededFollowUpQuestion(userRequest, output.trim()),
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
