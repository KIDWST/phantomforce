"""PhantomPlay V21 first-frame quality correction.

V21 removes the last prototype-looking composition layers and explicitly binds the imported
production PBR surfaces to the persistent terrain and road actors.  It is deliberately
idempotent: its own near-camera cover is replaced on every run and all rejected historical
labels must be absent before the map is saved.
"""
from __future__ import annotations

import json
import os
import traceback

import unreal


WORLD_ROOT = "/Game/Phantom/Worlds"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomPortfolioWorldsV21.json")
PRODUCTION_TAG = "PhantomProductionWorldV11"
V21_TAG = "PhantomPortfolioWorldV21"

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("V21 portfolio correction requires Unreal editor subsystems")


RULES = {
    "cubetown": {
        "map": WORLD_ROOT + "/CubeTown_World",
        "remove_prefixes": ("CT_Road_12m_",),
        "surface_prefixes": (("CT_Terrain_", "/Game/Phantom/Materials/Production/M_Phantom_Grass"),),
    },
    "phantom-ages": {
        "map": WORLD_ROOT + "/PhantomAges_World",
        "remove_prefixes": (),
        "surface_prefixes": (("AGES_Terrain_", "/Game/Phantom/Materials/Production/M_Phantom_Dirt"),),
    },
    "phantom-legends": {
        "map": WORLD_ROOT + "/PhantomLegends_World",
        "remove_prefixes": ("LEG_V19_CommandRing_",),
        "surface_prefixes": (("LEG_Terrain_", "/Game/Phantom/Materials/Production/M_Phantom_Grass"),),
    },
    "phantom-strike": {
        "map": WORLD_ROOT + "/PhantomStrike_World",
        "remove_prefixes": ("STRIKE_V21_InsertionCover_",),
        "surface_prefixes": (("STRIKE_Road_", "/Game/Phantom/Materials/Production/M_Phantom_Asphalt"),),
    },
}


def load_asset(path):
    loaded = unreal.EditorAssetLibrary.load_asset(path)
    if not loaded:
        raise RuntimeError("V21 required asset is missing: " + path)
    return loaded


def label_of(actor):
    try:
        return actor.get_actor_label()
    except Exception:
        return actor.get_name()


def tags_of(actor):
    try:
        return [str(tag) for tag in (actor.get_editor_property("tags") or [])]
    except Exception:
        return []


def set_tags(actor, *required):
    values = tags_of(actor)
    for value in required:
        if value not in values:
            values.append(value)
    actor.set_editor_property("tags", [unreal.Name(value) for value in values])


def component_of(actor):
    try:
        return actor.get_editor_property("static_mesh_component")
    except Exception:
        components = actor.get_components_by_class(unreal.StaticMeshComponent)
        return components[0] if components else None


def bind_surface(actor, material):
    component = component_of(actor)
    if not component or not component.get_editor_property("static_mesh"):
        return False
    # Slot zero is the ground body.  Additional authored slots (lane marks, trim, decals) remain
    # intact so the PBR correction does not erase gameplay-readable surface details.
    component.set_material(0, material)
    return True


def mesh_height(mesh):
    bounds = mesh.get_bounds()
    return max(1.0, float(bounds.box_extent.z) * 2.0)


def spawn_strike_cover(index, mesh_path, x, y, yaw):
    mesh = load_asset(mesh_path)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(x), float(y), 5.0),
        transient=False,
    )
    if not actor:
        raise RuntimeError("V21 could not spawn Strike insertion cover")
    label = f"STRIKE_V21_InsertionCover_{index:02d}"
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(True)
    scale = 165.0 / mesh_height(mesh)
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    rotation = unreal.Rotator()
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    try:
        origin, extent = actor.get_actor_bounds(False)
        location = actor.get_actor_location()
        location.z += 5.0 - (float(origin.z) - float(extent.z))
        actor.set_actor_location(location, False, False)
    except Exception:
        pass
    set_tags(actor, PRODUCTION_TAG, V21_TAG, label)
    return label


def patch_world(game, rule):
    if not level.load_level(rule["map"]):
        raise RuntimeError("Could not load " + rule["map"])

    removed = []
    surface_changes = []
    anchor = None
    all_actors = list(actors.get_all_level_actors() or [])
    for actor in all_actors:
        actor_label = label_of(actor)
        if anchor is None and isinstance(actor, unreal.PlayerStart):
            anchor = actor
        if any(actor_label.startswith(prefix) for prefix in rule["remove_prefixes"]):
            removed.append(actor_label)
            actors.destroy_actor(actor)

    material_cache = {}
    for actor in list(actors.get_all_level_actors() or []):
        actor_label = label_of(actor)
        for prefix, material_path in rule["surface_prefixes"]:
            if actor_label.startswith(prefix):
                material = material_cache.setdefault(material_path, load_asset(material_path))
                if bind_surface(actor, material):
                    surface_changes.append({"actor": actor_label, "material": material_path})
                break

    added = []
    if game == "phantom-strike":
        cover = (
            ("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_ConcreteBarrier", -8250.0, -620.0, 8.0),
            ("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile", -7900.0, 710.0, -18.0),
            ("/Game/Phantom/Curated/Strike/SM_Strike_StreetProp", -7425.0, -690.0, 72.0),
            ("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_ConcreteBarrier", -7000.0, 650.0, -12.0),
            ("/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate", -6550.0, -720.0, 31.0),
            ("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile", -6125.0, 760.0, 16.0),
        )
        for index, (mesh_path, x, y, yaw) in enumerate(cover):
            added.append(spawn_strike_cover(index, mesh_path, x, y, yaw))

    if not anchor:
        raise RuntimeError(game + " has no PlayerStart to carry its V21 quality marker")
    set_tags(anchor, V21_TAG)

    survivor_labels = [label_of(actor) for actor in (actors.get_all_level_actors() or [])]
    # V21's own cover is intentionally recreated, so only the historical rejected prefixes are
    # forbidden after patching.
    historical_prefixes = tuple(prefix for prefix in rule["remove_prefixes"] if prefix != "STRIKE_V21_InsertionCover_")
    forbidden = [label for label in survivor_labels if any(label.startswith(prefix) for prefix in historical_prefixes)]
    if forbidden:
        raise RuntimeError(game + " still contains rejected V21 composition actors: " + ", ".join(forbidden[:12]))
    if not surface_changes:
        raise RuntimeError(game + " received no V21 production surface bindings")
    if not level.save_current_level():
        raise RuntimeError("Could not save " + rule["map"])

    return {
        "map": rule["map"],
        "removed_count": len(removed),
        "removed": sorted(removed),
        "surface_binding_count": len(surface_changes),
        "surface_bindings": surface_changes,
        "added": added,
        "forbidden_remaining": forbidden,
    }


results = {"revision": "V21", "status": "RUNNING", "patch_tag": V21_TAG, "worlds": {}}
try:
    for game_name, game_rule in RULES.items():
        results["worlds"][game_name] = patch_world(game_name, game_rule)
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V21 PORTFOLIO QUALITY CORRECTION FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V21 PORTFOLIO QUALITY CORRECTION PASS")
