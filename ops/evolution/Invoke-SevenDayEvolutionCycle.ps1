[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712",
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskName = "PhantomForce Seven-Day Evolution"
$lastCycleAt = [datetimeoffset]::Parse("2026-07-25T20:00:00-05:00")
$stopAfter = [datetimeoffset]::Parse("2026-07-26T00:00:00-05:00")
$now = [datetimeoffset]::Now

if ($now -ge $stopAfter) {
  Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  Write-Output "Mission window closed; task disabled."
  exit 0
}

$mutex = [System.Threading.Mutex]::new($false, "Local\PhantomForceSevenDayEvolution")
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(0)
  if (-not $ownsMutex) {
    Write-Output "Another evolution cycle is already running; this trigger exits cleanly."
    exit 0
  }

  $resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $preflight = Join-Path $resolvedRepo "ops\evolution\Invoke-SevenDayEvolutionPreflight.ps1"
  $promptPath = Join-Path $resolvedRepo "ops\evolution\SEVEN_DAY_CYCLE_PROMPT.md"
  if (-not (Test-Path -LiteralPath $preflight) -or -not (Test-Path -LiteralPath $promptPath)) {
    throw "Evolution entrypoint files are missing from $resolvedRepo"
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $preflight -RepoRoot $resolvedRepo
  $preflightExit = $LASTEXITCODE
  if ($PreflightOnly) {
    exit $preflightExit
  }

  $logRoot = "C:\Users\jorda\Documents\Codex\mission-logs\phantomforce-seven-day-evolution"
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runLog = Join-Path $logRoot "$stamp-cycle.log"
  $lastMessage = Join-Path $logRoot "$stamp-final.txt"
  $prompt = Get-Content -Raw -LiteralPath $promptPath
  $codexCli = "C:\Users\jorda\AppData\Local\hermes\node\codex.ps1"
  if (-not (Test-Path -LiteralPath $codexCli)) {
    throw "Codex CLI entrypoint was not found at $codexCli"
  }

  $prompt | & $codexCli exec `
    -C $resolvedRepo `
    -s danger-full-access `
    -a never `
    -m gpt-5.5 `
    -c 'model_reasoning_effort="high"' `
    --color never `
    -o $lastMessage `
    - 2>&1 | Tee-Object -FilePath $runLog
  $codexExit = $LASTEXITCODE

  if ([datetimeoffset]::Now -ge $lastCycleAt) {
    Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  }

  exit $codexExit
}
finally {
  if ($ownsMutex) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
