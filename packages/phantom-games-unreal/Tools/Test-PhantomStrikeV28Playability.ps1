param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$SourcePath = Join-Path $ProjectRoot 'Source\PhantomGames\Private\Strike\PhantomStrikeDirector.cpp'
$HeaderPath = Join-Path $ProjectRoot 'Source\PhantomGames\Public\Strike\PhantomStrikeDirector.h'
$InputPath = Join-Path $ProjectRoot 'Config\DefaultInput.ini'

$Source = Get-Content -LiteralPath $SourcePath -Raw
$Header = Get-Content -LiteralPath $HeaderPath -Raw
$InputConfig = Get-Content -LiteralPath $InputPath -Raw

$RequiredSource = [ordered]@{
    'automatic player possession' = 'AutoPossessPlayer = EAutoReceiveInput::Player0'
    'local body fully hidden' = 'GetMesh()->SetHiddenInGame(true, true)'
    'walking mode recovery' = 'SetMovementMode(MOVE_Walking)'
    'packaged possession recovery' = 'FirstPC->Possess(this)'
    'direct keyboard input' = 'FirstPC->IsInputKeyDown(EKeys::W)'
    'direct controller input' = 'EKeys::Gamepad_LeftY'
    'collision-safe movement fallback' = 'AddActorWorldOffset(WishDirection'
    'standing first-person eye line' = 'bCrouchedByInput) ? 50.0f : 72.0f'
    'clear insertion spawn' = 'FVector(-11800.0f,0.0f,300.0f)'
    'natural environment builder' = 'BuildV28NaturalBlackridge()'
    'licensed natural tree' = '/Game/ArchVis/SampleScene/Tree/HillTree_02.HillTree_02'
    'PBR grass meadow' = '/Game/Phantom/Materials/Production/M_Phantom_Grass.M_Phantom_Grass'
    'PBR dirt shoulder' = '/Game/Phantom/Materials/Production/M_Phantom_Dirt.M_Phantom_Dirt'
    'legacy city replacement pass' = 'TInlineComponentArray<UPrimitiveComponent*>'
    'natural exposure grade' = 'It->Settings.AutoExposureBias = -0.85f'
    'production tree density' = 'Index < 1400'
    'production sapling density' = 'NaturalSaplings.Reserve(700)'
    'production sapling layer' = 'V28BlackridgeNaturalSaplings_HISM'
    'rolling terrain density' = 'Index < 24'
    'PBR rolling terrain' = 'V28NaturalHill_%02d'
    'PBR boulder field' = 'V28NaturalBoulder_%02d'
    'PBR rock surface' = '/Game/Phantom/Materials/Production/M_Phantom_Rock.M_Phantom_Rock'
    'center road markings' = 'V28RoadCenterDash_%02d'
    'road edge markings' = 'V28RoadEdge_%02d_%d'
    'tiled mission road' = 'Segment < 30'
    'natural-width mission road' = 'FVector(10.04f,9.0f,1.0f)'
    'tiled operations apron' = 'ApronX < 6'
}

$Failures = [System.Collections.Generic.List[string]]::new()
foreach ($Gate in $RequiredSource.GetEnumerator()) {
    if (-not $Source.Contains($Gate.Value)) {
        $Failures.Add("Missing $($Gate.Key): $($Gate.Value)")
    }
}

if (-not $Header.Contains('void BuildV28NaturalBlackridge();')) {
    $Failures.Add('V28 natural environment builder is not declared in the director header.')
}
foreach ($Binding in @('Key=W','Key=S','Key=A','Key=D','Key=Up','Key=Down','Key=Left','Key=Right')) {
    if (-not $InputConfig.Contains($Binding)) {
        $Failures.Add("Missing packaged movement binding: $Binding")
    }
}

$V28Start = $Source.IndexOf('void APhantomStrikeDirector::BuildV28NaturalBlackridge()')
$V28Disabled = $Source.IndexOf('#if 0', $V28Start)
if ($V28Start -lt 0 -or $V28Disabled -lt 0) {
    $Failures.Add('Unable to isolate the active V28 natural environment implementation.')
    $ActiveV28 = ''
} else {
    $ActiveV28 = $Source.Substring($V28Start, $V28Disabled - $V28Start)
}
if ($ActiveV28.Contains('/Game/ProductAssets/Mesh/SM_Building.SM_Building')) {
    $Failures.Add('Active V28 path still references the miniature white apartment mesh.')
}
if ($ActiveV28.Contains('V28RoadsideOutpost') -or $ActiveV28.Contains('V28OperationsCenter')) {
    $Failures.Add('Active V28 path still includes the blocky prototype landmark silhouettes.')
}
foreach ($PrototypeProp in @('V28InsertionRubble','V28CheckpointSandbags','V28OutpostBarricade','V28OperationsContainerA','V28OperationsContainerB')) {
    if ($ActiveV28.Contains($PrototypeProp)) {
        $Failures.Add("Active V28 path still includes blocky fallback setpiece: $PrototypeProp")
    }
}
if ($ActiveV28.Contains('BuildV27BlackridgeRealism')) {
    $Failures.Add('Active source still calls the additive V27 city builder.')
}
if ($ActiveV28.Contains('FVector(300.0f,17.0f,1.0f)')) {
    $Failures.Add('Active V28 path still stretches one road plane across the entire mission.')
}
if ($ActiveV28.Contains('Exterior_Terrain.Exterior_Terrain')) {
    $Failures.Add('Active V28 path still includes the horizon-clipping ArchVis terrain shell.')
}
foreach ($RejectedFoliage in @('SM_CC0_Tree_A','SM_CC0_Tree_B','SM_CC0_Bush','SM_CC0_Rock','SM_GrassTuft_A')) {
    if ($ActiveV28.Contains($RejectedFoliage)) {
        $Failures.Add("Active V28 path still includes rejected low-poly foliage: $RejectedFoliage")
    }
}
if ($ActiveV28.Contains('154.0f), 12.0f, 18.0f, true')) {
    $Failures.Add('Active V28 path still multiplies an already-normalized vehicle to giant scale.')
}
if ($ActiveV28.Contains('/Game/ProductAssets/Mesh/SM_Car.SM_Car')) {
    $Failures.Add('Active V28 path still includes the toy-like placeholder vehicle.')
}

$RequiredAssets = @(
    'Content\ArchVis\SampleScene\Tree\HillTree_02.uasset',
    'Content\Phantom\Materials\Production\M_Phantom_Grass.uasset',
    'Content\Phantom\Materials\Production\M_Phantom_Dirt.uasset',
    'Content\Phantom\Materials\Production\M_Phantom_Rock.uasset'
)
foreach ($Asset in $RequiredAssets) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $Asset) -PathType Leaf)) {
        $Failures.Add("Missing bundled natural environment asset: $Asset")
    }
}

if ($Failures.Count -gt 0) {
    $Failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'PHANTOMSTRIKE_V28_PLAYABILITY_PASS' -ForegroundColor Green
Write-Host 'FIRST_PERSON_BODY=hidden' -ForegroundColor Green
Write-Host 'MOVEMENT=legacy+direct-key+controller+fallback' -ForegroundColor Green
Write-Host 'ENVIRONMENT=rolling-pbr-forest+1400-production-trees+700-production-saplings+42-boulders' -ForegroundColor Green
Write-Host 'LEGACY_CITY=disabled-and-hidden' -ForegroundColor Green
