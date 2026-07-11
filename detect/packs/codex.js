// Codex CLI heuristics — v0 best-guesses, same caveats as claude.js: replace
// once training-mode captures give us real Codex output to test against.
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
];
