# ChicagoShots lead intake dry-run workflow

Purpose: turn a sample ChicagoShots lead into internal draft objects Jordan can review.

Flow:

1. Lead intake sample
2. Task draft
3. Follow-up draft
4. Approval preview

Dry-run outputs:

- A lead summary for internal review.
- A task draft for Jordan.
- A short follow-up message draft.
- An approval preview that says no approval execution is implemented.

Blocked actions:

- No public webhook.
- No credentials.
- No email, SMS, DM, social post, upload, CRM mutation, billing action, or client call.
- No PhantomAI approval execution.
- No queue write.
- No production ledger write.
- No provider call.

How to use:

1. Start local n8n only on `127.0.0.1:5678`.
2. Import `workflows/chicagoshots-lead-intake-dry-run.json`.
3. Keep the workflow inactive.
4. Use manual execution only with sample/internal data.
5. Review the generated drafts before any separate, future approval path exists.
