# Start-Termina.ps1
# Launches Termina as a local desktop app: ensures the Node engine is running on
# 127.0.0.1, then opens the wall in an app-mode Edge/Chrome window. If an engine
# is already running it is reused (no port conflict). Closing the app window
# stops an engine this launcher started.

param(
    [int]$Port = 7420
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$env:TERMINA_PORT = "$Port"
# The page injects its own token server-side, so the plain base URL is enough.
$baseUrl = "http://127.0.0.1:$Port/"

function Test-Port([int]$p) {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "=== Termina - Terminal Wall ===" -ForegroundColor Green

$engine = $null
$startedEngine = $false

if (Test-Port $Port) {
    Write-Host "Engine already running on :$Port - reusing it."
} else {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Warning "Node.js was not found on PATH. Install Node 20+ and try again."
        Start-Sleep -Seconds 6
        return
    }
    Write-Host "Starting Termina engine on :$Port ..."
    $engine = Start-Process -FilePath $nodeCmd.Source -ArgumentList "server.js" `
        -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
    $startedEngine = $true

    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline -and -not (Test-Port $Port)) {
        if ($engine.HasExited) {
            Write-Warning "Engine exited during startup (port $Port may be in use)."
            Start-Sleep -Seconds 5
            return
        }
        Start-Sleep -Milliseconds 300
    }
    if (-not (Test-Port $Port)) {
        Write-Warning "Engine did not start listening on :$Port in time."
        if (-not $engine.HasExited) { Stop-Process -Id $engine.Id -Force -ErrorAction SilentlyContinue }
        return
    }
}

Write-Host "Engine ready at $baseUrl" -ForegroundColor Green

$profileDir = Join-Path $env:LOCALAPPDATA "Termina\browser"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$browser = if (Test-Path $edge) { $edge } elseif (Test-Path $chrome) { $chrome } else { $null }

$app = $null
if ($browser) {
    Write-Host "Opening Termina app window ..." -ForegroundColor Green
    # No embedded quotes: Start-Process quotes args as needed. The profile dir
    # has no spaces, so this passes clean to the browser.
    $app = Start-Process -FilePath $browser -PassThru -ArgumentList @(
        "--app=$baseUrl",
        "--user-data-dir=$profileDir",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1500,950"
    )
} else {
    Start-Process $baseUrl
}

if ($app) {
    Write-Host "Termina is running. Close the app window to stop it." -ForegroundColor Green
    try {
        Wait-Process -Id $app.Id
    } finally {
        # Only stop an engine this launcher actually started.
        if ($startedEngine -and $engine -and -not $engine.HasExited) {
            Stop-Process -Id $engine.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Termina stopped."
    }
}
