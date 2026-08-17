"""Phantom Games V11 production character importer.

Production rule: gameplay humanoids must be SkeletalMesh assets with usable animation sequences.
V11 probes both FBX and glTF variants from the current creator packs and keeps the import that
actually produces the strongest Unreal skeletal+animation result. Static-character shortcuts are
not accepted as success.
"""
from __future__ import annotations
import glob, json, os, re, traceback
import unreal

PROJECT=os.path.abspath(unreal.Paths.project_dir())
ROOT=os.path.join(PROJECT,'SourceArt','External','CC0')
DEST='/Game/Phantom/Characters/Production'
PARTS=f'{DEST}/Parts'
REPORT=os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()),'PhantomProductionCharactersV11.json')
asset_tools=unreal.AssetToolsHelpers.get_asset_tools()

def log(s): unreal.log('[PhantomV11Characters] '+str(s))
def list_assets(path):
    try:return list(unreal.EditorAssetLibrary.list_assets(path,recursive=True,include_folder=False) or [])
    except Exception:return []
def asset_class(path):
    try:
        o=unreal.load_asset(path);return o.get_class().get_name() if o else ''
    except Exception:return ''
def setprop(obj,name,value):
    try:obj.set_editor_property(name,value);return True
    except Exception:return False

def source_score(p,names):
    base_name=os.path.basename(p).lower();stem=os.path.splitext(base_name)[0];full=p.lower();v=0
    for i,n in enumerate(names):
        n=n.lower()
        if stem==n:v+=2600-i*40
        elif n in base_name:v+=1300-i*30
        elif n in full:v+=420-i*20
    # Character source must live in a Character area and must not be accessory/prop content.
    if 'character' in full:v+=500
    if any(x in full for x in ('/assets/fbx/','\\assets\\fbx\\','weapon','accessory','prop','preview','icon')):v-=2200
    ext=os.path.splitext(p)[1].lower()
    # FBX gets first probe because UE's FBX skeletal importer exposes explicit animation settings,
    # but glTF is also probed because creator files may preserve multiple animation clips better there.
    if ext=='.fbx':v+=220
    elif ext in ('.gltf','.glb'):v+=180
    return v

def find_sources(pack,names):
    base=os.path.join(ROOT,pack)
    if not os.path.isdir(base):return []
    paths=[]
    for ext in ('*.fbx','*.gltf','*.glb'):paths += glob.glob(os.path.join(base,'**',ext),recursive=True)
    paths=[p for p in paths if source_score(p,names)>0]
    paths.sort(key=lambda p:(source_score(p,names),-len(p)),reverse=True)
    # Probe at most one of each source format. This avoids wasting a long editor session on duplicate copies.
    chosen=[];seen=set()
    for p in paths:
        ext=os.path.splitext(p)[1].lower()
        family='fbx' if ext=='.fbx' else 'gltf'
        if family in seen:continue
        seen.add(family);chosen.append(p)
    return chosen[:2]

def import_probe(alias,source,index):
    ext=os.path.splitext(source)[1].lower()
    family='FBX' if ext=='.fbx' else 'GLTF'
    folder=f'{DEST}/_Import_{alias}_{family}'
    try:
        if unreal.EditorAssetLibrary.does_directory_exist(folder):unreal.EditorAssetLibrary.delete_directory(folder)
        unreal.EditorAssetLibrary.make_directory(folder)
    except Exception:pass
    task=unreal.AssetImportTask();task.filename=source;task.destination_path=folder;task.automated=True;task.replace_existing=True;task.save=True
    if ext=='.fbx':
        ui=unreal.FbxImportUI()
        setprop(ui,'import_mesh',True);setprop(ui,'import_as_skeletal',True);setprop(ui,'import_animations',True)
        setprop(ui,'import_materials',True);setprop(ui,'import_textures',True);setprop(ui,'create_physics_asset',False)
        try:ui.mesh_type_to_import=unreal.FBXImportType.FBXIT_SKELETAL_MESH
        except Exception:pass
        try:
            sk=ui.skeletal_mesh_import_data
            setprop(sk,'import_morph_targets',False);setprop(sk,'update_skeleton_reference_pose',False);setprop(sk,'use_t0_as_ref_pose',False)
        except Exception:pass
        task.options=ui
    try:
        asset_tools.import_asset_tasks([task])
    except Exception as e:
        return {'source':source,'family':family,'folder':folder,'status':'import-exception','error':str(e),'traceback':traceback.format_exc(),'skels':[],'anims':[]}
    imported=list_assets(folder);classes={p:asset_class(p) for p in imported}
    skels=[p for p,c in classes.items() if c=='SkeletalMesh']
    anims=[p for p,c in classes.items() if c=='AnimSequence']
    return {'source':source,'family':family,'folder':folder,'status':'ok' if skels else 'no-skeletal-mesh','classes':classes,'skels':skels,'anims':anims}

def import_character(alias,pack,names):
    sources=find_sources(pack,names)
    if not sources:return {'alias':alias,'pack':pack,'source':None,'status':'source-missing','probes':[]}
    probes=[import_probe(alias,src,i) for i,src in enumerate(sources)]
    viable=[x for x in probes if x.get('skels')]
    if not viable:return {'alias':alias,'pack':pack,'source':sources[0],'status':'no-skeletal-mesh','probes':probes}
    # Prefer the probe that gave Unreal the most real animation sequences. Tie-break toward FBX.
    viable.sort(key=lambda x:(len(x.get('anims',[])),1 if x.get('family')=='FBX' else 0),reverse=True)
    best=viable[0];skels=list(best['skels']);anims=list(best['anims'])
    # KayKit's glTF characters are modular: arms, body, head, and legs are separate
    # SkeletalMesh assets which share one skeleton.  Treating the first imported mesh as a
    # complete character created giant animated limbs in packaged builds.  The body is the
    # animation leader and every imported part receives a stable alias for runtime assembly.
    def imported_object_name(path):
        return path.rsplit('/',1)[-1].split('.',1)[0]
    def part_name(path):
        return re.sub(r'[^A-Za-z0-9_]+','',imported_object_name(path).rsplit('_',1)[-1])
    body_candidates=[p for p in skels if part_name(p).lower()=='body']
    if not body_candidates:
        return {'alias':alias,'pack':pack,'source':best['source'],'status':'modular-body-missing','skeletal_parts':skels,'probes':probes}
    src=body_candidates[0];target=f'{DEST}/SK_{alias}'
    try:
        if unreal.EditorAssetLibrary.does_asset_exist(target):unreal.EditorAssetLibrary.delete_asset(target)
        if not unreal.EditorAssetLibrary.duplicate_asset(src.split('.')[0],target):
            return {'alias':alias,'pack':pack,'source':best['source'],'status':'skeletal-alias-failed','skeletal':src,'probes':probes}
        unreal.EditorAssetLibrary.save_asset(target)
    except Exception as e:return {'alias':alias,'pack':pack,'source':best['source'],'status':'skeletal-alias-exception','error':str(e),'probes':probes}

    part_aliases={}
    try:
        unreal.EditorAssetLibrary.make_directory(PARTS)
        for old in list_assets(PARTS):
            old_name=old.rsplit('/',1)[-1].split('.',1)[0]
            if old_name.startswith(f'SK_{alias}_'):
                unreal.EditorAssetLibrary.delete_asset(old.split('.')[0])
        for part_src in sorted(skels):
            suffix=part_name(part_src)
            if not suffix:continue
            part_target=f'{PARTS}/SK_{alias}_{suffix}'
            if unreal.EditorAssetLibrary.does_asset_exist(part_target):unreal.EditorAssetLibrary.delete_asset(part_target)
            if unreal.EditorAssetLibrary.duplicate_asset(part_src.split('.')[0],part_target):
                unreal.EditorAssetLibrary.save_asset(part_target);part_aliases[suffix]=part_target
    except Exception as e:
        return {'alias':alias,'pack':pack,'source':best['source'],'status':'modular-alias-exception','error':str(e),'skeletal':target,'probes':probes}
    if len(part_aliases)<5 or 'Body' not in part_aliases:
        return {'alias':alias,'pack':pack,'source':best['source'],'status':'modular-alias-incomplete','skeletal':target,'modular_parts':part_aliases,'probes':probes}

    roles=[('Idle',('idle','breathing')),('Walk',('walk','walking')),('Run',('run','running','sprint')),
           ('Attack',('attack','sword','melee','slash','spell')),('Hit',('hit','damage','hurt','impact')),('Death',('death','die','dying'))]
    aliases={};used=set()
    for role,words in roles:
        ranked=[]
        for p in anims:
            if p in used:continue
            low=p.lower();score=sum(100-i*8 for i,w in enumerate(words) if w in low)
            if score:ranked.append((score,p))
        if ranked:ranked.sort(reverse=True);choice=ranked[0][1]
        else:
            remaining=sorted([p for p in anims if p not in used]);choice=remaining[0] if remaining else None
        if not choice:continue
        used.add(choice);dst=f'{DEST}/Animations/A_{alias}_{role}'
        try:
            unreal.EditorAssetLibrary.make_directory(f'{DEST}/Animations')
            if unreal.EditorAssetLibrary.does_asset_exist(dst):unreal.EditorAssetLibrary.delete_asset(dst)
            if unreal.EditorAssetLibrary.duplicate_asset(choice.split('.')[0],dst):
                unreal.EditorAssetLibrary.save_asset(dst);aliases[role]=dst
        except Exception:pass
    return {
        'alias':alias,'pack':pack,'source':best['source'],'source_family':best['family'],'status':'ok',
        'skeletal':target,'driver_part':'Body','modular_parts':part_aliases,'modular_part_count':len(part_aliases),
        'animations':aliases,'imported_animation_count':len(anims),
        'probe_summary':[{'source':x.get('source'),'family':x.get('family'),'status':x.get('status'),'skeletal_count':len(x.get('skels',[])),'animation_count':len(x.get('anims',[]))} for x in probes]
    }

specs=[('Knight','KayKitAdventurers',('knight',)),('Mage','KayKitAdventurers',('mage',)),('Rogue','KayKitAdventurers',('rogue',)),('Barbarian','KayKitAdventurers',('barbarian',)),
       ('SkeletonWarrior','KayKitSkeletons',('skeleton_warrior','warrior')),('SkeletonRogue','KayKitSkeletons',('skeleton_rogue','rogue')),('SkeletonMage','KayKitSkeletons',('skeleton_mage','mage')),('SkeletonMinion','KayKitSkeletons',('skeleton_minion','minion'))]
results=[]
for spec in specs:
    r=import_character(*spec);results.append(r);log('%s -> %s source=%s clips=%s'%(r['alias'],r['status'],r.get('source_family','?'),r.get('imported_animation_count',0)))
ok=[r for r in results if r.get('status')=='ok']
anim_total=sum(len(r.get('animations',{})) for r in ok)
# Production gameplay needs multiple real characters and multiple mapped clips; one idle/static pose is not enough.
# Do not silently promote if the current creator archives/import pipeline cannot expose their advertised animation content.
modular_ok=sum(1 for r in ok if r.get('modular_part_count',0)>=5 and r.get('driver_part')=='Body')
status='PASS' if len(ok)>=6 and modular_ok>=6 and anim_total>=18 and sum(1 for r in ok if r.get('imported_animation_count',0)>=3)>=4 else 'FAIL'
summary={'schema':11,'status':status,'characters_ok':len(ok),'animation_aliases':anim_total,'animated_characters':sum(1 for r in ok if r.get('imported_animation_count',0)>=3),'results':results}
os.makedirs(os.path.dirname(REPORT),exist_ok=True)
with open(REPORT,'w',encoding='utf-8') as f:json.dump(summary,f,indent=2)
try:unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True,True)
except Exception:pass
if status!='PASS':raise RuntimeError('Production skeletal-character gate failed: characters_ok=%d modular_ok=%d animation_aliases=%d animated_characters=%d. See %s'%(len(ok),modular_ok,anim_total,summary['animated_characters'],REPORT))
log('PASS characters=%d modular_ok=%d animation_aliases=%d animated_characters=%d'%(len(ok),modular_ok,anim_total,summary['animated_characters']))
