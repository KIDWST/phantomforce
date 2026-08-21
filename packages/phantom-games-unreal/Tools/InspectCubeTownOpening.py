"""Report every authored actor intersecting CubeTown's opening camera footprint."""
from __future__ import annotations

import json
import os

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level.load_level(WORLD):
    raise RuntimeError("Could not load " + WORLD)

report = []
for actor in actors.get_all_level_actors() or []:
    location = actor.get_actor_location()
    if abs(float(location.x)) > 5600 or not (-12200 <= float(location.y) <= -3800):
        continue
    origin, extent = actor.get_actor_bounds(False)
    component = None
    mesh_path = ""
    try:
        component = actor.get_editor_property("static_mesh_component")
    except Exception:
        pass
    if component:
        try:
            mesh = component.get_editor_property("static_mesh")
            mesh_path = mesh.get_path_name() if mesh else ""
        except Exception:
            pass
    materials = []
    if component:
        try:
            for index in range(component.get_num_materials()):
                material = component.get_material(index)
                materials.append(material.get_path_name() if material else "")
        except Exception:
            pass
    report.append(
        {
            "label": actor.get_actor_label(),
            "class": actor.get_class().get_name(),
            "location": [round(float(location.x)), round(float(location.y)), round(float(location.z))],
            "bounds_size": [round(float(extent.x * 2)), round(float(extent.y * 2)), round(float(extent.z * 2))],
            "mesh": mesh_path,
            "materials": materials,
            "tags": [str(tag) for tag in (actor.get_editor_property("tags") or [])],
        }
    )

report.sort(key=lambda item: (item["location"][1], item["location"][0]))
target = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownOpeningActors.json")
with open(target, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
unreal.log("CUBETOWN OPENING INSPECTION PASS: " + target)
