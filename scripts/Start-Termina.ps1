# Start-Termina.ps1
# Launches Termina as a local desktop app: starts the Node engine (127.0.0.1),
# waits for its tokened URL, and opens it in an app-mode Edge/Chrome window.
# Closing the app window shuts the engine down.

param(
    [int]$Port = 7420
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$env:TERMINA_PORT = "$Port"

# Locate node.
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    [System.Windows.Forms.MessageBox]::Show("Node.js is required but was not found on PATH.") | Out-Null
    throw "node not found"
}

Write-Host "=== Termina - Terminal Wall ===" -ForegroundColor Green
Write-Host "App: $appRoot"

$outFile = Join-Path $env:TEMP "termina-engine.out.log"
$errFile = Join-Path $env:TEMP "termina-engine.err.log"
if (Test-Path $outFile) { Remove-Item $outFile -Force -ErrorAction SilentlyContinue }

$engine = Start-Process -FilePath $nodeCmd.Source -ArgumentList "server.js" `
    -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile

# Wait for the engine to print its tokened URL.
$url = $null
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
    if (Test-Path $outFile) {
        $line = Select-String -Path $outFile -Pattern "TERMINA_URL=(.+)$" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($line) { $url = $line.Matches[0].Groups[1].Value.Trim(); break }
    }
    if ($engine.HasExited) { break }
    Start-Sleep -Milliseconds 300
}

if (-not $url) {
    Write-Warning "Engine did not report a URL. Check $errFile"
    if (Test-Path $errFile) { Get-Content $errFile -Tail 15 }
    if (-not $engine.HasExited) { Stop-Process -Id $engine.Id -Force -ErrorAction SilentlyContinue }
    return
}

Write-Host "Engine ready: $url" -ForegroundColor Green

$profileDir = Join-Path $env:LOCALAPPDATA "Termina\browser"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$browser = if (Test-Path $edge) { $edge } elseif (Test-Path $chrome) { $chrome } else { $null }

$app = $null
if ($browser) {
    Write-Host "Opening Termina app window ..." -ForegroundColor Green
    $app = Start-Process -FilePath $browser `
        -ArgumentList "--app=$url", "--user-data-dir=`"$profileDir`"", "--no-first-run", "--window-size=1500,950" `
        -PassThru
} else {
    Start-Process $url
}

if ($app) {
    Write-Host "Termina is running. Close the app window to stop it." -ForegroundColor Green
    try {
        Wait-Process -Id $app.Id
    } finally {
        if (-not $engine.HasExited) { Stop-Process -Id $engine.Id -Force -ErrorAction SilentlyContinue }
        Write-Host "Termina stopped."
    }
} else {
    Write-Host "Termina engine is running at $url" -ForegroundColor Yellow
    Write-Host "Close this window (or Ctrl+C) to stop it."
    try { Wait-Process -Id $engine.Id } catch {}
}
