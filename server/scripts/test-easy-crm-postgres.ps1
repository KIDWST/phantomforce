$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$containerName = if ($env:PHANTOMFORCE_POSTGRES_CONTAINER) { $env:PHANTOMFORCE_POSTGRES_CONTAINER } else { "phantomforce-easy-crm-test" }
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5295 }
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
    "-e", "POSTGRES_DB=phantomforce_crm_test",
    "-p", "127.0.0.1::5432",
    "-d",
    "postgres:16-alpine"
  )

  $ready = $false
  for ($i = 1; $i -le 45; $i++) {
    docker exec $containerName pg_isready -U phantomforce -d phantomforce_crm_test 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Postgres Easy CRM test container did not become ready."
  }

  $portLine = docker port $containerName 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $portLine) {
    throw "Could not resolve mapped Postgres CRM test port."
  }
  $postgresPort = ($portLine -split ":")[-1].Trim()
  $databaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:$postgresPort/phantomforce_crm_test"

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
      PHANTOMFORCE_SKIP_SERVER_DOTENV = "true"
      PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false"
      PHANTOMFORCE_ACCESS_REPOSITORY = ""
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-easy-crm-test-secret"
      PHANTOMFORCE_DEV_SEED_PASSWORD = "phantomforce-easy-crm-dev-admin"
      PHANTOMFORCE_SERVER_LOGGER = "false"
      PHANTOMFORCE_SERVER_LISTEN = "true"
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
        throw "Easy CRM test server did not become ready."
      }

      $previousBase = $env:BASE
      $previousEasyCrmDevPassword = $env:PHANTOMFORCE_EASY_CRM_DEV_PASSWORD
      try {
        $env:BASE = $serverUrl
        $env:PHANTOMFORCE_EASY_CRM_DEV_PASSWORD = "phantomforce-easy-crm-dev-admin"
        npx tsx server/scripts/test-easy-crm.ts
        if ($LASTEXITCODE -ne 0) {
          throw "Easy CRM API test failed."
        }
      } finally {
        $env:BASE = $previousBase
        $env:PHANTOMFORCE_EASY_CRM_DEV_PASSWORD = $previousEasyCrmDevPassword
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
