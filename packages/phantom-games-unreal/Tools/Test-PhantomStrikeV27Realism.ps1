[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$Source = Join-Path $ProjectRoot 'Source\PhantomGames\Private\Strike\PhantomStrikeDirector.cpp'
$Header = Join-Path $ProjectRoot 'Source\PhantomGames\Public\Strike\PhantomStrikeDirector.h'

function Assert-Contains {
    param([string]$Text, [string]$Needle, [string]$Label)
    if (-not $Text.Contains($Needle, [StringComparison]::Ordinal)) {
        throw "Missing V27 realism contract: $Label"
    }
}

foreach ($Asset in @(
    'Content\Characters\Mannequins\Meshes\SKM_Manny_Simple.uasset',
    'Content\Characters\Mannequins\Meshes\SKM_Quinn_Simple.uasset',
    'Content\Weapons\Rifle\Meshes\SM_Rifle.uasset',
    'Content\Weapons\Pistol\Meshes\SM_Pistol.uasset',
    'Content\Variant_Shooter\Anims\ABP_TP_Rifle.uasset',
    'Content\ProductAssets\Mesh\SM_Building.uasset',
    'Content\ProductAssets\Mesh\SM_Car.uasset'
)) {
    $Path = Join-Path $ProjectRoot $Asset
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required realism asset is missing: $Path"
    }
    if ((Get-Item -LiteralPath $Path).Length -lt 4096) {
        throw "Required realism asset is unexpectedly small: $Path"
    }
}

$SourceText = Get-Content -LiteralPath $Source -Raw
$HeaderText = Get-Content -LiteralPath $Header -Raw
Assert-Contains $SourceText 'SKM_Manny_Simple.SKM_Manny_Simple' 'animated player/enemy operator'
Assert-Contains $SourceText 'SKM_Quinn_Simple.SKM_Quinn_Simple' 'animated squad operator'
Assert-Contains $SourceText 'ABP_TP_Rifle.ABP_TP_Rifle_C' 'shooter locomotion graph'
Assert-Contains $SourceText '/Game/Weapons/Rifle/Meshes/SM_Rifle.SM_Rifle' 'authored rifle'
Assert-Contains $SourceText '/Game/Weapons/Pistol/Meshes/SM_Pistol.SM_Pistol' 'authored pistol'
Assert-Contains $SourceText '/Game/ProductAssets/Mesh/SM_Car.SM_Car' 'PBR street vehicles'
Assert-Contains $SourceText '/Game/ProductAssets/Mesh/SM_Building.SM_Building' 'PBR architecture'
Assert-Contains $SourceText 'RightForearm->SetVisibility(!bUsingRealisticBodyRig)' 'primitive arm suppression'
Assert-Contains $HeaderText 'void BuildV27BlackridgeRealism();' 'V27 runtime layer declaration'

$FunctionStart = $SourceText.IndexOf('void APhantomStrikeDirector::BuildV27BlackridgeRealism()', [StringComparison]::Ordinal)
if ($FunctionStart -lt 0) { throw 'V27 Blackridge realism function is missing.' }
$FunctionBody = $SourceText.Substring($FunctionStart)
if ($FunctionBody.Contains('SpawnShape(EPhantomPrimitive::Cube', [StringComparison]::Ordinal)) {
    throw 'V27 hero environment still contains a visible cube primitive.'
}

Write-Output 'PHANTOMSTRIKE_V27_REALISM_PASS'
