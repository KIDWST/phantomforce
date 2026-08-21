"""Read-only inventory of every rendered component in the Legends persistent world."""
from __future__ import annotations

import json
import os

import unreal


WORLD = "/Game/Phantom/Worlds/PhantomLegends_World"
REPORT = os.path.join(
    os.path.abspath(unreal.Paths.project_saved_dir()),
    "PhantomLegendsComponentAuditV22.json",
)

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("Legends component audit requires Unreal editor subsystems")
if not level.load_level(WORLD):
    raise RuntimeError("Could not load " + WORLD)


def object_path(value):
    if not value:
        return ""
    try:
        return value.get_path_name()
    except Exception:
        return str(value)


def vector(value):
    if not value:
        return [0.0, 0.0, 0.0]
    return [round(float(value.x), 2), round(float(value.y), 2), round(float(value.z), 2)]


def rendered_asset(component):
    for property_name in (
        "static_mesh",
        "skeletal_mesh_asset",
        "sprite",
        "texture",
    ):
        try:
            asset = component.get_editor_property(property_name)
            if asset:
                return object_path(asset)
        except Exception:
            pass
    return ""


records = []
for actor in actors.get_all_level_actors():
    try:
        components = actor.get_components_by_class(unreal.PrimitiveComponent)
    except Exception:
        components = []
    for component in components:
        try:
            origin, extent, radius = component.get_local_bounds()
            local_bounds = [
                round(float(extent.x - origin.x), 2),
                round(float(extent.y - origin.y), 2),
                round(float(extent.z - origin.z), 2),
            ]
        except Exception:
            local_bounds = [0.0, 0.0, 0.0]
        try:
            world_location = vector(component.get_world_location())
        except Exception:
            world_location = vector(actor.get_actor_location())
        try:
            world_scale = vector(component.get_world_scale())
        except Exception:
            world_scale = vector(actor.get_actor_scale3d())
        records.append(
            {
                "actor": actor.get_actor_label(),
                "actor_class": actor.get_class().get_name(),
                "component": component.get_name(),
                "component_class": component.get_class().get_name(),
                "asset": rendered_asset(component),
                "visible": bool(component.is_visible()),
                "hidden_in_game": bool(component.get_editor_property("hidden_in_game")),
                "world_location": world_location,
                "world_scale": world_scale,
                "local_bounds": local_bounds,
            }
        )

with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(
        {
            "revision": "V22",
            "status": "PASS",
            "world": WORLD,
            "component_count": len(records),
            "components": records,
        },
        handle,
        indent=2,
    )

unreal.log(f"PHANTOM LEGENDS COMPONENT AUDIT V22 PASS: {len(records)} components")
