# PhantomForce Admin Live Site

## Purpose

Expose Jordan's internal PhantomForce admin cockpit separately from the client app.

## Domains

- Admin only: `https://admin.phantomforce.online`
- Client app: `https://app.chicagoshots.online`
- Legacy client host allowed for migration only: `https://app.phantomforce.online`

## Local services

- Frontend cockpit: `http://127.0.0.1:5177`
- Backend API: `http://127.0.0.1:5190`

The admin Pangolin resource should point to the frontend cockpit, not directly to the backend API:

```text
admin.phantomforce.online -> 127.0.0.1:5177
```

The Vite frontend proxies `/auth`, `/phantom-ai`, `/readiness`, `/client-access`, and related API paths to `127.0.0.1:5190`.

## Pangolin access model

Recommended production auth posture:

- Pangolin protects `admin.phantomforce.online`.
- Pangolin forwards identity to PhantomForce.
- PhantomForce runs with `PHANTOMFORCE_AUTH_PROVIDER=gateway-forwarded`.
- Demo auth stays disabled.
- The forwarded admin user is allowlisted through `PHANTOMFORCE_GATEWAY_ADMIN_USERS`.
- The shared gateway secret is sent through `PHANTOMFORCE_GATEWAY_SECRET_HEADER`.

Do not expose `127.0.0.1:5190` as a separate public resource. Keep the backend behind the frontend proxy and server auth guards.

## Host boundaries

The app now treats hosts differently:

- `admin.phantomforce.online` lists and accepts only admin sessions.
- `app.chicagoshots.online` lists and accepts only client sessions.
- Localhost keeps both admin and test-client sessions available for development.

## Verification

Expected checks after Pangolin route creation:

```powershell
Invoke-WebRequest -UseBasicParsing https://admin.phantomforce.online -TimeoutSec 10
Invoke-RestMethod https://admin.phantomforce.online/sessions
Invoke-RestMethod https://admin.phantomforce.online/session
```

`/session` should return the Pangolin-forwarded admin session only after gateway auth is configured. Without valid gateway auth, protected API calls should fail closed.
