param(
    [string]$EngineRoot = 'H:\UE_5.8',
    [ValidatePattern('^V[0-9]+R[0-9]+$')][string]$Revision = 'V26R1'
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

& $RunUat BuildCookRun "-project=$Project" '-target=PhantomStrike' -noP4 -platform=Win64 `
    -clientconfig=Shipping -build -nocompileeditor -cook -stage -pak -iostore -archive `
    "-archivedirectory=$Artifact" -utf8output
if ($LASTEXITCODE -ne 0) {
    throw "PhantomStrike $Revision packaging failed: $LASTEXITCODE"
}

$BuiltPlayer = Get-ChildItem -LiteralPath $Artifact -Recurse -File -Filter 'PhantomStrike.exe' |
    Select-Object -First 1
if (-not $BuiltPlayer) {
    throw "Packaged PhantomStrike.exe not found under $Artifact"
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
if (-not (Test-Path -LiteralPath (Join-Path $Candidate 'PhantomStrike.exe'))) {
    Copy-Item -LiteralPath $BuiltPlayer.FullName -Destination (Join-Path $Candidate 'PhantomStrike.exe') -Force
}

Set-Content -LiteralPath (Join-Path $Candidate "PHANTOM_${Revision}_CANDIDATE.txt") -Encoding UTF8 -Value @(
    "PHANTOM $Revision CANDIDATE"
    'game=phantom-strike'
    'visual_profile=blackridge-grounded-combat-v26'
    'installed_floor=V25R3'
    "built=$([DateTime]::Now.ToString('s'))"
    'promotion=blocked_until_explicit_human_PROMOTE'
)

$Launcher = Join-Path $Candidate 'PhantomStrike.exe'
$Shipping = Get-ChildItem -LiteralPath $Candidate -Recurse -File -Filter 'PhantomStrike-Win64-Shipping.exe' | Select-Object -First 1
$LauncherHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Launcher).Hash
$ShippingHash = if ($Shipping) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Shipping.FullName).Hash } else { '' }
$Files = Get-ChildItem -LiteralPath $Candidate -Recurse -File
$Bytes = ($Files | Measure-Object -Property Length -Sum).Sum

Write-Host "PHANTOMSTRIKE_${Revision}_PACKAGE_PASS $Candidate" -ForegroundColor Green
Write-Host "FILES=$($Files.Count) BYTES=$Bytes" -ForegroundColor Green
Write-Host "LAUNCHER_SHA256=$LauncherHash" -ForegroundColor Green
Write-Host "SHIPPING_SHA256=$ShippingHash" -ForegroundColor Green
