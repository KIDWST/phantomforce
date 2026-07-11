// Strips ANSI escape sequences and control bytes so pattern matching runs
// against the text a human would actually read on screen, not raw codes.
//
// Cursor-movement sequences (forward/back/up/down/position) are converted to
// a single space rather than deleted outright. Some TUIs (Claude Code's boxed
// prompts among them) lay out word spacing by moving the cursor instead of
// emitting literal space characters — deleting those sequences glues
// "Accessing" and "workspace:" into "Accessingworkspace:", silently breaking
// every multi-word pattern match downstream (auto-trust detection, the
// status detector). Confirmed live against a real Claude Code session.
const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CURSOR_MOVE = /\x1b\[[0-9;]*[ABCDGHf]/g;

export function stripAnsi(s) {
  return s
    .replace(ANSI_OSC, "")
    .replace(CURSOR_MOVE, " ")
    .replace(ANSI_CSI, "")
    .replace(/\x1b[=>()][0-9A-Za-z]?/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ");
}
