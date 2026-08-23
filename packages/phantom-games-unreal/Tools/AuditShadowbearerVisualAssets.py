"""Audit candidate Shadowbearer meshes before they are allowed into the opening frame."""
from __future__ import annotations

import json
import os
import traceback

import unreal


ASSETS = (
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_1",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_2",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_3",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_4",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Inn",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Blacksmith",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Fence",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square",
    "/Game/Phantom/Generated/Common/SM_StorybookTree_A",
    "/Game/Phantom/Generated/Common/SM_StorybookTree_B",
    "/Game/Phantom/Generated/Common/SM_Bush_A",
    "/Game/Phantom/Generated/Common/SM_LanternPost_A",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroCap",
    "/Game/Phantom/External/CC0/Aliases/Hair",
    "/Game/Phantom/External/CC0/Aliases/Hat",
    "/Game/Phantom/Characters/Production/_Import_Barbarian_GLTF/Barbarian/StaticMeshes/Barbarian_Hat",
    "/Game/Phantom/Characters/Production/_Import_Mage_GLTF/Mage/StaticMeshes/Mage_Hat",
    "/Game/Phantom/Characters/Production/_Import_SkeletonRogue_GLTF/Skeleton_Rogue/StaticMeshes/Skeleton_Rogue_Hood",
    "/Game/Phantom/Curated/Cube/SM_Cube_House_A",
    "/Game/Phantom/Curated/Cube/SM_Cube_House_B",
    "/Game/Phantom/Curated/Cube/SM_Cube_Tavern",
    "/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith",
    "/Game/Phantom/Curated/Cube/SM_Cube_Market",
    "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownHouse_A",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownHouse_B",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownInn",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Coral_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Crimson_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Lavender_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamWindmill_A",
)


def asset_record(path: str) -> dict:
    asset = unreal.load_asset(path)
    if not asset:
        return {"path": path, "loaded": False}
    record = {"path": path, "loaded": True, "class": asset.get_class().get_name()}
    if isinstance(asset, unreal.StaticMesh):
        bounds = asset.get_bounds()
        record["origin"] = [
            round(float(bounds.origin.x), 2),
            round(float(bounds.origin.y), 2),
            round(float(bounds.origin.z), 2),
        ]
        record["size"] = [
            round(float(bounds.box_extent.x) * 2.0, 2),
            round(float(bounds.box_extent.y) * 2.0, 2),
            round(float(bounds.box_extent.z) * 2.0, 2),
        ]
        record["materials"] = []
        for slot in asset.get_editor_property("static_materials") or []:
            material = slot.get_editor_property("material_interface")
            material_path = material.get_path_name() if material else None
            textures = []
            if material:
                try:
                    textures = sorted({texture.get_path_name() for texture in unreal.MaterialEditingLibrary.get_used_textures(material) if texture})
                except Exception:
                    textures = []
            record["materials"].append({"path": material_path, "textures": textures})
    return record


report_path = os.path.abspath(os.path.join(unreal.Paths.project_saved_dir(), "ShadowbearerVisualAssetAudit.json"))
report = {"status": "RUNNING", "assets": [], "opening_actors": [], "opening_mesh_counts": {}}
try:
    report["assets"] = [asset_record(path) for path in ASSETS]
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level("/Game/Phantom/Worlds/CubeTown_World")
    for actor in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors() or []:
        location = actor.get_actor_location()
        label = actor.get_actor_label()
        if not (-3200.0 <= float(location.x) <= 3200.0 and -12000.0 <= float(location.y) <= 3200.0):
            continue
        try:
            component = actor.get_editor_property("static_mesh_component")
        except Exception:
            component = None
        mesh = component.get_editor_property("static_mesh") if component else None
        mesh_name = mesh.get_path_name() if mesh else None
        if mesh_name:
            report["opening_mesh_counts"][mesh_name] = report["opening_mesh_counts"].get(mesh_name, 0) + 1
        origin, extent = actor.get_actor_bounds(False)
        report["opening_actors"].append({
            "label": label,
            "location": [round(float(location.x), 1), round(float(location.y), 1), round(float(location.z), 1)],
            "bounds_size": [round(float(extent.x) * 2.0, 1), round(float(extent.y) * 2.0, 1), round(float(extent.z) * 2.0, 1)],
            "mesh": mesh_name,
            "tags": [str(value) for value in (actor.get_editor_property("tags") or [])],
            "materials": [
                component.get_material(index).get_path_name() if component.get_material(index) else None
                for index in range(component.get_num_materials())
            ] if component else [],
        })
    report["opening_actors"].sort(key=lambda item: item["label"])
    report["opening_mesh_counts"] = dict(sorted(report["opening_mesh_counts"].items()))
    report["status"] = "PASS"
except Exception as exc:
    report["status"] = "FAIL"
    report["error"] = str(exc)
    report["traceback"] = traceback.format_exc()
    raise
finally:
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

unreal.log("SHADOWBEARER VISUAL ASSET AUDIT %s: %s" % (report["status"], report_path))
