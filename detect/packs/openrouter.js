// Rules matching the OpenRouter agent's OWN literal output (openrouter-
// agent/agent.mjs prints these exact strings) — high confidence is
// justified here, unlike the necessarily-heuristic Claude/Codex packs,
// because both sides of this match are controlled by this codebase.
export const openrouterPack = [
  {
    id: "openrouter-idle-prompt",
    label: "Idle input prompt",
    state: "waiting",
    confidence: 0.95,
    pattern: /openrouter▸ $/,
    describe: () => "the agent's own idle-prompt marker",
  },
  {
    id: "openrouter-approval-prompt",
    label: "Tool approval prompt",
    state: "needs_approval",
    confidence: 0.95,
    pattern: /APPROVE .+\? \(y\/n\) $/,
    describe: (m) => `matched approval prompt "${m[0]}"`,
  },
  {
    id: "openrouter-tool-call",
    label: "Tool call announcement",
    state: "running",
    confidence: 0.9,
    pattern: /^→ /m,
    describe: () => "a tool-call announcement line",
  },
  {
    id: "openrouter-error",
    label: "Error line",
    state: "failed",
    confidence: 0.8,
    pattern: /^\[error\]/m,
    describe: (m) => `matched error line "${m[0]}"`,
  },
];
