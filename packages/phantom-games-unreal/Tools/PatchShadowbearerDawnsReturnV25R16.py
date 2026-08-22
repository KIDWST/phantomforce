"""Native Unreal world-quality pass for Shadowbearer: Dawn's Return V25R16.

This deliberately removes the stacked CubeTown prototype surface generations and
rebuilds Bramblewick from authored Unreal assets.  The internal map/package id stays
CubeTown_World for save/install compatibility; all player-facing content is
Shadowbearer: Dawn's Return.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
PATCH_TAG = "ShadowbearerDawnsReturnV25R16"
PRODUCTION_TAG = "PhantomProductionWorldV11"
ROOT = "/Game/Phantom/Generated/Shadowbearer/V25R16"
GROUND_MESH = ROOT + "/SM_SB_DawnGround"
GROUND_MATERIAL = ROOT + "/Materials/M_SB_DawnGrass"
PATH_MATERIAL = ROOT + "/Materials/M_SB_DawnCobblePath"
PLAZA_MATERIAL = ROOT + "/Materials/M_SB_DawnCobblePlaza"
REPORT = os.path.join(
    os.path.abspath(unreal.Paths.project_saved_dir()),
    "ShadowbearerDawnsReturnV25R16WorldPatch.json",
)

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary


def log(message):
    unreal.log("SHADOWBEARER V25R16: " + str(message))


def load(path):
    try:
        return unreal.EditorAssetLibrary.load_asset(path)
    except Exception:
        return None


def require(path):
    value = load(path)
    if not value:
        raise RuntimeError("Missing native Shadowbearer asset: " + path)
    return value


def ensure_ground_mesh():
    if not unreal.EditorAssetLibrary.does_asset_exist(GROUND_MESH):
        unreal.EditorAssetLibrary.make_directory(GROUND_MESH.rsplit("/", 1)[0])
        if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", GROUND_MESH):
            raise RuntimeError("Could not create Shadowbearer ground mesh")
        unreal.EditorAssetLibrary.save_asset(GROUND_MESH, only_if_is_dirty=False)
    return require(GROUND_MESH)


def make_tiled_grass_material():
    """Build a muted, repeatable native material instead of stretching one neon texture."""
    base = require(
        "/Game/Phantom/Generated/Cubetown/V17/Materials/Textures/HeartstoneGrass/"
        "T_CT17_HeartstoneGrass_BaseColor"
    )
    normal = require(
        "/Game/Phantom/Generated/Cubetown/V17/Materials/Textures/HeartstoneGrass/"
        "T_CT17_HeartstoneGrass_Normal"
    )
    roughness = require(
        "/Game/Phantom/Generated/Cubetown/V17/Materials/Textures/HeartstoneGrass/"
        "T_CT17_HeartstoneGrass_Roughness"
    )
    folder = GROUND_MATERIAL.rsplit("/", 1)[0]
    unreal.EditorAssetLibrary.make_directory(folder)
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MATERIAL):
        unreal.EditorAssetLibrary.delete_asset(GROUND_MATERIAL)
    material = asset_tools.create_asset(
        "M_SB_DawnGrass",
        folder,
        unreal.Material,
        unreal.MaterialFactoryNew(),
    )
    if not material:
        raise RuntimeError("Could not create " + GROUND_MATERIAL)

    uv = mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -820, 20)
    uv.set_editor_property("u_tiling", 18.0)
    uv.set_editor_property("v_tiling", 18.0)

    base_sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -610, -180)
    base_sample.texture = base
    mel.connect_material_expressions(uv, "", base_sample, "UVs")

    # The source art is intentionally saturated; this grade restores the warm,
    # natural Sunpetal Vale palette and keeps HUD/objective colors distinct.
    tint = mel.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -610, -20)
    tint.constant = unreal.LinearColor(0.008, 0.021, 0.006, 1.0)
    multiply = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -330, -120)
    mel.connect_material_expressions(base_sample, "RGB", multiply, "A")
    mel.connect_material_expressions(tint, "", multiply, "B")
    mel.connect_material_property(multiply, "", unreal.MaterialProperty.MP_BASE_COLOR)

    normal_sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -610, 150)
    normal_sample.texture = normal
    try:
        normal_sample.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    except Exception:
        pass
    mel.connect_material_expressions(uv, "", normal_sample, "UVs")
    mel.connect_material_property(normal_sample, "RGB", unreal.MaterialProperty.MP_NORMAL)

    rough_sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -610, 340)
    rough_sample.texture = roughness
    try:
        rough_sample.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR
    except Exception:
        pass
    mel.connect_material_expressions(uv, "", rough_sample, "UVs")
    mel.connect_material_property(rough_sample, "R", unreal.MaterialProperty.MP_ROUGHNESS)

    specular = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -330, 390)
    specular.r = 0.12
    mel.connect_material_property(specular, "", unreal.MaterialProperty.MP_SPECULAR)
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(GROUND_MATERIAL, only_if_is_dirty=False)
    return material


def make_tiled_cobble_material(asset_path, name, u_tiling, v_tiling):
    """Create warm storybook stone with an intentional texel density per mesh."""
    texture_root = (
        "/Game/Phantom/Generated/Cubetown/V17/Materials/Textures/HeartstoneCobble/"
    )
    base = require(texture_root + "T_CT17_HeartstoneCobble_BaseColor")
    normal = require(texture_root + "T_CT17_HeartstoneCobble_Normal")
    roughness = require(texture_root + "T_CT17_HeartstoneCobble_Roughness")
    folder = asset_path.rsplit("/", 1)[0]
    unreal.EditorAssetLibrary.make_directory(folder)
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        unreal.EditorAssetLibrary.delete_asset(asset_path)
    material = asset_tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())
    if not material:
        raise RuntimeError("Could not create " + asset_path)

    uv = mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -820, 20)
    uv.set_editor_property("u_tiling", float(u_tiling))
    uv.set_editor_property("v_tiling", float(v_tiling))
    base_sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -610, -170)
    base_sample.texture = base
    mel.connect_material_expressions(uv, "", base_sample, "UVs")
    tint = mel.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -610, -20)
    tint.constant = unreal.LinearColor(0.075, 0.055, 0.038, 1.0)
    multiply = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -330, -110)
    mel.connect_material_expressions(base_sample, "RGB", multiply, "A")
    mel.connect_material_expressions(tint, "", multiply, "B")
    mel.connect_material_property(multiply, "", unreal.MaterialProperty.MP_BASE_COLOR)

    normal_sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -610, 150)
    normal_sample.texture = normal
    try:
        normal_sample.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    except Exception:
        pass
    mel.connect_material_expressions(uv, "", normal_sample, "UVs")
    mel.connect_material_property(normal_sample, "RGB", unreal.MaterialProperty.MP_NORMAL)
    rough_sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -610, 340)
    rough_sample.texture = roughness
    try:
        rough_sample.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR
    except Exception:
        pass
    mel.connect_material_expressions(uv, "", rough_sample, "UVs")
    mel.connect_material_property(rough_sample, "R", unreal.MaterialProperty.MP_ROUGHNESS)
    specular = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -330, 390)
    specular.r = 0.10
    mel.connect_material_property(specular, "", unreal.MaterialProperty.MP_SPECULAR)
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(asset_path, only_if_is_dirty=False)
    return material


def tags(actor):
    try:
        return {str(value) for value in (actor.get_editor_property("tags") or [])}
    except Exception:
        return set()


def mesh_path(actor):
    try:
        component = actor.get_editor_property("static_mesh_component")
        mesh = component.get_editor_property("static_mesh") if component else None
        return mesh.get_path_name() if mesh else ""
    except Exception:
        return ""


def actor_bottom(actor):
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def mark(actor, label, *extra_tags):
    actor.set_actor_label(label)
    actor.set_editor_property(
        "tags",
        [
            unreal.Name(PRODUCTION_TAG),
            unreal.Name(PATCH_TAG),
            unreal.Name(label),
            *[unreal.Name(value) for value in extra_tags],
        ],
    )


def spawn_mesh(label, path, location, scale, yaw=0.0, collision=False, extra_tags=(), material=None):
    mesh = require(path)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("Could not spawn " + label)
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    if material:
        for slot in range(max(1, component.get_num_materials())):
            component.set_material(slot, material)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS
        if collision
        else unreal.CollisionEnabled.NO_COLLISION
    )
    component.set_cast_shadow(True)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    actor.set_actor_rotation(unreal.Rotator(0.0, float(yaw), 0.0), False)
    current = actor.get_actor_location()
    current.z += float(location[2]) - actor_bottom(actor)
    actor.set_actor_location(current, False, False)
    mark(actor, label, *extra_tags)
    return actor


def spawn_surface(label, mesh, material, location, scale):
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("Could not spawn " + label)
    component = actor.get_editor_property("static_mesh_component")
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    mark(actor, label, "Shadowbearer.DawnSurface")
    return actor


def remove_legacy_layers():
    removed = []
    prefixes = (
        "CT17_HeartstoneGrass_",
        "CT17_HeartstonePath_",
        "CT17_HeartstoneCobble_",
        "CT_V12_Terrain_Grass_",
        "CT_V12_RoadShoulder_",
        "CT_V13_Surface_",
        "CT_V11R7_MainRoad_",
        "CT_Road_12m_",
        "CT_House_",
        "CT_V13_Roadside_",
        "CT_V13_Landmark_",
        "CT_V11R7_Verge_",
        "CT_V11R7_Bench_",
        "CT_V11R7_CrimsonTree_",
        "CT_CrimsonAccent_",
        "CT_Tree_",
        "CT_bench_",
        "CT_fence_",
        "CT_flower_",
        "CT_lantern_",
        "CT_rock_",
        "CT17_GardenArch_",
        "CT17_GardenBridge",
        "CT_Market",
        "CT_Well",
    )
    for actor in list(actors.get_all_level_actors() or []):
        label = actor.get_actor_label()
        actor_tags = tags(actor)
        if PATCH_TAG in actor_tags or label.startswith(prefixes):
            removed.append(label)
            actors.destroy_actor(actor)
    return removed


def build_bramblewick_buildings():
    """Author Bramblewick as readable districts with an unobstructed central route."""
    h1 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_1"
    h2 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_2"
    h3 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_3"
    h4 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_4"
    inn = "/Game/Phantom/External/Quaternius/MedievalVillage/Inn"
    forge = "/Game/Phantom/External/Quaternius/MedievalVillage/Blacksmith"
    specs = (
        # Dawnward: the first playable neighborhood around Zane's home.
        ("ZanesHouse", h1, (-1225, -10900, 8), 2.45, 90, "Dawnward"),
        ("DawnwardHouseA", h3, (1225, -10900, 8), 2.80, -90, "Dawnward"),
        ("DawnwardHouseB", h4, (-1225, -9950, 8), 2.95, 90, "Dawnward"),
        ("DawnwardHouseC", h2, (1225, -9950, 8), 2.25, -90, "Dawnward"),
        # Hearthward: family, food, records, and the market approach.
        ("MaraBakery", h1, (-1225, -9000, 8), 2.40, 90, "Hearthward"),
        ("SeraLanternArchive", h2, (1225, -9000, 8), 2.30, -90, "Hearthward"),
        ("HearthwardHouseA", h3, (-1225, -8150, 8), 2.85, 90, "Hearthward"),
        ("HearthwardHouseB", h4, (1225, -8150, 8), 2.95, -90, "Hearthward"),
        # Bell Square stays open; its civic anchors sit beyond the plaza corners.
        ("BrannInn", inn, (-1450, -7100, 8), 1.85, 90, "BellSquare"),
        ("VaraForge", forge, (1450, -7100, 8), 1.90, -90, "BellSquare"),
        ("BellwardHouseA", h1, (-1225, -6150, 8), 2.35, 90, "Bellward"),
        ("BellwardHouseB", h2, (1225, -6150, 8), 2.25, -90, "Bellward"),
        # Lanternward opens toward the bridge and wider world.
        ("OrinMapHouse", h2, (-1225, -5250, 8), 2.30, 90, "Lanternward"),
        ("TessExplorerHouse", h1, (1225, -5250, 8), 2.40, -90, "Lanternward"),
        ("LanternwardHouseA", h3, (-1225, -4350, 8), 2.85, 90, "Lanternward"),
        ("LanternwardHouseB", h4, (1225, -4350, 8), 2.95, -90, "Lanternward"),
        ("ValeHouseA", h1, (-1225, -3450, 8), 2.35, 90, "SunpetalVale"),
        ("ValeHouseB", h2, (1225, -3450, 8), 2.25, -90, "SunpetalVale"),
    )
    made = []
    for name, path, location, scale, yaw, district in specs:
        label = "SB_V25R16_" + name
        spawn_mesh(label, path, location, (scale, scale, scale), yaw, True,
                   ("Shadowbearer.BramblewickBuilding", "Shadowbearer.District." + district))
        made.append(label)
    return {"removed": 0, "spawned": made, "authored_districts": 5}


def build_dawn_route(ground_mesh, grass_material, path_material, plaza_material):
    added = []
    # One material generation, repeated at a sane texel scale. The old build had
    # V12, V13 and V17 planes fighting for the same pixels.
    for index, y in enumerate(range(-11400, 3001, 1800)):
        label = f"SB_V25R16_DawnMeadow_{index:02d}"
        spawn_surface(label, ground_mesh, grass_material, (0.0, float(y), 4.0), (82.0, 20.0, 1.0))
        added.append(label)

    # Properly materialed native cobbles at believable scale. The generated
    # kilometer mesh has no production UVs; using it produced a flat beige slab.
    straight = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight"
    square = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square"
    row = 0
    for y in range(-11550, 2801, 220):
        for column, x in enumerate((-235.0, -117.5, 0.0, 117.5, 235.0)):
            label = f"SB_V25R16_DawnRoad_{row:03d}_{column}"
            spawn_mesh(
                label, straight, (x, float(y), 7.0), (2.35, 2.35, 1.0),
                0.0, False,
                ("Shadowbearer.DawnRoad",), path_material,
            )
            added.append(label)
        row += 1

    # Bell square widens from the road without changing the stone language.
    for gy in range(-3, 4):
        for gx in range(-4, 5):
            label = f"SB_V25R16_BellSquare_{gx + 4}_{gy + 3}"
            spawn_mesh(
                label, square, (gx * 108.0, -7050.0 + gy * 108.0, 7.5),
                (2.25, 2.25, 1.0), 0.0, False,
                ("Shadowbearer.BellSquare",), plaza_material,
            )
            added.append(label)
    return added


def build_bramblewick_story_dressing():
    added = []
    specs = (
        ("CentralFountain", "/Game/Phantom/Curated/Cube/fountain-square-detail/StaticMeshes/fountain-square-detail", (-650, -6950, 12), (1.35, 1.35, 1.35), 0, False),
        ("DawnBellTower", "/Game/Phantom/External/Quaternius/MedievalVillage/Bell_Tower", (650, -6950, 10), (1.70, 1.70, 1.70), 0, True),
        ("DawnFestivalGazebo", "/Game/Phantom/External/Quaternius/MedievalVillage/Gazebo", (0, -5350, 10), (2.05, 2.05, 2.05), 0, True),
        ("MaraBreadCart", "/Game/Phantom/External/Quaternius/MedievalVillage/Cart", (-650, -9050, 10), (1.10, 1.10, 1.10), 90, True),
        # The old generated sign asset is a kilometre-scale production marker, not a
        # village prop.  It lifted itself 105 m into the air and spread loose-looking
        # bars across the entire opening camera.  A compact staffed kiosk now gives
        # Orin a readable map/archive station without exposing authoring debris.
        ("OrinMapKiosk", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2", (-650, -5000, 10), (1.25, 1.25, 1.25), 90, False),
        ("OldBridge", "/Game/Phantom/Curated/Cube/SM_Cube_Bridge", (0, -3100, 18), (1.30, 1.30, 1.30), 90, True),
        ("SunpetalWindmill", "/Game/Phantom/Curated/Cube/SM_Cube_Windmill", (2100, -3800, 10), (1.18, 1.18, 1.18), -24, True),
        ("VillageWell", "/Game/Phantom/External/Quaternius/MedievalVillage/Well", (-900, -6100, 10), (2.10, 2.10, 2.10), 0, True),
        ("VillageMarketWest", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_1", (-850, -6500, 10), (2.10, 2.10, 2.10), 18, True),
        ("VillageMarketEast", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2", (850, -6500, 10), (2.10, 2.10, 2.10), -18, True),
    )
    for name, path, location, scale, yaw, collision in specs:
        label = "SB_V25R16_" + name
        spawn_mesh(label, path, location, scale, yaw, collision, ("Shadowbearer.StoryLandmark",))
        added.append(label)

    # Never pad the actor count with semantically ambiguous generated patches. The prior banner
    # and flower aliases rendered as white rails/bones in Shipping. Every remaining decoration
    # is a measured, material-complete object attached to a named home or civic cluster.
    # Both legacy tree assets cook as disconnected trunks/branches. Do not disguise that failure
    # with smaller scale. The first frame instead uses verified village architecture and staffed
    # activity clusters until a production foliage pack is imported.

    # Each prop belongs to a named activity cluster and faces its associated building.
    prop_root = "/Game/Phantom/External/Quaternius/MedievalVillage/"
    prop_specs = (
        ("ZaneBench", "Bench_1", (-650, -10720), 1.75, 0, "Dawnward"),
        ("DawnwardCrate", "Crate", (650, -10720), 1.60, 20, "Dawnward"),
        ("DawnwardFenceWest", "Fence", (-720, -10150), 1.45, 0, "Dawnward"),
        ("DawnwardFenceEast", "Fence", (720, -10150), 1.45, 180, "Dawnward"),
        ("MaraFlourBags", "Bags", (-650, -9250), 1.65, 90, "Bakery"),
        ("MaraDelivery", "Package_1", (-520, -9140), 1.55, 75, "Bakery"),
        ("ArchiveBench", "Bench_2", (650, -8720), 1.70, 180, "Archive"),
        ("ArchivePackage", "Package_2", (560, -9060), 1.50, 30, "Archive"),
        ("MarketCrateWest", "Crate", (-1050, -6700), 1.65, 0, "Market"),
        ("MarketBarrelWest", "Barrel", (-1170, -6820), 1.62, 0, "Market"),
        ("MarketCrateEast", "Crate", (1050, -6650), 1.65, 0, "Market"),
        ("MarketBagsEast", "Bags", (1170, -6770), 1.58, 0, "Market"),
        ("SquareBenchWest", "Bench_1", (-780, -7480), 1.70, 90, "BellSquare"),
        ("SquareBenchEast", "Bench_1", (780, -7480), 1.70, -90, "BellSquare"),
        ("InnBarrelA", "Barrel", (-1420, -7240), 1.65, 0, "Inn"),
        ("InnBarrelB", "Barrel", (-1540, -7130), 1.60, 0, "Inn"),
        ("ForgeCrate", "Crate", (1420, -7240), 1.65, 0, "Forge"),
        ("ForgeHay", "Hay1", (1540, -7130), 1.55, 0, "Forge"),
        ("MapHousePackage", "Package_1", (-650, -5200), 1.55, 90, "MapHouse"),
        ("ExplorerCrate", "Crate", (650, -4850), 1.62, -30, "Explorer"),
        ("BridgeBenchWest", "Bench_1", (-760, -3450), 1.70, 90, "Bridge"),
        ("BridgeBenchEast", "Bench_1", (760, -3450), 1.70, -90, "Bridge"),
        ("DawnwardStallWest", "MarketStand_1", (-720, -10300), 1.35, 90, "Dawnward"),
        ("DawnwardStallEast", "MarketStand_2", (720, -10300), 1.35, -90, "Dawnward"),
        ("SunriseStallWest", "MarketStand_2", (-720, -9550), 1.30, 90, "Dawnward"),
        ("SunriseStallEast", "MarketStand_1", (720, -9550), 1.30, -90, "Dawnward"),
        ("HearthwardStallWest", "MarketStand_1", (-720, -8350), 1.35, 90, "Hearthward"),
        ("HearthwardStallEast", "MarketStand_2", (720, -8350), 1.35, -90, "Hearthward"),
        ("BellApproachStallWest", "MarketStand_2", (-720, -7600), 1.28, 90, "BellSquare"),
        ("BellApproachStallEast", "MarketStand_1", (720, -7600), 1.28, -90, "BellSquare"),
        ("LanternwardStallWest", "MarketStand_1", (-720, -4550), 1.32, 90, "Lanternward"),
        ("LanternwardStallEast", "MarketStand_2", (720, -4550), 1.32, -90, "Lanternward"),
        ("HearthCartWest", "Cart", (-850, -8050), 1.25, 15, "Hearthward"),
        ("HearthCartEast", "Cart", (850, -8050), 1.25, 165, "Hearthward"),
    )
    for name, asset, (x, y), scale, yaw, cluster in prop_specs:
        label = "SB_V25R16_" + name
        spawn_mesh(label, prop_root + asset, (x, y, 9), (scale, scale, scale), yaw, False,
                   ("Shadowbearer.VillageLife", "Shadowbearer.Cluster." + cluster))
        added.append(label)
    return added


def patch():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed_layers = remove_legacy_layers()
    ground_mesh = ensure_ground_mesh()
    grass_material = make_tiled_grass_material()
    path_material = make_tiled_cobble_material(PATH_MATERIAL, "M_SB_DawnCobblePath", 1.0, 2.0)
    plaza_material = make_tiled_cobble_material(PLAZA_MATERIAL, "M_SB_DawnCobblePlaza", 1.0, 1.0)

    # Repair all nine native terrain chunks so the 960 m world no longer falls
    # back to the debug-green prototype outside the opening camera.
    terrain_repaired = []
    for actor in actors.get_all_level_actors() or []:
        if not actor.get_actor_label().startswith("CT_Terrain_Cube_"):
            continue
        component = actor.get_editor_property("static_mesh_component")
        if not component:
            continue
        for slot in range(max(1, component.get_num_materials())):
            component.set_material(slot, grass_material)
        terrain_repaired.append(actor.get_actor_label())

    houses = build_bramblewick_buildings()
    route = build_dawn_route(ground_mesh, grass_material, path_material, plaza_material)
    dressing = build_bramblewick_story_dressing()
    if len(houses["spawned"]) != 18 or houses["authored_districts"] != 5:
        raise RuntimeError("Shadowbearer district composition gate failed")
    if len(route) < 350 or len(dressing) < 35:
        raise RuntimeError("Shadowbearer authored-density gate failed")
    if len(terrain_repaired) != 9:
        raise RuntimeError(f"Expected nine native terrain chunks, repaired {len(terrain_repaired)}")

    # Fail the patch if any non-surface actor can dominate the opening or float far
    # above it.  This rejects mismatched production assets by measured world bounds,
    # rather than trusting a plausible-looking asset name.
    oversized = []
    floating = []
    for actor in actors.get_all_level_actors() or []:
        actor_tags = tags(actor)
        if PATCH_TAG not in actor_tags or "Shadowbearer.DawnSurface" in actor_tags:
            continue
        origin, extent = actor.get_actor_bounds(False)
        maximum_dimension = max(float(extent.x), float(extent.y), float(extent.z)) * 2.0
        if maximum_dimension > 1200.0:
            oversized.append((actor.get_actor_label(), round(maximum_dimension, 2)))
        if float(actor.get_actor_location().z) > 1200.0:
            floating.append((actor.get_actor_label(), round(float(actor.get_actor_location().z), 2)))
    if oversized or floating:
        raise RuntimeError(
            "Shadowbearer visual-composition gate failed: "
            + json.dumps({"oversized": oversized, "floating": floating})
        )
    if not level.save_current_level():
        raise RuntimeError("Could not save " + WORLD)
    return {
        "world": WORLD,
        "removed_legacy_layers": len(removed_layers),
        "terrain_chunks_repaired": terrain_repaired,
        "houses": houses,
        "route_actors": len(route),
        "story_dressing_actors": len(dressing),
        "oversized_opening_actors": len(oversized),
        "floating_opening_actors": len(floating),
        "native_only": True,
    }


result = {"revision": "V25R16", "status": "RUNNING"}
try:
    result["shadowbearer"] = patch()
    result["status"] = "PASS"
    log("WORLD QUALITY PATCH PASS")
except Exception as exc:
    result["status"] = "FAIL"
    result["error"] = str(exc)
    result["traceback"] = traceback.format_exc()
    unreal.log_error("SHADOWBEARER V25R16 WORLD PATCH FAILED: " + str(exc))
    raise
finally:
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
