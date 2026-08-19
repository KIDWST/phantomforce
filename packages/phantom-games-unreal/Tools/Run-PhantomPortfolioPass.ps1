param(
    [string]$EngineRoot = 'H:\UE_5.8',
    [ValidatePattern('^V[0-9]+R[0-9]+$')][string]$Revision = 'V11R16',
    [switch]$SkipPackage,
    [switch]$SkipGameplayProof
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$Project = Join-Path $ProjectRoot 'PhantomGames.uproject'
$Games = @(
    @{Id='phantom-strike'; Target='PhantomStrike'; World='PhantomStrike_World'},
    @{Id='phantom-ages'; Target='PhantomAges'; World='PhantomAges_World'},
    @{Id='phantom-legends'; Target='PhantomLegends'; World='PhantomLegends_World'},
    @{Id='cubetown'; Target='Cubetown'; World='CubeTown_World'}
)

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' PHANTOMPLAY // FOUR-GAME PARALLEL DEVELOPMENT PASS' -ForegroundColor Cyan
Write-Host ' Strike + Ages + Legends + CubeTown are one portfolio gate.' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

if(-not(Test-Path -LiteralPath $Project)){throw "Missing project: $Project"}
foreach($Game in $Games){
    $Target = Join-Path $ProjectRoot ("Source\\" + $Game.Target + '.Target.cs')
    $World = Join-Path $ProjectRoot ("Content\\Phantom\\Worlds\\" + $Game.World + '.umap')
    if(-not(Test-Path -LiteralPath $Target)){throw "Missing game target: $Target"}
    if(-not(Test-Path -LiteralPath $World)){throw "Missing persistent world: $World"}
}
Write-Host 'Four-game identity/world preflight PASS.' -ForegroundColor Green

# One shared pass, four games. Build-Flagships now requires the checked-in
# current patch chain for all four games before its content gate can pass.
$Build = Join-Path $ProjectRoot 'Build-Flagships.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Build -CompileOnly -EngineRoot $EngineRoot
if($LASTEXITCODE -ne 0){throw "Four-game compile/content pass failed: $LASTEXITCODE"}

if($SkipPackage){
    Write-Host 'Parallel source/content pass complete; packaging skipped by request.' -ForegroundColor Yellow
    exit 0
}

$Package = Join-Path $ProjectRoot 'Tools\PackageCandidatesV11R3.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Package -EngineRoot $EngineRoot -Revision $Revision
if($LASTEXITCODE -ne 0){throw "Four-game candidate packaging failed: $LASTEXITCODE"}

$CandidateRoot = Join-Path $ProjectRoot ("CandidateBuilds\\" + $Revision)
$ProofRoot = Join-Path $ProjectRoot ("Saved\\PhantomGameplayProof" + $Revision)

if(-not $SkipGameplayProof){
    $Capture = Join-Path $ProjectRoot 'Tools\Capture-GameplayProof.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Capture -ProjectRoot $ProjectRoot -BuildRoot $CandidateRoot -ProofRoot $ProofRoot -CaptureDelaySeconds 12 -TimeoutSeconds 50
    if($LASTEXITCODE -ne 0){throw "Four-game gameplay proof failed: $LASTEXITCODE"}

    $Proofs = @(Get-ChildItem -LiteralPath $ProofRoot -File -Filter '*-GAMEPLAY.png' -ErrorAction SilentlyContinue)
    if($Proofs.Count -ne 4){throw "Portfolio gate requires exactly four gameplay proofs; found $($Proofs.Count)."}

    $VisualGate = Join-Path $ProjectRoot 'Tools\Test-GameplayFrame.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $VisualGate -ProofRoot $ProofRoot
    if($LASTEXITCODE -ne 0){throw "Four-game visual gate failed: $LASTEXITCODE"}
}

$Report = Join-Path $ProjectRoot ("Saved\\PHANTOM_PORTFOLIO_" + $Revision + '_REPORT.txt')
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
Set-Content -LiteralPath $Report -Encoding UTF8 -Value @(
    'PHANTOMPLAY FOUR-GAME PARALLEL PASS',
    "revision=$Revision",
    "generated=$([DateTime]::Now.ToString('s'))",
    'games=phantom-strike,phantom-ages,phantom-legends,cubetown',
    'identity_preflight=PASS',
    'compile_and_content_pipeline=PASS',
    'candidate_packaging=PASS',
    ('gameplay_proof=' + $(if($SkipGameplayProof){'SKIPPED'}else{'PASS_4_OF_4'})),
    'promotion=NOT_PERFORMED'
)
Write-Host "Four-game parallel pass complete. Report: $Report" -ForegroundColor Green
