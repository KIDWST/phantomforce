param(
  [string]$TerminaCheckout = "C:\Users\jorda\Termina",
  [int]$Port = 7420,
  [switch]$RunReadOnlyMission,
  [switch]$RunApprovedDispatch,
  [ValidateRange(10, 300)]
  [int]$MissionTimeoutSeconds = 50,
  [string]$CleanupStalePath = ""
)

$ErrorActionPreference = "Stop"
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$scratch = Join-Path $tempRoot ("termina-live-" + [guid]::NewGuid().ToString("N"))
$serverProcess = $null
$priorToken = $env:TERMINA_TOKEN
$priorPort = $env:TERMINA_PORT
$missionId = $null
$missionWorkerId = $null

if ($CleanupStalePath) {
  $stale = [System.IO.Path]::GetFullPath($CleanupStalePath)
  if (-not $stale.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Split-Path $stale -Leaf).StartsWith("termina-live-")) {
    throw "unsafe_stale_cleanup_target"
  }
  if (Test-Path -LiteralPath $stale) {
    Remove-Item -LiteralPath $stale -Recurse -Force
  }
}

try {
  git clone --quiet --no-hardlinks $TerminaCheckout $scratch
  if ($LASTEXITCODE -ne 0) { throw "local_clone_failed" }

  $nodeModules = Join-Path $scratch "node_modules"
  New-Item -ItemType Junction -Path $nodeModules -Target (Join-Path $TerminaCheckout "node_modules") | Out-Null

  $tokenBytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($tokenBytes)
  } finally {
    $rng.Dispose()
  }
  $env:TERMINA_TOKEN = [Convert]::ToBase64String($tokenBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  $env:TERMINA_PORT = [string]$Port

  $serverProcess = Start-Process `
    -FilePath (Get-Command node).Source `
    -ArgumentList "server.js" `
    -WorkingDirectory $scratch `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput (Join-Path $scratch "server.stdout.log") `
    -RedirectStandardError (Join-Path $scratch "server.stderr.log")

  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 200
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  } while (-not $listener -and (Get-Date) -lt $deadline)
  if (-not $listener) { throw "termina_port_not_ready" }

  $baseUrl = "http://127.0.0.1:$Port"
  $invalidStatus = 0
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "$baseUrl/api/health" `
      -Headers @{ "x-termina-token" = "definitely-invalid" } `
      -TimeoutSec 5 | Out-Null
  } catch {
    $invalidStatus = [int]$_.Exception.Response.StatusCode
  }

  $headers = @{ "x-termina-token" = $env:TERMINA_TOKEN }
  $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Headers $headers -TimeoutSec 5
  $repos = Invoke-RestMethod -Uri "$baseUrl/api/repos" -Headers $headers -TimeoutSec 10
  $adapterOutput = & node "node_modules/tsx/dist/cli.mjs" "server/scripts/test-termina-live-client.ts"
  if ($LASTEXITCODE -ne 0) { throw "phantomforce_termina_adapter_preflight_failed" }
  $adapter = $adapterOutput | ConvertFrom-Json
  $missionProof = $null
  $approvedDispatchProof = $null

  if ($RunReadOnlyMission -or $RunApprovedDispatch) {
    $missionWorkspace = Join-Path $scratch "mission-fixture"
    New-Item -ItemType Directory -Path $missionWorkspace | Out-Null
    $fixturePath = Join-Path $missionWorkspace "README.md"
    Set-Content -LiteralPath $fixturePath -Encoding UTF8 -NoNewline -Value "# Termina read-only fixture`n`nThe verification phrase is cobalt lighthouse.`n"
    git -C $missionWorkspace init --quiet
    git -C $missionWorkspace config user.email "fixture@example.invalid"
    git -C $missionWorkspace config user.name "Fixture"
    git -C $missionWorkspace add README.md
    git -C $missionWorkspace commit --quiet -m "fixture"
    $beforeHash = (Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash
  }

  if ($RunReadOnlyMission) {
    $missionBody = @{
      name = "PhantomForce real read-only verification"
      objective = "Read README.md and report the verification phrase. Do not modify files or run network tools. Finish using the required TERMINA_EVENT protocol."
      workspaceRoot = $missionWorkspace
      launchMode = "plan"
      roles = @(@{
        name = "Read-only verifier"
        scope = "Inspect README.md only and report the phrase."
        deliverables = @("The exact verification phrase and evidence that no file was modified.")
        prohibited = @("Any file write", "Any network request", "Any command that changes repository state")
        provider = "codex"
      })
    } | ConvertTo-Json -Depth 8
    $created = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/missions" -Headers $headers -ContentType "application/json" -Body $missionBody -TimeoutSec 20
    $missionId = $created.mission.id
    $missionWorkerId = $created.mission.workers[0].id
    $missionDeadline = (Get-Date).AddSeconds($MissionTimeoutSeconds)
    $terminalEvent = $null
    do {
      Start-Sleep -Seconds 2
      $missionState = Invoke-RestMethod -Uri "$baseUrl/api/missions/$missionId" -Headers $headers -TimeoutSec 5
      $terminalEvent = @($missionState.ledger | Where-Object { $_.type -in @("COMPLETE", "FAILED") }) | Select-Object -Last 1
    } while (-not $terminalEvent -and (Get-Date) -lt $missionDeadline)

    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/missions/$missionId/workers/$missionWorkerId/stop" -Headers $headers -TimeoutSec 5 | Out-Null
    $afterHash = (Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash
    $lastDetail = [string](@($missionState.ledger)[-1].detail)
    $blockerCategory = if ($lastDetail -match "trust|folder|workspace") {
      "workspace_trust"
    } elseif ($lastDetail -match "approval|confirm|permission") {
      "approval_or_permission"
    } elseif ($lastDetail -match "login|auth|credential|account") {
      "authentication"
    } elseif ($lastDetail) {
      "other_redacted"
    } else {
      "no_detail"
    }
    $missionProof = [pscustomobject]@{
      MissionCreated = [bool]$missionId
      MissionId = $missionId
      LaunchMode = $created.mission.launchMode
      Provider = $created.mission.workers[0].provider
      TerminalEvent = if ($terminalEvent) { $terminalEvent.type } else { "timeout" }
      LedgerEvents = @($missionState.ledger).Count
      LedgerEventTypes = @($missionState.ledger | ForEach-Object { $_.type })
      WorkerStatus = $missionState.mission.workers[0].status
      BlockerCategory = $blockerCategory
      FixtureUnchanged = $beforeHash -eq $afterHash
    }
  }

  if ($RunApprovedDispatch) {
    $env:PHANTOMFORCE_TERMINA_WORKSPACE_ROOT = $missionWorkspace
    $env:PHANTOM_AGENT_RUNS_LOG_PATH = Join-Path $scratch "phantomforce-runs.jsonl"
    $env:PHANTOM_AGENT_RUN_ARTIFACTS_DIR = Join-Path $scratch "phantomforce-artifacts"
    $env:PHANTOM_HERMES_LEDGER_PATH = Join-Path $scratch "phantomforce-ledger.jsonl"
    $approvedOutput = & node "node_modules/tsx/dist/cli.mjs" "server/scripts/test-termina-live-approved-dispatch.ts"
    if ($LASTEXITCODE -ne 0) { throw "phantomforce_termina_approved_dispatch_failed" }
    $approvedDispatchProof = $approvedOutput | ConvertFrom-Json
    $afterApprovedHash = (Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash
    $approvedDispatchProof | Add-Member -NotePropertyName FixtureUnchanged -NotePropertyValue ($beforeHash -eq $afterApprovedHash)
  }

  [pscustomobject]@{
    RealServer = $health.app
    Version = $health.version
    Host = $health.host
    Port = $health.port
    Listening = [bool]$listener
    OwningProcess = $listener.OwningProcess
    InvalidTokenStatus = $invalidStatus
    AuthenticatedHealth = [bool]$health.ok
    ReadOnlyReposReturned = @($repos.repos).Count
    AdapterAuthenticated = [bool]$adapter.adapterAuthenticated
    AdapterInvalidTokenRejected = [bool]$adapter.invalidTokenRejected
    AdapterReposReturned = [int]$adapter.reposReturned
    DisposableClone = $true
    ReadOnlyMission = $missionProof
    ApprovedDispatch = $approvedDispatchProof
  } | ConvertTo-Json -Compress
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
  if ($null -eq $priorToken) {
    Remove-Item Env:\TERMINA_TOKEN -ErrorAction SilentlyContinue
  } else {
    $env:TERMINA_TOKEN = $priorToken
  }
  if ($null -eq $priorPort) {
    Remove-Item Env:\TERMINA_PORT -ErrorAction SilentlyContinue
  } else {
    $env:TERMINA_PORT = $priorPort
  }

  $resolvedScratch = [System.IO.Path]::GetFullPath($scratch)
  if ($resolvedScratch.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedScratch -Leaf).StartsWith("termina-live-") -and (Test-Path -LiteralPath $resolvedScratch)) {
    for ($cleanupAttempt = 1; $cleanupAttempt -le 10; $cleanupAttempt += 1) {
      try {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force -ErrorAction Stop
        break
      } catch {
        if ($cleanupAttempt -eq 10) {
          Write-Warning "Disposable Termina clone cleanup remained locked after 10 attempts: $resolvedScratch"
        } else {
          Start-Sleep -Milliseconds 500
        }
      }
    }
  }
}
