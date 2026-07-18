$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$containerName = if ($env:PHANTOMFORCE_DATABASE_AUTH_CONTAINER) { $env:PHANTOMFORCE_DATABASE_AUTH_CONTAINER } else { "phantomforce-auth-database-test" }
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5391 }
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

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
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

  if (-not $env:PHANTOMFORCE_TEST_SERVER_PORT) {
    $serverPort = Get-FreeTcpPort
    $serverUrl = "http://127.0.0.1:$serverPort"
  }

  Remove-TestContainer
  Invoke-Docker @(
    "run",
    "--name", $containerName,
    "-e", "POSTGRES_USER=phantomforce",
    "-e", "POSTGRES_PASSWORD=phantomforce",
    "-e", "POSTGRES_DB=phantomforce_auth_database_test",
    "-p", "127.0.0.1::5432",
    "-d",
    "postgres:16-alpine"
  )

  $ready = $false
  for ($i = 1; $i -le 45; $i++) {
    docker exec $containerName pg_isready -U phantomforce -d phantomforce_auth_database_test 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }

    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Postgres database-auth test container did not become ready."
  }

  $portLine = docker port $containerName 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $portLine) {
    throw "Could not resolve mapped Postgres database-auth test port."
  }
  $postgresPort = ($portLine -split ":")[-1].Trim()
  $databaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:$postgresPort/phantomforce_auth_database_test"

  Push-Location $repoRoot
  try {
    $env:DATABASE_URL = $databaseUrl
    npx prisma migrate deploy --schema server/prisma/schema.prisma
    if ($LASTEXITCODE -ne 0) {
      throw "Prisma migrate deploy failed."
    }

    npx prisma generate --schema server/prisma/schema.prisma
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
      PHANTOMFORCE_AUTH_PROVIDER = "database"
      PHANTOMFORCE_ENABLE_DEMO_AUTH = "false"
      PHANTOMFORCE_SKIP_SERVER_DOTENV = "true"
      PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false"
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-database-auth-live-test-secret"
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
        throw "Database-auth server did not become ready."
      }

      $env:BASE = $serverUrl
      node server/scripts/test-database-auth.mjs
      if ($LASTEXITCODE -ne 0) {
        throw "Database auth live API probe failed."
      }

      if ($env:PHANTOMFORCE_SKIP_DATABASE_AUTH_BROWSER -ne "true") {
        $env:PHANTOMFORCE_DATABASE_AUTH_BROWSER_API_BASE = $serverUrl
        node scripts/test-database-auth-org-browser.mjs
        if ($LASTEXITCODE -ne 0) {
          throw "Database auth browser organization probe failed."
        }
      }
    } finally {
      if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
      }
      Remove-Item Env:\BASE -ErrorAction SilentlyContinue
      Remove-Item Env:\PHANTOMFORCE_DATABASE_AUTH_BROWSER_API_BASE -ErrorAction SilentlyContinue
    }
  } finally {
    Pop-Location
  }
} finally {
  Remove-TestContainer
}
