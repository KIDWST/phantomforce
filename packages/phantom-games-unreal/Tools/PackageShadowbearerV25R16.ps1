[CmdletBinding()]
param(
    [string]$EngineRoot = 'H:\UE_5.8',
    [switch]$UseExistingCook
)

$ErrorActionPreference = 'Stop'
$Revision = 'V25R16'
$ReleaseName = 'Shadowbearer-Dawns-Return-V25R16'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$Project = Join-Path $ProjectRoot 'PhantomGames.uproject'
$Artifact = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "BuildArtifacts\$ReleaseName\cubetown"))
$Candidate = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "CandidateBuilds\$ReleaseName\cubetown"))
$RunUat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'

foreach ($TargetPath in @($Artifact, $Candidate)) {
    if (-not $TargetPath.StartsWith($ProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe Shadowbearer package target: $TargetPath"
    }
    if (Test-Path -LiteralPath $TargetPath) {
        Remove-Item -LiteralPath $TargetPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
}

$BuildCookArgs = @(
    'BuildCookRun', "-project=$Project", '-target=Cubetown', '-noP4', '-platform=Win64',
    '-clientconfig=Shipping'
)
if ($UseExistingCook) {
    $BuildCookArgs += @('-skipbuild', '-skipcook')
} else {
    $BuildCookArgs += @('-build', '-nocompileeditor', '-cook')
}
$BuildCookArgs += @('-stage', '-pak', '-iostore', '-archive', "-archivedirectory=$Artifact", '-utf8output')
& $RunUat @BuildCookArgs
if ($LASTEXITCODE -ne 0) {
    throw "Shadowbearer $Revision packaging failed: $LASTEXITCODE"
}

$BuiltPlayer = Get-ChildItem -LiteralPath $Artifact -Recurse -File -Filter 'Cubetown.exe' |
    Select-Object -First 1
if (-not $BuiltPlayer) {
    throw "Packaged Cubetown.exe compatibility launcher not found under $Artifact"
}

$PackageRoot = $BuiltPlayer.Directory
while (
    $PackageRoot.Parent -and
    $PackageRoot.FullName.StartsWith($Artifact, [StringComparison]::OrdinalIgnoreCase) -and
    -not (Test-Path -LiteralPath (Join-Path $PackageRoot.FullName 'Engine'))
) {
    $PackageRoot = $PackageRoot.Parent
}

Copy-Item -Path (Join-Path $PackageRoot.FullName '*') -Destination $Candidate -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $Candidate 'Cubetown.exe'))) {
    Copy-Item -LiteralPath $BuiltPlayer.FullName -Destination (Join-Path $Candidate 'Cubetown.exe') -Force
}

$Marker = Join-Path $Candidate "PHANTOM_${Revision}_CANDIDATE.txt"
@(
    "PHANTOM $Revision CANDIDATE"
    'public_title=Shadowbearer: Dawn''s Return'
    'internal_compatibility_id=cubetown'
    "built=$([DateTime]::UtcNow.ToString('o'))"
    'runtime=native-unreal-engine-5.8'
    'profile=story-first-action-adventure'
) | Set-Content -LiteralPath $Marker -Encoding UTF8

$Files = @(Get-ChildItem -LiteralPath $Candidate -Recurse -File)
$Launcher = Join-Path $Candidate 'Cubetown.exe'
$Shipping = Join-Path $Candidate 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe'
$Pak = Join-Path $Candidate 'PhantomGames\Content\Paks\PhantomGames-Windows.pak'
$Ucas = Join-Path $Candidate 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas'
$Utoc = Join-Path $Candidate 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc'
$Required = @($Launcher, $Shipping, $Pak, $Ucas, $Utoc)
foreach ($Path in $Required) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required Shadowbearer package file missing: $Path"
    }
}

[pscustomobject]@{
    status = 'packaged'
    revision = $Revision
    public_title = "Shadowbearer: Dawn's Return"
    candidate_root = $Candidate
    file_count = $Files.Count
    total_bytes = [long](($Files | Measure-Object -Property Length -Sum).Sum)
    launcher_sha256 = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash
    shipping_sha256 = (Get-FileHash -LiteralPath $Shipping -Algorithm SHA256).Hash
    pak_sha256 = (Get-FileHash -LiteralPath $Pak -Algorithm SHA256).Hash
    ucas_sha256 = (Get-FileHash -LiteralPath $Ucas -Algorithm SHA256).Hash
    utoc_sha256 = (Get-FileHash -LiteralPath $Utoc -Algorithm SHA256).Hash
} | ConvertTo-Json -Depth 4
