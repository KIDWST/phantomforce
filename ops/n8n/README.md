# n8n local automation bay (dry-run only)

This is a **local, manual-start scaffold** for n8n — it exists so PhantomForce's
Autopilot/tool-lane checks have something real to report on, and so Jordan can
optionally run n8n on his own machine to draft workflows. Nothing here is
started, stopped, or triggered by the PhantomForce app itself.

## What this is

- A local n8n instance you start/stop yourself with the scripts in `scripts/`.
- One draft workflow (`workflows/chicagoshots-lead-intake-dry-run.json`) —
  **inactive**, **no credentials**, **no webhook** — that sketches out a
  lead-intake flow as a starting point to edit inside n8n's own editor.

## What this is not

- Not auto-started by PhantomForce. `PHANTOM_HIGGSFIELD_TOOL_MODE`-style
  autopilot jobs only *check* whether n8n is scaffolded/reachable on
  `127.0.0.1:5678` — they never launch or stop the process.
- Not connected to any real service. The draft workflow has no API keys,
  no live webhook URL, and is not active — opening it in n8n does not send
  or receive anything until you deliberately wire it up yourself.
- Not a public endpoint. n8n binds to `127.0.0.1` only (see `.env.example`).

## Setup

1. Install n8n locally (only needs to happen once):
   ```powershell
   npm install -g n8n
   ```
2. Copy `.env.example` to `.env` in this folder and adjust if needed — the
   defaults already bind to localhost only.
3. Start it:
   ```powershell
   .\scripts\start-local.ps1
   ```
4. Open `http://127.0.0.1:5678` in a browser, sign in (n8n will prompt you
   to set up an owner account on first run), and import
   `workflows\chicagoshots-lead-intake-dry-run.json` if you want a starting
   point.
5. Check it's up any time with:
   ```powershell
   .\scripts\health-check.ps1
   ```
6. Stop it with:
   ```powershell
   .\scripts\stop-local.ps1
   ```

## Safety posture

- `allowed_mode: dry_run_draft_only` in `docs/tooling-spine/tool-registry.json`.
- Blocked for the app: `execute_workflow`, `start_n8n_process`,
  `open_public_webhook`, `use_credentials`.
- Owner reviews and wires up any drafted workflow by hand, inside n8n's own
  editor, before it ever runs for real.
