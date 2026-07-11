// Generic heuristics — apply to every terminal profile regardless of what CLI
// it's running. Deliberately conservative: a plain shell has no concept of
// "done", so idle-at-prompt maps to "waiting", not "complete".
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

export const genericPack = [
  {
    id: "generic-error-keyword",
    label: "Error keyword in recent output",
    state: "failed",
    confidence: 0.55,
    pattern: /\b(error|failed|failure|exception|fatal|panic|denied|refused|traceback)\b/i,
    describe: (m) => `matched error keyword "${m[0]}"`,
  },
  {
    id: "generic-confirmation-prompt",
    label: "Confirmation / y-n prompt",
    state: "needs_approval",
    confidence: 0.6,
    pattern: /(\(y\/n\)|\[y\/n\]|password:|passphrase|are you sure|overwrite\?|do you want to|confirm\b)/i,
    describe: (m) => `matched confirmation phrasing "${m[0]}"`,
  },
  {
    id: "generic-spinner",
    label: "Braille spinner glyph present",
    state: "running",
    confidence: 0.5,
    pattern: SPINNER,
    describe: () => "braille spinner glyph in output",
  },
  {
    id: "generic-prompt-return",
    label: "Shell returned to an idle prompt",
    state: "waiting",
    confidence: 0.5,
    pattern: /[$#>]\s*$/,
    describe: (m) => `trailing prompt character "${m[0].trim()}"`,
  },
];
