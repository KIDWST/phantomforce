[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [string]$InstalledRoot = '',
    [string]$BackupRoot = '',
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$Revision = 'V26R1'

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-ExactPath {
    param(
        [Parameter(Mandatory = $true)][string]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $actualPath = Get-NormalizedPath $Actual
    $expectedPath = Get-NormalizedPath $Expected
    if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolved outside its approved location. Expected '$expectedPath'; received '$actualPath'."
    }
    return $actualPath
}

function Assert-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $resolvedPath = Get-NormalizedPath $Path
    $resolvedParent = Get-NormalizedPath $Parent
    if (-not $resolvedPath.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolved outside its approved parent. Parent '$resolvedParent'; received '$resolvedPath'."
    }
    return $resolvedPath
}

function Get-TreeSummary {
    param([Parameter(Mandatory = $true)][string]$Path)
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File)
    return [pscustomobject]@{
        file_count = $files.Count
        total_bytes = [long](($files | Measure-Object -Property Length -Sum).Sum)
    }
}

function Assert-Hash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if (-not $actual.Equals($Expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label hash mismatch. Expected '$Expected'; received '$actual'."
    }
    return $actual
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is unavailable; the installed PhantomPlay location cannot be proven.'
}

$ProjectRoot = Get-NormalizedPath $ProjectRoot
$approvedWindowsRoot = Get-NormalizedPath (Join-Path $env:LOCALAPPDATA 'PhantomPlay\Games\Unreal\Windows')
$approvedInstalledRoot = Get-NormalizedPath (Join-Path $approvedWindowsRoot 'phantom-strike')
if ([string]::IsNullOrWhiteSpace($InstalledRoot)) {
    $InstalledRoot = $approvedInstalledRoot
}
$InstalledRoot = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'PhantomStrike installed root'

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\backups'
}
$BackupRoot = Get-NormalizedPath $BackupRoot
$CandidateRoot = Assert-ExactPath `
    -Actual (Join-Path $ProjectRoot "CandidateBuilds\$Revision\phantom-strike") `
    -Expected (Join-Path $ProjectRoot 'CandidateBuilds\V26R1\phantom-strike') `
    -Label 'PhantomStrike candidate root'

$expected = [ordered]@{
    file_count = 31
    total_bytes = 1043281311L
    launcher_sha256 = '5458645F838E1E9BA22CF5F8BA9EFFD34987F40B8A2AC73907056921F96B1EA0'
    shipping_sha256 = '38226D4F896569CAB17708C159A0DAFE3100526D05CE724AEF8AB6717E773E2B'
    pak_sha256 = '184BBD33EF1942D2619BBFEDC6186896C12FC981DA52E5E650601163D3ADBCAC'
    ucas_sha256 = '18D41EECD1950390A6E36E33EBD6AA823DBC8B76E5CBED8463C9E7B91709130D'
    utoc_sha256 = 'A25CB0003452F5066E884640D3D6A0FE539FF8A048B9943186069A3762F97006'
}

if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) {
    throw "PhantomStrike V26R1 candidate is missing: $CandidateRoot"
}
$candidateSummary = Get-TreeSummary $CandidateRoot
if ($candidateSummary.file_count -ne $expected.file_count -or $candidateSummary.total_bytes -ne $expected.total_bytes) {
    throw "PhantomStrike candidate tree mismatch: expected $($expected.file_count) files/$($expected.total_bytes) bytes; received $($candidateSummary.file_count) files/$($candidateSummary.total_bytes) bytes."
}
$candidateMarker = Join-Path $CandidateRoot 'PHANTOM_V26R1_CANDIDATE.txt'
$candidateMarkerText = Get-Content -LiteralPath $candidateMarker -Raw
if ($candidateMarkerText -notmatch 'game=phantom-strike' -or $candidateMarkerText -notmatch 'visual_profile=blackridge-grounded-combat-v26') {
    throw 'PhantomStrike candidate identity marker is invalid.'
}

$candidateLauncher = Assert-Hash -Path (Join-Path $CandidateRoot 'PhantomStrike.exe') -Expected $expected.launcher_sha256 -Label 'Candidate launcher'
$candidateShipping = Assert-Hash -Path (Join-Path $CandidateRoot 'PhantomGames\Binaries\Win64\PhantomStrike-Win64-Shipping.exe') -Expected $expected.shipping_sha256 -Label 'Candidate Shipping binary'
$candidatePak = Assert-Hash -Path (Join-Path $CandidateRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.pak') -Expected $expected.pak_sha256 -Label 'Candidate package index'
$candidateUcas = Assert-Hash -Path (Join-Path $CandidateRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas') -Expected $expected.ucas_sha256 -Label 'Candidate content container'
$candidateUtoc = Assert-Hash -Path (Join-Path $CandidateRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc') -Expected $expected.utoc_sha256 -Label 'Candidate container index'

$buildsetPath = Join-Path $approvedWindowsRoot 'PHANTOMPLAY_BUILDSET.json'
if (-not (Test-Path -LiteralPath $buildsetPath -PathType Leaf)) {
    throw "Installed PhantomPlay build-set marker is missing: $buildsetPath"
}
$previousMarker = Get-Content -LiteralPath $buildsetPath -Raw | ConvertFrom-Json
$previousRevision = [string]$previousMarker.revision
if ([string]::IsNullOrWhiteSpace($previousRevision)) {
    throw 'Installed PhantomPlay build-set marker has no revision.'
}

foreach ($game in @($previousMarker.games | Where-Object { $_.id -ne 'phantom-strike' })) {
    $gameRoot = Assert-PathWithin -Path (Join-Path $approvedWindowsRoot $game.id) -Parent $approvedWindowsRoot -Label "Retained game $($game.id)"
    [void](Assert-Hash -Path (Join-Path $gameRoot $game.executable) -Expected $game.sha256 -Label "Retained game $($game.id)")
}

$installedBefore = $null
if (Test-Path -LiteralPath $InstalledRoot -PathType Container) {
    $summary = Get-TreeSummary $InstalledRoot
    $launcherPath = Join-Path $InstalledRoot 'PhantomStrike.exe'
    $shippingPath = Join-Path $InstalledRoot 'PhantomGames\Binaries\Win64\PhantomStrike-Win64-Shipping.exe'
    $installedBefore = [ordered]@{
        revision = $previousRevision
        file_count = $summary.file_count
        total_bytes = $summary.total_bytes
        launcher_sha256 = if (Test-Path -LiteralPath $launcherPath -PathType Leaf) { (Get-FileHash -LiteralPath $launcherPath -Algorithm SHA256).Hash } else { $null }
        shipping_sha256 = if (Test-Path -LiteralPath $shippingPath -PathType Leaf) { (Get-FileHash -LiteralPath $shippingPath -Algorithm SHA256).Hash } else { $null }
    }
}
$alreadyInstalled = $null -ne $installedBefore `
    -and [string]$previousMarker.phantomstrike_revision -ceq $Revision `
    -and [string]$installedBefore.shipping_sha256 -ceq $expected.shipping_sha256

if ($VerifyOnly) {
    [pscustomobject]@{
        status = if ($alreadyInstalled) { 'installed' } else { 'ready' }
        revision = $Revision
        candidate_root = $CandidateRoot
        installed_root = $InstalledRoot
        previous_revision = $previousRevision
        candidate = $expected
        installed_before = $installedBefore
        promotion_policy = 'automatic_after_verified_local_gates'
    } | ConvertTo-Json -Depth 8
    exit 0
}

if ($alreadyInstalled) {
    [pscustomobject]@{
        status = 'already-promoted'
        revision = $previousRevision
        installed_root = $InstalledRoot
        shipping_sha256 = $installedBefore.shipping_sha256
    } | ConvertTo-Json -Depth 6
    exit 0
}

if ($null -ne (Get-Process -Name 'PhantomStrike' -ErrorAction SilentlyContinue)) {
    throw 'PhantomStrike is currently running. Promotion stopped without closing or controlling the application.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safePreviousRevision = $previousRevision.ToLowerInvariant() -replace '[^a-z0-9._-]+', '-'
$backupLeaf = "phantomplay-phantom-strike-$safePreviousRevision-to-v26r1-$timestamp"
$backupPath = Assert-PathWithin -Path (Join-Path $BackupRoot $backupLeaf) -Parent $BackupRoot -Label 'PhantomStrike rollback checkpoint'
$backupStrike = Assert-PathWithin -Path (Join-Path $backupPath 'phantom-strike') -Parent $backupPath -Label 'PhantomStrike rollback tree'
$backupBuildset = Join-Path $backupPath 'PHANTOMPLAY_BUILDSET.json'

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
if (Test-Path -LiteralPath $backupPath) {
    throw "Rollback checkpoint already exists: $backupPath"
}
New-Item -ItemType Directory -Path $backupPath | Out-Null
Copy-Item -LiteralPath $buildsetPath -Destination $backupBuildset

$hadPrevious = Test-Path -LiteralPath $InstalledRoot -PathType Container
$movedPrevious = $false
try {
    if ($hadPrevious) {
        Move-Item -LiteralPath $InstalledRoot -Destination $backupStrike
        $movedPrevious = $true
    }
    New-Item -ItemType Directory -Path $InstalledRoot | Out-Null
    & robocopy.exe $CandidateRoot $InstalledRoot /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "PhantomStrike copy failed with robocopy exit code $LASTEXITCODE."
    }

    $installedMarker = Join-Path $InstalledRoot 'PHANTOM_V26R1_INSTALLED.txt'
    Move-Item -LiteralPath (Join-Path $InstalledRoot 'PHANTOM_V26R1_CANDIDATE.txt') -Destination $installedMarker
    $promotedUtc = [DateTime]::UtcNow.ToString('o')
    Set-Content -LiteralPath $installedMarker -Encoding UTF8 -Value @(
        'PHANTOM V26R1 INSTALLED'
        'game=phantom-strike'
        "promoted_utc=$promotedUtc"
        'visual_profile=blackridge-grounded-combat-v26'
        "base_buildset=$previousRevision"
        'promotion_policy=automatic_after_verified_local_gates'
        'authorization=current_owner_request'
    )

    $installedLauncher = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomStrike.exe') -Expected $expected.launcher_sha256 -Label 'Installed launcher'
    $installedShipping = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Binaries\Win64\PhantomStrike-Win64-Shipping.exe') -Expected $expected.shipping_sha256 -Label 'Installed Shipping binary'
    $installedPak = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.pak') -Expected $expected.pak_sha256 -Label 'Installed package index'
    $installedUcas = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas') -Expected $expected.ucas_sha256 -Label 'Installed content container'
    $installedUtoc = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc') -Expected $expected.utoc_sha256 -Label 'Installed container index'
    $installedSummary = Get-TreeSummary $InstalledRoot
    if ($installedSummary.file_count -ne $expected.file_count) {
        throw "Installed PhantomStrike file-count mismatch: expected $($expected.file_count); received $($installedSummary.file_count)."
    }

    $strikeResult = [pscustomobject]@{
        id = 'phantom-strike'
        revision = $Revision
        executable = 'PhantomStrike.exe'
        sha256 = $installedLauncher
        shipping_sha256 = $installedShipping
        package_sha256 = $installedPak
        content_sha256 = $installedUcas
        container_index_sha256 = $installedUtoc
        file_count = $installedSummary.file_count
        total_bytes = $installedSummary.total_bytes
    }
    $games = @()
    foreach ($game in @($previousMarker.games)) {
        if ($game.id -eq 'phantom-strike') { $games += $strikeResult } else { $games += $game }
    }
    if (-not @($previousMarker.games | Where-Object { $_.id -eq 'phantom-strike' }).Count) {
        $games += $strikeResult
    }

    $mixedRevision = "$previousRevision+PHANTOMSTRIKE-$Revision"
    $newMarker = [ordered]@{
        schema_version = 3
        revision = $mixedRevision
        base_revision = if ($previousMarker.base_revision) { $previousMarker.base_revision } else { $previousRevision }
        cubetown_revision = $previousMarker.cubetown_revision
        phantomstrike_revision = $Revision
        promoted_utc = $promotedUtc
        engine = 'Unreal Engine 5.8.1'
        source_candidate = $CandidateRoot
        promotion_policy = 'automatic_after_verified_local_gates'
        authorization = 'current_owner_request'
        games = $games
        verification = [ordered]@{
            phantomstrike_shipping_package = 'passed'
            phantomstrike_installed_hashes = 'passed'
            retained_game_hashes = 'passed'
            rollback_checkpoint = 'passed'
        }
        rollback = $backupStrike
    }
    $newMarker | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $buildsetPath -Encoding UTF8

    [ordered]@{
        promoted_utc = $promotedUtc
        promotion_policy = 'automatic_after_verified_local_gates'
        previous_revision = $previousRevision
        installed_revision = $mixedRevision
        installed_root = $InstalledRoot
        rollback = $backupStrike
        installed = $strikeResult
        previous = $installedBefore
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
        $verifiedPartial = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'Failed PhantomStrike partial install'
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
