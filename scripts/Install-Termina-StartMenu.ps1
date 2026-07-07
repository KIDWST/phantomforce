# Install-Termina-StartMenu.ps1
# Creates (or refreshes) a Start Menu shortcut that launches Termina. User scope
# only: one .lnk under the current user's Start Menu Programs folder. Not an
# autorun/startup entry, no elevation. Use -Uninstall to remove it.

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$shortcutPath = Join-Path $startMenu "Termina.lnk"

if ($Uninstall) {
    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
        Write-Host "Removed Start Menu shortcut: $shortcutPath"
    } else {
        Write-Host "No Termina shortcut found."
    }
    return
}

$iconPath = Join-Path $appRoot "assets\termina.ico"
if (-not (Test-Path $iconPath)) {
    Write-Host "Generating app icon ..."
    & (Join-Path $PSScriptRoot "New-TerminaIcon.ps1")
}

$launcher = Join-Path $appRoot "scripts\Start-Termina.ps1"
if (-not (Test-Path $launcher)) { throw "Launcher not found: $launcher" }

$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwshCmd) {
    $pwsh = $pwshCmd.Source
} else {
    $pwsh = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pwsh
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$launcher`""
$shortcut.WorkingDirectory = $appRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Termina - local terminal wall (CCTV-style command center)"
if (Test-Path $iconPath) { $shortcut.IconLocation = "$iconPath,0" }
$shortcut.Save()

Write-Host "Installed Start Menu shortcut:" -ForegroundColor Green
Write-Host "  $shortcutPath"
Write-Host "  -> $pwsh"
Write-Host "  -> $launcher"
Write-Host ""
Write-Host "Search the Start Menu for 'Termina' to launch it."
