const LOCAL_REFUSAL_PATTERN =
  /(?:urlopen|winerror\s*10061|actively refused|econnrefused|connection refused|connectex|failed to fetch|fetch failed|target machine)/i;
const LOCAL_TIMEOUT_PATTERN = /(?:aborterror|timed?\s*out|timeout|did not respond)/i;

function cleanProviderDetail(value: unknown) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeProviderDetail(value: unknown, options: { lane?: "local" | "cloud" | "private" } = {}) {
  const cleaned = cleanProviderDetail(value);
  if (!cleaned) return "Provider did not return a usable response.";

  if (options.lane === "local" || LOCAL_REFUSAL_PATTERN.test(cleaned)) {
    if (LOCAL_TIMEOUT_PATTERN.test(cleaned)) {
      return "Local brain did not answer in time. Start the local model service or switch Phantom to another brain lane.";
    }
    if (LOCAL_REFUSAL_PATTERN.test(cleaned)) {
      return "Local brain is offline. Start Ollama/local model service or switch Phantom to another brain lane.";
    }
  }

  if (LOCAL_TIMEOUT_PATTERN.test(cleaned)) return "Provider did not answer in time. Phantom can try another allowed route.";

  return cleaned.slice(0, 180);
}

export function containsRawProviderTransportDetail(value: unknown) {
  return LOCAL_REFUSAL_PATTERN.test(cleanProviderDetail(value));
}
