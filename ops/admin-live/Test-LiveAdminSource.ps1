param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$AdminUrl = "https://admin.phantomforce.online/app/index.html",
  [int]$AdminPort = 5177,
  [int]$HermesPort = 5190,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Section {
  param([string]$Name)
  Write-Host ""
  Write-Host "== $Name ==" -ForegroundColor Cyan
}

function Result {
  param(
    [ValidateSet("OK", "WARN", "FAIL")][string]$State,
    [string]$Message
  )
  $color = switch ($State) {
    "OK" { "Green" }
    "WARN" { "Yellow" }
    default { "Red" }
  }
  Write-Host ("[{0}] {1}" -f $State, $Message) -ForegroundColor $color
  return $State
}

function Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $output = & git.exe -C $RepoRoot @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed: $output"
  }
  if ($null -eq $output) { return "" }
  return ($output -join "`n")
}

function FirstBuildId {
  param([string]$Text)
  $match = [regex]::Match($Text, "phantom-live-[0-9]{8}-[0-9]+")
  if ($match.Success) { return $match.Value }
  return $null
}

$states = New-Object System.Collections.Generic.List[string]

Section "Canonical checkout"
$branch = (Git rev-parse --abbrev-ref HEAD).Trim()
$head = (Git rev-parse HEAD).Trim()
$originHead = (Git rev-parse origin/main).Trim()
$ahead = [int](Git rev-list --count origin/main..HEAD).Trim()
$behind = [int](Git rev-list --count HEAD..origin/main).Trim()
$dirty = (Git status --porcelain).Trim()

$states.Add((Result ($(if ($branch -eq "main") { "OK" } else { "FAIL" })) "Branch: $branch"))
$states.Add((Result ($(if ($head -eq $originHead) { "OK" } elseif ($behind -gt 0) { "FAIL" } else { "WARN" })) "HEAD: $($head.Substring(0, 7)) / origin: $($originHead.Substring(0, 7)) / ahead $ahead / behind $behind"))
$states.Add((Result ($(if ($dirty) { "WARN" } else { "OK" })) ($(if ($dirty) { "Working tree has local changes." } else { "Working tree clean." }))))

Section "Admin sync manifest"
$manifestPath = Join-Path $RepoRoot "app\.phantomforce-sync.json"
if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifestCommit = [string]$manifest.commit
  $manifestStatus = [string]$manifest.sync_status
  $manifestSource = [string]$manifest.source
  $manifestReason = ""
  if ($manifest.sync_reason) { $manifestReason = " - $($manifest.sync_reason)" }
  $states.Add((Result ($(if ($manifestCommit -eq $head) { "OK" } else { "FAIL" })) "Manifest commit: $($manifestCommit.Substring(0, [Math]::Min(7, $manifestCommit.Length)))"))
  $states.Add((Result ($(if ($manifestStatus -eq "ok") { "OK" } else { "FAIL" })) "Sync status: $manifestStatus$manifestReason"))
  $states.Add((Result ($(if ($manifestSource -like "$RepoRoot*") { "OK" } else { "FAIL" })) "Serving source: $manifestSource"))
} else {
  $states.Add((Result "FAIL" "Missing app\\.phantomforce-sync.json. Run ops\\admin-live\\Sync-AdminMain.ps1."))
}

Section "Build IDs"
$indexPath = Join-Path $RepoRoot "app\index.html"
$localIndex = Get-Content -LiteralPath $indexPath -Raw
$localBuild = FirstBuildId $localIndex
$states.Add((Result ($(if ($localBuild) { "OK" } else { "FAIL" })) "Local app/index.html build: $localBuild"))
try {
  $liveHtml = (Invoke-WebRequest -UseBasicParsing -Uri $AdminUrl -TimeoutSec 20).Content
  $liveBuild = FirstBuildId $liveHtml
  $states.Add((Result ($(if ($liveBuild -eq $localBuild) { "OK" } else { "FAIL" })) "Live admin build: $liveBuild"))
} catch {
  $states.Add((Result "WARN" "Could not fetch $AdminUrl - $($_.Exception.Message)"))
}

Section "Running services"
try {
  $uiHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$AdminPort/health" -TimeoutSec 8
  $uiRoot = [string]$uiHealth.root
  if (-not $uiRoot) { $uiRoot = [string]$uiHealth.repo_root }
  $states.Add((Result ($(if ($uiRoot -and $uiRoot -like "$RepoRoot*") { "OK" } elseif ($uiRoot) { "FAIL" } else { "WARN" })) "Admin static root: $uiRoot"))
} catch {
  $states.Add((Result "WARN" "Admin static server on $AdminPort did not answer /health."))
}
try {
  $hermesHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$HermesPort/health" -TimeoutSec 8
  $hermesCommit = [string]$hermesHealth.commit
  $states.Add((Result ($(if ($hermesCommit -eq $head) { "OK" } elseif ($hermesCommit) { "FAIL" } else { "WARN" })) "Hermes commit: $hermesCommit"))
} catch {
  $states.Add((Result "WARN" "Hermes/backend on $HermesPort did not answer /health."))
}

Section "Change memory guard"
$guardPath = Join-Path $RepoRoot "scripts\guard-change-memory.mjs"
if (Test-Path -LiteralPath $guardPath) {
  $guardOutput = & node.exe $guardPath --repo-root $RepoRoot --live --admin-port $AdminPort --hermes-port $HermesPort 2>&1
  $guardExit = $LASTEXITCODE
  $guardSummary = (($guardOutput | ForEach-Object { [string]$_ }) -join " ")
  if ([string]::IsNullOrWhiteSpace($guardSummary)) { $guardSummary = "no output" }
  if ($guardSummary.Length -gt 260) { $guardSummary = $guardSummary.Substring(0, 260) }
  $states.Add((Result ($(if ($guardExit -eq 0) { "OK" } else { "FAIL" })) $guardSummary))
} else {
  $states.Add((Result "FAIL" "Missing scripts\\guard-change-memory.mjs. Accepted/rejected owner decisions are not protected."))
}

Section "Sidebar guardrail"
$customization = Get-Content -LiteralPath (Join-Path $RepoRoot "app\js\customization.js") -Raw
$main = Get-Content -LiteralPath (Join-Path $RepoRoot "app\js\main.js") -Raw
$index = Get-Content -LiteralPath (Join-Path $RepoRoot "app\index.html") -Raw
$states.Add((Result ($(if ($customization -match 'STRUCTURAL_NAV_MODULES = new Set\(\["memory", "settings", "developer", "vacation"\]\)' -and $customization -match 'navZone: "bottom"') { "OK" } else { "FAIL" })) "Customization cannot move Settings / Developer / Away Mode out of the bottom utility zone."))
$states.Add((Result ($(if ($index -match 'data-nav-bottom' -and $main -match 'navZone: "bottom"' -and $main -match 'data-nav-bottom') { "OK" } else { "FAIL" })) "Main shell renders a dedicated bottom sidebar nav."))

Section "Other worktrees that can fool agents"
$worktrees = @()
$current = $null
git.exe -C $RepoRoot worktree list --porcelain | ForEach-Object {
  if ($_ -like "worktree *") {
    if ($current) { $worktrees += $current }
    $current = [ordered]@{ Path = $_.Substring(9) }
  } elseif ($_ -like "branch *" -and $current) {
    $current.Branch = $_.Substring(7) -replace '^refs/heads/', ''
  } elseif ($_ -like "HEAD *" -and $current) {
    $current.Head = $_.Substring(5)
  }
}
if ($current) { $worktrees += $current }

foreach ($wt in $worktrees) {
  $path = [string]$wt.Path
  if (-not (Test-Path -LiteralPath (Join-Path $path ".git"))) { continue }
  $resolvedWorktree = (Resolve-Path -LiteralPath $path).Path
  Push-Location $path
  try {
    $wtAhead = (& git.exe rev-list --count origin/main..HEAD 2>$null)
    $wtBehind = (& git.exe rev-list --count HEAD..origin/main 2>$null)
    $wtDirty = (& git.exe status --porcelain)
    if ($resolvedWorktree -ne $RepoRoot -and (($wtAhead -and [int]$wtAhead -gt 0) -or ($wtBehind -and [int]$wtBehind -gt 20) -or $wtDirty)) {
      $states.Add((Result "WARN" "$path [$($wt.Branch)] ahead $wtAhead / behind $wtBehind / dirty $(if ($wtDirty) { "yes" } else { "no" })"))
    }
  } finally {
    Pop-Location
  }
}

Section "Verdict"
if ($states -contains "FAIL") {
  Result "FAIL" "Live admin source is not fully aligned. Do not claim changes are live until this is fixed."
  if ($Strict) { exit 1 }
} elseif ($states -contains "WARN") {
  Result "WARN" "Live admin is usable, but there are stale sibling worktrees or service warnings that can mislead agents."
  if ($Strict) { exit 2 }
} else {
  Result "OK" "Live admin source, sync manifest, services, and build IDs agree."
}
