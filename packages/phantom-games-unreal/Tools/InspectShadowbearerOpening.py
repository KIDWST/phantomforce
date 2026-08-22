"""Read-only inventory of the native Shadowbearer opening district.

Runs in Unreal Editor Python and writes a compact JSON report used to reject
placeholder surfaces/meshes before a packaged build is promoted.
"""
from __future__ import annotations

import json
import math
import os

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
SPAWN = (0.0, -10500.0)
REPORT = os.path.join(
    os.path.abspath(unreal.Paths.project_saved_dir()),
    "ShadowbearerOpeningInspection.json",
)

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def vector(value):
    return [round(float(value.x), 2), round(float(value.y), 2), round(float(value.z), 2)]


def mesh_and_materials(actor):
    try:
        component = actor.get_editor_property("static_mesh_component")
        mesh = component.get_editor_property("static_mesh") if component else None
        if not mesh:
            return "", []
        materials = []
        for index in range(component.get_num_materials()):
            material = component.get_material(index)
            materials.append(material.get_path_name() if material else "")
        return mesh.get_path_name(), materials
    except Exception:
        return "", []


def record(actor):
    location = actor.get_actor_location()
    origin, extent = actor.get_actor_bounds(False)
    mesh, materials = mesh_and_materials(actor)
    return {
        "label": actor.get_actor_label(),
        "mesh": mesh,
        "materials": materials,
        "location": vector(location),
        "bounds": vector(unreal.Vector(extent.x * 2.0, extent.y * 2.0, extent.z * 2.0)),
        "scale": vector(actor.get_actor_scale3d()),
        "distance": round(math.hypot(float(location.x) - SPAWN[0], float(location.y) - SPAWN[1]), 2),
        "tags": [str(value) for value in (actor.get_editor_property("tags") or [])],
    }


ASSETS = (
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_1",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_2",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_3",
    "/Game/Phantom/External/Quaternius/MedievalVillage/House_4",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Inn",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Blacksmith",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Bell_Tower",
    "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_1",
    "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Gazebo",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight",
    "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeWorkshop",
    "/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeTavern",
    "/Game/Phantom/Generated/Cubetown/V9/Setpieces/SM_V9_HeartTree",
    "/Game/Phantom/Generated/Cubetown/V8/Setpieces/SM_V8_HeartstonePath",
    "/Game/Phantom/Generated/Cubetown/V8/Setpieces/SM_V8_HeartstonePlaza",
    "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_StoneRoad_120m",
    "/Game/Phantom/Generated/Cubetown/SM_CubetownFountain",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A",
    "/Game/Phantom/External/CC0/Aliases/Hair",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/StaticMeshes/Rogue_Cape",
)


def asset_record(path):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if not isinstance(asset, unreal.StaticMesh):
        return None
    bounds = asset.get_bounds()
    return {
        "path": path,
        "bounds": vector(
            unreal.Vector(
                bounds.box_extent.x * 2.0,
                bounds.box_extent.y * 2.0,
                bounds.box_extent.z * 2.0,
            )
        ),
        "material_slots": [
            str(slot.material_slot_name)
            for slot in (asset.get_editor_property("static_materials") or [])
        ],
        "materials": [
            slot.material_interface.get_path_name() if slot.material_interface else ""
            for slot in (asset.get_editor_property("static_materials") or [])
        ],
    }


if not level.load_level(WORLD):
    raise RuntimeError("Could not load " + WORLD)

near = []
for actor in actors.get_all_level_actors() or []:
    item = record(actor)
    if item["mesh"] and item["distance"] <= 9000.0:
        near.append(item)
near.sort(key=lambda item: (item["distance"], item["label"]))

result = {
    "world": WORLD,
    "spawn": list(SPAWN),
    "near_actor_count": len(near),
    "near": near,
    "candidate_assets": [item for item in (asset_record(path) for path in ASSETS) if item],
}
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
unreal.log("SHADOWBEARER OPENING INSPECTION PASS " + REPORT)
