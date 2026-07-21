# STOP — this is NOT the live admin checkout

This worktree previously claimed to be the live admin source. It is not, and never reliably was — that claim was stale boilerplate copied across several worktrees (including this one), which is exactly the kind of confusion that caused finished work (games, fixes) to sit invisible on unmerged branches for days. Verified against the live `/health.root`, the real live source is:

```text
C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
```

Go there and read its CLAUDE.md — it has the mandatory `npm run ship:live-admin -- --commit "..."` shipping gate. Do not edit app/server/script files in this worktree for owner-facing changes; they will not reach `admin.phantomforce.online` or `app.phantomforce.online` no matter how correct they are, until explicitly merged to `main` and shipped from the canonical checkout.

Before trusting ANY path (including the one above) as "the live one," verify it yourself — docs go stale, `/health` does not:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/health").Content
```

Only the checkout whose path matches the returned `root` is live.
