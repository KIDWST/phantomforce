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
