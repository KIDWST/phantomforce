$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LauncherScript = Join-Path $PSScriptRoot "launch-phantomforce-app.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PhantomForce"
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null

$PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$BrowserIcon = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $BrowserIcon) { $BrowserIcon = $PowerShellExe }

$apps = @(
  @{ Name = "PhantomForce Admin"; Mode = "admin"; Description = "Launch the private PhantomForce admin command center." },
  @{ Name = "PhantomForce Employee"; Mode = "employee"; Description = "Launch the simplified PhantomForce employee workspace." },
  @{ Name = "PhantomForce Demo"; Mode = "demo"; Description = "Launch the local-only PhantomForce demo showroom." }
)

$shell = New-Object -ComObject WScript.Shell
$created = @()

foreach ($app in $apps) {
  foreach ($folder in @($Desktop, $StartMenu)) {
    $shortcutPath = Join-Path $folder "$($app.Name).lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $PowerShellExe
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherScript`" -Mode $($app.Mode)"
    $shortcut.WorkingDirectory = $RepoRoot
    $shortcut.Description = $app.Description
    $shortcut.IconLocation = $BrowserIcon
    $shortcut.Save()
    $created += $shortcutPath
  }
}

$created
