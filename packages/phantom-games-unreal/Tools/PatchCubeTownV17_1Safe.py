"""CubeTown V17.1 safe persistent-world patch.
No texture imports. Uses assets already present in PhantomPlay and writes a PASS/FAIL report.
Designed to resume a V17 installation after the editor pipeline returned a non-zero process code.
"""
from __future__ import annotations
import json, math, os, traceback
import unreal

WORLD = "/Game/Phantom/Worlds/CubeTown_World"
TAG = "PhantomProductionWorldV171"
OLD_TAG = "PhantomProductionWorldV17"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV17_1SafePatch.json")

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def log(msg):
    unreal.log("CUBETOWN V17.1: " + str(msg))


def load_asset(path):
    # Accept package path or object path; try both forms.
    candidates = [path]
    if "." in path.rsplit("/", 1)[-1]:
        candidates.append(path.rsplit(".", 1)[0])
    for p in candidates:
        try:
            obj = unreal.load_asset(p)
            if obj:
                return obj
        except Exception:
            pass
    return None


def remove_tagged():
    removed = 0
    for actor in list(actors.get_all_level_actors()):
        try:
            tags = {str(x) for x in actor.get_editor_property("tags")}
            if TAG in tags or OLD_TAG in tags:
                actors.destroy_actor(actor)
                removed += 1
        except Exception:
            pass
    return removed


def spawn(label, mesh_path, loc, scale=(1,1,1), yaw=0.0, collision=False):
    mesh = load_asset(mesh_path)
    if not mesh:
        log(f"SKIP missing mesh: {mesh_path}")
        return None
    a = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(loc[0]), float(loc[1]), float(loc[2])),
        unreal.Rotator(0.0, float(yaw), 0.0),
        False,
    )
    if not a:
        log(f"SKIP failed spawn: {label}")
        return None
    comp = a.get_editor_property("static_mesh_component")
    comp.set_static_mesh(mesh)
    try:
        comp.set_collision_enabled(unreal.CollisionEnabled.QUERY_AND_PHYSICS if collision else unreal.CollisionEnabled.NO_COLLISION)
    except Exception:
        pass
    a.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    a.set_actor_label(label)
    a.set_editor_property("tags", [unreal.Name(TAG), unreal.Name(label)])
    return a


def patch():
    log("loading persistent map")
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)

    removed = remove_tagged()
    made = []

    # Near-spawn proof area. All paths below were already present in the uploaded PhantomPlay project.
    setpieces = [
        ("CT171_HeartstoneArchA", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A", (-1900,-7200,35), (1.10,1.10,1.10), 0),
        ("CT171_HeartstoneArchB", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A", (1900,-7200,35), (1.10,1.10,1.10), 180),
        ("CT171_Bridge", "/Game/Phantom/Curated/Cube/SM_Cube_Bridge", (0,-5200,40), (1.35,1.35,1.35), 90),
        ("CT171_Windmill", "/Game/Phantom/Curated/Cube/SM_Cube_Windmill", (4300,-2500,35), (1.20,1.20,1.20), -25),
        ("CT171_Market", "/Game/Phantom/Curated/Cube/SM_Cube_Market", (-4300,-2500,35), (1.20,1.20,1.20), 25),
        ("CT171_Well", "/Game/Phantom/Curated/Cube/SM_Cube_Well", (0,-3400,28), (1.55,1.55,1.55), 0),
        ("CT171_FloatingIslandProof", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFloatingIsland_A", (0,1200,900), (0.58,0.58,0.32), 0),
    ]
    for item in setpieces:
        if spawn(*item): made.append(item[0])

    # Dense storybook perimeter around the opening route.
    tree_paths = [
        "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Crimson_A",
        "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Lavender_A",
        "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Rose_A",
        "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Coral_A",
    ]
    for i in range(40):
        side = -1 if i % 2 == 0 else 1
        y = -10200 + (i // 2) * 650
        x = side * (3900 + (i % 5) * 520)
        path = tree_paths[i % len(tree_paths)]
        s = 0.72 + (i % 4) * 0.09
        if spawn(f"CT171_RouteTree_{i:02d}", path, (x,y,30), (s,s,s), (i*47)%360, False): made.append(i)

    # Landmark rings around destination areas.
    ring_specs = [
        ((-23000,21000,30), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember", 16, 3200, .68),
        ((-27000,6000,30), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream", 16, 3200, .70),
        ((-22000,-16000,20), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A", 20, 2900, .58),
        ((22000,-19000,20), "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A", 20, 3000, .60),
    ]
    rid = 0
    for center, path, count, radius, sc in ring_specs:
        for i in range(count):
            a = math.tau * i / count
            x = center[0] + math.cos(a) * radius
            y = center[1] + math.sin(a) * radius
            if spawn(f"CT171_Ring_{rid:03d}", path, (x,y,center[2]), (sc,sc,sc), math.degrees(a)+90, False): made.append(rid)
            rid += 1

    # Traversal chain: physical floating islands with collision, intentionally authored for Memorycraft.
    for i in range(12):
        x = -10500 + i * 1650
        y = 8200 + math.sin(i * .75) * 1100
        z = 420 + i * 165
        if spawn(f"CT171_SkyChain_{i:02d}", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFloatingIsland_A", (x,y,z), (.38,.38,.22), i*19, True): made.append(i)

    if len(made) < 30:
        raise RuntimeError(f"Only {len(made)} V17.1 actors spawned; expected at least 30. Asset-path regression suspected.")

    if not level.save_current_level():
        raise RuntimeError("CubeTown_World loaded but could not be saved")

    return {"removed_old_v17": removed, "actors_spawned": len(made), "map": WORLD}


result = {"revision":"V17.1","status":"RUNNING"}
try:
    result["cubetown"] = patch()
    result["status"] = "PASS"
    log("SAFE WORLD PATCH PASS")
except Exception as exc:
    result["status"] = "FAIL"
    result["error"] = str(exc)
    result["traceback"] = traceback.format_exc()
    unreal.log_error("CUBETOWN V17.1 SAFE PATCH FAILED: " + str(exc))
    raise
finally:
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
