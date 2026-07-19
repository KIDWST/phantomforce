[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRepo ".git"))) {
  throw "Evolution preflight requires the canonical Git checkout: $resolvedRepo"
}

function Invoke-Git([string[]]$Arguments) {
  $output = & git -C $resolvedRepo @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $output"
  }
  return (($output | Out-String).Trim())
}

function Test-Endpoint([string]$Uri, [bool]$Required) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 12
    return [ordered]@{
      uri = $Uri
      required = $Required
      ok = $response.StatusCode -eq 200
      status = $response.StatusCode
    }
  }
  catch {
    return [ordered]@{
      uri = $Uri
      required = $Required
      ok = $false
      status = $null
      error = $_.Exception.Message
    }
  }
}

$branch = Invoke-Git @("branch", "--show-current")
$head = Invoke-Git @("rev-parse", "HEAD")
$originUrl = Invoke-Git @("remote", "get-url", "origin")
$porcelain = Invoke-Git @("status", "--porcelain=v1")
$aheadBehind = Invoke-Git @("rev-list", "--left-right", "--count", "HEAD...origin/main")
$counts = $aheadBehind -split "\s+"

$endpoints = @(
  (Test-Endpoint "http://127.0.0.1:5177/health" $true),
  (Test-Endpoint "http://127.0.0.1:5190/health" $true),
  (Test-Endpoint "https://admin.phantomforce.online/health" $false),
  (Test-Endpoint "https://app.phantomforce.online/health" $false),
  (Test-Endpoint "https://phantomforce.online/" $false)
)

$requiredHealthy = @($endpoints | Where-Object { $_.required -and -not $_.ok }).Count -eq 0
$valid = $branch -eq "main" -and
  $originUrl -eq "https://github.com/KIDWST/phantomforce.git" -and
  $requiredHealthy

$result = [ordered]@{
  mission = "phantomforce-seven-day-evolution"
  checked_at = (Get-Date).ToString("o")
  valid = $valid
  repo_root = $resolvedRepo
  branch = $branch
  head = $head
  origin = $originUrl
  ahead = [int]$counts[0]
  behind = [int]$counts[1]
  working_tree_clean = [string]::IsNullOrWhiteSpace($porcelain)
  changed_paths = if ([string]::IsNullOrWhiteSpace($porcelain)) { @() } else { @($porcelain -split "`r?`n") }
  endpoints = $endpoints
}

$result | ConvertTo-Json -Depth 6
if (-not $valid) {
  exit 1
}
