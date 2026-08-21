[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [string]$InstalledRoot = '',
    [string]$BackupRoot = '',
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$Revision = 'V28R3'

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-ExactPath {
    param([string]$Actual, [string]$Expected, [string]$Label)
    $actualPath = Get-NormalizedPath $Actual
    $expectedPath = Get-NormalizedPath $Expected
    if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolved outside its approved location. Expected '$expectedPath'; received '$actualPath'."
    }
    return $actualPath
}

function Assert-PathWithin {
    param([string]$Path, [string]$Parent, [string]$Label)
    $resolvedPath = Get-NormalizedPath $Path
    $resolvedParent = Get-NormalizedPath $Parent
    if (-not $resolvedPath.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolved outside its approved parent. Parent '$resolvedParent'; received '$resolvedPath'."
    }
    return $resolvedPath
}

function Get-TreeSummary {
    param([string]$Path)
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File)
    return [pscustomobject]@{
        file_count = $files.Count
        total_bytes = [long](($files | Measure-Object -Property Length -Sum).Sum)
    }
}

function Assert-Hash {
    param([string]$Path, [string]$Expected, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if (-not $actual.Equals($Expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label hash mismatch. Expected '$Expected'; received '$actual'."
    }
    return $actual
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is unavailable.' }
$ProjectRoot = Get-NormalizedPath $ProjectRoot
$approvedWindowsRoot = Get-NormalizedPath (Join-Path $env:LOCALAPPDATA 'PhantomPlay\Games\Unreal\Windows')
$approvedInstalledRoot = Get-NormalizedPath (Join-Path $approvedWindowsRoot 'phantom-strike')
if ([string]::IsNullOrWhiteSpace($InstalledRoot)) { $InstalledRoot = $approvedInstalledRoot }
$InstalledRoot = Assert-ExactPath $InstalledRoot $approvedInstalledRoot 'PhantomStrike installed root'
if ([string]::IsNullOrWhiteSpace($BackupRoot)) { $BackupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\backups' }
$BackupRoot = Get-NormalizedPath $BackupRoot

$CandidateRoot = Assert-ExactPath `
    (Join-Path $ProjectRoot 'CandidateBuilds\V28R3\phantom-strike') `
    (Join-Path $ProjectRoot 'CandidateBuilds\V28R3\phantom-strike') `
    'PhantomStrike candidate root'
$candidateMarker = Join-Path $CandidateRoot 'PHANTOM_V28R3_CANDIDATE.txt'
$manifestPath = Join-Path $CandidateRoot 'PHANTOM_V28R3_MANIFEST.json'
if (-not (Test-Path -LiteralPath $candidateMarker -PathType Leaf)) { throw 'V28 candidate marker is missing.' }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'V28 candidate manifest is missing.' }
$markerText = Get-Content -LiteralPath $candidateMarker -Raw
if ($markerText -notmatch 'game=phantom-strike' -or $markerText -notmatch 'visual_profile=blackridge-natural-first-person-v28r3') {
    throw 'V28 candidate identity marker is invalid.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([string]$manifest.revision -cne $Revision -or [string]$manifest.game -cne 'phantom-strike' -or [string]$manifest.visual_profile -cne 'blackridge-natural-first-person-v28r3') {
    throw 'V28 candidate manifest identity is invalid.'
}
$candidateSummary = Get-TreeSummary $CandidateRoot
if ($candidateSummary.file_count -ne ([int]$manifest.file_count_before_manifest + 1)) {
    throw "V28 candidate file-count mismatch: $($candidateSummary.file_count)."
}

$verified = [ordered]@{}
foreach ($Name in @('launcher','shipping','pak','ucas','utoc')) {
    $relative = [string]$manifest.paths.$Name
    $expected = [string]$manifest.sha256.$Name
    $path = Assert-PathWithin (Join-Path $CandidateRoot $relative) $CandidateRoot "Candidate $Name"
    $verified[$Name] = Assert-Hash $path $expected "Candidate $Name"
}

$buildsetPath = Join-Path $approvedWindowsRoot 'PHANTOMPLAY_BUILDSET.json'
if (-not (Test-Path -LiteralPath $buildsetPath -PathType Leaf)) { throw "Build-set marker is missing: $buildsetPath" }
$previousMarker = Get-Content -LiteralPath $buildsetPath -Raw | ConvertFrom-Json
$previousRevision = [string]$previousMarker.revision
if ([string]::IsNullOrWhiteSpace($previousRevision)) { throw 'Installed build-set revision is missing.' }
foreach ($game in @($previousMarker.games | Where-Object { $_.id -ne 'phantom-strike' })) {
    $gameRoot = Assert-PathWithin (Join-Path $approvedWindowsRoot $game.id) $approvedWindowsRoot "Retained game $($game.id)"
    [void](Assert-Hash (Join-Path $gameRoot $game.executable) $game.sha256 "Retained game $($game.id)")
}

$alreadyInstalled = [string]$previousMarker.phantomstrike_revision -ceq $Revision
if ($VerifyOnly) {
    [pscustomobject]@{
        status = if ($alreadyInstalled) { 'installed' } else { 'ready' }
        revision = $Revision
        previous_revision = $previousRevision
        candidate_root = $CandidateRoot
        installed_root = $InstalledRoot
        candidate = $candidateSummary
        hashes = $verified
        promotion_policy = 'automatic_after_verified_local_gates'
    } | ConvertTo-Json -Depth 8
    exit 0
}
if ($alreadyInstalled) {
    [pscustomobject]@{ status = 'already-promoted'; revision = $previousRevision; installed_root = $InstalledRoot } | ConvertTo-Json
    exit 0
}
if ($null -ne (Get-Process -Name 'PhantomStrike' -ErrorAction SilentlyContinue)) {
    throw 'PhantomStrike is currently running. Promotion stopped without controlling the application.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safePreviousRevision = $previousRevision.ToLowerInvariant() -replace '[^a-z0-9._-]+', '-'
$backupPath = Assert-PathWithin (Join-Path $BackupRoot "phantomplay-phantom-strike-$safePreviousRevision-to-v28r3-$timestamp") $BackupRoot 'Rollback checkpoint'
$backupStrike = Assert-PathWithin (Join-Path $backupPath 'phantom-strike') $backupPath 'Rollback game tree'
$backupBuildset = Join-Path $backupPath 'PHANTOMPLAY_BUILDSET.json'
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
if (Test-Path -LiteralPath $backupPath) { throw "Rollback checkpoint already exists: $backupPath" }
New-Item -ItemType Directory -Path $backupPath | Out-Null
Copy-Item -LiteralPath $buildsetPath -Destination $backupBuildset

$movedPrevious = $false
try {
    if (Test-Path -LiteralPath $InstalledRoot -PathType Container) {
        Move-Item -LiteralPath $InstalledRoot -Destination $backupStrike
        $movedPrevious = $true
    }
    New-Item -ItemType Directory -Path $InstalledRoot | Out-Null
    & robocopy.exe $CandidateRoot $InstalledRoot /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "PhantomStrike copy failed with robocopy exit code $LASTEXITCODE." }

    $installedMarker = Join-Path $InstalledRoot 'PHANTOM_V28R3_INSTALLED.txt'
    Move-Item -LiteralPath (Join-Path $InstalledRoot 'PHANTOM_V28R3_CANDIDATE.txt') -Destination $installedMarker
    $promotedUtc = [DateTime]::UtcNow.ToString('o')
    Set-Content -LiteralPath $installedMarker -Encoding UTF8 -Value @(
        'PHANTOM V28R3 INSTALLED'
        'game=phantom-strike'
        "promoted_utc=$promotedUtc"
        'visual_profile=blackridge-natural-first-person-v28r3'
        "base_buildset=$previousRevision"
        'promotion_policy=automatic_after_verified_local_gates'
        'authorization=current_owner_request'
    )

    $installedHashes = [ordered]@{}
    foreach ($Name in @('launcher','shipping','pak','ucas','utoc')) {
        $installedHashes[$Name] = Assert-Hash (Join-Path $InstalledRoot ([string]$manifest.paths.$Name)) ([string]$manifest.sha256.$Name) "Installed $Name"
    }
    $installedSummary = Get-TreeSummary $InstalledRoot
    if ($installedSummary.file_count -ne $candidateSummary.file_count) { throw 'Installed file-count mismatch.' }

    $strikeResult = [pscustomobject]@{
        id = 'phantom-strike'
        revision = $Revision
        executable = 'PhantomStrike.exe'
        sha256 = $installedHashes.launcher
        shipping_sha256 = $installedHashes.shipping
        package_sha256 = $installedHashes.pak
        content_sha256 = $installedHashes.ucas
        container_index_sha256 = $installedHashes.utoc
        file_count = $installedSummary.file_count
        total_bytes = $installedSummary.total_bytes
    }
    $games = @()
    $foundStrike = $false
    foreach ($game in @($previousMarker.games)) {
        if ($game.id -eq 'phantom-strike') { $games += $strikeResult; $foundStrike = $true } else { $games += $game }
    }
    if (-not $foundStrike) { $games += $strikeResult }
    $baseRevision = $previousRevision -replace '\+PHANTOMSTRIKE-V[0-9]+R[0-9]+', ''
    $mixedRevision = "$baseRevision+PHANTOMSTRIKE-$Revision"
    $newMarker = [ordered]@{
        schema_version = 3
        revision = $mixedRevision
        base_revision = if ($previousMarker.base_revision) { $previousMarker.base_revision } else { $baseRevision }
        cubetown_revision = $previousMarker.cubetown_revision
        phantomstrike_revision = $Revision
        promoted_utc = $promotedUtc
        engine = 'Unreal Engine 5.8.1'
        source_candidate = $CandidateRoot
        promotion_policy = 'automatic_after_verified_local_gates'
        authorization = 'current_owner_request'
        games = $games
        verification = [ordered]@{
            realism_asset_gate = 'passed'
            source_regression = 'passed'
            shipping_cook = 'passed'
            installed_hashes = 'passed'
            retained_game_hashes = 'passed'
            rollback_checkpoint = 'passed'
        }
        rollback = $backupStrike
    }
    $newMarker | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $buildsetPath -Encoding UTF8
    [ordered]@{
        promoted_utc = $promotedUtc
        previous_revision = $previousRevision
        installed_revision = $mixedRevision
        installed_root = $InstalledRoot
        rollback = $backupStrike
        installed = $strikeResult
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $backupPath 'PROMOTION.json') -Encoding UTF8
    [pscustomobject]@{
        status = 'promoted'
        previous_revision = $previousRevision
        revision = $mixedRevision
        installed_root = $InstalledRoot
        rollback = $backupStrike
        phantomstrike = $strikeResult
    } | ConvertTo-Json -Depth 10
} catch {
    $failure = $_
    if (Test-Path -LiteralPath $InstalledRoot -PathType Container) {
        $verifiedPartial = Assert-ExactPath $InstalledRoot $approvedInstalledRoot 'Failed partial install'
        Remove-Item -LiteralPath $verifiedPartial -Recurse -Force
    }
    if ($movedPrevious -and (Test-Path -LiteralPath $backupStrike -PathType Container)) {
        Move-Item -LiteralPath $backupStrike -Destination $InstalledRoot
    }
    if (Test-Path -LiteralPath $backupBuildset -PathType Leaf) {
        Copy-Item -LiteralPath $backupBuildset -Destination $buildsetPath -Force
    }
    throw "PhantomStrike promotion failed and the prior install was restored. $($failure.Exception.Message)"
}
