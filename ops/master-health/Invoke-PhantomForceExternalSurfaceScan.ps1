param(
  [string[]]$Hosts = @(
    "phantomforce.online",
    "www.phantomforce.online",
    "admin.phantomforce.online",
    "app.phantomforce.online"
  ),
  [string]$VaultRoot = "C:\Users\jorda\Documents\Obsidian\PhantomForce-Command-Center"
)

$ErrorActionPreference = "Stop"

$ReportDir = Join-Path $VaultRoot "System Health"
$RuntimeDir = Join-Path $env:LOCALAPPDATA "PhantomForce\MasterHealth"
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$StartedAt = Get-Date
$Stamp = $StartedAt.ToString("yyyy-MM-dd_HHmmss")
$Today = $StartedAt.ToString("yyyy-MM-dd")
$Findings = New-Object System.Collections.Generic.List[object]

function Add-Finding {
  param(
    [ValidateSet("info", "warn", "error")]
    [string]$Level,
    [string]$HostName,
    [string]$Area,
    [string]$Message
  )
  $script:Findings.Add([pscustomobject]@{
    level = $Level
    host = $HostName
    area = $Area
    message = $Message
  }) | Out-Null
}

function Test-Http {
  param(
    [string]$Url,
    [int]$TimeoutSec = 18
  )
  $started = Get-Date
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec -MaximumRedirection 8 -Headers @{ "Cache-Control" = "no-cache" }
    $finalUrl = ""
    $contentType = ""
    $server = ""
    $hsts = ""
    $csp = ""
    $xContentType = ""
    $referrerPolicy = ""
    $permissionsPolicy = ""
    $xFrameOptions = ""
    try { $finalUrl = $response.BaseResponse.ResponseUri.AbsoluteUri } catch {}
    try { $contentType = $response.Headers["Content-Type"] } catch {}
    try { $server = $response.Headers["Server"] } catch {}
    try { $hsts = $response.Headers["Strict-Transport-Security"] } catch {}
    try { $csp = $response.Headers["Content-Security-Policy"] } catch {}
    try { $xContentType = $response.Headers["X-Content-Type-Options"] } catch {}
    try { $referrerPolicy = $response.Headers["Referrer-Policy"] } catch {}
    try { $permissionsPolicy = $response.Headers["Permissions-Policy"] } catch {}
    try { $xFrameOptions = $response.Headers["X-Frame-Options"] } catch {}
    return [pscustomobject]@{
      url = $Url
      ok = $true
      status = [int]$response.StatusCode
      ms = [int]((Get-Date) - $started).TotalMilliseconds
      final_url = $finalUrl
      content_type = $contentType
      server = $server
      headers = [pscustomobject]@{
        strict_transport_security = $hsts
        content_security_policy = $csp
        x_content_type_options = $xContentType
        referrer_policy = $referrerPolicy
        permissions_policy = $permissionsPolicy
        x_frame_options = $xFrameOptions
      }
      body_sample = if ($response.Content) { [string]$response.Content.Substring(0, [Math]::Min(240, $response.Content.Length)) } else { "" }
      error = ""
    }
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    return [pscustomobject]@{
      url = $Url
      ok = $false
      status = $status
      ms = [int]((Get-Date) - $started).TotalMilliseconds
      final_url = ""
      content_type = ""
      server = ""
      headers = [pscustomobject]@{}
      body_sample = ""
      error = $_.Exception.Message
    }
  }
}

function Get-TlsCertificate {
  param([string]$HostName)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect($HostName, 443, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(8000)) {
      throw "TLS connection timed out."
    }
    $client.EndConnect($connect)
    $stream = [System.Net.Security.SslStream]::new($client.GetStream(), $false, ({ $true } -as [Net.Security.RemoteCertificateValidationCallback]))
    $stream.AuthenticateAsClient($HostName)
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($stream.RemoteCertificate)
    $days = [math]::Round(($cert.NotAfter - (Get-Date)).TotalDays, 1)
    $stream.Dispose()
    $client.Dispose()
    return [pscustomobject]@{
      ok = $true
      subject = $cert.Subject
      issuer = $cert.Issuer
      not_before = $cert.NotBefore.ToString("o")
      not_after = $cert.NotAfter.ToString("o")
      days_remaining = $days
      thumbprint = $cert.Thumbprint
      error = ""
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      subject = ""
      issuer = ""
      not_before = ""
      not_after = ""
      days_remaining = $null
      thumbprint = ""
      error = $_.Exception.Message
    }
  }
}

function Get-DnsSnapshot {
  param([string]$HostName)
  $records = @()
  foreach ($type in "A", "AAAA", "CNAME") {
    try {
      $records += Resolve-DnsName -Name $HostName -Type $type -ErrorAction Stop |
        Select-Object @{Name = "type"; Expression = { $_.Type } }, Name, NameHost, IPAddress
    } catch {}
  }
  return @($records)
}

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port
  )
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    $open = $connect.AsyncWaitHandle.WaitOne(3500)
    if ($open) { $client.EndConnect($connect) }
    $client.Dispose()
    return [pscustomobject]@{ port = $Port; open = [bool]$open }
  } catch {
    return [pscustomobject]@{ port = $Port; open = $false }
  }
}

function Test-SensitivePath {
  param(
    [string]$HostName,
    [string]$Path
  )
  $url = "https://$HostName$Path"
  $result = Test-Http -Url $url -TimeoutSec 12
  $body = [string]$result.body_sample
  $looksSensitive = $body -match "(sk-|api[_-]?key|password|secret|token|BEGIN PRIVATE KEY|OPENROUTER|RESEND|ANTHROPIC|OWNER_LOGIN)"
  $fallbackHtml = $result.content_type -match "text/html" -and $body -match "<!doctype html|<title>PhantomForce"
  [pscustomobject]@{
    path = $Path
    status = $result.status
    ok = $result.ok
    final_url = $result.final_url
    content_type = $result.content_type
    sensitive_markers = [bool]$looksSensitive
    fallback_html = [bool]$fallbackHtml
    error = $result.error
  }
}

$hostReports = foreach ($hostName in $Hosts) {
  $dns = @(Get-DnsSnapshot -HostName $hostName)
  if ($dns.Count -eq 0) {
    Add-Finding warn $hostName "dns" "No A/AAAA/CNAME records resolved from this machine."
  }

  $ports = @(80, 443 | ForEach-Object { Test-TcpPort -HostName $hostName -Port $_ })
  if (-not (@($ports) | Where-Object { $_.port -eq 443 -and $_.open })) {
    Add-Finding error $hostName "port" "Port 443 is not reachable."
  }

  $http = Test-Http -Url "http://$hostName/"
  $https = Test-Http -Url "https://$hostName/"
  $tls = Get-TlsCertificate -HostName $hostName

  if (-not $https.ok) {
    Add-Finding error $hostName "https" "HTTPS failed: $($https.status) $($https.error)"
  }
  if ($tls.ok -and $tls.days_remaining -lt 21) {
    Add-Finding warn $hostName "tls" "TLS certificate expires in $($tls.days_remaining) days."
  }
  if (-not $tls.ok) {
    Add-Finding warn $hostName "tls" "TLS certificate could not be read: $($tls.error)"
  }

  if ($https.ok) {
    if (-not $https.headers.strict_transport_security) {
      Add-Finding warn $hostName "headers" "Missing Strict-Transport-Security header."
    }
    if (-not $https.headers.x_content_type_options) {
      Add-Finding info $hostName "headers" "Missing X-Content-Type-Options header."
    }
    if (-not $https.headers.referrer_policy) {
      Add-Finding info $hostName "headers" "Missing Referrer-Policy header."
    }
    if (-not $https.headers.content_security_policy) {
      Add-Finding info $hostName "headers" "Missing Content-Security-Policy header."
    }
  }

  $sensitivePaths = @(
    "/.env",
    "/.git/config",
    "/server/.env",
    "/app/.env",
    "/api/keys",
    "/phantom-ai/approvals/execute",
    "/sessions",
    "/health",
    "/readiness"
  )
  $pathResults = foreach ($path in $sensitivePaths) {
    Test-SensitivePath -HostName $hostName -Path $path
  }

  foreach ($pathResult in $pathResults) {
    if ($pathResult.sensitive_markers) {
      Add-Finding error $hostName "exposure" "$($pathResult.path) response contains sensitive-looking markers."
    }
    if ($pathResult.path -in @("/.env", "/.git/config", "/server/.env", "/app/.env", "/api/keys", "/phantom-ai/approvals/execute") -and $pathResult.status -eq 200) {
      if ($pathResult.fallback_html) {
        Add-Finding info $hostName "route hygiene" "$($pathResult.path) returns the app shell fallback, not secret content. Prefer hard 404/deny at the gateway."
      } else {
        Add-Finding error $hostName "exposure" "$($pathResult.path) is publicly reachable with HTTP 200."
      }
    }
    if ($pathResult.path -eq "/sessions" -and $pathResult.status -eq 200) {
      Add-Finding info $hostName "surface" "/sessions is public; verify it only exposes sanitized auth metadata."
    }
    if ($pathResult.path -eq "/health" -and $pathResult.status -eq 200 -and -not $pathResult.fallback_html) {
      Add-Finding info $hostName "surface" "/health is public; okay for uptime, but keep payload minimal."
    }
  }

  [pscustomobject]@{
    host = $hostName
    dns = $dns
    ports = $ports
    http = $http
    https = $https
    tls = $tls
    sensitive_paths = @($pathResults)
  }
}

$EndedAt = Get-Date
$findingArray = [object[]]$Findings.ToArray()
$warnCount = @($findingArray | Where-Object { $_.level -eq "warn" }).Count
$errorCount = @($findingArray | Where-Object { $_.level -eq "error" }).Count
$overall = if ($errorCount -gt 0) { "attention_required" } elseif ($warnCount -gt 0) { "watch" } else { "healthy" }

$report = [ordered]@{
  started_at = $StartedAt.ToString("o")
  ended_at = $EndedAt.ToString("o")
  duration_sec = [math]::Round([double]((New-TimeSpan -Start $StartedAt -End $EndedAt).TotalSeconds), 2)
  overall = $overall
  hosts = @($hostReports)
  findings = $findingArray
}

$jsonPath = Join-Path $RuntimeDir "$Stamp-external-surface.json"
$latestJson = Join-Path $RuntimeDir "latest-external-surface.json"
$mdPath = Join-Path $ReportDir "$Today-phantomforce-external-surface.md"
$latestMd = Join-Path $ReportDir "LATEST-phantomforce-external-surface.md"

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $latestJson -Encoding UTF8

$findingLines = if ($findingArray.Count) {
  ($findingArray | ForEach-Object { "- [$($_.level)] $($_.host) / $($_.area): $($_.message)" }) -join "`n"
} else {
  "- No findings."
}
$hostLines = ($hostReports | ForEach-Object {
  $cert = if ($_.tls.ok) { "$($_.tls.days_remaining) days left" } else { "TLS read failed" }
  "- $($_.host): HTTPS $($_.https.status), TLS $cert"
}) -join "`n"

$markdown = @"
# PhantomForce External Surface Scan - $($report.started_at)

Overall: $overall
Warnings: $warnCount
Errors: $errorCount

## Hosts
$hostLines

## Findings
$findingLines

## Scope
- DNS A/AAAA/CNAME lookup
- TCP 80/443 reachability
- HTTP/HTTPS status and redirects
- TLS certificate expiry
- Common security headers
- Sensitive path exposure probes

Read-only scan only. No brute force, credential attempts, exploit attempts, destructive actions, or secret storage.

## Files
- JSON: $jsonPath
- Latest JSON: $latestJson
"@

$markdown | Set-Content -LiteralPath $mdPath -Encoding UTF8
$markdown | Set-Content -LiteralPath $latestMd -Encoding UTF8

[pscustomobject]@{
  ok = ($overall -ne "attention_required")
  overall = $overall
  warnings = $warnCount
  errors = $errorCount
  report = $latestMd
  json = $latestJson
}
