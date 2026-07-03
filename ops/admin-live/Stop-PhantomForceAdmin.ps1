param(
  [int]$FrontendPort = 5177,
  [int]$BackendPort = 5190
)

$ErrorActionPreference = "Stop"

foreach ($port in @($FrontendPort, $BackendPort)) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $processIdToStop = [int]$listener.OwningProcess
    if ($processIdToStop) {
      Stop-Process -Id $processIdToStop -Force
    }
  }
}

[pscustomobject]@{
  ok = $true
  stoppedPorts = @($FrontendPort, $BackendPort)
}
