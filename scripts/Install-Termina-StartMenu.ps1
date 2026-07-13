# Install-Termina-StartMenu.ps1
# Creates (or refreshes) app shortcuts that launch Termina as a real desktop
# app: the shortcut points straight at the Electron shell (electron-main.cjs),
# which spawns server.js under system Node and shows it in a plain, chrome-
# free window with Termina's own icon. Electron's electron.exe is a native
# GUI-subsystem binary, so there is no console flash - no VBS/pwsh shim
# needed. Runs from source (no build step), so edits to server.js/profiles.js/
# public/ take effect on the next launch. By default installs both a Start
# Menu entry and a Desktop icon; user scope only, no elevation. Use
# -Uninstall to remove them, or -NoDesktop to skip the Desktop icon.

param(
    [switch]$Uninstall,
    [switch]$NoDesktop
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$startMenuShortcut = Join-Path $startMenu "Termina.lnk"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Termina.lnk"
$vbsPath = Join-Path $PSScriptRoot "Termina-Launch.vbs"

if ($Uninstall) {
    foreach ($path in @($startMenuShortcut, $desktopShortcut, $vbsPath)) {
        if (Test-Path $path) {
            Remove-Item $path -Force
            Write-Host "Removed: $path"
        }
    }
    return
}

$iconPath = Join-Path $appRoot "assets\termina.ico"
$iconSource = Join-Path $appRoot "assets\termina-source.png"
if (Test-Path $iconSource) {
    Write-Host "Building app icon from source image ..."
    & (Join-Path $PSScriptRoot "Set-TerminaIcon.ps1") -Source $iconSource
} elseif (-not (Test-Path $iconPath)) {
    Write-Host "Generating app icon ..."
    & (Join-Path $PSScriptRoot "New-TerminaIcon.ps1")
}

$electronExe = Join-Path $appRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    throw "Electron not found at $electronExe. Run 'npm install' in $appRoot first."
}

function New-TerminaShortcut([string]$path) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $electronExe
    $shortcut.Arguments = "."
    $shortcut.WorkingDirectory = $appRoot
    $shortcut.Description = "Termina - local terminal wall (CCTV-style command center)"
    if (Test-Path $iconPath) { $shortcut.IconLocation = "$iconPath,0" }
    $shortcut.Save()
}

New-TerminaShortcut $startMenuShortcut
Write-Host "Installed Start Menu shortcut: $startMenuShortcut" -ForegroundColor Green

if (-not $NoDesktop) {
    New-TerminaShortcut $desktopShortcut
    Write-Host "Installed Desktop shortcut:    $desktopShortcut" -ForegroundColor Green
}

Write-Host ""
Write-Host "  -> $electronExe ."
Write-Host ""
Write-Host "Double-click Termina from the Start Menu or Desktop to launch it - a real app window, no console, no browser chrome."
