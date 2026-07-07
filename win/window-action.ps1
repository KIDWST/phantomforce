# window-action.ps1
# Performs one predefined action on the main window of a process.
# Actions: focus | minimize | restore | maximize | close | reveal
# - focus  : reliably bring the window to the foreground (AttachThreadInput to
#            bypass Windows' foreground lock), so it actually comes forward.
# - reveal : un-minimize without stealing focus, so a wall tile can show it live.
# - close  : graceful (CloseMainWindow, same as clicking the X).

param(
    [Parameter(Mandatory = $true)][string]$Action,
    [Parameter(Mandatory = $true)][int]$ProcessId
)

$ErrorActionPreference = "Stop"
$allowed = @("focus", "minimize", "restore", "maximize", "close", "reveal")
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
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
'@
Add-Type -TypeDefinition $signature

$handle = $proc.MainWindowHandle
# ShowWindow flags: 3=maximize, 4=show-no-activate, 6=minimize, 9=restore
switch ($Action) {
    "minimize" { [void][TerminaWin]::ShowWindow($handle, 6) }
    "restore" { [void][TerminaWin]::ShowWindow($handle, 9) }
    "maximize" { [void][TerminaWin]::ShowWindow($handle, 3) }
    "reveal" { [void][TerminaWin]::ShowWindow($handle, 4) }
    "focus" {
        [void][TerminaWin]::ShowWindow($handle, 9)
        $fg = [TerminaWin]::GetForegroundWindow()
        $targetThread = [TerminaWin]::GetWindowThreadProcessId($handle, [IntPtr]::Zero)
        $fgThread = [TerminaWin]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
        if ($fgThread -ne $targetThread) { [void][TerminaWin]::AttachThreadInput($fgThread, $targetThread, $true) }
        [void][TerminaWin]::BringWindowToTop($handle)
        [void][TerminaWin]::SetForegroundWindow($handle)
        if ($fgThread -ne $targetThread) { [void][TerminaWin]::AttachThreadInput($fgThread, $targetThread, $false) }
    }
}

@{ ok = $true; action = $Action; pid = $ProcessId } | ConvertTo-Json -Compress
