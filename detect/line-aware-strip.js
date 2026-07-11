// A stateful ANSI-to-text converter for status detection specifically.
//
// Confirmed live: Claude Code and Codex redraw almost entirely via absolute
// cursor positioning (`\x1b[<row>;<col>H`), not scrolling newlines. The
// plain stripAnsi() (used elsewhere for auto-trust scanning and protocol
// parsing) turns every cursor move into a single space to avoid gluing
// words together — but that also erases the distinction between "still on
// the same screen row" and "moved to a different row entirely", which the
// detector needs: two rule matches on the same redrawn row are the same
// rendered moment (decide by confidence), while matches on different rows
// are genuinely different moments (the later one should win outright). See
// detect/index.js's matchBest.
//
// This tracks the current row across calls (must be created once per
// session, not per chunk) and emits a real "\n" when the row changes, a
// space for a same-row cursor move, and resets tracking on a full-screen
// clear (a fresh page has no meaningful "previous row").
const COMBINED = new RegExp(
  [
    String.raw`(?<osc>\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))`,
    String.raw`\x1b\[(?<row>\d*)(?:;(?<col>\d*))?(?<posEnd>[Hf])`,
    String.raw`(?<clear>\x1b\[[23]J)`,
    String.raw`(?<fwd>\x1b\[[0-9;]*[ABCDG])`,
    String.raw`(?<csi>\x1b\[[0-9;?]*[ -/]*[@-~])`,
    String.raw`(?<stray>\x1b[=>()][0-9A-Za-z]?)`,
    String.raw`(?<ctrl>[\x00-\x09\x0b-\x1f\x7f])`,
  ].join("|"),
  "g",
);

export function createLineAwareStripper() {
  let currentRow = null;

  return function feed(raw) {
    return raw.replace(COMBINED, (...args) => {
      const groups = args[args.length - 1];
      if (groups.osc || groups.csi || groups.stray) return "";
      if (groups.clear) {
        currentRow = null;
        return "";
      }
      if (groups.posEnd) {
        const row = groups.row ? Number(groups.row) : 1;
        const changed = currentRow !== null && row !== currentRow;
        currentRow = row;
        return changed ? "\n" : " ";
      }
      if (groups.fwd || groups.ctrl) return " ";
      return "";
    });
  };
}
