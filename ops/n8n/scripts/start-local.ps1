$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$localDir = Join-Path $root ".local"
$pidPath = Join-Path $localDir "n8n.pid"
$port = if ($env:N8N_PORT) { [int]$env:N8N_PORT } else { 5678 }

if ($port -lt 1 -or $port -gt 65535) {
  throw "N8N_PORT must be between 1 and 65535."
}

if ($env:N8N_LISTEN_ADDRESS -and $env:N8N_LISTEN_ADDRESS -ne "127.0.0.1") {
  throw "Refusing to start n8n unless N8N_LISTEN_ADDRESS is 127.0.0.1."
}

function Resolve-N8nCommand {
  if ($env:PHANTOM_N8N_COMMAND) {
    return $env:PHANTOM_N8N_COMMAND
  }

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
  $localCandidate = Join-Path $repoRoot "node_modules\.bin\n8n.cmd"
  if (Test-Path -LiteralPath $localCandidate) {
    return $localCandidate
  }

  $global = Get-Command n8n.cmd -ErrorAction SilentlyContinue
  if ($global) {
    return $global.Source
  }

  $globalNoCmd = Get-Command n8n -ErrorAction SilentlyContinue
  if ($globalNoCmd) {
    return $globalNoCmd.Source
  }

  return $null
}

$n8nCommand = Resolve-N8nCommand
if (-not $n8nCommand) {
  throw "n8n command not found. Install n8n locally only after approval, or set PHANTOM_N8N_COMMAND to an existing n8n executable."
}

$existingPort = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existingPort) {
  throw "Port 127.0.0.1:$port is already listening."
}

New-Item -ItemType Directory -Force -Path $localDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $localDir "user-folder") | Out-Null

$env:N8N_LISTEN_ADDRESS = "127.0.0.1"
$env:N8N_HOST = "127.0.0.1"
$env:N8N_PORT = "$port"
$env:N8N_PROTOCOL = "http"
$env:N8N_SECURE_COOKIE = "false"
$env:N8N_DIAGNOSTICS_ENABLED = "false"
$env:N8N_PERSONALIZATION_ENABLED = "false"
$env:N8N_VERSION_NOTIFICATIONS_ENABLED = "false"
$env:N8N_TEMPLATES_ENABLED = "false"
$env:N8N_USER_FOLDER = Join-Path $localDir "user-folder"
$env:PHANTOM_N8N_PUBLIC_WEBHOOKS_ALLOWED = "false"
$env:PHANTOM_N8N_CREDENTIALS_ALLOWED = "false"
$env:PHANTOM_N8N_EXTERNAL_ACTIONS_ALLOWED = "false"
$env:PHANTOM_N8N_APPROVAL_EXECUTION_ALLOWED = "false"
$env:PHANTOM_N8N_QUEUE_WRITES_ALLOWED = "false"
$env:PHANTOM_N8N_PRODUCTION_LEDGER_WRITES_ALLOWED = "false"

$process = Start-Process `
  -FilePath $n8nCommand `
  -ArgumentList @("start") `
  -WorkingDirectory $root `
  -PassThru `
  -WindowStyle Hidden

Set-Content -LiteralPath $pidPath -Value "$($process.Id)" -Encoding ASCII

[pscustomobject]@{
  ok = $true
  pid = $process.Id
  url = "http://127.0.0.1:$port"
  listen_address = "127.0.0.1"
  pid_path = $pidPath
  public_webhooks_allowed = $false
  credentials_allowed = $false
  external_actions_allowed = $false
} | ConvertTo-Json -Compress
