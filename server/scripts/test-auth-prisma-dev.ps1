$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$containerName = if ($env:PHANTOMFORCE_POSTGRES_CONTAINER) { $env:PHANTOMFORCE_POSTGRES_CONTAINER } else { "phantomforce-auth-prisma-dev-test" }
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5293 }
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

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $false)][string]$Method = "Get",
    [Parameter(Mandatory = $false)]$Body,
    [Parameter(Mandatory = $false)][hashtable]$Headers = @{}
  )

  $parameters = @{
    Uri = $Uri
    Method = $Method
    ContentType = "application/json"
    Headers = $Headers
  }

  if ($null -ne $Body) {
    $parameters.Body = ($Body | ConvertTo-Json -Compress)
  }

  Invoke-RestMethod @parameters
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw "ASSERTION FAILED: $Message"
  }
}

function Assert-HttpError {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Call,
    [Parameter(Mandatory = $true)][int]$StatusCode,
    [Parameter(Mandatory = $true)][string]$Message
  )

  try {
    & $Call | Out-Null
  } catch {
    $actual = $_.Exception.Response.StatusCode.value__
    if ($actual -eq $StatusCode) {
      return
    }

    throw "ASSERTION FAILED: $Message Expected $StatusCode, got $actual"
  }

  throw "ASSERTION FAILED: $Message"
}

function New-AuthHeaders {
  param([Parameter(Mandatory = $true)][string]$SessionId)

  $login = Invoke-Json `
    -Uri "$serverUrl/auth/session-login" `
    -Method "Post" `
    -Body @{ sessionId = $SessionId }

  Assert-True ($login.ok -eq $true) "Prisma dev auth should issue token for $SessionId."
  Assert-True ($login.tokenType -eq "Bearer") "Prisma dev auth should issue bearer token."

  return @{ "Authorization" = "Bearer $($login.token)" }
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
    "-e", "POSTGRES_DB=phantomforce_auth_test",
    "-p", "127.0.0.1::5432",
    "-d",
    "postgres:16-alpine"
  )

  $ready = $false
  for ($i = 1; $i -le 45; $i++) {
    docker exec $containerName pg_isready -U phantomforce -d phantomforce_auth_test 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }

    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Postgres auth test container did not become ready."
  }

  $portLine = docker port $containerName 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $portLine) {
    throw "Could not resolve mapped Postgres auth test port."
  }
  $postgresPort = ($portLine -split ":")[-1].Trim()
  $databaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:$postgresPort/phantomforce_auth_test"

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
      PORT = "$serverPort"
      HOST = "127.0.0.1"
      DATABASE_URL = $databaseUrl
      PHANTOMFORCE_AUTH_PROVIDER = "prisma-dev"
      PHANTOMFORCE_ENABLE_DEMO_AUTH = "false"
      PHANTOMFORCE_ADMIN_EMAILS = "jordan@phantomforce.local"
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-prisma-dev-auth-test-secret"
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
        throw "Prisma-dev-auth server did not become ready."
      }

      $sessions = Invoke-Json -Uri "$serverUrl/sessions"
      Assert-True ($sessions.auth.authProvider -eq "prisma-dev") "Auth provider should be prisma-dev."
      Assert-True ($sessions.auth.demoAuthEnabled -eq $false) "Demo auth should be disabled in prisma-dev mode."
      Assert-True ($sessions.auth.prismaDevAuthEnabled -eq $true) "Prisma dev auth should be enabled."
      Assert-True ($sessions.auth.sessionSource -eq "prisma-membership") "Sessions should come from Prisma memberships."
      Assert-True (@($sessions.sessions | Where-Object { $_.id -eq "db-admin-jordan" }).Count -eq 1) "DB admin session should exist."
      Assert-True (@($sessions.sessions | Where-Object { $_.id -eq "db-client-sports-demo" }).Count -eq 1) "DB client session should exist."

      Assert-HttpError `
        -StatusCode 403 `
        -Message "Demo login endpoint should be disabled in prisma-dev auth mode." `
        -Call {
          Invoke-Json `
            -Uri "$serverUrl/auth/demo-login" `
            -Method "Post" `
            -Body @{ sessionId = "admin-jordan" }
        }

      $adminHeaders = New-AuthHeaders "db-admin-jordan"
      $sportsClientHeaders = New-AuthHeaders "db-client-sports-demo"
      $chicagoClientHeaders = New-AuthHeaders "db-client-chicagoshots"

      $adminSession = Invoke-Json -Uri "$serverUrl/session" -Headers $adminHeaders
      Assert-True ($adminSession.session.canManageAccess -eq $true) "DB admin session should manage access."

      $sportsWorkspace = Invoke-Json -Uri "$serverUrl/client-workspaces/client-sports-demo" -Headers $sportsClientHeaders
      Assert-True ($sportsWorkspace.ok -eq $true) "DB client should view its own workspace."
      Assert-True ($sportsWorkspace.session.clientId -eq "client-sports-demo") "DB client session should be scoped to its org."

      Assert-HttpError `
        -StatusCode 403 `
        -Message "DB client should not view another client workspace." `
        -Call {
          Invoke-Json `
            -Uri "$serverUrl/client-workspaces/client-sports-demo" `
            -Headers $chicagoClientHeaders
        }

      Assert-HttpError `
        -StatusCode 403 `
        -Message "DB client should not read admin workflow." `
        -Call {
          Invoke-Json `
            -Uri "$serverUrl/client-access-workflow" `
            -Headers $sportsClientHeaders
        }

      $adminPangolin = Invoke-Json -Uri "$serverUrl/pangolin/reconcile/dry-run" -Headers $adminHeaders
      Assert-True ($adminPangolin.dryRun -eq $true) "DB admin should read Pangolin dry-run."

      $summary = [pscustomobject]@{
        ok = $true
        server = $serverUrl
        authProvider = $sessions.auth.authProvider
        sessionSource = $sessions.auth.sessionSource
        demoAuthEnabled = $sessions.auth.demoAuthEnabled
        prismaDevAuthEnabled = $sessions.auth.prismaDevAuthEnabled
        dbAdminCanManageAccess = $adminSession.session.canManageAccess
        dbClientScoped = $sportsWorkspace.session.clientId
        pangolinDryRun = $adminPangolin.dryRun
        sessionCount = $sessions.sessions.Count
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
} finally {
  Remove-TestContainer
}
