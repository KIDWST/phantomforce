# PhantomForce Admin Live Runtime

This folder keeps `admin.phantomforce.online` reliable without exposing the backend publicly.

## Runtime model

- Pangolin routes `admin.phantomforce.online` to the local frontend on `127.0.0.1:5177`.
- The frontend serves the production web build with `vite preview`.
- The preview server proxies API routes to the private backend on `127.0.0.1:5190`.
- The backend reads owner-production auth from ignored local env files.
- GitHub Pages remains separate and only owns the public/static phantom at `phantomforce.online/app/`.

## Start

```powershell
.\ops\admin-live\Start-PhantomForceAdmin.ps1
```

Open the local admin app after the runtime is ready:

```powershell
.\ops\admin-live\Start-PhantomForceAdmin.ps1 -OpenBrowser
```

Use `-Build` after source changes:

```powershell
.\ops\admin-live\Start-PhantomForceAdmin.ps1 -Build
```

## Stop

```powershell
.\ops\admin-live\Stop-PhantomForceAdmin.ps1
```

## Health check

```powershell
.\ops\admin-live\Test-PhantomForceAdmin.ps1
```

The health check confirms:

- local frontend responds
- local admin app responds at `http://127.0.0.1:5177/app/?session=admin`
- proxied `/sessions` responds through the frontend
- public admin URL responds
- public admin URL serves production assets, not Vite dev source
- owner-production auth is visible in `/sessions`

If the local checks pass but the public admin URL fails with DNS errors, the local admin app is running and the
remaining fix is external DNS/Pangolin routing for `admin.phantomforce.online`.

## Register local startup

```powershell
.\ops\admin-live\Register-PhantomForceAdminStartup.ps1
```

This first tries to register a current-user Windows Scheduled Task named `PhantomForce Admin Phantom`.
If Windows denies task registration, it installs a current-user Startup folder shortcut instead. Both methods start
the admin phantom at login without storing credentials in the script.

## Boundaries

- Do not point `admin.phantomforce.online` to GitHub Pages.
- Do not expose `127.0.0.1:5190` publicly.
- Do not store credentials in this folder.
- Logs go under ignored `.local/admin-live/logs`.
