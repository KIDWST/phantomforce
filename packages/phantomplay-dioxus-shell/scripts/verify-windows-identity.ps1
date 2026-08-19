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

function Test-IconsEqual {
    param(
        [Parameter(Mandatory)][System.Drawing.Icon]$Left,
        [Parameter(Mandatory)][System.Drawing.Icon]$Right
    )

    $leftBitmap = $Left.ToBitmap()
    $rightBitmap = $Right.ToBitmap()
    try {
        if ($leftBitmap.Size -ne $rightBitmap.Size) {
            return $false
        }
        for ($y = 0; $y -lt $leftBitmap.Height; $y++) {
            for ($x = 0; $x -lt $leftBitmap.Width; $x++) {
                if ($leftBitmap.GetPixel($x, $y).ToArgb() -ne $rightBitmap.GetPixel($x, $y).ToArgb()) {
                    return $false
                }
            }
        }
        return $true
    }
    finally {
        $leftBitmap.Dispose()
        $rightBitmap.Dispose()
    }
}

$embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
$sourceIcon = [System.Drawing.Icon]::new($sourceIconPath, 32, 32)
try {
    if (-not $embeddedIcon) {
        throw 'The PhantomPlay executable has no embedded Windows icon.'
    }
    if (-not (Test-IconsEqual -Left $embeddedIcon -Right $sourceIcon)) {
        throw 'The PhantomPlay executable icon does not match assets\phantomplay.ico.'
    }
}
finally {
    if ($embeddedIcon) { $embeddedIcon.Dispose() }
    $sourceIcon.Dispose()
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
