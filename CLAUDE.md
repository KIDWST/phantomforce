# Canonical editing and live deployment

`G:\Codex\Documents\Codex\deployments\phantomforce-live` is the dedicated live source for `admin.phantomforce.online` and `app.phantomforce.online`. It is serve/sync only: do not edit features, run generators, or build games there. The canonical editing checkout is `G:\Codex\Documents\Codex\worktrees\phantomforce-current`. This file exists in every clone; its presence does not make that clone live. Re-check `/health` every session:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/health").Content
```

The returned `root` must match the dedicated G: deployment. If it names an editing or retired C: checkout, repair the startup/update paths and verify the source doctor; do not bless the incorrect root as canonical.

Development and recovery worktrees are not live deployments. Their work reaches the product only after verified integration on `origin/main` and a clean deployment sync. Preserve unrelated dirty work in a named recovery stash/worktree rather than resetting it. The incomplete C: deployment is a migration remnant, not a fallback live root.

Before making ANY admin/app UI change, run:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/health").Content
git status --short --branch
git log -1 --oneline
```

If local `main` is behind `origin/main`, pull/merge first — concurrent sessions push here too; that is expected, not a conflict to flag or revert.

Shipping: use `npm run ship:live-admin -- --commit "..."` from a current, verified main editing checkout, not the deployment. It validates the clean dedicated deployment, bumps the build id, runs the full critical suite, commits, pushes `origin/main`, syncs the dedicated deployment, and verifies the live URLs/root. Do not report "shipped" or "live" without `LIVE ADMIN SHIP PASSED`; also run the source doctor from the deployment and disclose non-passing diagnostics.

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
