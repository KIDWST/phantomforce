# ChicagoShots Lead Intake — Dry Run Workflow

`workflows/chicagoshots-lead-intake-dry-run.json` is a **draft-only** n8n
workflow mirroring the real server-side pipeline in
`server/src/phantom-ai/ops-workflow.ts`
(`buildChicagoShotsLeadIntakePreview`). It exists so the shape of that
pipeline can be reviewed and rebuilt by hand in the n8n editor — it does not
run anything on its own.

## Stages

1. **Manual Trigger** — the only trigger in this file. No webhook, cron, or
   external event source is wired up.
2. **Lead Intake Sample** — a placeholder mirroring the real input shape
   (client name, contact, event type, date/time, location, requested
   service, budget, notes, source platform, urgency).
3. **Task Draft** — mirrors `task_draft` (steps, priority, deliverables
   checklist). Nothing is scheduled or assigned.
4. **Follow-up Draft** — mirrors `follow_up_draft` (subject, body,
   channel hint). No send action is configured; this is intentionally a
   dead end until an owner reviews it.
5. **Approval Preview** — mirrors `approval_preview`
   (`status: "preview-only"`, `execution_disabled: true`). No integration is
   connected here either.

## Safety posture

- `active: false` — this workflow cannot run automatically even if imported.
- No `credentials` block anywhere in the file.
- No webhook, HTTP request, email, Gmail, SMTP, Slack, Telegram, Twilio, or
  Discord node types — every node is a `noOp` placeholder or the manual
  trigger.
- No public webhook URL or endpoint appears anywhere in this file.

## Using this scaffold

This file is a starting point for a human to import into a **local** n8n
instance (see `../scripts/start-local.ps1`) and extend deliberately — it is
not consumed or executed by PhantomForce itself. `docs/tooling-spine/tool-registry.json`
lists `active_workflows` and `public_webhooks` as explicitly blocked actions
for the `n8n` tool entry until that changes.
