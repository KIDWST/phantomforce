# PhantomForce — Pangolin Launch Preflight Record

Generated: 2026-06-25. Read-only inspection + backup record. No apply performed.

## Runtime / processes (this machine)
- Port 5188 (web/Vite dev): node PID 96444 — leftover DEMO dev server.
- Port 5190 (backend): node PID 258096 — leftout DEMO backend (NOT owner-production).
- Owner-production server: NOT currently running (verified earlier on 5310, then stopped).
- Production run command: `cd <repo>; node server/dist/index.js` with the real `.env`
  (NODE_ENV=production, owner-production). `.env` sets PORT=5190 — the demo backend on
  5190 must be stopped first.
- Intended upstream for any route: 127.0.0.1:5190 (owner-production backend).

## Pangolin stack
- NOT present on this machine. Docker here only runs `phantomforce-postgres-launch`.
- No Traefik, Pangolin, or Gerbil container or network locally.
- No tunnel client locally: tailscale/newt/headscale/gerbil all absent; no ~/.ssh/config.
- Established topology (from prior Codex inspection artifacts):
  - Remote edge VPS at 108.91.85.172 runs Pangolin + Traefik + Gerbil.
  - Headscale tailnet present (100.90.128.0 / 100.96.128.0 CGNAT range).
  - Newt connectors tunnel private resources to the edge.
  - Edge docker network 172.18.0.0/16.

## Public reachability
- DNS A: app.phantomforce.online -> 108.91.85.172 (the remote edge).
- This machine public IP: 23.234.80.50 (does NOT match DNS; this box is not the edge).
- Port 80: closed at 108.91.85.172. Port 443: closed at 108.91.85.172.
- TLS: not verifiable (443 closed). No cert observed.

## Backup / state snapshot
- Local Pangolin/Traefik config: NONE on this machine (nothing local to back up).
- Real Pangolin/Traefik config lives on the remote edge VPS (108.91.85.172) — not
  accessible from here without SSH/API credentials (none configured).
- Git: clean working tree; commits 9a9f08a -> dec91a8 -> 184a881 (local only, no push).
- `.env`: present, git-ignored, strong generated secrets (not printed).
- Postgres: container `phantomforce-postgres-launch` on 127.0.0.1:5432 (launch candidate).

## Rollback baseline
- App code: `git checkout 184a881` (or `git revert`).
- Owner-production server: stop the node process (no service installed).
- Postgres: `docker rm -f phantomforce-postgres-launch` (launch-candidate DB only).
- No DNS/Pangolin/Traefik changes have been made, so nothing edge-side to roll back.

## Blockers to a real apply (must be resolved with owner)
1. ARCHITECTURE CONFLICT: canonical docs forbid exposing this local backend via tunnel
   while it can reach local Falcon (FALCON_BASE_URL=127.0.0.1:8765). See conflict note.
2. NO EDGE ACCESS PATH from this machine (no SSH config, no Pangolin API creds, no Newt).
3. DNS already points at the edge; edge 80/443 are closed (edge-side work needed).


## UPDATE 2026-06-25 — owner-production live locally + Falcon containment + Newt plan

### Owner-production server now running on 5190 (local only)
- Stopped old demo backend PID 258096 (`node ... tsx ... src/index.ts`).
- Started `node server/dist/index.js` from repo root with real `.env`.
- Verified: healthOk=true, authProvider=owner-production, sessionSecretUsesDefault=false,
  /readiness 401 without token + 200 with owner token, demoLogin=403,
  repositoryDriver=prisma-postgres, prismaWriteMode=enabled,
  production_auth=ready, production_postgres=ready.
- Bound to 127.0.0.1 only (not public).

### Falcon containment (the glass)
- `server/src/falcon/broker.ts` is a non-executing stub: describe() only, no HTTP call,
  boundary="server-only", rawPassthrough=false.
- Only Falcon route: `POST /falcon/jobs/validate` — schema validation + broker metadata; no
  execution, no proxy to 8765.
- Network: 8765 not listening at all; 5188/5190/5432 bound to 127.0.0.1 only.
- Minor hardening (optional): admin-gate /falcon/jobs/validate so the FALCON_BASE_URL string
  is not returned to anonymous public callers once a route is live.

### Newt apply plan (NOT applied — awaiting approval + credentials)
Upstream target: 127.0.0.1:5190 (PhantomForce owner-production ONLY).
Never tunnel: 8765 (Falcon), 5432 (Postgres), 5188, Docker, or any internal port.

Two-sided apply:
A. Pangolin edge (108.91.85.172, via your Pangolin dashboard/API — owner action):
   - Create/confirm a Newt "site" for this machine; capture NEWT_ID + NEWT_SECRET + endpoint.
   - Create an HTTP resource: domain app.phantomforce.online -> target the site's
     127.0.0.1:5190, TLS enabled (Let's Encrypt at the edge). No other ports.
B. This machine (after approval):
   - Run Newt connector pointed ONLY at 127.0.0.1:5190. Preferred: foreground/background
     process or Docker container named phantomforce-newt (no Windows service installed).
   - Example (native): `newt --id <NEWT_ID> --secret <NEWT_SECRET> --endpoint https://<edge>`
   - Example (docker): `docker run -d --name phantomforce-newt -e PANGOLIN_ENDPOINT=https://<edge> -e NEWT_ID=<id> -e NEWT_SECRET=<secret> fosrl/newt`
     (target host.docker.internal:5190 if containerized).

Verification after apply (external):
   - https://app.phantomforce.online/health returns ok.
   - /readiness 401 without token, 200 with owner token; demo login 403.
   - 8765 / 5432 NOT reachable through the domain.
   - TLS valid; no console errors; no secret leakage.

Backup / rollback:
   - Backup: this preflight record + git baseline 184a881; Pangolin edge config is
     dashboard/DB-managed on the VPS (export from the dashboard before edit).
   - Rollback: disable/delete the Pangolin resource in the dashboard; stop Newt
     (`docker rm -f phantomforce-newt` or end the newt process); app/DNS unchanged.

Inputs required from owner before apply:
   1. Pangolin edge base URL + admin access (or you create the resource yourself).
   2. NEWT_ID + NEWT_SECRET enrollment values (never pasted in chat — provide via the
      password-manager flow or place into a gitignored env file).
   3. Confirm Newt run mode here: native newt.exe vs Docker container.
   4. Confirm DNS stays as-is (already -> 108.91.85.172); no DNS change requested.
