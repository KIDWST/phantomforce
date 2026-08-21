[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [string]$InstalledRoot = '',
    [string]$BackupRoot = '',
    [string]$Authorization = '',
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$Revision = 'V19R1'

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
    $prefix = $resolvedParent + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
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
$approvedInstalledRoot = Get-NormalizedPath (Join-Path $approvedWindowsRoot 'cubetown')
if ([string]::IsNullOrWhiteSpace($InstalledRoot)) {
    $InstalledRoot = $approvedInstalledRoot
}
$InstalledRoot = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'Cubetown installed root'

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\backups'
}
$BackupRoot = Get-NormalizedPath $BackupRoot
$CandidateRoot = Assert-ExactPath `
    -Actual (Join-Path $ProjectRoot "CandidateBuilds\$Revision\cubetown") `
    -Expected (Join-Path $ProjectRoot 'CandidateBuilds\V19R1\cubetown') `
    -Label 'Cubetown candidate root'

$expected = [ordered]@{
    file_count = 31
    total_bytes = 1043239268L
    launcher_sha256 = '693F901BF7B4F9DF9E2FF7954E66BF0443F431A16EE5F6E265351C430A6FF2D5'
    shipping_sha256 = '7C1B796B67980BB1D7A1B6179E73DB1BFAEACE7DE37E74C1D791F09E2C3F11D9'
    ucas_sha256 = '18D41EECD1950390A6E36E33EBD6AA823DBC8B76E5CBED8463C9E7B91709130D'
    utoc_sha256 = 'A25CB0003452F5066E884640D3D6A0FE539FF8A048B9943186069A3762F97006'
}

if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) {
    throw "Cubetown V19R1 candidate is missing: $CandidateRoot"
}
$candidateSummary = Get-TreeSummary $CandidateRoot
if ($candidateSummary.file_count -ne $expected.file_count -or $candidateSummary.total_bytes -ne $expected.total_bytes) {
    throw "Cubetown candidate tree mismatch: expected $($expected.file_count) files/$($expected.total_bytes) bytes; received $($candidateSummary.file_count) files/$($candidateSummary.total_bytes) bytes."
}
$candidateMarker = Join-Path $CandidateRoot 'PHANTOM_V19R1_CANDIDATE.txt'
$candidateMarkerText = Get-Content -LiteralPath $candidateMarker -Raw
if ($candidateMarkerText -notmatch 'visual_profile=makers-journey-v19' -or $candidateMarkerText -notmatch 'promotion=blocked_until_explicit_human_PROMOTE') {
    throw 'Cubetown candidate identity marker is invalid.'
}

$candidateLauncher = Assert-Hash -Path (Join-Path $CandidateRoot 'Cubetown.exe') -Expected $expected.launcher_sha256 -Label 'Candidate launcher'
$candidateShipping = Assert-Hash -Path (Join-Path $CandidateRoot 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe') -Expected $expected.shipping_sha256 -Label 'Candidate Shipping binary'
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

foreach ($game in @($previousMarker.games | Where-Object { $_.id -ne 'cubetown' })) {
    $gameRoot = Assert-PathWithin -Path (Join-Path $approvedWindowsRoot $game.id) -Parent $approvedWindowsRoot -Label "Retained game $($game.id)"
    $gameExe = Join-Path $gameRoot $game.executable
    [void](Assert-Hash -Path $gameExe -Expected $game.sha256 -Label "Retained game $($game.id)")
}

$installedBefore = $null
if (Test-Path -LiteralPath $InstalledRoot -PathType Container) {
    $summary = Get-TreeSummary $InstalledRoot
    $launcherPath = Join-Path $InstalledRoot 'Cubetown.exe'
    $shippingPath = Join-Path $InstalledRoot 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe'
    $installedBefore = [ordered]@{
        revision = $previousRevision
        file_count = $summary.file_count
        total_bytes = $summary.total_bytes
        launcher_sha256 = if (Test-Path -LiteralPath $launcherPath -PathType Leaf) { (Get-FileHash -LiteralPath $launcherPath -Algorithm SHA256).Hash } else { $null }
        shipping_sha256 = if (Test-Path -LiteralPath $shippingPath -PathType Leaf) { (Get-FileHash -LiteralPath $shippingPath -Algorithm SHA256).Hash } else { $null }
    }
}
$alreadyInstalled = $null -ne $installedBefore `
    -and [string]$previousMarker.cubetown_revision -ceq $Revision `
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
    } | ConvertTo-Json -Depth 8
    exit 0
}

if ($Authorization -cne 'PROMOTE') {
    throw 'Promotion denied. Pass the exact case-sensitive authorization value PROMOTE.'
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

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupLeaf = "phantomplay-cubetown-$($previousRevision.ToLowerInvariant())-to-v19r1-$timestamp"
$backupPath = Assert-PathWithin -Path (Join-Path $BackupRoot $backupLeaf) -Parent $BackupRoot -Label 'Cubetown rollback checkpoint'
$backupCubetown = Assert-PathWithin -Path (Join-Path $backupPath 'cubetown') -Parent $backupPath -Label 'Cubetown rollback tree'
$backupBuildset = Join-Path $backupPath 'PHANTOMPLAY_BUILDSET.json'

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
if (Test-Path -LiteralPath $backupPath) {
    throw "Rollback checkpoint already exists: $backupPath"
}
New-Item -ItemType Directory -Path $backupPath | Out-Null
Copy-Item -LiteralPath $buildsetPath -Destination $backupBuildset

Get-Process -Name 'Cubetown' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop

$hadPrevious = Test-Path -LiteralPath $InstalledRoot -PathType Container
$movedPrevious = $false
try {
    if ($hadPrevious) {
        Move-Item -LiteralPath $InstalledRoot -Destination $backupCubetown
        $movedPrevious = $true
    }
    New-Item -ItemType Directory -Path $InstalledRoot | Out-Null
    & robocopy.exe $CandidateRoot $InstalledRoot /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    $copyExitCode = $LASTEXITCODE
    if ($copyExitCode -ge 8) {
        throw "Cubetown copy failed with robocopy exit code $copyExitCode."
    }

    $installedCandidateMarker = Join-Path $InstalledRoot 'PHANTOM_V19R1_CANDIDATE.txt'
    $installedMarker = Join-Path $InstalledRoot 'PHANTOM_V19R1_INSTALLED.txt'
    Move-Item -LiteralPath $installedCandidateMarker -Destination $installedMarker
    $promotedUtc = [DateTime]::UtcNow.ToString('o')
    Set-Content -LiteralPath $installedMarker -Encoding UTF8 -Value @(
        'PHANTOM V19R1 INSTALLED'
        'game=cubetown'
        "promoted_utc=$promotedUtc"
        'visual_profile=makers-journey-v19'
        "base_buildset=$previousRevision"
        'authorization=PROMOTE'
    )

    $installedLauncher = Assert-Hash -Path (Join-Path $InstalledRoot 'Cubetown.exe') -Expected $expected.launcher_sha256 -Label 'Installed launcher'
    $installedShipping = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe') -Expected $expected.shipping_sha256 -Label 'Installed Shipping binary'
    $installedUcas = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas') -Expected $expected.ucas_sha256 -Label 'Installed content container'
    $installedUtoc = Assert-Hash -Path (Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc') -Expected $expected.utoc_sha256 -Label 'Installed container index'
    $installedSummary = Get-TreeSummary $InstalledRoot
    if ($installedSummary.file_count -ne $expected.file_count) {
        throw "Installed Cubetown file-count mismatch: expected $($expected.file_count); received $($installedSummary.file_count)."
    }

    $cubetownResult = [pscustomobject]@{
        id = 'cubetown'
        revision = $Revision
        executable = 'Cubetown.exe'
        sha256 = $installedLauncher
        shipping_sha256 = $installedShipping
        content_sha256 = $installedUcas
        container_index_sha256 = $installedUtoc
        file_count = $installedSummary.file_count
        total_bytes = $installedSummary.total_bytes
    }
    $retainedGames = @($previousMarker.games | Where-Object { $_.id -ne 'cubetown' })
    $mixedRevision = "$previousRevision+CUBETOWN-$Revision"
    $newMarker = [ordered]@{
        schema_version = 2
        revision = $mixedRevision
        base_revision = $previousRevision
        cubetown_revision = $Revision
        promoted_utc = $promotedUtc
        engine = 'Unreal Engine 5.8.1'
        source_candidate = $CandidateRoot
        authorization = 'PROMOTE'
        games = @($cubetownResult) + $retainedGames
        verification = [ordered]@{
            cubetown_shipping_package = 'passed'
            cubetown_installed_hashes = 'passed'
            retained_game_hashes = 'passed'
            owner_authorization = 'PROMOTE'
        }
        rollback = $backupCubetown
    }
    $newMarker | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $buildsetPath -Encoding UTF8

    [ordered]@{
        promoted_utc = $promotedUtc
        authorization = 'PROMOTE'
        previous_revision = $previousRevision
        installed_revision = $mixedRevision
        installed_root = $InstalledRoot
        rollback = $backupCubetown
        installed = $cubetownResult
        previous = $installedBefore
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $backupPath 'PROMOTION.json') -Encoding UTF8

    [pscustomobject]@{
        status = 'promoted'
        previous_revision = $previousRevision
        revision = $mixedRevision
        installed_root = $InstalledRoot
        rollback = $backupCubetown
        cubetown = $cubetownResult
    } | ConvertTo-Json -Depth 10
} catch {
    $failure = $_
    if (Test-Path -LiteralPath $InstalledRoot -PathType Container) {
        $verifiedPartial = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'Failed Cubetown partial install'
        Remove-Item -LiteralPath $verifiedPartial -Recurse -Force
    }
    if ($movedPrevious -and (Test-Path -LiteralPath $backupCubetown -PathType Container)) {
        Move-Item -LiteralPath $backupCubetown -Destination $InstalledRoot
    }
    if (Test-Path -LiteralPath $backupBuildset -PathType Leaf) {
        Copy-Item -LiteralPath $backupBuildset -Destination $buildsetPath -Force
    }
    throw "Cubetown promotion failed and the prior install was restored. $($failure.Exception.Message)"
}
