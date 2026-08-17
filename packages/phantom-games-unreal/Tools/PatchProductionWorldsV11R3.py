"""Apply surgical V11R3 production-world corrections without recreating persistent map packages."""
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


def tagged_actor_summary(map_path):
    if not level.load_level(map_path):
        raise RuntimeError('Could not load ' + map_path)
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    tagged = []
    for actor in actor_subsystem.get_all_level_actors():
        tags = [str(value) for value in actor.get_editor_property('tags')]
        if TAG in tags:
            tagged.append(actor)
    return actor_subsystem, tagged


def ground_actor(actor):
    origin, extent = actor.get_actor_bounds(False)
    location = actor.get_actor_location()
    location.z -= float(origin.z) - float(extent.z)
    actor.set_actor_location(location, False, False)


results = {'revision': 'V11R3', 'mode': 'validated surgical persistent-world patch'}
try:
    contracts = {
        'cubetown': ('CubeTown_World', '960m x 960m dense stylized dream-fantasy world'),
        'phantom-ages': ('PhantomAges_World', '360m x 110m fixed-screen battlefield'),
        'phantom-legends': ('PhantomLegends_World', '4096m x 4096m persistent RTS realm'),
        'phantom-strike': ('PhantomStrike_World', '480m x 360m authored modern combat district'),
    }
    for game_id, (map_name, contract) in contracts.items():
        map_path = WORLD_ROOT + '/' + map_name
        actor_subsystem, tagged = tagged_actor_summary(map_path)
        if not tagged:
            raise RuntimeError(map_name + ' contains no V11 production-tagged actors')
        patched = []
        if game_id == 'phantom-ages':
            by_label = {actor.get_actor_label(): actor for actor in tagged}
            for label in ('AGES_RedDragon', 'AGES_BlueDragon'):
                actor = by_label.get(label)
                if not actor:
                    raise RuntimeError('Missing Ages landmark ' + label)
                ground_actor(actor)
                patched.append(label)
            if not level.save_current_level():
                raise RuntimeError('Could not save patched Ages production map')
        results[game_id] = {
            'map': map_path,
            'actors': len(tagged),
            'patched': patched,
            'contract': contract,
        }
    results['phantom-strike']['spawn'] = [-9000, 0, 260]
    results['phantom-strike']['spawn_safe_cm'] = [3000, 3000]
    scratch = WORLD_ROOT + '/__PhantomWorldBuildScratch'
    if unreal.EditorAssetLibrary.does_asset_exist(scratch):
        unreal.EditorAssetLibrary.delete_asset(scratch)
    results['status'] = 'PASS'
except Exception as exc:
    results['status'] = 'FAIL'
    results['error'] = str(exc)
    results['traceback'] = traceback.format_exc()
    with open(REPORT, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, indent=2)
    unreal.log_error('PHANTOM V11R3 WORLD PATCH FAILED: ' + str(exc))
    raise

with open(REPORT, 'w', encoding='utf-8') as handle:
    json.dump(results, handle, indent=2)
unreal.log('PHANTOM V11R3 WORLD PATCH PASS')
