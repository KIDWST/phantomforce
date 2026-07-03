# PhantomForce Admin Live Site

## Purpose

Expose Jordan's internal PhantomForce admin phantom separately from the client app.

## Domains

- Admin only: `https://admin.phantomforce.online`
- Client/customer app: `https://app.phantomforce.online`

## Local services

- Frontend phantom: `http://127.0.0.1:5177`
- Backend API: `http://127.0.0.1:5190`

The admin Pangolin resource should point to the frontend phantom, not directly to the backend API:

```text
admin.phantomforce.online -> 127.0.0.1:5177
app.phantomforce.online -> 127.0.0.1:5177
```

The Vite frontend proxies `/auth`, `/phantom-ai`, `/readiness`, `/client-access`, and related API paths to `127.0.0.1:5190`.

## Pangolin access model

Product requirement:

- Users should see a PhantomForce login, not a Pangolin login.
- Pangolin/Newt is the hidden private transport from the public hostname to the local app.
- Pangolin should not present a branded resource-auth page for PhantomForce Phantom.
- PhantomForce owns the visible authentication and session boundary.
- Admin production should use `PHANTOMFORCE_AUTH_PROVIDER=owner-production`.
- Demo auth stays disabled for public/admin use.

Do not expose `127.0.0.1:5190` as a separate public resource. Keep the backend behind the frontend proxy and server auth guards.

Gateway setting to verify in Pangolin:

```text
admin.phantomforce.online resource auth: disabled / no Pangolin-branded resource login
admin.phantomforce.online upstream: 127.0.0.1:5177
backend API: not exposed as a separate resource
```

If Pangolin shows `Resource Access - Pangolin`, the resource is still using Pangolin-branded auth and needs to be changed to tunnel/proxy only.

## Host boundaries

The app now treats hosts differently:

- `admin.phantomforce.online` lists and accepts only admin sessions.
- `app.phantomforce.online` lists and accepts only client sessions.
- Localhost keeps both admin and test-client sessions available for development.

## Verification

Expected checks after Pangolin route creation:

```powershell
Invoke-WebRequest -UseBasicParsing https://admin.phantomforce.online -TimeoutSec 10
Invoke-RestMethod https://admin.phantomforce.online/sessions
Invoke-RestMethod https://admin.phantomforce.online/session
```

The browser should land on PhantomForce's own login screen. `/session` should fail closed until a valid PhantomForce session token is issued by `/auth/owner-login`.
