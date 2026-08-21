"""PhantomPlay V19 first-frame rebuild.

Removes the flat plane quilts that survived the V13/V17 passes and adds close authored geometry
to each opening composition. Strategy-game key art is intentionally not placed in the playable
world: a promotional image is not a substitute for real landscape, skyline, or level geometry.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal

WORLD_ROOT = "/Game/Phantom/Worlds"
PRODUCTION_TAG = "PhantomProductionWorldV11"
V13_TAG = "PhantomPortfolioWorldV13"
V17_SURFACE_TAG = "CubeTownV17.Surface"
V19_TAG = "PhantomPortfolioWorldV19"
BACKDROP_MESH = "/Game/Phantom/Generated/Common/V19/SM_V19_HorizonCard"
BACKDROP_ROOT = "/Game/Phantom/Generated/Common/V19/Backdrops"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomPortfolioWorldsV19.json")

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
materials = unreal.MaterialEditingLibrary
if not level or not actors:
    raise RuntimeError("V19 portfolio patch requires Unreal editor subsystems")


def asset(path):
    return unreal.EditorAssetLibrary.load_asset(path)


def tags_of(actor):
    try:
        return {str(value) for value in (actor.get_editor_property("tags") or [])}
    except Exception:
        return set()


def label_of(actor):
    try:
        return actor.get_actor_label()
    except Exception:
        return actor.get_name()


def remove_old_and_flat_layers():
    removed_v19 = []
    removed_flat = []
    for actor in list(actors.get_all_level_actors()):
        tags = tags_of(actor)
        label = label_of(actor)
        if V19_TAG in tags:
            removed_v19.append(label)
            actors.destroy_actor(actor)
            continue
        is_v13_plane = V13_TAG in tags and ("_Surface_" in label or "_Biome_" in label)
        is_v17_plane = V17_SURFACE_TAG in tags
        if is_v13_plane or is_v17_plane:
            removed_flat.append(label)
            actors.destroy_actor(actor)
    return removed_v19, removed_flat


def tag_actor(actor, label, production=True):
    actor.set_actor_label(label)
    values = [unreal.Name(V19_TAG), unreal.Name(label)]
    if production:
        values.insert(0, unreal.Name(PRODUCTION_TAG))
    actor.set_editor_property("tags", values)


def mesh_bounds(mesh):
    bounds = mesh.get_bounds()
    extent = bounds.box_extent
    return max(1.0, float(extent.x) * 2.0), max(1.0, float(extent.y) * 2.0), max(1.0, float(extent.z) * 2.0)


def spawn_mesh(label, mesh_path, location, target_height=0.0, scale=1.0, yaw=0.0, collision=False):
    mesh = asset(mesh_path)
    if not mesh:
        raise RuntimeError(f"V19 missing authored mesh: {mesh_path}")
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("V19 could not spawn " + label)
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION
    )
    component.set_cast_shadow(True)
    fitted = float(scale)
    if target_height > 0.0:
        fitted *= float(target_height) / mesh_bounds(mesh)[2]
    actor.set_actor_scale3d(unreal.Vector(fitted, fitted, fitted))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    try:
        origin, extent = actor.get_actor_bounds(False)
        current = actor.get_actor_location()
        current.z += float(location[2]) - (float(origin.z) - float(extent.z))
        actor.set_actor_location(current, False, False)
    except Exception:
        pass
    tag_actor(actor, label, True)
    return actor


def ensure_horizon_card():
    if not unreal.EditorAssetLibrary.does_asset_exist(BACKDROP_MESH):
        unreal.EditorAssetLibrary.make_directory(BACKDROP_MESH.rsplit("/", 1)[0])
        if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", BACKDROP_MESH):
            raise RuntimeError("V19 could not create the project-owned horizon card mesh")
        unreal.EditorAssetLibrary.save_asset(BACKDROP_MESH, only_if_is_dirty=False)
    return asset(BACKDROP_MESH)


def import_key_art(source_name, asset_name):
    source = os.path.join(os.path.abspath(unreal.Paths.project_dir()), "SourceArt", "KeyArt", source_name)
    if not os.path.isfile(source):
        raise RuntimeError("V19 key art source is missing: " + source)
    texture_path = f"{BACKDROP_ROOT}/T_{asset_name}"
    texture = asset(texture_path)
    if texture:
        return texture
    unreal.EditorAssetLibrary.make_directory(BACKDROP_ROOT)
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", BACKDROP_ROOT)
    task.set_editor_property("destination_name", f"T_{asset_name}")
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    asset_tools.import_asset_tasks([task])
    texture = asset(texture_path)
    if not texture:
        raise RuntimeError("V19 failed to import key art texture: " + source)
    try:
        texture.set_editor_property("s_rgb", True)
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_asset(texture_path, only_if_is_dirty=False)
    return texture


def ensure_unlit_material(asset_name, texture):
    path = f"{BACKDROP_ROOT}/M_{asset_name}"
    material = asset(path)
    if not material:
        factory = unreal.MaterialFactoryNew()
        material = asset_tools.create_asset(f"M_{asset_name}", BACKDROP_ROOT, unreal.Material, factory)
    if not material:
        raise RuntimeError("V19 could not create horizon material " + path)
    try:
        materials.delete_all_material_expressions(material)
    except Exception:
        pass
    material.set_editor_property("two_sided", True)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    sample = materials.create_material_expression(material, unreal.MaterialExpressionTextureSample, -360, 0)
    sample.texture = texture
    materials.connect_material_property(sample, "RGB", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    materials.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    return material


def spawn_backdrop(label, material, location, scale, yaw=0.0):
    mesh = ensure_horizon_card()
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("V19 could not spawn horizon " + label)
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), 1.0))
    rotation = unreal.Rotator()
    rotation.roll = 90.0
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    tag_actor(actor, label, False)
    return actor


def patch_cubetown():
    path = WORLD_ROOT + "/CubeTown_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    old, flat = remove_old_and_flat_layers()
    added = []
    props = (
        "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower",
        "/Game/Phantom/Curated/Cube/SM_Cube_Rock_A",
    )
    for index in range(24):
        side = -1.0 if index % 2 == 0 else 1.0
        row = index // 2
        y = -9600.0 + row * 520.0
        x = side * (1120.0 + (index % 4) * 230.0)
        target = 1050.0 if index % len(props) == 0 else 320.0 if index % len(props) == 1 else 240.0
        label = f"CT_V19_Approach_{index:02d}"
        spawn_mesh(label, props[index % len(props)], (x, y, 6.0), target, 1.0, index * 41.0, False)
        added.append(label)
    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": old, "removed_flat_layers": flat, "added": added}


def patch_ages():
    path = WORLD_ROOT + "/PhantomAges_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    old, flat = remove_old_and_flat_layers()
    added = []
    assets = (
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerBlue",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerRed",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Bonfire_Lit",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Cart",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_SiegeWreck",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_BattlefieldRuin",
    )
    for index in range(18):
        x = -14500.0 + index * 1700.0
        y = -1800.0 + (index % 3) * 1150.0
        target = 720.0 if "Banner" in assets[index % len(assets)] else 520.0
        label = f"AGES_V19_Frontline_{index:02d}"
        spawn_mesh(label, assets[index % len(assets)], (x, y, 4.0), target, 1.0, index * 31.0, False)
        added.append(label)
    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": old, "removed_flat_layers": flat, "added": added}


def patch_legends():
    path = WORLD_ROOT + "/PhantomLegends_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    old, flat = remove_old_and_flat_layers()
    added = []
    cx, cy = -120000.0, -95000.0
    assets = (
        "/Game/Phantom/Curated/Legends/SM_Legends_Tower",
        "/Game/Phantom/Curated/Legends/SM_Legends_Barracks",
        "/Game/Phantom/Curated/Legends/SM_Legends_Ruin",
        "/Game/Phantom/Curated/Legends/SM_Legends_Market",
        "/Game/Phantom/Curated/Legends/SM_Legends_Windmill",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock",
    )
    for index in range(18):
        angle = -0.9 + index * (math.tau / 22.0)
        radius = 5200.0 + (index % 3) * 1350.0
        x = cx + math.cos(angle) * radius
        y = cy + math.sin(angle) * radius
        target = 1150.0 if index % len(assets) < 2 else 720.0
        label = f"LEG_V19_CommandRing_{index:02d}"
        spawn_mesh(label, assets[index % len(assets)], (x, y, 5.0), target, 1.0, math.degrees(angle) + 90.0, False)
        added.append(label)
    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": old, "removed_flat_layers": flat, "added": added}


def patch_strike():
    path = WORLD_ROOT + "/PhantomStrike_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    old, flat = remove_old_and_flat_layers()
    added = []
    assets = (
        "/Game/Phantom/Curated/Strike/SM_Strike_Container",
        "/Game/Phantom/Curated/Strike/SM_Strike_StreetProp",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Barrel",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern",
        "/Game/Phantom/Generated/Strike/V10/Props/SM_V10_ConcreteBarrier",
    )
    for index in range(24):
        side = -1.0 if index % 2 == 0 else 1.0
        x = -7200.0 + (index // 2) * 520.0
        y = side * (1320.0 + (index % 4) * 210.0)
        label = f"STRIKE_V19_InsertionCover_{index:02d}"
        spawn_mesh(label, assets[index % len(assets)], (x, y, 160.0), 360.0, 1.0, 90.0 + index * 17.0, False)
        added.append(label)
    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": old, "removed_flat_layers": flat, "added": added}


results = {"revision": "V19", "status": "RUNNING", "patch_tag": V19_TAG}
try:
    results["cubetown"] = patch_cubetown()
    results["phantom-ages"] = patch_ages()
    results["phantom-legends"] = patch_legends()
    results["phantom-strike"] = patch_strike()
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V19 PORTFOLIO WORLD PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V19 PORTFOLIO WORLD PATCH PASS")
