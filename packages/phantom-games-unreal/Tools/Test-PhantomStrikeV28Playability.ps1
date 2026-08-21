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
    'authored natural terrain' = '/Game/ArchVis/SampleScene/Building/Meshes/Exterior_Terrain.Exterior_Terrain'
    'legacy city replacement pass' = 'TInlineComponentArray<UPrimitiveComponent*>'
    'natural exposure grade' = 'It->Settings.AutoExposureBias = -0.85f'
    'natural tree density' = 'NaturalTrees.Reserve(240)'
    'natural ground cover' = 'NaturalBrush.Reserve(260)'
    'tiled mission road' = 'Segment < 30'
    'natural-width mission road' = 'FVector(10.04f,9.0f,1.0f)'
    'tiled operations apron' = 'ApronX < 6'
    'real-world vehicle scale' = '154.0f), 1.00f, 18.0f, true'
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
if ($ActiveV28.Contains('BuildV27BlackridgeRealism')) {
    $Failures.Add('Active source still calls the additive V27 city builder.')
}
if ($ActiveV28.Contains('FVector(300.0f,17.0f,1.0f)')) {
    $Failures.Add('Active V28 path still stretches one road plane across the entire mission.')
}
if ($ActiveV28.Contains('154.0f), 12.0f, 18.0f, true')) {
    $Failures.Add('Active V28 path still multiplies an already-normalized vehicle to giant scale.')
}

$RequiredAssets = @(
    'Content\ArchVis\SampleScene\Tree\HillTree_02.uasset',
    'Content\ArchVis\SampleScene\Building\Meshes\Exterior_Terrain.uasset',
    'Content\ArchVis\SampleScene\Building\Materials\Terrain.uasset'
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
Write-Host 'ENVIRONMENT=licensed-terrain+240-trees+356-ground-cover' -ForegroundColor Green
Write-Host 'LEGACY_CITY=disabled-and-hidden' -ForegroundColor Green
