param(
  [string]$AdminUrl = "https://admin.phantomforce.online",
  [int]$FrontendPort = 5177,
  [int]$BackendPort = 5190
)

$ErrorActionPreference = "Stop"

function Read-Url {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 20
    return [pscustomobject]@{ ok = $true; status = $response.StatusCode; content = [string]$response.Content; error = "" }
  } catch {
    $status = $null
    $content = ""
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $content = $reader.ReadToEnd()
      } catch {}
    }
    return [pscustomobject]@{ ok = $false; status = $status; content = $content; error = $_.Exception.Message }
  }
}

$localFrontend = Read-Url "http://127.0.0.1:$FrontendPort/"
$localAdminApp = Read-Url "http://127.0.0.1:$FrontendPort/app/?session=admin"
$localSessions = Read-Url "http://127.0.0.1:$FrontendPort/sessions"
$publicAdmin = Read-Url "$AdminUrl/"
$publicSessions = Read-Url "$AdminUrl/sessions"

$publicContent = $publicAdmin.content
$sessionContent = $publicSessions.content

$frontendPid = Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess
$backendPid = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess

[pscustomobject]@{
  ok = ($localFrontend.status -eq 200) -and
    ($localAdminApp.status -eq 200) -and
    ($localSessions.status -eq 200) -and
    ($publicAdmin.status -eq 200) -and
    ($publicSessions.status -eq 200) -and
    (-not $publicContent.Contains("/@vite/client")) -and
    (-not $publicContent.Contains("/src/main.tsx")) -and
    $sessionContent.Contains("owner-production")
  localOk = ($localFrontend.status -eq 200) -and ($localAdminApp.status -eq 200) -and ($localSessions.status -eq 200)
  publicOk = ($publicAdmin.status -eq 200) -and ($publicSessions.status -eq 200)
  localFrontendStatus = $localFrontend.status
  localAdminAppStatus = $localAdminApp.status
  localSessionsStatus = $localSessions.status
  publicAdminStatus = $publicAdmin.status
  publicSessionsStatus = $publicSessions.status
  publicAdminError = $publicAdmin.error
  publicSessionsError = $publicSessions.error
  title = ([regex]::Match($publicContent, "<title>(.*?)</title>", "IgnoreCase").Groups[1].Value)
  servesProductionAssets = (-not $publicContent.Contains("/@vite/client")) -and (-not $publicContent.Contains("/src/main.tsx"))
  ownerProductionAuth = $sessionContent.Contains("owner-production")
  frontendProcess = $frontendPid
  backendProcess = $backendPid
}
