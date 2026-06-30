param(
  [switch]$FailOnDown
)

$ErrorActionPreference = "Stop"

$port = if ($env:N8N_PORT) { [int]$env:N8N_PORT } else { 5678 }
if ($port -lt 1 -or $port -gt 65535) {
  throw "N8N_PORT must be between 1 and 65535."
}

if ($env:N8N_LISTEN_ADDRESS -and $env:N8N_LISTEN_ADDRESS -ne "127.0.0.1") {
  throw "Health check is localhost-only. N8N_LISTEN_ADDRESS must be 127.0.0.1."
}

$url = "http://127.0.0.1:$port/healthz"
$running = $false
$statusCode = $null
$errorText = $null

try {
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
  $statusCode = [int]$response.StatusCode
  $running = $statusCode -ge 200 -and $statusCode -lt 500
} catch {
  $errorText = $_.Exception.Message
}

[pscustomobject]@{
  ok = $true
  running = $running
  url = $url
  localhost_only = $true
  status_code = $statusCode
  error = $errorText
  public_webhooks_allowed = $false
  credentials_allowed = $false
  external_actions_allowed = $false
} | ConvertTo-Json -Compress

if ($FailOnDown -and -not $running) {
  exit 1
}
