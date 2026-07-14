param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5190,
  [string]$Commit = "",
  [switch]$StopExisting
)

# Starts Hermes - the PhantomForce API backend (owner login, org APIs, Asset
# Cloud, Competitor Intelligence, PhantomPlay, agent runs). This is the twin of
# Start-AdminLive.ps1 (which serves the static UI on 5177); the UI proxies API
# calls here. New server routes only go live when THIS process restarts, so the
# sync watches Hermes's /health commit and calls this script when a pull
# delivers new server code - the same hands-free model the static server uses.

$ErrorActionPreference = "Stop"

function Get-ListeningPids {
  param([int]$LocalPort)
  $pattern = "[:.]$LocalPort\s+.*LISTENING\s+(\d+)$"
  netstat -ano | Select-String -Pattern $pattern | ForEach-Object {
    [int]$_.Matches[0].Groups[1].Value
  } | Sort-Object -Unique
}

function Read-DotEnvFile {
  param([string]$Path)

  $values = @{}
  if (!(Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*$' -or $line -match '^\s*#') {
      continue
    }
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      continue
    }

    $key = $Matches[1]
    $value = $Matches[2].Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }

  return $values
}

$repo = (Resolve-Path $RepoRoot).Path
$serverDir = Join-Path $repo "server"
if (!(Test-Path -LiteralPath (Join-Path $serverDir "src\index.ts"))) {
  throw "Missing Hermes entry: $serverDir\src\index.ts"
}
if (!(Test-Path -LiteralPath (Join-Path $serverDir ".env"))) {
  Write-Warning "server\.env not found - Hermes may fail closed on auth config. See docs\ADMIN_RECOVERY.md."
}
$serverEnvPath = Join-Path $serverDir ".env"

$node = (Get-Command node -ErrorAction Stop).Source
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$existing = @(Get-ListeningPids -LocalPort $Port)
if ($existing.Count -gt 0) {
  if (!$StopExisting) {
    Write-Output "Port $Port is already in use by PID(s): $($existing -join ', ')"
    exit 0
  }
  foreach ($listenerPid in $existing) {
    if ($listenerPid -ne $PID) {
      Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 800
}

# Stamp the commit Hermes is running so /health reports it deterministically
# (the sync compares this to the repo HEAD to decide when to restart).
if ([string]::IsNullOrWhiteSpace($Commit)) {
  try { $Commit = (& git -C $repo rev-parse HEAD 2>$null).Trim() } catch { $Commit = "" }
}

$stdout = Join-Path $stateDir "hermes.out.log"
$stderr = Join-Path $stateDir "hermes.err.log"

# Run the checked-out TypeScript source through the local tsx loader. A dist
# directory can be stale because it is generated and not updated by git pull;
# preferring it would restart the old backend after a successful main sync.
$tsxLoader = Join-Path $repo "node_modules\tsx\dist\loader.mjs"
if (!(Test-Path -LiteralPath $tsxLoader)) {
  throw "tsx loader not found. Run 'npm install' in the repo root."
}
$file = $node
$procArgs = @("--import", ([System.Uri]$tsxLoader).AbsoluteUri, "src\index.ts")

$oldCommit = $env:PHANTOMFORCE_BUILD_COMMIT
$oldPort = $env:PORT
$serverEnv = Read-DotEnvFile -Path $serverEnvPath
$oldServerEnv = @{}
foreach ($name in $serverEnv.Keys) {
  $oldServerEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  [Environment]::SetEnvironmentVariable($name, [string]$serverEnv[$name], "Process")
}
$env:PHANTOMFORCE_BUILD_COMMIT = $Commit
$env:PORT = [string]$Port
try {
  $proc = Start-Process -FilePath $file -ArgumentList $procArgs -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} finally {
  $env:PHANTOMFORCE_BUILD_COMMIT = $oldCommit
  $env:PORT = $oldPort
  foreach ($name in $oldServerEnv.Keys) {
    [Environment]::SetEnvironmentVariable($name, $oldServerEnv[$name], "Process")
  }
}
Set-Content -LiteralPath (Join-Path $stateDir "hermes.pid") -Value ([string]$proc.Id) -Encoding ascii

# Give Hermes a moment to bind; it fails closed on bad auth config, so a
# missing bind usually means an env problem (see the err log).
Start-Sleep -Seconds 3
$active = @(Get-ListeningPids -LocalPort $Port)
if ($active -notcontains $proc.Id) {
  Write-Warning "Hermes did not bind port $Port yet. It may still be starting, or check $stderr"
} else {
  $shortCommit = $Commit.Substring(0, [Math]::Min(7, $Commit.Length))
  Write-Output "PhantomForce Hermes API started on 127.0.0.1:$Port from $serverDir (PID $($proc.Id), commit $shortCommit)"
}
