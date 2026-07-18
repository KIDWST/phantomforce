// Wraps text in a terminal "bracketed paste" sequence so a readline/ink-style
// CLI treats embedded newlines as part of one pasted block instead of
// submitting on the first line break.
//
// Confirmed live against Claude Code: a trailing \r in the SAME write as the
// paste-end sequence gets consumed as part of collapsing the paste into its
// "[Pasted text #1 +N lines]" placeholder, not as a submit keystroke — the
// prompt lands in the input box but never sends. The Enter must be written
// separately, after the UI has had a moment to finish rendering that
// placeholder. See dispatchToWorker in server.js for the two-write sequence.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
// Confirmed live: 500ms was not reliably enough for Claude Code's UI to
// finish settling on the pasted-text placeholder before a separate Enter
// registers as submit (a manual Enter sent well after 500ms did submit
// successfully; one sent at 500ms did not). 3s comfortably clears it.
export const SUBMIT_DELAY_MS = 3000;
export const SUBMIT_RETRY_COUNT = 3;
export const SUBMIT_RETRY_DELAY_MS = 1200;

export function bracketedPaste(text) {
  return `${PASTE_START}${text}${PASTE_END}`;
}

export const ENTER = "\r";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// PTY-backed agent CLIs can accept the bracketed paste but drop the first
// submit key while their UI collapses the pasted block. Termina launches many
// workers at once, so the timing varies by tile. Submit is intentionally a
// short retry sequence: paste exactly once, then send Enter a few spaced times.
export async function submitBracketedPaste(proc, text, options = {}) {
  const submitDelayMs = Number.isFinite(options.submitDelayMs) ? options.submitDelayMs : SUBMIT_DELAY_MS;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : SUBMIT_RETRY_DELAY_MS;
  const retries = Math.max(1, Number.isFinite(options.retries) ? Math.floor(options.retries) : SUBMIT_RETRY_COUNT);
  const wait = typeof options.sleep === "function" ? options.sleep : sleep;

  if (options.clearBeforePaste) proc.write("\x15");
  proc.write(bracketedPaste(text));
  await wait(submitDelayMs);
  for (let attempt = 0; attempt < retries; attempt += 1) {
    proc.write(ENTER);
    if (attempt < retries - 1) await wait(retryDelayMs);
  }
  return { pasteWrites: 1, submitWrites: retries };
}
