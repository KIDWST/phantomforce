# PhantomForce - local Asset Vault stack launcher.
#
# Starts (or reuses) the asset-vault worktree's API + admin app on their own
# ports and opens the browser. Deliberately does NOT touch the live main-trunk
# stack (5177/5190) or any other worktree's servers - multiple agent stacks run
# on this machine, so every listener is verified to be OURS (by /health root or
# by the vault-only search route) before being reused, and never killed if not.
#
# Usage:  powershell -ExecutionPolicy Bypass -File Start-AssetVaultLocal.ps1

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$serverDir = Join-Path $repo "server"
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\asset-vault-local"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Test-PortFree([int]$Port) {
  -not (netstat -ano | Select-String "[:.]$Port\s+.*LISTENING")
}

function Probe([string]$Url, [int]$TimeoutSec = 3) {
  try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec $TimeoutSec -SkipHttpErrorCheck } catch { $null }
}

# ---- API: reuse only a listener that has the vault-branch search route (401 there
# means "ours, auth required"; 404 means some other PhantomForce build owns the port).
$apiPort = $null
# Pass 1: reuse a vault API already running anywhere in the range - never
# start a second instance when one exists on a later port.
foreach ($p in 5191..5199) {
  if (Test-PortFree $p) { continue }
  $r = Probe "http://127.0.0.1:$p/phantom-ai/content/assets/search" 6
  if (-not $r) {
    # busy port, slow first answer (cold tsx) - one more patient try before skipping
    $r = Probe "http://127.0.0.1:$p/phantom-ai/content/assets/search" 10
  }
  if ($r -and $r.StatusCode -eq 401) { $apiPort = $p; break }
}
# Pass 2: nothing reusable - start our own on the first free port.
if (-not $apiPort) { foreach ($p in 5191..5199) {
  if (Test-PortFree $p) {
    $env:PORT = "$p"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx tsx src/index.ts" `
      -WorkingDirectory $serverDir -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $stateDir "api.out.log") `
      -RedirectStandardError (Join-Path $stateDir "api.err.log")
    foreach ($i in 1..20) {
      Start-Sleep -Milliseconds 500
      $r = Probe "http://127.0.0.1:$p/phantom-ai/content/assets/search"
      if ($r -and $r.StatusCode -eq 401) { $apiPort = $p; break }
    }
    if ($apiPort) { break }
    throw "API did not come up on port $p - check $stateDir\api.err.log"
  }
} }
if (-not $apiPort) { throw "No usable port in 5191-5199 for the vault API." }

# ---- Static app: reuse only a listener whose /health root is THIS worktree.
$appPort = $null
foreach ($p in 5271..5279) {
  $h = Probe "http://127.0.0.1:$p/health"
  if ($h -and $h.StatusCode -eq 200) {
    $info = $h.Content | ConvertFrom-Json
    if ($info.root -eq $repo) { $appPort = $p; break }
    continue # someone else's static server - leave it alone
  }
  if (Test-PortFree $p) {
    Start-Process -FilePath "node" -ArgumentList (Join-Path $repo "ops\admin-live\admin-static-server.mjs"),
      "--root", $repo, "--port", "$p", "--host", "127.0.0.1", "--api", "http://127.0.0.1:$apiPort" `
      -WorkingDirectory $repo -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $stateDir "app.out.log") `
      -RedirectStandardError (Join-Path $stateDir "app.err.log")
    foreach ($i in 1..10) {
      Start-Sleep -Milliseconds 400
      $h = Probe "http://127.0.0.1:$p/health"
      if ($h -and $h.StatusCode -eq 200 -and (($h.Content | ConvertFrom-Json).root -eq $repo)) { $appPort = $p; break }
    }
    if ($appPort) { break }
    throw "Static app did not come up on port $p - check $stateDir\app.err.log"
  }
}
if (-not $appPort) { throw "No usable port in 5271-5279 for the admin app." }

Write-Output "Asset Vault stack ready: app http://127.0.0.1:$appPort (API :$apiPort)"
Write-Output "Log in as 'PhantomForce Owner' with your owner key, then Content Hub -> Search the full vault -> tag 'motionarray'."
Start-Process "http://127.0.0.1:$appPort/"
