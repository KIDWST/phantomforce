"""PhantomPlay V20 composition correction.

Older additive passes stacked repeated surface meshes and promotional cards over the authored
worlds. This pass is deliberately subtractive: it removes the known screen-filling layers while
preserving real terrain, structures, encounters, gameplay actors, and the tighter V19 set dressing.
It is idempotent and records every removal for release evidence.
"""
from __future__ import annotations

import json
import os
import traceback

import unreal


WORLD_ROOT = "/Game/Phantom/Worlds"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "PhantomPortfolioWorldsV20.json")
V20_TAG = "PhantomPortfolioWorldV20"

level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors:
    raise RuntimeError("V20 portfolio correction requires Unreal editor subsystems")


RULES = {
    "cubetown": {
        "map": WORLD_ROOT + "/CubeTown_World",
        "prefixes": ("CT_V11R7_MainRoad_",),
        "exact": (),
    },
    "phantom-ages": {
        "map": WORLD_ROOT + "/PhantomAges_World",
        "prefixes": ("AGES_V11R10_",),
        "exact": ("AGES_V19_Horizon",),
    },
    "phantom-legends": {
        "map": WORLD_ROOT + "/PhantomLegends_World",
        "prefixes": ("LEG_V11R7_Plaza_",),
        "exact": ("LEG_V19_Horizon", "LEG_BlueGolem", "LEG_RedGolem"),
    },
    "phantom-strike": {
        "map": WORLD_ROOT + "/PhantomStrike_World",
        "prefixes": (
            "STRIKE_V11R10_Wear_",
            "STRIKE_V11R10_Repair_",
            "STRIKE_V11R10_Shoulder_",
        ),
        "exact": (),
    },
}


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


def should_remove(label, rule):
    return label in rule["exact"] or any(label.startswith(prefix) for prefix in rule["prefixes"])


def mark_world(anchor):
    tags = tags_of(anchor)
    if V20_TAG not in tags:
        tags.append(V20_TAG)
        anchor.set_editor_property("tags", [unreal.Name(tag) for tag in tags])


def patch_world(game, rule):
    path = rule["map"]
    if not level.load_level(path):
        raise RuntimeError("Could not load " + path)

    removed = []
    retained = []
    anchor = None
    for actor in list(actors.get_all_level_actors() or []):
        label = label_of(actor)
        if anchor is None and isinstance(actor, unreal.PlayerStart):
            anchor = actor
        if should_remove(label, rule):
            removed.append(label)
            actors.destroy_actor(actor)
        else:
            retained.append(label)

    if anchor:
        mark_world(anchor)
    else:
        raise RuntimeError(game + " has no PlayerStart to carry its V20 composition marker")

    survivors = [label_of(actor) for actor in (actors.get_all_level_actors() or [])]
    forbidden = [label for label in survivors if should_remove(label, rule)]
    if forbidden:
        raise RuntimeError(game + " still contains rejected composition actors: " + ", ".join(forbidden[:12]))
    if not level.save_current_level():
        raise RuntimeError("Could not save " + path)

    return {
        "map": path,
        "removed_count": len(removed),
        "removed": sorted(removed),
        "retained_count": len(retained),
        "forbidden_remaining": forbidden,
    }


results = {"revision": "V20", "status": "RUNNING", "patch_tag": V20_TAG, "worlds": {}}
try:
    for game, rule in RULES.items():
        results["worlds"][game] = patch_world(game, rule)
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("PHANTOM V20 PORTFOLIO CORRECTION FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("PHANTOM V20 PORTFOLIO CORRECTION PASS")
