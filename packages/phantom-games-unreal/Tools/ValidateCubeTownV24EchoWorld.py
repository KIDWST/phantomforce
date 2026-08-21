"""Fail-closed validation for the authored CubeTown V24 overworld."""
from __future__ import annotations

import json
import math
import os

import unreal


WORLD = "/Game/Phantom/Worlds/CubeTown_World"
TAG = "PhantomProductionWorldV24"
REPORT = os.path.join(
    os.path.abspath(unreal.Paths.project_saved_dir()),
    "CubeTownV24EchoWorldValidation.json",
)
REGIONS = (
    "Heartstone",
    "MoonmossMarsh",
    "SunpetalCoast",
    "DeepForest",
    "StarfallQuarry",
    "FrostbloomHeights",
    "CrimsonGrove",
    "EmberbloomPhantomite",
)

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def component_of(actor):
    try:
        return actor.get_editor_property("static_mesh_component")
    except Exception:
        components = actor.get_components_by_class(unreal.StaticMeshComponent)
        return components[0] if components else None


def validate():
    if not level.load_level(WORLD):
        raise RuntimeError("Could not load " + WORLD)

    authored = [actor for actor in (actors.get_all_level_actors() or []) if actor.actor_has_tag(TAG)]
    roads = [actor for actor in authored if actor.actor_has_tag("CubeTownV24.Road")]
    landmarks = [actor for actor in authored if actor.actor_has_tag("CubeTownV24.Landmark")]
    terrain = [actor for actor in authored if actor.actor_has_tag("CubeTownV24.Terrain")]
    density = [actor for actor in authored if actor.actor_has_tag("CubeTownV24.Density")]
    quarry_floor = [actor for actor in authored if actor.actor_has_tag("CubeTownV24.QuarryFloor")]
    base_terrain = [actor for actor in (actors.get_all_level_actors() or []) if actor.get_actor_label() == "CT_Terrain_Cube_11"]
    base_size = [0.0, 0.0]
    if len(base_terrain) == 1:
        _origin, extent = base_terrain[0].get_actor_bounds(False)
        base_size = [float(extent.x) * 2.0, float(extent.y) * 2.0]

    cells = {(gx, gy): 0 for gx in range(-5, 5) for gy in range(-5, 5)}
    for actor in density:
        location = actor.get_actor_location()
        gx = max(-5, min(4, int(math.floor(float(location.x) / 10000.0))))
        gy = max(-5, min(4, int(math.floor(float(location.y) / 10000.0))))
        cells[(gx, gy)] += 1

    region_counts = {
        region: sum(1 for actor in authored if actor.actor_has_tag(f"CubeTownV24.Region.{region}"))
        for region in REGIONS
    }
    empty_cells = [f"{gx},{gy}" for (gx, gy), count in cells.items() if count < 6]
    locations = [actor.get_actor_location() for actor in density]
    edge_reach = {
        "west": min((float(p.x) for p in locations), default=0.0),
        "east": max((float(p.x) for p in locations), default=0.0),
        "south": min((float(p.y) for p in locations), default=0.0),
        "north": max((float(p.y) for p in locations), default=0.0),
    }

    engine_basic_shapes = []
    legacy_visuals = []
    forbidden_road_surfaces = []
    stretched_district_surfaces = []
    for actor in authored:
        component = component_of(actor)
        mesh = component.get_editor_property("static_mesh") if component else None
        path = mesh.get_path_name() if mesh else ""
        if path.startswith("/Engine/BasicShapes/"):
            engine_basic_shapes.append(actor.get_actor_label())
        if "SM_StorybookTree" in path or "SM_CC0_Tree_B" in path:
            legacy_visuals.append(f"{actor.get_actor_label()}={path}")
        if actor.get_actor_label().startswith("CT_V24_RoadSurface_"):
            forbidden_road_surfaces.append(actor.get_actor_label())
        if actor.actor_has_tag("CubeTownV24.DistrictSurface") and actor.get_actor_label() != "CT_V24_SunpetalBeach":
            _origin, extent = actor.get_actor_bounds(False)
            short_side = max(1.0, min(float(extent.x), float(extent.y)))
            aspect = max(float(extent.x), float(extent.y)) / short_side
            if aspect > 4.0:
                stretched_district_surfaces.append(f"{actor.get_actor_label()}={aspect:.2f}")

    failures = []
    if len(authored) < 1800:
        failures.append(f"only {len(authored)} V24 actors; expected at least 1800")
    if len(roads) < 550:
        failures.append(f"only {len(roads)} road pieces; expected at least 550")
    if len(landmarks) < 12:
        failures.append(f"only {len(landmarks)} landmarks; expected at least 12")
    if len(quarry_floor) < 30:
        failures.append(f"only {len(quarry_floor)} quarry-floor actors; expected at least 30")
    if terrain:
        failures.append(f"found {len(terrain)} obsolete terrain overlay tiles; expected zero")
    if len(base_terrain) != 1 or base_size[0] < 94000 or base_size[1] < 94000:
        failures.append(f"seamless terrain base is missing or undersized: count={len(base_terrain)} size={base_size}")
    if empty_cells:
        failures.append("under-populated 100m cells: " + ", ".join(empty_cells))
    sparse_regions = [f"{region}={count}" for region, count in region_counts.items() if count < 25]
    if sparse_regions:
        failures.append("under-populated regions: " + ", ".join(sparse_regions))
    if edge_reach["west"] > -45000 or edge_reach["east"] < 45000 or edge_reach["south"] > -45000 or edge_reach["north"] < 45000:
        failures.append("authored population does not reach every world edge")
    if engine_basic_shapes:
        failures.append("V24 actors use forbidden Engine BasicShapes: " + ", ".join(engine_basic_shapes[:20]))
    if legacy_visuals:
        failures.append("V24 actors use rejected legacy visuals: " + ", ".join(legacy_visuals[:20]))
    if forbidden_road_surfaces:
        failures.append("V24 contains rejected stretched road surfaces: " + ", ".join(forbidden_road_surfaces[:20]))
    if stretched_district_surfaces:
        failures.append("V24 contains extreme-aspect district surfaces: " + ", ".join(stretched_district_surfaces[:20]))

    result = {
        "schema": 24,
        "status": "FAIL" if failures else "PASS",
        "map": WORLD,
        "playable_area_square_km": 0.8836,
        "authored_actors": len(authored),
        "road_pieces": len(roads),
        "landmarks": len(landmarks),
        "quarry_floor_actors": len(quarry_floor),
        "terrain_overlay_tiles": len(terrain),
        "seamless_terrain_base_count": len(base_terrain),
        "seamless_terrain_base_size_cm": base_size,
        "density_cells": len(cells),
        "minimum_density_per_100m_cell": min(cells.values()) if cells else 0,
        "region_counts": region_counts,
        "edge_reach_cm": edge_reach,
        "forbidden_basic_shapes": engine_basic_shapes,
        "rejected_legacy_visuals": legacy_visuals,
        "rejected_road_surfaces": forbidden_road_surfaces,
        "stretched_district_surfaces": stretched_district_surfaces,
        "failures": failures,
    }
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    if failures:
        raise RuntimeError("; ".join(failures))
    unreal.log("CUBETOWN V24 ECHO WORLD VALIDATION PASS " + json.dumps(result))


try:
    validate()
except Exception as exc:
    if not os.path.isfile(REPORT):
        with open(REPORT, "w", encoding="utf-8") as handle:
            json.dump({"schema": 24, "status": "FAIL", "error": str(exc)}, handle, indent=2)
    raise
