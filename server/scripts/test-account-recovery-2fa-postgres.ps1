$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$containerName = if ($env:PHANTOMFORCE_POSTGRES_CONTAINER) { $env:PHANTOMFORCE_POSTGRES_CONTAINER } else { "phantomforce-account-recovery-2fa-test" }
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5294 }
$serverUrl = "http://127.0.0.1:$serverPort"

function Invoke-Docker {
  param([Parameter(Mandatory = $true)][string[]]$Args)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & docker @Args
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($exitCode -ne 0) {
    throw "Docker command failed: docker $($Args -join ' ')"
  }
}

function Remove-TestContainer {
  $names = docker ps -a --format "{{.Names}}"
  if ($names -contains $containerName) {
    docker rm -f $containerName | Out-Null
  }
}

try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  docker info 1>$null 2>$null
  $dockerInfoExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($dockerInfoExitCode -ne 0) {
    throw "Docker is not running."
  }

  Remove-TestContainer
  Invoke-Docker @(
    "run",
    "--name", $containerName,
    "-e", "POSTGRES_USER=phantomforce",
    "-e", "POSTGRES_PASSWORD=phantomforce",
    "-e", "POSTGRES_DB=phantomforce_account_test",
    "-p", "127.0.0.1::5432",
    "-d",
    "postgres:16-alpine"
  )

  $ready = $false
  for ($i = 1; $i -le 45; $i++) {
    docker exec $containerName pg_isready -U phantomforce -d phantomforce_account_test 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Postgres account recovery test container did not become ready."
  }

  $portLine = docker port $containerName 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $portLine) {
    throw "Could not resolve mapped Postgres account test port."
  }
  $postgresPort = ($portLine -split ":")[-1].Trim()
  $databaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:$postgresPort/phantomforce_account_test"

  Push-Location $repoRoot
  try {
    $env:DATABASE_URL = $databaseUrl
    npx prisma migrate deploy --schema server/prisma/schema.prisma
    if ($LASTEXITCODE -ne 0) {
      throw "Prisma migrate deploy failed."
    }

    npm run build --workspace @phantomforce/server
    if ($LASTEXITCODE -ne 0) {
      throw "Server build failed."
    }

    $serverEnv = @{
      NODE_ENV = "test"
      PORT = "$serverPort"
      HOST = "127.0.0.1"
      DATABASE_URL = $databaseUrl
      PHANTOMFORCE_AUTH_PROVIDER = "database"
      PHANTOMFORCE_ENABLE_DEMO_AUTH = "false"
      PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false"
      PHANTOMFORCE_ACCESS_REPOSITORY = ""
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-account-recovery-2fa-test-secret"
      PHANTOMFORCE_SERVER_LOGGER = "false"
      PHANTOMFORCE_AUTH_DELIVERY_DIR = (Join-Path $repoRoot "tmp\account-recovery-2fa")
      PHANTOMFORCE_PUBLIC_APP_URL = $serverUrl
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

    try {
      $serverReady = $false
      for ($i = 1; $i -le 45; $i++) {
        try {
          $health = Invoke-RestMethod -Uri "$serverUrl/health" -TimeoutSec 1
          if ($health.ok -eq $true) {
            $serverReady = $true
            break
          }
        } catch {}
        Start-Sleep -Seconds 1
      }

      if (-not $serverReady) {
        throw "Database-auth account recovery server did not become ready."
      }

      $previousBase = $env:BASE
      try {
        $env:BASE = $serverUrl
        npx tsx server/scripts/test-account-recovery-2fa.ts
        if ($LASTEXITCODE -ne 0) {
          throw "Account recovery + 2FA API test failed."
        }
      } finally {
        $env:BASE = $previousBase
      }
    } finally {
      if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
      }
    }
  } finally {
    Pop-Location
  }
} finally {
  Remove-TestContainer
}
