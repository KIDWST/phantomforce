param(
  [switch]$Build,
  [switch]$OpenBrowser,
  [int]$FrontendPort = 5177,
  [int]$BackendPort = 5190
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RepoEnv = Join-Path $RepoRoot ".env"
$LogDir = Join-Path $RepoRoot ".local\admin-live\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-ListenerProcessId {
  param([int]$Port)
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { return [int]$listener.OwningProcess }
  return $null
}

function Wait-ForHttp {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 750
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Start-NodeProcess {
  param(
    [string]$Name,
    [string]$Command,
    [string]$OutLog,
    [string]$ErrLog
  )

  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog | Out-Null
}

function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

$webDist = Join-Path $RepoRoot "apps\web\dist\index.html"
$serverDist = Join-Path $RepoRoot "server\dist\index.js"

if ($Build -or -not (Test-Path $webDist)) {
  Push-Location $RepoRoot
  try {
    & npm.cmd run build --workspace "@phantomforce/web"
    if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

if ($Build -or -not (Test-Path $serverDist)) {
  Push-Location $RepoRoot
  try {
    & npm.cmd run build --workspace "@phantomforce/server"
    if ($LASTEXITCODE -ne 0) { throw "Server build failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

$backendPid = Get-ListenerProcessId -Port $BackendPort
if (-not $backendPid) {
  $backendCommand = "`$env:NODE_ENV='production'; `$env:DOTENV_CONFIG_PATH='$RepoEnv'; Set-Location -LiteralPath '$RepoRoot'; npm run start --workspace @phantomforce/server"
  Start-NodeProcess `
    -Name "PhantomForce backend" `
    -Command $backendCommand `
    -OutLog (Join-Path $LogDir "backend.out.log") `
    -ErrLog (Join-Path $LogDir "backend.err.log")
  if (-not (Wait-ForHttp -Url "http://127.0.0.1:$BackendPort/sessions" -TimeoutSeconds 35)) {
    throw "Backend did not become healthy on 127.0.0.1:$BackendPort."
  }
  $backendPid = Get-ListenerProcessId -Port $BackendPort
}

$frontendPid = Get-ListenerProcessId -Port $FrontendPort
if (-not $frontendPid) {
  $frontendCommand = "Set-Location -LiteralPath '$RepoRoot'; npm run preview --workspace @phantomforce/web -- --host 127.0.0.1 --port $FrontendPort"
  Start-NodeProcess `
    -Name "PhantomForce frontend" `
    -Command $frontendCommand `
    -OutLog (Join-Path $LogDir "frontend.out.log") `
    -ErrLog (Join-Path $LogDir "frontend.err.log")
  if (-not (Wait-ForHttp -Url "http://127.0.0.1:$FrontendPort/" -TimeoutSeconds 35)) {
    throw "Frontend did not become healthy on 127.0.0.1:$FrontendPort."
  }
  $frontendPid = Get-ListenerProcessId -Port $FrontendPort
}

$adminUrl = "http://127.0.0.1:$FrontendPort/app/?session=admin&launcher=admin-live"

if (-not (Wait-ForHttp -Url $adminUrl -TimeoutSeconds 20)) {
  throw "Admin app did not become reachable at $adminUrl."
}

if ($OpenBrowser) {
  $browser = Find-Browser
  if ($browser) {
    $profilePath = Join-Path (Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live") "browser-admin"
    New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
    Start-Process -FilePath $browser -ArgumentList @(
      "--app=$adminUrl",
      "--user-data-dir=$profilePath",
      "--no-first-run"
    ) | Out-Null
  } else {
    Start-Process $adminUrl | Out-Null
  }
}

[pscustomobject]@{
  ok = $true
  repo = $RepoRoot.Path
  frontend = "http://127.0.0.1:$FrontendPort"
  adminUrl = $adminUrl
  frontendProcess = $frontendPid
  backend = "http://127.0.0.1:$BackendPort"
  backendProcess = $backendPid
  logs = $LogDir
  publicAdmin = "https://admin.phantomforce.online"
}
