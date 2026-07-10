<#
.SYNOPSIS
  Stops a locally running n8n process started via start-local.ps1.
  Run this yourself — PhantomForce never calls this script.
#>

$ErrorActionPreference = "SilentlyContinue"

$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'n8n' }

if (-not $procs) {
  Write-Host "No local n8n process found."
  exit 0
}

foreach ($proc in $procs) {
  Write-Host "Stopping n8n (PID $($proc.ProcessId))..."
  Stop-Process -Id $proc.ProcessId -Force
}

Write-Host "Done."
