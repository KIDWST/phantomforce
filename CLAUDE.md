# PhantomForce Live Admin Source

## Mandatory live-admin shipping gate

For any user-visible admin/app change, do not report "pushed", "shipped", or "fixed on live" manually.

Run exactly this from the canonical checkout:

```powershell
cd C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
npm run ship:live-admin -- --commit "Short useful commit message"
```

Only claim success if the command prints:

```text
LIVE ADMIN SHIP PASSED
```

That command bumps the `phantom-live-YYYYMMDD-N` cache id, stages the allowed app/server/script files, runs the live-admin guards, commits, pushes `origin/main`, syncs the local admin/Hermes services, and verifies all three live surfaces:

- `http://127.0.0.1:5177/`
- `http://127.0.0.1:5190/`
- `https://admin.phantomforce.online/`

If the command fails, report the exact failing step and do not claim the change is visible.

This checkout is the live admin source for `admin.phantomforce.online` and local `127.0.0.1:5177`.

```text
C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
```

Before editing owner-facing admin UI, verify:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/health").Content
git status --short --branch
git log -1 --oneline
```

If `/health` reports a different `root`, do not claim the change is live. Fix the served root or move the change into this checkout first.

Do not edit sibling PhantomForce worktrees for owner-facing admin UI unless the owner explicitly asked for that branch. There are many stale experimental worktrees on this PC, and changes made there will not appear on `admin.phantomforce.online`.

Sidebar rule:
- Main business modules live in the upper sidebar.
- Utility/operator modules stay separated at the bottom: `Memory`, `Settings`, `Developer`, `Away Mode`, and optional tucked tools.
- Do not reintroduce a single long nav list.

Cache rule:
- Any edit to `app/index.html`, `app/phantom.css`, or `app/js/*.js` must bump the `phantom-live-YYYYMMDD-N` build id everywhere.
- Use `npm run ship:live-admin -- --commit "message"` so the bump, commit, push, service sync, and public proof happen together. The owner does not want local-only changes.
