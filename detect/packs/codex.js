// Codex CLI heuristics. The idle-input rule below is confirmed live (Codex's
// idle prompt reads "› Implement {feature}" — the "›" glyph, U+203A, is
// distinct from Claude's "❯", U+276F). The rest are still v0 best-guesses;
// replace once training-mode captures give more real Codex output to test
// against, using `node scripts/replay-detector.mjs`.
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

export const codexPack = [
  {
    id: "codex-working-spinner",
    label: "Spinner + working/thinking banner",
    state: "running",
    confidence: 0.8,
    pattern: new RegExp(`${SPINNER.source}.{0,40}(working|thinking)`, "i"),
    describe: (m) => `matched spinner + banner "${m[0].replace(/\s+/g, " ").trim()}"`,
  },
  {
    id: "codex-approval-prompt",
    label: "Command/patch approval prompt",
    state: "needs_approval",
    confidence: 0.8,
    pattern: /(approve|allow) (this )?(command|patch|edit)|press.*(approve|reject)/i,
    describe: (m) => `matched approval phrasing "${m[0]}"`,
  },
  {
    id: "codex-completion-banner",
    label: "Completion wording",
    state: "complete",
    confidence: 0.55,
    pattern: /\b(task complete|patch applied|done\.)\b/i,
    describe: (m) => `matched completion wording "${m[0]}"`,
  },
  {
    // Confirmed live: Codex's idle input prompt uses "›" (U+203A) + a
    // placeholder like "Implement {feature}". The update-nag menu reuses the
    // same glyph for its numbered choices ("› 1. Update now"), so exclude a
    // digit immediately following, same trick as Claude's idle-box rule.
    id: "codex-idle-input-box",
    label: "Idle input prompt caret, no spinner",
    state: "waiting",
    confidence: 0.55,
    pattern: /›\s+(?!\d)/,
    describe: () => "idle input prompt caret (›) with no spinner active",
  },
];
