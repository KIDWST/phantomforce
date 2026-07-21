/* Honest, shell-wide brain-state signal (Ascension UI v2).
   Fed by the REAL metadata every /phantom-ai/chat reply carries
   (fallback.used, responding_provider, all_failed, attempts) — the shell must
   never show a healthier brain than the last reply proved. This module holds
   only the latest observed signal; it fabricates nothing and shows nothing
   until a real reply has been seen. */

const state = { lastReply: null };
const listeners = new Set();

export function reportBrainReply(meta) {
  state.lastReply = { ...meta, at: Date.now() };
  listeners.forEach((fn) => {
    try { fn(state.lastReply); } catch {}
  });
}

export const lastBrainReply = () => state.lastReply;

export function onBrainState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* One shared vocabulary for the shell chip + status card. */
export function brainLiveLabel() {
  const live = state.lastReply;
  if (!live) return null;
  if (live.offline || live.allFailed) {
    return { text: "degraded · no provider", tone: "risk" };
  }
  if (live.fallbackUsed || live.localResponse) {
    const to = live.respondingProvider ? ` → ${live.respondingProvider}` : " → local";
    return { text: `degraded${to}`, tone: "warn" };
  }
  return live.respondingProvider ? { text: live.respondingProvider, tone: "ok" } : null;
}
