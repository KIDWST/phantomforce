$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$containerName = if ($env:PHANTOMFORCE_POSTGRES_CONTAINER) { $env:PHANTOMFORCE_POSTGRES_CONTAINER } else { "phantomforce-developer-role-test" }
$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { 5391 }
$serverUrl = "http://127.0.0.1:$serverPort"

function Invoke-Docker {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & docker @Args
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($exitCode -ne 0) { throw "Docker command failed: docker $($Args -join ' ')" }
}

function Remove-TestContainer {
  $names = docker ps -a --format "{{.Names}}"
  if ($names -contains $containerName) { docker rm -f $containerName | Out-Null }
}

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $false)][string]$Method = "Get",
    [Parameter(Mandatory = $false)]$Body,
    [Parameter(Mandatory = $false)][hashtable]$Headers = @{}
  )
  $parameters = @{ Uri = $Uri; Method = $Method; ContentType = "application/json"; Headers = $Headers }
  if ($null -ne $Body) { $parameters.Body = ($Body | ConvertTo-Json -Compress) }
  Invoke-RestMethod @parameters
}

function Assert-True {
  param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
  if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-HttpError {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Call,
    [Parameter(Mandatory = $true)][int]$StatusCode,
    [Parameter(Mandatory = $true)][string]$Message
  )
  try { & $Call | Out-Null } catch {
    $actual = $_.Exception.Response.StatusCode.value__
    if ($actual -eq $StatusCode) { return }
    throw "ASSERTION FAILED: $Message Expected $StatusCode, got $actual"
  }
  throw "ASSERTION FAILED: $Message"
}

try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  docker info 1>$null 2>$null
  $dockerInfoExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($dockerInfoExitCode -ne 0) { throw "Docker is not running." }

  Remove-TestContainer
  Invoke-Docker @(
    "run", "--name", $containerName,
    "-e", "POSTGRES_USER=phantomforce",
    "-e", "POSTGRES_PASSWORD=phantomforce",
    "-e", "POSTGRES_DB=phantomforce_developer_role_test",
    "-p", "127.0.0.1::5432", "-d", "postgres:16-alpine"
  )

  $ready = $false
  for ($i = 1; $i -le 45; $i++) {
    docker exec $containerName pg_isready -U phantomforce -d phantomforce_developer_role_test 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Postgres test container did not become ready." }

  $portLine = docker port $containerName 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $portLine) { throw "Could not resolve mapped Postgres port." }
  $postgresPort = ($portLine -split ":")[-1].Trim()
  $databaseUrl = "postgresql://phantomforce:phantomforce@127.0.0.1:$postgresPort/phantomforce_developer_role_test"

  Push-Location $repoRoot
  try {
    $env:DATABASE_URL = $databaseUrl
    npx prisma migrate deploy --schema server/prisma/schema.prisma
    if ($LASTEXITCODE -ne 0) { throw "Prisma migrate deploy failed." }

    npm run build --workspace @phantomforce/server
    if ($LASTEXITCODE -ne 0) { throw "Server build failed." }

    $serverEnv = @{
      NODE_ENV = "test"; PORT = "$serverPort"; HOST = "127.0.0.1"
      DATABASE_URL = $databaseUrl
      PHANTOMFORCE_AUTH_PROVIDER = "database"
      PHANTOMFORCE_ENABLE_DEMO_AUTH = "false"
      PHANTOMFORCE_SKIP_SERVER_DOTENV = "true"
      PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false"
      PHANTOMFORCE_ADMIN_EMAILS = "jordan@phantomforce.local"
      PHANTOMFORCE_SESSION_SECRET = "phantomforce-developer-role-test-secret"
      PHANTOMFORCE_SERVER_LOGGER = "false"
    }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction Stop }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeCommand.Source
    $startInfo.Arguments = "server/dist/index.js"
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    foreach ($key in $serverEnv.Keys) { $startInfo.Environment[$key] = $serverEnv[$key] }

    $serverProcess = [System.Diagnostics.Process]::Start($startInfo)

    try {
      $serverReady = $false
      for ($i = 1; $i -le 45; $i++) {
        try {
          $health = Invoke-RestMethod -Uri "$serverUrl/health" -TimeoutSec 1
          if ($health.ok -eq $true) { $serverReady = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
      }
      if (-not $serverReady) { throw "Server did not become ready." }

      # 1. Sign up a fresh Submit Your Game (developer) account.
      $signup = Invoke-Json -Uri "$serverUrl/auth/signup-developer" -Method "Post" -Body @{
        email = "dev-test@phantomforce.local"
        password = "dev-test-password-123"
        name = "Test Developer"
        workspaceName = "Test Dev Studio"
        workspaceBrief = "Submitting an original PhantomPlay arcade game for review."
      }
      Assert-True ($signup.ok -eq $true) "Developer signup should succeed."
      Assert-True ($signup.session.orgRole -eq "developer") "Fresh signup should carry the developer role."
      $devHeaders = @{ Authorization = "Bearer $($signup.token)" }

      # 2. Developer role must reach PhantomPlay.
      $pp = Invoke-Json -Uri "$serverUrl/api/phantomplay" -Headers $devHeaders
      Assert-True ($pp.ok -eq $true -or $null -ne $pp) "Developer role must reach PhantomPlay."

      # 3. Developer role must reach the customization config (needed for the app shell/nav to render).
      $config = Invoke-Json -Uri "$serverUrl/phantom-ai/customization/config" -Headers $devHeaders
      Assert-True ($null -ne $config) "Developer role must read workspace config so the shell can render."

      # 4. Developer role must be DENIED (fail-closed) on an out-of-scope module: CRM.
      Assert-HttpError -StatusCode 403 -Message "Developer role must be denied CRM (out of scope)." -Call {
        Invoke-Json -Uri "$serverUrl/orgs/$($signup.org.id)/crm" -Headers $devHeaders
      }

      # 5. Developer role must be DENIED on customization WRITE (can't self-elevate by reconfiguring modules).
      Assert-HttpError -StatusCode 403 -Message "Developer role must not be able to write customization config." -Call {
        Invoke-Json -Uri "$serverUrl/phantom-ai/customization/preview" -Method "Post" -Headers $devHeaders -Body @{ patch = @{} }
      }

      # 6. Self-serve upgrade: sole member of their own org can promote themselves to owner.
      $upgrade = Invoke-Json -Uri "$serverUrl/auth/upgrade-developer" -Method "Post" -Headers $devHeaders -Body @{}
      Assert-True ($upgrade.ok -eq $true) "Solo developer account should be able to self-upgrade."
      Assert-True ($upgrade.session.orgRole -eq "owner") "Upgrade should promote the sole member to owner."

      # 7. After upgrade, the same account (re-logged-in) can now reach CRM.
      $reLogin = Invoke-Json -Uri "$serverUrl/auth/login" -Method "Post" -Body @{
        email = "dev-test@phantomforce.local"; password = "dev-test-password-123"
      }
      Assert-True ($reLogin.ok -eq $true) "Upgraded account should still log in normally."
      Assert-True ($reLogin.session.orgRole -eq "owner") "Re-login must reflect the upgraded role."
      $ownerHeaders = @{ Authorization = "Bearer $($reLogin.token)" }
      $crmAfterUpgrade = Invoke-Json -Uri "$serverUrl/orgs/$($signup.org.id)/crm" -Headers $ownerHeaders
      Assert-True ($null -ne $crmAfterUpgrade) "Upgraded owner should now reach CRM."

      $summary = [pscustomobject]@{
        ok = $true
        server = $serverUrl
        developerSignupRole = $signup.session.orgRole
        phantomplayReachable = $true
        crmDeniedForDeveloper = $true
        customizationWriteDeniedForDeveloper = $true
        selfUpgradeRole = $upgrade.session.orgRole
        crmReachableAfterUpgrade = $true
      }
      $summary | ConvertTo-Json -Compress
    } finally {
      if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
    }
  } finally {
    Pop-Location
  }
} finally {
  Remove-TestContainer
}
