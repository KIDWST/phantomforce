[CmdletBinding()]
param(
    [string]$Executable,
    [string]$InstallerScript,
    [switch]$Installed
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$packageRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $packageRoot 'Cargo.toml'
$sourceIconPath = Join-Path $packageRoot 'assets\phantomplay.ico'
$versionMatch = Select-String -LiteralPath $manifestPath -Pattern '^version = "([^"]+)"' |
    Select-Object -First 1
if (-not $versionMatch) {
    throw 'Could not read the PhantomPlay package version.'
}
$expectedVersion = $versionMatch.Matches[0].Groups[1].Value

if (-not $Executable) {
    $Executable = if ($Installed) {
        Join-Path $env:LOCALAPPDATA 'Programs\PhantomPlay\PhantomPlay.exe'
    }
    else {
        Join-Path $packageRoot 'target\dx\PhantomPlay\bundle\windows\PhantomPlay.exe'
    }
}
if (-not $InstallerScript) {
    $InstallerScript = Join-Path $packageRoot 'target\dx\PhantomPlay\bundle\windows\nsis\PhantomPlay.nsi'
}

foreach ($requiredPath in @($Executable, $InstallerScript, $sourceIconPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required Windows identity artifact is missing: $requiredPath"
    }
}

$versionInfo = (Get-Item -LiteralPath $Executable).VersionInfo
$expectedFields = @{
    FileVersion = "$expectedVersion.0"
    ProductVersion = $expectedVersion
    ProductName = 'PhantomPlay'
    CompanyName = 'PhantomForce'
    OriginalFilename = 'PhantomPlay.exe'
}
foreach ($field in $expectedFields.GetEnumerator()) {
    if ($versionInfo.($field.Key) -ne $field.Value) {
        throw "Windows identity field $($field.Key) was '$($versionInfo.($field.Key))'; expected '$($field.Value)'."
    }
}

Add-Type -AssemblyName System.Drawing

function Get-IcoBitmap {
    param(
        [Parameter(Mandatory)][string]$Path,
        [int]$Width = 32,
        [int]$Height = 32
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 6 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1) {
        throw "Invalid ICO file: $Path"
    }

    $entryCount = [BitConverter]::ToUInt16($bytes, 4)
    for ($index = 0; $index -lt $entryCount; $index++) {
        $entryOffset = 6 + ($index * 16)
        if ($entryOffset + 16 -gt $bytes.Length) {
            break
        }

        $entryWidth = if ($bytes[$entryOffset] -eq 0) { 256 } else { [int]$bytes[$entryOffset] }
        $entryHeight = if ($bytes[$entryOffset + 1] -eq 0) { 256 } else { [int]$bytes[$entryOffset + 1] }
        if ($entryWidth -ne $Width -or $entryHeight -ne $Height) {
            continue
        }

        $imageLength = [BitConverter]::ToUInt32($bytes, $entryOffset + 8)
        $imageOffset = [BitConverter]::ToUInt32($bytes, $entryOffset + 12)
        if ($imageOffset + $imageLength -gt $bytes.Length) {
            throw "Invalid ICO image payload: $Path"
        }

        $imageBytes = [byte[]]::new($imageLength)
        [Array]::Copy($bytes, [long]$imageOffset, $imageBytes, 0, [long]$imageLength)
        $stream = [System.IO.MemoryStream]::new($imageBytes, $false)
        try {
            $image = [System.Drawing.Image]::FromStream($stream)
            try {
                # Image.FromStream keeps a lazy dependency on the stream. Clone
                # the decoded frame before closing the ICO payload.
                return [System.Drawing.Bitmap]$image.Clone()
            }
            finally {
                $image.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }
    }

    throw "ICO file has no ${Width}x${Height} image: $Path"
}

function Test-BitmapsEqual {
    param(
        [Parameter(Mandatory)][System.Drawing.Bitmap]$Left,
        [Parameter(Mandatory)][System.Drawing.Bitmap]$Right
    )

    if ($Left.Width -ne $Right.Width -or $Left.Height -ne $Right.Height) {
        return $false
    }
    for ($y = 0; $y -lt $Left.Height; $y++) {
        for ($x = 0; $x -lt $Left.Width; $x++) {
            if ($Left.GetPixel($x, $y).ToArgb() -ne $Right.GetPixel($x, $y).ToArgb()) {
                return $false
            }
        }
    }
    return $true
}

$embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
$embeddedBitmap = $null
$sourceBitmap = $null
try {
    if (-not $embeddedIcon) {
        throw 'The PhantomPlay executable has no embedded Windows icon.'
    }
    $embeddedBitmap = $embeddedIcon.ToBitmap()
    $sourceBitmap = Get-IcoBitmap -Path $sourceIconPath
    if (-not (Test-BitmapsEqual -Left $embeddedBitmap -Right $sourceBitmap)) {
        throw 'The PhantomPlay executable icon does not match assets\phantomplay.ico.'
    }
}
finally {
    if ($embeddedBitmap) { $embeddedBitmap.Dispose() }
    if ($sourceBitmap) { $sourceBitmap.Dispose() }
    if ($embeddedIcon) { $embeddedIcon.Dispose() }
}

$nsis = Get-Content -LiteralPath $InstallerScript -Raw
$requiredInstallerFragments = @(
    '!define MUI_ICON',
    '!define MUI_UNICON',
    'CreateShortcut "$SMPROGRAMS\PhantomPlay\PhantomPlay.lnk" "$INSTDIR\PhantomPlay.exe" "" "$INSTDIR\PhantomPlay.exe" 0',
    'CreateShortcut "$DESKTOP\PhantomPlay.lnk" "$INSTDIR\PhantomPlay.exe" "" "$INSTDIR\PhantomPlay.exe" 0',
    '"DisplayIcon" "$INSTDIR\PhantomPlay.exe,0"'
)
foreach ($fragment in $requiredInstallerFragments) {
    if (-not $nsis.Contains($fragment)) {
        throw "The generated installer is missing required identity wiring: $fragment"
    }
}

if ($Installed) {
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\online.phantomforce.phantomplay'
    $registration = Get-ItemProperty -LiteralPath $uninstallKey
    if ($registration.DisplayVersion -ne $expectedVersion) {
        throw "Installed PhantomPlay is $($registration.DisplayVersion); expected $expectedVersion."
    }
    if ($registration.DisplayIcon -ne "$Executable,0") {
        throw "Installed PhantomPlay has the wrong DisplayIcon: $($registration.DisplayIcon)"
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcutPaths = @(
        (Join-Path $env:USERPROFILE 'Desktop\PhantomPlay.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\PhantomPlay\PhantomPlay.lnk')
    )
    foreach ($shortcutPath in $shortcutPaths) {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ($shortcut.IconLocation -ne "$Executable,0") {
            throw "Shortcut has the wrong icon target: $shortcutPath"
        }
    }
}

[pscustomobject]@{
    Status = 'PASS'
    Version = $expectedVersion
    Executable = $Executable
    Installed = [bool]$Installed
    DisplayIcon = "$Executable,0"
}
