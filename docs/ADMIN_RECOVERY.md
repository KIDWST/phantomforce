# Admin Recovery — locked out / server stopped

Read this when admin.phantomforce.online won't let you in or won't load.
Golden rule: **your owner key almost never "breaks" — a stopped process on
the admin PC is the cause 99% of the time.**

## How login actually works

The login page checks your owner key against **Hermes** (the backend running
on the admin PC). The key lives in `server/.env` as
`PHANTOMFORCE_OWNER_LOGIN_KEY` (short keys also need
`PHANTOMFORCE_ALLOW_SHORT_OWNER_LOGIN_KEY=true`). So:

- **Hermes stopped** → every key is rejected or the page says the API is
  unavailable. The key did not change.
- **Hermes started from the wrong folder** → it can't find `.env`, so the
  right key is rejected (or the server refuses to start).

## Fastest fix: restart the stack

**Option A — reboot the PC.** Both the admin static server AND Hermes now
re-register at logon (scheduled tasks), so everything comes back on its own.
Try signing in ~2 minutes after logon.

> **Why a feature can say "unavailable" / "Not Found" even though login works:**
> new server routes (Competitor Intelligence, Asset Cloud, PhantomPlay, agent
> runs) only exist once **Hermes** restarts on the new code. The UI files sync
> from GitHub automatically, but the API process used to keep running old code
> until a manual restart — which is exactly what made a page 404. This is now
> fixed: the every-15-min sync compares Hermes's running commit
> (`/health` → `commit`) against the freshly-pulled `main` and restarts Hermes
> when they differ. So a new feature goes live within one sync cycle, hands-free.
> If you want it *instantly* instead of waiting for the tick, use Option B.

**Option B — start Hermes by hand:**
1. Open PowerShell.
2. `cd` into the repo's server folder, e.g.
   `cd C:\path\to\phantomforce\server`
3. Run `npm run dev` (leave the window open), or `npm start` if a built
   `dist/` is used on this box.
4. Wait ~20 seconds, then check it's alive: open
   `http://127.0.0.1:5190/health` in a browser on the PC — you should see
   JSON, not an error.
5. Sign in at admin.phantomforce.online with your owner key.

If the login PAGE itself won't load, the static server is down too:
run `powershell -File ops\admin-live\Start-AdminLive.ps1` from the repo,
or just reboot (it starts at logon).

## If Hermes refuses to start (auth config errors)

Hermes fails closed: it exits at startup if the auth env is incomplete.
Check `server\.env` contains (values are yours, not these placeholders):

```
PHANTOMFORCE_AUTH_PROVIDER=owner-production
PHANTOMFORCE_OWNER_EMAIL=<your email>
PHANTOMFORCE_OWNER_LOGIN_KEY=<your owner key>
PHANTOMFORCE_ALLOW_SHORT_OWNER_LOGIN_KEY=true   # only if the key is under 16 chars
PHANTOMFORCE_SESSION_SECRET=<random 32+ characters>
```

The startup error in the console names exactly which variable is missing —
fix that one line and start again. Never commit `.env` to git.

## To change or reset the owner key

Edit `PHANTOMFORCE_OWNER_LOGIN_KEY` in `server\.env`, then restart Hermes.
That's the whole reset — there is no separate password database for the
owner key.

## Still stuck?

- `http://127.0.0.1:5177/health` (static server) and
  `http://127.0.0.1:5190/health` (Hermes) on the PC tell you which half is
  down.
- The login page's error message now says whether the backend is down vs.
  the key being rejected — believe it, it's accurate.
