"""PhantomStrike V19 Operation Nightglass environment pass.

Adds an idempotent, original modern-military combat route on top of the verified V18R1
persistent world. The pass keeps the insertion lane and existing V13/V18 content intact,
uses only checked-in owned/curated assets, and leaves the center traversal route open.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal

WORLD = "/Game/Phantom/Worlds/PhantomStrike_World"
PRODUCTION_TAG = "PhantomProductionWorldV11"
PATCH_TAG = "PhantomStrikeV19"
GROUND_MESH = "/Game/Phantom/Generated/Strike/V19/SM_V19_SurfacePatch"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomStrikeV19.json")

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("PhantomStrike V19 requires Unreal editor subsystems")


def load_asset(path: str):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if not asset:
        raise RuntimeError(f"Missing required V19 asset: {path}")
    return asset


def ensure_surface_mesh():
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MESH):
        return load_asset(GROUND_MESH)
    unreal.EditorAssetLibrary.make_directory(GROUND_MESH.rsplit("/", 1)[0])
    if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", GROUND_MESH):
        raise RuntimeError("Could not create project-owned V19 surface patch")
    unreal.EditorAssetLibrary.save_asset(GROUND_MESH, only_if_is_dirty=False)
    return load_asset(GROUND_MESH)


def tag_actor(actor, label: str):
    actor.set_actor_label(label)
    actor.set_editor_property(
        "tags",
        [unreal.Name(PRODUCTION_TAG), unreal.Name(PATCH_TAG), unreal.Name(label)],
    )


def actor_bottom(actor) -> float:
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def remove_previous_pass():
    removed = []
    for actor in list(actors.get_all_level_actors() or []):
        tags = [str(value) for value in (actor.get_editor_property("tags") or [])]
        if PATCH_TAG in tags:
            removed.append(actor.get_actor_label())
            actors.destroy_actor(actor)
    return removed


def spawn_surface(label, mesh, material, location, scale, yaw=0.0):
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V19 surface: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    tag_actor(actor, label)
    return actor


def spawn_mesh(label, mesh_path, location, scale, yaw=0.0, ground_z=160.0, collision=False):
    mesh = load_asset(mesh_path)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(ground_z)),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V19 actor: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION
    )
    component.set_cast_shadow(True)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    now = actor.get_actor_location()
    now.z += float(ground_z) - actor_bottom(actor)
    actor.set_actor_location(now, False, False)
    tag_actor(actor, label)
    return actor


def patch_strike():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed = remove_previous_pass()
    surface_mesh = ensure_surface_mesh()
    asphalt = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Asphalt")
    concrete = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Concrete")
    cobble = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Cobble")
    added = []

    # Dense but non-blocking wear, drainage, and sidewalk detail along the full mission route.
    for index, x in enumerate(range(-8500, 11501, 500)):
        side = -1.0 if index % 2 == 0 else 1.0
        material = (asphalt, concrete, cobble)[index % 3]
        label = f"STRIKE_V19_RouteSurface_{index:02d}"
        spawn_surface(label, surface_mesh, material, (float(x), side * (720.0 + (index % 4) * 210.0), 160.5), (3.8, 1.8, 1.0), index * 11.0)
        added.append(label)

    route_props = (
        "/Game/Phantom/Curated/Strike/SM_Strike_Container",
        "/Game/Phantom/Curated/Strike/SM_Strike_StreetProp",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Barrel",
        "/Game/Phantom/Generated/Strike/V9/Props/SM_V9_SandbagWall",
        "/Game/Phantom/Generated/Strike/V9/Props/SM_V9_TacticalBarricade",
    )
    for index in range(54):
        x = -7600.0 + (index // 2) * 680.0
        side = -1.0 if index % 2 == 0 else 1.0
        y = side * (1450.0 + (index % 5) * 185.0)
        mesh = route_props[index % len(route_props)]
        scale = 0.62 if "Container" in mesh else 0.78 if "StreetProp" in mesh else 0.72
        label = f"STRIKE_V19_RouteCover_{index:02d}"
        spawn_mesh(label, mesh, (x, y), (scale, scale, scale), 90.0 if side < 0 else -90.0, 160.0, index % 6 in (0, 1))
        added.append(label)

    # Original Blackridge command-center breach beat. Large silhouettes stay off the central road;
    # the smaller cover ring creates an approach, two flanks, and a readable uplink clearing.
    landmarks = (
        ("STRIKE_V19_CommandWarehouse", "/Game/Phantom/Curated/Strike/SM_Strike_Warehouse", (7600.0, 4700.0), 0.94, -90.0),
        ("STRIKE_V19_CommandIndustrial", "/Game/Phantom/Curated/Strike/SM_Strike_Industrial", (5300.0, -5000.0), 0.82, 90.0),
        ("STRIKE_V19_CommandCommercial", "/Game/Phantom/Curated/Strike/SM_Strike_Commercial", (10300.0, -4700.0), 0.80, 90.0),
    )
    for label, mesh, location, scale, yaw in landmarks:
        spawn_mesh(label, mesh, location, (scale, scale, scale), yaw, 4.0, True)
        added.append(label)

    for index in range(18):
        angle = math.radians(index * 20.0)
        radius = 1450.0 + (index % 3) * 280.0
        x = 9000.0 + math.cos(angle) * radius
        y = math.sin(angle) * radius
        mesh = route_props[(index + 2) % len(route_props)]
        scale = 0.68 if "Container" not in mesh else 0.58
        label = f"STRIKE_V19_UplinkCover_{index:02d}"
        spawn_mesh(label, mesh, (x, y), (scale, scale, scale), index * 20.0 + 90.0, 160.0, index % 4 == 0)
        added.append(label)

    # Marina extraction gains a distinct silhouette and final holdout cover without blocking its center.
    for index, (dx, dy) in enumerate(((-900, -650), (-900, 650), (900, -650), (900, 650), (-1350, 0), (1350, 0))):
        mesh = route_props[index % len(route_props)]
        label = f"STRIKE_V19_ExtractionCover_{index:02d}"
        spawn_mesh(label, mesh, (14600.0 + dx, -9200.0 + dy), (0.72, 0.72, 0.72), index * 57.0, 160.0, True)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + WORLD)
    # Assigning project materials to the Nanite-backed surface mesh can make Unreal add
    # a platform usage flag while the level is saved. Persist those material changes so
    # Shipping cook never depends on editor-only transient state.
    for material in (asphalt, concrete, cobble):
        unreal.MaterialEditingLibrary.recompile_material(material)
        if not unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False):
            raise RuntimeError(f"Could not persist V19 material usage: {material.get_path_name()}")
    return {"map": WORLD, "removed_previous": removed, "added": added, "actor_count": len(added)}


result = {"revision": "V19", "status": "RUNNING"}
try:
    result["phantom-strike"] = patch_strike()
    result["status"] = "PASS"
except Exception as exc:
    result["status"] = "FAIL"
    result["error"] = str(exc)
    result["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOMSTRIKE V19 PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

unreal.log("PHANTOMSTRIKE V19 ENVIRONMENT PASS")
