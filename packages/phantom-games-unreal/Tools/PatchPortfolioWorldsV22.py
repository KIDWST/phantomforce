"""V22 first-frame art-direction correction for all four PhantomPlay worlds.

The pass replaces stale additive dressing with bounded, theme-correct foreground composition.
It is idempotent, keeps gameplay lanes clear, and records every change for the Shipping gate.
"""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal


WORLD_ROOT = "/Game/Phantom/Worlds"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomPortfolioWorldsV22.json")
PRODUCTION_TAG = "PhantomProductionWorldV11"
V22_TAG = "PhantomPortfolioWorldV22"
CONTAMINATED_FAB_SLOTS = {
    f"LEG_{faction}_Inner_{gx}_{gy}"
    for faction in ("Blue", "Red")
    for gx, gy in ((-1, -2), (2, -2), (-2, -1), (1, -1), (-1, 1), (2, 1), (-2, 2), (1, 2))
}

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("V22 portfolio correction requires Unreal editor subsystems")


WORLDS = {
    "cubetown": (WORLD_ROOT + "/CubeTown_World", ("CT_V22_",)),
    "phantom-ages": (
        WORLD_ROOT + "/PhantomAges_World",
        ("AGES_V13_Foreground_", "AGES_V19_Frontline_", "AGES_V22_"),
    ),
    "phantom-legends": (
        WORLD_ROOT + "/PhantomLegends_World",
        (
            "LEG_V11R7_Road_",
            "LEG_V22_",
            # This house sat directly between the opening strategy camera and
            # its command pivot, turning the lower third into an opaque roof.
            # Keep the authored city density while reserving one clean camera lane.
            "LEG_Blue_Inner_0_1",
        ),
    ),
    "phantom-strike": (
        WORLD_ROOT + "/PhantomStrike_World",
        ("STRIKE_V19_InsertionCover_", "STRIKE_V21_InsertionCover_", "STRIKE_V22_"),
    ),
}


def label_of(actor):
    try:
        return actor.get_actor_label()
    except Exception:
        return actor.get_name()


def load(path):
    result = unreal.EditorAssetLibrary.load_asset(path)
    if not result:
        raise RuntimeError("V22 required asset is missing: " + path)
    return result


def component_of(actor):
    try:
        return actor.get_editor_property("static_mesh_component")
    except Exception:
        found = actor.get_components_by_class(unreal.StaticMeshComponent)
        return found[0] if found else None


def tags_of(actor):
    try:
        return [str(tag) for tag in (actor.get_editor_property("tags") or [])]
    except Exception:
        return []


def tag(actor, label):
    values = tags_of(actor)
    for value in (PRODUCTION_TAG, V22_TAG, label):
        if value not in values:
            values.append(value)
    actor.set_editor_property("tags", [unreal.Name(value) for value in values])


def spawn(label, mesh_path, location, target_height, yaw):
    mesh = load(mesh_path)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("V22 could not spawn " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(True)
    bounds = mesh.get_bounds()
    raw_height = max(1.0, float(bounds.box_extent.z) * 2.0)
    scale = max(0.025, min(40.0, float(target_height) / raw_height))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
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
    tag(actor, label)
    return label


def spawn_sized(label, mesh_path, location, target_longest_dimension, yaw, cast_shadow=False):
    """Place low-profile dressing by footprint so roads cannot inflate into slabs."""
    mesh = load(mesh_path)
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), float(location[2])),
        transient=False,
    )
    if not actor:
        raise RuntimeError("V22 could not spawn " + label)
    actor.set_actor_label(label)
    component = component_of(actor)
    component.set_static_mesh(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(bool(cast_shadow))
    size = mesh.get_bounds().box_extent * 2.0
    raw_dimension = max(1.0, float(max(size.x, size.y, size.z)))
    scale = max(0.025, min(40.0, float(target_longest_dimension) / raw_dimension))
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
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
    tag(actor, label)
    return label


def replace_legends_rejected_aliases():
    """Remove recovered aliases whose cooked geometry does not match their names.

    Preserve each actor's authored footprint and ground contact while swapping in the
    verified bounded rock/tree/building assets. This also cleans older V11/V13 capital
    dressing, not only actors introduced by this pass. Recovered PineTrees and Fab
    Barracks payloads both contained translucent human-head geometry in packaged builds.
    The barracks replacement uses an explicit 720 cm cap so contaminated source bounds
    can never be transferred to the verified building.
    """
    replacements = {
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.": (
            load("/Game/Phantom/Generated/Common/SM_RockCluster_A"), None
        ),
        "/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.": (
            load("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A"), 520.0
        ),
        "/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.": (
            load("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A"), 520.0
        ),
        "/Game/Phantom/Generated/Common/SM_StorybookTree_A.": (
            load("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A"), 520.0
        ),
        "/Game/Phantom/Generated/Common/SM_StorybookTree_B.": (
            load("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A"), 520.0
        ),
        "/Game/Phantom/Curated/Fab/Legends/SM_Fab_Barracks.": (
            load("/Game/Phantom/Curated/Legends/SM_Legends_Barracks"), 720.0
        ),
    }
    replaced = []
    for actor in list(actors.get_all_level_actors() or []):
        actor_label = label_of(actor)
        if actor_label in CONTAMINATED_FAB_SLOTS:
            actors.destroy_actor(actor)
            replaced.append(actor_label + ":removed")
            continue
        component = component_of(actor)
        if not component:
            continue
        current_mesh = component.get_editor_property("static_mesh")
        current_path = current_mesh.get_path_name() if current_mesh else ""
        legacy_tree_slot = actor_label.startswith("LEG_V11R7_CapitalDressing_") or actor_label.startswith("LEG_V13_CapitalRing_")
        if legacy_tree_slot and "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A." in current_path:
            tree_bounds = current_mesh.get_bounds()
            tree_size = tree_bounds.box_extent * 2.0
            tree_raw_dimension = max(1.0, float(max(tree_size.x, tree_size.y, tree_size.z)))
            try:
                origin, extent = actor.get_actor_bounds(False)
                ground_z = float(origin.z) - float(extent.z)
            except Exception:
                ground_z = float(actor.get_actor_location().z)
            component.set_static_mesh(current_mesh)
            tree_scale = 520.0 / tree_raw_dimension
            actor.set_actor_scale3d(unreal.Vector(tree_scale, tree_scale, tree_scale))
            try:
                origin, extent = actor.get_actor_bounds(False)
                location = actor.get_actor_location()
                location.z += ground_z - (float(origin.z) - float(extent.z))
                actor.set_actor_location(location, False, False)
            except Exception:
                pass
            replaced.append(actor_label + ":tree-normalized")
            continue
        replacement_entry = next((entry for rejected, entry in replacements.items() if rejected in current_path), None)
        if not replacement_entry:
            continue
        replacement, target_dimension_cap = replacement_entry
        replacement_bounds = replacement.get_bounds()
        replacement_size = replacement_bounds.box_extent * 2.0
        raw_dimension = max(1.0, float(max(replacement_size.x, replacement_size.y, replacement_size.z)))
        try:
            origin, extent = actor.get_actor_bounds(False)
            measured_dimension = max(80.0, float(max(extent.x, extent.y, extent.z)) * 2.0)
            target_dimension = min(measured_dimension, target_dimension_cap) if target_dimension_cap else measured_dimension
            ground_z = float(origin.z) - float(extent.z)
        except Exception:
            target_dimension = 280.0
            ground_z = float(actor.get_actor_location().z)
        component.set_static_mesh(replacement)
        scale = max(0.025, min(40.0, target_dimension / raw_dimension))
        actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
        try:
            origin, extent = actor.get_actor_bounds(False)
            location = actor.get_actor_location()
            location.z += ground_z - (float(origin.z) - float(extent.z))
            actor.set_actor_location(location, False, False)
        except Exception:
            pass
        replaced.append(label_of(actor))
    return sorted(replaced)


def dress_cubetown():
    """Build a readable adventure approach instead of filling the village with noise.

    The center 15 m lane remains open for movement and combat. Distinct prop clusters on each
    side give the wider camera foreground, midground, and destination reads without becoming a
    forest of repeated houses.
    """
    placements = (
        ("Lantern_L0", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (-1450, -10100, 4), 310, 15),
        ("Lantern_R0", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (1450, -9900, 4), 310, -15),
        ("Flower_L0", "/Game/Phantom/Generated/Common/SM_FlowerPatch_A", (-2050, -9600, 4), 95, 18),
        ("Flower_R0", "/Game/Phantom/Generated/Common/SM_FlowerPatch_A", (2250, -9400, 4), 95, -22),
        ("Bench_L0", "/Game/Phantom/Generated/Common/SM_Bench_A", (-1850, -8750, 4), 125, 34),
        ("Cart_R0", "/Game/Phantom/External/Quaternius/MedievalVillage/Cart", (2300, -8550, 4), 285, -24),
        ("Sign_L0", "/Game/Phantom/Generated/Cubetown/SM_CubetownSignpost", (-1250, -8100, 4), 245, 28),
        ("Bush_R0", "/Game/Phantom/Generated/Common/SM_Bush_A", (1700, -7850, 4), 165, 11),
        ("Market_L0", "/Game/Phantom/Generated/Cubetown/SM_CubetownMarketStall", (-2850, -7300, 4), 430, 22),
        ("Market_R0", "/Game/Phantom/Generated/Cubetown/SM_CubetownMarketStall", (2950, -7000, 4), 430, -32),
        ("Crates_L0", "/Game/Phantom/Generated/Common/SM_Crate_A", (-2250, -6800, 4), 120, 8),
        ("Barrels_R0", "/Game/Phantom/Generated/Common/SM_Barrel_A", (2250, -6500, 4), 125, -8),
        ("Lantern_L1", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (-1350, -6200, 4), 310, 8),
        ("Lantern_R1", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (1350, -6050, 4), 310, -8),
        ("Well_L0", "/Game/Phantom/Generated/Common/SM_Well_A", (-2700, -5600, 4), 300, 0),
        ("Garden_R0", "/Game/Phantom/Generated/Cubetown/SM_CubetownGardenArch", (2750, -5350, 4), 420, -20),
        ("Rock_L0", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream", (-1900, -5100, 4), 190, 27),
        ("Flowers_R1", "/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A", (1900, -4950, 4), 120, -16),
        ("Tree_L0", "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A", (-3400, -5900, 4), 620, 18),
        ("Tree_R0", "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A", (3550, -6200, 4), 650, -21),
    )
    return [spawn(f"CT_V22_Adventure_{name}", asset, location, height, yaw)
            for name, asset, location, height, yaw in placements]


def dress_ages():
    placements = (
        ("BlueBanner_0", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerBlue", (-11800, -9700, 4), 520, 14),
        ("BlueBanner_1", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerBlue", (-7600, -8500, 4), 520, -8),
        ("RedBanner_0", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerRed", (11800, -9700, 4), 520, -14),
        ("RedBanner_1", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_WarBannerRed", (7600, -8500, 4), 520, 8),
        ("BlueBallista", "/Game/Phantom/Generated/Ages/Siege/SM_AgesBallista", (-9800, -6900, 4), 440, 26),
        ("RedBallista", "/Game/Phantom/Generated/Ages/Siege/SM_AgesBallista", (9800, -6900, 4), 440, 154),
        ("BlueTrebuchet", "/Game/Phantom/Generated/Ages/Siege/SM_AgesTrebuchet", (-12800, -4300, 4), 390, 34),
        ("RedTrebuchet", "/Game/Phantom/Generated/Ages/Siege/SM_AgesTrebuchet", (12800, -4300, 4), 390, 146),
        ("Ruin_L", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_BattlefieldRuin", (-5800, -6300, 4), 420, 18),
        ("Ruin_R", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_BattlefieldRuin", (5900, -6100, 4), 420, -22),
        ("Wreck_L", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_SiegeWreck", (-4300, -9400, 4), 145, 12),
        ("Wreck_R", "/Game/Phantom/Generated/Ages/V10/Setpieces/SM_V10_SiegeWreck", (4400, -9200, 4), 145, -18),
        ("Fire_L0", "/Game/Phantom/External/Quaternius/MedievalVillage/Bonfire_Lit", (-14200, -7500, 4), 290, 0),
        ("Fire_R0", "/Game/Phantom/External/Quaternius/MedievalVillage/Bonfire_Lit", (14200, -7400, 4), 290, 0),
        ("Cart_L0", "/Game/Phantom/External/Quaternius/MedievalVillage/Cart", (-8500, -10900, 4), 330, 24),
        ("Cart_R0", "/Game/Phantom/External/Quaternius/MedievalVillage/Cart", (8600, -10700, 4), 330, -24),
        ("Supplies_L", "/Game/Phantom/Generated/Common/SM_Crate_A", (-6900, -10100, 4), 145, 11),
        ("Supplies_R", "/Game/Phantom/Generated/Common/SM_Barrel_A", (7000, -10000, 4), 145, -11),
        ("Rock_L", "/Game/Phantom/Generated/Common/SM_RockCluster_A", (-3500, -7200, 4), 260, 17),
        ("Rock_R", "/Game/Phantom/Generated/Common/SM_RockCluster_A", (3600, -7000, 4), 260, -17),
    )
    return [spawn(f"AGES_V22_WarCamp_{name}", asset, location, height, yaw)
            for name, asset, location, height, yaw in placements]


def dress_legends():
    """Give the capital a detailed, playable approach without stacking more buildings."""
    placements = (
        ("Stall_W", "/Game/Phantom/Generated/Cubetown/SM_CubetownMarketStall", (-123100, -97300, 3), 350, 26),
        ("Stall_E", "/Game/Phantom/Generated/Cubetown/SM_CubetownMarketStall", (-116900, -97200, 3), 350, 154),
        ("Well_W", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Well", (-122250, -93200, 3), 250, 0),
        ("Well_E", "/Game/Phantom/External/CC0/Aliases/SM_CC0_Well", (-117700, -93100, 3), 250, 0),
        ("Supplies_SW", "/Game/Phantom/Generated/Common/SM_Crate_A", (-123500, -100500, 3), 115, 26),
        ("Supplies_SE", "/Game/Phantom/Generated/Common/SM_Barrel_A", (-116600, -100200, 3), 115, -28),
        ("Bench_W", "/Game/Phantom/Generated/Common/SM_Bench_A", (-121650, -96100, 3), 95, 8),
        ("Bench_E", "/Game/Phantom/Generated/Common/SM_Bench_A", (-118350, -96000, 3), 95, 172),
        ("Crates_W", "/Game/Phantom/Generated/Common/SM_Crate_A", (-122750, -96800, 3), 105, 12),
        ("Barrels_E", "/Game/Phantom/Generated/Common/SM_Barrel_A", (-117250, -96700, 3), 105, -12),
        ("Lantern_W", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (-121900, -94400, 3), 265, 12),
        ("Lantern_E", "/Game/Phantom/Generated/Common/SM_LanternPost_A", (-118100, -94300, 3), 265, -12),
        ("Bush_W", "/Game/Phantom/Generated/Common/SM_Bush_A", (-123450, -94000, 3), 135, 24),
        ("Bush_E", "/Game/Phantom/Generated/Common/SM_Bush_A", (-116550, -93900, 3), 135, -24),
        ("Rock_W", "/Game/Phantom/Generated/Common/SM_RockCluster_A", (-124000, -98000, 3), 165, 24),
        ("Rock_E", "/Game/Phantom/Generated/Common/SM_RockCluster_A", (-116000, -97900, 3), 165, -24),
    )
    added = [spawn(f"LEG_V22_CapitalLife_{name}", asset, location, height, yaw)
             for name, asset, location, height, yaw in placements]
    # Keep the camera-to-command-pivot lane open. A former experimental
    # Approach* cluster used assets with mismatched cooked bounds and obscured
    # the lower third despite looking bounded in editor audits.
    return added


def dress_strike():
    placements = (
        ("Barrier_L0", "/Game/Phantom/Generated/Strike/V10/Props/SM_V10_ConcreteBarrier", (-7200, -1900, 5), 165, 8),
        ("Barrier_R0", "/Game/Phantom/Generated/Strike/V10/Props/SM_V10_ConcreteBarrier", (-7100, 1900, 5), 165, -8),
        ("Sandbags_L0", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Sandbags", (-6200, -2200, 5), 150, 18),
        ("Sandbags_R0", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Sandbags", (-6100, 2250, 5), 150, -18),
        ("Container_L", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Container", (-5000, -2550, 5), 310, 4),
        ("Container_R", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Container", (-4850, 2600, 5), 310, 176),
        ("Rubble_L", "/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile", (-3900, -1750, 5), 155, 21),
        ("Rubble_R", "/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile", (-3800, 1800, 5), 155, -21),
        ("Wreck_L", "/Game/Phantom/Generated/Strike/Environment/SM_WreckCar_A", (-2700, -2650, 5), 215, 28),
        ("Wreck_R", "/Game/Phantom/Generated/Strike/Environment/SM_WreckCar_B", (-2550, 2700, 5), 215, 152),
        ("Checkpoint", "/Game/Phantom/Generated/Strike/V10/Props/SM_V10_Checkpoint", (-1050, 0, 5), 420, 90),
        ("Kiosk_L", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Kiosk", (-900, -2900, 5), 280, 18),
        ("Dumpster_R", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Dumpster", (-750, 2920, 5), 180, -14),
        ("Pallet_L", "/Game/Phantom/Generated/Strike/Props/SM_Strike_Pallet", (850, -2100, 5), 120, 8),
        ("Roadblock_R", "/Game/Phantom/Generated/Strike/Props/SM_Strike_RoadBarrier", (900, 2150, 5), 150, -8),
        ("Crates_L", "/Game/Phantom/Generated/Common/SM_Crate_A", (2100, -1800, 5), 135, 16),
        ("Barrels_R", "/Game/Phantom/Generated/Common/SM_Barrel_A", (2200, 1850, 5), 135, -16),
        ("Barrier_Far", "/Game/Phantom/Generated/Strike/Environment/SM_TacticalBarrier", (3300, 0, 5), 190, 90),
    )
    return [spawn(f"STRIKE_V22_TacticalCover_{name}", asset, location, height, yaw)
            for name, asset, location, height, yaw in placements]


def patch(game, path, remove_prefixes):
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)
    removed = []
    anchor = None
    for actor in list(actors.get_all_level_actors() or []):
        actor_label = label_of(actor)
        if anchor is None and isinstance(actor, unreal.PlayerStart):
            anchor = actor
        if any(actor_label.startswith(prefix) for prefix in remove_prefixes):
            removed.append(actor_label)
            actors.destroy_actor(actor)
    if not anchor:
        raise RuntimeError(game + " has no PlayerStart for its V22 marker")
    tag(anchor, V22_TAG)
    replaced = replace_legends_rejected_aliases() if game == "phantom-legends" else []
    added = []
    if game == "cubetown":
        added = dress_cubetown()
    elif game == "phantom-ages":
        added = dress_ages()
    elif game == "phantom-legends":
        added = dress_legends()
    elif game == "phantom-strike":
        added = dress_strike()
    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)
    return {
        "map": path,
        "removed": sorted(removed),
        "removed_count": len(removed),
        "replaced_rejected_aliases": replaced,
        "replaced_rejected_alias_count": len(replaced),
        "added": added,
    }


results = {"revision": "V22", "status": "RUNNING", "worlds": {}}
try:
    for game_name, (world_path, prefixes) in WORLDS.items():
        results["worlds"][game_name] = patch(game_name, world_path, prefixes)
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V22 PORTFOLIO CORRECTION FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V22 PORTFOLIO CORRECTION PASS")
