"""Write a read-only inventory of the four persistent PhantomPlay worlds."""
from __future__ import annotations

import json
import os

import unreal


WORLD_ROOT = "/Game/Phantom/Worlds"
WORLDS = (
    "CubeTown_World",
    "PhantomAges_World",
    "PhantomLegends_World",
    "PhantomStrike_World",
)
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomWorldActorAuditV19.json")

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("World actor audit requires Unreal editor subsystems")


def object_path(value):
    if not value:
        return ""
    try:
        return value.get_path_name()
    except Exception:
        return str(value)


def actor_record(actor):
    label = actor.get_actor_label()
    location = actor.get_actor_location()
    scale = actor.get_actor_scale3d()
    tags = [str(tag) for tag in (actor.get_editor_property("tags") or [])]
    mesh = ""
    component = None
    try:
        component = actor.get_editor_property("static_mesh_component")
    except Exception:
        pass
    if component:
        try:
            mesh = object_path(component.get_editor_property("static_mesh"))
        except Exception:
            pass
    if not mesh:
        try:
            component = actor.get_editor_property("skeletal_mesh_component")
            mesh = object_path(component.get_editor_property("skeletal_mesh_asset"))
        except Exception:
            pass
    try:
        origin, extent = actor.get_actor_bounds(False)
        bounds = [round(float(extent.x) * 2.0, 2), round(float(extent.y) * 2.0, 2), round(float(extent.z) * 2.0, 2)]
    except Exception:
        bounds = [0.0, 0.0, 0.0]
    return {
        "label": label,
        "class": actor.get_class().get_name(),
        "tags": tags,
        "mesh": mesh,
        "location": [round(float(location.x), 2), round(float(location.y), 2), round(float(location.z), 2)],
        "scale": [round(float(scale.x), 4), round(float(scale.y), 4), round(float(scale.z), 4)],
        "bounds": bounds,
    }


report = {"revision": "V19", "status": "RUNNING", "worlds": {}}
for world in WORLDS:
    path = f"{WORLD_ROOT}/{world}"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    records = [actor_record(actor) for actor in actors.get_all_level_actors()]
    report["worlds"][world] = {
        "actor_count": len(records),
        "actors": sorted(records, key=lambda item: item["label"]),
    }

report["status"] = "PASS"
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)

unreal.log("PHANTOM WORLD ACTOR AUDIT V19 PASS")
