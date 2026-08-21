"""Record the real dimensions/material coverage of candidate CubeTown production meshes."""
from __future__ import annotations

import json
import os

import unreal


ASSETS = (
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_1",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_2",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_3",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_4",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Inn",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Blacksmith",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Well",
    "/Game/Phantom/Curated/Cube/SM_Cube_House_A",
    "/Game/Phantom/Curated/Cube/SM_Cube_House_B",
    "/Game/Phantom/Curated/Cube/SM_Cube_Market",
    "/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith",
    "/Game/Phantom/Curated/Cube/SM_Cube_Well",
    "/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Cottage",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_01",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeInn",
    "/Game/Phantom/Generated/Cubetown/V17/SM_V17_DioramaGroundPatch",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_Stream_120m",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall",
    "/Game/Phantom/Generated/Common/SM_StorybookTree_A",
    "/Game/Phantom/Generated/Common/SM_StorybookTree_B",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_B",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Gate",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Keep",
    "/Game/Phantom/Curated/Ages/SM_Ages_Gate",
    "/Game/Phantom/Curated/Ages/SM_Ages_Tower",
    "/Game/Phantom/Curated/Ages/SM_Ages_Wall",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Bell_Tower",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A/StaticMeshes/magic_ring",
    "/Game/Phantom/External/Quaternius/CubeTownGuardianV25/SM_CT25_RiftGuardian",
    "/Game/Phantom/External/KenneyNatureV26/SM_CT26_StoneBridge",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bridge",
    "/Game/Phantom/Curated/Cube/SM_Cube_Bridge",
    "/Game/Phantom/Generated/Legends/V9/Units/SM_V9_BlueGolem",
    "/Game/Phantom/Generated/Legends/Characters/SM_RiftBrute",
)


report = []
for path in ASSETS:
    asset = unreal.EditorAssetLibrary.load_asset(path)
    entry = {"path": path, "loaded": bool(asset)}
    if isinstance(asset, unreal.StaticMesh):
        bounds = asset.get_bounds()
        size = bounds.box_extent * 2.0
        entry.update(
            {
                "size": [round(float(size.x), 2), round(float(size.y), 2), round(float(size.z), 2)],
                "origin": [
                    round(float(bounds.origin.x), 2),
                    round(float(bounds.origin.y), 2),
                    round(float(bounds.origin.z), 2),
                ],
                "materials": len(asset.get_editor_property("static_materials") or []),
            }
        )
    report.append(entry)

target = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownAssetDimensions.json")
with open(target, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
unreal.log("CUBETOWN ASSET INSPECTION PASS: " + target)
