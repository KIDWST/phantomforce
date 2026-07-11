// Per-session status detector. Feed it raw PTY output; it keeps a rolling,
// ANSI-stripped window and classifies the terminal's current state on demand.
//
// Adding a new provider means adding a pack file under detect/packs/ and
// registering it in PACKS below — this file's matching logic never changes.
import { createLineAwareStripper } from "./line-aware-strip.js";
import { genericPack } from "./packs/generic.js";
import { claudePack } from "./packs/claude.js";
import { codexPack } from "./packs/codex.js";

const PACKS = {
  claude: claudePack,
  codex: codexPack,
};

const WINDOW_SIZE = 4000;
const CONFIDENCE_FLOOR = 0.4;

export const STATES = ["thinking", "running", "complete", "waiting", "needs_approval", "failed", "unknown"];

function resolveRules(detectorKey) {
  const specific = detectorKey ? PACKS[detectorKey] : null;
  return specific ? [...specific, ...genericPack] : [...genericPack];
}

// Finds a (non-global) pattern's LAST occurrence in text, by repeatedly
// re-searching the remainder after each hit.
function lastMatchIn(pattern, text) {
  let last = null;
  let offset = 0;
  while (offset <= text.length) {
    const m = pattern.exec(text.slice(offset));
    if (!m) break;
    const start = offset + m.index;
    last = { match: m, endIndex: start + Math.max(m[0].length, 1) };
    offset = start + Math.max(m[0].length, 1);
  }
  return last;
}

// Confirmed live bug this fixes: a dismissed trust/approval prompt's
// wording (e.g. "...Enter to confirm...") can remain inside the rolling
// window long after it was resolved — for as long as the session doesn't
// produce enough new output to push it out, which a short task ("say hello
// in two languages") may never do. Picking purely by confidence then lets
// that STALE match beat a genuinely later idle-prompt match forever, since
// generic-confirmation-prompt's confidence (0.6) outranks the idle-box rule
// (0.55) regardless of which one is chronologically current.
//
// Recency is the primary signal — but "recency" means a different rendered
// moment, not merely a later character offset. A single redrawn status line
// routinely matches more than one rule at once (confirmed live: a spinner +
// thinking-verb match and a separate "esc to interrupt" hint both sit on the
// same line while Claude is actively working) — those are the same moment,
// and should be decided by confidence, not by which pattern happens to end
// a few characters later in that one line. Matches separated by at least one
// newline are genuinely different moments in the output stream, and there
// the later one wins outright regardless of confidence.
function matchBest(rules, window) {
  const candidates = [];
  for (const rule of rules) {
    const found = lastMatchIn(rule.pattern, window);
    if (!found) continue;
    candidates.push({
      state: rule.state,
      confidence: rule.confidence,
      ruleId: rule.id,
      label: rule.label,
      match: found.match[0],
      why: rule.describe ? rule.describe(found.match) : rule.label,
      endIndex: found.endIndex,
    });
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => a.endIndex - b.endIndex);
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const c = candidates[i];
    const between = window.slice(Math.min(best.endIndex, c.endIndex), Math.max(best.endIndex, c.endIndex));
    const sameMoment = !between.includes("\n");
    if (sameMoment) {
      if (c.confidence > best.confidence) best = c;
    } else {
      best = c;
    }
  }
  return best;
}

export function createDetector(profile) {
  const rules = resolveRules(profile?.detector);
  const stripLineAware = createLineAwareStripper(); // stateful — one per session
  let window = "";
  let pendingRaw = "";

  return {
    feed(raw) {
      pendingRaw += raw;
      window = (window + stripLineAware(raw)).slice(-WINDOW_SIZE);
    },
    evaluate() {
      const raw = pendingRaw;
      pendingRaw = "";
      const best = matchBest(rules, window);
      if (!best || best.confidence < CONFIDENCE_FLOOR) {
        return {
          state: "unknown",
          confidence: 0,
          ruleId: null,
          label: null,
          match: null,
          why: "no rule matched above the confidence floor",
          raw,
          stripped: window,
        };
      }
      const { endIndex, ...publicFields } = best;
      void endIndex;
      return { ...publicFields, raw, stripped: window };
    },
  };
}
