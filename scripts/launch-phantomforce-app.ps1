param(
  [ValidateSet("admin", "employee", "demo")]
  [string]$Mode = "admin"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WebPort = 5173
$ServerPort = 5190
$LaunchRoot = Join-Path $env:LOCALAPPDATA "PhantomForce\launcher"
$LogRoot = Join-Path $LaunchRoot "logs"
New-Item -ItemType Directory -Force -Path $LaunchRoot, $LogRoot | Out-Null

function Test-LocalPort {
  param([int]$Port)
  try {
    return [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Start-NpmProcess {
  param(
    [string]$Name,
    [string]$Command,
    [int]$Port
  )
  if (Test-LocalPort -Port $Port) { return }

  $logPath = Join-Path $LogRoot "$Name.log"
  $escapedRepo = $RepoRoot.Replace("'", "''")
  $escapedLog = $logPath.Replace("'", "''")
  $script = "Set-Location -LiteralPath '$escapedRepo'; `$env:PHANTOMFORCE_DESKTOP_LAUNCHER='true'; $Command *> '$escapedLog'"
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $script
  ) | Out-Null
}

function Wait-ForApp {
  param([string]$Url)
  $deadline = (Get-Date).AddSeconds(35)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 700
  } while ((Get-Date) -lt $deadline)
  return $false
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

$session = switch ($Mode) {
  "admin" { "admin" }
  "employee" { "employee" }
  "demo" { "demo" }
}

$url = "http://127.0.0.1:$WebPort/app/?session=$session&launcher=desktop"

Start-NpmProcess -Name "phantomforce-server" -Port $ServerPort -Command "npm run dev:server"
Start-NpmProcess -Name "phantomforce-web" -Port $WebPort -Command "npm run dev:web -- --host 127.0.0.1 --port $WebPort --strictPort"

[void](Wait-ForApp -Url $url)

$browser = Find-Browser
if ($browser) {
  $profilePath = Join-Path $LaunchRoot "browser-$Mode"
  New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
  Start-Process -FilePath $browser -ArgumentList @(
    "--app=$url",
    "--user-data-dir=$profilePath",
    "--no-first-run"
  ) | Out-Null
} else {
  Start-Process $url | Out-Null
}
