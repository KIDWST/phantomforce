param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("phantom-strike", "phantom-ages", "phantom-legends", "cubetown")]
    [string]$GameId,
    [int]$DelaySeconds = 8,
    [int]$Width = 1600,
    [int]$Height = 900
)

$ErrorActionPreference = "Stop"

$executables = @{
    "phantom-strike" = "PhantomStrike.exe"
    "phantom-ages" = "PhantomAges.exe"
    "phantom-legends" = "PhantomLegends.exe"
    "cubetown" = "Cubetown.exe"
}

$buildRoot = Join-Path $PSScriptRoot "..\Builds\Windows\$GameId"
$executable = Join-Path $buildRoot $executables[$GameId]
if (-not (Test-Path $executable)) {
    throw "Packaged player not found: $executable"
}

$outputRoot = Join-Path $PSScriptRoot "..\Saved\Verification"
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$outputPath = Join-Path $outputRoot "$GameId-$(Get-Date -Format 'yyyyMMdd-HHmmss').png"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class PhantomWindowCapture
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr window, ref POINT point);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);
}
"@

$arguments = @(
    "-PhantomGame=$GameId",
    "-windowed",
    "-ResX=$Width",
    "-ResY=$Height",
    "-NoSplash",
    "-SaveToUserDir"
)

$process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $buildRoot -PassThru
try {
    $deadline = (Get-Date).AddSeconds([Math]::Max(20, $DelaySeconds + 10))
    do {
        Start-Sleep -Milliseconds 250
        $process.Refresh()
    } while ($process.MainWindowHandle -eq 0 -and -not $process.HasExited -and (Get-Date) -lt $deadline)

    if ($process.HasExited) {
        throw "$GameId exited before a frame could be captured. Exit code: $($process.ExitCode)"
    }
    if ($process.MainWindowHandle -eq 0) {
        throw "$GameId did not expose a captureable window."
    }

    Start-Sleep -Seconds $DelaySeconds
    [PhantomWindowCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 500

    $rect = New-Object PhantomWindowCapture+RECT
    if (-not [PhantomWindowCapture]::GetClientRect($process.MainWindowHandle, [ref]$rect)) {
        throw "Could not read the $GameId client area."
    }
    $origin = New-Object PhantomWindowCapture+POINT
    if (-not [PhantomWindowCapture]::ClientToScreen($process.MainWindowHandle, [ref]$origin)) {
        throw "Could not locate the $GameId client area."
    }

    $captureWidth = $rect.Right - $rect.Left
    $captureHeight = $rect.Bottom - $rect.Top
    if ($captureWidth -lt 1 -or $captureHeight -lt 1) {
        throw "$GameId returned an empty client area."
    }

    $bitmap = New-Object System.Drawing.Bitmap $captureWidth, $captureHeight
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bitmap.Size)
        }
        finally {
            $graphics.Dispose()
        }
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bitmap.Dispose()
    }

    Write-Output $outputPath
}
finally {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
}
