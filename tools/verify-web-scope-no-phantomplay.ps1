param(
  [string]$ManifestPath = (Join-Path $PSScriptRoot "phantomplay-scope-baseline.json"),
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$failures = [System.Collections.Generic.List[string]]::new()

function Invoke-RepoGit {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git -c "safe.directory=$repo" -C $repo @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return @($output)
}

function Normalize-RepoPath([string]$Path) {
  return ($Path -replace "\\", "/").Trim()
}

function Count-ExactText([string]$Haystack, [string]$Needle) {
  if ([string]::IsNullOrEmpty($Needle)) { return 0 }
  $count = 0
  $offset = 0
  while (($offset = $Haystack.IndexOf($Needle, $offset, [StringComparison]::Ordinal)) -ge 0) {
    $count += 1
    $offset += $Needle.Length
  }
  return $count
}

$baseline = [string]$manifest.baseline_commit
$null = Invoke-RepoGit -Arguments @("cat-file", "-e", "$baseline^{commit}")

foreach ($entry in $manifest.frozen_fingerprints.PSObject.Properties) {
  $actual = (Invoke-RepoGit -Arguments @("rev-parse", "$baseline`:$($entry.Name)") | Select-Object -First 1).Trim()
  if ($actual -ne [string]$entry.Value) {
    $failures.Add("Baseline fingerprint mismatch for $($entry.Name): expected $($entry.Value), found $actual")
  }
}

$changed = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($path in Invoke-RepoGit -Arguments @("diff", "--name-only", "--no-renames", $baseline, "--")) {
  if ($path) { $null = $changed.Add((Normalize-RepoPath $path)) }
}
foreach ($path in Invoke-RepoGit -Arguments @("ls-files", "--others", "--exclude-standard")) {
  if ($path) { $null = $changed.Add((Normalize-RepoPath $path)) }
}

$frozenPatterns = @(
  '^app/assets/phantomplay/',
  '^app/games/',
  '^app/js/phantomplay(?:-v2)?\.js$',
  '^app/phantomplay(?:-v2)?\.css$',
  '^packages/(?:phantomplay|phantom-games)[^/]*/',
  '^server/scripts/[^/]*phantomplay[^/]*$',
  '^server/src/(?:phantom-ai/phantomplay[^/]*|phantomplay[^/]*)$',
  '^scripts/(?:test-phantom-games[^/]*|test-phantomplay[^/]*|test-game-runtime-visuals\.mjs)$',
  '^docs/(?:PHANTOMPLAY|architecture/PHANTOMPLAY|quality/PHANTOMPLAY)[^/]*',
  '^docs/superpowers/.*(?:phantomplay|cubetown|phantom-ages|phantom-strike|phantom-legends|vespergate)',
  '^tmp/phantomplay',
  '(^|/)(?:CandidateBuilds|CubeTown|PhantomAges|PhantomStrike|PhantomLegends)(/|$)',
  '(?:\.uproject$|unreal|unity)',
  '^(?:phantomplay|cubetown)[^/]*\.(?:png|jpg|jpeg|webp|zip)$'
)

foreach ($path in $changed) {
  foreach ($pattern in $frozenPatterns) {
    if ($path -match $pattern) {
      $failures.Add("Frozen PhantomPlay/game path changed: $path")
      break
    }
  }
}

foreach ($contract in $manifest.nav_contracts) {
  $fullPath = Join-Path $repo ([string]$contract.path)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    $failures.Add("Navigation contract file is missing: $($contract.path)")
    continue
  }
  $source = Get-Content -LiteralPath $fullPath -Raw
  $actualCount = Count-ExactText $source ([string]$contract.text)
  if ($actualCount -ne [int]$contract.count) {
    $failures.Add("PhantomPlay navigation contract changed in $($contract.path): expected $($contract.count) exact occurrence(s), found $actualCount")
  }
}

$mainSource = Get-Content -LiteralPath (Join-Path $repo "app/js/main.js") -Raw
$profileNames = @("business", "athlete", "developer", "coach", "sports_management", "agency", "education")
foreach ($profile in $profileNames) {
  $profilePattern = '(?m)^  {0}: new Set\(\[[^\r\n]*"phantomplay"[^\r\n]*\]\),\r?$' -f [regex]::Escape($profile)
  if ($mainSource -notmatch $profilePattern) {
    $failures.Add("PhantomPlay profile visibility contract changed for profile: $profile")
  }
}

$forbiddenBuildPattern = '(?i)(Build-Flagships\.ps1|Smoke-Flagships\.ps1|PhantomGames\.uproject|UnrealBuildTool|RunUAT(?:\.bat)?|Unity(?:\.exe)?[^\r\n]*-batchmode|cargo[^\r\n]*(?:phantomplay|phantom-games)|(?:npm|pnpm|yarn)[^\r\n]*(?:build|package)[^\r\n]*(?:phantomplay|phantom-games))'
$textExtensions = @('.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.ps1', '.cmd', '.bat', '.sh', '.yml', '.yaml')
$tracked = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($trackedPath in Invoke-RepoGit -Arguments @("ls-files")) {
  if ($trackedPath) { $null = $tracked.Add((Normalize-RepoPath $trackedPath)) }
}
foreach ($path in $changed) {
  if ($frozenPatterns | Where-Object { $path -match $_ }) { continue }
  if ($textExtensions -notcontains [IO.Path]::GetExtension($path).ToLowerInvariant()) { continue }
  $fullPath = Join-Path $repo $path
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
  $diff = if ($tracked.Contains($path)) {
    Invoke-RepoGit -Arguments @("diff", "-U0", $baseline, "--", $path)
  } else {
    Get-Content -LiteralPath $fullPath
  }
  $addedText = ($diff | Where-Object { $_ -match '^\+(?!\+\+)' }) -join "`n"
  if ($addedText -match $forbiddenBuildPattern) {
    $failures.Add("A changed web/shared script introduces a forbidden game build or package command: $path")
  }
}

$result = [ordered]@{
  ok = $failures.Count -eq 0
  baseline = $baseline
  changed_file_count = $changed.Count
  frozen_change_count = @($failures | Where-Object { $_ -like 'Frozen*' }).Count
  navigation_contracts = @($manifest.nav_contracts).Count + $profileNames.Count
  game_build_commands_run = $false
  failures = @($failures)
}

if ($Json) {
  $result | ConvertTo-Json -Depth 4
} else {
  if ($result.ok) {
    Write-Host "PASS PhantomPlay non-touch scope guard" -ForegroundColor Green
    Write-Host "  Baseline: $baseline"
    Write-Host "  Changed files scanned: $($changed.Count)"
    Write-Host "  Frozen path changes: 0"
    Write-Host "  Navigation contracts checked: $($result.navigation_contracts)"
    Write-Host "  Game build/package commands run: no"
  } else {
    Write-Host "FAIL PhantomPlay non-touch scope guard" -ForegroundColor Red
    foreach ($failure in $failures) { Write-Host "  - $failure" -ForegroundColor Red }
  }
}

if (-not $result.ok) { exit 1 }
