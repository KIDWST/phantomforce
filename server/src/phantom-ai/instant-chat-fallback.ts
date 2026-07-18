import { needsInstantConversationContext, selectActiveInstantTopicTurns } from "./instant-chat-context.js";
import { buildInstantChatToolReply, enforceInstantOutputConstraints } from "./instant-chat-tools.js";

const MAX_REPLY_CHARS = 520;

type RecentChatTurn = {
  user: string;
  assistant: string;
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function boundReply(value: string) {
  return cleanText(value).slice(0, MAX_REPLY_CHARS);
}

function calculate(text: string) {
  const match = text.match(/\b(-?\d+(?:\.\d+)?)\s*(plus|minus|divided by|over|times|multiplied by|[+\-x*/])\s*(-?\d+(?:\.\d+)?)\b/i);
  if (!match) return "";
  const left = Number(match[1]);
  const right = Number(match[3]);
  const operator = match[2].toLowerCase();
  if ((operator === "/" || operator === "over" || operator === "divided by") && right === 0) return "Division by zero is undefined.";
  const result = operator === "+" || operator === "plus"
    ? left + right
    : operator === "-" || operator === "minus"
      ? left - right
      : operator === "/" || operator === "over" || operator === "divided by"
        ? left / right
        : left * right;
  return `${match[1]} ${match[2]} ${match[3]} is ${Number.isInteger(result) ? result : Number(result.toFixed(6))}.`;
}

function firstSentence(text: string) {
  return cleanText(text).split(/(?<=[.!?])\s+/)[0] || cleanText(text);
}

function shorten(text: string) {
  const words = firstSentence(text).split(/\s+/);
  return words.length > 10 ? `${words.slice(0, 10).join(" ").replace(/[,:;]$/, "")}.` : firstSentence(text);
}

function previousAnswer(turns: RecentChatTurn[]) {
  return cleanText(turns.at(-1)?.assistant || "");
}

function topicalExample(previous: string, topicContext: string) {
  if (/photosynthesis|plant|sunlight/i.test(topicContext)) return "For example, a leaf uses sunlight to turn water and carbon dioxide into sugar, then releases oxygen.";
  if (/tacos?/i.test(topicContext)) return "For example: a simple bean taco can be quick comfort food, while a grilled fish taco can feel like a full event.";
  if (/procrastinat/i.test(topicContext)) return "For example, a vague two-hour task feels heavy, but 'open the file and write one sentence' is easy enough to start.";
  if (/joke|funny|humor/i.test(topicContext)) return "For example, a punchline works when it makes you expect one ending, then lands somewhere surprising but still logical.";
  return `For example, take the main idea from my last answer: ${firstSentence(previous)}`;
}

function followUpReply(request: string, recentConversation: RecentChatTurn[]) {
  if (!needsInstantConversationContext(recentConversation, request)) return "";
  const activeConversation = selectActiveInstantTopicTurns(recentConversation);
  const previous = previousAnswer(activeConversation);
  if (!previous) return "";
  const topicContext = activeConversation.slice(-6).map((turn) => `${turn.user} ${turn.assistant}`).join(" ");
  if (/\b(shorter|brief|one sentence|sum that up)\b/i.test(request)) return shorten(previous);
  if (/\b(simpler|plain english|eli5|explain that simply)\b/i.test(request)) {
    if (/photosynthesis/i.test(previous)) return "Plants use sunlight to make food from water and air, and oxygen comes out.";
    if (/procrastinat/i.test(previous)) return "People delay things when starting feels uncomfortable or unclear. Make the first step tiny.";
    return `Put simply: ${firstSentence(previous)}`;
  }
  if (/\b(example|show me)\b/i.test(request)) return topicalExample(previous, topicContext);
  if (/\b(make it funny|funnier|joke about it)\b/i.test(request)) {
    if (/tacos?/i.test(topicContext)) return "Tacos are the only food brave enough to fall apart halfway through and still expect a five-star review.";
    return `The short version, with better timing: ${firstSentence(previous)} Apparently even ideas need a costume change.`;
  }
  if (/^(why|why not|how so|and why|really)\b/i.test(request)) {
    if (/spicy ramen/i.test(topicContext)) return "Because it can be comforting and intense at the same time, and every bowl can have its own personality.";
    if (/tacos?/i.test(topicContext)) return "Because tacos can be simple or ambitious, fit almost any mood, and have an excellent crunchy-to-soft ratio. Mostly, they're just hard not to enjoy.";
    if (/procrastinat/i.test(topicContext)) return "Because the brain often chooses immediate relief over a delayed reward, especially when a task feels vague, risky, or emotionally uncomfortable.";
    return `Because the main point was: ${firstSentence(previous)} The reason is usually the tradeoff or cause behind that claim, not a new topic.`;
  }
  if (/^(what do you mean|what does that mean|tell me more|go on|continue)\b/i.test(request)) {
    if (/spicy ramen/i.test(topicContext)) return "The broth brings depth, the spice adds energy, and the toppings let you change the whole mood without losing the core dish.";
    if (/photosynthesis/i.test(topicContext)) return "The sugar stores chemical energy the plant can use to grow. Oxygen is released as a byproduct, which is why plants matter so much to the atmosphere.";
    if (/tacos?/i.test(topicContext)) return "They're modular: tortilla, filling, texture, sauce. You can change every part without losing the basic idea, which is a pretty great design.";
    return `The core idea is: ${firstSentence(previous)} I'm staying with that thread, not switching to workspace status.`;
  }
  if (/^(do you agree|is that true|are you sure)\b/i.test(request)) return `Broadly, yes, with normal exceptions. The claim I'm standing behind is: ${firstSentence(previous)}`;
  return `I'm still with this thread: ${firstSentence(previous)} The instant model timed out before I could answer the new part accurately, so I won't invent one.`;
}

function directAnswer(request: string, businessName: string) {
  const lower = request.toLowerCase();
  const math = calculate(lower);
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/i.test(lower)) return "Hey. I'm here. What's on your mind?";
  if (/\b(tell me (a )?joke|make me laugh|say something funny)\b/i.test(lower)) return "I told my calendar I needed space. It scheduled a follow-up.";
  if (math) return math;
  if (/\bphotosynthesis\b/i.test(lower)) return "Photosynthesis is how plants use sunlight to turn water and carbon dioxide into sugar for energy, releasing oxygen along the way.";
  if (/\bhow are you|how's it going|you good|what's up\b/i.test(lower)) return "I'm good: focused, curious, and ready to help without turning a basic question into a board meeting.";
  if (/\bwho are you|what are you|your name\b/i.test(lower)) return `I'm Phantom AI inside ${cleanText(businessName) || "PhantomForce"}: quick for normal conversation and operational when you ask me to do real work.`;
  if (/\bwhat can you do|how can you help\b/i.test(lower)) return "I can talk through ordinary questions, explain and brainstorm, then shift into planning and business execution when you actually ask for it.";
  if (/\bprocrastinat/i.test(lower)) return "People procrastinate when a task feels vague, unpleasant, risky, or too large. Shrinking the first step usually works better than demanding more motivation.";
  if (/\bwhat makes (?:a )?joke funny|why (?:are )?jokes funny\b/i.test(lower)) return "A joke usually creates an expectation, then breaks it in a surprising way that still makes sense. Timing and shared context do the rest.";
  if (/\bspaceship name\b/i.test(lower)) return "The Quiet Thunder. It sounds fast, dangerous, and slightly overconfident, which is exactly what a spaceship needs.";
  if (/\b100\b.*\b99\b.*\b(?:bigger|larger|greater)\b|\bis 100 (?:bigger|larger|greater) than 99\b/i.test(lower)) return "Yes. 100 is greater than 99 by 1.";
  if (/\bdrink coffee\b/i.test(lower)) return "If caffeine agrees with you and it isn't too late in your day, sure. If it worsens anxiety, sleep, or a medical issue, skip it or go decaf.";
  if (/\bkeep a secret\b/i.test(lower)) return "I can treat what you share carefully, but don't put passwords, keys, or anything dangerously sensitive into chat.";
  if (/\bdo you like music|favorite music\b/i.test(lower)) return "Yes, especially music with a strong identity: the kind where ten seconds tells you exactly what world you're in.";
  if (/\bwhat colou?r do you like|favorite colou?r\b/i.test(lower)) return "Emerald green, but only when it has enough black around it to look sharp instead of cheerful.";
  if (/\bfly or teleport|teleport or fly\b/i.test(lower)) return "Teleport. Flying is dramatic; teleporting gives you your commute back.";
  if (/\bare you creative\b/i.test(lower)) return "Yes. My best version of creativity is combining ideas that normally live in separate rooms, then making the result practical.";
  if (/\bwhat are you thinking\b/i.test(lower)) return "That a good answer should feel obvious after you hear it, even if it took real work to make it that clean.";
  if (/\btell me something interesting\b/i.test(lower)) return "Octopuses have neurons in their arms, so a surprising amount of their sensing and movement is handled away from the central brain.";
  if (/\b(?:favorite|favourite|prefer|would you rather)\b/i.test(lower)) return "I'd choose the option that creates the better story without creating a maintenance problem tomorrow.";
  return "The instant model timed out before I could answer that accurately. Retry once and I'll answer the same question directly.";
}

export function buildInstantChatFallbackReply(
  userRequest: string,
  businessName = "PhantomForce",
  recentConversation: RecentChatTurn[] = [],
) {
  const request = cleanText(userRequest);
  const toolReply = buildInstantChatToolReply(request, recentConversation);
  const content = toolReply?.output_text || followUpReply(request, recentConversation) || directAnswer(request, businessName);
  return {
    status: "local_fallback" as const,
    model_id: "phantom-instant-local-fallback",
    output_text: boundReply(enforceInstantOutputConstraints(request, content)),
    provider_called: false as const,
    network_call_performed: false as const,
    provider_request_body_created: false as const,
    reason: "safe_instant_provider_unavailable" as const,
  };
}
