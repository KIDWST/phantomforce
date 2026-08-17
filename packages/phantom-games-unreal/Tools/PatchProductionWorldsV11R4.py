"""Correct the V11 production-world pitch/yaw import defect in existing persistent maps."""
from __future__ import annotations
import json
import os
import traceback
import unreal

WORLD_ROOT = '/Game/Phantom/Worlds'
TAG = 'PhantomProductionWorldV11'
SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
REPORT = os.path.join(SAVED, 'PhantomProductionWorldsV11.json')
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def actor_bottom(actor):
    origin, extent = actor.get_actor_bounds(False)
    return float(origin.z - extent.z)


def preserve_bottom_after_rotation(actor, new_rotation, bottom):
    actor.set_actor_rotation(new_rotation, False)
    new_bottom = actor_bottom(actor)
    location = actor.get_actor_location()
    location.z += bottom - new_bottom
    actor.set_actor_location(location, False, False)


def replace_capital_keep(actor, mesh):
    component = actor.get_editor_property('static_mesh_component')
    component.set_static_mesh(mesh)
    actor.set_actor_scale3d(unreal.Vector(1.0, 1.0, 1.0))
    origin, extent = actor.get_actor_bounds(False)
    height = max(1.0, float(extent.z * 2.0))
    scale = 2200.0 / height
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    bottom = actor_bottom(actor)
    location = actor.get_actor_location()
    location.z -= bottom
    actor.set_actor_location(location, False, False)


maps = {
    'cubetown': 'CubeTown_World',
    'phantom-ages': 'PhantomAges_World',
    'phantom-legends': 'PhantomLegends_World',
    'phantom-strike': 'PhantomStrike_World',
}
results = {'revision': 'V11R4', 'mode': 'persistent yaw correction preserving actor ground planes'}
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
            if game_id == 'phantom-ages' and label in ('AGES_RedDragon', 'AGES_BlueDragon'):
                actor_subsystem.destroy_actor(actor)
                removed.append(label)
                continue
            rotation = actor.get_actor_rotation()
            if abs(float(rotation.pitch)) > 0.01:
                bottom = actor_bottom(actor)
                corrected_rotation = unreal.Rotator(float(rotation.roll), 0.0, float(rotation.pitch))
                preserve_bottom_after_rotation(actor, corrected_rotation, bottom)
                corrected.append(label)
        if game_id == 'phantom-legends':
            keep_mesh = unreal.EditorAssetLibrary.load_asset('/Game/Phantom/External/CC0/Aliases/SM_CC0_Keep')
            if not keep_mesh:
                keep_mesh = unreal.EditorAssetLibrary.load_asset('/Game/Phantom/Generated/Legends/V9/Architecture/SM_V9_BlueKeep')
            if not keep_mesh:
                raise RuntimeError('No authored Legends keep replacement is available')
            for actor in tagged:
                if actor.get_actor_label() in ('LEG_Blue_CapitalKeep', 'LEG_Red_CapitalKeep'):
                    replace_capital_keep(actor, keep_mesh)
        if not level.save_current_level():
            raise RuntimeError('Could not save ' + path)
        results[game_id] = {
            'map': path,
            'actors_before': len(tagged),
            'yaw_corrected': len(corrected),
            'removed': removed,
        }
    results['phantom-strike']['spawn'] = [-9000, 0, 260]
    results['phantom-strike']['spawn_safe_cm'] = [3000, 3000]
    results['status'] = 'PASS'
except Exception as exc:
    results['status'] = 'FAIL'
    results['error'] = str(exc)
    results['traceback'] = traceback.format_exc()
    with open(REPORT, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, indent=2)
    unreal.log_error('PHANTOM V11R4 WORLD PATCH FAILED: ' + str(exc))
    raise

with open(REPORT, 'w', encoding='utf-8') as handle:
    json.dump(results, handle, indent=2)
unreal.log('PHANTOM V11R4 WORLD PATCH PASS')
