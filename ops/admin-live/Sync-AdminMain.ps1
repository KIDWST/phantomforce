param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5177,
  [switch]$RestartServer
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $output = & git -C $RepoRoot @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed: $output"
  }
  if ($null -eq $output) {
    return ""
  }
  return ($output -join "`n")
}

function Write-Manifest {
  param([string]$Commit, [string]$Branch)
  $manifestPath = Join-Path $RepoRoot "app\.phantomforce-sync.json"
  $payload = [ordered]@{
    source = (Join-Path $RepoRoot "app")
    live = (Join-Path $RepoRoot "app")
    branch = $Branch
    commit = $Commit
    synced_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    served_direct = $true
    port = $Port
  }
  $payload | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding ascii
}

function Get-ListeningPids {
  param([int]$LocalPort)
  $pattern = "[:.]$LocalPort\s+.*LISTENING\s+(\d+)$"
  netstat -ano | Select-String -Pattern $pattern | ForEach-Object {
    [int]$_.Matches[0].Groups[1].Value
  } | Sort-Object -Unique
}

$RepoRoot = (Resolve-Path $RepoRoot).Path
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$lockPath = Join-Path $stateDir "sync.lock"
$lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

try {
  $branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne "main") {
    throw "Checkout is on '$branch', not main."
  }

  $dirty = (Invoke-Git status --porcelain --untracked-files=no).Trim()
  if ($dirty) {
    throw "Tracked files are dirty. Commit or stash before auto-sync."
  }

  Invoke-Git fetch --quiet origin main | Out-Null
  $local = (Invoke-Git rev-parse HEAD).Trim()
  $remote = (Invoke-Git rev-parse origin/main).Trim()

  if ($local -ne $remote) {
    Invoke-Git merge --ff-only origin/main | Out-Null
    $local = (Invoke-Git rev-parse HEAD).Trim()
  }

  Write-Manifest -Commit $local -Branch $branch

  # Restart when needed: port empty, explicitly asked, or the RUNNING server's
  # code no longer matches the file on disk (a pull delivered a new server).
  # The server reports its own source fingerprint on /health, so a push to
  # main reaches the live process within one sync cycle — hands-free forever.
  $needRestart = [bool]$RestartServer
  $listeners = @(Get-ListeningPids -LocalPort $Port)
  if ($listeners.Count -eq 0) {
    $needRestart = $true
  } elseif (-not $needRestart) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 6
      $serverFile = Join-Path $PSScriptRoot "admin-static-server.mjs"
      $diskHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $serverFile).Hash.Substring(0, 16).ToLower()
      $runningHash = [string]$health.source_hash
      if ($runningHash -ne $diskHash) {
        $busy = 0
        try { $busy = [int]$health.jobs_running } catch { $busy = 0 }
        if ($busy -gt 0) {
          Write-Output "Server code updated but $busy render job(s) in flight; deferring restart to the next sync."
        } else {
          $needRestart = $true
        }
      }
    } catch {
      # a listener that can't answer /health isn't serving — replace it
      $needRestart = $true
    }
  }
  if ($needRestart) {
    & (Join-Path $PSScriptRoot "Start-AdminLive.ps1") -RepoRoot $RepoRoot -Port $Port -StopExisting
  }

  Write-Output "PhantomForce admin main synced at $($local.Substring(0, 7)); serving 127.0.0.1:$Port"
} finally {
  $lock.Dispose()
}
