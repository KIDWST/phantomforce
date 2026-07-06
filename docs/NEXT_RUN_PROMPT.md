# Next Run Prompt

Continue from the completed PhantomForce unattended product-engineering run in `docs/UNATTENDED_RUN_CHECKPOINT.md`.

Rules:

- Do not push.
- Do not deploy or sync admin live.
- Do not send external messages, connect accounts, change billing/payment/cancellation, expose secrets, or perform destructive database operations.
- Keep changes local unless a later user explicitly overrides this run's no-push/no-deploy rule.
- If high-risk work is needed, add it to `docs/UNATTENDED_APPROVAL_QUEUE.md` and keep working on safe items.

Current state:

1. Phantom AI intent router is implemented and tested.
2. Chat companion is contained in the chat header and documented.
3. Account/profile/plan module has identity, safe billing controls, tiers, cancellation guardrails, and billing-history scaffolding.
4. Looper creates local guarded build packets and surfaces them in Site Creator.
5. Build, typecheck, intent test, syntax checks, diff check, and scans passed in the previous run.

Start by running:

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
Get-Content docs\UNATTENDED_RUN_CHECKPOINT.md -Raw
```

Then continue from the checkpoint's `Current Phase` and update the checkpoint after each major phase.

Suggested next step:

- Review the local commit/diff and only then decide whether to push, deploy, or sync `admin.phantomforce.online` in a separate approved run.
