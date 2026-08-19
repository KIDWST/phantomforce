"""CubeTown V17 persistent-world diorama pass.
Adds real authored map content directly to CubeTown_World so the upgrade is visible even before PIE.
Idempotent: actors tagged PhantomProductionWorldV17 are replaced on rerun.
"""
from __future__ import annotations
import json, math, os, traceback
import unreal

WORLD = "/Game/Phantom/Worlds/CubeTown_World"
TAG = "PhantomProductionWorldV17"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV17DioramaPatch.json")
MESH_PLANE = "/Game/Phantom/Generated/Cubetown/V17/SM_V17_DioramaGroundPatch"
MATERIAL_ROOT = "/Game/Phantom/Generated/Cubetown/V17/Materials"

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def asset(path):
    try:
        return unreal.EditorAssetLibrary.load_asset(path)
    except Exception:
        return None


def ensure_plane():
    if not unreal.EditorAssetLibrary.does_asset_exist(MESH_PLANE):
        unreal.EditorAssetLibrary.make_directory(MESH_PLANE.rsplit("/", 1)[0])
        if not unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Plane", MESH_PLANE):
            raise RuntimeError("Could not create V17 diorama plane")
        unreal.EditorAssetLibrary.save_asset(MESH_PLANE, only_if_is_dirty=False)
    return asset(MESH_PLANE)


def remove_old():
    removed = 0
    for actor in list(actors.get_all_level_actors()):
        tags = [str(x) for x in actor.get_editor_property("tags")]
        if TAG in tags:
            actors.destroy_actor(actor)
            removed += 1
    return removed


def spawn_mesh(label, mesh_path, loc, scale=(1,1,1), yaw=0.0, collision=True):
    mesh = asset(mesh_path)
    if not mesh:
        return None
    a = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*map(float, loc)), transient=False)
    if not a:
        return None
    c = a.get_editor_property("static_mesh_component")
    c.set_static_mesh(mesh)
    c.set_collision_enabled(unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION)
    a.set_actor_scale3d(unreal.Vector(*map(float, scale)))
    a.set_actor_rotation(unreal.Rotator(0.0, float(yaw), 0.0), False)
    a.set_actor_label(label)
    a.set_editor_property("tags", [unreal.Name(TAG), unreal.Name(label)])
    return a


def spawn_surface(label, role, loc, scale):
    plane = ensure_plane()
    mat = asset(f"{MATERIAL_ROOT}/M_CT17_{role}")
    if not plane or not mat:
        return None
    a = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*map(float, loc)), transient=False)
    c = a.get_editor_property("static_mesh_component")
    c.set_static_mesh(plane)
    c.set_material(0, mat)
    c.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    c.set_cast_shadow(False)
    a.set_actor_scale3d(unreal.Vector(*map(float, scale)))
    a.set_actor_label(label)
    a.set_editor_property("tags", [unreal.Name(TAG), unreal.Name(label), unreal.Name("CubeTownV17.Surface")])
    return a


def ring(prefix, center, mesh_path, count, radius, scale, phase=0.0):
    out = []
    for i in range(count):
        a = phase + (math.tau * i / count)
        x = center[0] + math.cos(a) * radius * (0.88 + (i % 3) * 0.08)
        y = center[1] + math.sin(a) * radius * (0.90 + (i % 4) * 0.05)
        obj = spawn_mesh(f"{prefix}_{i:02d}", mesh_path, (x,y,center[2]), scale, math.degrees(a)+90.0, False)
        if obj: out.append(obj)
    return out


def patch():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)
    removed = remove_old()
    ensure_plane()
    added = []

    # Opening 150 m: grass shoulders + cobble ribbon. This is deliberately above the old fallback
    # plane by only a few centimetres to eliminate the empty/flat prototype read without changing collision.
    for i, y in enumerate(range(-11800, 2601, 1800)):
        if spawn_surface(f"CT17_HeartstoneGrass_{i:02d}", "HeartstoneGrass", (0,y,7), (78,20,1)): added.append(1)
        if spawn_surface(f"CT17_HeartstonePath_{i:02d}", "HeartstonePath", (0,y,10), (9.5,20,1)): added.append(1)
        if spawn_surface(f"CT17_HeartstoneCobble_{i:02d}", "HeartstoneCobble", (0,y,12), (4.0,20,1)): added.append(1)

    # Eight handcrafted "toy-box" destination pads around the canonical map.
    hubs = [
        ("Crimson", (-23000,21000,8), "CrimsonSoil"),
        ("Frost", (-27000,6000,8), "FrostSnow"),
        ("Ember", (25000,17000,8), "EmberSoil"),
        ("Moonmoss", (-22000,-16000,8), "MoonmossMud"),
        ("Sunpetal", (22000,-19000,8), "SunpetalSand"),
        ("Starfall", (12000,29000,8), "StarfallGrass"),
        ("Crown", (30000,30000,8), "CrownStone"),
        ("Ruins", (36000,0,8), "RuinsStone"),
    ]
    for name, loc, role in hubs:
        if spawn_surface(f"CT17_{name}_Pad", role, loc, (30,30,1)): added.append(1)

    # Near-spawn Memorycraft garden: unmistakable visual proof the V17 world patch executed.
    props = [
        ("CT17_GardenArch_A", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A.SM_CubeDreamAncientArch_A", (-1800,-7200,35), (1.05,1.05,1.05), 0),
        ("CT17_GardenArch_B", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A.SM_CubeDreamAncientArch_A", (1800,-7200,35), (1.05,1.05,1.05), 180),
        ("CT17_GardenBridge", "/Game/Phantom/Curated/Cube/SM_Cube_Bridge.SM_Cube_Bridge", (0,-5200,40), (1.3,1.3,1.3), 90),
        ("CT17_GardenWindmill", "/Game/Phantom/Curated/Cube/SM_Cube_Windmill.SM_Cube_Windmill", (4200,-2500,35), (1.15,1.15,1.15), -25),
        ("CT17_GardenHeartTree", "/Game/Phantom/Generated/Cubetown/V9/Setpieces/SM_V9_HeartTree.SM_V9_HeartTree", (-4300,-1800,35), (0.95,0.95,0.95), 22),
    ]
    for p in props:
        if spawn_mesh(*p): added.append(1)

    # Dense rings of authored props. These are real level actors, not a runtime-only promise.
    ring_specs = [
        ("CT17_CrimsonRocks", (-23000,21000,30), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember.SM_CubeDreamRockCluster_Ember", 18, 3100, (0.65,0.65,0.65), 0.1),
        ("CT17_FrostRocks", (-27000,6000,30), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream.SM_CubeDreamRockCluster_Cream", 18, 3000, (0.68,0.68,0.68), 0.5),
        ("CT17_MoonFlowers", (-22000,-16000,15), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A", 24, 2700, (0.48,0.48,0.48), 0.2),
        ("CT17_SunFlowers", (22000,-19000,15), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A", 24, 2850, (0.52,0.52,0.52), 0.7),
        ("CT17_RuinMushrooms", (36000,0,15), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A.SM_CubeDreamMushroomCluster_A", 20, 2600, (0.55,0.55,0.55), 0.35),
    ]
    for spec in ring_specs:
        objs = ring(*spec)
        added.extend([1] * len(objs))

    # Floating traversal chain for Memorycraft/ride-weave experiments.
    for i in range(10):
        x = -10000 + i * 1600
        y = 8500 + int(math.sin(i * 0.8) * 900)
        z = 450 + i * 170
        if spawn_mesh(f"CT17_SkyChain_{i:02d}", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFloatingIsland_A.SM_CubeDreamFloatingIsland_A", (x,y,z), (0.33,0.33,0.18), i*17, True): added.append(1)

    if not level.save_current_level():
        raise RuntimeError("Could not save V17 CubeTown world")
    return {"removed_previous_v17": removed, "actors_added": len(added), "map": WORLD}


results = {"revision": "V17", "status": "RUNNING"}
try:
    results["cubetown"] = patch()
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("CUBETOWN V17 DIORAMA PATCH FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("CUBETOWN V17 DIORAMA WORLD PATCH PASS")
