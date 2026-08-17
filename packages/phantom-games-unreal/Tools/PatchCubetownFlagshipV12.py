"""Idempotent CubeTown V12 opening-ground pass.

The V11R7 road fixed route readability but exposed the pale fallback surface on either side.
V12 adds project-authored, material-bearing grass and dirt planes beneath the opening 150 m.
"""
from __future__ import annotations

import json
import os
import traceback

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
PRODUCTION_TAG = "PhantomProductionWorldV11"
PATCH_TAG = "PhantomProductionWorldV12"
GROUND_MESH = "/Game/Phantom/Generated/Cubetown/V12/SM_V12_GroundPatch"
GRASS_MATERIAL = "/Game/Phantom/Materials/Production/M_Phantom_Grass"
DIRT_MATERIAL = "/Game/Phantom/Materials/Production/M_Phantom_Dirt"
REPORT = os.path.join(
    os.path.abspath(unreal.Paths.project_saved_dir()),
    "PhantomCubetownFlagshipV12.json",
)

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def ensure_ground_mesh():
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MESH):
        mesh = unreal.EditorAssetLibrary.load_asset(GROUND_MESH)
        if mesh:
            return mesh
    destination_folder = GROUND_MESH.rsplit("/", 1)[0]
    unreal.EditorAssetLibrary.make_directory(destination_folder)
    if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", GROUND_MESH):
        raise RuntimeError("Could not create the project-authored V12 ground mesh")
    mesh = unreal.EditorAssetLibrary.load_asset(GROUND_MESH)
    if not mesh:
        raise RuntimeError("V12 ground mesh did not load after duplication")
    unreal.EditorAssetLibrary.save_asset(GROUND_MESH, only_if_is_dirty=False)
    return mesh


def remove_previous_patch():
    removed = []
    for actor in list(actors.get_all_level_actors()):
        tags = [str(value) for value in actor.get_editor_property("tags")]
        if PATCH_TAG in tags:
            removed.append(actor.get_actor_label())
            actors.destroy_actor(actor)
    return removed


def spawn_surface(label, mesh, material, location, scale):
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V12 surface: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_label(label)
    actor.set_actor_scale3d(
        unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2]))
    )
    actor.set_editor_property(
        "tags",
        [unreal.Name(PRODUCTION_TAG), unreal.Name(PATCH_TAG), unreal.Name(label)],
    )
    return actor


def patch():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed = remove_previous_patch()
    mesh = ensure_ground_mesh()
    grass = unreal.EditorAssetLibrary.load_asset(GRASS_MATERIAL)
    dirt = unreal.EditorAssetLibrary.load_asset(DIRT_MATERIAL)
    if not grass or not dirt:
        raise RuntimeError("Missing V12 production grass or dirt material")

    added = []
    # Seven overlapping sections cover spawn through the Heartstone village threshold.
    # Grass begins beneath the road and extends 40 m to either side, hiding the fallback plane
    # even at the wider third-person FOV. Dirt shoulders soften the road-to-grass transition.
    for index, y in enumerate(range(-11000, 3001, 2200)):
        grass_label = f"CT_V12_Terrain_Grass_{index:02d}"
        spawn_surface(grass_label, mesh, grass, (0.0, float(y), 0.0), (82.0, 24.0, 1.0))
        added.append(grass_label)
        for side in (-1.0, 1.0):
            dirt_label = f"CT_V12_RoadShoulder_{index:02d}_{'L' if side < 0 else 'R'}"
            spawn_surface(
                dirt_label,
                mesh,
                dirt,
                (side * 820.0, float(y), 1.0),
                (5.5, 24.0, 1.0),
            )
            added.append(dirt_label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + WORLD)
    return {"map": WORLD, "removed_previous": removed, "added": added}


results = {"revision": "V12", "status": "RUNNING"}
try:
    results["cubetown"] = patch()
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM CUBETOWN V12 PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM CUBETOWN V12 PATCH PASS")
