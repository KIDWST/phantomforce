param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5177,
  [int]$EveryMinutes = 15
)

$ErrorActionPreference = "Stop"
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$log = Join-Path $stateDir "admin-watch.log"
$lockPath = Join-Path $stateDir "watch.lock"

try {
  $watchLock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) watcher already running; exiting"
  exit 0
}

try {
  while ($true) {
    try {
      & (Join-Path $PSScriptRoot "Sync-AdminMain.ps1") -RepoRoot $RepoRoot -Port $Port
      Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) sync ok"
    } catch {
      Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) sync failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds ([Math]::Max(60, $EveryMinutes * 60))
  }
} finally {
  $watchLock.Dispose()
}
