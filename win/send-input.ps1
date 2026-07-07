# send-input.ps1
# Forwards one input event to a window WITHOUT bringing it to the foreground,
# using PostMessage. Works for classic Win32 apps (edit controls, File Explorer,
# etc.). Chromium/Electron/UWP apps ignore injected messages by design.
#
# Kinds:
#   click : press+release left mouse at normalized (NX,NY) over the window
#   text  : post WM_CHAR for each character in -Text to the focused control
#   key   : post a special key (-Key: enter|backspace|tab|delete|left|right|up|down|home|end|escape)

param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Kind,
    [double]$NX = 0,
    [double]$NY = 0,
    [string]$Text = "",
    [string]$Key = ""
)

$ErrorActionPreference = "Stop"

# Match the capture's DPI awareness so click coordinates line up with the window.
$dpiSig = @'
using System;
using System.Runtime.InteropServices;
public static class TerminaDpiIn {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
Add-Type -TypeDefinition $dpiSig
try { [void][TerminaDpiIn]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void][TerminaDpiIn]::SetProcessDPIAware() } catch {} }

$proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $proc -or $proc.MainWindowHandle -eq 0) {
    @{ ok = $false; error = "gone" } | ConvertTo-Json -Compress
    exit 0
}

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class TInput {
    [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] public static extern IntPtr RealChildWindowFromPoint(IntPtr hWnd, POINT p);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] public static extern IntPtr GetFocus();
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@
Add-Type -TypeDefinition $sig

$main = $proc.MainWindowHandle

$WM_MOUSEMOVE = 0x0200; $WM_LBUTTONDOWN = 0x0201; $WM_LBUTTONUP = 0x0202; $MK_LBUTTON = 0x0001
$WM_CHAR = 0x0102; $WM_KEYDOWN = 0x0100; $WM_KEYUP = 0x0101

function LParamXY([int]$x, [int]$y) {
    return [IntPtr](($y -shl 16) -bor ($x -band 0xFFFF))
}

# Focused control of the target thread (so typing lands in the right field).
function Get-FocusedChild {
    $tid = [TInput]::GetWindowThreadProcessId($main, [IntPtr]::Zero)
    $cur = [TInput]::GetCurrentThreadId()
    [void][TInput]::AttachThreadInput($cur, $tid, $true)
    $f = [TInput]::GetFocus()
    [void][TInput]::AttachThreadInput($cur, $tid, $false)
    if ($f -eq [IntPtr]::Zero) { return $main }
    return $f
}

if ($Kind -eq "click") {
    $rect = New-Object TInput+RECT
    [void][TInput]::GetWindowRect($main, [ref]$rect)
    $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
    $sx = [int]($rect.Left + $NX * $w); $sy = [int]($rect.Top + $NY * $h)

    # Client-of-main point to locate the child, then that child's client coords.
    $origin = New-Object TInput+POINT; $origin.X = 0; $origin.Y = 0
    [void][TInput]::ClientToScreen($main, [ref]$origin)
    $mp = New-Object TInput+POINT; $mp.X = $sx - $origin.X; $mp.Y = $sy - $origin.Y
    $child = [TInput]::RealChildWindowFromPoint($main, $mp)
    if ($child -eq [IntPtr]::Zero) { $child = $main }

    $cp = New-Object TInput+POINT; $cp.X = $sx; $cp.Y = $sy
    [void][TInput]::ScreenToClient($child, [ref]$cp)
    $lp = LParamXY $cp.X $cp.Y
    [void][TInput]::PostMessage($child, $WM_MOUSEMOVE, [IntPtr]::Zero, $lp)
    [void][TInput]::PostMessage($child, $WM_LBUTTONDOWN, [IntPtr]$MK_LBUTTON, $lp)
    Start-Sleep -Milliseconds 15
    [void][TInput]::PostMessage($child, $WM_LBUTTONUP, [IntPtr]::Zero, $lp)
    @{ ok = $true; kind = "click" } | ConvertTo-Json -Compress
    exit 0
}

if ($Kind -eq "text") {
    $focus = Get-FocusedChild
    foreach ($ch in $Text.ToCharArray()) {
        [void][TInput]::PostMessage($focus, $WM_CHAR, [IntPtr][int][char]$ch, [IntPtr]0)
    }
    @{ ok = $true; kind = "text"; count = $Text.Length } | ConvertTo-Json -Compress
    exit 0
}

if ($Kind -eq "key") {
    $map = @{
        enter = 0x0D; backspace = 0x08; tab = 0x09; delete = 0x2E;
        left = 0x25; up = 0x26; right = 0x27; down = 0x28;
        home = 0x24; end = 0x23; escape = 0x1B
    }
    $vk = $map[$Key.ToLower()]
    if (-not $vk) { @{ ok = $false; error = "bad_key" } | ConvertTo-Json -Compress; exit 0 }
    $focus = Get-FocusedChild
    [void][TInput]::PostMessage($focus, $WM_KEYDOWN, [IntPtr]$vk, [IntPtr]0)
    # Enter/Backspace/Tab also need a WM_CHAR to register in most edit controls.
    if ($vk -eq 0x0D) { [void][TInput]::PostMessage($focus, $WM_CHAR, [IntPtr]0x0D, [IntPtr]0) }
    elseif ($vk -eq 0x08) { [void][TInput]::PostMessage($focus, $WM_CHAR, [IntPtr]0x08, [IntPtr]0) }
    elseif ($vk -eq 0x09) { [void][TInput]::PostMessage($focus, $WM_CHAR, [IntPtr]0x09, [IntPtr]0) }
    [void][TInput]::PostMessage($focus, $WM_KEYUP, [IntPtr]$vk, [IntPtr]0)
    @{ ok = $true; kind = "key"; key = $Key } | ConvertTo-Json -Compress
    exit 0
}

@{ ok = $false; error = "bad_kind" } | ConvertTo-Json -Compress
