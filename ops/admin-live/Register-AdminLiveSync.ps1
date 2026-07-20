param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5177,
  [int]$HermesPort = 5190,
  # Startup handles reboot recovery immediately. This recurring pass keeps the
  # live checkout and both local services healthy without constant polling.
  [int]$EveryMinutes = 60
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path $RepoRoot).Path
$ps = (Get-Command powershell.exe -ErrorAction Stop).Source
$startScript = Join-Path $PSScriptRoot "Start-AdminLive.ps1"
$hermesScript = Join-Path $PSScriptRoot "Start-Hermes.ps1"
$syncScript = Join-Path $PSScriptRoot "Sync-AdminMain.ps1"

$startArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -RepoRoot `"$repo`" -Port $Port -StopExisting"
$hermesArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hermesScript`" -RepoRoot `"$repo`" -Port $HermesPort -StopExisting"
$syncArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$syncScript`" -RepoRoot `"$repo`" -Port $Port -HermesPort $HermesPort"

# Task Scheduler's own "Hidden" task-setting only hides the task from the
# Task Scheduler UI — it does NOT suppress the console window the launched
# powershell.exe pops up. Route both actions through a wscript/VBS launcher
# (WshShell.Run with window style 0) instead: that starts the process already
# hidden, so nothing ever flashes on screen, even for the every-N-minutes sync.
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function New-HiddenLauncher {
  param([string]$VbsPath, [string]$Command)
  $vbsCommand = $Command.Replace('"', '""')
  $vbsBody = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "$vbsCommand", 0, True
"@
  Set-Content -LiteralPath $VbsPath -Value $vbsBody -Encoding ascii
}

$startVbs = Join-Path $stateDir "run-admin-live-start.vbs"
$hermesVbs = Join-Path $stateDir "run-hermes-start.vbs"
$syncVbs = Join-Path $PSScriptRoot "Run-AdminMainSyncHidden.vbs"
New-HiddenLauncher -VbsPath $startVbs -Command "$ps $startArgs"
New-HiddenLauncher -VbsPath $hermesVbs -Command "$ps $hermesArgs"

$wscript = (Get-Command wscript.exe -ErrorAction Stop).Source
$startAction = New-ScheduledTaskAction -Execute $wscript -Argument "`"$startVbs`""
$hermesAction = New-ScheduledTaskAction -Execute $wscript -Argument "`"$hermesVbs`""
$syncAction = New-ScheduledTaskAction -Execute $wscript -Argument "`"$syncVbs`""

$startTrigger = New-ScheduledTaskTrigger -AtLogOn
$hermesTrigger = New-ScheduledTaskTrigger -AtLogOn
$syncLogonTrigger = New-ScheduledTaskTrigger -AtLogOn
$syncLogonTrigger.Delay = "PT45S"
$syncTimerTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -Hidden -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

try {
  Register-ScheduledTask -TaskName "PhantomForce Admin Live Server" -Action $startAction -Trigger $startTrigger -Settings $settings -Principal $principal -Description "Starts the local static admin server for admin.phantomforce.online." -Force -ErrorAction Stop | Out-Null
  Register-ScheduledTask -TaskName "PhantomForce Hermes API" -Action $hermesAction -Trigger $hermesTrigger -Settings $settings -Principal $principal -Description "Starts the Hermes API backend (5190) so new server routes go live." -Force -ErrorAction Stop | Out-Null
  Register-ScheduledTask -TaskName "PhantomForce Admin Main Sync" -Action $syncAction -Trigger @($syncLogonTrigger, $syncTimerTrigger) -Settings $settings -Principal $principal -Description "At login and hourly, fast-forwards PhantomForce main and repairs the UI, API, database dependency, and health checks." -Force -ErrorAction Stop | Out-Null
} catch {
  # Standard users may be allowed to update an existing task but denied new
  # task creation. One combined login/hourly sync is sufficient because its
  # health pass starts and repairs both the UI and API.
  try {
    Get-ScheduledTask -TaskName "PhantomForce Admin Main Sync" -ErrorAction Stop | Out-Null
    Set-ScheduledTask -TaskName "PhantomForce Admin Main Sync" -Action $syncAction -Trigger @($syncLogonTrigger, $syncTimerTrigger) -Settings $settings -ErrorAction Stop | Out-Null
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "PhantomForceAdminLiveSync" -ErrorAction SilentlyContinue
    Write-Output "Updated the combined PhantomForce login + hourly self-repair task."
    exit 0
  } catch {
    $watchScript = Join-Path $PSScriptRoot "Watch-AdminMain.ps1"
    $vbs = Join-Path $stateDir "start-admin-live-watch.vbs"
    $watchArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchScript`" -RepoRoot `"$repo`" -Port $Port -HermesPort $HermesPort -EveryMinutes $EveryMinutes"
    $vbsCommand = ("$ps $watchArgs").Replace('"', '""')
    $vbsBody = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "$vbsCommand", 0, False
"@
    Set-Content -LiteralPath $vbs -Value $vbsBody -Encoding ascii
    New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "PhantomForceAdminLiveSync" -Value "wscript.exe `"$vbs`"" -PropertyType String -Force | Out-Null
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
    Write-Output "Scheduled Tasks were denied, so registered the hidden login/hourly watcher instead."
    exit 0
  }
}

Write-Output "Registered PhantomForce UI + API at logon and hidden health/sync repair every $EveryMinutes minutes."
