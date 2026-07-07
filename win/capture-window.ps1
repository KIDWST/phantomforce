# capture-window.ps1
# Captures a downscaled PNG thumbnail of a process's main window plus its live
# meta, so a wall tile can show that program like a CCTV camera. Read-only.

param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [int]$Width = 820
)

$ErrorActionPreference = "Stop"

# Become per-monitor DPI aware BEFORE reading any window geometry, so
# GetWindowRect returns real physical pixels that match what PrintWindow
# renders. Without this, scaled displays capture only a zoomed-in corner.
$dpiSig = @'
using System;
using System.Runtime.InteropServices;
public static class TerminaDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
Add-Type -TypeDefinition $dpiSig
try { [void][TerminaDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void][TerminaDpi]::SetProcessDPIAware() } catch {} }

$proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $proc -or $proc.MainWindowHandle -eq 0) {
    @{ ok = $false; error = "gone" } | ConvertTo-Json -Compress
    exit 0
}

$meta = @{
    ok    = $true
    pid   = $proc.Id
    name  = $proc.ProcessName
    title = $proc.MainWindowTitle
    memMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
}

$signature = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class TerminaCap {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $signature -ReferencedAssemblies System.Drawing

$handle = $proc.MainWindowHandle

if ([TerminaCap]::IsIconic($handle)) {
    ($meta + @{ minimized = $true }) | ConvertTo-Json -Compress
    exit 0
}

$rect = New-Object TerminaCap+RECT
[void][TerminaCap]::GetWindowRect($handle, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) {
    ($meta + @{ minimized = $true }) | ConvertTo-Json -Compress
    exit 0
}

try {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    # PW_RENDERFULLCONTENT (2) captures most apps even when partly occluded.
    [void][TerminaCap]::PrintWindow($handle, $hdc, 2)
    $g.ReleaseHdc($hdc)
    $g.Dispose()

    if ($Width -lt 64) { $Width = 64 }
    $tw = [Math]::Min($Width, $w)
    $th = [int]($h * ($tw / $w))
    if ($th -lt 1) { $th = 1 }

    $thumb = New-Object System.Drawing.Bitmap $tw, $th
    $tg = [System.Drawing.Graphics]::FromImage($thumb)
    $tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $tg.DrawImage($bmp, 0, 0, $tw, $th)
    $tg.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $thumb.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()
    $thumb.Dispose()

    ($meta + @{ w = $tw; h = $th; png = $b64 }) | ConvertTo-Json -Compress
} catch {
    ($meta + @{ error = "capture_failed" }) | ConvertTo-Json -Compress
}
