// Per-agent-CLI adapter: how to launch a given provider in audit (read-only)
// vs write (isolated worktree) mode. Mission Mode is not Claude-only — any
// agentic CLI with a real audit/write enforcement mechanism can be added
// here. Providers without a defined adapter are not offered as mission
// workers, since Termina can't guarantee audit-mode safety for them (a plain
// shell has no equivalent of "--permission-mode plan").
export const AGENT_PROVIDERS = {
  claude: {
    label: "Claude CLI",
    // Confirmed live: `claude --permission-mode plan` blocks writes for
    // audit missions; `default` keeps Claude's own interactive approval
    // prompts for write-mode (worktree) missions.
    buildArgs: (mode) => ["-NoLogo", "-NoExit", "-Command", `claude --permission-mode ${mode === "audit" ? "plan" : "default"}`],
  },
  codex: {
    label: "Codex CLI",
    // Codex's own sandbox flag enforces read-only at the OS level for audit
    // missions (stronger than an application-level guard); workspace-write
    // plus on-request approval mirrors Claude's write-mode behavior.
    buildArgs: (mode) =>
      mode === "audit"
        ? ["-NoLogo", "-NoExit", "-Command", "codex --sandbox read-only --ask-for-approval on-request"]
        : ["-NoLogo", "-NoExit", "-Command", "codex --sandbox workspace-write --ask-for-approval on-request"],
  },
};

export function isAgentProvider(id) {
  return Object.prototype.hasOwnProperty.call(AGENT_PROVIDERS, id);
}
