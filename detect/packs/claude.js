// Claude Code CLI heuristics. These are v0 best-guesses based on known CLI
// conventions (spinner + whimsical verb while working, "⏺" tool-call bullets,
// bordered approval prompts) — not trained on captured output yet.
//
// Once training mode has recorded real sessions, promote curated snippets into
// tests/detect/fixtures/claude.jsonl and use `node scripts/replay-detector.mjs`
// to check whether a rule change here is actually an improvement.
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

export const claudePack = [
  {
    id: "claude-thinking-verb",
    label: "Spinner + whimsical thinking verb",
    state: "thinking",
    confidence: 0.9,
    pattern:
      /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].{0,60}(Thinking|Pondering|Musing|Percolating|Marinating|Noodling|Cogitating|Ruminating|Combobulating)/i,
    describe: (m) => `matched spinner + thinking verb "${m[0].replace(/\s+/g, " ").trim()}"`,
  },
  {
    id: "claude-tool-call-bullet",
    label: "Tool-call bullet marker",
    state: "running",
    confidence: 0.8,
    pattern: /⏺\s/,
    describe: () => "tool-call bullet (⏺) rendered",
  },
  {
    id: "claude-approval-prompt",
    label: "Tool/edit approval prompt",
    state: "needs_approval",
    confidence: 0.85,
    pattern: /(do you want to (proceed|make this edit)|allow (this|these) (tool|command)|permission to (run|edit))/i,
    describe: (m) => `matched approval phrasing "${m[0]}"`,
  },
  {
    // Confirmed live: Claude Code's idle input prompt uses the "❯" glyph
    // (U+276F), not ASCII ">" — the original guess never matched. The
    // trust/permission menus reuse the same glyph as a selection indicator
    // (e.g. "❯ 1. Yes, I trust this folder"), so this excludes a digit
    // immediately following, which only appears in those numbered menus.
    id: "claude-idle-input-box",
    label: "Idle input prompt caret, no spinner",
    state: "waiting",
    confidence: 0.55,
    pattern: /❯\s+(?!\d)/,
    describe: () => "idle input prompt caret (❯) with no spinner active",
  },
  {
    id: "claude-completion-banner",
    label: "Completion wording",
    state: "complete",
    confidence: 0.6,
    pattern: /\b(task complete|all done|finished\.)\b/i,
    describe: (m) => `matched completion wording "${m[0]}"`,
  },
];
