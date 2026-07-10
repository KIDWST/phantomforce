<#
.SYNOPSIS
  Checks whether a local n8n instance is reachable on 127.0.0.1:5678.
  Read-only — makes one local HTTP request, changes nothing.
#>

$ErrorActionPreference = "SilentlyContinue"
$url = "http://127.0.0.1:5678"

try {
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
  Write-Host "n8n is reachable at $url (HTTP $($response.StatusCode))."
  exit 0
} catch {
  Write-Host "n8n is not reachable at $url."
  Write-Host "Start it with: .\start-local.ps1"
  exit 1
}
