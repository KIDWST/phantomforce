// Per-agent-CLI adapter: how to launch a given provider under one of three
// launch modes. Mission Mode is not Claude-only — any agentic CLI with a
// real enforcement mechanism for these three can be added here. Providers
// without a defined adapter are not offered as mission workers, since
// Termina can't guarantee "plan" mode's safety for them (a plain shell has
// no equivalent of "--permission-mode plan").
//
// - "plan": read-only, cannot write. Safest; use when you just want
//   findings, not changes.
// - "approval": can edit (in an isolated worktree), stops to ask before
//   risky actions — the CLI's own normal interactive behavior.
// - "auto": can edit (in an isolated worktree), runs fully unattended with
//   no approval stops. Confirmed against each CLI's own documented flags
//   (Claude's `--permission-mode auto`, Codex's `--ask-for-approval never`)
//   — not `bypassPermissions`/`--dangerously-bypass-approvals-and-sandbox`,
//   which both CLIs describe as unsafe outside an externally-sandboxed
//   environment. Choosing this mode is the user's own explicit call per
//   mission; Termina doesn't default to it.
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openrouter-agent", "agent.mjs");

// Single-quote escaping for a pwsh -Command string — same shape already
// established in mission/claude-print.js, duplicated locally since
// adapters.js has no existing dependency on claude-print.js.
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// `--model` is appended only when explicitly requested (opts.model) — same
// flag claude-print.js already uses for `claude -p`; codex supports the same
// flag. Absent a model, args stay byte-identical to before.
function withModel(command, model) {
  return model ? `${command} --model ${psQuote(model)}` : command;
}

export const AGENT_PROVIDERS = {
  claude: {
    label: "Claude CLI",
    buildArgs: (mode, opts = {}) => {
      const flag = mode === "plan" ? "plan" : mode === "auto" ? "auto" : "manual";
      return ["-NoLogo", "-NoExit", "-Command", withModel(`claude --permission-mode ${flag}`, opts.model)];
    },
  },
  codex: {
    label: "Codex CLI",
    buildArgs: (mode, opts = {}) => {
      if (mode === "plan") return ["-NoLogo", "-NoExit", "-Command", withModel("codex --sandbox read-only --ask-for-approval on-request", opts.model)];
      const approval = mode === "auto" ? "never" : "on-request";
      return ["-NoLogo", "-NoExit", "-Command", withModel(`codex --sandbox workspace-write --ask-for-approval ${approval}`, opts.model)];
    },
  },
  openrouter: {
    label: "OpenRouter",
    buildArgs: (mode, opts = {}) => {
      let command = `node ${psQuote(agentScriptPath)} --mode ${mode}`;
      if (opts.usageLogPath) command += ` --usage-log ${psQuote(opts.usageLogPath)}`;
      return ["-NoLogo", "-NoExit", "-Command", command];
    },
  },
};

export function isAgentProvider(id) {
  return Object.prototype.hasOwnProperty.call(AGENT_PROVIDERS, id);
}

export const LAUNCH_MODES = ["plan", "approval", "auto"];

export function isLaunchMode(mode) {
  return LAUNCH_MODES.includes(mode);
}
