param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$LogRoot = "C:\Users\jorda\Documents\Obsidian\PhantomForce-Command-Center\System Health",
  [switch]$SkipPublic
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date
$stamp = $timestamp.ToString("yyyy-MM-dd_HHmmss")
$reportName = "phantomforce-morning-audit-$stamp"
$jsonPath = Join-Path $LogRoot "$reportName.json"
$mdPath = Join-Path $LogRoot "$reportName.md"
$latestPath = Join-Path $LogRoot "LATEST-phantomforce-morning-audit.md"

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Test-Url {
  param([string]$Url, [int]$TimeoutSec = 8)
  $started = Get-Date
  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing
    [pscustomobject]@{
      url = $Url
      ok = $true
      status = [int]$response.StatusCode
      ms = [int]((Get-Date) - $started).TotalMilliseconds
      error = $null
    }
  } catch {
    [pscustomobject]@{
      url = $Url
      ok = $false
      status = 0
      ms = [int]((Get-Date) - $started).TotalMilliseconds
      error = $_.Exception.Message
    }
  }
}

function Get-Prop {
  param($Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  return $prop.Value
}

Push-Location $RepoRoot
try {
  $branch = (git branch --show-current).Trim()
  $head = (git rev-parse --short HEAD).Trim()
  $dirtyLines = @(git status --short)
  $dirty = $dirtyLines.Count -gt 0
  $trackedDirty = @($dirtyLines | Where-Object { $_ -notmatch '^\?\?' })
  $untracked = @($dirtyLines | Where-Object { $_ -match '^\?\?' })

  $local = @()
  $local += Test-Url "http://127.0.0.1:5177/health"
  $local += Test-Url "http://127.0.0.1:5190/health"
  $local += Test-Url "http://127.0.0.1:5190/sessions"

  $public = @()
  if (!$SkipPublic) {
    $public = @()
    $public += Test-Url "https://phantomforce.online"
    $public += Test-Url "https://admin.phantomforce.online"
    $public += Test-Url "https://app.phantomforce.online"
  }

  $sessionsRaw = $null
  try {
    $sessionsRaw = Invoke-RestMethod -Uri "http://127.0.0.1:5190/sessions" -TimeoutSec 8
  } catch {}

  $warnings = New-Object System.Collections.Generic.List[string]
  $errors = New-Object System.Collections.Generic.List[string]

  if ($dirty) { $warnings.Add("Git worktree has $($dirtyLines.Count) dirty/untracked line(s).") }
  if ($trackedDirty.Count -gt 0) { $errors.Add("Tracked files are dirty: $($trackedDirty.Count).") }
  foreach ($check in $local) {
    if (!$check.ok) { $errors.Add("Local endpoint failed: $($check.url)") }
  }
  foreach ($check in $public) {
    if (!$check.ok) { $warnings.Add("Public endpoint failed or timed out: $($check.url)") }
  }
  $authMeta = Get-Prop $sessionsRaw "auth"

  if ((Get-Prop $authMeta "ownerProductionAuthEnabled") -ne $true) {
    $warnings.Add("Owner-production auth is not reported as enabled.")
  }
  if ((Get-Prop $authMeta "ownerLoginKeyConfigured") -ne $true) {
    $errors.Add("Owner login key is not loaded by backend auth.")
  }

  $overall = if ($errors.Count -gt 0) { "FAIL" } elseif ($warnings.Count -gt 0) { "WARN" } else { "PASS" }

  $result = [pscustomobject]@{
    ok = $overall -ne "FAIL"
    overall = $overall
    timestamp = $timestamp.ToString("o")
    repo = $RepoRoot
    branch = $branch
    head = $head
    git = [pscustomobject]@{
      dirty = $dirty
      dirty_count = $dirtyLines.Count
      tracked_dirty_count = $trackedDirty.Count
      untracked_count = $untracked.Count
      status_lines = $dirtyLines
    }
    auth = [pscustomobject]@{
      provider = Get-Prop $authMeta "authProvider"
      owner_production = Get-Prop $authMeta "ownerProductionAuthEnabled"
      owner_email_configured = Get-Prop $authMeta "ownerEmailConfigured"
      owner_key_configured = Get-Prop $authMeta "ownerLoginKeyConfigured"
      session_secret_strong = Get-Prop $authMeta "sessionSecretIsStrong"
    }
    local = $local
    public = $public
    warnings = @($warnings)
    errors = @($errors)
  }

  $result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path $jsonPath

  $displayTimestamp = $timestamp.ToString('yyyy-MM-dd HH:mm:ss')
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# PhantomForce Morning Audit - $displayTimestamp")
  $lines.Add("")
  $lines.Add("Overall: **$overall**")
  $lines.Add("")
  $lines.Add("## Repo")
  $lines.Add("- Path: $RepoRoot")
  $lines.Add("- Branch: $branch")
  $lines.Add("- HEAD: $head")
  $lines.Add("- Dirty: $dirty ($($dirtyLines.Count) line(s); tracked: $($trackedDirty.Count); untracked: $($untracked.Count))")
  if ($dirtyLines.Count -gt 0) {
    $lines.Add("")
    $lines.Add("### Dirty Lines")
    foreach ($line in $dirtyLines) { $lines.Add("- $line") }
  }
  $lines.Add("")
  $lines.Add("## Local Endpoints")
  foreach ($check in $local) { $lines.Add("- $($check.url): $($check.status) in $($check.ms)ms; ok=$($check.ok)") }
  if ($public.Count -gt 0) {
    $lines.Add("")
    $lines.Add("## Public Endpoints")
    foreach ($check in $public) { $lines.Add("- $($check.url): $($check.status) in $($check.ms)ms; ok=$($check.ok)") }
  }
  $lines.Add("")
  $lines.Add("## Auth Metadata")
  $lines.Add("- Provider: $($result.auth.provider)")
  $lines.Add("- Owner production auth: $($result.auth.owner_production)")
  $lines.Add("- Owner email configured: $($result.auth.owner_email_configured)")
  $lines.Add("- Owner key configured: $($result.auth.owner_key_configured)")
  $lines.Add("- Session secret strong: $($result.auth.session_secret_strong)")
  if ($warnings.Count -gt 0) {
    $lines.Add("")
    $lines.Add("## Warnings")
    foreach ($warning in $warnings) { $lines.Add("- $warning") }
  }
  if ($errors.Count -gt 0) {
    $lines.Add("")
    $lines.Add("## Errors")
    foreach ($err in $errors) { $lines.Add("- $err") }
  }
  $lines.Add("")
  $lines.Add("No plaintext passwords, API keys, cookies, or tokens are written by this report.")

  $lines | Set-Content -Encoding UTF8 -Path $mdPath
  Copy-Item -Force -Path $mdPath -Destination $latestPath

  Write-Output "Overall: $overall"
  Write-Output "Report: $mdPath"
  Write-Output "Latest: $latestPath"
  if ($overall -eq "FAIL") { exit 2 }
  if ($overall -eq "WARN") { exit 1 }
  exit 0
} finally {
  Pop-Location
}
