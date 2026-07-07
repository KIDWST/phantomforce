# Set-TerminaIcon.ps1
# Builds a multi-resolution .ico (and favicon) from a source PNG so Termina uses
# a real app icon for the Start Menu shortcut and the app window / taskbar.

param(
    [string]$Source
)

Add-Type -AssemblyName System.Drawing

$appRoot = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $appRoot "assets"
$publicDir = Join-Path $appRoot "public"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }

if (-not $Source) { $Source = Join-Path $assetsDir "termina-source.png" }
if (-not (Test-Path $Source)) { throw "Source image not found: $Source" }

$src = [System.Drawing.Image]::FromFile($Source)
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $s, $s))
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += , ($ms.ToArray())
    $bmp.Dispose()
    $ms.Dispose()
}
$src.Dispose()

function Write-Ico([string]$Path, [int[]]$Sizes, $Pngs) {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$Sizes.Count)
    $offset = 6 + (16 * $Sizes.Count)
    for ($i = 0; $i -lt $Sizes.Count; $i++) {
        $dim = $Sizes[$i] % 256   # 256 -> 0 per ICO spec
        $bw.Write([Byte]$dim); $bw.Write([Byte]$dim)
        $bw.Write([Byte]0); $bw.Write([Byte]0)
        $bw.Write([UInt16]1); $bw.Write([UInt16]32)
        $bw.Write([UInt32]$Pngs[$i].Length); $bw.Write([UInt32]$offset)
        $offset += $Pngs[$i].Length
    }
    foreach ($p in $Pngs) { $bw.Write($p) }
    $bw.Flush(); $bw.Dispose(); $fs.Dispose()
}

$icoPath = Join-Path $assetsDir "termina.ico"
Write-Ico $icoPath $sizes $pngs
if (Test-Path $publicDir) { Write-Ico (Join-Path $publicDir "favicon.ico") $sizes $pngs }
Write-Host "Wrote icon from $Source -> $icoPath (+favicon)"
