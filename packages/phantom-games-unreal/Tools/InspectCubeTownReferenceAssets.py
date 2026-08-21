"""Record bounds/materials for the authored assets considered for CubeTown's reference-quality opening."""
from __future__ import annotations

import json
import os

import unreal


ASSETS = (
    "/Game/Phantom/Curated/Cube/fountain-square-detail/StaticMeshes/fountain-square-detail",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Gazebo",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight",
    "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_1",
    "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_1",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_2",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_3",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_4",
    "/Game/Phantom/Curated/Cube/SM_Cube_Bridge",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_GrandBridge",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_Stream_120m",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamLandmarkTree_A",
    "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_FlowerGarden",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_MarketPavilion",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_LanternArch",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_01",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_02",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_03",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_04",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_05",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_06",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeTavern",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeBlacksmith",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeWorkshop",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeInn",
    "/Game/Phantom/Generated/Common/SM_StorybookTree_A",
    "/Game/Phantom/Generated/Common/SM_StorybookTree_B",
    "/Game/Phantom/Generated/Cubetown/V9/Nature/SM_V9_RoseTree_0",
    "/Game/Phantom/Generated/Cubetown/V9/Nature/SM_V9_RoseTree_1",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownFountain",
    "/Game/Phantom/Curated/Cube/SM_Cube_Well",
    "/Game/Phantom/Generated/Cubetown/V8/Setpieces/SM_V8_HeartstonePlaza",
    "/Game/Phantom/Generated/Cubetown/V8/Setpieces/SM_V8_HeartstonePath",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_TownSquare",
    "/Game/Phantom/Curated/Cube/SM_Cube_House_A",
    "/Game/Phantom/Curated/Cube/SM_Cube_House_B",
    "/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith",
    "/Game/Phantom/Curated/Cube/SM_Cube_Tavern",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_House_C",
    "/Game/Phantom/Generated/Cubetown/V17/SM_V17_DioramaGroundPatch",
    "/Game/Phantom/Generated/Cubetown/V12/SM_V12_GroundPatch",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_B",
    "/Game/Phantom/Generated/Common/SM_Bush_A",
    "/Game/Phantom/Generated/Common/SM_FlowerPatch_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamHerbPatch_A",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_RuinArch",
    "/Game/Phantom/Generated/Legends/V10/Setpieces/SM_V10_AncientRuin",
    "/Game/Phantom/Generated/Legends/V10/Setpieces/SM_V10_CrystalMonolith",
    "/Game/Phantom/Curated/Fab/Legends/SM_Fab_Crystal",
    "/Game/Phantom/Curated/Legends/SM_Legends_Gate",
    "/Game/Phantom/Curated/Legends/SM_Legends_Ruin",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Gate",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Chest",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownShrine",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A",
    "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerRed",
    "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerBlue",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_B",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_C",
    "/Game/Phantom/Generated/Cubetown/Characters/SM_Gloomling",
    "/Game/Phantom/Generated/Cubetown/Characters/SM_Roller",
    "/Game/Phantom/Generated/Cubetown/Characters/SM_BloomWisp",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownGuardian",
)

report = []
for path in ASSETS:
    asset = unreal.EditorAssetLibrary.load_asset(path)
    item = {"path": path, "loaded": bool(asset)}
    if isinstance(asset, unreal.StaticMesh):
        bounds = asset.get_bounds()
        extent = bounds.box_extent
        item["bounds_size"] = [
            round(float(extent.x) * 2.0, 2),
            round(float(extent.y) * 2.0, 2),
            round(float(extent.z) * 2.0, 2),
        ]
        item["materials"] = [
            slot.material_interface.get_path_name() if slot.material_interface else ""
            for slot in asset.get_editor_property("static_materials")
        ]
    report.append(item)

target = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownReferenceAssets.json")
with open(target, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
unreal.log("CUBETOWN REFERENCE ASSET INSPECTION PASS: " + target)
