param(
    [string]$EngineRoot = 'H:\UE_5.8',
    [ValidatePattern('^V28R\d+$')][string]$Revision = 'V28R1'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$Project = Join-Path $ProjectRoot 'PhantomGames.uproject'
$Artifact = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "BuildArtifacts\$Revision\phantom-strike"))
$Candidate = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "CandidateBuilds\$Revision\phantom-strike"))
$RunUat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'

foreach ($TargetPath in @($Artifact, $Candidate)) {
    if (-not $TargetPath.StartsWith($ProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe PhantomStrike candidate target: $TargetPath"
    }
    if (Test-Path -LiteralPath $TargetPath) {
        Remove-Item -LiteralPath $TargetPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
}

& $RunUat -WaitForUATMutex BuildCookRun "-project=$Project" '-target=PhantomStrike' -noP4 -platform=Win64 `
    -clientconfig=Shipping -build -nocompileeditor -cook -stage -pak -iostore -archive `
    "-archivedirectory=$Artifact" -utf8output
if ($LASTEXITCODE -ne 0) {
    throw "PhantomStrike $Revision packaging failed: $LASTEXITCODE"
}

$BuiltPlayer = Get-ChildItem -LiteralPath $Artifact -Recurse -File -Filter 'PhantomStrike.exe' | Select-Object -First 1
if (-not $BuiltPlayer) { throw "Packaged PhantomStrike.exe not found under $Artifact" }

$PackageRoot = $BuiltPlayer.Directory
while ($PackageRoot.Parent -and $PackageRoot.FullName.StartsWith($Artifact, [StringComparison]::OrdinalIgnoreCase) -and -not (Test-Path -LiteralPath (Join-Path $PackageRoot.FullName 'Engine'))) {
    $PackageRoot = $PackageRoot.Parent
}
Copy-Item -Path (Join-Path $PackageRoot.FullName '*') -Destination $Candidate -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $Candidate 'PhantomStrike.exe'))) {
    Copy-Item -LiteralPath $BuiltPlayer.FullName -Destination (Join-Path $Candidate 'PhantomStrike.exe') -Force
}

Set-Content -LiteralPath (Join-Path $Candidate "PHANTOM_${Revision}_CANDIDATE.txt") -Encoding UTF8 -Value @(
    "PHANTOM $Revision CANDIDATE"
    'game=phantom-strike'
    'visual_profile=blackridge-natural-first-person-v28'
    'source_floor=V27R2'
    "built=$([DateTime]::Now.ToString('s'))"
    'promotion=automatic_after_verified_local_gates'
)

$Critical = [ordered]@{
    launcher = 'PhantomStrike.exe'
    shipping = 'PhantomGames\Binaries\Win64\PhantomStrike-Win64-Shipping.exe'
    pak = 'PhantomGames\Content\Paks\PhantomGames-Windows.pak'
    ucas = 'PhantomGames\Content\Paks\PhantomGames-Windows.ucas'
    utoc = 'PhantomGames\Content\Paks\PhantomGames-Windows.utoc'
}
$Hashes = [ordered]@{}
foreach ($Name in $Critical.Keys) {
    $Path = Join-Path $Candidate $Critical[$Name]
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing candidate file: $Path" }
    $Hashes[$Name] = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
$Files = @(Get-ChildItem -LiteralPath $Candidate -Recurse -File)
$Manifest = [ordered]@{
    schema_version = 1
    revision = $Revision
    game = 'phantom-strike'
    visual_profile = 'blackridge-natural-first-person-v28'
    generated_utc = [DateTime]::UtcNow.ToString('o')
    file_count_before_manifest = $Files.Count
    total_bytes_before_manifest = [long](($Files | Measure-Object -Property Length -Sum).Sum)
    paths = $Critical
    sha256 = $Hashes
}
$Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Candidate "PHANTOM_${Revision}_MANIFEST.json") -Encoding UTF8

Write-Host "PHANTOMSTRIKE_${Revision}_PACKAGE_PASS $Candidate" -ForegroundColor Green
Write-Host "FILES_BEFORE_MANIFEST=$($Manifest.file_count_before_manifest) BYTES_BEFORE_MANIFEST=$($Manifest.total_bytes_before_manifest)" -ForegroundColor Green
Write-Host "LAUNCHER_SHA256=$($Hashes.launcher)" -ForegroundColor Green
Write-Host "SHIPPING_SHA256=$($Hashes.shipping)" -ForegroundColor Green
