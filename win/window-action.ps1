# window-action.ps1
# Performs one predefined action on the main window of a process.
# Actions: focus | minimize | restore | maximize | close
# Close is graceful (CloseMainWindow — same as clicking the X).

param(
    [Parameter(Mandatory = $true)][string]$Action,
    [Parameter(Mandatory = $true)][int]$ProcessId
)

$ErrorActionPreference = "Stop"
$allowed = @("focus", "minimize", "restore", "maximize", "close")
if ($allowed -notcontains $Action) {
    @{ ok = $false; error = "bad_action" } | ConvertTo-Json -Compress
    exit 1
}

$proc = Get-Process -Id $ProcessId -ErrorAction Stop

if ($Action -eq "close") {
    [void]$proc.CloseMainWindow()
    @{ ok = $true; action = $Action; pid = $ProcessId } | ConvertTo-Json -Compress
    exit 0
}

$signature = @'
using System;
using System.Runtime.InteropServices;
public static class TerminaWin {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
Add-Type -TypeDefinition $signature

$handle = $proc.MainWindowHandle
# ShowWindow flags: 3=maximize, 6=minimize, 9=restore
switch ($Action) {
    "focus" { [void][TerminaWin]::ShowWindow($handle, 9); [void][TerminaWin]::SetForegroundWindow($handle) }
    "minimize" { [void][TerminaWin]::ShowWindow($handle, 6) }
    "restore" { [void][TerminaWin]::ShowWindow($handle, 9) }
    "maximize" { [void][TerminaWin]::ShowWindow($handle, 3) }
}

@{ ok = $true; action = $Action; pid = $ProcessId } | ConvertTo-Json -Compress
