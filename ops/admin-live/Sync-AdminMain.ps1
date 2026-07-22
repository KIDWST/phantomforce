param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5177,
  [int]$HermesPort = 5190,
  [switch]$RestartServer,
  [switch]$SkipHermes
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
    sync_status = "ok"
    sync_reason = ""
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
$logPath = Join-Path $stateDir "sync.log"
$lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

function Write-SyncLog {
  param([string]$Line)
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Add-Content -LiteralPath $logPath -Value "[$stamp] $Line"
}

try {
  $branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne "main") {
    $summary = "skipped: checkout is on '$branch', not main"
    Write-SyncLog $summary
    Write-Output "PhantomForce admin main $summary."
    return
  }

  $dirty = (Invoke-Git status --porcelain --untracked-files=no).Trim()
  if ($dirty) {
    $local = (Invoke-Git rev-parse HEAD).Trim()
    Write-Manifest -Commit $local -Branch $branch

    $uiStarted = $false
    if (@(Get-ListeningPids -LocalPort $Port).Count -eq 0) {
      & (Join-Path $PSScriptRoot "Start-AdminLive.ps1") -RepoRoot $RepoRoot -Port $Port -StopExisting
      $uiStarted = $true
    }

    $hermesStarted = $false
    if (-not $SkipHermes -and @(Get-ListeningPids -LocalPort $HermesPort).Count -eq 0) {
      try {
        & (Join-Path $PSScriptRoot "Start-Hermes.ps1") -RepoRoot $RepoRoot -Port $HermesPort -Commit $local -StopExisting
        $hermesStarted = $true
      } catch {
        Write-SyncLog "Hermes dirty-tree start failed (non-fatal): $($_.Exception.Message)"
      }
    }

    $summary = "skipped git pull: tracked files are dirty; local services checked$(if ($uiStarted) { ' (ui started)' } else { '' })$(if ($hermesStarted) { ' (hermes started)' } else { '' })"
    Write-SyncLog $summary
    Write-Output "PhantomForce admin main $summary."
    return
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

  # Hermes (the API on 5190) is the other half. New server routes — Competitor
  # Intelligence, Asset Cloud, PhantomPlay, agent runs — only go live when THIS
  # process restarts. Same pattern: Hermes reports the commit it is running on
  # /health; when a pull delivered a newer commit (or Hermes isn't answering),
  # restart it. Failures here never abort the sync — the UI is already updated.
  $hermesRestarted = $false
  if (-not $SkipHermes) {
    try {
      $needHermesRestart = [bool]$RestartServer
      $hermesListeners = @(Get-ListeningPids -LocalPort $HermesPort)
      if ($hermesListeners.Count -eq 0) {
        $needHermesRestart = $true
      } elseif (-not $needHermesRestart) {
        try {
          $hermesHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$HermesPort/health" -TimeoutSec 6
          $runningCommit = [string]$hermesHealth.commit
          # restart only when the running commit is a real, older value than
          # what we just synced — never churn Hermes when it is already current
          if ([string]::IsNullOrWhiteSpace($runningCommit) -or $runningCommit -eq "unknown" -or $runningCommit -ne $local) {
            $needHermesRestart = $true
          }
        } catch {
          $needHermesRestart = $true
        }
      }
      if ($needHermesRestart) {
        & (Join-Path $PSScriptRoot "Start-Hermes.ps1") -RepoRoot $RepoRoot -Port $HermesPort -Commit $local -StopExisting
        $hermesRestarted = $true
      }
    } catch {
      Write-SyncLog "Hermes restart check failed (non-fatal): $($_.Exception.Message)"
    }
  }

  $summary = "synced at $($local.Substring(0, 7)); serving 127.0.0.1:$Port$(if ($needRestart) { ' (ui restarted)' } else { '' })$(if ($hermesRestarted) { ' (hermes restarted)' } else { '' })"
  Write-SyncLog $summary
  Write-Output "PhantomForce admin main $summary"
} catch {
  Write-SyncLog "FAILED: $($_.Exception.Message)"
  throw
} finally {
  $lock.Dispose()
}
