const MAX_REPLY_CHARS = 420;

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function boundReply(value: string) {
  return cleanText(value).slice(0, MAX_REPLY_CHARS);
}

function mentionsFood(text: string) {
  return /\b(favorite|favourite|fav)\b.*\b(food|meal|snack|dish|eat)\b|\b(food|meal|snack|dish)\b.*\b(favorite|favourite|fav)\b/i.test(text);
}

function asksMood(text: string) {
  return /\b(how are you|how's it going|you good|what's up)\b/i.test(text);
}

function asksIdentity(text: string) {
  return /\b(who are you|what are you|your name)\b/i.test(text);
}

function asksPreference(text: string) {
  return /\b(favorite|favourite|fav|prefer|would you rather)\b/i.test(text);
}

type RecentChatTurn = {
  user: string;
  assistant: string;
};

function isFollowUp(text: string) {
  return /^(why|why not|how so|what do you mean|what does that mean|tell me more|and why|really)\b/i.test(text);
}

function simpleMath(text: string) {
  const match = text.match(/\b(-?\d+(?:\.\d+)?)\s*(?:x|times|multiplied by|\*)\s*(-?\d+(?:\.\d+)?)\b/i);
  if (!match) return "";
  return `${match[1]} times ${match[2]} is ${Number(match[1]) * Number(match[2])}.`;
}

function followUpReply(request: string, recentConversation: RecentChatTurn[]) {
  if (!isFollowUp(request)) return "";
  const previous = recentConversation.at(-1)?.assistant || "";
  if (!previous) return "";
  if (/tacos?/i.test(previous)) {
    return "Because tacos can be simple or ambitious, they work for almost any mood, and the crunchy-to-soft ratio has excellent engineering. Mostly, though, they're just hard not to enjoy.";
  }
  return `I was referring to this part of my last answer: "${previous.slice(0, 180)}" Tell me which piece you want unpacked and I'll stay on that exact thread.`;
}

export function buildInstantChatFallbackReply(
  userRequest: string,
  businessName = "PhantomForce",
  recentConversation: RecentChatTurn[] = [],
) {
  const request = cleanText(userRequest);
  const lower = request.toLowerCase();
  let content = followUpReply(request, recentConversation);

  if (content) {
    // A short follow-up should stay attached to the previous answer.
  } else if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/i.test(lower)) {
    content = "Hey. I'm here and ready. What's on your mind?";
  } else if (/\b(tell me (a )?joke|make me laugh)\b/i.test(lower)) {
    content = "I told my calendar I needed space. Now every meeting is marked tentative.";
  } else if (simpleMath(lower)) {
    content = simpleMath(lower);
  } else if (/\bphotosynthesis\b/i.test(lower)) {
    content = "Photosynthesis is how plants use sunlight to turn water and carbon dioxide into sugar for energy, releasing oxygen along the way.";
  } else if (mentionsFood(lower)) {
    content = "I'd pick tacos. Fast, flexible, and hard to ruin. That feels spiritually correct for an instant answer.";
  } else if (asksMood(lower)) {
    content = "I'm good - focused, caffeinated in spirit, and ready to help without making this a whole production.";
  } else if (asksIdentity(lower)) {
    content = `I'm Phantom AI inside ${cleanText(businessName) || "PhantomForce"} - the quick brain for normal chat and the operator brain when you ask for work.`;
  } else if (/\bwhat can you do\b|\bhow can you help\b/i.test(lower)) {
    content = "I can answer normal questions quickly, then switch into operator mode for planning, clients, content, websites, accounting, automations, and approvals when you ask for real work.";
  } else if (asksPreference(lower)) {
    content = "For a quick preference question, I'd keep it simple: choose the option that is useful, fun, and least annoying to maintain.";
  } else {
    content = "I couldn't get a clean model answer before the instant deadline. Your question is still the active thread, and I won't replace it with unrelated business status. Try it once more.";
  }

  return {
    status: "local_fallback" as const,
    model_id: "phantom-instant-local-fallback",
    output_text: boundReply(content),
    provider_called: false as const,
    network_call_performed: false as const,
    provider_request_body_created: false as const,
    reason: "safe_instant_provider_unavailable" as const,
  };
}
