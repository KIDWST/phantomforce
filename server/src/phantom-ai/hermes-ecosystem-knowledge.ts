export type HermesEcosystemRecord = {
  id: string;
  names: string[];
  purpose: string;
  identity: string;
  relationships: string[];
  entryPoints: string[];
  commands: string[];
  tests: string[];
  environmentNames: string[];
  boundaries: string[];
  evidence: string[];
};

export const HERMES_ECOSYSTEM_RECORDS: readonly HermesEcosystemRecord[] = [
  {
    id: "phantomforce",
    names: ["PhantomForce", "PhantomBot", "Phantom AI"],
    purpose: "The authenticated business control plane, approval authority, execution ledger, and host for the PhantomBot desktop web application.",
    identity: "Canonical repository: github.com/KIDWST/phantomforce. This checkout is the PhantomBot 0.4 stabilization worktree; the inspected live deployment is C:\\Users\\jorda\\Documents\\Codex\\deployments\\phantomforce-live.",
    relationships: [
      "PhantomBot is the native desktop shell and governed Hermes operator over PhantomForce.",
      "PhantomForce owns authorization, immutable approvals, execution, receipts, and memory; Hermes proposes bounded plans.",
      "PhantomPlay and PhantomStore are application spaces hosted by this repository.",
    ],
    entryPoints: ["server/src/index.ts", "app/js/phantomai.js", "desktop/main.cjs"],
    commands: ["npm run build", "npm run test:phantombot-desktop", "npm run test:phantombot-operator"],
    tests: ["scripts/test-phantombot-desktop.mjs", "server/scripts/test-hermes-acp-operator-journey.ts", "server/scripts/test-hermes-operator-stream.ts"],
    environmentNames: ["PHANTOMFORCE_PORT", "PHANTOMFORCE_DATA_DIR", "PHANTOM_ACCESS_SESSION_SECRET"],
    boundaries: ["Never edit the live deployment directly.", "Never bypass workspace scope or approval validation.", "Do not persist provider credentials in memory or evidence."],
    evidence: ["docs/ARCHITECTURE.md", "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md", "server/src/phantom-ai/agent-runs.ts", "git remote origin"],
  },
  {
    id: "hermes",
    names: ["Hermes", "Hermes ACP"],
    purpose: "A local ACP planning provider used by PhantomBot for normalized, governed engineering proposals.",
    identity: "Hermes Agent 0.17.0 was detected during installed-desktop verification; ACP is transported over a supervised child process.",
    relationships: ["Hermes plans; PhantomForce validates and executes.", "The UI receives normalized PhantomForce events, not raw ACP JSON-RPC or hidden reasoning."],
    entryPoints: ["server/src/phantom-ai/hermes-acp-transport.ts", "server/src/phantom-ai/hermes-acp-operator.ts", "server/src/phantom-ai/hermes-operator-stream.ts"],
    commands: ["npm run test:hermes-acp-transport --workspace @phantomforce/server", "npm run test:hermes-acp-operator --workspace @phantomforce/server"],
    tests: ["server/scripts/test-hermes-acp-transport.ts", "server/scripts/test-hermes-acp-operator-journey.ts"],
    environmentNames: ["HERMES_HOME", "PHANTOM_HERMES_COMMAND", "PHANTOM_HERMES_ARGS"],
    boundaries: ["No unrestricted shell authority.", "Any material plan mutation requires a new approval.", "Raw prompts and assistant text are excluded from the native stream."],
    evidence: ["docs/quality/PHANTOMBOT_0.4_ENGINEERING_OPERATOR.md", "docs/quality/PHANTOMBOT_0.4_AUTHENTICATED_EVENT_STREAMING.md"],
  },
  {
    id: "termina",
    names: ["Termina"],
    purpose: "A separate local mission orchestration service that PhantomForce can invoke only through an approval-bound adapter.",
    identity: "Inspected checkout: C:\\Users\\jorda\\Termina, branch master, commit f539d6e1; service entry point server.js; expected local port 7420.",
    relationships: ["Termina performs decomposed missions after PhantomForce approval.", "Termina evidence is normalized into the PhantomForce receipt; it is not a second approval authority."],
    entryPoints: ["server/src/phantom-ai/termina-bridge.ts", "C:\\Users\\jorda\\Termina\\server.js"],
    commands: ["npm run test:termina-bridge --workspace @phantomforce/server", "powershell -File server/scripts/test-termina-live-preflight.ps1"],
    tests: ["server/scripts/test-termina-bridge.ts", "server/scripts/test-termina-live-client.ts", "server/scripts/test-termina-live-approved-dispatch.ts"],
    environmentNames: ["TERMINA_BASE_URL", "TERMINA_TOKEN", "TERMINA_ARTIFACT_DIR"],
    boundaries: ["Token values never enter prompts, receipts, docs, or logs.", "The inspected checkout is dirty and remains read-only.", "Real missions require an explicit approval-bound dispatch."],
    evidence: ["docs/quality/PHANTOMBOT_0.4_REAL_TERMINA_INTEGRATION.md", "runtime health and /api/repos probes recorded there"],
  },
  {
    id: "execution-governance",
    names: ["approvals", "receipts", "memory", "agent runs"],
    purpose: "The single governed execution lifecycle for queued, approved, executing, verified, failed, cancelled, and rolled-back work.",
    identity: "Agent runs are persisted append-only and receipts are emitted only from terminal, evidence-backed execution.",
    relationships: ["Approval payloads bind the exact plan and are single-use.", "Successful verified execution may create memory; failed execution must not create success memory."],
    entryPoints: ["server/src/phantom-ai/agent-runs.ts", "server/src/approval/approval-queue.ts", "server/src/phantom-ai/neural-spine.ts"],
    commands: ["npm run test:agent-run-lifecycle --workspace @phantomforce/server", "npm run test:change-memory"],
    tests: ["server/scripts/test-agent-run-lifecycle.ts", "scripts/guard-change-memory.mjs"],
    environmentNames: ["PHANTOM_AGENT_RUNS_PATH", "PHANTOM_BRAIN_MEMORY_PATH"],
    boundaries: ["External, destructive, production, send, spend, publish, deploy, and credential actions require explicit approval.", "Receipts must redact secrets and unsafe internal paths."],
    evidence: ["docs/ARCHITECTURE.md", "docs/RELEASE_CANDIDATE_TRUTH_MAP.md", "server/src/phantom-ai/agent-runs.ts"],
  },
  {
    id: "providers",
    names: ["providers", "OpenRouter", "local models", "Ollama", "Claude", "Codex", "AI proxy"],
    purpose: "Policy-routed model transports for live or local inference with explicit readiness and funding gates.",
    identity: "Implemented transports include OpenRouter, local Ollama, Claude CLI, and Codex CLI. Source presence alone does not prove a configured live route.",
    relationships: ["Provider selection feeds model work; it never grants file, deployment, or approval authority.", "AI proxy/provider policy fail closed when required configuration is absent."],
    entryPoints: ["server/src/phantom-ai/model-router.ts", "server/src/phantom-ai/provider-readiness.ts", "server/src/phantom-ai/providers/"],
    commands: ["npm run test:provider-readiness --workspace @phantomforce/server", "npm run test:provider-policy --workspace @phantomforce/server"],
    tests: ["server/scripts/test-provider-readiness.ts", "server/scripts/test-provider-policy.ts", "server/scripts/test-provider-invocation-firewall.ts"],
    environmentNames: ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OLLAMA_BASE_URL", "PHANTOM_CLAUDE_CLI_COMMAND", "PHANTOM_CODEX_CLI_COMMAND"],
    boundaries: ["Environment variable names may be documented; values may not.", "Live-provider enablement and funding gates must remain explicit."],
    evidence: ["server/src/phantom-ai/model-router.ts", "server/src/phantom-ai/admin-provider-manager.ts", "server/src/phantom-ai/providers/"],
  },
  {
    id: "phantomplay-store",
    names: ["PhantomPlay", "PhantomStore", "commerce", "media"],
    purpose: "PhantomPlay supplies game/community experiences; PhantomStore supplies governed commerce surfaces inside PhantomForce.",
    identity: "Both are modules in the canonical PhantomForce repository, not separately authoritative control planes.",
    relationships: ["Their execution and business evidence flow through PhantomForce stores and agent-run governance.", "PhantomPlay V2 is opt-in while it hardens; Classic remains default."],
    entryPoints: ["app/js/phantomplay.js", "app/js/phantomplay-v2.js", "app/js/phantomstore.js", "server/src/phantom-ai/phantomstore.ts"],
    commands: ["npm run test:phantomplay --workspace @phantomforce/server", "npm run test:phantomstore --workspace @phantomforce/server"],
    tests: ["server/scripts/test-phantomplay.ts", "server/scripts/test-phantomstore.ts", "server/scripts/test-commerce-order-lifecycle.ts"],
    environmentNames: ["PHANTOMPLAY_EDGE_ENABLED"],
    boundaries: ["Do not label opt-in or disconnected lanes production-ready.", "Commerce mutations remain approval and tenant scoped."],
    evidence: ["docs/architecture/PHANTOMPLAY_DEV_MODE.md", "server/src/phantom-ai/phantomstore.ts"],
  },
  {
    id: "skills-plugins-automation",
    names: ["skills", "plugins", "MCP", "automation", "agents", "connectors"],
    purpose: "Procedural skills, provider/tool connectors, agent definitions, and scheduled automation definitions that form the execution substrate.",
    identity: "Brain skills are live tenant-scoped procedures. The legacy tooling-spine registry is explicitly scaffolded/read-only; source discovery alone is not runtime proof.",
    relationships: ["Skills add process context but no authority.", "Automation jobs and agent definitions ultimately report through the Hermes ledger and agent-run evidence."],
    entryPoints: ["server/src/phantom-ai/neural-spine.ts", "server/src/phantom-ai/automation-engine.ts", "server/src/phantom-ai/agent-workforce.ts", "docs/tooling-spine/tool-registry.json"],
    commands: ["npm run test:brain-skills --workspace @phantomforce/server", "npm run test:agent-workforce --workspace @phantomforce/server"],
    tests: ["server/scripts/test-brain-skills.ts", "server/scripts/test-agent-workforce-status.ts"],
    environmentNames: ["PHANTOM_BRAIN_SKILLS_PATH", "PHANTOMFORCE_AUTOMATION_ENGINE_ENABLED"],
    boundaries: ["A skill or manifest never bypasses policy.", "Classify runtime status from wiring and tests, not file existence."],
    evidence: ["docs/PHANTOM_SKILLS.md", "docs/tooling-spine/tool-registry.json", "docs/WORKFORCE_REALITY_AUDIT.md"],
  },
];

function terms(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9.-]+/g) || []);
}

export function selectHermesEcosystemRecords(query: string, limit = 5) {
  const queryTerms = terms(query);
  return HERMES_ECOSYSTEM_RECORDS
    .map((record, order) => {
      const searchable = terms([record.id, ...record.names, record.purpose, ...record.relationships].join(" "));
      const score = [...queryTerms].reduce((total, term) => total + (searchable.has(term) ? 1 : 0), 0);
      return { record, score, order };
    })
    .filter(({ score, record }) => score > 0 || record.id === "phantomforce" || record.id === "execution-governance")
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(1, Math.min(limit, 7)))
    .map(({ record }) => record);
}

export function composeHermesEcosystemContext(query: string, workspace: string) {
  const selected = selectHermesEcosystemRecords(`${query} ${workspace}`);
  return [
    "Source-backed Phantom ecosystem context (facts only; validate changing runtime state with read operations):",
    ...selected.flatMap((record) => [
      `[${record.id}] ${record.purpose}`,
      `Identity: ${record.identity}`,
      `Relationships: ${record.relationships.join(" ")}`,
      `Entry points: ${record.entryPoints.join(", ")}`,
      `Tests: ${record.tests.join(", ")}`,
      `Environment names (never values): ${record.environmentNames.join(", ") || "none"}`,
      `Boundaries: ${record.boundaries.join(" ")}`,
      `Evidence: ${record.evidence.join(", ")}`,
    ]),
  ].join("\n").slice(0, 12_000);
}
