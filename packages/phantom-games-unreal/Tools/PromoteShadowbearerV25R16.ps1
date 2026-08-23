[CmdletBinding()]
param(
    [ValidateSet('PROMOTE')][string]$Authorization = 'PROMOTE'
)

$ErrorActionPreference = 'Stop'
$Revision = 'V25R25'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$CandidateRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'CandidateBuilds\Shadowbearer-Dawns-Return-V25R25\cubetown'))
$WindowsRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PhantomPlay\Games\Unreal\Windows'))
$InstalledRoot = [IO.Path]::GetFullPath((Join-Path $WindowsRoot 'cubetown'))
$BuildsetPath = [IO.Path]::GetFullPath((Join-Path $WindowsRoot 'PHANTOMPLAY_BUILDSET.json'))
$BackupParent = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\backups'))

function Assert-Within([string]$Path, [string]$Parent, [string]$Label) {
    $Resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $ResolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    if (-not $Resolved.StartsWith($ResolvedParent + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escaped its approved parent: $Resolved"
    }
    return $Resolved
}

if ($Authorization -cne 'PROMOTE') { throw 'Exact PROMOTE authorization is required.' }
if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) { throw "Candidate missing: $CandidateRoot" }
if (-not (Test-Path -LiteralPath $BuildsetPath -PathType Leaf)) { throw "Build-set marker missing: $BuildsetPath" }

$CandidateMarker = Join-Path $CandidateRoot "PHANTOM_${Revision}_CANDIDATE.txt"
$Required = @(
    $CandidateMarker,
    (Join-Path $CandidateRoot 'Cubetown.exe'),
    (Join-Path $CandidateRoot 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe'),
    (Join-Path $CandidateRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.pak'),
    (Join-Path $CandidateRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas'),
    (Join-Path $CandidateRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc')
)
foreach ($Path in $Required) { if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Candidate file missing: $Path" } }
$MarkerText = Get-Content -LiteralPath $CandidateMarker -Raw
if ($MarkerText -notmatch "PHANTOM $Revision CANDIDATE" -or $MarkerText -notmatch 'public_title=Shadowbearer') {
    throw 'Candidate identity marker is invalid.'
}
$Foreign = @(Get-ChildItem -LiteralPath $CandidateRoot -Recurse -File -Filter '*-Win64-Shipping.exe' |
    Where-Object { $_.Name -ne 'Cubetown-Win64-Shipping.exe' })
if ($Foreign.Count -gt 0) { throw "Candidate contains foreign game binaries: $($Foreign.Name -join ', ')" }

$Previous = Get-Content -LiteralPath $BuildsetPath -Raw | ConvertFrom-Json
foreach ($Game in @($Previous.games | Where-Object { $_.id -ne 'cubetown' })) {
    $RetainedRoot = Assert-Within (Join-Path $WindowsRoot $Game.id) $WindowsRoot "Retained game $($Game.id)"
    $RetainedExe = Join-Path $RetainedRoot $Game.executable
    if (-not (Test-Path -LiteralPath $RetainedExe -PathType Leaf)) { throw "Retained game is missing: $RetainedExe" }
    $Hash = (Get-FileHash -LiteralPath $RetainedExe -Algorithm SHA256).Hash
    if (-not $Hash.Equals([string]$Game.sha256, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Retained game changed unexpectedly: $($Game.id)"
    }
}

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Assert-Within (Join-Path $BackupParent "shadowbearer-v25r25-$Timestamp") $BackupParent 'Rollback checkpoint'
$BackupGame = Assert-Within (Join-Path $BackupRoot 'cubetown') $BackupRoot 'Rollback game tree'
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
Copy-Item -LiteralPath $BuildsetPath -Destination (Join-Path $BackupRoot 'PHANTOMPLAY_BUILDSET.json')
Get-Process -Name 'Cubetown' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop

$MovedPrevious = $false
try {
    if (Test-Path -LiteralPath $InstalledRoot -PathType Container) {
        Move-Item -LiteralPath $InstalledRoot -Destination $BackupGame
        $MovedPrevious = $true
    }
    New-Item -ItemType Directory -Path $InstalledRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $CandidateRoot '*') -Destination $InstalledRoot -Recurse -Force
    Remove-Item -LiteralPath (Join-Path $InstalledRoot "PHANTOM_${Revision}_CANDIDATE.txt") -Force
    $PromotedUtc = [DateTime]::UtcNow.ToString('o')
    @(
        "PHANTOM $Revision INSTALLED",
        "public_title=Shadowbearer: Dawn's Return",
        'internal_compatibility_id=cubetown',
        'runtime=native-unreal-engine-5.8',
        "promoted_utc=$PromotedUtc",
        'authorization=PROMOTE'
    ) | Set-Content -LiteralPath (Join-Path $InstalledRoot "PHANTOM_${Revision}_INSTALLED.txt") -Encoding UTF8

    $Files = @(Get-ChildItem -LiteralPath $InstalledRoot -Recurse -File)
    $Launcher = Join-Path $InstalledRoot 'Cubetown.exe'
    $Shipping = Join-Path $InstalledRoot 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe'
    $Pak = Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.pak'
    $Ucas = Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas'
    $Utoc = Join-Path $InstalledRoot 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc'
    $Result = [ordered]@{
        id = 'cubetown'
        public_title = "Shadowbearer: Dawn's Return"
        revision = $Revision
        executable = 'Cubetown.exe'
        sha256 = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash
        shipping_sha256 = (Get-FileHash -LiteralPath $Shipping -Algorithm SHA256).Hash
        pak_sha256 = (Get-FileHash -LiteralPath $Pak -Algorithm SHA256).Hash
        ucas_sha256 = (Get-FileHash -LiteralPath $Ucas -Algorithm SHA256).Hash
        utoc_sha256 = (Get-FileHash -LiteralPath $Utoc -Algorithm SHA256).Hash
        file_count = $Files.Count
        total_bytes = [long](($Files | Measure-Object -Property Length -Sum).Sum)
    }
    $Retained = @($Previous.games | Where-Object { $_.id -ne 'cubetown' })
    $NewBuildset = [ordered]@{
        schema_version = 2
        revision = "$([string]$Previous.revision)+SHADOWBEARER-$Revision"
        base_revision = [string]$Previous.revision
        shadowbearer_revision = $Revision
        promoted_utc = $PromotedUtc
        engine = 'Unreal Engine 5.8.1'
        source_candidate = $CandidateRoot
        authorization = 'PROMOTE'
        games = @([pscustomobject]$Result) + $Retained
        verification = [ordered]@{
            shadowbearer_shipping_package = 'passed'
            shadowbearer_installed_hashes = 'passed'
            retained_game_hashes = 'passed'
            native_only = $true
        }
        rollback = $BackupGame
    }
    $NewBuildset | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $BuildsetPath -Encoding UTF8
    [pscustomobject]@{ status='promoted'; revision=$Revision; installed_root=$InstalledRoot; rollback=$BackupGame; game=$Result } |
        ConvertTo-Json -Depth 8
} catch {
    $Failure = $_
    $VerifiedInstall = Assert-Within $InstalledRoot $WindowsRoot 'Partial install'
    if (Test-Path -LiteralPath $VerifiedInstall -PathType Container) { Remove-Item -LiteralPath $VerifiedInstall -Recurse -Force }
    if ($MovedPrevious -and (Test-Path -LiteralPath $BackupGame -PathType Container)) { Move-Item -LiteralPath $BackupGame -Destination $InstalledRoot }
    Copy-Item -LiteralPath (Join-Path $BackupRoot 'PHANTOMPLAY_BUILDSET.json') -Destination $BuildsetPath -Force
    throw "Shadowbearer promotion failed; prior install restored. $($Failure.Exception.Message)"
}
