"""Author the dense 960m x 960m CubeTown V24 production overworld.

The playable boundary already matches the intended approximately-one-square-kilometre
first region.  This pass fills that boundary with connected roads, regional ground,
macro landmarks, micro-POIs, and guaranteed per-cell dressing instead of expanding
an empty rectangle.
"""
from __future__ import annotations

import json
import math
import os

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
TAG = "PhantomProductionWorldV24"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV24EchoWorld.json")
PLANE = "/Game/Phantom/Generated/Cubetown/V17/SM_V17_DioramaGroundPatch"
MATERIAL_ROOT = "/Game/Phantom/Generated/Cubetown/V17/Materials"
V24_MATERIAL_ROOT = "/Game/Phantom/Generated/Cubetown/V24/Materials"
CRYSTAL_MATERIAL = "MagicCyan"
Q = "/Game/Phantom/External/Quaternius/MedievalVillage"

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


TREE_ASSETS = (
    "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A",
    "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A",
    "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A",
)
ROCK_ASSETS = (
    f"{Q}/Rock_1",
    f"{Q}/Rock_2",
    f"{Q}/Rock_3",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember",
)
DETAIL_ASSETS = (
    "/Game/Phantom/Generated/Common/SM_Bush_A",
    "/Game/Phantom/Generated/Common/SM_FlowerPatch_A",
    "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamHerbPatch_A",
    f"{Q}/Crate",
    f"{Q}/Barrel",
)
HOUSE_ASSETS = (
    f"{Q}/House_1",
    f"{Q}/House_2",
    f"{Q}/House_3",
    f"{Q}/House_4",
    f"{Q}/Inn",
    f"{Q}/Blacksmith",
    f"{Q}/Stable",
    f"{Q}/Sawmill",
)


def load(path, required=True):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if required and not asset:
        raise RuntimeError("Required CubeTown V24 asset is missing: " + path)
    return asset


def component_of(actor):
    try:
        return actor.get_editor_property("static_mesh_component")
    except Exception:
        found = actor.get_components_by_class(unreal.StaticMeshComponent)
        return found[0] if found else None


def tags_of(actor):
    try:
        return [str(value) for value in (actor.get_editor_property("tags") or [])]
    except Exception:
        return []


def mark(actor, label, region, extra=()):
    values = tags_of(actor)
    for value in (TAG, label, f"CubeTownV24.Region.{region}", *extra):
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


def apply_material(actor, role):
    if not actor or not role:
        return actor
    material = load(f"{MATERIAL_ROOT}/M_CT17_{role}")
    component = component_of(actor)
    mesh = component.get_editor_property("static_mesh") if component else None
    if not component:
        raise RuntimeError("Missing component for V24 material assignment")
    try:
        slot_count = max(1, int(component.get_num_materials()), len(mesh.get_editor_property("static_materials")) if mesh else 0)
    except Exception:
        slot_count = 1
    for slot in range(slot_count):
        component.set_material(slot, material)
    return actor


def ensure_world_surface_material(role, brightness=0.58, world_uv_scale=0.0018, use_normal=False):
    """Build a world-space PBR surface so the 960 m terrain never stretches one texture over the map."""
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    unreal.EditorAssetLibrary.make_directory(V24_MATERIAL_ROOT)
    path = f"{V24_MATERIAL_ROOT}/M_CT24_{role}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    material = asset_tools.create_asset(
        f"M_CT24_{role}", V24_MATERIAL_ROOT, unreal.Material, unreal.MaterialFactoryNew()
    )
    if not material:
        raise RuntimeError("Could not create V24 world material " + path)

    texture_root = f"{MATERIAL_ROOT}/Textures/{role}/T_CT17_{role}"
    textures = {
        "BaseColor": load(texture_root + "_BaseColor"),
        "Roughness": load(texture_root + "_Roughness"),
    }
    if use_normal:
        textures["Normal"] = load(texture_root + "_Normal")

    world_position = mel.create_material_expression(material, unreal.MaterialExpressionWorldPosition, -1050, 80)
    xy = mel.create_material_expression(material, unreal.MaterialExpressionComponentMask, -870, 80)
    xy.set_editor_property("r", True)
    xy.set_editor_property("g", True)
    uv_scale = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -870, 210)
    uv_scale.set_editor_property("r", float(world_uv_scale))
    world_uv = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -690, 80)
    mel.connect_material_expressions(world_position, "", xy, "")
    mel.connect_material_expressions(xy, "", world_uv, "A")
    mel.connect_material_expressions(uv_scale, "", world_uv, "B")

    def sample(kind, x, y):
        node = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, x, y)
        node.set_editor_property("texture", textures[kind])
        if kind == "Normal":
            node.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        elif kind == "Roughness":
            node.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        mel.connect_material_expressions(world_uv, "", node, "UVs")
        return node

    base = sample("BaseColor", -500, -100)
    tone = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -500, 20)
    tone.set_editor_property("r", float(brightness))
    toned_base = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -290, -80)
    mel.connect_material_expressions(base, "RGB", toned_base, "A")
    mel.connect_material_expressions(tone, "", toned_base, "B")
    mel.connect_material_property(toned_base, "", unreal.MaterialProperty.MP_BASE_COLOR)

    roughness = sample("Roughness", -500, 300)
    if use_normal:
        normal = sample("Normal", -500, 120)
        mel.connect_material_property(normal, "RGB", unreal.MaterialProperty.MP_NORMAL)
    mel.connect_material_property(roughness, "R", unreal.MaterialProperty.MP_ROUGHNESS)
    specular = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -290, 390)
    specular.set_editor_property("r", 0.16)
    mel.connect_material_property(specular, "", unreal.MaterialProperty.MP_SPECULAR)
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    return path


def apply_world_material(actor, role):
    material = load(f"{V24_MATERIAL_ROOT}/M_CT24_{role}")
    component = component_of(actor)
    if not component or not material:
        raise RuntimeError(f"Missing V24 world material or component for {role}")
    for slot in range(max(1, int(component.get_num_materials()))):
        component.set_material(slot, material)
    return actor


def spawn_height(label, mesh_path, location, height, yaw=0.0, collision=False, region="Crownlands", extra=(), material=None):
    mesh = load(mesh_path)
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"CubeTown V24 expected a StaticMesh for {label}, got {mesh.get_class().get_name() if mesh else 'None'} from {mesh_path}")
    actor = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(float(location[0]), float(location[1]), float(location[2])), transient=False)
    if not actor:
        raise RuntimeError("Could not spawn " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION)
    raw_height = max(1.0, float(mesh.get_bounds().box_extent.z) * 2.0)
    scale = max(0.02, min(50.0, float(height) / raw_height))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    actor.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)), False)
    align_to_ground(actor, location[2])
    mark(actor, label, region, extra)
    apply_material(actor, material)
    return actor


def spawn_sized(label, mesh_path, location, dimension, yaw=0.0, collision=False, region="Crownlands", extra=(), material=None):
    mesh = load(mesh_path)
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"CubeTown V24 expected a StaticMesh for {label}, got {mesh.get_class().get_name() if mesh else 'None'} from {mesh_path}")
    actor = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(float(location[0]), float(location[1]), float(location[2])), transient=False)
    if not actor:
        raise RuntimeError("Could not spawn " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION)
    size = mesh.get_bounds().box_extent * 2.0
    raw = max(1.0, float(max(size.x, size.y, size.z)))
    scale = max(0.02, min(250.0, float(dimension) / raw))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    actor.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)), False)
    align_to_ground(actor, location[2])
    mark(actor, label, region, extra)
    apply_material(actor, material)
    return actor


def spawn_rect(label, location, length, width, yaw, region, material_role, extra=()):
    """Place a deliberate non-grid district/road surface using exact world dimensions."""
    mesh = load(PLANE)
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
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_editor_property("cast_shadow", False)
    size = mesh.get_bounds().box_extent * 2.0
    actor.set_actor_scale3d(unreal.Vector(
        float(length) / max(1.0, float(size.x)),
        float(width) / max(1.0, float(size.y)),
        0.002,
    ))
    actor.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)), False)
    align_to_ground(actor, location[2])
    mark(actor, label, region, ("CubeTownV24.DistrictSurface", *extra))
    apply_world_material(actor, material_role)
    return actor


def remove_previous():
    removed = 0
    for actor in list(actors.get_all_level_actors() or []):
        if TAG in tags_of(actor) or actor.get_actor_label().startswith("CT_V24_"):
            actors.destroy_actor(actor)
            removed += 1
    return removed


def region_for(x, y):
    regions = (
        (-30000, -31000, "MoonmossMarsh"),
        (30000, -31000, "SunpetalCoast"),
        (-33000, 9000, "DeepForest"),
        (33000, 9000, "StarfallQuarry"),
        (-25000, 33000, "FrostbloomHeights"),
        (0, 35000, "CrimsonGrove"),
        (32000, 34000, "EmberbloomPhantomite"),
        (0, -6500, "Heartstone"),
    )
    return min(regions, key=lambda item: (x-item[0])**2 + (y-item[1])**2)[2]


def ground_role(region):
    return {
        "MoonmossMarsh": "MoonmossMud",
        "SunpetalCoast": "SunpetalSand",
        "DeepForest": "StarfallGrass",
        "StarfallQuarry": "RuinsStone",
        "FrostbloomHeights": "FrostSnow",
        "CrimsonGrove": "CrimsonMoss",
        "EmberbloomPhantomite": "EmberSoil",
        "Heartstone": "HeartstoneGrass",
    }[region]


def add_ground(added):
    for gx in range(-2, 3):
        for gy in range(-2, 3):
            x, y = gx * 20000, gy * 20000
            region = region_for(x, y)
            added.append(spawn_sized(
                f"CT_V24_Terrain_{gx+2}_{gy+2}", PLANE, (x, y, 7), 19850, 0, False,
                region, ("CubeTownV24.Surface", "CubeTownV24.Terrain"), ground_role(region),
            ))


def add_road_polyline(added, name, points):
    road_index = 0
    for start, end in zip(points, points[1:]):
        dx, dy = end[0]-start[0], end[1]-start[1]
        length = math.hypot(dx, dy)
        steps = max(1, int(math.ceil(length / 850.0)))
        yaw = math.degrees(math.atan2(dy, dx)) - 90.0
        for step in range(steps):
            alpha = (step + 0.5) / steps
            x, y = start[0] + dx * alpha, start[1] + dy * alpha
            region = region_for(x, y)
            added.append(spawn_height(
                f"CT_V24_Road_{name}_{road_index:03d}", f"{Q}/Path_Straight", (x, y, 13),
                40, yaw, False, region, ("CubeTownV24.Road",),
            ))
            road_index += 1


def add_roads(added):
    networks = (
        ("CrownSpine", ((0,-46500),(0,-10500),(0,-3000),(0,15000),(0,46500))),
        ("RiverRoad", ((-45500,-6500),(-25000,-5000),(0,-3500),(25000,-5000),(45500,-6500))),
        ("Moonmoss", ((0,-25500),(-15000,-28000),(-30500,-31500),(-43000,-34500))),
        ("Sunpetal", ((0,-25000),(16000,-27500),(30500,-31000),(44000,-30000))),
        ("DeepForest", ((0,-5000),(-14500,1500),(-28500,9000),(-43000,18500))),
        ("Quarry", ((0,-1500),(15500,3500),(30000,9500),(44000,14500))),
        ("Frostbloom", ((0,12500),(-10500,23500),(-24000,34000),(-40000,40500))),
        ("Phantomite", ((0,15000),(14500,23500),(30000,34000),(44000,40500))),
    )
    for name, points in networks:
        add_road_polyline(added, name, points)


def add_river(added):
    stream = "/Game/Phantom/Generated/Cubetown/V10/Setpieces/SM_V10_Stream_120m"
    bridge = "/Game/Phantom/Curated/Cube/SM_Cube_Bridge"
    for index, x in enumerate((-40000, -20000, 0, 20000, 40000)):
        region = region_for(x, -2300)
        added.append(spawn_sized(f"CT_V24_River_{index:02d}", stream, (x,-2300,8), 20100, 0, False, region, ("CubeTownV24.River",)))
    for index, x in enumerate((-30000, 0, 30000)):
        region = region_for(x, -2300)
        added.append(spawn_sized(f"CT_V24_Bridge_{index:02d}", bridge, (x,-2300,17), 1500, 90, True, region, ("CubeTownV24.Landmark",)))


def add_settlement(added, prefix, center, region, count=8, landmark="Well"):
    cx, cy = center
    for index in range(count):
        angle = index * (2.0 * math.pi / count) + (len(prefix) % 5) * 0.13
        radius = 1650 + (index % 3) * 520
        x, y = cx + math.cos(angle)*radius, cy + math.sin(angle)*radius
        asset = HOUSE_ASSETS[index % len(HOUSE_ASSETS)]
        added.append(spawn_height(
            f"CT_V24_{prefix}_Building_{index:02d}", asset, (x,y,18), 470+(index%4)*55,
            math.degrees(angle)+90, True, region, ("CubeTownV24.Settlement", "CubeTownV24.Density"),
        ))
    landmark_asset = f"{Q}/{landmark}"
    added.append(spawn_height(
        f"CT_V24_{prefix}_{landmark}", landmark_asset, (cx,cy,18), 440 if landmark == "Well" else 720,
        0, True, region, ("CubeTownV24.Landmark", "CubeTownV24.Density"),
    ))
    prop_assets = (f"{Q}/MarketStand_1", f"{Q}/MarketStand_2", f"{Q}/Cart", f"{Q}/Crate", f"{Q}/Barrel", f"{Q}/Bench_1", f"{Q}/Bench_2", f"{Q}/Bonfire_Lit")
    for index, asset in enumerate(prop_assets):
        angle = index * 2.399963 + 0.4
        radius = 650 + (index%3)*330
        added.append(spawn_height(
            f"CT_V24_{prefix}_Prop_{index:02d}", asset,
            (cx+math.cos(angle)*radius,cy+math.sin(angle)*radius,18), 115+(index%3)*55,
            index*37, False, region, ("CubeTownV24.Density",),
        ))


def add_farm_and_orchard(added):
    region = "MoonmossMarsh"
    # Readable land use first: a working yard and four planted parcels separated by grass margins.
    added.append(spawn_rect("CT_V24_MoonmossFarmyard", (-30500,-31500,11), 5000, 3800, 0, region, "HeartstoneCobble", ("CubeTownV24.FarmField",)))
    farm_plots = (
        ("Southwest", (-34750,-40300,11), 5900, 4100),
        ("Southeast", (-27750,-40300,11), 5900, 4100),
        ("Northwest", (-34750,-35000,11), 5900, 3400),
        ("Northeast", (-27750,-35400,11), 5900, 2700),
    )
    for name, location, length, width in farm_plots:
        added.append(spawn_rect(
            f"CT_V24_MoonmossField_{name}", location, length, width, 0, region,
            "MoonmossMud", ("CubeTownV24.FarmField", "CubeTownV24.Density"),
        ))
    # Pale stone service lanes split the parcels and connect them to the mill yard.
    for index, y in enumerate(range(-42550, -32049, 900)):
        added.append(spawn_rect(
            f"CT_V24_MoonmossFarmLaneTile_{index:02d}", (-31250,y,12), 900, 900, 0,
            region, "HeartstoneCobble", ("CubeTownV24.FarmField",),
        ))
    add_settlement(added, "MoonmossFarm", (-30500,-31500), region, 9, "Mill")
    # Working farm perimeter: orchard rows, stable, fenced plots, carts, hay and sawmill.
    for row in range(6):
        for col in range(7):
            x = -40500 + col*1150 + (row%2)*180
            y = -42000 + row*1200
            added.append(spawn_height(
                f"CT_V24_Orchard_{row:02d}_{col:02d}", TREE_ASSETS[(row+col)%len(TREE_ASSETS)],
                (x,y,17), 470+((row+col)%3)*55, (row*41+col*23)%360, False, region,
                ("CubeTownV24.Orchard", "CubeTownV24.Density"),
            ))
    for index, (x,y,yaw) in enumerate(((-36000,-35000,0),(-34000,-35000,0),(-32000,-35000,0),(-36000,-37000,0),(-34000,-37000,0),(-32000,-37000,0))):
        added.append(spawn_sized(f"CT_V24_FarmFence_{index:02d}", f"{Q}/Fence", (x,y,18), 1100, yaw, True, region, ("CubeTownV24.Density",)))
    for index, asset in enumerate((f"{Q}/Stable", f"{Q}/Sawmill", f"{Q}/Crate", f"{Q}/Bags", f"{Q}/Cart")):
        added.append(spawn_height(f"CT_V24_FarmWork_{index:02d}", asset, (-25500+index*850,-36500+(index%2)*900,18), 240+index*65, index*31, index<2, region, ("CubeTownV24.Density",)))

    # Make the farm read as cultivated land from the high adventure camera.  Alternating herb,
    # flower and bush rows fill the former blank rectangle while preserving walkable furrows.
    crop_assets = (
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush",
        "/Game/Phantom/Generated/Common/SM_Bush_A",
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush",
    )
    for row in range(14):
        for col in range(13):
            x = -36500 + col * 900
            y = -43000 + row * 900
            # The diagonal Moonmoss road remains a readable route through the fields.
            if abs(y - (-31500 + (x + 30500) * 0.18)) < 650 or math.hypot(x + 30500, y + 34800) < 1450:
                continue
            added.append(spawn_height(
                f"CT_V24_CropRow_{row:02d}_{col:02d}", crop_assets[(row + col) % len(crop_assets)],
                (x, y, 17), 92 + ((row + col) % 3) * 18, (row * 17 + col * 13) % 360,
                False, region, ("CubeTownV24.FarmField", "CubeTownV24.Density"),
            ))
    for index, (x, y, yaw) in enumerate((
        (-36500,-34000,90),(-36500,-32000,90),(-36500,-30000,90),
        (-24500,-34000,90),(-24500,-32000,90),(-24500,-30000,90),
        (-34500,-28500,0),(-32500,-28500,0),(-30500,-28500,0),(-28500,-28500,0),(-26500,-28500,0),
    )):
        added.append(spawn_sized(
            f"CT_V24_FarmPlotFence_{index:02d}", f"{Q}/Fence", (x,y,18), 1050, yaw,
            True, region, ("CubeTownV24.FarmField", "CubeTownV24.Density"),
        ))


def add_forest(added):
    region = "DeepForest"
    center=(-33500,10500)
    # Layered forest: dense edges, clearings, shrine, camp, resource pocket and hidden route.
    for index in range(96):
        angle=index*2.399963
        ring=2200+(index%12)*520
        x=center[0]+math.cos(angle)*ring
        y=center[1]+math.sin(angle)*ring*0.78
        if (x-center[0])**2+(y-center[1])**2 < 1700**2:
            x += 2100
        added.append(spawn_height(f"CT_V24_DeepForestTree_{index:03d}", TREE_ASSETS[index%len(TREE_ASSETS)], (x,y,17), 520+(index%5)*60, index*29, False, region, ("CubeTownV24.Forest", "CubeTownV24.Density")))
    added.append(spawn_height("CT_V24_HiddenGroveShrine", "/Game/Phantom/Generated/Cubetown/SM_CubetownShrine", (-36500,17500,18), 520, 18, True, region, ("CubeTownV24.Landmark","CubeTownV24.Density")))
    added.append(spawn_height("CT_V24_ForestAncientArch", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A", (-30000,14500,18), 820, 42, True, region, ("CubeTownV24.Landmark","CubeTownV24.Density")))
    camp_assets=(f"{Q}/Bonfire_Lit",f"{Q}/Gazebo",f"{Q}/Crate",f"{Q}/Barrel")
    for index, (x,y) in enumerate(((-34500,9000),(-33000,8200),(-31800,9800),(-37500,12500))):
        added.append(spawn_height(f"CT_V24_ForestCamp_{index:02d}", camp_assets[index%4], (x,y,18), 160+(index%2)*120, index*43, False, region, ("CubeTownV24.EnemySite","CubeTownV24.Density")))


def add_quarry(added):
    region="StarfallQuarry"; cx,cy=32500,9000
    # A readable three-tier excavation replaces the old random boulder cloud. Each ring leaves a
    # southern break so the regional road visibly enters the work floor instead of dead-ending.
    added.append(spawn_rect("CT_V24_QuarryFloor", (cx,cy,11), 6800, 5600, 0, region, "HeartstoneCobble", ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density")))
    rock_index = 0
    for tier, (count, radius_x, radius_y, base_height) in enumerate(((26,7000,5300,350),(22,5200,3900,300),(18,3500,2550,250))):
        for step in range(count):
            angle = step * (2.0 * math.pi / count)
            # Preserve a broad entrance in the camera-facing southern wall.
            if math.sin(angle) < -0.62 and abs(math.cos(angle)) < 0.52:
                continue
            x = cx + math.cos(angle) * radius_x
            y = cy + math.sin(angle) * radius_y
            added.append(spawn_height(
                f"CT_V24_QuarryRock_{rock_index:03d}", ROCK_ASSETS[(step+tier)%len(ROCK_ASSETS)],
                (x,y,17), base_height + (step%4)*55, step*31+tier*17, tier==0 and step%7==0,
                region, ("CubeTownV24.Quarry","CubeTownV24.Density"),
            ))
            rock_index += 1
    for index, (x,y) in enumerate(((30500,7800),(32500,7600),(34500,8000),(30000,9800),(35000,10100))):
        asset=(f"{Q}/Cart",f"{Q}/Crate",f"{Q}/Barrel",f"{Q}/Sawmill_saw",f"{Q}/Crate")[index]
        added.append(spawn_height(
            f"CT_V24_QuarryFloorWork_{index:02d}", asset, (x,y,18), 170+(index%3)*55,
            index*47, False, region, ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    # Dense inner activity: low ore stones define the extraction ring and a staggered equipment
    # grid makes the entire floor read as a working quarry without blocking its entry lane.
    for index in range(14):
        angle=index*(2.0*math.pi/14.0)
        added.append(spawn_height(
            f"CT_V24_QuarryInnerOre_{index:02d}", ROCK_ASSETS[index%len(ROCK_ASSETS)],
            (cx+math.cos(angle)*1850,cy+math.sin(angle)*1250,18), 135+(index%4)*28,
            index*29, False, region,
            ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    # Stone and Stone_Dark in this pack are materials, not placeable meshes. Keep
    # this list mesh-only so authoring fails closed before a malformed map can save.
    floor_assets=(f"{Q}/Rock_1",f"{Q}/Rock_2",f"{Q}/Rock_3",f"{Q}/Crate",f"{Q}/Barrel",f"{Q}/Cart",f"{Q}/Bags",f"{Q}/Sawmill_saw")
    floor_index=0
    for row,y in enumerate((7000,8200,10400,11600)):
        for col,x in enumerate((29500,31000,34000,35500)):
            if math.hypot(x-cx,y-cy)<1750:
                continue
            asset=floor_assets[(row*5+col*3)%len(floor_assets)]
            added.append(spawn_height(
                f"CT_V24_QuarryEquipment_{floor_index:02d}", asset, (x,y,18),
                125+((row+col)%4)*32, (row*53+col*37)%360, False, region,
                ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
            ))
            floor_index += 1
    # Compose six readable extraction bays instead of leaving the quarry as one
    # oversized empty pad. Each bay gets an ore face, broken stone, supplies, and
    # a work prop; the north/south center lane remains traversable.
    work_bays=((30000,7900),(35000,7900),(30000,10300),(35000,10300),(30700,11700),(34300,11700))
    bay_props=(f"{Q}/Crate",f"{Q}/Barrel",f"{Q}/Bags",f"{Q}/Cart",f"{Q}/Sawmill_saw",f"{Q}/Bag_Open")
    bay_offsets=((-520,-260),(480,-180),(-390,430),(410,390))
    quarry_detail_index=0
    for bay_index,(bx,by) in enumerate(work_bays):
        for rock_offset,(ox,oy) in enumerate(bay_offsets):
            added.append(spawn_height(
                f"CT_V24_QuarryBayRock_{quarry_detail_index:02d}",
                ROCK_ASSETS[(bay_index+rock_offset)%len(ROCK_ASSETS)],
                (bx+ox,by+oy,18), 210+((bay_index+rock_offset)%4)*55,
                bay_index*47+rock_offset*61, False, region,
                ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
            ))
            quarry_detail_index += 1
        added.append(spawn_height(
            f"CT_V24_QuarryBayProp_{bay_index:02d}",bay_props[bay_index%len(bay_props)],
            (bx+120,by+80,18),190+(bay_index%3)*45,bay_index*53,False,region,
            ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    # A tiled service track gives the excavation a clear traversal spine and
    # breaks up the otherwise featureless floor without using stretched meshes.
    for track_index,y in enumerate((7000,7800,8600,9400,10200,11000,11800,12600)):
        added.append(spawn_rect(
            f"CT_V24_QuarryServiceTrack_{track_index:02d}",(32500,y,13),850,850,0,
            region,"HeartstonePath",("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    # Large work silhouettes keep the excavation readable at the zoomed-out
    # adventure camera; each is paired with the smaller bay dressing above.
    heavy_work=((30500,9000,f"{Q}/Sawmill",470,8),
                (34500,9000,f"{Q}/Blacksmith",520,188),
                (30500,11000,f"{Q}/MarketStand_1",430,18),
                (34500,11000,f"{Q}/MarketStand_2",430,198),
                (31200,7600,f"{Q}/Cart",290,40),
                (33800,7600,f"{Q}/Cart",290,220))
    for work_index,(x,y,asset,height,yaw) in enumerate(heavy_work):
        added.append(spawn_height(
            f"CT_V24_QuarryHeavyWork_{work_index:02d}",asset,(x,y,18),height,yaw,False,region,
            ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    # Timber safety edges and lamps make the inner work floor feel built and
    # intentionally bounded while preserving the open southern entrance.
    for edge_index,(x,y,yaw) in enumerate(((29050,7600,90),(29050,9000,90),(29050,10400,90),(29050,11800,90),
                                           (35950,7600,90),(35950,9000,90),(35950,10400,90),(35950,11800,90))):
        added.append(spawn_height(
            f"CT_V24_QuarrySafetyFence_{edge_index:02d}",f"{Q}/Fence",(x,y,18),185,yaw,False,region,
            ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    for lamp_index,(x,y) in enumerate(((31500,7600),(33500,7600),(31500,11300),(33500,11300))):
        added.append(spawn_height(
            f"CT_V24_QuarryLamp_{lamp_index:02d}",f"{Q}/Bonfire_Lit",(x,y,18),170,lamp_index*90,False,region,
            ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Density"),
        ))
    added.append(spawn_height(
        "CT_V24_QuarryCore", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A",
        (32500,9700,18), 560, 12, True, region,
        ("CubeTownV24.Quarry","CubeTownV24.QuarryFloor","CubeTownV24.Landmark","CubeTownV24.Density"), CRYSTAL_MATERIAL,
    ))
    added.append(spawn_height("CT_V24_QuarryGate", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A", (40500,14500,18), 850, 62, True, region, ("CubeTownV24.Landmark","CubeTownV24.Density")))
    for index, asset in enumerate((f"{Q}/Sawmill",f"{Q}/Blacksmith",f"{Q}/Cart",f"{Q}/Crate",f"{Q}/Barrel",f"{Q}/Bonfire_Lit")):
        added.append(spawn_height(f"CT_V24_QuarryWork_{index:02d}", asset, (28500+index*900,3500+(index%2)*1000,18), 180+(index%2)*310, index*29, index<2, region, ("CubeTownV24.Density",)))


def add_highlands_and_ruins(added):
    region="FrostbloomHeights"; cx,cy=-25500,34000
    for index in range(58):
        angle=index*2.399963; ring=1700+(index%9)*720
        asset=ROCK_ASSETS[index%len(ROCK_ASSETS)] if index%3 else TREE_ASSETS[index%len(TREE_ASSETS)]
        height=300+(index%5)*95 if index%3 else 520+(index%4)*80
        added.append(spawn_height(f"CT_V24_FrostHeight_{index:03d}",asset,(cx+math.cos(angle)*ring,cy+math.sin(angle)*ring*0.7,17),height,index*31,index%11==0,region,("CubeTownV24.Mountain","CubeTownV24.Density")))
    added.append(spawn_height("CT_V24_FrostBellTower",f"{Q}/Bell_Tower",(-25000,40500,18),920,12,True,region,("CubeTownV24.Landmark","CubeTownV24.Density")))
    for index,(x,y,yaw) in enumerate(((-31000,30000,90),(-31000,32000,90),(-31000,34000,90),(-29000,36000,0),(-27000,36000,0),(-25000,36000,0))):
        added.append(spawn_height(f"CT_V24_GraveRuinWall_{index:02d}","/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall",(x,y,18),620,yaw,True,region,("CubeTownV24.Ruin","CubeTownV24.Density")))
    for index,(x,y) in enumerate(((-29500,31500),(-28000,33000),(-26500,31500))):
        added.append(spawn_height(f"CT_V24_GraveRuinTower_{index:02d}","/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower",(x,y,18),720,index*60,True,region,("CubeTownV24.Ruin","CubeTownV24.Landmark","CubeTownV24.Density")))


def add_phantomite_wilds(added):
    region="EmberbloomPhantomite"; cx,cy=32500,34000
    crystal="/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A"
    for index in range(54):
        angle=index*2.399963; ring=1200+(index%9)*590
        asset=crystal if index%3 else ROCK_ASSETS[index%4]
        height=(210+(index%5)*58) if asset==crystal else (190+(index%4)*62)
        added.append(spawn_height(f"CT_V24_PhantomiteWild_{index:03d}",asset,(cx+math.cos(angle)*ring,cy+math.sin(angle)*ring*0.78,17),height,index*43,index%13==0,region,("CubeTownV24.Phantomite","CubeTownV24.Density"),CRYSTAL_MATERIAL if asset==crystal else None))
    for index,(x,y,yaw) in enumerate(((27500,30000,0),(29500,30000,0),(31500,30000,0),(33500,30000,0),(35500,30000,0),(37500,30000,0))):
        added.append(spawn_height(f"CT_V24_PhantomiteRuin_{index:02d}","/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall",(x,y,18),650,yaw,True,region,("CubeTownV24.Ruin","CubeTownV24.Density")))
    added.append(spawn_height("CT_V24_PhantomiteCitadel","/Game/Phantom/External/CC0/Aliases/SM_CC0_Keep",(38500,38500,18),950,35,True,region,("CubeTownV24.Landmark","CubeTownV24.Density")))


def add_coast_village(added):
    region="SunpetalCoast"
    # The coast is a composed village district, not buildings sprinkled on grass. Sand defines the
    # district, two broad streets form a cross, and cobbled courts anchor the market and workshops.
    added.append(spawn_rect("CT_V24_SunpetalBeach", (30500,-40700,10), 18800, 2400, 0, region, "SunpetalSand", ("CubeTownV24.CoastVillage",)))
    for index, x in enumerate(range(23900, 37101, 900)):
        added.append(spawn_rect(
            f"CT_V24_SunpetalMainStreetTile_{index:02d}", (x,-32000,12), 900, 900, 0,
            region, "HeartstoneCobble", ("CubeTownV24.CoastVillage",),
        ))
    for index, y in enumerate(range(-37400, -26599, 900)):
        added.append(spawn_rect(
            f"CT_V24_SunpetalHarborStreetTile_{index:02d}", (30500,y,13), 900, 900, 0,
            region, "HeartstoneCobble", ("CubeTownV24.CoastVillage",),
        ))
    added.append(spawn_rect("CT_V24_SunpetalMarketSquare", (30500,-32000,14), 4200, 3600, 0, region, "HeartstoneCobble", ("CubeTownV24.CoastVillage",)))
    for index, (x,y) in enumerate(((25000,-36500),(36000,-36500),(25000,-27500),(36000,-27500))):
        added.append(spawn_rect(
            f"CT_V24_SunpetalCourt_{index:02d}", (x,y,12), 2400, 1800,
            0, region, "HeartstoneCobble", ("CubeTownV24.CoastVillage",),
        ))
    add_settlement(added,"SunpetalVillage",(30500,-31500),region,10,"Gazebo")

    # Aligned street fronts make the settlement read as a town from the adventure camera.
    street_fronts = (
        (24500,-36500,0),(27500,-36500,0),(33500,-36500,0),(36500,-36500,0),
        (24500,-27500,180),(27500,-27500,180),(33500,-27500,180),(36500,-27500,180),
        (25000,-33500,90),(25000,-30500,90),(36000,-33500,270),(36000,-30500,270),
    )
    for index, (x,y,yaw) in enumerate(street_fronts):
        added.append(spawn_height(
            f"CT_V24_SunpetalStreetHouse_{index:02d}", HOUSE_ASSETS[index%4],
            (x,y,18), 395+(index%3)*42, yaw, True, region,
            ("CubeTownV24.CoastVillage", "CubeTownV24.Settlement", "CubeTownV24.Density"),
        ))
    for index in range(34):
        angle=index*2.399963; ring=2400+(index%7)*720
        asset=TREE_ASSETS[index%len(TREE_ASSETS)] if index%3 else DETAIL_ASSETS[index%len(DETAIL_ASSETS)]
        added.append(spawn_height(f"CT_V24_SunpetalDetail_{index:03d}",asset,(30500+math.cos(angle)*ring,-31500+math.sin(angle)*ring*0.68,17),190+(index%5)*80,index*31,False,region,("CubeTownV24.Density",)))

    # A complete coast district: two market streets, garden clusters, work props and a visible
    # southern arrival lane.  This deliberately occupies the space that previously rendered as
    # a featureless orange field in the packaged region capture.
    market_assets = (f"{Q}/MarketStand_1", f"{Q}/MarketStand_2", f"{Q}/Cart", f"{Q}/Crate", f"{Q}/Barrel", f"{Q}/Bench_1")
    for row, y in enumerate(range(-39000, -25499, 1500)):
        for col, x in enumerate(range(23500, 38501, 1700)):
            seed = row * 19 + col * 31
            asset = market_assets[seed % len(market_assets)] if (row + col) % 2 == 0 else DETAIL_ASSETS[0]
            if math.hypot(x - 30500, y + 35200) < 1450:
                continue
            prop_height = 230 + (seed % 4) * 38 if asset in market_assets else 150 + (seed % 3) * 30
            added.append(spawn_height(
                f"CT_V24_SunpetalMarket_{row:02d}_{col:02d}", asset, (x,y,17),
                prop_height, 90 if row % 2 else 270, False, region,
                ("CubeTownV24.CoastVillage", "CubeTownV24.Density"),
            ))
    for index, (x,y,yaw) in enumerate((
        (23000,-37500,90),(23000,-35000,90),(23000,-32500,90),(23000,-30000,90),(23000,-27500,90),
        (39000,-37500,90),(39000,-35000,90),(39000,-32500,90),(39000,-30000,90),(39000,-27500,90),
        (25500,-39000,0),(28000,-39000,0),(33000,-39000,0),(35500,-39000,0),
    )):
        added.append(spawn_sized(
            f"CT_V24_SunpetalFence_{index:02d}", f"{Q}/Fence", (x,y,18), 1125, yaw,
            True, region, ("CubeTownV24.CoastVillage", "CubeTownV24.Density"),
        ))
    for index, (x,y) in enumerate(((25000,-30500),(27000,-30000),(34000,-30000),(36500,-30500))):
        added.append(spawn_height(
            f"CT_V24_SunpetalWorkshop_{index:02d}", (f"{Q}/Sawmill",f"{Q}/Stable",f"{Q}/Blacksmith",f"{Q}/Inn")[index],
            (x,y,18), 460 + (index%2)*55, index*73, True, region,
            ("CubeTownV24.CoastVillage", "CubeTownV24.Density"),
        ))

    # A planted perimeter contains the district and replaces the former horizon of empty lawn.
    for index in range(56):
        angle = index * (2.0 * math.pi / 56.0)
        radius_x = 10400 + (index%3)*420
        radius_y = 9000 + (index%4)*360
        x = 30500 + math.cos(angle)*radius_x
        y = -32000 + math.sin(angle)*radius_y
        asset = TREE_ASSETS[index%len(TREE_ASSETS)] if index%3 else "/Game/Phantom/Generated/Common/SM_Bush_A"
        added.append(spawn_height(
            f"CT_V24_SunpetalPerimeter_{index:02d}", asset, (x,y,17),
            360+(index%5)*48, index*31, False, region,
            ("CubeTownV24.CoastVillage", "CubeTownV24.Density"),
        ))


def add_crimson_grove(added):
    region="CrimsonGrove"; cx,cy=0,35000
    for index in range(84):
        angle=index*2.399963; ring=1600+(index%12)*620
        asset=TREE_ASSETS[index%len(TREE_ASSETS)] if index%4 else "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A"
        added.append(spawn_height(f"CT_V24_CrimsonGrove_{index:03d}",asset,(cx+math.cos(angle)*ring,cy+math.sin(angle)*ring*0.75,17),320+(index%6)*70,index*29,False,region,("CubeTownV24.Forest","CubeTownV24.Density")))
    added.append(spawn_height("CT_V24_CrimsonGroveLandmark",f"{Q}/Bell_Tower",(0,43000,18),980,180,True,region,("CubeTownV24.Landmark","CubeTownV24.Density")))


def add_cell_density(added):
    # Six authored details in every 100m x 100m cell backstop the high-density runtime layer.
    # A 100m sector can no longer pass because of three objects clustered in one corner.
    for gx in range(-5,5):
        for gy in range(-5,5):
            cx,cy=gx*10000+5000,gy*10000+5000
            region=region_for(cx,cy)
            if region == "MoonmossMarsh":
                palette = (f"{Q}/Bags", f"{Q}/Crate", "/Game/Phantom/Generated/Common/SM_Bush_A", *ROCK_ASSETS[:3])
            elif region == "SunpetalCoast":
                palette = (f"{Q}/Crate", f"{Q}/Barrel", f"{Q}/Bench_1", "/Game/Phantom/Generated/Common/SM_Bush_A", *ROCK_ASSETS[:3])
            elif region in ("StarfallQuarry","FrostbloomHeights","EmberbloomPhantomite"):
                palette = ROCK_ASSETS
            else:
                palette = TREE_ASSETS+DETAIL_ASSETS
            for index in range(6):
                seed=(gx+7)*131+(gy+7)*73+index*47
                ox=((seed*97)%6400)-3200; oy=((seed*53)%6400)-3200
                # Keep the central travel axes readable while still dressing their cell edges.
                x=cx+ox; y=cy+oy
                if abs(x)<1050: x += 1800 if (seed&1) else -1800
                if abs(y+2300)<900: y += 1700
                asset=palette[seed%len(palette)]
                is_tree=asset in TREE_ASSETS
                height=(460+(seed%5)*65) if is_tree else (150+(seed%5)*55)
                added.append(spawn_height(f"CT_V24_Cell_{gx+5:02d}_{gy+5:02d}_{index}",asset,(x,y,16),height,seed%360,False,region,("CubeTownV24.CellDensity","CubeTownV24.Density")))


def add_boundary(added):
    index=0
    for value in range(-45000,45001,5000):
        for x,y in ((value,-46500),(value,46500),(-46500,value),(46500,value)):
            region=region_for(x,y)
            asset=ROCK_ASSETS[index%len(ROCK_ASSETS)] if index%3==0 else TREE_ASSETS[index%len(TREE_ASSETS)]
            added.append(spawn_height(f"CT_V24_Boundary_{index:03d}",asset,(x,y,16),520+(index%5)*90,index*37,False,region,("CubeTownV24.Boundary","CubeTownV24.Density")))
            index+=1


def validate_density(added):
    cells={(gx,gy):0 for gx in range(-5,5) for gy in range(-5,5)}
    for actor in added:
        if not actor.actor_has_tag("CubeTownV24.Density"):
            continue
        p=actor.get_actor_location()
        gx=max(-5,min(4,int(math.floor(float(p.x)/10000.0))))
        gy=max(-5,min(4,int(math.floor(float(p.y)/10000.0))))
        cells[(gx,gy)]+=1
    empty=[f"{gx},{gy}" for (gx,gy),count in cells.items() if count<6]
    return cells,empty


def patch():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed=remove_previous()
    base_terrain=[actor for actor in (actors.get_all_level_actors() or []) if actor.get_actor_label()=="CT_Terrain_Cube_11"]
    if len(base_terrain)!=1:
        raise RuntimeError(f"Expected one seamless CubeTown terrain base, found {len(base_terrain)}")
    base_actor=base_terrain[0]
    _base_origin,base_extent=base_actor.get_actor_bounds(False)
    base_size_x=max(1.0,float(base_extent.x)*2.0)
    base_size_y=max(1.0,float(base_extent.y)*2.0)
    base_scale=base_actor.get_actor_scale3d()
    base_actor.set_actor_scale3d(unreal.Vector(
        float(base_scale.x)*96000.0/base_size_x,
        float(base_scale.y)*96000.0/base_size_y,
        float(base_scale.z),
    ))
    # Rebuild deterministic world-space materials on every authoring pass. The prior base material
    # used ordinary mesh UVs, stretching one bright texture over 960 metres and reading as a flat
    # neon sheet. These surfaces repeat in world metres and keep deliberate parcel boundaries crisp.
    for role, brightness, uv_scale, use_normal in (
        ("HeartstoneGrass", 0.56, 0.0018, True),
        ("HeartstonePath", 0.62, 0.0022, False),
        ("HeartstoneCobble", 0.68, 0.0024, False),
        ("MoonmossMud", 0.58, 0.0020, False),
        ("SunpetalSand", 0.68, 0.0020, False),
    ):
        ensure_world_surface_material(role, brightness, uv_scale, use_normal)
    obsolete_field_material = f"{V24_MATERIAL_ROOT}/M_CT24_FieldSoil"
    if unreal.EditorAssetLibrary.does_asset_exist(obsolete_field_material):
        unreal.EditorAssetLibrary.delete_asset(obsolete_field_material)
    apply_world_material(base_actor, "HeartstoneGrass")
    base_location=base_actor.get_actor_location()
    base_actor.set_actor_location(unreal.Vector(0.0,0.0,float(base_location.z)),False,False)
    added=[]
    # Keep the existing seamless full-world terrain as the visible base. Earlier V24 candidates
    # overlaid 25 square material cards, exposing grid repetition and bright seams in Shipping.
    # Region identity now comes from authored topology, settlement silhouettes and foliage palettes.
    add_roads(added)
    add_river(added)
    add_farm_and_orchard(added)
    add_coast_village(added)
    add_forest(added)
    add_quarry(added)
    add_highlands_and_ruins(added)
    add_crimson_grove(added)
    add_phantomite_wilds(added)
    add_cell_density(added)
    add_boundary(added)
    added=[actor for actor in added if actor]
    cells,empty=validate_density(added)
    road_count=sum(1 for actor in added if actor.actor_has_tag("CubeTownV24.Road"))
    landmark_count=sum(1 for actor in added if actor.actor_has_tag("CubeTownV24.Landmark"))
    if len(added)<1800:
        raise RuntimeError(f"V24 world under-populated: {len(added)} actors")
    if road_count<550:
        raise RuntimeError(f"V24 traversal network incomplete: {road_count} road pieces")
    if landmark_count<12:
        raise RuntimeError(f"V24 landmark network incomplete: {landmark_count} landmarks")
    if empty:
        raise RuntimeError("V24 has under-populated 100m cells: "+", ".join(empty))
    if not level.save_current_level():
        raise RuntimeError("Could not save CubeTown V24 world")
    return {
        "schema":24,
        "status":"PASS",
        "map":WORLD,
        "playable_bounds_cm":[-47000,47000],
        "playable_area_square_km":0.8836,
        "seamless_terrain_base":"CT_Terrain_Cube_11",
        "seamless_terrain_size_cm":[96000,96000],
        "regional_overlay_tiles":0,
        "world_space_surface_materials":5,
        "removed_previous_v24":removed,
        "actors_added":len(added),
        "road_pieces":road_count,
        "landmarks":landmark_count,
        "density_cells":len(cells),
        "minimum_density_per_100m_cell":min(cells.values()),
        "empty_cells":empty,
    }


try:
    result=patch()
except Exception as exc:
    result={"schema":24,"status":"FAIL","error":str(exc)}
    with open(REPORT,"w",encoding="utf-8") as handle:
        json.dump(result,handle,indent=2)
    raise
else:
    with open(REPORT,"w",encoding="utf-8") as handle:
        json.dump(result,handle,indent=2)
    unreal.log("CUBETOWN V24 ECHO WORLD PASS "+json.dumps(result))
