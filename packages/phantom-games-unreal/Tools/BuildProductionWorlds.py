"""PHANTOM V11 production world builder.

V11 is intentionally not another generated-GLB content pass. Primary architecture, vegetation and
fortifications must resolve to imported creator/Fab/Unity/original Phantom assets. Generated meshes
are restricted to terrain/collision and a few magical setpieces. Every world is persistent and is
validated after creation before any candidate is cooked.
"""
from __future__ import annotations
import json, math, os, random, traceback
import unreal

SAVED=os.path.abspath(unreal.Paths.project_saved_dir())
REPORT=os.path.join(SAVED,'PhantomProductionWorldsV11.json')
WORLD_ROOT='/Game/Phantom/Worlds'
TAG='PhantomProductionWorldV11'
random.seed(110814)
level=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not level or not actors: raise RuntimeError('V11 requires LevelEditorSubsystem + EditorActorSubsystem')


def load_static(path):
    try:
        o=unreal.EditorAssetLibrary.load_asset(path) or unreal.load_asset(path)
        return o if isinstance(o,unreal.StaticMesh) else None
    except Exception:return None

def load_mat(path):
    try:
        o=unreal.EditorAssetLibrary.load_asset(path) or unreal.load_asset(path)
        return o if isinstance(o,unreal.MaterialInterface) else None
    except Exception:return None

def pick(paths, required=True, forbid_generated=False):
    if isinstance(paths,str):paths=[paths]
    for p in paths:
        if forbid_generated and '/Generated/' in p:continue
        m=load_static(p)
        if m:return p,m
    if required:raise RuntimeError('No production StaticMesh resolved: '+' | '.join(paths))
    return None,None

def target_cm(semantic):
    s=semantic.lower()
    # (target, use height) -- deliberately human-scale. Imported packs differ dramatically in units.
    if 'terrain_cube' in s:return 32000,False
    if 'terrain_legends' in s:return 102400,False
    if 'terrain_strike' in s:return 12000,False
    if 'terrain_ages' in s:return 36000,False
    if 'road_12m' in s:return 1200,False
    if 'road_24m' in s:return 2400,False
    if 'river_60m' in s:return 6000,False
    if 'bridge' in s:return 1800,False
    if 'capital_keep' in s:return 3000,True
    if 'fortress_keep' in s:return 2600,True
    if 'castle' in s or 'keep' in s:return 2200,True
    if 'tower' in s:return 1500,True
    if 'gate' in s:return 950,True
    if 'wall' in s:return 650,True
    if 'barracks' in s:return 850,True
    if any(x in s for x in ('tavern','blacksmith','house','cottage','shop','inn','stable','workshop')):return 800,True
    if 'market' in s:return 500,True
    if 'tree' in s:return 1300,True
    if 'bush' in s:return 220,True
    if 'rock' in s:return 350,False
    if 'lantern' in s:return 300,True
    if 'fence' in s:return 500,False
    if 'well' in s:return 350,False
    if 'container' in s:return 600,False
    if 'barrier' in s or 'sandbag' in s:return 420,False
    if 'rubble' in s:return 500,False
    if 'checkpoint' in s:return 900,False
    if 'dragon' in s:return 2400,False
    if 'golem' in s or 'titan' in s:return 1800,True
    if 'siege' in s:return 650,False
    if 'crystal' in s:return 800,True
    return None,None

def normalized(mesh, semantic, requested=(1,1,1)):
    try:
        b=mesh.get_bounds(); e=b.box_extent
        raw=(max(1.,float(e.x)*2),max(1.,float(e.y)*2),max(1.,float(e.z)*2))
        target,use_h=target_cm(semantic)
        if not target:return requested
        dim=raw[2] if use_h else max(raw)
        f=max(.005,min(250.,float(target)/dim))
        return tuple(float(x)*f for x in requested)
    except Exception:return requested

def component(a):
    try:return a.get_editor_property('static_mesh_component')
    except Exception:
        try:return a.static_mesh_component
        except Exception:return None

def set_material(a,mat_path,slot='all'):
    mat=load_mat(mat_path)
    c=component(a)
    if not mat or not c:return
    try:
        n=max(1,int(c.get_num_materials()))
        if slot=='last': c.set_material(max(0,n-1),mat)
        elif slot=='first': c.set_material(0,mat)
        else:
            for i in range(n):c.set_material(i,mat)
    except Exception:pass

def spawn(name,candidates,xyz,yaw=0,scale=(1,1,1),required=True,ground=True,material=None,forbid_generated=False):
    path,mesh=pick(candidates,required,forbid_generated)
    if not mesh:return None
    sc=normalized(mesh,name+' '+path,scale)
    # Unreal Python's Rotator positional order is roll, pitch, yaw. The earlier middle-argument
    # assignment turned every intended 90-degree street/house rotation into a vertical pitch.
    a=actors.spawn_actor_from_object(mesh,unreal.Vector(*map(float,xyz)),unreal.Rotator(0,0,float(yaw)),transient=False)
    if not a:
        if required:raise RuntimeError('Spawn failed '+name)
        return None
    try:a.set_actor_label(name)
    except Exception:pass
    try:a.set_actor_scale3d(unreal.Vector(*map(float,sc)))
    except Exception:pass
    # Second pass uses final actor bounds, catching import transforms/pivots that mesh.get_bounds alone misses.
    try:
        target,use_h=target_cm(name+' '+path)
        if target:
            origin,ext=a.get_actor_bounds(False)
            dims=(max(1.,ext.x*2),max(1.,ext.y*2),max(1.,ext.z*2))
            dim=dims[2] if use_h else max(dims)
            correction=max(.2,min(5.,float(target)/float(dim)))
            cur=a.get_actor_scale3d();a.set_actor_scale3d(unreal.Vector(cur.x*correction,cur.y*correction,cur.z*correction))
    except Exception:pass
    if ground:
        try:
            origin,ext=a.get_actor_bounds(False);loc=a.get_actor_location();loc.z += float(xyz[2])-(float(origin.z)-float(ext.z));a.set_actor_location(loc,False,False)
        except Exception:pass
    if material:set_material(a,material)
    try:a.set_editor_property('tags',list(a.get_editor_property('tags'))+[unreal.Name(TAG),unreal.Name(name)])
    except Exception:pass
    return a

def new_world(path):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        if not unreal.EditorAssetLibrary.delete_asset(path):raise RuntimeError('Could not replace '+path)
    if not level.new_level(path,False):raise RuntimeError('Could not create '+path)

def save(path):
    if not level.save_current_level():raise RuntimeError('Could not save '+path)

MATS={k:f'/Game/Phantom/Materials/Production/M_Phantom_{k}' for k in ('Grass','Cobble','Dirt','Rock','Asphalt','Concrete','Wood')}
GEN=lambda g,f,a:f'/Game/Phantom/Generated/{g}/{f}/{a}'
V8=lambda g,f,a:f'/Game/Phantom/Generated/{g}/V8/{f}/{a}'
V9=lambda g,f,a:f'/Game/Phantom/Generated/{g}/V9/{f}/{a}'
V10=lambda g,f,a:f'/Game/Phantom/Generated/{g}/V10/{f}/{a}'

CUBE_HOUSES=[
 ['/Game/Phantom/Curated/Fab/Cube/SM_Fab_StylizedHouse','/Game/Phantom/Curated/Unity/Cube/SM_Unity_House','/Game/Phantom/Curated/Cube/SM_Cube_House_A'],
 ['/Game/Phantom/Curated/Cube/SM_Cube_House_B','/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A'],
 ['/Game/Phantom/Curated/Cube/SM_Cube_Tavern','/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B'],
 ['/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith','/Game/Phantom/External/CC0/Aliases/SM_CC0_House_C'],
]
TREES=[['/Game/Phantom/Curated/Cube/SM_Cube_Tree_A','/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A'],['/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_B','/Game/Phantom/Curated/Cube/SM_Cube_Tree_A']]

def build_cubetown():
    path=WORLD_ROOT+'/CubeTown_World';new_world(path);c=0
    # Ground is the only generated large geometry: real PBR material + dense imported content above it.
    for ty in range(3):
      for tx in range(3):
        spawn(f'CT_Terrain_Cube_{ty}{tx}',V8('Cubetown','Terrain',f'SM_V8_CubeTerrain_{ty}{tx}'),((tx-1)*32000,(ty-1)*32000,-15),ground=False,material=MATS['Grass']);c+=1
    # Hero begins at (0,-11200) facing +Y. Build a true village street immediately in front of camera.
    road_mesh=V10('Cubetown','Setpieces','SM_V10_StoneRoad_120m')
    for j,y in enumerate(range(-10500,23501,1100)):
        spawn(f'CT_Road_12m_{j}',road_mesh,(0,y,4),90,material=MATS['Cobble']);c+=1
    # 64 full buildings inside opening district, arranged as believable street blocks rather than a horizon scatter.
    bid=0
    for y in range(-9000,12501,1500):
      for side in (-1,1):
        for depth in (0,1):
          x=side*(1550+depth*1500+(bid%2)*170)
          spawn(f'CT_House_{bid:03d}',CUBE_HOUSES[bid%len(CUBE_HOUSES)],(x,y,12),(-side*90)+(bid%3-1)*8,(1.05,1.05,1.05),forbid_generated=True);c+=1;bid+=1
    # Plaza + public buildings.
    for name,cand,pos,yaw in [
      ('CT_Market',['/Game/Phantom/Curated/Cube/SM_Cube_Market','/Game/Phantom/External/CC0/Aliases/SM_CC0_Market'],(0,-3500,10),0),
      ('CT_Well',['/Game/Phantom/Curated/Cube/SM_Cube_Well','/Game/Phantom/External/CC0/Aliases/SM_CC0_Well'],(-850,-2600,10),0),
      ('CT_Bridge',['/Game/Phantom/Curated/Fab/Cube/SM_Fab_StylizedBridge','/Game/Phantom/Curated/Cube/SM_Cube_Bridge','/Game/Phantom/External/CC0/Aliases/SM_CC0_Bridge'],(0,5200,10),90),
      ('CT_Castle',['/Game/Phantom/Curated/Fab/Cube/SM_Fab_StylizedCastle','/Game/Phantom/Curated/Legends/SM_Legends_Keep','/Game/Phantom/External/CC0/Aliases/SM_CC0_Keep'],(0,28500,15),180),
    ]:
        spawn(name,cand,pos,yaw,forbid_generated=True);c+=1
    # Stream through town.
    for x in range(-28000,28001,5600):spawn(f'CT_Stream_{x}',V10('Cubetown','Setpieces','SM_V10_Stream_120m'),(x,5200,0),0,material=MATS['Rock']);c+=1
    # Real trees at human scale. Signature generated crimson trees are accents only, never the whole environment.
    tid=0
    for y in range(-10200,15501,650):
      for side in (-1,1):
        x=side*(3900+(tid%4)*460)
        spawn(f'CT_Tree_{tid:03d}',TREES[tid%2],(x,y,4),(tid*37)%360,(1.0,1.0,1.0),forbid_generated=True);c+=1;tid+=1
        if tid%5==0:
            spawn(f'CT_CrimsonAccent_{tid:03d}',V9('Cubetown','Nature',f'SM_V9_CrimsonTree_{tid%2}'),(x+side*650,y+250,4),(tid*29)%360,(.9,.9,.9));c+=1
    # Close-range props every few meters so the opening cannot read as an empty lawn.
    props=[('/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern','lantern'),('/Game/Phantom/External/CC0/Aliases/SM_CC0_Fence','fence'),('/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower','flower'),('/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench','bench'),('/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock','rock')]
    for i in range(120):
        side=-1 if i%2==0 else 1;y=-9800+(i//2)*380;x=side*(700+(i%5)*320)
        asset,sem=props[i%len(props)];spawn(f'CT_{sem}_{i:03d}',asset,(x,y,6),(i*43)%360,(.8,.8,.8),forbid_generated=True);c+=1
    # Meaningful destinations throughout the same large map.
    hamlets=[(-25000,-18000),(25000,-18000),(-27000,13000),(27000,13000),(-15000,28500),(15000,28500)]
    for h,(cx,cy) in enumerate(hamlets):
      for i in range(8):
        a=i*math.tau/8;r=1700+(i%2)*750
        spawn(f'CT_H{h}_House{i}',CUBE_HOUSES[(h+i)%len(CUBE_HOUSES)],(cx+math.cos(a)*r,cy+math.sin(a)*r,8),math.degrees(a)+90,(.9,.9,.9),forbid_generated=True);c+=1
      for i in range(16):
        a=i*2.399;r=2800+(i%4)*650
        spawn(f'CT_H{h}_Tree{i}',TREES[i%2],(cx+math.cos(a)*r,cy+math.sin(a)*r,4),i*29,(.8,.8,.8),forbid_generated=True);c+=1
    # Magical setpieces are allowed generated fallbacks because they are intentionally bespoke Phantom art.
    for name,asset,pos,sc in [('CT_DreamPortal',V9('Cubetown','Setpieces','SM_V9_DreamPortal'),(0,500,15),(1.4,1.4,1.4)),('CT_HeartTree',V9('Cubetown','Setpieces','SM_V9_HeartTree'),(0,14200,15),(1.6,1.6,1.6)),('CT_MushroomGrove',V10('Cubetown','Nature','SM_V10_MushroomGrove'),(-29000,-24000,10),(1.6,1.6,1.6))]:spawn(name,asset,pos,0,sc);c+=1
    save(path);return {'map':path,'actors':c,'opening_center':[0,-5000],'spawn':[0,-11200],'contract':'960m x 960m, dense imported village first'}

def build_ages():
    path=WORLD_ROOT+'/PhantomAges_World';new_world(path);c=0
    spawn('AGES_Terrain_Ages',V8('Ages','Terrain','SM_V8_AgesBattlefield'),(0,0,-20),ground=False,material=MATS['Dirt']);c+=1
    wall=['/Game/Phantom/Curated/Fab/Ages/SM_Fab_Wall','/Game/Phantom/Curated/Ages/SM_Ages_Wall','/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall']
    tower=['/Game/Phantom/Curated/Fab/Ages/SM_Fab_Tower','/Game/Phantom/Curated/Ages/SM_Ages_Tower','/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower']
    gate=['/Game/Phantom/Curated/Fab/Ages/SM_Fab_Gate','/Game/Phantom/Curated/Ages/SM_Ages_Gate','/Game/Phantom/External/CC0/Aliases/SM_CC0_Gate']
    # Two multi-piece fortresses. Real imported architecture only.
    for team,sgn in [('Red',-1),('Blue',1)]:
      bx=sgn*15500
      spawn(f'AGES_{team}_FortressKeep',tower,(bx,2600,0),0 if sgn<0 else 180,(1.7,1.7,1.7),forbid_generated=True);c+=1
      for i,dy in enumerate((-2800,-1400,0,1400,2800)):
        spawn(f'AGES_{team}_Wall_{i}',wall,(bx-sgn*1150,dy,0),90,(1.1,1.1,1.1),forbid_generated=True);c+=1
      for i,dy in enumerate((-3100,3100)):
        spawn(f'AGES_{team}_Tower_{i}',tower,(bx-sgn*650,dy,0),0,(.75,.75,.75),forbid_generated=True);c+=1
      spawn(f'AGES_{team}_Gate',gate,(bx-sgn*900,0,0),0 if sgn<0 else 180,(1.2,1.2,1.2),forbid_generated=True);c+=1
    # Real ruins/rocks/trees frame depth without giant cone mountains.
    for i,x in enumerate(range(-12000,12001,1500)):
      if abs(x)<1800:continue
      spawn(f'AGES_Ruin_{i}',wall,(x,4300,0),(i%5-2)*9,(.55,.55,.55),forbid_generated=True);c+=1
      if i%2==0:
        spawn(f'AGES_Rock_{i}','/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock',(x,3500,0),i*33,(.7,.7,.7),forbid_generated=True);c+=1
    # Siege is bespoke generated art; live armies/characters are skeletal at runtime in V11.
    for i,x in enumerate((-11000,-8500,-6000)):
      spawn(f'AGES_RedSiege_{i}',V9('Ages','Siege','SM_V9_AgesTrebuchet' if i%2==0 else 'SM_V9_AgesBallista'),(x,1900,0),90);c+=1
      spawn(f'AGES_BlueSiege_{i}',V9('Ages','Siege','SM_V9_AgesBallista' if i%2==0 else 'SM_V9_AgesTrebuchet'),(-x,1900,0),-90);c+=1
    # Ground the authored dragon monuments so the one-screen opening reads as a battlefield,
    # not two unsupported silhouettes floating above the armies.
    spawn('AGES_RedDragon',V9('Ages','Units','SM_V9_AgesRedDragon'),(-3300,2500,0),20,(1.25,1.25,1.25));c+=1
    spawn('AGES_BlueDragon',V9('Ages','Units','SM_V9_AgesBlueDragon'),(3400,3000,0),200,(1.15,1.15,1.15));c+=1
    save(path);return {'map':path,'actors':c,'contract':'360m x 110m fixed screen; real fortifications + runtime skeletal armies'}

def build_legends():
    path=WORLD_ROOT+'/PhantomLegends_World';new_world(path);c=0
    for ty in range(4):
      for tx in range(4):spawn(f'LEG_Terrain_Legends_{ty}{tx}',V8('Legends','Terrain',f'SM_V8_LegendsTerrain_{ty}{tx}'),((tx-1.5)*102400,(ty-1.5)*102400,-25),ground=False,material=MATS['Grass']);c+=1
    keep=['/Game/Phantom/Curated/Fab/Legends/SM_Fab_Keep','/Game/Phantom/Curated/Legends/SM_Legends_Keep','/Game/Phantom/External/CC0/Aliases/SM_CC0_Keep']
    tower=['/Game/Phantom/Curated/Fab/Legends/SM_Fab_Tower','/Game/Phantom/Curated/Legends/SM_Legends_Tower','/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower']
    wall=['/Game/Phantom/Curated/Fab/Legends/SM_Fab_Wall','/Game/Phantom/Curated/Legends/SM_Legends_Wall','/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall']
    gate=['/Game/Phantom/Curated/Fab/Legends/SM_Fab_Gate','/Game/Phantom/Curated/Legends/SM_Legends_Gate','/Game/Phantom/External/CC0/Aliases/SM_CC0_Gate']
    barr=['/Game/Phantom/Curated/Fab/Legends/SM_Fab_Barracks','/Game/Phantom/Curated/Legends/SM_Legends_Barracks','/Game/Phantom/External/CC0/Aliases/SM_CC0_Barracks']
    house=['/Game/Phantom/Curated/Fab/Legends/SM_Fab_House','/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A']
    def capital(prefix,cx,cy,flip=False):
      nonlocal c
      spawn(prefix+'_CapitalKeep',keep,(cx,cy,0),180 if flip else 0,(1.25,1.25,1.25),forbid_generated=True);c+=1
      # Dense playable capital: walls every 12m, towers every corner/edge, internal military/economy grid.
      for i,x in enumerate(range(-7200,7201,1200)):
        for yy in (-7800,7800):spawn(f'{prefix}_WallH_{i}_{yy}',wall,(cx+x,cy+yy,0),0,(.9,.9,.9),forbid_generated=True);c+=1
      for i,y in enumerate(range(-6600,6601,1200)):
        for xx in (-7800,7800):spawn(f'{prefix}_WallV_{i}_{xx}',wall,(cx+xx,cy+y,0),90,(.9,.9,.9),forbid_generated=True);c+=1
      for i,(dx,dy) in enumerate([(-7800,-7800),(7800,-7800),(-7800,7800),(7800,7800),(0,-7800),(0,7800),(-7800,0),(7800,0)]):spawn(f'{prefix}_Tower_{i}',tower,(cx+dx,cy+dy,0),0,(.8,.8,.8),forbid_generated=True);c+=1
      for i,(dx,dy,yaw) in enumerate([(0,-7800,0),(0,7800,180),(-7800,0,90),(7800,0,-90)]):spawn(f'{prefix}_Gate_{i}',gate,(cx+dx,cy+dy,0),yaw,(1,1,1),forbid_generated=True);c+=1
      for iy in range(-2,3):
        for ix in range(-2,3):
          if ix==0 and iy==0:continue
          p=barr if (ix+iy)%3==0 else house
          spawn(f'{prefix}_Inner_{ix}_{iy}',p,(cx+ix*1800,cy+iy*1800,0),(ix*37+iy*19)%360,(.75,.75,.75),forbid_generated=True);c+=1
      # Trees/resource perimeter around capital.
      for i in range(70):
        a=i*2.399;r=9500+(i%7)*900
        spawn(f'{prefix}_Tree_{i}','/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A',(cx+math.cos(a)*r,cy+math.sin(a)*r,0),i*31,(.85,.85,.85),forbid_generated=True);c+=1
    capital('LEG_Blue',-120000,-95000,False);capital('LEG_Red',120000,95000,True)
    # Roads connect meaningful places; river/bridges form strategic chokepoints.
    road=V10('Legends','Setpieces','SM_V10_RTSRoad_120m')
    for y in (-95000,0,95000):
      for x in range(-150000,150001,10000):spawn(f'LEG_Road_12m_{y}_{x}',road,(x,y,5),0,material=MATS['Dirt']);c+=1
    for y in range(-150000,150001,5500):spawn(f'LEG_River_60m_{y}',V10('Legends','Setpieces','SM_V10_River_80m'),(0,y,0),90,material=MATS['Rock']);c+=1
    for i,y in enumerate((-95000,-45000,0,45000,95000)):
      spawn(f'LEG_Bridge_{i}',['/Game/Phantom/Curated/Fab/Legends/SM_Fab_Bridge','/Game/Phantom/External/CC0/Aliases/SM_CC0_Bridge'],(0,y,8),90,(1.15,1.15,1.15),forbid_generated=True);c+=1
    settlements=[(-65000,45000),(65000,-45000),(-35000,105000),(35000,-105000),(0,0),(-100000,25000),(100000,-25000)]
    for h,(cx,cy) in enumerate(settlements):
      for i in range(12):
        a=i*math.tau/12;r=1800+(i%3)*800
        spawn(f'LEG_Settlement{h}_{i}',house,(cx+math.cos(a)*r,cy+math.sin(a)*r,0),math.degrees(a)+90,(.7,.7,.7),forbid_generated=True);c+=1
      spawn(f'LEG_Settlement{h}_Tower',tower,(cx,cy,0),0,(.55,.55,.55),forbid_generated=True);c+=1
      for i in range(20):
        a=i*2.399;r=3500+(i%5)*650
        spawn(f'LEG_Settlement{h}_Tree{i}','/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_B',(cx+math.cos(a)*r,cy+math.sin(a)*r,0),i*23,(.75,.75,.75),forbid_generated=True);c+=1
    # Giant fantasy silhouettes are only accents; armies themselves are live skeletal units.
    spawn('LEG_BlueGolem',V9('Legends','Units','SM_V9_BlueGolem'),(-108000,-85000,0),45,(1.3,1.3,1.3));c+=1
    spawn('LEG_RedGolem',V9('Legends','Units','SM_V9_RedGolem'),(108000,85000,0),225,(1.3,1.3,1.3));c+=1
    save(path);return {'map':path,'actors':c,'blue_capital':[-120000,-95000],'contract':'4096m x 4096m RTS; imported fortified capitals + settlements + live skeletal armies'}

def build_strike():
    path=WORLD_ROOT+'/PhantomStrike_World';new_world(path);c=0
    for ty in range(3):
      for tx in range(4):spawn(f'STRIKE_Terrain_Strike_{ty}{tx}',V8('Strike','Terrain',f'SM_V8_StrikeGround_{ty}{tx}'),(-18000+tx*12000,-12000+ty*12000,-20),ground=False,material=MATS['Asphalt']);c+=1
    road='/Game/Phantom/Strike/Street_Straight';intersection='/Game/Phantom/Strike/Street_4Way'
    # Actual street network: arterial y=0 stays completely clear at player spawn (-9000,0).
    for y in (-12000,-6000,0,6000,12000):
      for x in range(-22000,22001,1200):spawn(f'STRIKE_Road_12m_H_{y}_{x}',intersection if x%6000==0 else road,(x,y,0),0,(1,1,1),forbid_generated=True);c+=1
    for x in (-18000,-12000,-6000,0,6000,12000,18000):
      for y in range(-15000,15001,1200):spawn(f'STRIKE_Road_12m_V_{x}_{y}',intersection if y%6000==0 else road,(x,y,1),90,(1,1,1),forbid_generated=True);c+=1
    buildings=['/Game/Phantom/Strike/House1','/Game/Phantom/Strike/House2','/Game/Phantom/Strike/House3','/Game/Phantom/Strike/House4','/Game/Phantom/Strike/House5','/Game/Phantom/Strike/Flat','/Game/Phantom/Strike/Flat2','/Game/Phantom/Strike/Shop1','/Game/Phantom/Strike/Hospital1','/Game/Phantom/Strike/Bank1','/Game/Phantom/Curated/Strike/SM_Strike_Warehouse','/Game/Phantom/Curated/Strike/SM_Strike_Commercial']
    # Buildings sit in blocks BETWEEN roads. Never place one in the arterial or the spawn-safe rectangle.
    bid=0
    for bx in (-15000,-9000,-3000,3000,9000,15000):
      for by in (-9000,-3000,3000,9000):
        for corner,(dx,dy) in enumerate(((-1650,-1650),(1650,-1650),(-1650,1650),(1650,1650))):
          x=bx+dx;y=by+dy
          if -12000<x<-6000 and -2200<y<2200:continue
          spawn(f'STRIKE_Building_{bid:03d}',buildings[bid%len(buildings)],(x,y,0),(corner%2)*180,(1,1,1),forbid_generated=True);c+=1;bid+=1
    # Dense cover aligned to curbs, not randomized in the street center.
    cover=['/Game/Phantom/Curated/Strike/SM_Strike_Container','/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate','/Game/Phantom/External/CC0/Aliases/SM_CC0_Barrel',V10('Strike','Props','SM_V10_ConcreteBarrier')]
    for i in range(180):
      street_y=(-6000,0,6000)[i%3];x=-20500+(i%36)*1150;side=-1 if (i//36)%2==0 else 1;y=street_y+side*1250
      # preserve 30m x 30m spawn-safe area around (-9000,0)
      if abs(x+9000)<1500 and abs(y)<1500:continue
      spawn(f'STRIKE_Cover_{i:03d}',cover[i%len(cover)],(x,y,3),90 if i%2 else 0,(.8,.8,.8));c+=1
    # Strong landmark silhouettes without blocking spawn sightline.
    for name,asset,pos,yaw in [('STRIKE_Hospital','/Game/Phantom/Strike/Hospital1',(12000,9000,0),180),('STRIKE_Bank','/Game/Phantom/Strike/Bank1',(-15000,-9000,0),0),('STRIKE_Bridge','/Game/Phantom/Strike/Street_Bridge',(18000,0,0),90)]:spawn(name,asset,pos,yaw,(1.2,1.2,1.2),forbid_generated=True);c+=1
    save(path);return {'map':path,'actors':c,'spawn':[-9000,0,260],'spawn_safe_cm':[3000,3000],'contract':'480m x 360m authored street blocks; player starts above the clear arterial'}

results={}
try:
    unreal.EditorAssetLibrary.make_directory(WORLD_ROOT)
    results['cubetown']=build_cubetown();results['phantom-ages']=build_ages();results['phantom-legends']=build_legends();results['phantom-strike']=build_strike();level.save_all_dirty_levels();results['status']='PASS'
except Exception as e:
    results['status']='FAIL';results['error']=str(e);results['traceback']=traceback.format_exc()
    with open(REPORT,'w',encoding='utf-8') as f:json.dump(results,f,indent=2)
    unreal.log_error('PHANTOM V11 WORLD BUILD FAILED: '+str(e));raise
with open(REPORT,'w',encoding='utf-8') as f:json.dump(results,f,indent=2)
unreal.log('PHANTOM V11 PRODUCTION WORLDS COMPLETE '+json.dumps(results))
