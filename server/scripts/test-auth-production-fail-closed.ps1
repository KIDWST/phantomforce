$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5292 }
$serverUrl = "http://127.0.0.1:$serverPort"

Push-Location $repoRoot
try {
  npm run build --workspace @phantomforce/server
  if ($LASTEXITCODE -ne 0) {
    throw "Server build failed."
  }

  $serverEnv = @{
    NODE_ENV = "production"
    PORT = "$serverPort"
    HOST = "127.0.0.1"
    PHANTOMFORCE_AUTH_PROVIDER = "demo"
    PHANTOMFORCE_ENABLE_DEMO_AUTH = "true"
    PHANTOMFORCE_SESSION_SECRET = "phantomforce-production-test-secret-with-enough-length"
    PHANTOMFORCE_SERVER_LOGGER = "false"
  }

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction Stop
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeCommand.Source
  $startInfo.Arguments = "server/dist/index.js"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false

  foreach ($key in $serverEnv.Keys) {
    $startInfo.Environment[$key] = $serverEnv[$key]
  }

  $serverProcess = [System.Diagnostics.Process]::Start($startInfo)
  $healthResponded = $false

  try {
    for ($i = 1; $i -le 20; $i++) {
      if ($serverProcess.HasExited) {
        break
      }

      try {
        $health = Invoke-RestMethod -Uri "$serverUrl/health" -TimeoutSec 1
        if ($health.ok -eq $true) {
          $healthResponded = $true
          break
        }
      } catch {}

      Start-Sleep -Milliseconds 250
    }

    if ($healthResponded) {
      throw "Server answered /health in production demo-auth mode."
    }

    if (-not $serverProcess.HasExited) {
      throw "Server kept running with demo auth enabled in production instead of failing closed."
    }

    if ($serverProcess.ExitCode -eq 0) {
      throw "Server exited successfully with demo auth enabled in production; expected non-zero fail-closed exit."
    }

    $summary = [pscustomobject]@{
      ok = $true
      failedClosed = $true
      healthResponded = $healthResponded
      exitCode = $serverProcess.ExitCode
      server = $serverUrl
      nodeEnv = "production"
      authProvider = "demo"
      demoAuthRequested = $true
    }

    $summary | ConvertTo-Json -Compress
  } finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -Force
    }
  }
} finally {
  Pop-Location
}
