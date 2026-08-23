"""Native Unreal world-quality pass for Shadowbearer: Dawn's Return V25R21.

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
PATCH_TAG = "ShadowbearerDawnsReturnV25R21"
PRODUCTION_TAG = "PhantomProductionWorldV11"
ROOT = "/Game/Phantom/Generated/Shadowbearer/V25R21"
GROUND_MESH = ROOT + "/SM_SB_DawnGround"
GROUND_MATERIAL = ROOT + "/Materials/M_SB_DawnGrass"
PATH_MATERIAL = ROOT + "/Materials/M_SB_DawnCobblePath"
PLAZA_MATERIAL = ROOT + "/Materials/M_SB_DawnCobblePlaza"
REPORT = os.path.join(
    os.path.abspath(unreal.Paths.project_saved_dir()),
    "ShadowbearerDawnsReturnV25R21WorldPatch.json",
)

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
STORYBOOK_PALETTE = {}


def log(message):
    unreal.log("SHADOWBEARER V25R21: " + str(message))


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


def make_storybook_material(name, color, emissive=0.0):
    """Create a restrained, readable low-poly material that survives Shipping lighting."""
    folder = ROOT + "/Materials/Palette"
    path = folder + "/M_SB_" + name
    unreal.EditorAssetLibrary.make_directory(folder)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    material = asset_tools.create_asset("M_SB_" + name, folder, unreal.Material, unreal.MaterialFactoryNew())
    if not material:
        raise RuntimeError("Could not create " + path)
    base = mel.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -260, -70)
    base.constant = unreal.LinearColor(float(color[0]), float(color[1]), float(color[2]), 1.0)
    mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    roughness = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -260, 90)
    roughness.r = 0.76
    mel.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)
    if emissive > 0.0:
        strength = mel.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -260, 230)
        strength.constant = unreal.LinearColor(
            float(color[0]) * emissive,
            float(color[1]) * emissive,
            float(color[2]) * emissive,
            1.0,
        )
        mel.connect_material_property(strength, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    return material


def make_storybook_palette():
    # Linear-space colors are deliberately below prototype-white albedo.  The prior
    # Quaternius defaults clipped under the Dawn sky and flattened the village.
    return {
        "plaster": make_storybook_material("WarmPlaster", (0.24, 0.135, 0.055)),
        "beige": make_storybook_material("HoneyPlaster", (0.30, 0.17, 0.065)),
        "wood": make_storybook_material("DarkOak", (0.055, 0.018, 0.006)),
        "wood_light": make_storybook_material("GoldenOak", (0.18, 0.055, 0.012)),
        "wood_side": make_storybook_material("WarmTimber", (0.105, 0.030, 0.008)),
        "woodside": make_storybook_material("WarmTimberAlt", (0.105, 0.030, 0.008)),
        "darkwood": make_storybook_material("DarkWood", (0.028, 0.010, 0.004)),
        "stone_dark": make_storybook_material("SlateDark", (0.030, 0.043, 0.070)),
        "stone": make_storybook_material("Slate", (0.075, 0.095, 0.125)),
        "stone_light": make_storybook_material("SlateLight", (0.19, 0.23, 0.26)),
        "rooftiles": make_storybook_material("TealRoof", (0.018, 0.105, 0.17)),
        "rooftiles_red": make_storybook_material("TerracottaRoof", (0.24, 0.036, 0.010)),
        "windows": make_storybook_material("LanternWindows", (0.035, 0.28, 0.44), 1.7),
        "green": make_storybook_material("LeafGreen", (0.018, 0.18, 0.045)),
        "leavesfall": make_storybook_material("LeafCanopy", (0.025, 0.22, 0.052)),
        "woodbirch": make_storybook_material("TreeBark", (0.095, 0.035, 0.010)),
        "orange": make_storybook_material("FestivalOrange", (0.35, 0.07, 0.010)),
        "leather": make_storybook_material("Leather", (0.10, 0.026, 0.006)),
        "metal": make_storybook_material("Metal", (0.11, 0.14, 0.17)),
        "darkmetal": make_storybook_material("DarkMetal", (0.025, 0.035, 0.050)),
        "fire": make_storybook_material("Fire", (0.65, 0.11, 0.008), 2.6),
    }


def apply_storybook_palette(component):
    if not STORYBOOK_PALETTE:
        return
    for slot in range(component.get_num_materials()):
        original = component.get_material(slot)
        if not original:
            continue
        key = original.get_name().lower()
        replacement = STORYBOOK_PALETTE.get(key)
        if replacement:
            component.set_material(slot, replacement)


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
    else:
        apply_storybook_palette(component)
    component.set_collision_enabled(
        unreal.CollisionEnabled.QUERY_AND_PHYSICS
        if collision
        else unreal.CollisionEnabled.NO_COLLISION
    )
    component.set_cast_shadow(True)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    # Unreal's Python Rotator positional order is roll, pitch, yaw. The earlier pass
    # accidentally pitched every object by its intended heading, laying homes and
    # trunks on their sides. Keywords make the world-space contract unambiguous.
    actor.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)), False)
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
        if (
            PATCH_TAG in actor_tags
            or any(str(tag).startswith("ShadowbearerDawnsReturnV") for tag in actor_tags)
            or label.startswith("SB_V")
            or label.startswith(prefixes)
        ):
            removed.append(label)
            actors.destroy_actor(actor)
    return removed


def build_bramblewick_buildings():
    """Author an irregular, human-scaled village instead of a repeated house canyon."""
    h1 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_1"
    h2 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_2"
    h3 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_3"
    h4 = "/Game/Phantom/External/Quaternius/MedievalVillage/House_4"
    inn = "/Game/Phantom/External/Quaternius/MedievalVillage/Inn"
    forge = "/Game/Phantom/External/Quaternius/MedievalVillage/Blacksmith"
    specs = (
        ("ZanesHouse", h1, (-940, -10920, 8), 1.34, 74, "Dawnward"),
        ("DawnwardHouseA", h3, (980, -10660, 8), 1.42, -70, "Dawnward"),
        ("DawnwardHouseB", h4, (-1110, -9820, 8), 1.48, 101, "Dawnward"),
        ("DawnwardHouseC", h2, (1130, -9500, 8), 1.30, -103, "Dawnward"),
        ("MaraBakery", h1, (-990, -8780, 8), 1.36, 80, "Hearthward"),
        ("SeraLanternArchive", h2, (1050, -8460, 8), 1.30, -86, "Hearthward"),
        ("HearthwardHouseA", h3, (-1160, -7900, 8), 1.42, 103, "Hearthward"),
        ("HearthwardHouseB", h4, (1190, -7700, 8), 1.48, -98, "Hearthward"),
        ("BrannInn", inn, (-1180, -6900, 8), 1.16, 82, "BellSquare"),
        ("VaraForge", forge, (1200, -6760, 8), 1.18, -84, "BellSquare"),
        ("OrinMapHouse", h2, (-1010, -5630, 8), 1.30, 72, "Lanternward"),
        ("TessExplorerHouse", h1, (1040, -5430, 8), 1.34, -78, "Lanternward"),
        ("ValeHouseA", h3, (-1120, -4380, 8), 1.40, 105, "SunpetalVale"),
        ("ValeHouseB", h4, (1150, -4140, 8), 1.46, -104, "SunpetalVale"),
    )
    made = []
    for name, path, location, scale, yaw, district in specs:
        label = "SB_V25R21_" + name
        spawn_mesh(label, path, location, (scale, scale, scale), yaw, True,
                   ("Shadowbearer.BramblewickBuilding", "Shadowbearer.District." + district))
        made.append(label)
    return {"removed": 0, "spawned": made, "authored_districts": 5}


def build_dawn_route(ground_mesh, grass_material, path_material, plaza_material):
    added = []
    # One material generation, repeated at a sane texel scale. The old build had
    # V12, V13 and V17 planes fighting for the same pixels.
    for index, y in enumerate(range(-11400, 3001, 1800)):
        label = f"SB_V25R21_DawnMeadow_{index:02d}"
        spawn_surface(label, ground_mesh, grass_material, (0.0, float(y), 4.0), (82.0, 20.0, 1.0))
        added.append(label)

    # Properly materialed native cobbles at believable scale. The generated
    # kilometer mesh has no production UVs; using it produced a flat beige slab.
    straight = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Straight"
    square = "/Game/Phantom/External/Quaternius/MedievalVillage/Path_Square"
    row = 0
    for y in range(-11550, 2801, 220):
        for column, x in enumerate((-112.0, 0.0, 112.0)):
            label = f"SB_V25R21_DawnRoad_{row:03d}_{column}"
            spawn_mesh(
                label, straight, (x, float(y), 7.0), (2.20, 2.20, 1.0),
                0.0, False,
                ("Shadowbearer.DawnRoad",), path_material,
            )
            added.append(label)
        row += 1

    # Bell square widens from the road without changing the stone language.
    for gy in range(-2, 3):
        for gx in range(-3, 4):
            label = f"SB_V25R21_BellSquare_{gx + 3}_{gy + 2}"
            spawn_mesh(
                label, square, (gx * 108.0, -7040.0 + gy * 108.0, 7.5),
                (2.20, 2.20, 1.0), 0.0, False,
                ("Shadowbearer.BellSquare",), plaza_material,
            )
            added.append(label)

    # Short cross streets make each home visibly belong to the village instead of
    # floating beside a ceremonial runway.
    for lane_index, y in enumerate((-10100.0, -8650.0, -5650.0)):
        for column, x in enumerate(range(-1320, 1321, 220)):
            label = f"SB_V25R21_CrossLane_{lane_index}_{column:02d}"
            spawn_mesh(label, straight, (float(x), y, 7.0), (2.20, 2.20, 1.0),
                       90.0, False, ("Shadowbearer.CrossStreet",), path_material)
            added.append(label)
    return added


def build_bramblewick_story_dressing():
    added = []
    specs = (
        ("CentralFountain", "/Game/Phantom/Curated/Cube/fountain-square-detail/StaticMeshes/fountain-square-detail", (-470, -7040, 12), (0.92, 0.92, 0.92), 0, False),
        ("DawnBellTower", "/Game/Phantom/External/Quaternius/MedievalVillage/Bell_Tower", (520, -7040, 10), (1.12, 1.12, 1.12), 0, True),
        ("DawnFestivalGazebo", "/Game/Phantom/External/Quaternius/MedievalVillage/Gazebo", (0, -5900, 10), (1.35, 1.35, 1.35), 0, True),
        ("MaraBreadCart", "/Game/Phantom/External/Quaternius/MedievalVillage/Cart", (-1050, -8870, 10), (0.86, 0.86, 0.86), 72, True),
        # The old generated sign asset is a kilometre-scale production marker, not a
        # village prop.  It lifted itself 105 m into the air and spread loose-looking
        # bars across the entire opening camera.  A compact staffed kiosk now gives
        # Orin a readable map/archive station without exposing authoring debris.
        ("OrinMapKiosk", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2", (-1080, -5760, 10), (1.02, 1.02, 1.02), 72, False),
        ("OldBridge", "/Game/Phantom/Curated/Cube/SM_Cube_Bridge", (0, -3100, 18), (1.30, 1.30, 1.30), 90, True),
        ("SunpetalWindmill", "/Game/Phantom/Curated/Cube/SM_Cube_Windmill", (2550, -3850, 10), (0.82, 0.82, 0.82), -24, True),
        ("VillageWell", "/Game/Phantom/External/Quaternius/MedievalVillage/Well", (-950, -6260, 10), (1.32, 1.32, 1.32), 0, True),
        ("VillageMarketWest", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_1", (-1000, -7540, 10), (1.22, 1.22, 1.22), 18, True),
        ("VillageMarketEast", "/Game/Phantom/External/Quaternius/MedievalVillage/MarketStand_2", (1010, -7480, 10), (1.22, 1.22, 1.22), -18, True),
    )
    for name, path, location, scale, yaw, collision in specs:
        label = "SB_V25R21_" + name
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
        ("ZaneBench", "Bench_1", (-610, -10820), 1.20, 14, "Dawnward"),
        ("DawnwardCrate", "Crate", (650, -10520), 1.10, 20, "Dawnward"),
        ("MaraFlourBags", "Bags", (-670, -8810), 1.12, 90, "Bakery"),
        ("MaraDelivery", "Package_1", (-590, -8700), 1.05, 75, "Bakery"),
        ("ArchiveBench", "Bench_2", (690, -8350), 1.14, 180, "Archive"),
        ("MarketCrateWest", "Crate", (-690, -7450), 1.10, 0, "Market"),
        ("MarketBarrelWest", "Barrel", (-760, -7570), 1.08, 0, "Market"),
        ("MarketCrateEast", "Crate", (690, -7390), 1.10, 0, "Market"),
        ("MarketBagsEast", "Bags", (760, -7510), 1.06, 0, "Market"),
        ("SquareBenchWest", "Bench_1", (-820, -6810), 1.18, 90, "BellSquare"),
        ("SquareBenchEast", "Bench_1", (820, -6810), 1.18, -90, "BellSquare"),
        ("InnBarrelA", "Barrel", (-820, -7000), 1.10, 0, "Inn"),
        ("ForgeCrate", "Crate", (830, -6860), 1.10, 0, "Forge"),
        ("ForgeHay", "Hay1", (860, -6740), 1.06, 0, "Forge"),
        ("MapHousePackage", "Package_1", (-690, -5700), 1.06, 90, "MapHouse"),
        ("ExplorerCrate", "Crate", (710, -5400), 1.10, -30, "Explorer"),
        ("BridgeBenchWest", "Bench_1", (-760, -3500), 1.15, 90, "Bridge"),
        ("BridgeBenchEast", "Bench_1", (760, -3500), 1.15, -90, "Bridge"),
    )
    for name, asset, (x, y), scale, yaw, cluster in prop_specs:
        label = "SB_V25R21_" + name
        spawn_mesh(label, prop_root + asset, (x, y, 9), (scale, scale, scale), yaw, False,
                   ("Shadowbearer.VillageLife", "Shadowbearer.Cluster." + cluster))
        added.append(label)
    return added


def build_bramblewick_nature():
    """Build a dense green frame around readable paths, homes, and civic spaces."""
    added = []
    trunk = "/Engine/BasicShapes/Cylinder"
    bush = "/Game/Phantom/Generated/Common/SM_Bush_A"
    lantern = "/Game/Phantom/Generated/Common/SM_LanternPost_A"

    tree_positions = (
        (-1460,-11120),(1450,-10820),(-1500,-9980),(1510,-9440),
        (-1480,-8840),(1490,-8360),(-1530,-7740),(1540,-7240),
        (-1490,-6660),(1500,-6140),(-1460,-5580),(1470,-5060),
        (-1420,-4540),(1430,-4060),(-720,-9230),(740,-4860),
    )
    for index, (x, y) in enumerate(tree_positions):
        trunk_label = f"SB_V25R21_TreeTrunk_{index:02d}"
        spawn_mesh(trunk_label, trunk, (x, y, 8),
                   (0.24, 0.24, 3.05 + (index % 3) * 0.18), (index * 47) % 360, False,
                   ("Shadowbearer.Nature", "Shadowbearer.Cluster.Tree"), STORYBOOK_PALETTE["wood"])
        added.append(trunk_label)
        canopy_specs = ((0,0,284,1.42),(-72,8,242,1.12),(68,-10,250,1.16),(4,68,256,1.08))
        for crown_index, (ox, oy, z, crown_scale) in enumerate(canopy_specs):
            label = f"SB_V25R21_TreeCrown_{index:02d}_{crown_index}"
            spawn_mesh(label, bush, (x + ox, y + oy, z),
                       (crown_scale, crown_scale, crown_scale), (index * 43 + crown_index * 71) % 360, False,
                       ("Shadowbearer.Nature", "Shadowbearer.Cluster.Tree"), STORYBOOK_PALETTE["green"])
            added.append(label)

    yard_centers = (
        (-610,-10610),(620,-10420),(-720,-9680),(730,-9440),
        (-620,-8620),(650,-8380),(-760,-7840),(770,-7620),
        (-720,-7020),(730,-6880),(-660,-5640),(680,-5430),
        (-740,-4380),(750,-4170),(-520,-6250),(530,-6110),
        (-520,-10100),(530,-9890),(-540,-8200),(550,-8010),
        (-560,-5100),(570,-4920),
    )
    for index, (x, y) in enumerate(yard_centers):
        for side in (-1, 1):
            label = f"SB_V25R21_YardBush_{index:02d}_{side:+d}"
            scale = 0.74 + (index % 3) * 0.08
            spawn_mesh(label, bush, (x + side * 120, y + (index % 3) * 50, 8),
                       (scale, scale, scale), (index * 31 + side * 17) % 360, False,
                       ("Shadowbearer.Nature", "Shadowbearer.Cluster.Yard"), STORYBOOK_PALETTE["green"])
            added.append(label)

    for index, y in enumerate((-10850,-9950,-9000,-8100,-7350,-6350,-5400,-4400)):
        for side in (-1, 1):
            label = f"SB_V25R21_Lantern_{index:02d}_{side:+d}"
            spawn_mesh(label, lantern, (side * 470, y, 8), (0.72, 0.72, 0.72),
                       0, False, ("Shadowbearer.VillageLight",))
            added.append(label)
    return added


def patch():
    global STORYBOOK_PALETTE
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed_layers = remove_legacy_layers()
    ground_mesh = ensure_ground_mesh()
    grass_material = make_tiled_grass_material()
    path_material = make_tiled_cobble_material(PATH_MATERIAL, "M_SB_DawnCobblePath", 1.0, 2.0)
    plaza_material = make_tiled_cobble_material(PLAZA_MATERIAL, "M_SB_DawnCobblePlaza", 1.0, 1.0)
    STORYBOOK_PALETTE = make_storybook_palette()

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
    nature = build_bramblewick_nature()
    if len(houses["spawned"]) != 14 or houses["authored_districts"] != 5:
        raise RuntimeError("Shadowbearer district composition gate failed")
    if len(route) < 250 or len(dressing) < 18 or len(nature) < 90:
        raise RuntimeError("Shadowbearer authored-density gate failed")
    if len(terrain_repaired) != 9:
        raise RuntimeError(f"Expected nine native terrain chunks, repaired {len(terrain_repaired)}")

    # Fail the patch if any non-surface actor can dominate the opening or float far
    # above it.  This rejects mismatched production assets by measured world bounds,
    # rather than trusting a plausible-looking asset name.
    oversized = []
    floating = []
    tipped = []
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
        rotation = actor.get_actor_rotation()
        if abs(float(rotation.pitch)) > 0.1 or abs(float(rotation.roll)) > 0.1:
            tipped.append((actor.get_actor_label(), round(float(rotation.pitch), 2), round(float(rotation.roll), 2)))
    if oversized or floating or tipped:
        raise RuntimeError(
            "Shadowbearer visual-composition gate failed: "
            + json.dumps({"oversized": oversized, "floating": floating, "tipped": tipped})
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
        "authored_nature_actors": len(nature),
        "oversized_opening_actors": len(oversized),
        "floating_opening_actors": len(floating),
        "tipped_opening_actors": len(tipped),
        "native_only": True,
    }


result = {"revision": "V25R21", "status": "RUNNING"}
try:
    result["shadowbearer"] = patch()
    result["status"] = "PASS"
    log("WORLD QUALITY PATCH PASS")
except Exception as exc:
    result["status"] = "FAIL"
    result["error"] = str(exc)
    result["traceback"] = traceback.format_exc()
    unreal.log_error("SHADOWBEARER V25R21 WORLD PATCH FAILED: " + str(exc))
    raise
finally:
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
