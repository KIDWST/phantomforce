param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5177,
  [int]$EveryMinutes = 15
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path $RepoRoot).Path
$ps = (Get-Command powershell.exe -ErrorAction Stop).Source
$startScript = Join-Path $PSScriptRoot "Start-AdminLive.ps1"
$syncScript = Join-Path $PSScriptRoot "Sync-AdminMain.ps1"

$startArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -RepoRoot `"$repo`" -Port $Port -StopExisting"
$syncArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$syncScript`" -RepoRoot `"$repo`" -Port $Port"

$startAction = New-ScheduledTaskAction -Execute $ps -Argument $startArgs
$syncAction = New-ScheduledTaskAction -Execute $ps -Argument $syncArgs

$startTrigger = New-ScheduledTaskTrigger -AtLogOn
$syncTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -Hidden -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

try {
  Register-ScheduledTask -TaskName "PhantomForce Admin Live Server" -Action $startAction -Trigger $startTrigger -Settings $settings -Principal $principal -Description "Starts the local static admin server for admin.phantomforce.online." -Force | Out-Null
  Register-ScheduledTask -TaskName "PhantomForce Admin Main Sync" -Action $syncAction -Trigger $syncTrigger -Settings $settings -Principal $principal -Description "Fast-forwards PhantomForce main so the admin site follows GitHub." -Force | Out-Null
} catch {
  $stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live"
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $watchScript = Join-Path $PSScriptRoot "Watch-AdminMain.ps1"
  $vbs = Join-Path $stateDir "start-admin-live-watch.vbs"
  $watchArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$watchScript`" -RepoRoot `"$repo`" -Port $Port -EveryMinutes $EveryMinutes"
  $vbsCommand = ("$ps $watchArgs").Replace('"', '""')
  $vbsBody = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "$vbsCommand", 0, False
"@
  Set-Content -LiteralPath $vbs -Value $vbsBody -Encoding ascii
  New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "PhantomForceAdminLiveSync" -Value "wscript.exe `"$vbs`"" -PropertyType String -Force | Out-Null
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
  Write-Output "Scheduled Tasks were denied, so registered HKCU startup watcher instead."
  exit 0
}

Write-Output "Registered PhantomForce admin live server at logon and main sync every $EveryMinutes minutes."
