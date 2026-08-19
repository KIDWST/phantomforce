[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [string]$Revision = 'V18R1',
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
if ($Revision -cne 'V18R1') {
    throw "This reviewed promotion manifest is pinned to V18R1; received '$Revision'. Create and review a new manifest before promoting another revision."
}
$candidateRoot = Get-NormalizedPath (Join-Path $ProjectRoot "CandidateBuilds\$Revision")
$proofRoot = Get-NormalizedPath (Join-Path $ProjectRoot 'Saved\PhantomGameplayProofV18R1Candidates')

if (-not (Test-Path -LiteralPath $candidateRoot -PathType Container)) {
    throw "Candidate build set is missing: $candidateRoot"
}
if (-not (Test-Path -LiteralPath $proofRoot -PathType Container)) {
    throw "Candidate gameplay proof is missing: $proofRoot"
}

$games = @(
    [pscustomobject]@{ id = 'cubetown'; exe = 'Cubetown.exe'; file_count = 31; total_bytes = 1043014022L; sha256 = '693F901BF7B4F9DF9E2FF7954E66BF0443F431A16EE5F6E265351C430A6FF2D5' },
    [pscustomobject]@{ id = 'phantom-ages'; exe = 'PhantomAges.exe'; file_count = 31; total_bytes = 1043014035L; sha256 = '448E8C37DD4B0650D610303DD9FD22161E393DF0CFD4866858519E2C8319A588' },
    [pscustomobject]@{ id = 'phantom-legends'; exe = 'PhantomLegends.exe'; file_count = 31; total_bytes = 1043014047L; sha256 = '779EC14423CB1C05A4117285A60C174D95C42FD2B7D94B6CA0B7096C198F4E3D' },
    [pscustomobject]@{ id = 'phantom-strike'; exe = 'PhantomStrike.exe'; file_count = 31; total_bytes = 1043014043L; sha256 = '5458645F838E1E9BA22CF5F8BA9EFFD34987F40B8A2AC73907056921F96B1EA0' }
)

$proofs = @(
    [pscustomobject]@{ file = 'cubetown-GAMEPLAY.png'; sha256 = 'CC7BDCA50C7E74EA4F4A7583F1365FDFD3B61908F976EDC381E8D21AD284702E' },
    [pscustomobject]@{ file = 'phantom-ages-GAMEPLAY.png'; sha256 = '493F79D1D8D3BD94CCD1EFEEE0655523CBD2805263DBA72F83F17D3AF88CC180' },
    [pscustomobject]@{ file = 'phantom-legends-GAMEPLAY.png'; sha256 = '9477D6342C6D1FACCAFBCD9828191A79B1A0A6A62191828FF702343D73415F2C' },
    [pscustomobject]@{ file = 'phantom-strike-GAMEPLAY.png'; sha256 = 'EC6FE73D6B5E9E2A2B0580E61A524A5B96ABD9F5F132A0570503566F528D8D16' },
    [pscustomobject]@{ file = 'V11_VISUAL_GATE.csv'; sha256 = 'C3137059E7D4D1E3C8195AE300180E5CDD136BCF7960E4A088D06990861D4066' }
)

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
        engine = 'Unreal Engine 5.8.1'
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
