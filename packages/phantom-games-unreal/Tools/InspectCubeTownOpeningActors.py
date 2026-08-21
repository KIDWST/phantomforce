"""Report the visible foreground actors and bounds in CubeTown's packaged opening view."""
from __future__ import annotations

import json
import os

import unreal


MAP = "/Game/Phantom/Worlds/CubeTown_World"
unreal.EditorLoadingAndSavingUtils.load_map(MAP)

rows = []
camera = unreal.Vector(300.0, -15000.0, 2600.0)
for actor in unreal.EditorLevelLibrary.get_all_level_actors():
    location = actor.get_actor_location()
    origin, extent = actor.get_actor_bounds(False, True)
    reaches_opening = (
        float(origin.x + extent.x) >= -9000.0
        and float(origin.x - extent.x) <= 9000.0
        and float(origin.y + extent.y) >= -19000.0
        and float(origin.y - extent.y) <= -5000.0
    )
    if not reaches_opening:
        continue
    rotation = actor.get_actor_rotation()
    scale = actor.get_actor_scale3d()
    distance = (location - camera).length()
    row = {
        "name": actor.get_actor_label(),
        "class": actor.get_class().get_name(),
        "location": [round(float(location.x), 2), round(float(location.y), 2), round(float(location.z), 2)],
        "bounds_size": [round(float(extent.x * 2.0), 2), round(float(extent.y * 2.0), 2), round(float(extent.z * 2.0), 2)],
        "bounds_origin": [round(float(origin.x), 2), round(float(origin.y), 2), round(float(origin.z), 2)],
        "rotation": [round(float(rotation.pitch), 2), round(float(rotation.yaw), 2), round(float(rotation.roll), 2)],
        "scale": [round(float(scale.x), 3), round(float(scale.y), 3), round(float(scale.z), 3)],
        "camera_distance": round(float(distance), 2),
        "tags": [str(tag) for tag in actor.tags],
    }
    if isinstance(actor, unreal.StaticMeshActor):
        component = actor.static_mesh_component
        mesh = component.static_mesh
        row["mesh"] = mesh.get_path_name() if mesh else None
        row["materials"] = [
            material.get_path_name() if material else None
            for material in component.get_materials()
        ]
    rows.append(row)

rows.sort(key=lambda row: max(row["bounds_size"]), reverse=True)
target = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownOpeningActorsV26.json")
with open(target, "w", encoding="utf-8") as handle:
    json.dump(rows, handle, indent=2)
unreal.log("CUBETOWN OPENING ACTOR INSPECTION PASS: %s actors -> %s" % (len(rows), target))
