$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5188
$Url = "http://127.0.0.1:$Port/"
$LogDir = Join-Path $AppDir "logs"
$OutLog = Join-Path $LogDir "phantomforce-ai.out.log"
$ErrLog = Join-Path $LogDir "phantomforce-ai.err.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-PhantomForceServer {
  try {
    return [bool](Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

if (-not (Test-PhantomForceServer)) {
  $Npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if (-not $Npm) {
    throw "PhantomForce AI needs Node.js/npm available on this PC."
  }

  Start-Process `
    -FilePath $Npm.Source `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $AppDir `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden

  for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
    if (Test-PhantomForceServer) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
}

Start-Process $Url
