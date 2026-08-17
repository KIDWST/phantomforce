"""V11R7 first-frame surface and authored-dressing repair for CubeTown and Phantom Legends.

This patch is intentionally idempotent. It removes only actors carrying the V11R7 patch tag,
then reconstructs the authored road/plaza/dressing layer from licensed project assets.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal


WORLD_ROOT = "/Game/Phantom/Worlds"
PRODUCTION_TAG = "PhantomProductionWorldV11"
PATCH_TAG = "PhantomProductionWorldV11R7"
SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
REPORT = os.path.join(SAVED, "PhantomProductionWorldsV11R7.json")
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def actor_bottom(actor):
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def remove_previous_patch():
    removed = []
    for actor in list(actors.get_all_level_actors()):
        tags = [str(value) for value in actor.get_editor_property("tags")]
        if PATCH_TAG in tags:
            removed.append(actor.get_actor_label())
            actors.destroy_actor(actor)
    return removed


def spawn(label, mesh_path, location, scale, yaw=0.0, ground_z=4.0):
    mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
    if not mesh:
        raise RuntimeError(f"Missing authored V11R7 asset: {mesh_path}")
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(ground_z)),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V11R7 actor: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(True)
    actor.set_actor_label(label)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    rotation = unreal.Rotator()
    rotation.roll = 0.0
    rotation.pitch = 0.0
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    location_now = actor.get_actor_location()
    location_now.z += float(ground_z) - actor_bottom(actor)
    actor.set_actor_location(location_now, False, False)
    actor.set_editor_property(
        "tags",
        [unreal.Name(PRODUCTION_TAG), unreal.Name(PATCH_TAG), unreal.Name(label)],
    )
    return actor


def patch_cubetown():
    path = WORLD_ROOT + "/CubeTown_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_patch()
    added = []

    # Replace the visually narrow legacy strip with a continuous 12 m authored stone road.
    path_straight = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight"
    for index, y in enumerate(range(-10500, 23501, 1100)):
        label = f"CT_V11R7_MainRoad_{index:02d}"
        spawn(label, path_straight, (0.0, float(y)), (24.0, 12.0, 1.0), 0.0, 3.0)
        added.append(label)

    # Grounded, material-bearing verge dressing fills the normal adventure camera foreground.
    bush = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush"
    flower = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower"
    rock = "/Game/Phantom/External/Quaternius/MedievalVillage/Rock_1"
    bench = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench"
    tree = "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A"
    for index, y in enumerate(range(-9900, -4200, 700)):
        for side in (-1.0, 1.0):
            x = side * (910.0 + (index % 3) * 170.0)
            mesh = bush if index % 3 == 0 else flower if index % 3 == 1 else rock
            scale = (3.4, 3.4, 3.4) if mesh == bush else (3.0, 3.0, 3.0) if mesh == flower else (4.2, 4.2, 4.2)
            label = f"CT_V11R7_Verge_{index:02d}_{'L' if side < 0 else 'R'}"
            spawn(label, mesh, (x, float(y)), scale, index * 37.0 + side * 11.0, 4.0)
            added.append(label)
    for index, y in enumerate((-9650.0, -8050.0, -6450.0, -4850.0)):
        side = -1.0 if index % 2 == 0 else 1.0
        label = f"CT_V11R7_Bench_{index:02d}"
        spawn(label, bench, (side * 1050.0, y), (2.1, 2.1, 2.1), 90.0 if side < 0 else -90.0, 4.0)
        added.append(label)
    for index, (x, y) in enumerate(((-2550, -9300), (2450, -8450), (-2700, -7000), (2650, -5550))):
        label = f"CT_V11R7_CrimsonTree_{index:02d}"
        spawn(label, tree, (float(x), float(y)), (5.2, 5.2, 5.2), index * 71.0, 4.0)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "added": added}


def patch_legends():
    path = WORLD_ROOT + "/PhantomLegends_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_patch()
    added = []
    center_x, center_y = -120000.0, -95000.0
    path_square = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square"
    path_straight = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight"

    # A material-bearing capital plaza breaks the uniform terrain and gives the settlement scale.
    for gy in range(-2, 3):
        for gx in range(-2, 3):
            label = f"LEG_V11R7_Plaza_{gx + 2}_{gy + 2}"
            spawn(
                label,
                path_square,
                (center_x + gx * 1510.0, center_y + gy * 1490.0),
                (31.5, 31.5, 1.0),
                (gx + gy) % 2 * 90.0,
                3.0,
            )
            added.append(label)

    # Four approach roads connect the plaza to the village ring instead of floating buildings on blue terrain.
    for axis in ("N", "S", "E", "W"):
        for index in range(3):
            offset = 4400.0 + index * 1350.0
            if axis == "N":
                x, y, yaw = center_x, center_y + offset, 0.0
            elif axis == "S":
                x, y, yaw = center_x, center_y - offset, 0.0
            elif axis == "E":
                x, y, yaw = center_x + offset, center_y, 90.0
            else:
                x, y, yaw = center_x - offset, center_y, 90.0
            label = f"LEG_V11R7_Road_{axis}_{index}"
            spawn(label, path_straight, (x, y), (18.0, 14.0, 1.0), yaw, 3.0)
            added.append(label)

    rock = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock"
    bush = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush"
    # The CC0 Tree_B alias resolves to the legacy egg-like fallback in the packaged game.
    # Use the verified licensed forest cluster with authored wood/foliage materials instead.
    tree = "/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees"
    for index in range(18):
        angle = index * math.tau / 18.0
        radius = 7800.0 + (index % 3) * 850.0
        mesh = tree if index % 3 == 0 else bush if index % 3 == 1 else rock
        scale_value = 2.8 if mesh == tree else 4.2 if mesh == bush else 4.0
        label = f"LEG_V11R7_CapitalDressing_{index:02d}"
        spawn(
            label,
            mesh,
            (center_x + math.cos(angle) * radius, center_y + math.sin(angle) * radius),
            (scale_value, scale_value, scale_value),
            math.degrees(angle) + 90.0,
            4.0,
        )
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "added": added}


results = {"revision": "V11R7", "status": "RUNNING"}
try:
    results["cubetown"] = patch_cubetown()
    results["phantom-legends"] = patch_legends()
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V11R7 WORLD PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V11R7 WORLD PATCH PASS")
