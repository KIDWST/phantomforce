"""Rebuild CubeTown's first playable district as a compact authored diorama.

This pass removes the obsolete additive corridor composition and replaces it with one bounded,
readable starter-home -> town-square -> forge/market -> river -> Phantomite-gate route.
Idempotent: every V23 actor is tagged and replaced on rerun.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
PRODUCTION_TAG = "PhantomProductionWorldV11"
TAG = "PhantomProductionWorldV23"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV23VerticalSlice.json")
PLANE = "/Game/Phantom/Generated/Cubetown/V17/SM_V17_DioramaGroundPatch"
MATERIAL_ROOT = "/Game/Phantom/Generated/Cubetown/V17/Materials"

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("CubeTown V23 requires Unreal editor subsystems")


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


def load(path, required=False):
    result = unreal.EditorAssetLibrary.load_asset(path)
    if required and not result:
        raise RuntimeError("Required CubeTown V23 asset is missing: " + path)
    return result


def component_of(actor):
    try:
        return actor.get_editor_property("static_mesh_component")
    except Exception:
        found = actor.get_components_by_class(unreal.StaticMeshComponent)
        return found[0] if found else None


def apply_material_role(actor, role):
    """Apply a unified authored surface while preserving the source mesh silhouette."""
    if not actor:
        return actor
    material = load(f"{MATERIAL_ROOT}/M_CT17_{role}", required=True)
    component = component_of(actor)
    if not component:
        raise RuntimeError(f"Could not resolve mesh component for {label_of(actor)}")
    try:
        mesh = component.get_editor_property("static_mesh")
        slot_count = max(
            1,
            int(component.get_num_materials()),
            len(mesh.get_editor_property("static_materials")) if mesh else 0,
        )
    except Exception:
        slot_count = 1
    for slot in range(slot_count):
        component.set_material(slot, material)
    return actor


def tag(actor, label, extra=()):
    values = tags_of(actor)
    for value in (PRODUCTION_TAG, TAG, label, *extra):
        if value and value not in values:
            values.append(value)
    actor.set_editor_property("tags", [unreal.Name(value) for value in values])


def align_to_ground(actor, ground_z):
    try:
        origin, extent = actor.get_actor_bounds(False)
        location = actor.get_actor_location()
        location.z += float(ground_z) - (float(origin.z) - float(extent.z))
        actor.set_actor_location(location, False, False)
    except Exception:
        pass


def spawn_height(label, mesh_path, location, target_height, yaw=0.0, collision=True, extra=()):
    mesh = load(mesh_path)
    if not mesh:
        unreal.log_warning("CubeTown V23 skipped missing asset: " + mesh_path)
        return None
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("Could not spawn " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION
    )
    bounds = mesh.get_bounds()
    raw_height = max(1.0, float(bounds.box_extent.z) * 2.0)
    scale = max(0.02, min(40.0, float(target_height) / raw_height))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    align_to_ground(actor, location[2])
    tag(actor, label, extra)
    return actor


def spawn_sized(label, mesh_path, location, target_dimension, yaw=0.0, collision=False, extra=()):
    mesh = load(mesh_path)
    if not mesh:
        unreal.log_warning("CubeTown V23 skipped missing asset: " + mesh_path)
        return None
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("Could not spawn " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION
    )
    size = mesh.get_bounds().box_extent * 2.0
    raw = max(1.0, float(max(size.x, size.y, size.z)))
    scale = max(0.02, min(40.0, float(target_dimension) / raw))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    align_to_ground(actor, location[2])
    tag(actor, label, extra)
    return actor


def spawn_surface(label, role, location, scale, yaw=0.0):
    mesh = load(PLANE, required=True)
    material = load(f"{MATERIAL_ROOT}/M_CT17_{role}", required=True)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("Could not spawn surface " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    tag(actor, label, ("CubeTownV23.Surface",))
    return actor


def remove_obsolete_composition():
    removed = []
    preserved = []
    for actor in list(actors.get_all_level_actors() or []):
        if not isinstance(actor, unreal.StaticMeshActor):
            continue
        label = label_of(actor)
        actor_tags = tags_of(actor)
        is_cubetown_art = (
            PRODUCTION_TAG in actor_tags
            or TAG in actor_tags
            or label.startswith("CT_")
            or label.startswith("CT17_")
        )
        if not is_cubetown_art:
            continue
        # Keep the authored full-world terrain base; every additive road/house/prop layer is rebuilt.
        if label == "CT_Terrain_Cube_11":
            preserved.append(label)
            continue
        actors.destroy_actor(actor)
        removed.append(label)
    return removed, preserved


def add_path(added):
    # A narrow authored cobblestone lane replaces the oversized procedural blue runway.
    # Quaternius path pieces carry their own finished multi-material presentation.
    points = (
        (0, -10600, 0),
        (-45, -9700, 2),
        (35, -8800, -2),
        (-30, -7900, 2),
        (20, -7000, -1),
        (0, -6250, 0),
    )
    for index, (x, y, yaw) in enumerate(points):
        added.append(apply_material_role(spawn_height(
            f"CT_V23_Approach_{index:02d}",
            "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight",
            (x, y, 14), 42, yaw, False, ("CubeTownV23.Surface",),
        ), "HeartstonePath"))
    # A disciplined three-by-three plaza keeps the civic center readable from the
    # diorama camera.  Rotating and overlapping these tiles produced a visible
    # blue/tan fan that read as construction geometry in the packaged build.
    plaza_offsets = (
        (0, 0), (-610, 0), (610, 0), (0, -610), (0, 610),
        (-610, -610), (610, -610), (-610, 610), (610, 610),
    )
    for index, (dx, dy) in enumerate(plaza_offsets):
        added.append(apply_material_role(spawn_sized(
            f"CT_V23_Plaza_{index:02d}",
            "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square",
            (dx, -7200 + dy, 14), 620, 0.0, False, ("CubeTownV23.Surface",),
        ), "HeartstonePath"))


def add_starter_home(added):
    added.append(spawn_height(
        "CT_V23_StarterHome",
        "/Game/Phantom/External/Quaternius/MedievalVillage/House_2",
        (-1550, -9200, 18), 430, 28, True, ("Cubetown.StarterHome",),
    ))
    # Furnished home lot vignette: recognizable household props, not primitive greybox furniture.
    home_props = (
        ("Bench", "/Game/Phantom/External/Quaternius/MedievalVillage/Bench_2", (-760, -10300, 20), 105, -70),
        ("Chest", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Chest", (-1650, -10160, 20), 92, 12),
        ("Cauldron", "/Game/Phantom/External/Quaternius/MedievalVillage/Cauldron", (-1680, -9450, 20), 95, 0),
        ("Crate", "/Game/Phantom/Generated/Common/SM_Crate_A", (-1720, -9300, 20), 80, 20),
        ("Sign", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Sign", (-480, -9640, 20), 150, -22),
        ("LanternA", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (-520, -10220, 20), 245, 0),
        ("LanternB", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (-500, -9300, 20), 245, 0),
    )
    for name, asset, location, height, yaw in home_props:
        added.append(spawn_height(f"CT_V23_Home_{name}", asset, location, height, yaw, False))
    fence_positions = (
        (-1900, -10500, 0), (-1450, -10500, 0), (-1000, -10500, 0),
        (-1900, -9150, 0), (-1450, -9150, 0), (-1000, -9150, 0),
        (-2050, -10250, 90), (-2050, -9800, 90), (-2050, -9350, 90),
    )
    for index, (x, y, yaw) in enumerate(fence_positions):
        added.append(spawn_sized(f"CT_V23_HomeFence_{index:02d}", "/Game/Phantom/External/Quaternius/MedievalVillage/Fence", (x, y, 18), 430, yaw, True))

    # A small buildable garden opposite the starter home makes the first screen feel inhabited.
    garden_assets=(
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush",
    )
    for index, (x, y) in enumerate(((850,-10050),(1180,-10000),(1510,-9980),(900,-9560),(1240,-9520),(1580,-9500))):
        added.append(spawn_height(f"CT_V23_HomeGarden_{index:02d}", garden_assets[index%2], (x,y,18), 75+(index%2)*65, index*31, False))
    added.append(spawn_height("CT_V23_HomeGardenTree", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A", (1850,-9650,18), 560, -18, False))


def add_town(added):
    architecture = (
        ("Forge", "/Game/Phantom/External/Quaternius/MedievalVillage/Blacksmith", (1650, -6900, 18), 610, -68, ("Cubetown.Forge",)),
        ("MarketHall", "/Game/Phantom/External/Quaternius/MedievalVillage/House_4", (-1650, -7050, 18), 510, 72, ()),
        ("Inn", "/Game/Phantom/External/Quaternius/MedievalVillage/Inn", (-1900, -5250, 18), 680, 122, ()),
        ("Workshop", "/Game/Phantom/External/Quaternius/MedievalVillage/House_1", (1900, -5200, 18), 590, -120, ()),
        ("HomeA", "/Game/Phantom/External/Quaternius/MedievalVillage/House_3", (-1650, -8500, 18), 520, 44, ()),
        ("HomeB", "/Game/Phantom/External/Quaternius/MedievalVillage/House_1", (1550, -8450, 18), 570, -42, ()),
        ("HomeC", "/Game/Phantom/Curated/Cube/SM_Cube_House_A", (-2850, -3500, 18), 560, 132, ()),
        ("HomeD", "/Game/Phantom/Curated/Cube/SM_Cube_House_B", (2850, -3450, 18), 560, -132, ()),
    )
    for name, asset, location, height, yaw, extra in architecture:
        added.append(spawn_height(f"CT_V23_{name}", asset, location, height, yaw, True, extra))
    added.append(spawn_height("CT_V23_Fountain", "/Game/Phantom/External/Quaternius/MedievalVillage/Well", (0, -7200, 16), 300, 0, False, ("Cubetown.TownSquare",)))

    market_props = (
        ("MarketA", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_1", (-1180, -7550, 18), 250, 15),
        ("MarketB", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2", (-1260, -6950, 18), 250, -8),
        ("MarketC", "/Game/Phantom/Generated/Cubetown/SM_CubetownMarketStall", (-950, -6400, 18), 250, -18),
        ("ForgeCart", "/Game/Phantom/External/Quaternius/MedievalVillage/Cart", (1250, -7600, 18), 175, 42),
        ("ForgeCrates", "/Game/Phantom/Generated/Common/SM_Crate_A", (1120, -6300, 18), 95, 15),
        ("ForgeBarrel", "/Game/Phantom/External/Quaternius/MedievalVillage/Barrel", (1330, -6200, 18), 95, 0),
        ("SquareBenchA", "/Game/Phantom/External/Quaternius/MedievalVillage/Bench_1", (-680, -7900, 18), 105, 0),
        ("SquareBenchB", "/Game/Phantom/External/Quaternius/MedievalVillage/Bench_2", (680, -6500, 18), 105, 180),
    )
    for name, asset, location, height, yaw in market_props:
        added.append(spawn_height(f"CT_V23_{name}", asset, location, height, yaw, False))

    for index, (x, y) in enumerate(((-620,-8050),(620,-8050),(-850,-6250),(850,-6250),(-430,-8800),(430,-8800))):
        added.append(spawn_height(f"CT_V23_Lantern_{index:02d}", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (x, y, 18), 260, index*17, False))


def add_river_and_gate(added):
    added.append(spawn_sized("CT_V23_River_Stream", "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_Stream_120m", (0, -2950, 9), 9400, 0, False))
    added.append(spawn_sized("CT_V23_RiverBridge", "/Game/Phantom/Curated/Cube/SM_Cube_Bridge", (0, -2950, 18), 1450, 90, True, ("Cubetown.RiverBridge",)))
    for index, y in enumerate((-2300,-1450,-600)):
        added.append(apply_material_role(spawn_height(f"CT_V23_NorthPath_{index:02d}", "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight", (0,y,14), 42, 0, False, ("CubeTownV23.Surface",)), "HeartstonePath"))

    added.append(spawn_height("CT_V23_PhantomiteGate", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A", (0, 350, 18), 780, 0, True, ("Cubetown.PhantomiteGate",)))
    for index, (x, y) in enumerate(((-820,280),(820,280),(-1250,920),(1250,920),(-700,1450),(700,1450))):
        added.append(spawn_height(f"CT_V23_GateCrystal_{index:02d}", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A", (x, y, 18), 330+index*18, index*31, False))
    for index, (x, y) in enumerate(((-1650,550),(1650,550),(-1550,1580),(1550,1580))):
        added.append(spawn_height(f"CT_V23_GateRock_{index:02d}", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember", (x, y, 18), 280+index*25, index*41, True))


def add_phantomite_lair(added):
    """A compact combat room beyond the gate: readable cover, treasure, and guardian arena."""
    floor_points = (
        (-900, 2850), (0, 2850), (900, 2850),
        (-900, 3650), (0, 3650), (900, 3650),
        (-900, 4450), (0, 4450), (900, 4450),
    )
    for index, (x, y) in enumerate(floor_points):
        # Use the authored stone-square mesh instead of rotated flat material cards.  The old
        # overlapping cards exposed triangular grass gaps and read as a debug checkerboard.
        added.append(apply_material_role(spawn_sized(
            f"CT_V23_LairFloor_{index:02d}",
            "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square",
            (x, y, 14), 980, 0, False, ("CubeTownV23.Surface",),
        ), "DungeonTile"))

    walls = (
        (-1720, 2800, 90), (-1720, 3700, 90), (-1720, 4600, 90),
        (1720, 2800, 90), (1720, 3700, 90), (1720, 4600, 90),
        (-1050, 5200, 0), (0, 5200, 0), (1050, 5200, 0),
    )
    for index, (x, y, yaw) in enumerate(walls):
        added.append(spawn_height(
            f"CT_V23_LairWall_{index:02d}",
            "/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall",
            (x, y, 18), 560 if index < 6 else 680, yaw, True,
        ))

    added.append(spawn_height("CT_V23_LairChest", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Chest", (0, 4700, 18), 145, 180, False, ("Cubetown.LairTreasure",)))
    added.append(spawn_height("CT_V23_LairAltar", "/Game/Phantom/Generated/Cubetown/SM_CubetownShrine", (0, 4100, 18), 360, 0, False, ("Cubetown.GuardianArena",)))
    for index, (x, y) in enumerate(((-1050,3000),(1050,3000),(-1180,4200),(1180,4200),(-650,4950),(650,4950))):
        added.append(spawn_height(f"CT_V23_LairCrystal_{index:02d}", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A", (x, y, 18), 280+(index%3)*55, index*43, False))
    for index, (x, y) in enumerate(((-620,3350),(620,3350),(-820,4500),(820,4500))):
        added.append(spawn_height(f"CT_V23_LairCover_{index:02d}", "/Game/Phantom/External/Quaternius/MedievalVillage/Rock_2", (x, y, 18), 230+(index%2)*40, index*37, True))
    for index, (x, y) in enumerate(((-950, 4700), (950, 4700), (-1150, 3300), (1150, 3300))):
        added.append(spawn_height(f"CT_V23_LairBonfire_{index:02d}", "/Game/Phantom/External/Quaternius/MedievalVillage/Bonfire_Lit", (x, y, 18), 150, index*90, False))
    # Purposeful dungeon clutter gives every quadrant a gameplay-readable silhouette: breakable
    # supply stacks, barricades, ritual equipment, and asymmetric treasure rather than empty floor.
    clutter = (
        ("Crate", -1180, 3650, 155, 18), ("Barrel", -1060, 3760, 145, -12),
        ("Crate", 1120, 3550, 140, -20), ("Barrel", 1240, 3660, 150, 15),
        ("Cauldron", -980, 4250, 150, 0), ("Bags", 1020, 4320, 125, 40),
        ("Crate", -1280, 4850, 135, 12), ("Barrel", 1280, 4860, 145, -8),
    )
    for index, (asset, x, y, height, yaw) in enumerate(clutter):
        added.append(spawn_height(
            f"CT_V23_LairClutter_{index:02d}",
            f"/Game/Phantom/External/Quaternius/MedievalVillage/{asset}",
            (x, y, 18), height, yaw, False,
        ))
    for index, (x, y, yaw) in enumerate(((-760, 3120, 28), (760, 3150, -24), (-610, 4680, -18), (610, 4700, 18))):
        added.append(spawn_sized(
            f"CT_V23_LairBarricade_{index:02d}",
            "/Game/Phantom/External/Quaternius/MedievalVillage/Fence",
            (x, y, 18), 420, yaw, True,
        ))
    # The previous combined arch imported as a single flat slab from this camera.  A layered,
    # multi-material silhouette gives the guardian room a readable destination instead.
    added.append(spawn_height(
        "CT_V23_LairBellTower",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Bell_Tower",
        (0, 5550, 18), 760, 180, True, ("Cubetown.LairLandmark",),
    ))
    for index, x in enumerate((-1250, 1250)):
        added.append(spawn_height(
            f"CT_V23_LairTower_{index:02d}",
            "/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower",
            (x, 5300, 18), 580, 180 if index == 0 else 0, True,
        ))


def add_nature(added):
    tree_assets = (
        "/Game/Phantom/Generated/Common/SM_StorybookTree_A",
        "/Game/Phantom/Generated/Common/SM_StorybookTree_B",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A",
        "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
    )
    tree_points = []
    for side in (-1, 1):
        for row in range(11):
            tree_points.append((side*(2450+(row%3)*360), -10800+row*900, row))
    tree_points.extend(((-3300,-11200,20),(3300,-11200,21),(-5200,-3000,22),(5200,-3000,23),(0,1250,24)))
    for index, (x, y, variant) in enumerate(tree_points):
        added.append(spawn_height(f"CT_V23_Tree_{index:02d}", tree_assets[variant%len(tree_assets)], (x, y, 18), 470+(index%4)*55, index*29, False))

    detail_assets = (
        "/Game/Phantom/Generated/Common/SM_Bush_A",
        "/Game/Phantom/Generated/Common/SM_FlowerPatch_A",
        "/Game/Phantom/External/Quaternius/MedievalVillage/Rock_2",
        "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamHerbPatch_A",
    )
    for index in range(56):
        angle=index*2.399963
        ring=2200+(index%7)*520
        center_y=-6900 if index<40 else -1000
        x=math.cos(angle)*ring
        y=center_y+math.sin(angle)*ring*0.72
        # Preserve the cobble lane and the immediate player footprint.
        if abs(x)<720 and -11000<y<-900:
            x += 1250 if math.cos(angle)>=0 else -1250
        asset=detail_assets[index%len(detail_assets)]
        target=(145 if index%4!=2 else 230)+(index%3)*25
        added.append(spawn_height(f"CT_V23_Detail_{index:02d}", asset, (x, y, 18), target, index*37, False))


def patch():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed, preserved = remove_obsolete_composition()
    added = []
    add_path(added)
    add_starter_home(added)
    add_town(added)
    add_river_and_gate(added)
    add_phantomite_lair(added)
    add_nature(added)
    added = [actor for actor in added if actor]
    if len(added) < 120:
        raise RuntimeError(f"CubeTown V23 composition is incomplete: only {len(added)} actors")
    if not level.save_current_level():
        raise RuntimeError("Could not save CubeTown V23 world")
    return {
        "map": WORLD,
        "removed_obsolete_actors": len(removed),
        "preserved": preserved,
        "actors_added": len(added),
        "forge_count": sum(1 for actor in added if actor.actor_has_tag("Cubetown.Forge")),
        "starter_home_count": sum(1 for actor in added if actor.actor_has_tag("Cubetown.StarterHome")),
        "gate_count": sum(1 for actor in added if actor.actor_has_tag("Cubetown.PhantomiteGate")),
    }


result = {"revision": "V23", "status": "RUNNING"}
try:
    result["cubetown"] = patch()
    result["status"] = "PASS"
except Exception as exc:
    result["status"] = "FAIL"
    result["error"] = str(exc)
    result["traceback"] = traceback.format_exc()
    unreal.log_error("CUBETOWN V23 VERTICAL SLICE FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

unreal.log("CUBETOWN V23 VERTICAL SLICE PASS " + json.dumps(result["cubetown"]))
