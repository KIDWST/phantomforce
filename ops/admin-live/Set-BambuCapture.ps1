param([switch]$Disable)
$ErrorActionPreference = "Stop"
if (-not $env:LOCALAPPDATA) { throw "This connector requires the Windows user's local application-data folder." }
$configDirectory = Join-Path $env:LOCALAPPDATA "PhantomForce"
$configPath = Join-Path $configDirectory "bambu-capture.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$config = [ordered]@{ schemaVersion = 1; enabled = (-not [bool]$Disable); tenantId = "occasionally-odd" }
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding ascii
Write-Output "Bambu package capture $(if ($Disable) { 'disabled' } else { 'enabled' }) for Occasionally Odd. Restart the existing PhantomForce API to apply. No Windows service or scheduled task was created."
