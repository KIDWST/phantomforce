# PhantomForce Live Admin Source

This checkout (`phantomforce-main-trunk-20260706`) is the live admin source for `admin.phantomforce.online` and local `127.0.0.1:5177` — confirmed directly via `/health` returning this exact path as `root`. A previous version of this file pointed at `phantomforce-live-social-analytics-20260712` instead; that worktree is stale (tens of commits behind, predates this branch's dashboard work) and is NOT the live source. Do not use it for owner-facing admin UI work.

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
- Commit and push after verification. The owner does not want local-only changes.
