param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$Port = 5177,
  [string]$ApiOrigin = "",
  [switch]$StopExisting
)

$ErrorActionPreference = "Stop"

function Get-ListeningPids {
  param([int]$LocalPort)
  $pattern = "[:.]$LocalPort\s+.*LISTENING\s+(\d+)$"
  netstat -ano | Select-String -Pattern $pattern | ForEach-Object {
    [int]$_.Matches[0].Groups[1].Value
  } | Sort-Object -Unique
}

$repo = (Resolve-Path $RepoRoot).Path
$server = Join-Path $PSScriptRoot "admin-static-server.mjs"
if (!(Test-Path -LiteralPath $server)) {
  throw "Missing static server: $server"
}

$node = (Get-Command node -ErrorAction Stop).Source
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\admin-live"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$existing = @(Get-ListeningPids -LocalPort $Port)
if ($existing.Count -gt 0) {
  if (!$StopExisting) {
    Write-Output "Port $Port is already in use by PID(s): $($existing -join ', ')"
    exit 0
  }
  foreach ($listenerPid in $existing) {
    if ($listenerPid -ne $PID) {
      Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 600
}

$stdout = Join-Path $stateDir "admin-static.out.log"
$stderr = Join-Path $stateDir "admin-static.err.log"
$args = @($server, "--root", $repo, "--port", [string]$Port, "--host", "127.0.0.1")
if (![string]::IsNullOrWhiteSpace($ApiOrigin)) {
  $args += @("--api", $ApiOrigin)
}

# Admin live is the owner workstation surface. Keep Hermes as the primary
# broker, but allow the owner-approved Higgsfield CLI fallback so Media Lab can
# produce real renders when the Hermes/MCP draft lane is unavailable. The
# server still requires an admin bearer session and an explicit approved:true
# render request before any credits can be spent.
$oldFallback = $env:HIGGSFIELD_CLI_FALLBACK_ENABLED
$oldPath = $env:PATH
if ([string]::IsNullOrWhiteSpace($env:HIGGSFIELD_CLI_FALLBACK_ENABLED)) {
  $env:HIGGSFIELD_CLI_FALLBACK_ENABLED = "true"
}
$hermesNode = Join-Path $env:LOCALAPPDATA "hermes\node"
if ((Test-Path -LiteralPath $hermesNode) -and ($env:PATH -notlike "*$hermesNode*")) {
  $env:PATH = "$hermesNode;$env:PATH"
}

try {
  $proc = Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} finally {
  $env:HIGGSFIELD_CLI_FALLBACK_ENABLED = $oldFallback
  $env:PATH = $oldPath
}
$pidFile = Join-Path $stateDir "admin-static.pid"
Set-Content -LiteralPath $pidFile -Value ([string]$proc.Id) -Encoding ascii

Start-Sleep -Milliseconds 800
$active = @(Get-ListeningPids -LocalPort $Port)
if ($active -notcontains $proc.Id) {
  throw "Admin static server did not bind port $Port. Check $stderr"
}

Write-Output "PhantomForce admin static server started on 127.0.0.1:$Port from $repo (PID $($proc.Id))"
