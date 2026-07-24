# This IS the live admin checkout

`C:\Users\jorda\Documents\Codex\deployments\phantomforce-live` (this exact folder) is the canonical, live source for `admin.phantomforce.online` and `app.phantomforce.online`. Verified against the live `/health.root` — do not trust this claim blindly either; re-check `/health` every session, since it is the only thing that has ever been correct:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/health").Content
```

Only the checkout whose path matches the returned `root` is live. If it ever stops matching this folder, treat this file as stale and go find whichever checkout `/health.root` actually names.

Every worktree under `C:\Users\jorda\Documents\Codex\worktrees` (there are 15+, plus several under `night-shift-worktrees`) is a stale or in-progress experiment branch, not this one. Work committed there does NOT reach `admin.phantomforce.online` or `app.phantomforce.online` until it is merged to `origin/main` and shipped from this canonical checkout — no worktree auto-promotes itself, no matter how complete the work is. This is the exact failure mode that caused finished games (chess, pizzeria, a puzzle game) built on `termina-qa/w2-fixes` to never appear on the live site. If you found this repo by following a stale worktree's "go to the canonical checkout" pointer, you're in the right place — don't bounce back out.

Before making ANY admin/app UI change, run:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/health").Content
git status --short --branch
git log -1 --oneline
```

If local `main` is behind `origin/main`, pull/merge first — concurrent sessions push here too; that is expected, not a conflict to flag or revert.

Shipping: use `npm run ship:live-admin -- --commit "..."` from this checkout. It bumps the build id, runs the test gates, commits, pushes `origin/main`, and verifies the live URLs itself — do not commit-and-stop, and do not push from any other worktree. Do not report "shipped" or "live" without that command printing `LIVE ADMIN SHIP PASSED`.

Any edit to `app/index.html`, `app/js/*.js`, or `app/phantom.css`/`app/phantom-skin.css` requires bumping the `phantom-live-YYYYMMDD-N` build id everywhere those files reference it, or browsers serve stale cached assets — the ship script does this for you.

Navigation preference:
- Keep the sidebar split.
- Main business modules in the upper list.
- `Memory`, `Settings`, `Developer`, and `Away Mode` tucked at the bottom.
- Do not collapse them back into one long ugly list.

## NEVER schedule a Claude/Codex self-wakeup for deferred work

Whenever the plan is "recheck / resync / re-run in N hours" (or any recurring
timer), you MUST register it with PhantomForce's own deferred-task scheduler —
NEVER as a model self-wakeup. A model sitting open to wait burns tokens for
nothing; PhantomForce fires the same timer deterministically off its automation
tick for 0 tokens. The whole point is that nothing recurring runs *outside*
PhantomForce + n8n.

Register via the native primitive (`server/src/phantom-ai/scheduled-tasks.ts`,
exposed at `POST /phantom-ai/automations/scheduled`). A task can:
- run an in-repo automation job (`action: {type:"automation", jobId}`), or
- POST a local n8n webhook (`action: {type:"webhook", url}` — loopback / a host
  in `PHANTOMFORCE_N8N_ALLOWED_HOSTS` only; external URLs are rejected), or
- be a pure `noop` wake-marker.

Give it `run_in_hours` (or `run_at` / `run_in_ms`) and, for recurring work,
`every_hours`. Every fire is proof-logged to the Hermes ledger with
`estimated_tokens: 0`. The only place a paid model may ever be involved is a
single on-demand call *inside* the n8n workflow the task triggers — never a
background agent left running. See `ops/n8n/DEFERRED_TASKS.md`.
