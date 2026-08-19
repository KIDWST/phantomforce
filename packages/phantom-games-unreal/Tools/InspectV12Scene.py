from __future__ import annotations

import json
import math
import os

import unreal


saved = os.path.abspath(unreal.Paths.project_saved_dir())
report_path = os.path.join(saved, "PhantomV12SceneInspection.json")
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def mesh_path(actor):
    try:
        component = actor.get_editor_property("static_mesh_component")
        mesh = component.get_editor_property("static_mesh") if component else None
        return mesh.get_path_name() if mesh else ""
    except Exception:
        return ""


def actor_record(actor, start):
    location = actor.get_actor_location()
    origin, extent = actor.get_actor_bounds(False)
    scale = actor.get_actor_scale3d()
    return {
        "label": actor.get_actor_label(),
        "mesh": mesh_path(actor),
        "location": [round(float(location.x), 2), round(float(location.y), 2), round(float(location.z), 2)],
        "rotation": [
            round(float(actor.get_actor_rotation().pitch), 2),
            round(float(actor.get_actor_rotation().yaw), 2),
            round(float(actor.get_actor_rotation().roll), 2),
        ],
        "scale": [round(float(scale.x), 5), round(float(scale.y), 5), round(float(scale.z), 5)],
        "bounds": [round(float(extent.x * 2), 2), round(float(extent.y * 2), 2), round(float(extent.z * 2), 2)],
        "distance": round(math.hypot(float(location.x) - start[0], float(location.y) - start[1]), 2),
    }


worlds = {
    "cubetown": ("/Game/Phantom/Worlds/CubeTown_World", (0.0, -10500.0)),
    "phantom-strike": ("/Game/Phantom/Worlds/PhantomStrike_World", (-9000.0, 0.0)),
    "phantom-legends": ("/Game/Phantom/Worlds/PhantomLegends_World", (-120000.0, -95000.0)),
}

result = {"worlds": {}, "assets": {}}
for game, (path, start) in worlds.items():
    if not level.load_level(path):
        result["worlds"][game] = {"error": "load failed"}
        continue
    records = [actor_record(actor, start) for actor in actors.get_all_level_actors() or [] if mesh_path(actor)]
    records.sort(key=lambda record: (record["distance"], -max(record["bounds"])))
    result["worlds"][game] = {
        "near": [record for record in records if record["distance"] <= 8000.0][:120],
        "largest_near": sorted(
            [record for record in records if record["distance"] <= 16000.0],
            key=lambda record: max(record["bounds"]),
            reverse=True,
        )[:40],
    }

asset_paths = [
    "/Game/Phantom/Strike/AssaultRifle",
    "/Game/Phantom/Strike/Pistol",
    "/Game/Phantom/Curated/Fab/Legends/SM_Fab_Keep",
    "/Game/Phantom/Curated/Legends/SM_Legends_Keep",
    "/Game/Phantom/Curated/Legends/SM_Legends_Barracks",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Barracks",
    "/Game/Phantom/Generated/Legends/V10/Architecture/SM_V10_NeutralTownHall",
    "/Game/Phantom/Generated/Legends/V9/Architecture/SM_V9_BlueBarracks",
    "/Game/Phantom/Generated/Legends/SM_LegionKeep",
    "/Game/Phantom/Generated/Legends/V9/Economy/SM_V9_Mine",
    "/Game/Phantom/Generated/Legends/V9/Economy/SM_V9_CrystalNode",
    "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
    "/Game/Phantom/Curated/Unity/Legends/SM_Unity_Keep",
    "/Game/Phantom/Curated/Fab/Legends/SM_Fab_Wall",
    "/Game/Phantom/Curated/Legends/SM_Legends_Wall",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroTorso",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroCloak",
]
for path in asset_paths:
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if not isinstance(asset, unreal.StaticMesh):
        result["assets"][path] = None
        continue
    bounds = asset.get_bounds()
    extent = bounds.box_extent
    result["assets"][path] = {
        "bounds": [round(float(extent.x * 2), 3), round(float(extent.y * 2), 3), round(float(extent.z * 2), 3)],
        "origin": [round(float(bounds.origin.x), 3), round(float(bounds.origin.y), 3), round(float(bounds.origin.z), 3)],
    }

with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
unreal.log("PHANTOM V12 SCENE INSPECTION COMPLETE " + report_path)
