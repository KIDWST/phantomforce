# PhantomForce local n8n scaffold

This folder is the first local-only n8n foundation for PhantomForce. It is for localhost testing and dry-run workflow design only.

Hard boundaries:

- Bind only to `127.0.0.1`.
- Prefer port `5678`.
- Do not add credentials.
- Do not expose public webhooks.
- Do not send email, SMS, DMs, social posts, uploads, CRM changes, billing actions, or client messages.
- Do not execute PhantomAI approvals, queue writes, or production ledger writes.

## Files

- `.env.example`: safe local defaults with no secrets.
- `scripts/start-local.ps1`: starts an existing n8n executable with localhost-only environment settings.
- `scripts/stop-local.ps1`: stops only the n8n process recorded by the local pid file.
- `scripts/health-check.ps1`: checks only `http://127.0.0.1:5678/healthz`.
- `workflows/chicagoshots-lead-intake-dry-run.json`: disabled internal workflow draft for ChicagoShots lead intake.
- `CHICAGOSHOTS_DRY_RUN_WORKFLOW.md`: human-readable workflow plan.

## Start

From the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\n8n\scripts\start-local.ps1
```

The start script requires an existing local `n8n` command or `PHANTOM_N8N_COMMAND` pointing to one. It does not install n8n.

## Health

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\n8n\scripts\health-check.ps1
```

The health check is localhost-only and returns JSON. If n8n is down, it reports `running:false`.

## Stop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\n8n\scripts\stop-local.ps1
```

## ChicagoShots dry-run workflow

Import `workflows/chicagoshots-lead-intake-dry-run.json` only into a local n8n instance. Leave it inactive. It is a manual-trigger draft that turns a sample lead into a task draft, follow-up draft, and approval preview. It does not contact clients or external services.
