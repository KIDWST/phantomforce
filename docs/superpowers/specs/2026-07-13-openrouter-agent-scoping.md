# OpenRouter Agent — Scoping Note (not yet designed in full)

Status: named follow-up, intentionally not built in this pass. This is a
scoping note, not an approved design — a full brainstorm (approaches,
clarifying questions, design doc) is still needed before implementation.

## Why this is its own project, not a Connections-panel task

Claude Code and Codex are real, existing interactive coding-agent CLIs —
Termina just spawns them under a PTY and lets them run. OpenRouter has no
equivalent: it's a chat-completions API gateway to many models (including
GLM 5.2), with no first-party interactive coding agent. Making "an
OpenRouter worker" actually usable in Mission Mode means Termina has to
**build the agent itself**: a loop that sends messages to OpenRouter, gets
back tool calls, executes them (read file, write file, run a shell command),
feeds results back, and renders the whole exchange into something that
looks and behaves like a terminal tile — comparable in scope to a small,
first version of Claude Code or Codex, not a plug-in credential.

## What the eventual design needs to answer

- **Tool set**: minimum viable is probably read-file, write-file/edit,
  list-directory, run-shell-command — mirroring what Claude Code/Codex
  already expose, since Mission Mode's worker prompts (`mission/prompt.js`)
  assume a worker that can actually read/write/test.
- **Permission modes**: Mission Mode's plan/approval/auto three-mode system
  (`mission/adapters.js`) has to map onto this new agent too, or Mission
  Mode's per-worker mode selector breaks for this provider. Auto-approving
  every tool call (as an MVP) vs. building a real approval-prompt UX is a
  real fork.
- **PTY-shaped output**: does this run as a real child process Termina
  spawns via `node-pty` (a small standalone script under `bin/` or similar
  that Termina ships and launches like any other profile — giving real PTY
  behavior, colors, resize, and reusing 100% of the existing wall/tile
  infrastructure for free), or does Termina render it into a tile via some
  other path? Spawning it as a real child process is very likely the right
  call — it's the only way to reuse `startSession`, the detector, Mission
  DVR recording, and the WebSocket bridge without duplicating any of that.
- **Model choice within OpenRouter**: GLM 5.2 was named specifically, but
  OpenRouter serves many models — does the Connections panel's OpenRouter
  row also need a model picker, or is a single configured default model
  enough for v1?
- **Cost tracking**: `mission/tokens.js`'s `TOKEN_ADAPTERS` pattern
  (tailing a local transcript file) doesn't apply here — OpenRouter's API
  response itself carries usage/cost per call, so this would need its own
  adapter shape (reading the agent's own request/response log, not
  tailing an external CLI's transcript file).
- **Status detection**: Mission Mode's Phase A detector
  (`detect/packs/{claude,codex}.js`) pattern-matches known CLI output
  shapes to infer Thinking/Waiting/Needs Approval/etc. A from-scratch agent
  can just emit those states directly and honestly (it controls its own
  output), which is arguably simpler than pattern-matching, but changes
  where that logic lives.

## Dependency on the Connections panel

Whatever this becomes, it will store its API key via the exact same
`connections.js` mechanism being built now (`CONNECTION_PROVIDERS` gains an
`openrouter` entry with `envVar: "OPENROUTER_API_KEY"`) — that part is
already covered by this session's Connections panel work and does not need
to be redesigned when this is picked up.
