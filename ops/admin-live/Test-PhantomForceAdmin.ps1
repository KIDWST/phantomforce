param(
  [string]$AdminUrl = "https://admin.phantomforce.online",
  [int]$FrontendPort = 5177,
  [int]$BackendPort = 5190
)

$ErrorActionPreference = "Stop"

function Read-Url {
  param([string]$Url)
  try {
    return Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 20
  } catch {
    return $_.Exception.Response
  }
}

$localFrontend = Read-Url "http://127.0.0.1:$FrontendPort/"
$localSessions = Read-Url "http://127.0.0.1:$FrontendPort/sessions"
$publicAdmin = Read-Url "$AdminUrl/"
$publicSessions = Read-Url "$AdminUrl/sessions"

$publicContent = if ($publicAdmin.Content) { [string]$publicAdmin.Content } else { "" }
$sessionContent = if ($publicSessions.Content) { [string]$publicSessions.Content } else { "" }

$frontendPid = Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess
$backendPid = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess

[pscustomobject]@{
  ok = ($localFrontend.StatusCode -eq 200) -and
    ($localSessions.StatusCode -eq 200) -and
    ($publicAdmin.StatusCode -eq 200) -and
    ($publicSessions.StatusCode -eq 200) -and
    (-not $publicContent.Contains("/@vite/client")) -and
    (-not $publicContent.Contains("/src/main.tsx")) -and
    $sessionContent.Contains("owner-production")
  localFrontendStatus = $localFrontend.StatusCode
  localSessionsStatus = $localSessions.StatusCode
  publicAdminStatus = $publicAdmin.StatusCode
  publicSessionsStatus = $publicSessions.StatusCode
  title = ([regex]::Match($publicContent, "<title>(.*?)</title>", "IgnoreCase").Groups[1].Value)
  servesProductionAssets = (-not $publicContent.Contains("/@vite/client")) -and (-not $publicContent.Contains("/src/main.tsx"))
  ownerProductionAuth = $sessionContent.Contains("owner-production")
  frontendProcess = $frontendPid
  backendProcess = $backendPid
}
