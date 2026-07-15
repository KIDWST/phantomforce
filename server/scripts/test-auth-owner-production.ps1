$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

$serverPort = if ($env:PHANTOMFORCE_TEST_SERVER_PORT) { [int]$env:PHANTOMFORCE_TEST_SERVER_PORT } else { Get-FreeTcpPort }
$serverUrl = "http://127.0.0.1:$serverPort"

$strongSecret = "owner-production-test-secret-with-more-than-32-characters-1234567890"
$ownerKey = "owner-login-key-strong-1234567890"
$ownerEmail = "jordan@phantomforce.local"

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction Stop }

function Get-StatusCode($err) {
  try { return [int]$err.Exception.Response.StatusCode } catch { return -1 }
}

function Start-Server([hashtable]$envVars) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeCommand.Source
  $startInfo.Arguments = "server/dist/index.js"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  foreach ($key in $envVars.Keys) { $startInfo.Environment[$key] = $envVars[$key] }
  return [System.Diagnostics.Process]::Start($startInfo)
}

function Wait-Health([System.Diagnostics.Process]$proc) {
  for ($i = 1; $i -le 24; $i++) {
    if ($proc.HasExited) { return $false }
    try {
      $health = Invoke-RestMethod -Uri "$serverUrl/health" -TimeoutSec 1
      if ($health.ok -eq $true) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Base-Env([hashtable]$overrides) {
  $base = @{
    NODE_ENV = "production"
    PORT = "$serverPort"
    HOST = "127.0.0.1"
    PHANTOMFORCE_AUTH_PROVIDER = "owner-production"
    PHANTOMFORCE_ENABLE_DEMO_AUTH = "false"
    PHANTOMFORCE_SKIP_SERVER_DOTENV = "true"
    PHANTOMFORCE_ACCESS_REPOSITORY = "json-file"
    PHANTOMFORCE_SESSION_SECRET = $strongSecret
    PHANTOMFORCE_OWNER_EMAIL = $ownerEmail
    PHANTOMFORCE_OWNER_LOGIN_KEY = $ownerKey
    PHANTOMFORCE_SERVER_LOGGER = "false"
  }
  if ($overrides) { foreach ($k in $overrides.Keys) { $base[$k] = $overrides[$k] } }
  return $base
}

Push-Location $repoRoot
try {
  npm run build --workspace @phantomforce/server
  if ($LASTEXITCODE -ne 0) { throw "Server build failed." }

  $booted = $false
  $ownerLoginOk = $false
  $wrongKeyRejected = $false
  $demoLoginDisabled = $false
  $readinessOk = $false
  $authProductionReady = $false
  $anonymousFalconRejected = $false
  $ownerFalconValidationOk = $false
  $sessionCount = -1

  # ---- Happy path: owner-production boots in NODE_ENV=production ----
  $proc = Start-Server (Base-Env $null)
  try {
    $booted = Wait-Health $proc
    if (-not $booted) { throw "owner-production failed to boot in production." }

    $body = @{ sessionId = "owner-admin"; ownerKey = $ownerKey } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "$serverUrl/auth/owner-login" -Method Post -Body $body -ContentType "application/json"
    $token = $login.token
    if ($token) { $ownerLoginOk = $true }

    $headers = @{ Authorization = "Bearer $token" }
    $readiness = Invoke-RestMethod -Uri "$serverUrl/readiness" -Headers $headers
    if ($readiness.ok -eq $true) { $readinessOk = $true }
    $authGate = $readiness.report.gates | Where-Object { $_.id -eq "production_auth" }
    if ($authGate.status -eq "ready") { $authProductionReady = $true }

    $sessions = Invoke-RestMethod -Uri "$serverUrl/sessions"
    $sessionCount = @($sessions.sessions).Count

    $falconBody = @{
      type = "falcon.health_check"
      requiresApproval = $true
      reversible = $true
      rationale = "owner-production metadata validation only"
      payload = @{}
    } | ConvertTo-Json

    try {
      Invoke-RestMethod -Uri "$serverUrl/falcon/jobs/validate" -Method Post -Body $falconBody -ContentType "application/json" | Out-Null
    } catch {
      if ((Get-StatusCode $_) -eq 401) { $anonymousFalconRejected = $true }
    }

    $falconValidation = Invoke-RestMethod -Uri "$serverUrl/falcon/jobs/validate" -Method Post -Body $falconBody -ContentType "application/json" -Headers $headers
    if ($falconValidation.ok -eq $true -and $falconValidation.jobType -eq "falcon.health_check" -and $falconValidation.session.canManageAccess -eq $true) {
      $ownerFalconValidationOk = $true
    }

    try {
      $badBody = @{ sessionId = "owner-admin"; ownerKey = "wrong-key" } | ConvertTo-Json
      Invoke-RestMethod -Uri "$serverUrl/auth/owner-login" -Method Post -Body $badBody -ContentType "application/json" | Out-Null
    } catch {
      if ((Get-StatusCode $_) -eq 401) { $wrongKeyRejected = $true }
    }

    try {
      $demoBody = @{ sessionId = "owner-admin"; ownerKey = $ownerKey } | ConvertTo-Json
      Invoke-RestMethod -Uri "$serverUrl/auth/demo-login" -Method Post -Body $demoBody -ContentType "application/json" | Out-Null
    } catch {
      if ((Get-StatusCode $_) -eq 403) { $demoLoginDisabled = $true }
    }
  } finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  }

  # ---- Fail-closed: weak session secret ----
  $weakProc = Start-Server (Base-Env @{ PHANTOMFORCE_SESSION_SECRET = "short" })
  $weakSecretFailedClosed = $false
  try {
    $weakBooted = Wait-Health $weakProc
    $weakSecretFailedClosed = (-not $weakBooted) -and $weakProc.HasExited -and ($weakProc.ExitCode -ne 0)
  } finally {
    if ($weakProc -and -not $weakProc.HasExited) { Stop-Process -Id $weakProc.Id -Force }
  }

  # ---- Fail-closed: missing owner login key ----
  $noKeyProc = Start-Server (Base-Env @{ PHANTOMFORCE_OWNER_LOGIN_KEY = "" })
  $missingKeyFailedClosed = $false
  try {
    $noKeyBooted = Wait-Health $noKeyProc
    $missingKeyFailedClosed = (-not $noKeyBooted) -and $noKeyProc.HasExited -and ($noKeyProc.ExitCode -ne 0)
  } finally {
    if ($noKeyProc -and -not $noKeyProc.HasExited) { Stop-Process -Id $noKeyProc.Id -Force }
  }

  $allOk = $booted -and $ownerLoginOk -and $wrongKeyRejected -and $demoLoginDisabled -and `
    $readinessOk -and $authProductionReady -and $anonymousFalconRejected -and $ownerFalconValidationOk -and ($sessionCount -eq 1) -and `
    $weakSecretFailedClosed -and $missingKeyFailedClosed

  $summary = [pscustomobject]@{
    ok = $allOk
    bootedInProduction = $booted
    ownerLoginOk = $ownerLoginOk
    wrongKeyRejected = $wrongKeyRejected
    demoLoginDisabled = $demoLoginDisabled
    readinessAdminOk = $readinessOk
    productionAuthGateReady = $authProductionReady
    anonymousFalconRejected = $anonymousFalconRejected
    ownerFalconValidationOk = $ownerFalconValidationOk
    ownerSessionCount = $sessionCount
    weakSecretFailedClosed = $weakSecretFailedClosed
    missingKeyFailedClosed = $missingKeyFailedClosed
    server = $serverUrl
    authProvider = "owner-production"
  }

  $summary | ConvertTo-Json -Compress
  if (-not $allOk) { exit 1 }
} finally {
  Pop-Location
}
