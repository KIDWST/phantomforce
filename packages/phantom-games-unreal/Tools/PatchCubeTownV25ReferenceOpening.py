"""Recompose CubeTown's opening district against the approved premium-diorama reference.

This pass is deliberately local: it replaces the visible starter-town blockout without enlarging
the 960 m world.  The result is one coherent home -> market -> fountain -> river/bridge route with
human-scale architecture, dense landscaping, and authored licensed meshes.
"""
from __future__ import annotations

import json
import math
import os

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
TAG = "PhantomProductionWorldV25"
LEGACY_GATE_TAG = "PhantomProductionWorldV23"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV25ReferenceOpening.json")
Q = "/Game/Phantom/External/Quaternius/MedievalVillage"
K = "/Game/Phantom/External/KayKitDungeonV25"
COBBLE = "/Game/Phantom/Generated/Cubetown/V17/Materials/M_CT17_HeartstoneCobble"
GRASS = "/Game/Phantom/Generated/Cubetown/V24/Materials/M_CT24_HeartstoneGrass"
GRASS_DETAIL = "/Game/Phantom/Generated/Cubetown/V17/Materials/M_CT17_HeartstoneGrass"
DUNGEON = "/Game/Phantom/Generated/Cubetown/V17/Materials/M_CT17_DungeonTile"
V26_MATERIAL_ROOT = "/Game/Phantom/Generated/Cubetown/V26/Materials"
GROUND_NATURAL = f"{V26_MATERIAL_ROOT}/M_CT26_HeartstoneGrass"
FOLIAGE_LIGHT = f"{V26_MATERIAL_ROOT}/M_CT26_FoliageLight"
FOLIAGE_DEEP = f"{V26_MATERIAL_ROOT}/M_CT26_FoliageDeep"
PATH_WARM = f"{V26_MATERIAL_ROOT}/M_CT26_HeartstonePath"
ROOF_BLUE = f"{V26_MATERIAL_ROOT}/M_CT26_RoofBlue"
ROOF_RED = f"{V26_MATERIAL_ROOT}/M_CT26_RoofRed"
WATER_BLUE = f"{V26_MATERIAL_ROOT}/M_CT26_RiverBlue"
LAIR_STONE = f"{V26_MATERIAL_ROOT}/M_CT26_LairStone"
CRYSTAL_CYAN = f"{V26_MATERIAL_ROOT}/M_CT26_CrystalCyan"
CRYSTAL_PURPLE = f"{V26_MATERIAL_ROOT}/M_CT26_CrystalPurple"
MAGIC_PURPLE = f"{V26_MATERIAL_ROOT}/M_CT26_MagicPurple"

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("CubeTown V25 reference opening requires Unreal editor subsystems")


def load(path, required=True):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if required and not asset:
        raise RuntimeError("Missing CubeTown V25 asset: " + path)
    return asset


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


def tag(actor, label, extra=()):
    values = tags_of(actor)
    for value in (
        "PhantomProductionWorldV11", TAG, LEGACY_GATE_TAG, label,
        "CubeTown.ReferenceOpening", *extra,
    ):
        if value and value not in values:
            values.append(value)
    actor.set_editor_property("tags", [unreal.Name(value) for value in values])


def align_to_ground(actor, ground_z):
    origin, extent = actor.get_actor_bounds(False)
    location = actor.get_actor_location()
    location.z += float(ground_z) - (float(origin.z) - float(extent.z))
    actor.set_actor_location(location, False, False)


def set_material(actor, material_path, slots="all"):
    if not actor or not material_path:
        return actor
    material = load(material_path)
    component = component_of(actor)
    if not component:
        raise RuntimeError("Missing mesh component for " + label_of(actor))
    count = max(1, int(component.get_num_materials()))
    if slots == "leaves":
        slot_names = []
        try:
            slot_names = [str(value).lower() for value in component.get_material_slot_names()]
        except Exception:
            slot_names = []
        leaf_slots = [index for index, name in enumerate(slot_names) if "leaf" in name or "foliage" in name]
        for index in (leaf_slots or [0]):
            component.set_material(index, material)
    else:
        for index in range(count):
            component.set_material(index, material)
    return actor


def ensure_color_material(asset_name, color, roughness=0.90, specular=0.08):
    """Create a stable, non-tiled art-direction material for the reference opening."""
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    unreal.EditorAssetLibrary.make_directory(V26_MATERIAL_ROOT)
    path = f"{V26_MATERIAL_ROOT}/{asset_name}"
    material = load(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
    if material:
        mel.delete_all_material_expressions(material)
    else:
        material = asset_tools.create_asset(asset_name, V26_MATERIAL_ROOT, unreal.Material, unreal.MaterialFactoryNew())
    if not material:
        raise RuntimeError("Could not create CubeTown V26 material " + path)
    for usage_property in ("used_with_nanite", "used_with_instanced_static_meshes"):
        try:
            material.set_editor_property(usage_property, True)
        except Exception:
            pass
    base = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -420, -80)
    base.set_editor_property("parameter_name", "Color")
    base.set_editor_property("default_value", unreal.LinearColor(color[0], color[1], color[2], 1.0))
    mel.connect_material_property(base, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
    rough = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -260, 120)
    rough.set_editor_property("r", float(roughness))
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    spec = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -260, 220)
    spec.set_editor_property("r", float(specular))
    mel.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    return path


def ensure_world_surface_material(asset_name, source_role, brightness, world_uv_scale):
    """Build a seamless world-space PBR surface for the tiled diorama meshes."""
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    unreal.EditorAssetLibrary.make_directory(V26_MATERIAL_ROOT)
    path = f"{V26_MATERIAL_ROOT}/{asset_name}"
    material = load(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
    if material:
        mel.delete_all_material_expressions(material)
    else:
        material = asset_tools.create_asset(asset_name, V26_MATERIAL_ROOT, unreal.Material, unreal.MaterialFactoryNew())
    if not material:
        raise RuntimeError("Could not create CubeTown V26 surface " + path)
    for usage_property in ("used_with_nanite", "used_with_instanced_static_meshes"):
        try:
            material.set_editor_property(usage_property, True)
        except Exception:
            pass

    texture_root = f"/Game/Phantom/Generated/Cubetown/V17/Materials/Textures/{source_role}/T_CT17_{source_role}"
    base_texture = load(texture_root + "_BaseColor")
    rough_texture = load(texture_root + "_Roughness")
    normal_texture = load(texture_root + "_Normal")
    world_position = mel.create_material_expression(material, unreal.MaterialExpressionWorldPosition, -1050, 80)
    xy = mel.create_material_expression(material, unreal.MaterialExpressionComponentMask, -870, 80)
    xy.set_editor_property("r", True)
    xy.set_editor_property("g", True)
    scale = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -870, 210)
    scale.set_editor_property("r", float(world_uv_scale))
    uv = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -690, 80)
    mel.connect_material_expressions(world_position, "", xy, "")
    mel.connect_material_expressions(xy, "", uv, "A")
    mel.connect_material_expressions(scale, "", uv, "B")

    def sample(texture, x, y, sampler=None):
        node = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, x, y)
        node.set_editor_property("texture", texture)
        if sampler is not None:
            node.set_editor_property("sampler_type", sampler)
        mel.connect_material_expressions(uv, "", node, "UVs")
        return node

    base = sample(base_texture, -500, -100)
    tone = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -500, 20)
    tone.set_editor_property("r", float(brightness))
    toned = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -290, -80)
    mel.connect_material_expressions(base, "RGB", toned, "A")
    mel.connect_material_expressions(tone, "", toned, "B")
    mel.connect_material_property(toned, "", unreal.MaterialProperty.MP_BASE_COLOR)
    rough = sample(rough_texture, -500, 290, unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    normal = sample(normal_texture, -500, 120, unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    mel.connect_material_property(rough, "R", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(normal, "RGB", unreal.MaterialProperty.MP_NORMAL)
    spec = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -290, 390)
    spec.set_editor_property("r", 0.10)
    mel.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    return path


def ensure_reference_materials():
    # Linear colors deliberately sit below the former fluorescent grass/leaf values. Soft sunlight
    # lifts them into a lush storybook range without clipping all vegetation to the same green.
    ensure_world_surface_material("M_CT26_HeartstoneGrass", "HeartstoneGrass", 0.23, 0.0018)
    ensure_color_material("M_CT26_FoliageLight", (0.070, 0.285, 0.060), 0.91, 0.05)
    ensure_color_material("M_CT26_FoliageDeep", (0.030, 0.155, 0.052), 0.93, 0.04)
    ensure_world_surface_material("M_CT26_HeartstonePath", "HeartstoneCobble", 0.48, 0.0027)
    ensure_color_material("M_CT26_RoofBlue", (0.035, 0.185, 0.345), 0.88, 0.07)
    ensure_color_material("M_CT26_RoofRed", (0.385, 0.075, 0.038), 0.90, 0.06)
    ensure_color_material("M_CT26_RiverBlue", (0.012, 0.175, 0.48), 0.20, 0.70)
    ensure_world_surface_material("M_CT26_LairStone", "CrownStone", 0.32, 0.0032)
    ensure_color_material("M_CT26_CrystalCyan", (0.04, 0.62, 0.92), 0.26, 0.55)
    ensure_color_material("M_CT26_CrystalPurple", (0.44, 0.06, 0.86), 0.24, 0.58)
    ensure_color_material("M_CT26_MagicPurple", (0.34, 0.03, 0.72), 0.20, 0.62)


def spawn_height(label, mesh_path, location, target_height, yaw=0.0, collision=True, extra=(), material=None, material_slots="all"):
    mesh = load(mesh_path)
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"{label} expected a StaticMesh from {mesh_path}")
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
    raw_height = max(1.0, float(mesh.get_bounds().box_extent.z) * 2.0)
    scale = max(0.02, min(80.0, float(target_height) / raw_height))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    actor.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)), False)
    align_to_ground(actor, location[2])
    tag(actor, label, extra)
    set_material(actor, material, material_slots)
    return actor


def spawn_sized(label, mesh_path, location, target_dimension, yaw=0.0, collision=False, extra=(), material=None, material_slots="all"):
    mesh = load(mesh_path)
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"{label} expected a StaticMesh from {mesh_path}")
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
    extent = mesh.get_bounds().box_extent
    raw = max(1.0, float(max(extent.x, extent.y, extent.z)) * 2.0)
    scale = max(0.02, min(100.0, float(target_dimension) / raw))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    actor.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)), False)
    align_to_ground(actor, location[2])
    tag(actor, label, extra)
    set_material(actor, material, material_slots)
    return actor


def spawn_kaykit(label, asset_name, location, scale=1.0, yaw=0.0, collision=True, extra=()):
    """Spawn KayKit's meter-authored Y-up OBJ meshes in Unreal's Z-up centimeter world."""
    mesh_path = f"{K}/{asset_name}"
    mesh = load(mesh_path)
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"{label} expected a StaticMesh from {mesh_path}")
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
    actor.set_actor_scale3d(unreal.Vector(float(scale), float(scale), float(scale)))
    actor.set_actor_rotation(unreal.Rotator(roll=90.0, pitch=0.0, yaw=float(yaw)), False)
    align_to_ground(actor, location[2])
    tag(actor, label, extra)
    return actor


def remove_obsolete_opening():
    removed = []
    # The production composition replaces the old blockout stacks completely.  Keeping these
    # actors underneath the reference town caused overlapping houses, duplicate roads, z-fighting,
    # and (in packaged builds) a giant untextured blockout shell across the left half of frame.
    legacy_opening_prefixes = (
        "CT_House_", "CT_Tree_", "CT_fence_", "CT_lantern_", "CT_bench_",
        "CT_flower_", "CT_rock_", "CT_CrimsonAccent_", "CT_V11R7_", "CT_V12_",
        "CT_V13_", "CT_V19_", "CT_V22_", "CT17_Garden",
    )
    legacy_lair_prefixes = legacy_opening_prefixes + ("CT_Stream_", "CT_Bridge", "CT_DreamPortal")
    for actor in list(actors.get_all_level_actors() or []):
        if not isinstance(actor, unreal.StaticMeshActor):
            continue
        label = label_of(actor)
        location = actor.get_actor_location()
        inside = abs(float(location.x)) <= 5800.0 and -12250.0 <= float(location.y) <= -3800.0
        inside_lair = abs(float(location.x)) <= 2600.0 and 1800.0 <= float(location.y) <= 5500.0
        inside_lair_cleanup = abs(float(location.x)) <= 6200.0 and -1800.0 <= float(location.y) <= 7800.0
        replace = TAG in tags_of(actor) or label.startswith("CT_V25_")
        replace = replace or (inside and label.startswith("CT_V23_"))
        replace = replace or (inside and label.startswith("CT_V24_Road_CrownSpine_"))
        replace = replace or (inside and label.startswith("CT_V24_Cell_"))
        replace = replace or (inside_lair and label.startswith("CT_V23_Lair"))
        replace = replace or (inside_lair and label.startswith("CT_V23_Detail_"))
        replace = replace or (inside_lair and label.startswith("CT_V24_Road_CrownSpine_"))
        replace = replace or (inside and label.startswith(legacy_opening_prefixes))
        replace = replace or (inside_lair_cleanup and label.startswith(legacy_lair_prefixes))
        if replace:
            actors.destroy_actor(actor)
            removed.append(label)
    return removed


def add_ground(added):
    # A tiled production PBR grass skin covers the camera footprint.  It is intentionally split
    # into neighborhood-sized patches so texture density stays crisp at the diorama camera.
    for row, y in enumerate((-11500, -9500, -7500, -5500, -3500)):
        for column, x in enumerate((-5000, -3000, -1000, 1000, 3000, 5000)):
            added.append(spawn_sized(
                f"CT_V25_GrassPatch_{row:02d}_{column:02d}",
                "/Game/Phantom/Generated/Cubetown/V17/SM_V17_DioramaGroundPatch",
                (x, y, 2), 2060, 0, False, ("CubeTown.ReferenceGround",),
                GROUND_NATURAL,
            ))


def add_paths(added):
    path = f"{Q}/Path_Straight"
    # Narrow, pedestrian-scaled lanes keep the village dense.  The previous 6 m-wide perfect
    # editor cross dominated the whole frame and made every building read like a loose prop.
    for index, y in enumerate(range(-11200, -7850, 365)):
        added.append(spawn_sized(
            f"CT_V25_Approach_{index:02d}", path, (0, y, 16), 410, 0, False,
            ("CubeTown.ReferenceRoad",), PATH_WARM,
        ))
    cross_x = tuple(range(-2920, 2921, 365))
    for index, x in enumerate(cross_x):
        if -240 <= x <= 240:
            continue
        added.append(spawn_sized(
            f"CT_V25_MarketCross_{index:02d}", path, (x, -7200, 16), 410, 90, False,
            ("CubeTown.ReferenceRoad",), PATH_WARM,
        ))
    for index, (x, y) in enumerate(((-1320,-7480),(-1550,-7750),(-1780,-8020),(-2010,-8290))):
        added.append(spawn_sized(
            f"CT_V26_BridgeApproach_{index:02d}", path, (x, y, 16), 390, 138, False,
            ("CubeTown.ReferenceRoad", "Cubetown.RiverBridge"), PATH_WARM,
        ))
    for index, y in enumerate(range(-6810, -3470, 365)):
        added.append(spawn_sized(
            f"CT_V25_NorthRoad_{index:02d}", path, (0, y, 16), 410, 0, False,
            ("CubeTown.ReferenceRoad",), PATH_WARM,
        ))
    # Short, slightly angled door paths connect homes without cutting empty asphalt-like bars
    # across every lawn.
    branch_index = 0
    for row, y in enumerate((-10200, -9000, -8200, -5850, -4700)):
        for side in (-1, 1):
            for step in (0, 1, 2, 3, 4, 5):
                x = side * (500 + step * 350)
                branch_y = y + side * (42 if row % 2 else -42) + step * 34
                added.append(spawn_sized(
                    f"CT_V25_Branch_{branch_index:02d}", path, (x, branch_y, 15), 390,
                    90 + side * (4 if step else 1), False, ("CubeTown.ReferenceRoad",), PATH_WARM,
                ))
                branch_index += 1
    # Sixteen tangent pieces make the plaza ring feel intentionally built rather than a rough
    # dodecagon around a giant block.
    for index in range(16):
        angle = index * (math.tau / 16.0)
        added.append(spawn_sized(
            f"CT_V25_FountainRing_{index:02d}", path,
            (math.cos(angle) * 660.0, -7200 + math.sin(angle) * 660.0, 16),
            300, math.degrees(angle), False, ("CubeTown.ReferenceRoad",), PATH_WARM,
        ))


def add_civic_center(added):
    added.append(spawn_height(
        "CT_V25_SouthLanternArch",
        "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_LanternArch",
        (0, -11230, 18), 510, 0, False,
        ("CubeTown.ReferenceLandmark", "CubeTown.ReferenceLighting"),
    ))
    for index, x in enumerate((-560, 560)):
        added.append(spawn_sized(
            f"CT_V25_SouthWelcomeGarden_{index:02d}",
            "/Game/Phantom/Generated/Common/SM_FlowerPatch_A",
            (x, -11120, 18), 235, index * 67, False,
            ("CubeTown.ReferenceGarden",),
        ))
    for tile_y in range(-2, 3):
        for tile_x in range(-2, 3):
            if math.sqrt(tile_x * tile_x + tile_y * tile_y) > 2.5:
                continue
            added.append(spawn_sized(
                f"CT_V25_HeartstonePlaza_{tile_y + 2:02d}_{tile_x + 2:02d}",
                f"{Q}/Path_Square",
                (tile_x * 225, -7200 + tile_y * 225, 15), 235, 0, False,
                ("CubeTown.ReferenceRoad", "Cubetown.TownSquare"), PATH_WARM,
            ))
    added.append(spawn_height(
        "CT_V25_HeartstoneFountainSquare",
        "/Game/Phantom/Generated/Cubetown/SM_CubetownFountain",
        (0, -7200, 17), 420, 0, False,
        ("Cubetown.TownSquare", "CubeTown.ReferenceLandmark"),
    ))
    market = (
        ("Produce", f"{Q}/MarketStand_1", (-1080, -7900, 18), 205, 15),
        ("Craft", f"{Q}/MarketStand_2", (-1280, -6820, 18), 200, -5),
        ("Flowers", f"{Q}/MarketStand_1", (1160, -6750, 18), 205, 18),
        ("ForgeCart", f"{Q}/Cart", (1120, -7950, 18), 145, 36),
        ("Gazebo", f"{Q}/Gazebo", (1420, -6060, 18), 235, -8),
        ("Bakery", f"{Q}/MarketStand_2", (-1520, -7600, 18), 200, 72),
        ("Potions", f"{Q}/MarketStand_1", (1500, -7100, 18), 205, -78),
        ("Caravan", f"{Q}/Cart", (-1450, -6050, 18), 150, -22),
    )
    for name, asset, location, height, yaw in market:
        added.append(spawn_height(f"CT_V25_Market_{name}", asset, location, height, yaw, False, ("CubeTown.ReferenceMarket",)))
    for index, (x, y, yaw) in enumerate(((-900,-8050,0),(900,-8050,180),(-900,-6350,180),(900,-6350,0))):
        added.append(spawn_height(
            f"CT_V25_SquareBench_{index:02d}", f"{Q}/Bench_{1 + (index % 2)}",
            (x, y, 18), 105, yaw, False, ("CubeTown.ReferenceTownLife",),
        ))
    for index, (x, y) in enumerate(((-820,-8220),(820,-8220),(-1040,-6200),(1040,-6200))):
        added.append(spawn_height(
            f"CT_V25_SquareLantern_{index:02d}", "/Game/Phantom/Generated/Common/SM_LanternPost_A",
            (x, y, 18), 280, index * 23, False, ("CubeTown.ReferenceLighting",),
        ))
    path_lamp_index = 0
    for y in (-10400, -9100, -8250, -5900, -4850):
        for side in (-1, 1):
            added.append(spawn_height(
                f"CT_V25_PathLantern_{path_lamp_index:02d}",
                "/Game/Phantom/Generated/Common/SM_LanternPost_A",
                (side * 470, y, 18), 245, 0, False,
                ("CubeTown.ReferenceLighting", "CubeTown.ReferenceTownLife"),
            ))
            path_lamp_index += 1
    for index, (x, y, yaw) in enumerate(((-690,-9700,0),(690,-9700,180),(-700,-8600,0),(700,-8600,180),(-680,-5500,0),(680,-5500,180))):
        added.append(spawn_height(
            f"CT_V25_PathBench_{index:02d}", f"{Q}/Bench_{1 + index % 2}",
            (x, y, 18), 100, yaw, False, ("CubeTown.ReferenceTownLife",),
        ))


def add_architecture(added):
    buildings = (
        ("StarterHome", f"{Q}/House_2", (-1320,-10280,18), 610, 28, ("Cubetown.StarterHome",)),
        ("GardenHome", f"{Q}/House_1", (1420,-10120,18), 560, -28, ()),
        ("SouthCottage", f"{Q}/House_2", (-1500,-9000,18), 520, 42, ()),
        ("BlueCottage", f"{Q}/House_1", (1480,-8850,18), 515, -38, ()),
        ("MarketHall", f"{Q}/House_2", (-1850,-8100,18), 515, 76, ()),
        ("Blacksmith", f"{Q}/Blacksmith", (1880,-8050,18), 540, -72, ("Cubetown.Forge",)),
        ("Tavern", f"{Q}/House_1", (-1780,-5950,18), 530, 118, ()),
        ("Workshop", f"{Q}/House_2", (1800,-5800,18), 515, -118, ()),
        ("NorthInn", f"{Q}/Inn", (-1500,-4550,18), 590, 142, ()),
        ("NorthHome", f"{Q}/House_1", (1450,-4400,18), 520, -142, ()),
        ("RiverCottage", f"{Q}/House_2", (-3450,-10100,18), 520, 58, ()),
        ("RiverShop", f"{Q}/House_1", (-3450,-5200,18), 520, 104, ()),
        ("EastHome", f"{Q}/House_2", (2550,-10400,18), 515, -74, ()),
        ("EastCottage", f"{Q}/House_1", (2500,-8900,18), 525, -106, ()),
        ("EastShop", f"{Q}/House_2", (2500,-6500,18), 520, -92, ()),
        ("EastInn", f"{Q}/Inn", (2450,-4700,18), 575, -126, ()),
        ("RiverStable", f"{Q}/Stable", (-3500,-6650,18), 515, 92, ()),
        ("NorthBell", f"{Q}/Bell_Tower", (0,-3900,18), 620, 0, ("CubeTown.ReferenceLandmark",)),
    )
    for index, (name, asset, location, height, yaw, extra) in enumerate(buildings):
        actor = spawn_height(f"CT_V25_{name}", asset, location, height * 1.10, yaw, True, ("CubeTown.ReferenceArchitecture", *extra))
        if asset.endswith("/House_1"):
            component_of(actor).set_material(7, load(ROOF_BLUE if index % 2 else ROOF_RED))
        elif asset.endswith("/House_2"):
            component_of(actor).set_material(5, load(ROOF_RED if index % 2 else ROOF_BLUE))
        added.append(actor)


def add_river(added):
    added.append(spawn_sized(
        "CT_V25_HeartstoneRiver",
        "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_Stream_120m",
        (-2250, -7700, 10), 9400, 90, False,
        ("CubeTown.ReferenceRiver",), WATER_BLUE,
    ))
    added.append(spawn_sized(
        "CT_V25_HeartstoneBridge",
        "/Game/Phantom/External/KenneyNatureV26/SM_CT26_StoneBridge",
        (-2250, -8580, 34), 620, 90, True,
        ("Cubetown.RiverBridge", "CubeTown.ReferenceLandmark"), PATH_WARM,
    ))
    # Riverbank stones and reeds close the hard water edge and make the bridge feel embedded.
    bank_points = []
    for side in (-1, 1):
        for index, y in enumerate(range(-11300, -3900, 650)):
            bank_points.append((-2250 + side * (440 + (index % 3) * 34), y, side, index))
    for index, (x, y, side, seed) in enumerate(bank_points):
        asset = f"{Q}/Rock_{1 + (seed % 3)}" if seed % 2 == 0 else "/Game/Phantom/Generated/Common/SM_Bush_A"
        material = FOLIAGE_DEEP if "Bush" in asset and seed % 2 else (FOLIAGE_LIGHT if "Bush" in asset else None)
        added.append(spawn_sized(
            f"CT_V25_Riverbank_{index:02d}", asset, (x, y, 17), 190 + (seed % 4) * 34,
            seed * 37 + side * 11, False, ("CubeTown.ReferenceRiverbank",), material,
        ))


def add_reference_foreground(added):
    """Pack the playable foreground with the starter-story beats visible in the reference."""
    # A fenced starter plot, supplies, and warm camp detail make the lower-left home read as a
    # lived-in beginning instead of a building dropped on an empty lawn.
    starter_fence = (
        (-2050,-10920,0),(-1650,-10920,0),(-1250,-10920,0),
        (-2150,-10560,90),(-2150,-10160,90),
    )
    for index, (x, y, yaw) in enumerate(starter_fence):
        added.append(spawn_sized(
            f"CT_V26_StarterFence_{index:02d}", f"{Q}/Fence", (x, y, 18), 430, yaw, True,
            ("CubeTown.ReferenceNeighborhood", "Cubetown.StarterHome"),
        ))
    starter_props = (
        ("Barrel", f"{Q}/Barrel", (-1960,-10500,18), 110, 18),
        ("Crate", f"{Q}/Crate", (-1740,-10620,18), 105, -12),
        ("SupplyCrate", f"{Q}/Crate", (-1510,-10610,18), 92, 24),
        ("Bonfire", f"{Q}/Bonfire_Lit", (-1950,-10000,18), 130, 0),
        ("Bench", f"{Q}/Bench_1", (-1700,-9910,18), 100, 18),
    )
    for name, asset, location, height, yaw in starter_props:
        added.append(spawn_height(
            f"CT_V26_Starter{name}", asset, location, height, yaw, False,
            ("CubeTown.ReferenceTownLife", "Cubetown.StarterHome"),
        ))

    # The reference exposes construction as part of the town fantasy. A compact magic-blue build
    # plot gives the foreground a purposeful interactive landmark instead of another empty lawn.
    build_plot = (
        (850,-9600,0,360),(850,-9220,0,360),(620,-9410,90,300),(1080,-9410,90,300),
    )
    for index, (x, y, yaw, size) in enumerate(build_plot):
        added.append(spawn_sized(
            f"CT_V26_MemorycraftPlot_{index:02d}", f"{Q}/Fence", (x, y, 20), size, yaw, False,
            ("CubeTown.ReferenceBuildPlot", "Cubetown.BuildPlot"), CRYSTAL_CYAN,
        ))
    for index, (x, y) in enumerate(((390,-9780),(690,-9900),(1080,-9880),(1320,-9680),(380,-9070),(720,-8930),(1110,-8960),(1350,-9200))):
        asset = "/Game/Phantom/Generated/Common/SM_FlowerPatch_A" if index % 2 else "/Game/Phantom/Generated/Common/SM_Bush_A"
        added.append(spawn_sized(
            f"CT_V26_MemorycraftGarden_{index:02d}", asset, (x, y, 18),
            90 if "FlowerPatch" in asset else 145, index * 47, False,
            ("CubeTown.ReferenceBuildPlot", "CubeTown.ReferenceGarden"),
            FOLIAGE_LIGHT if "Bush" in asset else None,
        ))

    # Purple Phantomite and natural rock clusters create the reference's strong lower-right depth
    # anchor while leaving the hero route and camera sightline clear.
    crystal_points = (
        (-720,-10920,165,-18),(-980,-10820,220,12),(-1240,-10680,145,38),
        (-1500,-10480,205,-24),(-1760,-10180,135,51),(-1320,-9950,160,74),
    )
    for index, (x, y, height, yaw) in enumerate(crystal_points):
        added.append(spawn_height(
            f"CT_V26_ForegroundPhantomite_{index:02d}",
            "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A",
            (x, y, 18), height, yaw, False,
            ("CubeTown.ReferenceGarden", "CubeTown.ReferencePhantomite"),
            CRYSTAL_PURPLE if index % 3 else CRYSTAL_CYAN,
        ))
    for index, (x, y, height, yaw) in enumerate(((-260,-10480,245,12),(-470,-10280,205,-18),(-620,-10020,170,34))):
        added.append(spawn_height(
            f"CT_V26_HeroPhantomite_{index:02d}",
            "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A",
            (x, y, 18), height, yaw, False,
            ("CubeTown.ReferenceGarden", "CubeTown.ReferencePhantomite"),
            CRYSTAL_PURPLE if index != 1 else CRYSTAL_CYAN,
        ))
    for index, (x, y, scale) in enumerate((
        (-520,-10780,150),(-880,-10380,185),(-1580,-10800,170),(-1950,-10550,135),
        (-760,-9820,125),(-1680,-9650,165),(720,-10900,150),(880,-10150,125),
    )):
        asset = f"{Q}/Rock_{1 + index % 3}" if index % 3 == 0 else "/Game/Phantom/Generated/Common/SM_Bush_A"
        added.append(spawn_sized(
            f"CT_V26_ForegroundDetail_{index:02d}", asset, (x, y, 18), scale,
            index * 43, False, ("CubeTown.ReferenceGarden",),
            FOLIAGE_DEEP if "Bush" in asset else None,
        ))


def add_landscaping(added):
    tree_points = (
        (-5200,-11300),(-4700,-10800),(-3300,-11150),(3300,-11200),(4000,-10700),(4800,-11100),
        (-5250,-9900),(-4200,-9450),(-2100,-9700),(3100,-9700),(3900,-9300),(4750,-9800),
        (-5150,-8500),(-4050,-8000),(-2100,-8400),(3500,-8400),(4300,-8050),
        (-5200,-7000),(-4050,-6500),(-2100,-6350),(3300,-6800),(4100,-6250),(4900,-7000),
        (-5150,-5650),(-4100,-5100),(-2100,-5450),(3300,-5500),(4100,-4900),(4850,-5450),
        (-5000,-4200),(-4000,-4050),(-2100,-4100),(3200,-4050),(4200,-3950),
    )
    # Mix rounded and conifer silhouettes with the licensed trees, and preserve every authored
    # bark/leaf material. The former global grass override turned all foliage into the same neon
    # plastic and made a densely dressed village read like a prototype grid.
    tree_assets = (
        "/Game/Phantom/External/KenneyNatureV26/SM_CT26_PineRound",
        "/Game/Phantom/External/KenneyNatureV26/SM_CT26_PineTall",
        "/Game/Phantom/External/KenneyNatureV26/SM_CT26_Oak",
        "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A",
    )
    leaf_materials = (FOLIAGE_DEEP, FOLIAGE_LIGHT)
    for index, (x, y) in enumerate(tree_points):
        added.append(spawn_height(
            f"CT_V25_GreenTree_{index:02d}", tree_assets[index % len(tree_assets)],
            (x, y, 18), 500 + (index % 5) * 48, index * 31, False,
            ("CubeTown.ReferenceVegetation",), leaf_materials[index % len(leaf_materials)], "leaves",
        ))

    foreground_trees = ((-2100,-10800),(2600,-10500),(-2100,-8500),(2500,-9000),(-2100,-6200),(2500,-5400))
    for index, (x, y) in enumerate(foreground_trees):
        added.append(spawn_height(
            f"CT_V25_ForegroundTree_{index:02d}", tree_assets[index % len(tree_assets)],
            (x, y, 18), 440 + (index % 3) * 48, index * 47, False,
            ("CubeTown.ReferenceVegetation",), leaf_materials[(index + 1) % len(leaf_materials)], "leaves",
        ))

    inner_trees = (
        (-980,-10550),(1020,-10100),(-980,-9250),(980,-8750),
        (-1050,-6150),(1050,-5750),(-980,-4900),(980,-4450),
    )
    for index, (x, y) in enumerate(inner_trees):
        added.append(spawn_height(
            f"CT_V25_InnerTree_{index:02d}", tree_assets[(index + 1) % len(tree_assets)],
            (x, y, 18), 340 + (index % 3) * 34, index * 53, False,
            ("CubeTown.ReferenceVegetation",), leaf_materials[index % len(leaf_materials)], "leaves",
        ))

    for index in range(16):
        angle = index * math.tau / 16.0 + 0.16
        radius = 980.0 + (index % 2) * 95.0
        asset = "/Game/Phantom/Generated/Common/SM_Bush_A" if index % 3 else "/Game/Phantom/Generated/Common/SM_FlowerPatch_A"
        target = 86 + (index % 3) * 12 if "FlowerPatch" in asset else 150 + (index % 4) * 22
        added.append(spawn_sized(
            f"CT_V25_PlazaGarden_{index:02d}", asset,
            (math.cos(angle) * radius, -7200 + math.sin(angle) * radius, 18),
            target, index * 31, False,
            ("CubeTown.ReferenceGarden",), FOLIAGE_LIGHT if "Bush" in asset else None,
        ))

    foreground_gardens = (
        (-1050,-10800),(-720,-10400),(820,-10600),(1120,-10180),
        (-1200,-9650),(1050,-9500),(-1220,-8600),(1180,-8450),
        (-1180,-7900),(1180,-7850),(-1120,-6500),(1150,-6350),
        (-950,-5850),(980,-5700),(-1050,-5000),(1100,-4850),
    )
    for index, (x, y) in enumerate(foreground_gardens):
        asset = "/Game/Phantom/Generated/Common/SM_Bush_A" if index % 2 == 0 else "/Game/Phantom/Generated/Common/SM_FlowerPatch_A"
        target = 92 + (index % 3) * 10 if "FlowerPatch" in asset else 210 + (index % 4) * 24
        added.append(spawn_sized(
            f"CT_V25_ForegroundGarden_{index:02d}", asset, (x, y, 18),
            target, index * 39, False, ("CubeTown.ReferenceGarden",), FOLIAGE_DEEP if "Bush" in asset else None,
        ))

    lane_gardens = []
    for row, y in enumerate(range(-10900, -4300, 620)):
        lane_gardens.append((-720 - (row % 3) * 190, y))
        lane_gardens.append((720 + (row % 3) * 190, y + 170))
    for index, (x, y) in enumerate(lane_gardens):
        asset = "/Game/Phantom/Generated/Common/SM_Bush_A" if index % 3 else "/Game/Phantom/Generated/Common/SM_FlowerPatch_A"
        target = 78 + (index % 3) * 10 if "FlowerPatch" in asset else 175 + (index % 4) * 22
        added.append(spawn_sized(
            f"CT_V25_LaneGarden_{index:02d}", asset, (x, y, 18),
            target, index * 29, False, ("CubeTown.ReferenceGarden",), FOLIAGE_LIGHT if "Bush" in asset else None,
        ))

    garden_centers = ((-2050,-9600),(2350,-9300),(-2050,-8250),(2500,-8450),(-2050,-6200),(2350,-6300),(-2000,-4800),(2350,-4700))
    detail_assets = (
        "/Game/Phantom/Generated/Common/SM_FlowerPatch_A",
        "/Game/Phantom/Generated/Common/SM_Bush_A",
        f"{Q}/Rock_2",
        f"{Q}/Rock_1",
    )
    detail_index = 0
    for garden_index, (cx, cy) in enumerate(garden_centers):
        for ring_index in range(8):
            angle = (ring_index / 8.0) * math.tau + garden_index * 0.27
            radius = 340.0 + (ring_index % 2) * 120.0
            x = cx + math.cos(angle) * radius
            y = cy + math.sin(angle) * radius * 0.72
            asset = detail_assets[(detail_index + garden_index) % len(detail_assets)]
            target = 78 + (detail_index % 3) * 12 if "FlowerPatch" in asset else 135 + (detail_index % 5) * 24
            added.append(spawn_sized(
                f"CT_V25_Garden_{detail_index:03d}", asset, (x, y, 18),
                target, detail_index * 43, False,
                ("CubeTown.ReferenceGarden",), FOLIAGE_DEEP if "Bush" in asset else None,
            ))
            detail_index += 1

    # Layer medium canopy and shrubs through the residential lots. These points deliberately
    # leave the main cross-streets, fountain apron, bridge, and door approaches unobstructed.
    canopy_points = (
        (-1500,-11100),(-850,-10800),(900,-11000),(1550,-10650),
        (-1350,-9900),(-650,-9650),(700,-9850),(1450,-9500),
        (-1350,-8800),(-650,-8500),(700,-8650),(1450,-8350),
        (-1450,-7600),(1450,-7700),(-1450,-6800),(1450,-6650),
        (-1450,-5600),(-700,-5350),(750,-5500),(1450,-5200),
        (-1400,-4500),(-650,-4200),(700,-4350),(1400,-4050),
    )
    for index, (x, y) in enumerate(canopy_points):
        if index % 3 == 1:
            added.append(spawn_sized(
                f"CT_V25_CanopyShrub_{index:02d}", "/Game/Phantom/Generated/Common/SM_Bush_A",
                (x, y, 18), 165 + (index % 4) * 18, index * 37, False,
                ("CubeTown.ReferenceGarden",), FOLIAGE_LIGHT,
            ))
        else:
            added.append(spawn_height(
                f"CT_V25_CanopyTree_{index:02d}", tree_assets[(index + 2) % len(tree_assets)],
                (x, y, 18), 380 + (index % 5) * 30, index * 29, False,
                ("CubeTown.ReferenceVegetation",), leaf_materials[(index + 1) % len(leaf_materials)], "leaves",
            ))

    # Small fenced lots create readable neighborhoods and hide empty terrain seams.
    fence_segments = (
        (-2300,-10850,0),(-1900,-10850,0),(-1500,-10850,0),(-1300,-10300,90),
        (2150,-10600,0),(2650,-10600,0),(3150,-10600,0),(3400,-10050,90),
        (-2300,-8750,0),(-1900,-8750,0),(-1500,-8750,0),
        (2150,-8800,0),(2650,-8800,0),(3150,-8800,0),
        (-2300,-6100,0),(-1900,-6100,0),(-1500,-6100,0),
        (2050,-6100,0),(2550,-6100,0),(3050,-6100,0),
    )
    for index, (x, y, yaw) in enumerate(fence_segments):
        added.append(spawn_sized(
            f"CT_V25_Fence_{index:02d}", f"{Q}/Fence", (x, y, 18), 470, yaw, True,
            ("CubeTown.ReferenceNeighborhood",),
        ))

    # Layered verge planting closes the remaining lawn gaps without obstructing the playable
    # streets. Alternating flowers, shrubs, rocks, and saplings creates the compact Zelda-like
    # neighborhood rhythm visible in the approved reference instead of a flat prop grid.
    verge_index = 0
    for row, y in enumerate(range(-11020, -4100, 460)):
        for side in (-1, 1):
            for lane in (0, 1):
                x = side * (930 + lane * 1030 + (row % 3) * 115)
                offset_y = y + lane * 125 + side * 48
                selector = (verge_index + row + lane) % 5
                if selector in (0, 3):
                    asset = "/Game/Phantom/Generated/Common/SM_FlowerPatch_A"
                    target = 105 + (verge_index % 3) * 12
                    material = None
                elif selector == 1:
                    asset = f"{Q}/Rock_{1 + (verge_index % 3)}"
                    target = 120 + (verge_index % 4) * 20
                    material = None
                else:
                    asset = "/Game/Phantom/Generated/Common/SM_Bush_A"
                    target = 185 + (verge_index % 4) * 18
                    material = FOLIAGE_LIGHT if verge_index % 2 else FOLIAGE_DEEP
                added.append(spawn_sized(
                    f"CT_V27_StorybookVerge_{verge_index:03d}", asset, (x, offset_y, 18),
                    target, verge_index * 41, False,
                    ("CubeTown.ReferenceGarden", "CubeTown.ReferenceNeighborhood"), material,
                ))
                verge_index += 1


def add_town_life(added):
    people_assets = (
        "/Game/Phantom/Generated/Cubetown/Characters/SM_CubetownMira",
        "/Game/Phantom/Generated/Cubetown/Characters/SM_CubetownRowan",
        "/Game/Phantom/Generated/Cubetown/Characters/SM_CubetownPip",
    )
    people = (
        (-700,-7500,30,25),(760,-6800,30,190),(-1250,-6800,30,-40),(1320,-7480,30,145),
        (-2100,-9050,30,60),(1900,-9100,30,125),(-2400,-5200,30,-25),(2100,-5300,30,205),
        (-500,-5600,30,10),(580,-8300,30,180),
    )
    for index, (x, y, z, yaw) in enumerate(people):
        added.append(spawn_height(
            f"CT_V25_Townsfolk_{index:02d}", people_assets[index % len(people_assets)],
            (x, y, z), 175 + (index % 3) * 8, yaw, False,
            ("CubeTown.ReferenceTownLife",),
        ))
    props = (
        ("Bonfire", f"{Q}/Bonfire_Lit", (-900,-9300,18), 145, 0),
        ("Cart", f"{Q}/Cart", (-2200,-7900,18), 180, -20),
        ("Cauldron", f"{Q}/Cauldron", (2200,-8000,18), 115, 0),
        ("Crates", f"{Q}/Crate", (-2100,-6500,18), 120, 18),
        ("Barrel", f"{Q}/Barrel", (2050,-6600,18), 105, 0),
        ("SignA", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Sign", (-500,-9800,18), 170, 0),
        ("SignB", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Sign", (500,-4700,18), 170, 180),
    )
    for name, asset, location, height, yaw in props:
        added.append(spawn_height(f"CT_V25_Prop_{name}", asset, location, height, yaw, False, ("CubeTown.ReferenceTownLife",)))


def add_phantomite_lair(added):
    # A complete, readable encounter room replaces the old nine-tile square and glowing cone
    # placeholders.  The route is entrance -> cover lanes -> guardian dais -> sealed treasure.
    for row, y in enumerate((2240, 2560, 2880, 3200, 3520, 3840, 4160, 4480, 4800, 5120)):
        for column, x in enumerate((-1600, -1280, -960, -640, -320, 0, 320, 640, 960, 1280, 1600)):
            floor_actor = spawn_kaykit(
                f"CT_V25_LairFloor_{row:02d}_{column:02d}",
                "SM_KKD_FloorBroken" if (row * 11 + column) % 17 == 0 else "SM_KKD_FloorLarge",
                (x, y, 12), 0.80, 0, True,
                ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairFloor"),
            )
            # The OBJ material imported with a polished default that reflected every light like
            # chrome. CubeTown's authored rough stone keeps the tile relief while restoring depth.
            set_material(floor_actor, LAIR_STONE)
            added.append(floor_actor)

    for row, y in enumerate((3860, 4180, 4500)):
        for column, x in enumerate((-1040, -720, -400)):
            dais_actor = spawn_kaykit(
                f"CT_V25_LairBossDais_{row:02d}_{column:02d}", "SM_KKD_FloorBroken",
                (x, y, 62), 0.90, 0, True,
                ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairDais"),
            )
            set_material(dais_actor, LAIR_STONE)
            added.append(dais_actor)

    wall_index = 0
    for side in (-1, 1):
        for y in (2480, 2960, 3440, 3920, 4400, 4880):
            added.append(spawn_kaykit(
                f"CT_V25_LairSideWall_{wall_index:02d}",
                "SM_KKD_WallBroken" if wall_index % 4 == 1 else "SM_KKD_Wall",
                (side * 1780, y, 18), 1.18, 90 if side < 0 else -90, True,
                ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairWall"),
            ))
            wall_index += 1
    for index, x in enumerate((-1440, -960, -480, 480, 960, 1440)):
        added.append(spawn_kaykit(
            f"CT_V25_LairNorthWall_{index:02d}",
            "SM_KKD_WallBroken" if index in (1, 4) else "SM_KKD_Wall",
            (x, 5240, 18), 1.18, 0, True,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairWall"),
        ))
    for index, (x, y, yaw) in enumerate(((-1500,2240,0),(1500,2240,180),(-1580,5120,35),(1580,5120,-35))):
        added.append(spawn_kaykit(
            f"CT_V25_LairRuinTower_{index:02d}", "SM_KKD_PillarDecorated",
            (x, y, 18), 1.05 + (index % 2) * 0.08, yaw, True,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairLandmark"),
        ))
    added.append(spawn_kaykit(
        "CT_V25_LairGate", "SM_KKD_WallGated", (0, 5220, 18), 1.34, 0, True,
        ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairLandmark", "Cubetown.GuardianArena"),
    ))
    added.append(spawn_kaykit(
        "CT_V25_LairAltar", "SM_KKD_PillarDecorated", (-1080, 4540, 68), 0.82, 18, False,
        ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairLandmark"),
    ))
    added.append(spawn_kaykit(
        "CT_V25_LairTreasure", "SM_KKD_ChestGold", (1260, 4920, 68), 1.10, -18, False,
        ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairTreasure", "Cubetown.LairTreasure"),
    ))
    # The extracted arch ring carries an off-mesh pivot and repeatedly stood upright or drifted
    # away from the boss after scaling. A raised broken-stone rune tile is stable, readable, and
    # collision-safe in both editor and packaged builds.
    guardian_sigil = spawn_kaykit(
        "CT_V25_LairGuardianSigil", "SM_KKD_FloorBroken", (-560, 3980, 78), 0.88, 17, False,
        ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairDais", "Cubetown.GuardianArena"),
    )
    set_material(guardian_sigil, MAGIC_PURPLE)
    added.append(guardian_sigil)

    # Compact mixed-height outcroppings replace the old evenly spaced crystal bollards.
    crystal_points = (
        (-1480,2700,230,12),(-1370,2760,150,45),(-1540,2840,125,76),(-1300,2660,105,110),
        (-1450,3970,245,148),(-1320,4040,170,174),(-1540,4100,135,24),(-1260,3920,105,72),
        (-1370,4860,250,-12),(-1230,4930,175,-48),(-1510,4980,140,-76),(-1180,4800,110,-110),
        (1450,3080,230,-148),(1320,3160,165,-174),(1540,3220,135,-25),(1250,3030,105,-70),
        (1450,4800,250,-12),(1320,4880,170,-48),(1560,4930,135,-76),(1240,4750,110,-110),
        (-520,3560,185,15),(-410,3620,120,52),(-610,3680,95,86),
        (520,4040,170,-20),(420,4110,115,-62),(610,4140,90,-98),
    )
    for index, (x, y, height, yaw) in enumerate(crystal_points):
        added.append(spawn_height(
            f"CT_V25_LairCrystal_{index:02d}",
            "/Game/Phantom/Generated/Legends/V10/Setpieces/SM_V10_CrystalMonolith",
            (x, y, 20), height, yaw, False,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairCrystal"),
            CRYSTAL_PURPLE if index % 3 else CRYSTAL_CYAN,
        ))

    kaykit_props = (
        ("CratesWest", "SM_KKD_Crates", (-1120,3420,18),0.72,18),
        ("CratesEast", "SM_KKD_Crates", (1300,3650,18),0.62,-28),
        ("RubbleWest", "SM_KKD_Rubble", (-860,3810,18),0.43,22),
        ("RubbleEast", "SM_KKD_Rubble", (1180,3920,18),0.34,-38),
        ("ChestWest", "SM_KKD_Chest", (-780,3550,22),1.00,18),
        ("ChestEast", "SM_KKD_ChestGold", (1260,3380,22),0.90,-28),
        ("SpikesWest", "SM_KKD_Spikes", (-1160,4300,18),0.82,22),
        ("SpikesEast", "SM_KKD_Spikes", (1420,3990,18),0.72,-18),
        ("RubbleEntryWest", "SM_KKD_Rubble", (-1020,2800,18),0.36,28),
        ("RubbleEntryEast", "SM_KKD_Rubble", (820,2920,18),0.34,-42),
        ("RubbleGuardian", "SM_KKD_Rubble", (250,4700,18),0.38,12),
        ("CratesTreasure", "SM_KKD_Crates", (1500,4600,18),0.56,-12),
        ("CenterChest", "SM_KKD_ChestGold", (360,3720,22),0.82,-12),
        ("CenterRubble", "SM_KKD_Rubble", (-260,3880,18),0.34,38),
    )
    for name, asset, location, scale, yaw in kaykit_props:
        added.append(spawn_kaykit(
            f"CT_V25_LairProp_{name}", asset, location, scale, yaw, False,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairProp"),
        ))
    for index, (x, y, yaw) in enumerate(((-930,3600,18),(1050,3760,-28),(-1180,3160,24),(520,3440,150))):
        added.append(spawn_kaykit(
            f"CT_V25_LairBarricade_{index:02d}", "SM_KKD_Barrier", (x, y, 18), 0.92, yaw, True,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairProp"),
        ))

    # Broken masonry forms readable combat lanes and depth layers instead of giant rock blobs.
    interior_ruins = (
        (-760,3140,34),(650,3260,-46),(-1120,3700,74),(1240,3820,-58),
        (-1020,4550,22),(1280,4480,-32),(-920,5000,12),(220,5000,-18),
    )
    for index, (x, y, yaw) in enumerate(interior_ruins):
        added.append(spawn_kaykit(
            f"CT_V25_LairInteriorRuin_{index:02d}", "SM_KKD_WallBroken", (x, y, 20),
            0.68 if index < 6 else 0.58, yaw, True,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairCover"),
        ))

    for index, (x, y, yaw) in enumerate(((-1180,3250,18),(1320,3450,-28),(-1260,4380,35))):
        added.append(spawn_kaykit(
            f"CT_V25_LairCoverTower_{index:02d}", "SM_KKD_PillarDecorated",
            (x, y, 20), 0.72, yaw, True,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairCover"),
        ))

    for index, (x, y, yaw) in enumerate(((-540,2860,0),(520,3940,168))):
        added.append(spawn_kaykit(
            f"CT_V25_LairSmallArch_{index:02d}", "SM_KKD_Doorway",
            (x, y, 20), 0.66, yaw, True,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairCover"),
        ))

    torch_points = ((-1550,2780,90),(1550,2780,-90),(-1550,3800,90),(1550,3800,-90),(-1550,4780,90),(1550,4780,-90))
    for index, (x, y, yaw) in enumerate(torch_points):
        added.append(spawn_kaykit(
            f"CT_V25_LairTorch_{index:02d}", "SM_KKD_TorchLit", (x, y, 150), 1.12, yaw, False,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairLight"),
        ))

    banner_points = ((-1420,4900,90,"SM_KKD_BannerRed"),(1420,4900,-90,"SM_KKD_BannerBlue"),
                     (-1420,2920,90,"SM_KKD_BannerBlue"),(1420,2920,-90,"SM_KKD_BannerRed"))
    for index, (x, y, yaw, asset) in enumerate(banner_points):
        added.append(spawn_kaykit(
            f"CT_V25_LairBanner_{index:02d}", asset, (x, y, 45), 0.84, yaw, False,
            ("CubeTown.ReferenceLair", "CubeTown.ReferenceLairProp"),
        ))


def run():
    ensure_reference_materials()
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed = remove_obsolete_opening()
    added = []
    add_ground(added)
    add_paths(added)
    add_civic_center(added)
    add_architecture(added)
    add_river(added)
    add_reference_foreground(added)
    add_landscaping(added)
    add_town_life(added)
    add_phantomite_lair(added)
    terrain = next((actor for actor in (actors.get_all_level_actors() or []) if label_of(actor) == "CT_Terrain_Cube_11"), None)
    if not terrain:
        raise RuntimeError("CubeTown V25 could not find the canonical terrain surface")
    # The seamless base remains the full-world fallback. Detailed PBR neighborhood patches above it
    # supply readable grass texture inside the opening instead of one fluorescent 960 m surface.
    set_material(terrain, GROUND_NATURAL)
    if not level.save_current_level():
        raise RuntimeError("CubeTown V25 reference opening could not save the production map")
    result = {
        "schema": 26,
        "world": WORLD,
        "removed": len(removed),
        "added": len([actor for actor in added if actor]),
        "landmarks": ["fountain-square", "market", "river", "grand-bridge", "starter-home", "forge"],
        "status": "PASS",
    }
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    unreal.log("CUBETOWN V25 REFERENCE OPENING PASS " + json.dumps(result))


run()
