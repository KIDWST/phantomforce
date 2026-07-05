param(
  [string]$VaultRoot = "C:\Users\jorda\Documents\Obsidian\PhantomForce-Command-Center"
)

$ErrorActionPreference = "Stop"

$ReportDir = Join-Path $VaultRoot "System Health"
$RuntimeDir = Join-Path $env:LOCALAPPDATA "PhantomForce\MasterHealth"
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$StartedAt = Get-Date
$latestJson = Join-Path $RuntimeDir "latest-console-popups.json"
$lastJson = Join-Path $RuntimeDir "last-console-popups.json"
$latestMd = Join-Path $ReportDir "LATEST-console-popup-watch.md"

function Sanitize-Text {
  param([AllowNull()][string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }

  $safe = $Text
  $safe = $safe -replace "(?i)sk-or-v1-[A-Za-z0-9_-]{12,}", "sk-or-v1-<redacted>"
  $safe = $safe -replace "(?i)sk-[A-Za-z0-9_-]{12,}", "sk-<redacted>"
  $safe = $safe -replace "(?i)(api[_-]?key|token|secret|password|passwd|pwd|authorization|bearer)\s*[:=]\s*[`"']?[^`"'\s;]+", '$1=<redacted>'
  $safe = $safe -replace "(?i)(--(?:api-key|token|secret|password|passwd|pwd))\s+[^`"'\s;]+", '$1 <redacted>'

  if ($safe.Length -gt 420) {
    return $safe.Substring(0, 420) + "..."
  }
  return $safe
}

function Get-ProcessIndex {
  $index = @{}
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $index[[int]$_.ProcessId] = $_
  }
  return $index
}

function Convert-CimDate {
  param($Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [datetime]) { return $Value }
  try { return [Management.ManagementDateTimeConverter]::ToDateTime([string]$Value) } catch { return $null }
}

function Convert-ConsoleProcess {
  param(
    [object]$Process,
    [hashtable]$ProcessIndex,
    [hashtable]$WindowTitles
  )

  $created = Convert-CimDate $Process.CreationDate
  $parent = $ProcessIndex[[int]$Process.ParentProcessId]
  $command = Sanitize-Text ([string]$Process.CommandLine)
  $parentCommand = if ($parent) { Sanitize-Text ([string]$parent.CommandLine) } else { "" }
  $line = "$($Process.Name) $command $($parent.Name) $parentCommand"
  $isSuspect =
    $line -match "(?i)\.cmd|\.bat|start-ai-stack|Launch NexProspex|run_kali_mcp|NoExit|wsl\b|qwen|npm run dev|tsx watch|vite preview|node dist/index\.js|powershell\.exe|pwsh\.exe|cmd\.exe"

  [pscustomobject]@{
    key = "$($Process.ProcessId)|$($Process.CreationDate)|$command"
    pid = [int]$Process.ProcessId
    parent_pid = [int]$Process.ParentProcessId
    name = $Process.Name
    created = if ($created) { $created.ToString("o") } else { "" }
    age_minutes = if ($created) { [math]::Round(((Get-Date) - $created).TotalMinutes, 1) } else { $null }
    parent_name = if ($parent) { $parent.Name } else { "" }
    window_title = $WindowTitles[[int]$Process.ProcessId]
    command = $command
    parent_command = $parentCommand
    suspect = [bool]$isSuspect
  }
}

$windowTitles = @{}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $windowTitles[[int]$_.Id] = $_.MainWindowTitle
}

$processIndex = Get-ProcessIndex
$allConsole = @(
  $processIndex.Values |
    Where-Object { $_.Name -match "^(cmd|powershell|pwsh|WindowsTerminal|OpenConsole|conhost)\.exe$" } |
    ForEach-Object { Convert-ConsoleProcess -Process $_ -ProcessIndex $processIndex -WindowTitles $windowTitles } |
    Where-Object {
      $_.command -notmatch "Invoke-ConsolePopupAudit|Invoke-PhantomForceMasterHealth|Invoke-PhantomForceExternalSurfaceScan"
    } |
    Sort-Object created -Descending
)

$lastKeys = @{}
if (Test-Path $lastJson) {
  try {
    $previous = Get-Content -Raw -LiteralPath $lastJson | ConvertFrom-Json
    @($previous.console_processes) | ForEach-Object { $lastKeys[$_.key] = $true }
  } catch {}
}

$newConsole = @($allConsole | Where-Object { -not $lastKeys.ContainsKey($_.key) })
$suspects = @($allConsole | Where-Object { $_.suspect } | Select-Object -First 30)
$newSuspects = @($newConsole | Where-Object { $_.suspect } | Select-Object -First 30)
$overall = if ($newSuspects.Count -gt 0) { "new_console_activity" } elseif ($suspects.Count -gt 0) { "watch" } else { "quiet" }

$report = [ordered]@{
  started_at = $StartedAt.ToString("o")
  overall = $overall
  console_process_count = $allConsole.Count
  suspect_count = $suspects.Count
  new_console_count = $newConsole.Count
  new_suspect_count = $newSuspects.Count
  new_suspects = [object[]]$newSuspects
  suspects = [object[]]$suspects
  console_processes = [object[]]$allConsole
  note = "Command lines are sanitized before writing. This watcher does not kill or modify processes."
}

$json = $report | ConvertTo-Json -Depth 10
$json | Set-Content -LiteralPath $latestJson -Encoding UTF8
$json | Set-Content -LiteralPath $lastJson -Encoding UTF8

function Format-ProcessLine {
  param([object]$Item)
  if (-not $Item) { return "" }
  $parent = if ($Item.parent_name) { " parent=$($Item.parent_name)($($Item.parent_pid))" } else { "" }
  $cmd = if ($Item.command) { " cmd=$($Item.command)" } else { "" }
  return "- $($Item.name)($($Item.pid)) age=$($Item.age_minutes)m$parent$cmd"
}

$newLines = if ($newSuspects.Count -gt 0) {
  ($newSuspects | ForEach-Object { Format-ProcessLine $_ }) -join "`n"
} else {
  "- None detected since last watch run."
}

$suspectLines = if ($suspects.Count -gt 0) {
  ($suspects | Select-Object -First 12 | ForEach-Object { Format-ProcessLine $_ }) -join "`n"
} else {
  "- None detected."
}

$markdown = @"
# Console Popup Watch - $($StartedAt.ToString("yyyy-MM-dd HH:mm:ss"))

Overall: $overall
Console processes: $($allConsole.Count)
Suspects: $($suspects.Count)
New suspects since last run: $($newSuspects.Count)

## New Suspects
$newLines

## Active Suspects
$suspectLines

Command lines are sanitized before writing. This watcher does not kill or modify processes.
"@

$markdown | Set-Content -LiteralPath $latestMd -Encoding UTF8

[pscustomobject]$report
