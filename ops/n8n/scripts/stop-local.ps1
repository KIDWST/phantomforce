$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$pidPath = Join-Path $root ".local\n8n.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
  [pscustomobject]@{
    ok = $true
    stopped = $false
    reason = "pid_file_missing"
    pid_path = $pidPath
  } | ConvertTo-Json -Compress
  exit 0
}

$pidText = (Get-Content -LiteralPath $pidPath -Raw).Trim()
if (-not ($pidText -match "^\d+$")) {
  throw "Invalid n8n pid file."
}

$targetPid = [int]$pidText
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid" -ErrorAction SilentlyContinue
if (-not $processInfo) {
  Remove-Item -LiteralPath $pidPath -Force
  [pscustomobject]@{
    ok = $true
    stopped = $false
    reason = "process_already_stopped"
    pid = $targetPid
  } | ConvertTo-Json -Compress
  exit 0
}

if ($processInfo.CommandLine -notmatch "n8n") {
  throw "Refusing to stop PID $targetPid because it does not look like an n8n process."
}

$allProcesses = @(Get-CimInstance Win32_Process)
$processIdsToStop = New-Object System.Collections.Generic.List[int]
$processIdsToStop.Add($targetPid)

do {
  $added = $false
  foreach ($candidate in $allProcesses) {
    $candidatePid = [int]$candidate.ProcessId
    if ($processIdsToStop.Contains($candidatePid)) {
      continue
    }

    if ($processIdsToStop.Contains([int]$candidate.ParentProcessId)) {
      $processIdsToStop.Add($candidatePid)
      $added = $true
    }
  }
} while ($added)

foreach ($processIdToStop in @($processIdsToStop | Sort-Object -Descending)) {
  Stop-Process -Id $processIdToStop -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $pidPath -Force

[pscustomobject]@{
  ok = $true
  stopped = $true
  pid = $targetPid
  stopped_process_ids = @($processIdsToStop)
  pid_path = $pidPath
} | ConvertTo-Json -Compress
