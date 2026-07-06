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

  $listeners = @(Get-ListeningPids -LocalPort $Port)
  if ($RestartServer -or $listeners.Count -eq 0) {
    & (Join-Path $PSScriptRoot "Start-AdminLive.ps1") -RepoRoot $RepoRoot -Port $Port -StopExisting
  }

  Write-Output "PhantomForce admin main synced at $($local.Substring(0, 7)); serving 127.0.0.1:$Port"
} finally {
  $lock.Dispose()
}
