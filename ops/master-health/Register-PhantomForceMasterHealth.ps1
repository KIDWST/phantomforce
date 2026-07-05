param(
  [string]$DailyTime = "09:00",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$HealthScript = Join-Path $PSScriptRoot "Invoke-PhantomForceMasterHealth.ps1"
$PopupWatchScript = Join-Path $PSScriptRoot "Invoke-ConsolePopupAudit.ps1"

if (-not (Test-Path $HealthScript)) {
  throw "Health script missing: $HealthScript"
}
if (-not (Test-Path $PopupWatchScript)) {
  throw "Console popup watcher missing: $PopupWatchScript"
}

function New-TaskCommand {
  param(
    [ValidateSet("heartbeat", "daily")]
    [string]$Mode
  )
  return "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$HealthScript`" -Mode $Mode"
}

$dailyName = "\PhantomForce\Master Daily Health"
$heartbeatName = "\PhantomForce\Master 6-Hour Health"
$logonName = "\PhantomForce\Master Logon Baseline"
$popupName = "\PhantomForce\Console Popup Watcher"
$heartbeatStartDate = (Get-Date).AddHours(6)
$popupStartDate = (Get-Date).AddHours(6).AddMinutes(5)
$heartbeatStart = $heartbeatStartDate.ToString("HH:mm")
$heartbeatStartDay = $heartbeatStartDate.ToString("MM/dd/yyyy")
$popupStart = $popupStartDate.ToString("HH:mm")
$popupStartDay = $popupStartDate.ToString("MM/dd/yyyy")

$dailyCommand = New-TaskCommand -Mode daily
$heartbeatCommand = New-TaskCommand -Mode heartbeat
$popupCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PopupWatchScript`""

foreach ($legacyTask in "\PhantomForce\Master Hourly Heartbeat") {
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & schtasks.exe /Delete /F /TN $legacyTask 2>$null | Out-Null
    $ErrorActionPreference = $previousErrorActionPreference
  } catch {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

& schtasks.exe /Create /F /TN $dailyName /SC DAILY /ST $DailyTime /TR $dailyCommand /RL LIMITED | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register daily task."
}

& schtasks.exe /Create /F /TN $heartbeatName /SC HOURLY /MO 6 /SD $heartbeatStartDay /ST $heartbeatStart /TR $heartbeatCommand /RL LIMITED | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register 6-hour heartbeat task."
}

& schtasks.exe /Create /F /TN $popupName /SC HOURLY /MO 6 /SD $popupStartDay /ST $popupStart /TR $popupCommand /RL LIMITED | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register console popup watcher task."
}

$logonRegistered = $false
$logonError = ""
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$logonOutput = & schtasks.exe /Create /F /TN $logonName /SC ONLOGON /TR $heartbeatCommand /RL LIMITED 2>&1
$logonExit = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($logonExit -eq 0) {
  $logonRegistered = $true
} else {
  $logonError = "Logon task was not registered. Windows may require an elevated shell for ONLOGON tasks. $($logonOutput -join ' ')"
}

$registered = @()
foreach ($task in @($dailyName, $heartbeatName, $popupName) + $(if ($logonRegistered) { @($logonName) } else { @() })) {
  $raw = & schtasks.exe /Query /TN $task /FO LIST 2>$null
  $registered += [pscustomobject]@{
    task = $task
    query = ($raw -join "`n")
  }
}

$firstRun = $null
if ($RunNow) {
  $firstRun = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $HealthScript -Mode heartbeat
}

[pscustomobject]@{
  ok = $true
  repo = $RepoRoot
  daily_task = $dailyName
  daily_time = $DailyTime
  heartbeat_task = $heartbeatName
  heartbeat_interval_hours = 6
  heartbeat_start_day = $heartbeatStartDay
  heartbeat_start = $heartbeatStart
  popup_task = $popupName
  popup_interval_hours = 6
  popup_start_day = $popupStartDay
  popup_start = $popupStart
  logon_task = $logonName
  logon_registered = $logonRegistered
  logon_note = $logonError
  script = $HealthScript
  first_run = $firstRun
}
