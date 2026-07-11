// Per-session status detector. Feed it raw PTY output; it keeps a rolling,
// ANSI-stripped window and classifies the terminal's current state on demand.
//
// Adding a new provider means adding a pack file under detect/packs/ and
// registering it in PACKS below — this file's matching logic never changes.
import { stripAnsi } from "./strip-ansi.js";
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

// Highest-confidence match wins; a rule never fires just because it's listed
// first. Below the confidence floor we report "unknown" rather than guess.
function matchBest(rules, window) {
  let best = null;
  for (const rule of rules) {
    const match = rule.pattern.exec(window);
    if (!match) continue;
    if (!best || rule.confidence > best.confidence) {
      best = {
        state: rule.state,
        confidence: rule.confidence,
        ruleId: rule.id,
        label: rule.label,
        match: match[0],
        why: rule.describe ? rule.describe(match) : rule.label,
      };
    }
  }
  return best;
}

export function createDetector(profile) {
  const rules = resolveRules(profile?.detector);
  let window = "";
  let pendingRaw = "";

  return {
    feed(raw) {
      pendingRaw += raw;
      window = (window + stripAnsi(raw)).slice(-WINDOW_SIZE);
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
      return { ...best, raw, stripped: window };
    },
  };
}
