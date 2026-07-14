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

export function buildInstantChatFallbackReply(userRequest: string, businessName = "PhantomForce") {
  const request = cleanText(userRequest);
  const lower = request.toLowerCase();
  let content = "";

  if (mentionsFood(lower)) {
    content = "I'd pick tacos. Fast, flexible, and hard to ruin. That feels spiritually correct for an instant answer.";
  } else if (asksMood(lower)) {
    content = "I'm good - focused, caffeinated in spirit, and ready to help without making this a whole production.";
  } else if (asksIdentity(lower)) {
    content = `I'm Phantom AI inside ${cleanText(businessName) || "PhantomForce"} - the quick brain for normal chat and the operator brain when you ask for work.`;
  } else if (asksPreference(lower)) {
    content = "For a quick preference question, I'd keep it simple: choose the option that is useful, fun, and least annoying to maintain.";
  } else {
    content = "Short answer: yes, I can handle the simple stuff instantly. Ask normally and I'll only pull in heavier brains when the job actually needs them.";
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
