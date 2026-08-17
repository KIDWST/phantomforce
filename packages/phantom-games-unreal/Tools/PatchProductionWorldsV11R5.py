"""Finish the V11 production-world rotation migration and remove failed RTS setpieces."""
from __future__ import annotations

import json
import math
import os
import traceback

import unreal


WORLD_ROOT = '/Game/Phantom/Worlds'
TAG = 'PhantomProductionWorldV11'
SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
REPORT = os.path.join(SAVED, 'PhantomProductionWorldsV11R5.json')
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def actor_bottom(actor):
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def upright_yaw_from_canonical(rotation):
    """Recover intended yaw from the old Python Rotator(0, yaw, 0) mistake.

    Angles outside +/-90 degrees were canonicalized as a 180-degree roll plus a
    complementary yaw during the R4 migration.  Reconstruct the original yaw
    while forcing pitch and roll to zero.
    """
    yaw = float(rotation.yaw)
    roll = float(rotation.roll)
    if abs(roll) < 90.0:
        return yaw
    if abs(abs(yaw) - 180.0) < 0.01:
        return yaw
    return (180.0 - yaw) if yaw >= 0.0 else (-180.0 - yaw)


def set_upright_preserving_bottom(actor, yaw):
    bottom = actor_bottom(actor)
    rotation = unreal.Rotator()
    rotation.roll = 0.0
    rotation.pitch = 0.0
    rotation.yaw = float(yaw)
    actor.set_actor_rotation(rotation, False)
    new_bottom = actor_bottom(actor)
    location = actor.get_actor_location()
    location.z += bottom - new_bottom
    actor.set_actor_location(location, False, False)


def spawn_authored_fill(actor_subsystem, label, mesh_path, location, yaw):
    mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
    if not mesh:
        raise RuntimeError('Missing authored Legends fill asset ' + mesh_path)
    actor = actor_subsystem.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(float(location[0]), float(location[1]), 0.0),
        transient=False,
    )
    if not actor:
        raise RuntimeError('Could not spawn ' + label)
    actor.get_editor_property('static_mesh_component').set_static_mesh(mesh)
    actor.set_actor_label(label)
    raw_height = max(1.0, float(mesh.get_bounds().box_extent.z * 2.0))
    scale = 800.0 / raw_height
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    set_upright_preserving_bottom(actor, yaw)
    actor.set_editor_property('tags', [unreal.Name(TAG), unreal.Name(label)])
    return actor


maps = {
    'cubetown': 'CubeTown_World',
    'phantom-ages': 'PhantomAges_World',
    'phantom-legends': 'PhantomLegends_World',
    'phantom-strike': 'PhantomStrike_World',
}
results = {
    'revision': 'V11R5',
    'mode': 'canonical roll recovery; failed Legends centerpiece removal',
}

try:
    for game_id, map_name in maps.items():
        path = WORLD_ROOT + '/' + map_name
        if not level.load_level(path):
            raise RuntimeError('Could not load ' + path)
        actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        tagged = []
        corrected = []
        removed = []
        for actor in list(actor_subsystem.get_all_level_actors()):
            tags = [str(value) for value in actor.get_editor_property('tags')]
            if TAG not in tags:
                continue
            tagged.append(actor)
            label = actor.get_actor_label()
            if game_id == 'phantom-legends' and (
                label in ('LEG_Blue_CapitalKeep', 'LEG_Red_CapitalKeep')
                or label.startswith('LEG_Blue_Tree_')
                or label.startswith('LEG_Red_Tree_')
            ):
                actor_subsystem.destroy_actor(actor)
                removed.append(label)
                continue
            rotation = actor.get_actor_rotation()
            if abs(float(rotation.roll)) >= 90.0 or abs(float(rotation.pitch)) > 0.01:
                set_upright_preserving_bottom(actor, upright_yaw_from_canonical(rotation))
                corrected.append(label)
        added = []
        if game_id == 'phantom-legends':
            existing = {
                actor.get_actor_label()
                for actor in actor_subsystem.get_all_level_actors()
            }
            assets = (
                '/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A',
                '/Game/Phantom/External/CC0/Aliases/SM_CC0_Barracks',
            )
            for prefix, cx, cy, phase in (
                ('LEG_Blue', -120000.0, -95000.0, 0.0),
                ('LEG_Red', 120000.0, 95000.0, math.pi),
            ):
                for index in range(12):
                    label = f'{prefix}_VillageFill_{index}'
                    if label in existing:
                        continue
                    angle = phase + index * math.tau / 12.0
                    radius = 5650.0 if index % 2 == 0 else 6550.0
                    spawn_authored_fill(
                        actor_subsystem,
                        label,
                        assets[index % len(assets)],
                        (cx + math.cos(angle) * radius, cy + math.sin(angle) * radius),
                        math.degrees(angle) + 90.0,
                    )
                    added.append(label)
        if not level.save_current_level():
            raise RuntimeError('Could not save ' + path)
        results[game_id] = {
            'map': path,
            'tagged_before': len(tagged),
            'canonical_rotations_corrected': len(corrected),
            'removed_count': len(removed),
            'removed': removed,
            'authored_fill_added': added,
        }
    results['status'] = 'PASS'
except Exception as exc:
    results['status'] = 'FAIL'
    results['error'] = str(exc)
    results['traceback'] = traceback.format_exc()
    with open(REPORT, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, indent=2)
    unreal.log_error('PHANTOM V11R5 WORLD PATCH FAILED: ' + str(exc))
    raise

with open(REPORT, 'w', encoding='utf-8') as handle:
    json.dump(results, handle, indent=2)
unreal.log('PHANTOM V11R5 WORLD PATCH PASS')
