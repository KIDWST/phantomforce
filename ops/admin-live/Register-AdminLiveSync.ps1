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
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName "PhantomForce Admin Live Server" -Action $startAction -Trigger $startTrigger -Settings $settings -Principal $principal -Description "Starts the local static admin server for admin.phantomforce.online." -Force | Out-Null
Register-ScheduledTask -TaskName "PhantomForce Admin Main Sync" -Action $syncAction -Trigger $syncTrigger -Settings $settings -Principal $principal -Description "Fast-forwards PhantomForce main so the admin site follows GitHub." -Force | Out-Null

Write-Output "Registered PhantomForce admin live server at logon and main sync every $EveryMinutes minutes."
