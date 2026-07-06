$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5291 }
$serverUrl = "http://127.0.0.1:$serverPort"
$badDatabaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:1/phantomforce_fail_closed?connect_timeout=1"

Push-Location $repoRoot
try {
  npm run build --workspace @phantomforce/server
  if ($LASTEXITCODE -ne 0) {
    throw "Server build failed."
  }

  $serverEnv = @{
    NODE_ENV = "test"
    PORT = "$serverPort"
    HOST = "127.0.0.1"
    DATABASE_URL = $badDatabaseUrl
    PHANTOMFORCE_ACCESS_REPOSITORY = ""
    PHANTOMFORCE_PRISMA_STARTUP_TIMEOUT_MS = "2000"
    PHANTOMFORCE_SESSION_SECRET = "phantomforce-fail-closed-test-secret"
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
    for ($i = 1; $i -le 30; $i++) {
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

      Start-Sleep -Milliseconds 500
    }

    if ($healthResponded) {
      throw "Server answered /health even though DATABASE_URL points to unreachable Postgres."
    }

    if (-not $serverProcess.HasExited) {
      throw "Server kept running with unreachable Postgres DATABASE_URL instead of failing closed."
    }

    if ($serverProcess.ExitCode -eq 0) {
      throw "Server exited successfully with unreachable Postgres DATABASE_URL; expected non-zero fail-closed exit."
    }

    $summary = [pscustomobject]@{
      ok = $true
      failedClosed = $true
      healthResponded = $healthResponded
      exitCode = $serverProcess.ExitCode
      server = $serverUrl
      repositoryDriverExpected = "prisma-postgres"
      databaseUrlHost = "127.0.0.1:1"
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
