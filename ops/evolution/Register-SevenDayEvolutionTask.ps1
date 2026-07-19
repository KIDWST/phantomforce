[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskName = "PhantomForce Seven-Day Evolution"
$repoRoot = "C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712"
$vbsPath = Join-Path $repoRoot "ops\evolution\Run-SevenDayEvolutionHidden.vbs"
if (-not (Test-Path -LiteralPath $vbsPath)) {
  throw "Hidden evolution runner is missing: $vbsPath"
}

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$triggers = @()
$firstDay = Get-Date "2026-07-19"
foreach ($dayOffset in 0..6) {
  $day = $firstDay.AddDays($dayOffset)
  foreach ($hour in @(8, 14, 20)) {
    $triggers += New-ScheduledTaskTrigger -Once -At $day.AddHours($hour)
  }
}

$action = New-ScheduledTaskAction `
  -Execute "$env:WINDIR\System32\wscript.exe" `
  -Argument "`"$vbsPath`""
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Description "Finite 21-cycle PhantomForce evolution task; automatically disables after the final 2026-07-25 evening cycle." `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  TriggerCount = @($task.Triggers).Count
  NextRunTime = $info.NextRunTime
  Execute = $task.Actions.Execute
  Arguments = $task.Actions.Arguments
}
