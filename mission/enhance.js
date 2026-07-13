// One-shot `claude -p` call that clarifies/sharpens a rough mission
// objective before decomposition — a specificity pass, not license to
// invent goals the user didn't ask for. Same pattern as decompose.js.
import { runClaudePrint } from "./claude-print.js";

const ENHANCE_SCHEMA = {
  type: "object",
  properties: {
    enhancedObjective: { type: "string" },
    whatChanged: {
      type: "string",
      description: "One or two sentences on what was clarified/added, for the user's before/after review",
    },
  },
  required: ["enhancedObjective", "whatChanged"],
};

const ENHANCE_BUDGET_USD = 1;
// Speed over polish: this is a quick clarity pass before decomposition, not
// the mission itself — the fastest/cheapest available model is deliberately
// used here even though it's a weaker model, so "Enhance" feels instant
// instead of taking as long as a real mission step.
const ENHANCE_MODEL = "claude-haiku-4-5-20251001";

export async function enhanceObjective({ objective, workspaceRoot, scratchDir }) {
  const prompt =
    `You are sharpening a rough mission objective for a team of parallel Claude Code agents, ` +
    `BEFORE it gets split into worker roles. Make it clearer and more specific — add concrete scope, ` +
    `success criteria, or constraints that are obviously implied but unstated. ` +
    `Do NOT invent new goals, requirements, or scope the user didn't ask for; ` +
    `preserve their actual intent exactly, just make it sharper. This is a quick clarity pass, not deep research — ` +
    `answer directly from the text alone; do NOT read files, run commands, or explore the working directory.\n\n` +
    `ROUGH OBJECTIVE:\n${objective}`;

  const result = await runClaudePrint({
    prompt,
    jsonSchema: ENHANCE_SCHEMA,
    cwd: workspaceRoot,
    maxBudgetUsd: ENHANCE_BUDGET_USD,
    model: ENHANCE_MODEL,
    scratchDir,
  });

  const enhanced = result.structured_output?.enhancedObjective;
  if (!enhanced) throw new Error("enhancement did not return an enhanced objective");
  return {
    enhancedObjective: enhanced,
    whatChanged: result.structured_output?.whatChanged || "",
    costUsd: result.total_cost_usd ?? null,
  };
}
