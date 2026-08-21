"""Hard V23 persistent-world gate.

This is deliberately stricter than the old actor-count gate. It verifies *where* useful content is,
rejects Engine BasicShapes in persistent maps, rejects a blocked PhantomStrike spawn, and requires
large amounts of imported/non-generated production art in the hero/start areas.
"""
from __future__ import annotations
import json, math, os, traceback
import unreal

SAVED=os.path.abspath(unreal.Paths.project_saved_dir())
REPORT=os.path.join(SAVED,'PhantomProductionWorldValidationV11.json')
level=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actorsys=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actorsys:raise RuntimeError('V23 validation requires editor subsystems')

PATCH_TAG='PhantomPortfolioWorldV13'
V17_TAG='PhantomProductionWorldV17'
V19_TAG='PhantomPortfolioWorldV19'
V20_TAG='PhantomPortfolioWorldV20'
V21_TAG='PhantomPortfolioWorldV21'
V22_TAG='PhantomPortfolioWorldV22'
V23_TAG='PhantomProductionWorldV23'
CONTAMINATED_FAB_SLOTS=tuple(
    f'LEG_{faction}_Inner_{gx}_{gy}'
    for faction in ('Blue','Red')
    for gx,gy in ((-1,-2),(2,-2),(-2,-1),(1,-1),(-1,1),(2,1),(-2,2),(1,2))
)
# V22 fully replaces Ages' old repeated V13 foreground scatter with its bounded war-camp set.
V13_MIN={'cubetown':0,'phantom-ages':0,'phantom-legends':53,'phantom-strike':43}
V19_MIN={'cubetown':0,'phantom-ages':0,'phantom-legends':0,'phantom-strike':0}
V22_MIN={'cubetown':0,'phantom-ages':20,'phantom-legends':16,'phantom-strike':18}
V23_MIN={'cubetown':150,'phantom-ages':0,'phantom-legends':0,'phantom-strike':0}

REJECTED_COMPOSITION={
 'cubetown':(('CT_V11R7_MainRoad_','CT_Road_12m_'),()),
 'phantom-ages':(('AGES_V11R10_','AGES_V13_Foreground_','AGES_V19_Frontline_'),('AGES_V19_Horizon',)),
 'phantom-legends':(
     ('LEG_V11R7_Plaza_','LEG_V19_CommandRing_','LEG_V22_CapitalLife_Approach'),
     ('LEG_V19_Horizon','LEG_BlueGolem','LEG_RedGolem','LEG_Blue_Inner_0_1')+CONTAMINATED_FAB_SLOTS,
 ),
 'phantom-strike':(('STRIKE_V11R10_Wear_','STRIKE_V11R10_Repair_','STRIKE_V11R10_Shoulder_','STRIKE_V19_InsertionCover_','STRIKE_V21_InsertionCover_'),()),
}

specs={
 'cubetown':('/Game/Phantom/Worlds/CubeTown_World',(0.,-10500.,0.),17000.,145,130,10),
 'phantom-ages':('/Game/Phantom/Worlds/PhantomAges_World',(0.,0.,0.),20000.,35,25,18),
 'phantom-legends':('/Game/Phantom/Worlds/PhantomLegends_World',(-120000.,-95000.,0.),26000.,450,100,70),
 'phantom-strike':('/Game/Phantom/Worlds/PhantomStrike_World',(-9000.,0.,0.),20000.,400,140,90),
}

def label(a):
    try:return a.get_actor_label()
    except Exception:return a.get_name()

def comp(a):
    try:return a.get_editor_property('static_mesh_component')
    except Exception:
        try:
            cs=a.get_components_by_class(unreal.StaticMeshComponent)
            return cs[0] if cs else None
        except Exception:return None

def mesh_path(a):
    c=comp(a)
    if not c:return ''
    try:
        m=c.get_editor_property('static_mesh')
        return m.get_path_name() if m else ''
    except Exception:return ''

def mat_paths(a):
    c=comp(a);out=[]
    if not c:return out
    try:
        for i in range(c.get_num_materials()):
            m=c.get_material(i)
            if m:out.append(m.get_path_name())
    except Exception:pass
    return out

def dist2d(a,p):
    q=a.get_actor_location();return math.hypot(float(q.x)-p[0],float(q.y)-p[1])

def dims(a):
    try:
        o,e=a.get_actor_bounds(False);return (float(e.x)*2,float(e.y)*2,float(e.z)*2)
    except Exception:return (0,0,0)

def intersects_spawn(a,cx,cy,hx=1500,hy=1500):
    try:
        o,e=a.get_actor_bounds(False)
        return abs(float(o.x)-cx) <= float(e.x)+hx and abs(float(o.y)-cy) <= float(e.y)+hy
    except Exception:return False

results={};fail=[]
for game,(path,start,radius,min_total,min_near,min_real_near) in specs.items():
    if not level.load_level(path):
        fail.append(game+': could not load '+path);continue
    aa=list(actorsys.get_all_level_actors() or [])
    production=[a for a in aa if any(str(t)=='PhantomProductionWorldV11' for t in (a.get_editor_property('tags') or []))]
    player_starts=[a for a in aa if isinstance(a,unreal.PlayerStart)]
    v13=[a for a in production if any(str(t)==PATCH_TAG for t in (a.get_editor_property('tags') or []))]
    v17=[a for a in aa if any(str(t)==V17_TAG for t in (a.get_editor_property('tags') or []))]
    v19=[a for a in aa if any(str(t)==V19_TAG for t in (a.get_editor_property('tags') or []))]
    v20=[a for a in aa if any(str(t)==V20_TAG for t in (a.get_editor_property('tags') or []))]
    v21=[a for a in aa if any(str(t)==V21_TAG for t in (a.get_editor_property('tags') or []))]
    v22=[a for a in aa if any(str(t)==V22_TAG for t in (a.get_editor_property('tags') or []))]
    v23=[a for a in aa if any(str(t)==V23_TAG for t in (a.get_editor_property('tags') or []))]
    near=[a for a in production if dist2d(a,start)<=radius]
    paths=[mesh_path(a) for a in production]
    basic=[(label(a),mesh_path(a)) for a in production if '/Engine/BasicShapes/' in mesh_path(a)]
    rejected_aliases=[
        (label(a),mesh_path(a)) for a in production
        if 'SM_CC0_Tree_B' in mesh_path(a)
        or (game == 'phantom-legends' and 'SM_CC0_Rock' in mesh_path(a))
        or (game == 'phantom-legends' and 'SM_CC0_Tree_A' in mesh_path(a))
        or (game == 'phantom-legends' and 'U_Legends_0009_PineTrees' in mesh_path(a))
        or (game == 'phantom-legends' and 'SM_StorybookTree_A' in mesh_path(a))
        or (game == 'phantom-legends' and 'SM_StorybookTree_B' in mesh_path(a))
        or (game == 'phantom-legends' and 'SM_Fab_Barracks' in mesh_path(a))
    ]
    real_near=[a for a in near if mesh_path(a) and '/Generated/' not in mesh_path(a) and '/Engine/' not in mesh_path(a)]
    authored_material_near=[a for a in real_near if any('/Engine/BasicShapes/' not in m for m in mat_paths(a))]
    max_nonterrain=[]
    for a in production:
        l=label(a).lower()
        mesh=mesh_path(a)
        mesh_lower=mesh.lower()
        # Long, flat V11R10 lane/shoulder/grass bands deliberately use the shared ground-patch
        # mesh. Classify terrain by both actor label and source mesh so these authored floor
        # ribbons do not masquerade as camera-blocking structures.
        if ('terrain' in l or 'road_' in l or 'stream_' in l or 'river_' in l or 'heartstoneriver' in l
                or 'groundpatch' in mesh_lower or 'ground_plane' in mesh_lower):continue
        d=dims(a)
        if max(d)>8000:max_nonterrain.append((label(a),d,mesh))
    prefixes,exact=REJECTED_COMPOSITION[game]
    rejected_composition=[label(a) for a in aa if label(a) in exact or any(label(a).startswith(prefix) for prefix in prefixes)]
    r={'actors':len(production),'player_starts':[label(a) for a in player_starts],'v13_actors':len(v13),'v17_actors':len(v17),'v19_actors':len(v19),'v20_markers':len(v20),'v21_markers':len(v21),'v22_actors':len(v22),'v23_actors':len(v23),'near_start':len(near),'real_near_start':len(real_near),'authored_material_real_near':len(authored_material_near),'basic_shapes':basic[:20],'rejected_aliases':rejected_aliases[:20],'rejected_composition':rejected_composition[:40],'oversize_nonterrain':max_nonterrain[:20]}
    if not player_starts:fail.append(f'{game}: no PlayerStart; default pawn/HUD cannot initialize reliably')
    if len(production)<min_total:fail.append(f'{game}: actors {len(production)} < {min_total}')
    if len(v13)<V13_MIN[game]:fail.append(f'{game}: V13 portfolio actors {len(v13)} < {V13_MIN[game]}')
    if len(v19)<V19_MIN[game]:fail.append(f'{game}: V19 first-frame actors {len(v19)} < {V19_MIN[game]}')
    if len(v20)<1:fail.append(f'{game}: V20 composition marker is missing')
    if len(v21)<1:fail.append(f'{game}: V21 quality marker is missing')
    if len(v22)<V22_MIN[game]:fail.append(f'{game}: V22 first-frame actors {len(v22)} < {V22_MIN[game]}')
    if len(v23)<V23_MIN[game]:fail.append(f'{game}: V23 vertical-slice actors {len(v23)} < {V23_MIN[game]}')
    if rejected_composition:fail.append(f'{game}: rejected V21 composition actors remain: {rejected_composition[:12]}')
    expected_surface={
        'cubetown':('CT_Terrain_',(
            '/Game/Phantom/Materials/Production/M_Phantom_Grass',
            '/Game/Phantom/Generated/Cubetown/V24/Materials/M_CT24_HeartstoneGrass',
            '/Game/Phantom/Generated/Cubetown/V17/Materials/M_CT17_HeartstoneGrass',
            '/Game/Phantom/Generated/Cubetown/V26/Materials/M_CT26_HeartstoneGrass',
        )),
        'phantom-ages':('AGES_Terrain_',('/Game/Phantom/Materials/Production/M_Phantom_Dirt',)),
        'phantom-legends':('LEG_Terrain_',('/Game/Phantom/Materials/Production/M_Phantom_Grass',)),
        'phantom-strike':('STRIKE_Road_',('/Game/Phantom/Materials/Production/M_Phantom_Asphalt',)),
    }[game]
    surface_actors=[a for a in aa if label(a).startswith(expected_surface[0])]
    bad_surfaces=[
        label(a) for a in surface_actors
        if not any(m.startswith(required) for m in mat_paths(a) for required in expected_surface[1])
    ]
    r['production_surface_actors']=len(surface_actors)
    r['invalid_production_surfaces']=bad_surfaces[:40]
    if not surface_actors:fail.append(f'{game}: no persistent production surface actors matched {expected_surface[0]}')
    if bad_surfaces:fail.append(f'{game}: {len(bad_surfaces)} surface actors lack an allowed PBR material {expected_surface[1]}')
    if len(near)<min_near:fail.append(f'{game}: near-start actors {len(near)} < {min_near}')
    if len(real_near)<min_real_near:fail.append(f'{game}: imported/non-generated near-start art {len(real_near)} < {min_real_near}')
    if basic:fail.append(f'{game}: persistent world contains {len(basic)} Engine BasicShape actors')
    if rejected_aliases:fail.append(f'{game}: persistent world still contains {len(rejected_aliases)} rejected visual aliases')
    if max_nonterrain:fail.append(f'{game}: {len(max_nonterrain)} non-terrain actors exceed 80m bounds (camera-occlusion risk)')
    if game=='phantom-strike':
        blockers=[]
        for a in production:
            l=label(a)
            if l.startswith('STRIKE_Building_') or l in ('STRIKE_Hospital','STRIKE_Bank'):
                if intersects_spawn(a,-9000,0):blockers.append((l,dims(a),mesh_path(a)))
        r['spawn_blockers']=blockers
        if blockers:fail.append('phantom-strike: building geometry intersects 30m x 30m player spawn-safe box')
    if game=='phantom-ages':
        labels={label(a) for a in production}
        for required in ('AGES_Red_FortressKeep','AGES_Blue_FortressKeep'):
            if required not in labels:fail.append('phantom-ages: missing '+required)
    results[game]=r

summary={'schema':23,'status':'PASS' if not fail else 'FAIL','failures':fail,'results':results}
with open(REPORT,'w',encoding='utf-8') as f:json.dump(summary,f,indent=2)
if fail:
    raise RuntimeError('V23 production world gate FAILED: '+' | '.join(fail)+'; see '+REPORT)
unreal.log('PHANTOM V23 PRODUCTION WORLD GATE PASS '+json.dumps(results))
