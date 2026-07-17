// Classifies a mission-box objective BEFORE it ever reaches
// decomposeObjective: is this a literal "just open some terminals and run
// this" instruction (no AI agents needed — direct tiles), or a real
// objective that benefits from AI-agent decomposition (today's existing
// Mission Mode flow, unchanged)? Fixes the bug where every worker silently
// defaulted to Claude, since decomposeObjective's schema never asked for a
// provider at all.
import { runPrint } from "./print.js";

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["direct", "mission"] },
    tiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          profileId: { type: "string" },
          name: { type: "string" },
          startupCommand: { type: "string" },
        },
        required: ["profileId", "name"],
      },
    },
  },
  required: ["kind"],
};

const CLASSIFY_BUDGET_USD = 3;

export async function classifyPrompt({ objective, workspaceRoot, availableProfileIds, scratchDir }) {
  const prompt =
    `Classify this request typed into a terminal-app's "objective" box, then respond with structured JSON.\n\n` +
    `REQUEST:\n${objective}\n\n` +
    `"direct" = the request is literally about opening/arranging terminal windows, running specific one-off ` +
    `commands, or displaying something — no multi-step investigation or code changes implied. For "direct", ` +
    `return a "tiles" array: one entry per terminal to open, each with a profileId chosen ONLY from this exact ` +
    `list (never invent one): ${availableProfileIds.join(", ")}. A "name" is a short label for the tile. An ` +
    `optional "startupCommand" is a literal shell command/script to type into that tile once it's open — write ` +
    `real, working code if the request implies visual output (e.g. a colored animation), don't describe it. ` +
    `If the request implies a count loosely ("a few", "different colors") rather than stating one exactly, use ` +
    `your judgment (typically 2-6).\n\n` +
    `"mission" = the request describes a goal that needs an agent to read/write files, run tests, or make real ` +
    `changes across multiple steps. For "mission", omit "tiles" entirely — a separate existing pipeline handles it.`;

  const result = await runPrint({
    prompt,
    jsonSchema: CLASSIFY_SCHEMA,
    cwd: workspaceRoot,
    maxBudgetUsd: CLASSIFY_BUDGET_USD,
    scratchDir,
  });

  const kind = result.structured_output?.kind;
  if (kind !== "direct" && kind !== "mission") throw new Error("classification did not return a recognized kind");
  return {
    kind,
    tiles: kind === "direct" ? validateTiles(result.structured_output?.tiles, availableProfileIds) : [],
    costUsd: result.total_cost_usd ?? null,
  };
}

// Never trust model output blindly for something that drives real process
// spawning — any profileId not in the caller's actual, current profile
// list is replaced with "pwsh" (always present, always safe to open).
export function validateTiles(tiles, knownProfileIds) {
  if (!Array.isArray(tiles)) return [];
  return tiles.map((tile) => ({
    ...tile,
    profileId: knownProfileIds.includes(tile.profileId) ? tile.profileId : "pwsh",
  }));
}
