"""PhantomPlay V13 portfolio-wide visual density and asset-safety pass.

This patch advances all four games in the same Unreal editor session. It is additive on top of
V11R7/V11R10/CubeTown V12 and is intentionally focused on the first playable composition that the
portfolio visual gate captures:

- CubeTown: grounded roadside detail, village approach silhouettes, material breakup.
- Phantom Ages: foreground battlefield depth, camp debris, banners, fires, surface breakup.
- PhantomStrike: lower-frame street detail, lane rhythm, cover silhouettes, surface contrast.
- Phantom Legends: capital-biome breakup, readable approaches, safe forest silhouettes, scale cues.

The patch also removes the rejected SM_CC0_Tree_B semantic alias from persistent production worlds.
Runtime C++ is separately routed away from that alias, so a clean rebuild cannot reintroduce it.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal

WORLD_ROOT = "/Game/Phantom/Worlds"
PRODUCTION_TAG = "PhantomProductionWorldV11"
PATCH_TAG = "PhantomPortfolioWorldV13"
GROUND_MESH = "/Game/Phantom/Generated/Common/V13/SM_V13_GroundPatch"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomPortfolioWorldsV13.json")

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("V13 portfolio patch requires Unreal editor subsystems")


def ensure_ground_mesh():
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MESH):
        mesh = unreal.EditorAssetLibrary.load_asset(GROUND_MESH)
        if mesh:
            return mesh
    unreal.EditorAssetLibrary.make_directory(GROUND_MESH.rsplit("/", 1)[0])
    if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", GROUND_MESH):
        raise RuntimeError("Could not create V13 project ground patch")
    mesh = unreal.EditorAssetLibrary.load_asset(GROUND_MESH)
    if not mesh:
        raise RuntimeError("V13 project ground patch failed to load")
    unreal.EditorAssetLibrary.save_asset(GROUND_MESH, only_if_is_dirty=False)
    return mesh


def load_asset(path: str):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if not asset:
        raise RuntimeError(f"Missing required V13 production asset: {path}")
    return asset


def tag_actor(actor, label: str):
    actor.set_actor_label(label)
    actor.set_editor_property(
        "tags",
        [unreal.Name(PRODUCTION_TAG), unreal.Name(PATCH_TAG), unreal.Name(label)],
    )


def actor_mesh_path(actor) -> str:
    try:
        component = actor.get_editor_property("static_mesh_component")
        mesh = component.get_editor_property("static_mesh") if component else None
        return mesh.get_path_name() if mesh else ""
    except Exception:
        return ""


def actor_bottom(actor) -> float:
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def remove_previous_v13():
    removed = []
    for actor in list(actors.get_all_level_actors()):
        tags = [str(value) for value in (actor.get_editor_property("tags") or [])]
        if PATCH_TAG in tags:
            removed.append(actor.get_actor_label())
            actors.destroy_actor(actor)
    return removed


def remove_rejected_aliases():
    removed = []
    for actor in list(actors.get_all_level_actors()):
        tags = [str(value) for value in (actor.get_editor_property("tags") or [])]
        if PRODUCTION_TAG not in tags:
            continue
        path = actor_mesh_path(actor)
        if "SM_CC0_Tree_B" in path:
            removed.append((actor.get_actor_label(), path))
            actors.destroy_actor(actor)
    return removed


def spawn_surface(label, ground_mesh, material, location, scale, yaw=0.0):
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V13 surface: {label}")
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(ground_mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    tag_actor(actor, label)
    return actor


def spawn_mesh(label, mesh_path, location, scale, yaw=0.0, ground_z=4.0, collision=False):
    mesh = load_asset(mesh_path)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(ground_z)),
        transient=False,
    )
    if not actor:
        raise RuntimeError(f"Could not spawn V13 actor: {label}")
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


def patch_cubetown(ground_mesh):
    path = WORLD_ROOT + "/CubeTown_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_v13()
    rejected = remove_rejected_aliases()
    grass = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Grass")
    dirt = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Dirt")
    cobble = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Cobble")
    added = []

    # Small overlapping material islands break the single-color road verge without creating collision.
    for i, y in enumerate((-10150, -9150, -8150, -7150, -6150, -5150, -4150)):
        for side in (-1.0, 1.0):
            mat = dirt if i % 3 == 0 else cobble if i % 3 == 1 else grass
            label = f"CT_V13_Surface_{i:02d}_{'L' if side < 0 else 'R'}"
            spawn_surface(label, ground_mesh, mat, (side * (1350 + (i % 2) * 320), y, 2.5), (10.0, 7.5, 1.0), i * 13.0)
            added.append(label)

    detail_assets = (
        "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
        "/Game/Phantom/Curated/Cube/SM_Cube_Rock_A",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern",
    )
    for i in range(34):
        side = -1.0 if i % 2 == 0 else 1.0
        y = -10000.0 + (i // 2) * 380.0
        x = side * (1100.0 + (i % 5) * 245.0)
        mesh = detail_assets[i % len(detail_assets)]
        scale = 1.9 if "Tree" in mesh else 1.35 if "Bush" in mesh else 1.05
        label = f"CT_V13_Roadside_{i:02d}"
        spawn_mesh(label, mesh, (x, y), (scale, scale, scale), i * 47.0, 5.0)
        added.append(label)

    landmarks = (
        ("CT_V13_Landmark_Windmill", "/Game/Phantom/Curated/Cube/SM_Cube_Windmill", (3900, -3600), 1.25, 205.0),
        ("CT_V13_Landmark_Tavern", "/Game/Phantom/Curated/Cube/SM_Cube_Tavern", (-3550, -3900), 1.15, 28.0),
        ("CT_V13_Landmark_Market", "/Game/Phantom/Curated/Cube/SM_Cube_Market", (2700, -5050), 1.0, 180.0),
        ("CT_V13_Landmark_Well", "/Game/Phantom/Curated/Cube/SM_Cube_Well", (-1900, -5350), 1.05, 0.0),
    )
    for label, mesh, pos, scale, yaw in landmarks:
        spawn_mesh(label, mesh, pos, (scale, scale, scale), yaw, 5.0)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "removed_rejected": rejected, "added": added}


def patch_ages(ground_mesh):
    path = WORLD_ROOT + "/PhantomAges_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_v13()
    rejected = remove_rejected_aliases()
    grass = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Grass")
    dirt = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Dirt")
    rock = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Rock")
    cobble = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Cobble")
    added = []

    # Material islands are intentionally irregular and low-profile so the fixed one-screen camera gains depth.
    surface_specs = (
        (-11800, -7600, 26, 9, dirt, -8), (-5200, -7200, 22, 7, rock, 11),
        (2100, -7300, 24, 8, grass, -5), (9100, -6900, 20, 7, dirt, 9),
        (-9000, -3500, 18, 6, cobble, 14), (-1800, -3000, 23, 6, dirt, -12),
        (7000, -2800, 18, 6, rock, 6), (13000, -1800, 16, 5, grass, -16),
    )
    for i, (x, y, sx, sy, mat, yaw) in enumerate(surface_specs):
        label = f"AGES_V13_Surface_{i:02d}"
        spawn_surface(label, ground_mesh, mat, (x, y, 3.0 + i * 0.05), (sx, sy, 1.0), yaw)
        added.append(label)

    battlefield = (
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_BattlefieldRuin",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_SiegeWreck",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerBlue",
        "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerRed",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Bonfire_Lit",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Cart",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Barrel",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Crate",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Hay1",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock",
    )
    for i in range(46):
        column = i % 23
        row = i // 23
        x = -16000.0 + column * 1450.0
        y = -7200.0 + row * 2650.0 + ((i * 223) % 900)
        mesh = battlefield[i % len(battlefield)]
        scale = 0.80 if "Setpieces" in mesh else 0.62 if "Bonfire" not in mesh else 0.48
        label = f"AGES_V13_Foreground_{i:02d}"
        spawn_mesh(label, mesh, (x, y), (scale, scale, scale), i * 37.0, 5.0)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "removed_rejected": rejected, "added": added}


def patch_strike(ground_mesh):
    path = WORLD_ROOT + "/PhantomStrike_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_v13()
    rejected = remove_rejected_aliases()
    asphalt = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Asphalt")
    concrete = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Concrete")
    cobble = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Cobble")
    added = []

    # Low-profile, collision-free street repairs and sidewalk fragments increase lower-frame frequency detail.
    for i, x in enumerate((-8650, -8150, -7650, -7150, -6650, -6150, -5650, -5150, -4650, -4150)):
        for side in (-1.0, 1.0):
            mat = concrete if i % 3 == 0 else cobble if i % 3 == 1 else asphalt
            y = side * (980.0 + (i % 3) * 240.0)
            label = f"STRIKE_V13_Surface_{i:02d}_{'L' if side < 0 else 'R'}"
            spawn_surface(label, ground_mesh, mat, (x, y, 159.0 + (i % 2)), (4.2, 2.4, 1.0), i * 7.0)
            added.append(label)

    street_assets = (
        "/Game/Phantom/Curated/Strike/SM_Strike_Container",
        "/Game/Phantom/Curated/Strike/SM_Strike_StreetProp",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Barrel",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Crate",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Barrel",
    )
    for i in range(40):
        side = -1.0 if i % 2 == 0 else 1.0
        x = -8200.0 + (i // 2) * 235.0
        y = side * (1350.0 + (i % 5) * 190.0)
        mesh = street_assets[i % len(street_assets)]
        scale = 0.58 if "Container" in mesh else 0.72 if "StreetProp" in mesh else 0.65
        label = f"STRIKE_V13_StreetDetail_{i:02d}"
        spawn_mesh(label, mesh, (x, y), (scale, scale, scale), 90.0 + i * 29.0, 160.0, False)
        added.append(label)

    # Larger silhouettes remain safely outside the 30m x 30m insertion box.
    buildings = (
        ("STRIKE_V13_Warehouse", "/Game/Phantom/Curated/Strike/SM_Strike_Warehouse", (-2500, -5200), 0.82, 90.0),
        ("STRIKE_V13_Industrial", "/Game/Phantom/Curated/Strike/SM_Strike_Industrial", (-1200, 5200), 0.78, -90.0),
        ("STRIKE_V13_Commercial", "/Game/Phantom/Curated/Strike/SM_Strike_Commercial", (1200, -4900), 0.76, 90.0),
    )
    for label, mesh, pos, scale, yaw in buildings:
        spawn_mesh(label, mesh, pos, (scale, scale, scale), yaw, 4.0, False)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "removed_rejected": rejected, "added": added}


def patch_legends(ground_mesh):
    path = WORLD_ROOT + "/PhantomLegends_World"
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = remove_previous_v13()
    rejected = remove_rejected_aliases()
    grass = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Grass")
    dirt = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Dirt")
    rock = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Rock")
    cobble = load_asset("/Game/Phantom/Materials/Production/M_Phantom_Cobble")
    added = []
    cx, cy = -120000.0, -95000.0

    # A 5x5 capital-biome quilt replaces the single-color command-space impression.
    materials = (grass, dirt, grass, rock, cobble)
    for gy in range(-2, 3):
        for gx in range(-2, 3):
            i = (gx + 2) + (gy + 2) * 5
            label = f"LEG_V13_Biome_{gx + 2}_{gy + 2}"
            spawn_surface(
                label,
                ground_mesh,
                materials[(gx * gx + gy + 7) % len(materials)],
                (cx + gx * 6200.0, cy + gy * 6200.0, 2.0 + (i % 3) * 0.1),
                (34.0, 34.0, 1.0),
                (gx - gy) * 3.0,
            )
            added.append(label)

    safe_tree = "/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees"
    rock_mesh = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock"
    bush = "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush"
    for i in range(48):
        angle = i * math.tau / 48.0
        ring = i % 3
        radius = 9200.0 + ring * 3100.0 + (i % 5) * 260.0
        mesh = safe_tree if i % 3 == 0 else bush if i % 3 == 1 else rock_mesh
        scale = 1.65 if mesh == safe_tree else 2.2 if mesh == bush else 1.75
        label = f"LEG_V13_CapitalRing_{i:02d}"
        spawn_mesh(
            label,
            mesh,
            (cx + math.cos(angle) * radius, cy + math.sin(angle) * radius),
            (scale, scale, scale),
            math.degrees(angle) + 90.0,
            5.0,
        )
        added.append(label)

    landmarks = (
        ("LEG_V13_Market", "/Game/Phantom/Curated/Legends/SM_Legends_Market", (cx - 7200, cy + 4200), 1.05, 35.0),
        ("LEG_V13_Windmill", "/Game/Phantom/Curated/Legends/SM_Legends_Windmill", (cx + 9800, cy - 6600), 1.15, 205.0),
        ("LEG_V13_Ruin", "/Game/Phantom/Curated/Legends/SM_Legends_Ruin", (cx - 10500, cy - 8500), 1.10, 18.0),
        ("LEG_V13_Tower", "/Game/Phantom/Curated/Legends/SM_Legends_Tower", (cx + 11600, cy + 7800), 1.0, -25.0),
        ("LEG_V13_Barracks", "/Game/Phantom/Curated/Legends/SM_Legends_Barracks", (cx + 6100, cy + 9500), 1.0, 145.0),
    )
    for label, mesh, pos, scale, yaw in landmarks:
        spawn_mesh(label, mesh, pos, (scale, scale, scale), yaw, 5.0, False)
        added.append(label)

    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {"map": path, "removed_previous": removed, "removed_rejected": rejected, "added": added}


results = {"revision": "V13", "status": "RUNNING", "patch_tag": PATCH_TAG}
try:
    ground_mesh = ensure_ground_mesh()
    results["cubetown"] = patch_cubetown(ground_mesh)
    results["phantom-ages"] = patch_ages(ground_mesh)
    results["phantom-strike"] = patch_strike(ground_mesh)
    results["phantom-legends"] = patch_legends(ground_mesh)
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V13 PORTFOLIO WORLD PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V13 PORTFOLIO WORLD PATCH PASS")
