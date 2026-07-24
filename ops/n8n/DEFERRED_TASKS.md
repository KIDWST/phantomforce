# Deferred / recurring tasks — the "recheck in N hours" primitive

This is the canonical, token-free way for agents (Claude, Codex) and
PhantomForce code to schedule deferred work: **"resync / recheck / re-run in
N hours"**. It exists so nothing recurring is ever done by leaving a model
open in the background to wait — that burns tokens for nothing. Every timer
registered here fires deterministically off PhantomForce's own automation tick
loop for **0 tokens**, and each fire is proof-logged to the Hermes ledger with
`estimated_tokens: 0`.

> Rule: if you ever catch yourself wanting to "wake myself up in N hours to
> recheck X", register a scheduled task instead. Deterministic steps run free
> on the tick. The only place a paid model may run is a single on-demand call
> **inside** the n8n workflow a task triggers — never a background agent.

## Where it lives

- Engine: `server/src/phantom-ai/scheduled-tasks.ts`
- Fired by: the automation engine tick (`startAutomationEngine`, every 10 min,
  plus a startup catch-up) — same loop as the fixed daily/weekly/monthly jobs.
- Store: `.local/scheduled-tasks/state.json` (atomic write, survives restart).

## API (owner / super-admin only)

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/phantom-ai/automations/scheduled` | List all scheduled tasks |
| `POST` | `/phantom-ai/automations/scheduled` | Register a task |
| `DELETE` | `/phantom-ai/automations/scheduled/:id` | Cancel a task |
| `POST` | `/phantom-ai/automations/scheduled/:id/run` | Run once now (does not consume the real schedule) |

## Registering

Body fields:

- `label` (required) — human description, e.g. `"resync competitor intel"`.
- `action` (required) — one of:
  - `{ "type": "automation", "jobId": "<automation job id>" }` — run an
    existing in-repo automation job (see `GET /phantom-ai/automations`).
  - `{ "type": "webhook", "url": "...", "method": "POST", "body": {...} }` —
    POST a local n8n webhook. **Only** loopback (`127.0.0.1` / `localhost`) or a
    host listed in `PHANTOMFORCE_N8N_ALLOWED_HOSTS` is allowed; any external
    URL is rejected at registration. This is how you hand real multi-step work
    to n8n.
  - `{ "type": "noop", "note": "..." }` — a pure wake-marker.
- Timing — provide exactly one first-fire field:
  - `run_in_hours` (e.g. `4` → "recheck in 4 hours"), or
  - `run_in_ms`, or
  - `run_at` (ISO timestamp).
- `every_hours` (or `every_ms`) — set for a **recurring** task; omit for a
  one-shot. Minimum interval is 1 minute. If the server was off and a recurring
  task is far overdue, it fires **once** and re-anchors to now + interval — it
  never fires repeatedly to "catch up".
- `source` — `"claude" | "codex" | "phantomforce" | "user" | "n8n"`.

### Example — "recheck competitor intel in 6 hours, then every 12 hours"

```json
POST /phantom-ai/automations/scheduled
{
  "label": "resync competitor intel",
  "source": "claude",
  "run_in_hours": 6,
  "every_hours": 12,
  "action": { "type": "automation", "jobId": "competitor-intel-scan" }
}
```

### Example — "in 2 hours, trigger the n8n resync workflow"

```json
POST /phantom-ai/automations/scheduled
{
  "label": "kick n8n resync workflow",
  "source": "codex",
  "run_in_hours": 2,
  "action": {
    "type": "webhook",
    "url": "http://127.0.0.1:5678/webhook/phantom-resync",
    "method": "POST",
    "body": { "reason": "scheduled resync" }
  }
}
```

## Why this beats a model self-wakeup

- **0 tokens** to wait — a self-wakeup pays for the model to sit idle.
- **Deterministic** — fires whether or not any agent session is open.
- **Auditable** — every run lands in the Hermes ledger with tokens/cost = 0.
- **Safe** — webhooks can only reach the local automation host, never the
  open internet.
