"""V11R9 first-frame composition repair for Phantom Ages and PhantomStrike.

The previous portfolio gate rejected these two maps for flat lower-frame composition. This
idempotent patch extends the material-bearing Ages battlefield toward its fixed camera and
builds a readable, collision-safe Strike insertion corridor without touching the live build.
"""
from __future__ import annotations

import json
import os
import traceback

import unreal


WORLD_ROOT = "/Game/Phantom/Worlds"
PRODUCTION_TAG = "PhantomProductionWorldV11"
PATCH_TAG = "PhantomProductionWorldV11R9"
REPLACED_PATCH_TAGS = {"PhantomProductionWorldV11R8", PATCH_TAG}
GROUND_MESH = "/Game/Phantom/Generated/Common/V11R9/SM_V11R9_GroundPatch"
SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
REPORT = os.path.join(SAVED, "PhantomProductionWorldsV11R9.json")
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def ensure_ground_mesh():
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MESH):
        mesh = unreal.EditorAssetLibrary.load_asset(GROUND_MESH)
        if mesh:
            return mesh
    unreal.EditorAssetLibrary.make_directory(GROUND_MESH.rsplit("/", 1)[0])
    if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", GROUND_MESH):
        raise RuntimeError("Could not create the V11R9 project ground mesh")
    mesh = unreal.EditorAssetLibrary.load_asset(GROUND_MESH)
    if not mesh:
        raise RuntimeError("V11R9 ground mesh did not load")
    unreal.EditorAssetLibrary.save_asset(GROUND_MESH, only_if_is_dirty=False)
    return mesh


def remove_previous_patch():
    removed = []
    for actor in list(actors.get_all_level_actors()):
        tags = [str(value) for value in actor.get_editor_property("tags")]
        if any(patch_tag in tags for patch_tag in REPLACED_PATCH_TAGS):
            removed.append(actor.get_actor_label())
            actors.destroy_actor(actor)
    return removed


def tag(actor, label):
    actor.set_actor_label(label)
    actor.set_editor_property(
        "tags",
        [unreal.Name(PRODUCTION_TAG), unreal.Name(PATCH_TAG), unreal.Name(label)],
    )


def spawn_surface(label, mesh, material, location, scale):
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V11R9 surface: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    tag(actor, label)
    return actor


def actor_bottom(actor):
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def spawn_mesh(label, mesh_path, location, scale, yaw=0.0, ground_z=4.0, collision=False):
    mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
    if not mesh:
        raise RuntimeError(f"Missing V11R9 authored asset: {mesh_path}")
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(ground_z)),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V11R9 actor: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION
    )
    component.set_cast_shadow(True)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    rotation = unreal.Rotator()
    rotation.roll = 0.0
    rotation.pitch = 0.0
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    location_now = actor.get_actor_location()
    location_now.z += float(ground_z) - actor_bottom(actor)
    actor.set_actor_location(location_now, False, False)
    tag(actor, label)
    return actor


def patch_ages(ground_mesh):
    path = WORLD_ROOT + "/PhantomAges_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_patch()
    grass = unreal.EditorAssetLibrary.load_asset("/Game/Phantom/Materials/Production/M_Phantom_Grass")
    dirt = unreal.EditorAssetLibrary.load_asset("/Game/Phantom/Materials/Production/M_Phantom_Dirt")
    rock_material = unreal.EditorAssetLibrary.load_asset("/Game/Phantom/Materials/Production/M_Phantom_Rock")
    if not grass or not dirt or not rock_material:
        raise RuntimeError("Missing V11R9 Ages production material")

    added = []
    # The camera looks from negative Y. These overlapping sections carry the battlefield all the
    # way under the HUD instead of ending mid-frame and exposing the atmosphere beneath it.
    for index, y in enumerate(range(-12000, 12001, 4000)):
        label = f"AGES_V11R9_Grass_{index:02d}"
        spawn_surface(label, ground_mesh, grass, (0.0, float(y), 0.5), (380.0, 42.0, 1.0))
        added.append(label)
    for index, y in enumerate((-4700.0, -700.0, 3300.0)):
        material = dirt if index != 2 else rock_material
        label = f"AGES_V11R9_BattleBand_{index:02d}"
        spawn_surface(label, ground_mesh, material, (0.0, y, 1.2 + index * 0.1), (380.0, 11.0, 1.0))
        added.append(label)

    path_mesh = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight"
    for index, x in enumerate(range(-15000, 15001, 2500)):
        label = f"AGES_V11R9_BrokenRoad_{index:02d}"
        spawn_mesh(label, path_mesh, (float(x), -2050.0 + (index % 3) * 430.0), (22.0, 8.5, 1.0), 90.0, 3.0)
        added.append(label)

    dressing = (
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_BattlefieldRuin",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_SiegeWreck",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerBlue",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerRed",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock",
    )
    for index in range(38):
        x = -16500.0 + (index % 19) * 1830.0
        y = -6100.0 + (index // 19) * 2600.0 + ((index * 173) % 900)
        mesh = dressing[index % len(dressing)]
        scale_value = 0.72 if "Setpieces" in mesh else 0.64
        label = f"AGES_V11R9_Foreground_{index:02d}"
        spawn_mesh(label, mesh, (x, y), (scale_value, scale_value, scale_value), index * 41.0, 4.0)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "added": added}


def patch_strike(ground_mesh):
    path = WORLD_ROOT + "/PhantomStrike_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_patch()
    concrete = unreal.EditorAssetLibrary.load_asset("/Game/Phantom/Materials/Production/M_Phantom_Concrete")
    asphalt = unreal.EditorAssetLibrary.load_asset("/Game/Phantom/Materials/Production/M_Phantom_Asphalt")
    if not concrete or not asphalt:
        raise RuntimeError("Missing V11R9 Strike production material")

    added = []
    materialized_roads = []
    for actor in actors.get_all_level_actors():
        label = actor.get_actor_label()
        if not label.startswith("STRIKE_Road_12m_"):
            continue
        component = actor.get_editor_property("static_mesh_component")
        if component:
            component.set_material(0, asphalt)
            materialized_roads.append(label)

    # Contrasting authored shoulders lead the eye toward first contact while keeping the central
    # arterial and the validated 30 m insertion box unobstructed.
    for index, y in enumerate((-2850.0, 2850.0)):
        label = f"STRIKE_V11R9_Shoulder_{index:02d}"
        spawn_surface(label, ground_mesh, concrete, (-4700.0, y, 2.0), (105.0, 11.0, 1.0))
        added.append(label)

    cover = (
        "/Game/Phantom/Curated/Strike/SM_Strike_Container",
        "/Game/Phantom/Curated/Strike/SM_Strike_StreetProp",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Crate",
    )
    positions = (
        (-5850.0, -1750.0), (-5850.0, 1750.0), (-5350.0, -2150.0), (-5350.0, 2150.0),
        (-4850.0, -2550.0), (-4850.0, 2550.0), (-4350.0, -1950.0), (-4350.0, 1950.0),
        (-3950.0, -2450.0), (-3950.0, 2450.0), (-3550.0, -2050.0), (-3550.0, 2050.0),
    )
    for index, (x, y) in enumerate(positions):
        mesh = cover[index % len(cover)]
        scale_value = 1.15 if "Container" in mesh else 1.55 if "StreetProp" in mesh else 2.4
        label = f"STRIKE_V11R9_Cover_{index:02d}"
        spawn_mesh(label, mesh, (x, y), (scale_value, scale_value, scale_value), 90.0 if y < 0 else -90.0, 155.0, True)
        added.append(label)

    # A split roadblock adds foreground silhouette but preserves a 12 m drive/fight lane through it.
    for index, y in enumerate((-980.0, 980.0)):
        label = f"STRIKE_V11R9_Roadblock_{index:02d}"
        spawn_mesh(label, "/Game/Phantom/Curated/Strike/SM_Strike_StreetProp", (-5400.0, y), (1.7, 1.7, 1.7), 90.0, 155.0, True)
        added.append(label)

    for index, x in enumerate((-7800.0, -6600.0, -5400.0, -4200.0, -3000.0)):
        for side in (-1.0, 1.0):
            label = f"STRIKE_V11R9_Light_{index:02d}_{'L' if side < 0 else 'R'}"
            spawn_mesh(label, "/Game/Phantom/Strike/Streetlight_Single", (x, side * 2450.0), (3.1, 3.1, 3.1), 180.0 if side < 0 else 0.0, 4.0)
            added.append(label)

    # Close-range silhouettes sit just beyond the validated spawn-safe box, leaving the center
    # drive lane open while breaking up the previously empty lower-frame road shoulders.
    for index, (x, y) in enumerate(((-7300.0, -1200.0), (-7300.0, 1200.0), (-6700.0, -1450.0), (-6700.0, 1450.0))):
        label = f"STRIKE_V11R9_NearCover_{index:02d}"
        spawn_mesh(
            label,
            "/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate",
            (x, y),
            (0.85, 0.85, 0.85),
            18.0 if y < 0 else -18.0,
            4.0,
            True,
        )
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {
        "map": path,
        "removed_previous": removed,
        "materialized_roads": materialized_roads,
        "added": added,
    }


results = {"revision": "V11R9", "status": "RUNNING"}
try:
    shared_ground_mesh = ensure_ground_mesh()
    results["phantom-ages"] = patch_ages(shared_ground_mesh)
    results["phantom-strike"] = patch_strike(shared_ground_mesh)
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V11R9 WORLD PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V11R9 WORLD PATCH PASS")
