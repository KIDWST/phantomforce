[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [string]$Revision = 'V22R24',
    [string]$CandidateRoot = '',
    [string]$ProofRoot = '',
    [string]$ManifestPath = '',
    [string]$InstalledRoot = '',
    [string]$BackupRoot = '',
    [string]$Authorization = '',
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-ExactPath {
    param(
        [Parameter(Mandatory = $true)][string]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $actualPath = Get-NormalizedPath $Actual
    $expectedPath = Get-NormalizedPath $Expected
    if (-not $actualPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
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
    $prefix = $resolvedParent + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
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

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is unavailable; the installed PhantomPlay location cannot be proven.'
}

$approvedInstalledRoot = Join-Path $env:LOCALAPPDATA 'PhantomPlay\Games\Unreal\Windows'
if ([string]::IsNullOrWhiteSpace($InstalledRoot)) {
    $InstalledRoot = $approvedInstalledRoot
}
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\backups'
}

$ProjectRoot = Get-NormalizedPath $ProjectRoot
$InstalledRoot = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'Installed root'
$BackupRoot = Get-NormalizedPath $BackupRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $PSScriptRoot "PromotionManifests\$Revision.json"
}
$ManifestPath = Get-NormalizedPath $ManifestPath
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Reviewed promotion manifest is missing: $ManifestPath"
}
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ([string]$manifest.revision -cne $Revision) {
    throw "Promotion manifest revision '$($manifest.revision)' does not match requested revision '$Revision'."
}
if ([string]::IsNullOrWhiteSpace($CandidateRoot)) {
    $CandidateRoot = if ([string]::IsNullOrWhiteSpace([string]$manifest.candidate_root)) { Join-Path $ProjectRoot "CandidateBuilds\$Revision" } else { [string]$manifest.candidate_root }
}
if ([string]::IsNullOrWhiteSpace($ProofRoot)) {
    $ProofRoot = if ([string]::IsNullOrWhiteSpace([string]$manifest.proof_root)) { Join-Path $ProjectRoot "Saved\PhantomGameplayProof${Revision}Candidates" } else { [string]$manifest.proof_root }
}
$candidateRoot = Get-NormalizedPath $CandidateRoot
$proofRoot = Get-NormalizedPath $ProofRoot

if (-not (Test-Path -LiteralPath $candidateRoot -PathType Container)) {
    throw "Candidate build set is missing: $candidateRoot"
}
if (-not (Test-Path -LiteralPath $proofRoot -PathType Container)) {
    throw "Candidate gameplay proof is missing: $proofRoot"
}

$games = @($manifest.games)
$proofs = @($manifest.proofs)
if ($games.Count -ne 4 -or $proofs.Count -lt 5) {
    throw 'Reviewed promotion manifest must contain exactly four games and all required gameplay evidence.'
}

$candidateResults = foreach ($game in $games) {
    $gameRoot = Join-Path $candidateRoot $game.id
    if (-not (Test-Path -LiteralPath $gameRoot -PathType Container)) {
        throw "Candidate game directory is missing: $gameRoot"
    }
    $summary = Get-TreeSummary $gameRoot
    if ($summary.file_count -ne $game.file_count -or $summary.total_bytes -ne $game.total_bytes) {
        throw "Candidate tree mismatch for $($game.id): expected $($game.file_count) files/$($game.total_bytes) bytes; received $($summary.file_count) files/$($summary.total_bytes) bytes."
    }
    $exePath = Join-Path $gameRoot $game.exe
    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
        throw "Candidate launcher is missing: $exePath"
    }
    $hash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
    if (-not $hash.Equals($game.sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate launcher hash mismatch for $($game.id)."
    }
    [pscustomobject]@{
        id = $game.id
        executable = $game.exe
        sha256 = $hash
        file_count = $summary.file_count
        total_bytes = $summary.total_bytes
    }
}

foreach ($proof in $proofs) {
    $proofPath = Join-Path $proofRoot $proof.file
    if (-not (Test-Path -LiteralPath $proofPath -PathType Leaf)) {
        throw "Reviewed gameplay evidence is missing: $proofPath"
    }
    $hash = (Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash
    if (-not $hash.Equals($proof.sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Reviewed gameplay evidence hash mismatch: $($proof.file)"
    }
}

$gateRows = @(Import-Csv -LiteralPath (Join-Path $proofRoot 'V11_VISUAL_GATE.csv'))
if ($gateRows.Count -ne 4 -or @($gateRows | Where-Object { $_.Pass -ne 'True' }).Count -ne 0) {
    throw 'Candidate visual gate is not a clean 4/4 pass.'
}

if ($VerifyOnly) {
    [pscustomobject]@{
        status = 'ready'
        revision = $Revision
        candidate_root = $candidateRoot
        installed_root = $InstalledRoot
        candidates = $candidateResults
        visual_gate = '4/4 passed'
    } | ConvertTo-Json -Depth 6
    exit 0
}

if ($Authorization -cne 'PROMOTE') {
    throw 'Promotion denied. Pass the exact case-sensitive authorization value PROMOTE.'
}

$previousMarkerPath = Join-Path $InstalledRoot 'PHANTOMPLAY_BUILDSET.json'
$previousRevision = 'unversioned'
if (Test-Path -LiteralPath $previousMarkerPath -PathType Leaf) {
    try {
        $previousRevision = (Get-Content -LiteralPath $previousMarkerPath -Raw | ConvertFrom-Json).revision
    } catch {
        $previousRevision = 'unreadable-marker'
    }
}
if ([string]$previousRevision -ceq $Revision) {
    throw "Revision $Revision is already installed; refusing to replace it with the same build set."
}

$backupLeaf = 'phantomplay-unreal-{0}-to-{1}-{2}' -f $previousRevision.ToString().ToLowerInvariant(), $Revision.ToLowerInvariant(), (Get-Date -Format 'yyyyMMdd-HHmmss')
$backupPath = Join-Path $BackupRoot $backupLeaf
$backupPath = Assert-PathWithin -Path $backupPath -Parent $BackupRoot -Label 'Rollback checkpoint'
$backupWindows = Join-Path $backupPath 'Windows'

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
if (Test-Path -LiteralPath $backupPath) {
    throw "Rollback checkpoint already exists: $backupPath"
}
New-Item -ItemType Directory -Path $backupPath | Out-Null

$processNames = @('PhantomPlay', 'Cubetown', 'PhantomAges', 'PhantomLegends', 'PhantomStrike')
foreach ($processName in $processNames) {
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop
}

$hadPrevious = Test-Path -LiteralPath $InstalledRoot -PathType Container
$movedPrevious = $false
try {
    if ($hadPrevious) {
        Move-Item -LiteralPath $InstalledRoot -Destination $backupWindows
        $movedPrevious = $true
    }
    New-Item -ItemType Directory -Path $InstalledRoot | Out-Null

    foreach ($game in $games) {
        $source = Join-Path $candidateRoot $game.id
        $destination = Join-Path $InstalledRoot $game.id
        New-Item -ItemType Directory -Path $destination | Out-Null
        & robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
        $copyExitCode = $LASTEXITCODE
        if ($copyExitCode -ge 8) {
            throw "Copy failed for $($game.id) with robocopy exit code $copyExitCode."
        }
    }

    $installedResults = foreach ($game in $games) {
        $gameRoot = Join-Path $InstalledRoot $game.id
        $summary = Get-TreeSummary $gameRoot
        $exePath = Join-Path $gameRoot $game.exe
        $hash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
        if ($summary.file_count -ne $game.file_count -or $summary.total_bytes -ne $game.total_bytes -or -not $hash.Equals($game.sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Installed verification failed for $($game.id)."
        }
        [pscustomobject]@{
            id = $game.id
            executable = $game.exe
            sha256 = $hash
            file_count = $summary.file_count
            total_bytes = $summary.total_bytes
        }
    }

    $evidenceRoot = Join-Path $InstalledRoot '_release-evidence'
    New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
    foreach ($proof in $proofs) {
        Copy-Item -LiteralPath (Join-Path $proofRoot $proof.file) -Destination (Join-Path $evidenceRoot $proof.file)
    }

    $promotedUtc = [DateTime]::UtcNow.ToString('o')
    $marker = [ordered]@{
        schema_version = 1
        revision = $Revision
        promoted_utc = $promotedUtc
        engine = [string]$manifest.engine
        source_candidate = $candidateRoot
        authorization = 'PROMOTE'
        games = $installedResults
        verification = [ordered]@{
            shipping_packages = '4/4 passed'
            gameplay_captures = '4/4 passed'
            visual_gate = '4/4 passed'
            installed_hashes = '4/4 passed'
        }
        rollback = $backupWindows
    }
    $marker | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $InstalledRoot 'PHANTOMPLAY_BUILDSET.json') -Encoding utf8

    [ordered]@{
        promoted_utc = $promotedUtc
        previous_revision = $previousRevision
        installed_revision = $Revision
        installed_root = $InstalledRoot
        rollback = $backupWindows
        games = $installedResults
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupPath 'PROMOTION.json') -Encoding utf8

    [pscustomobject]@{
        status = 'promoted'
        previous_revision = $previousRevision
        revision = $Revision
        installed_root = $InstalledRoot
        rollback = $backupWindows
        games = $installedResults
        visual_gate = '4/4 passed'
    } | ConvertTo-Json -Depth 8
} catch {
    $failure = $_
    if ($movedPrevious -and (Test-Path -LiteralPath $InstalledRoot)) {
        $verifiedInstalledRoot = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'Failed partial install'
        Remove-Item -LiteralPath $verifiedInstalledRoot -Recurse -Force
    }
    if ($movedPrevious -and (Test-Path -LiteralPath $backupWindows -PathType Container)) {
        Move-Item -LiteralPath $backupWindows -Destination $InstalledRoot
    } elseif (-not $hadPrevious -and (Test-Path -LiteralPath $InstalledRoot)) {
        $verifiedInstalledRoot = Assert-ExactPath -Actual $InstalledRoot -Expected $approvedInstalledRoot -Label 'Failed partial install'
        Remove-Item -LiteralPath $verifiedInstalledRoot -Recurse -Force
    }
    throw "Promotion failed and the previous installed set was restored. $($failure.Exception.Message)"
}
