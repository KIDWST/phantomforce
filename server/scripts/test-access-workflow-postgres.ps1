$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$containerName = if ($env:PHANTOMFORCE_POSTGRES_CONTAINER) { $env:PHANTOMFORCE_POSTGRES_CONTAINER } else { "phantomforce-postgres-test" }
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5290 }
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
  $portArgs = if ($env:PHANTOMFORCE_POSTGRES_PORT) {
    @("-p", "$($env:PHANTOMFORCE_POSTGRES_PORT)`:5432")
  } else {
    @("-p", "127.0.0.1::5432")
  }

  $dockerRunArgs = @(
    "run",
    "--name", $containerName,
    "-e", "POSTGRES_USER=phantomforce",
    "-e", "POSTGRES_PASSWORD=phantomforce",
    "-e", "POSTGRES_DB=phantomforce_test"
  ) + $portArgs + @(
    "-d",
    "postgres:16-alpine"
  )
  Invoke-Docker $dockerRunArgs

  $ready = $false
  for ($i = 1; $i -le 45; $i++) {
    docker exec $containerName pg_isready -U phantomforce -d phantomforce_test 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }

    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Postgres test container did not become ready."
  }

  $portLine = docker port $containerName 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $portLine) {
    throw "Could not resolve mapped Postgres test port."
  }
  $postgresPort = ($portLine -split ":")[-1].Trim()
  $databaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:$postgresPort/phantomforce_test"

  Push-Location $repoRoot
  try {
    $env:DATABASE_URL = $databaseUrl
    npx prisma migrate deploy --schema server/prisma/schema.prisma
    if ($LASTEXITCODE -ne 0) {
      throw "Prisma migrate deploy failed."
    }

    npm run prisma:generate --workspace @phantomforce/server
    if ($LASTEXITCODE -ne 0) {
      throw "Prisma generate failed."
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
      PHANTOMFORCE_AUTH_PROVIDER = "demo"
      PHANTOMFORCE_ENABLE_DEMO_AUTH = "true"
      PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false"
      PHANTOMFORCE_ACCESS_REPOSITORY = ""
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-postgres-test-secret"
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
        throw "Postgres-backed server did not become ready."
      }

      $env:PHANTOMFORCE_SERVER_URL = $serverUrl
      $env:PHANTOMFORCE_EXPECT_REPOSITORY_DRIVER = "prisma-postgres"
      $env:PHANTOMFORCE_EXPECT_PRISMA_WRITE_MODE = "enabled"
      & (Join-Path $PSScriptRoot "test-access-workflow.ps1")
      if ($LASTEXITCODE -ne 0) {
        throw "Postgres access workflow test failed."
      }
    } finally {
      if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
      }
    }

    $databaseAuthEnv = @{
      NODE_ENV = "test"
      PORT = "$serverPort"
      HOST = "127.0.0.1"
      DATABASE_URL = $databaseUrl
      PHANTOMFORCE_AUTH_PROVIDER = "database"
      PHANTOMFORCE_ENABLE_DEMO_AUTH = "false"
      PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false"
      PHANTOMFORCE_ACCESS_REPOSITORY = ""
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-postgres-test-secret-with-enough-length"
      PHANTOMFORCE_SERVER_LOGGER = "false"
      PHANTOMFORCE_DEV_SEED_PASSWORD = "phantom-dev-password"
    }
    $databaseAuthStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $databaseAuthStartInfo.FileName = $nodeCommand.Source
    $databaseAuthStartInfo.Arguments = "server/dist/index.js"
    $databaseAuthStartInfo.WorkingDirectory = $repoRoot
    $databaseAuthStartInfo.UseShellExecute = $false
    foreach ($key in $databaseAuthEnv.Keys) {
      $databaseAuthStartInfo.Environment[$key] = $databaseAuthEnv[$key]
    }

    $databaseAuthServerProcess = [System.Diagnostics.Process]::Start($databaseAuthStartInfo)

    try {
      $databaseAuthReady = $false
      for ($i = 1; $i -le 45; $i++) {
        try {
          $health = Invoke-RestMethod -Uri "$serverUrl/health" -TimeoutSec 1
          if ($health.ok -eq $true) {
            $databaseAuthReady = $true
            break
          }
        } catch {}

        Start-Sleep -Seconds 1
      }

      if (-not $databaseAuthReady) {
        throw "Database-auth Postgres server did not become ready."
      }

      $previousBase = $env:BASE
      try {
        $env:BASE = $serverUrl
        node server/scripts/test-database-auth.mjs
        if ($LASTEXITCODE -ne 0) {
          throw "Database auth API test failed."
        }
      } finally {
        $env:BASE = $previousBase
      }
    } finally {
      if ($databaseAuthServerProcess -and -not $databaseAuthServerProcess.HasExited) {
        Stop-Process -Id $databaseAuthServerProcess.Id -Force
      }
    }
  } finally {
    Pop-Location
  }
} finally {
  Remove-TestContainer
}
