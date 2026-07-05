# PhantomForce Master Health Loop

Local health monitoring for Jordan's master PC.

## Scripts

- `Invoke-PhantomForceMasterHealth.ps1`
  - `-Mode heartbeat`: lightweight status check for the 6-hour scheduled loop.
  - `-Mode daily`: deeper daily check with Windows Defender quick scan when available.
- `Invoke-ConsolePopupAudit.ps1`
  - Checks for shell/console popup suspects and writes a sanitized report.
- `Register-PhantomForceMasterHealth.ps1`
  - Creates user-level Windows Scheduled Tasks:
    - `\PhantomForce\Master Daily Health`
    - `\PhantomForce\Master 6-Hour Health`
    - `\PhantomForce\Console Popup Watcher`
  - The minimum scheduled interval is 6 hours. Do not register 5-minute/hourly
    checks for this machine without Jordan explicitly changing that policy.

## Reports

Human-readable reports:

```text
C:\Users\jorda\Documents\Obsidian\PhantomForce-Command-Center\System Health
```

Machine-readable latest report:

```text
%LOCALAPPDATA%\PhantomForce\MasterHealth\latest.json
```

Console popup watcher:

```text
C:\Users\jorda\Documents\Obsidian\PhantomForce-Command-Center\System Health\LATEST-console-popup-watch.md
%LOCALAPPDATA%\PhantomForce\MasterHealth\latest-console-popups.json
```

## Safety

The loop is report-first. It does not delete files, change services, send emails,
post content, write credentials, or mutate production data.
