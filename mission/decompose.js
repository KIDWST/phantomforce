// Decomposes a mission objective into distinct, non-duplicative worker roles
// using a one-shot `claude -p` call with a JSON schema — validated
// structured output, not free-text parsing. Mission-aware: the prompt
// explicitly tells Claude to tailor roles to what the objective actually is
// (software launch vs. content business vs. anything else), not a hard-coded
// software-team template.
import { runPrint } from "./print.js";

const ROLE_SCHEMA = {
  type: "object",
  properties: {
    missionName: { type: "string", description: "A short, punchy title for this mission, e.g. 'Launch Readiness Audit'" },
    roles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short role title, e.g. 'Backend/API Auditor'" },
          scope: { type: "string", description: "Bounded responsibilities exclusive to this role" },
          deliverables: { type: "string", description: "What this worker should produce/verify" },
          prohibited: { type: "string", description: "Actions explicitly out of bounds for this role" },
        },
        required: ["name", "scope", "deliverables", "prohibited"],
      },
    },
  },
  required: ["missionName", "roles"],
};

const DECOMPOSE_BUDGET_USD = 5;

// workerCount is optional — the whole point is "just give the objective and
// it goes to work": if omitted, Claude itself decides how many distinct,
// non-overlapping workstreams the objective actually calls for, rather than
// making the user pick a number upfront.
export async function decomposeObjective({ objective, workerCount, workspaceRoot, scratchDir }) {
  const countInstruction = workerCount
    ? `into exactly ${workerCount} distinct, non-overlapping worker roles`
    : `into however many distinct, non-overlapping worker roles this objective actually calls for ` +
      `(typically 2-6 — use your judgment; don't split into more roles than there is real independent work)`;

  const prompt =
    `You are decomposing a mission objective ${countInstruction} for a team of parallel Claude Code agents. ` +
    `Also give the overall mission a short, punchy name.\n\n` +
    `OBJECTIVE:\n${objective}\n\n` +
    `Tailor the roles to what this objective actually is — do not default to a hard-coded software-team template ` +
    `unless the objective is actually a software project. A content/marketing objective should get content/marketing ` +
    `roles; a security audit objective should get audit-shaped roles; etc.\n\n` +
    `Each role must have a clearly bounded, non-duplicative scope so two workers never do the same work. ` +
    `If useful, inspect the actual working directory before answering.`;

  const result = await runPrint({
    prompt,
    jsonSchema: ROLE_SCHEMA,
    cwd: workspaceRoot,
    maxBudgetUsd: DECOMPOSE_BUDGET_USD,
    scratchDir,
  });

  const roles = result.structured_output?.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error("decomposition did not return any roles");
  }
  const missionName = result.structured_output?.missionName || "Untitled mission";
  return { roles, missionName, costUsd: result.total_cost_usd ?? null };
}
