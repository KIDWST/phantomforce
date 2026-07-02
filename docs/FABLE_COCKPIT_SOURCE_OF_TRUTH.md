# Fable Cockpit Source Of Truth

This document prevents confusion between the public Pages cockpit and the live admin cockpit.

## Active admin repo

```text
C:\Users\jorda\Documents\Codex\worktrees\phantomforce-client-sim-truth-20260629
```

This is the repo to edit when Jordan asks to update:

- `admin.phantomforce.online`
- the admin cockpit
- the private owner dashboard
- the backend-connected admin/client product shell
- the live local production preview behind Pangolin

## Admin cockpit files

The Fable/Claude cockpit is mounted inside the admin web app here:

```text
apps\web\public\app
```

Admin root routing is handled by:

```text
apps\web\index.html
```

Expected admin entry:

```text
https://admin.phantomforce.online/app/index.html
```

The live admin host uses PhantomForce owner-key login. Do not hardcode
`?session=owner-admin` on the public admin host. Query-string sessions are only
acceptable for local/static preview contexts.

## Public Pages repo

The public/static Pages cockpit source is separate:

```text
C:\Users\jorda\Documents\Codex\2026-06-18\when-should-i-use-my-rate\outputs\phantomforce-site\app
```

Expected public demo entry:

```text
https://phantomforce.online/app/
```

That repo is useful as a public/demo cockpit, but editing it alone does not update the Pangolin-backed admin host.

## Rule

If the admin dashboard must change, update this repo:

```text
apps\web\public\app
```

If the public Pages demo must also match, sync the same cockpit changes into:

```text
C:\Users\jorda\Documents\Codex\2026-06-18\when-should-i-use-my-rate\outputs\phantomforce-site\app
```

Do not overwrite the Fable cockpit with the older React dashboard unless Jordan explicitly asks for that rollback.

## Safe verification

Run:

```powershell
npm run build --workspace @phantomforce/web
node --check apps\web\public\app\js\main.js
node --check apps\web\public\app\js\command.js
node --check apps\web\public\app\js\store.js
node --check apps\web\public\app\js\workspaces.js
git diff --check
```

Smoke test:

```powershell
Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/app/index.html?session=owner-admin"
Invoke-WebRequest -UseBasicParsing "https://admin.phantomforce.online/app/js/main.js?v=1"
```

## Claude handoff prompt

```text
You are Claude working on Jordan West's PhantomForce cockpit.

Important source-of-truth rule:
The live admin cockpit is not only the public Pages repo. The admin host uses the admin worktree:

C:\Users\jorda\Documents\Codex\worktrees\phantomforce-client-sim-truth-20260629

The Fable cockpit files that power admin.phantomforce.online are mounted at:

apps\web\public\app

When Jordan asks to improve the admin dashboard, update that folder in the admin worktree. Do not edit only:

C:\Users\jorda\Documents\Codex\2026-06-18\when-should-i-use-my-rate\outputs\phantomforce-site\app

unless the task is specifically the public Pages/demo cockpit. If both public and admin should match, update both intentionally and say so.

Preserve the Fable cockpit style. Do not replace it with the older React dashboard. Do not expose secrets. Do not send external messages, run paid providers, push, or change gateway/DNS unless explicitly approved.
```
