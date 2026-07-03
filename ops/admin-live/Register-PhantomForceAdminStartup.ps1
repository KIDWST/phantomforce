param(
  [string]$TaskName = "PhantomForce Admin Phantom",
  [switch]$Replace,
  [switch]$NoShortcutFallback
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $PSScriptRoot "Start-PhantomForceAdmin.ps1"
if (-not (Test-Path $startScript)) {
  throw "Missing startup script: $startScript"
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and -not $Replace) {
  [pscustomobject]@{
    ok = $true
    taskName = $TaskName
    status = "already_registered"
    nextAction = "Run with -Replace to update the existing task."
  }
  exit 0
}

if ($existing -and $Replace) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Starts the local PhantomForce admin phantom frontend and backend for Pangolin access." | Out-Null

  [pscustomobject]@{
    ok = $true
    method = "scheduled_task"
    taskName = $TaskName
    trigger = "At logon"
    action = "powershell.exe -File `"$startScript`""
  }
} catch {
  if ($NoShortcutFallback) { throw }

  $startupFolder = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupFolder "$TaskName.lnk"
  if ((Test-Path $shortcutPath) -and $Replace) {
    Remove-Item -LiteralPath $shortcutPath -Force
  }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
  $shortcut.WorkingDirectory = Split-Path $startScript -Parent
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Starts the local PhantomForce admin phantom frontend and backend for Pangolin access."
  $shortcut.Save()

  [pscustomobject]@{
    ok = $true
    method = "startup_shortcut"
    taskName = $TaskName
    shortcutPath = $shortcutPath
    reason = "Scheduled Task registration was denied, so current-user Startup fallback was installed."
  }
}
