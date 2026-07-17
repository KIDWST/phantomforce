// Backend dispatcher for the mission pipeline's one-shot model calls
// (classify / enhance / decompose / synthesize). Prefers `codex exec`
// (ChatGPT subscription) so the Claude Max usage window stays reserved for
// the interactive mission workers; falls back to `claude -p` (Claude Max
// subscription) if codex is unavailable or errors.
//
// Both backends resolve to the same shape the callers rely on:
// { structured_output, result, backend }.
import { runClaudePrint } from "./claude-print.js";
import { runCodexPrint } from "./codex-print.js";

export async function runPrint(options) {
  try {
    return await runCodexPrint(options);
  } catch (codexError) {
    console.warn(`[mission] codex backend failed, falling back to claude: ${codexError.message}`);
    const result = await runClaudePrint(options);
    return { ...result, backend: "claude" };
  }
}
