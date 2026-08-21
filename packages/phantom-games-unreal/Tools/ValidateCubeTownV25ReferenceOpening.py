"""Hard structural gate for the visible CubeTown V25 reference-opening composition."""
from __future__ import annotations

import json
import math
import os

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
TAG = "PhantomProductionWorldV25"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV25ReferenceOpeningValidation.json")
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def label_of(actor):
    try:
        return actor.get_actor_label()
    except Exception:
        return actor.get_name()


def tags_of(actor):
    try:
        return [str(value) for value in (actor.get_editor_property("tags") or [])]
    except Exception:
        return []


def component_of(actor):
    try:
        return actor.get_editor_property("static_mesh_component")
    except Exception:
        found = actor.get_components_by_class(unreal.StaticMeshComponent)
        return found[0] if found else None


def mesh_path(actor):
    component = component_of(actor)
    mesh = component.get_editor_property("static_mesh") if component else None
    return mesh.get_path_name() if mesh else ""


def material_paths(actor):
    component = component_of(actor)
    if not component:
        return []
    result = []
    for index in range(component.get_num_materials()):
        material = component.get_material(index)
        result.append(material.get_path_name() if material else "")
    return result


if not level or not actors or not level.load_level(WORLD):
    raise RuntimeError("Could not load CubeTown production world")

all_actors = list(actors.get_all_level_actors() or [])
reference = [actor for actor in all_actors if TAG in tags_of(actor)]
labels = {label_of(actor) for actor in reference}
failures = []

required = {
    "CT_V25_HeartstoneFountainSquare",
    "CT_V25_HeartstoneRiver",
    "CT_V25_HeartstoneBridge",
    "CT_V25_StarterHome",
    "CT_V25_Blacksmith",
    "CT_V25_Market_Produce",
    "CT_V25_LairGate",
    "CT_V25_LairAltar",
    "CT_V25_LairTreasure",
    "CT_V25_LairCrystal_00",
    "CT_V25_LairBossDais_01_01",
}
missing = sorted(required - labels)
if missing:
    failures.append("missing reference landmarks: " + ", ".join(missing))
if len(reference) < 185:
    failures.append(f"reference-opening density {len(reference)} < 185")

groups = {
    "architecture": sum("CubeTown.ReferenceArchitecture" in tags_of(actor) for actor in reference),
    "vegetation": sum("CubeTown.ReferenceVegetation" in tags_of(actor) for actor in reference),
    "garden": sum("CubeTown.ReferenceGarden" in tags_of(actor) for actor in reference),
    "road": sum("CubeTown.ReferenceRoad" in tags_of(actor) for actor in reference),
    "town_life": sum("CubeTown.ReferenceTownLife" in tags_of(actor) for actor in reference),
    "riverbank": sum("CubeTown.ReferenceRiverbank" in tags_of(actor) for actor in reference),
    "lair": sum("CubeTown.ReferenceLair" in tags_of(actor) for actor in reference),
}
minimums = {"architecture": 12, "vegetation": 20, "garden": 60, "road": 18, "town_life": 15, "riverbank": 20, "lair": 105}
for name, minimum in minimums.items():
    if groups[name] < minimum:
        failures.append(f"{name} content {groups[name]} < {minimum}")

obsolete = []
legacy_opening_prefixes = (
    "CT_House_", "CT_Tree_", "CT_fence_", "CT_lantern_", "CT_bench_",
    "CT_flower_", "CT_rock_", "CT_CrimsonAccent_", "CT_V11R7_", "CT_V12_",
    "CT_V13_", "CT_V19_", "CT_V22_", "CT17_Garden",
)
legacy_lair_prefixes = legacy_opening_prefixes + ("CT_Stream_", "CT_Bridge", "CT_DreamPortal")
for actor in all_actors:
    location = actor.get_actor_location()
    inside = abs(float(location.x)) <= 5800.0 and -12250.0 <= float(location.y) <= -3800.0
    inside_lair = abs(float(location.x)) <= 2600.0 and 1800.0 <= float(location.y) <= 5500.0
    inside_lair_cleanup = abs(float(location.x)) <= 6200.0 and -1800.0 <= float(location.y) <= 7800.0
    label = label_of(actor)
    if inside and (label.startswith("CT_V23_") or label.startswith("CT_V24_Road_CrownSpine_") or label.startswith("CT_V24_Cell_")):
        obsolete.append(label)
    if inside_lair and (label.startswith("CT_V23_Lair") or label.startswith("CT_V24_Road_CrownSpine_")):
        obsolete.append(label)
    if inside and label.startswith(legacy_opening_prefixes):
        obsolete.append(label)
    if inside_lair_cleanup and label.startswith(legacy_lair_prefixes):
        obsolete.append(label)
if obsolete:
    failures.append("obsolete overlapping opening actors remain: " + ", ".join(obsolete[:20]))

bad_meshes = [(label_of(actor), mesh_path(actor)) for actor in reference if "/Engine/BasicShapes/" in mesh_path(actor)]
bad_materials = [
    (label_of(actor), material_paths(actor))
    for actor in reference
    if any("WorldGridMaterial" in path for path in material_paths(actor))
]
if bad_meshes:
    failures.append(f"reference opening contains {len(bad_meshes)} Engine BasicShape meshes")
if bad_materials:
    failures.append(f"reference opening contains grid-material actors: {bad_materials}")

fountain = next((actor for actor in reference if label_of(actor) == "CT_V25_HeartstoneFountainSquare"), None)
if not fountain or "SM_CubetownFountain" not in mesh_path(fountain):
    failures.append("civic center is not backed by the authored three-dimensional CubeTown fountain")

lair_floor = next((actor for actor in reference if label_of(actor).startswith("CT_V25_LairFloor_")), None)
if not lair_floor or not any(
    "KayKitDungeonV25/texture" in path or "M_CT17_DungeonTile" in path or "M_CT26_LairStone" in path
    for path in material_paths(lair_floor)
):
    failures.append("Phantomite lair floor does not use verified authored rough stone")

# The camera footprint is divided into spatial cells. Every cell must contain useful authored
# content so a high-angle camera cannot expose another multi-acre blank lawn.
cells = {}
for gy in range(4):
    for gx in range(5):
        min_x = -5500.0 + gx * 2200.0
        max_x = min_x + 2200.0
        min_y = -12200.0 + gy * 2100.0
        max_y = min_y + 2100.0
        count = 0
        for actor in reference:
            location = actor.get_actor_location()
            if min_x <= float(location.x) < max_x and min_y <= float(location.y) < max_y:
                count += 1
        cells[f"{gx},{gy}"] = count
        if count < 3:
            failures.append(f"opening camera cell {gx},{gy} has only {count} authored actors")

lair_cells = {}
for gy in range(3):
    for gx in range(4):
        min_x = -2000.0 + gx * 1000.0
        max_x = min_x + 1000.0
        min_y = 2100.0 + gy * 1100.0
        max_y = min_y + 1100.0
        count = 0
        for actor in reference:
            if "CubeTown.ReferenceLair" not in tags_of(actor):
                continue
            location = actor.get_actor_location()
            if min_x <= float(location.x) < max_x and min_y <= float(location.y) < max_y:
                count += 1
        lair_cells[f"{gx},{gy}"] = count
        if count < 4:
            failures.append(f"Phantomite lair camera cell {gx},{gy} has only {count} authored actors")

result = {
    "schema": 25,
    "status": "PASS" if not failures else "FAIL",
    "actors": len(reference),
    "groups": groups,
    "cells": cells,
    "lair_cells": lair_cells,
    "failures": failures,
}
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
if failures:
    raise RuntimeError("CubeTown V25 reference opening gate FAILED: " + " | ".join(failures))
unreal.log("CUBETOWN V25 REFERENCE OPENING GATE PASS " + json.dumps(result))
