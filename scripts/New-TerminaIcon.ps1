# New-TerminaIcon.ps1
# Renders the Termina app icon (green ">_" on a dark rounded tile) to
# assets/termina.ico and public/favicon.ico. Pure local, no network.

Add-Type -AssemblyName System.Drawing

$appRoot = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $appRoot "assets"
$publicDir = Join-Path $appRoot "public"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.Rectangle(10, 10, ($size - 20), ($size - 20))
$radius = 44
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
$path.AddArc(($rect.Right - $radius), $rect.Y, $radius, $radius, 270, 90)
$path.AddArc(($rect.Right - $radius), ($rect.Bottom - $radius), $radius, $radius, 0, 90)
$path.AddArc($rect.X, ($rect.Bottom - $radius), $radius, $radius, 90, 90)
$path.CloseFigure()

$bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 8, 11, 15))
$g.FillPath($bg, $path)
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 40, 70, 52)), 5
$g.DrawPath($borderPen, $path)

$green = [System.Drawing.Color]::FromArgb(255, 89, 208, 133)
$greenBrush = New-Object System.Drawing.SolidBrush $green
$font = New-Object System.Drawing.Font("Consolas", 120, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString(">", $font, $greenBrush, 44, 58)
$g.FillRectangle($greenBrush, 132, 150, 72, 20)
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$ms.Dispose()
$bmp.Dispose()

function Write-Ico([string]$Path, [byte[]]$PngBytes) {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
    $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$PngBytes.Length); $bw.Write([UInt32]22)
    $bw.Write($PngBytes)
    $bw.Flush(); $bw.Dispose(); $fs.Dispose()
}

$icoPath = Join-Path $assetsDir "termina.ico"
Write-Ico $icoPath $png
if (Test-Path $publicDir) { Write-Ico (Join-Path $publicDir "favicon.ico") $png }
Write-Host "Wrote icon: $icoPath ($($png.Length) bytes PNG)"
