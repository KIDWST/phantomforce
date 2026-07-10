<#
.SYNOPSIS
  Starts a local n8n instance bound to 127.0.0.1:5678, for manual workflow
  drafting only. Run this yourself — PhantomForce never calls this script.

.DESCRIPTION
  Loads .env from this folder (copy .env.example to .env first) and runs
  n8n via npx so a global install isn't required. Ctrl+C to stop, or use
  stop-local.ps1 from another terminal.
#>

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$envFile = Join-Path $root ".env"

if (Test-Path $envFile) {
  Write-Host "Loading $envFile"
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $name, $value = $_ -split '=', 2
    [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim())
  }
} else {
  Write-Warning "No .env found at $envFile — copy .env.example to .env first. Using n8n defaults (still localhost-only)."
}

Write-Host "Starting n8n on http://127.0.0.1:5678 (Ctrl+C to stop)..."
npx n8n start
