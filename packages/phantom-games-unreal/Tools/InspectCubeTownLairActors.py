"""Report every actor whose bounds intersect the packaged Phantomite-lair capture volume."""
from __future__ import annotations

import json
import os

import unreal


MAP = "/Game/Phantom/Worlds/CubeTown_World"
unreal.EditorLoadingAndSavingUtils.load_map(MAP)
camera = unreal.Vector(0.0, -500.0, 2200.0)
rows = []
for actor in unreal.EditorLevelLibrary.get_all_level_actors():
    location = actor.get_actor_location()
    origin, extent = actor.get_actor_bounds(False, True)
    reaches_lair = (
        float(origin.x + extent.x) >= -7500.0
        and float(origin.x - extent.x) <= 7500.0
        and float(origin.y + extent.y) >= -1500.0
        and float(origin.y - extent.y) <= 7500.0
    )
    if not reaches_lair:
        continue
    rotation = actor.get_actor_rotation()
    scale = actor.get_actor_scale3d()
    row = {
        "name": actor.get_actor_label(),
        "class": actor.get_class().get_name(),
        "location": [round(float(location.x), 2), round(float(location.y), 2), round(float(location.z), 2)],
        "bounds_origin": [round(float(origin.x), 2), round(float(origin.y), 2), round(float(origin.z), 2)],
        "bounds_size": [round(float(extent.x * 2.0), 2), round(float(extent.y * 2.0), 2), round(float(extent.z * 2.0), 2)],
        "rotation": [round(float(rotation.pitch), 2), round(float(rotation.yaw), 2), round(float(rotation.roll), 2)],
        "scale": [round(float(scale.x), 3), round(float(scale.y), 3), round(float(scale.z), 3)],
        "camera_distance": round(float((location - camera).length()), 2),
        "tags": [str(tag) for tag in actor.tags],
    }
    if isinstance(actor, unreal.StaticMeshActor):
        component = actor.static_mesh_component
        mesh = component.static_mesh
        row["mesh"] = mesh.get_path_name() if mesh else None
        row["materials"] = [material.get_path_name() if material else None for material in component.get_materials()]
    rows.append(row)

rows.sort(key=lambda row: max(row["bounds_size"]), reverse=True)
target = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownLairActorsV27.json")
with open(target, "w", encoding="utf-8") as handle:
    json.dump(rows, handle, indent=2)
unreal.log("CUBETOWN LAIR ACTOR INSPECTION PASS: %s actors -> %s" % (len(rows), target))
