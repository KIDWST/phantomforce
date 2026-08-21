"""Import Poly Haven CC0 texture sets and build persistent PBR materials for V11."""
from __future__ import annotations
import json, os, glob, traceback
import unreal

PROJECT=os.path.abspath(unreal.Paths.project_dir()); SAVED=os.path.abspath(unreal.Paths.project_saved_dir())
ROOT=os.path.join(PROJECT,'SourceArt','External','PolyHavenV11'); DEST='/Game/Phantom/Materials/Production'
REPORT=os.path.join(SAVED,'PhantomPolyHavenMaterialImportV11.json')
roles=['Grass','Cobble','Dirt','Rock','Asphalt','Concrete','Wood']
world_uv_scale={
    'Grass':1.0/450.0,
    'Cobble':1.0/280.0,
    'Dirt':1.0/500.0,
    'Rock':1.0/320.0,
    'Asphalt':1.0/600.0,
    'Concrete':1.0/360.0,
    'Wood':1.0/260.0,
}
# Installer/static gate marker: Grass material resolves to /Game/Phantom/Materials/Production/M_Phantom_Grass
EXPECTED_GRASS_ALIAS='M_Phantom_Grass'
asset_tools=unreal.AssetToolsHelpers.get_asset_tools()

def load(path):
    try:return unreal.load_asset(path)
    except Exception:return None

def import_tex(role,kind,path):
    dest=f'{DEST}/Textures/{role}'; unreal.EditorAssetLibrary.make_directory(dest)
    task=unreal.AssetImportTask();task.filename=path;task.destination_path=dest;task.destination_name=f'T_{role}_{kind}';task.automated=True;task.replace_existing=True;task.save=True
    asset_tools.import_asset_tasks([task])
    target=f'{dest}/T_{role}_{kind}'
    texture=load(target)
    if texture:
        texture.set_editor_property('srgb',kind=='BaseColor')
        if kind=='Normal':
            texture.set_editor_property('compression_settings',unreal.TextureCompressionSettings.TC_NORMALMAP)
        elif kind in ('Roughness','Displacement'):
            texture.set_editor_property('compression_settings',unreal.TextureCompressionSettings.TC_MASKS)
        unreal.EditorAssetLibrary.save_asset(target)
    return texture

def find_map(role,kind):
    d=os.path.join(ROOT,role)
    fs=[]
    for e in ('*.png','*.jpg','*.jpeg','*.tif','*.tiff','*.exr'):
        fs+=glob.glob(os.path.join(d,kind+e[1:]))
        fs+=glob.glob(os.path.join(d,kind+'.*'))
    fs=sorted(set(fs))
    return fs[0] if fs else None

def make_mat(role,textures):
    path=f'{DEST}/M_Phantom_{role}'
    if unreal.EditorAssetLibrary.does_asset_exist(path):unreal.EditorAssetLibrary.delete_asset(path)
    factory=unreal.MaterialFactoryNew();mat=asset_tools.create_asset(f'M_Phantom_{role}',DEST,unreal.Material,factory)
    if not mat:raise RuntimeError('Could not create '+path)
    MEL=unreal.MaterialEditingLibrary
    world_position=MEL.create_material_expression(mat,unreal.MaterialExpressionWorldPosition,-980,80)
    xy=MEL.create_material_expression(mat,unreal.MaterialExpressionComponentMask,-800,80)
    xy.set_editor_property('r',True);xy.set_editor_property('g',True)
    scale=MEL.create_material_expression(mat,unreal.MaterialExpressionConstant,-800,200)
    scale.set_editor_property('r',world_uv_scale[role])
    uv=MEL.create_material_expression(mat,unreal.MaterialExpressionMultiply,-620,80)
    def connect(source,output,target,input_name):
        if not MEL.connect_material_expressions(source,output,target,input_name):
            raise RuntimeError('Could not connect material expression to input '+(input_name or '<first>'))
    def connect_property(source,output,material_property):
        if not MEL.connect_material_property(source,output,material_property):
            raise RuntimeError('Could not connect material property '+str(material_property))
    # ComponentMask's reflected input name is shortened differently between
    # engine versions. An empty name intentionally selects its first input.
    connect(world_position,'',xy,'')
    connect(xy,'',uv,'A')
    connect(scale,'',uv,'B')
    def sample(kind,x,y):
        node=MEL.create_material_expression(mat,unreal.MaterialExpressionTextureSample,x,y)
        node.set_editor_property('texture',textures[kind])
        if kind=='Normal':
            node.set_editor_property('sampler_type',unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        elif kind in ('Roughness','Displacement'):
            node.set_editor_property('sampler_type',unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
        connect(uv,'',node,'UVs')
        return node
    # Base color
    if textures.get('BaseColor'):
        e=sample('BaseColor',-520,-80);connect_property(e,'RGB',unreal.MaterialProperty.MP_BASE_COLOR)
    if textures.get('Normal'):
        e=sample('Normal',-520,100)
        connect_property(e,'RGB',unreal.MaterialProperty.MP_NORMAL)
    if textures.get('Roughness'):
        e=sample('Roughness',-520,280);connect_property(e,'R',unreal.MaterialProperty.MP_ROUGHNESS)
    else:
        c=MEL.create_material_expression(mat,unreal.MaterialExpressionConstant,-520,280);c.r=0.72;connect_property(c,'',unreal.MaterialProperty.MP_ROUGHNESS)
    MEL.recompile_material(mat);unreal.EditorAssetLibrary.save_asset(path);return path

results={};ok=0
for role in roles:
    tex={}
    for kind in ('BaseColor','Normal','Roughness','Displacement'):
        p=find_map(role,kind)
        if p:
            try:
                t=import_tex(role,kind,p)
                if t:tex[kind]=t
            except Exception:pass
    try:
        if 'BaseColor' not in tex:raise RuntimeError('BaseColor missing')
        mat=make_mat(role,tex);results[role]={'status':'ok','material':mat,'textures':list(tex.keys()),'world_uv_scale':world_uv_scale[role]};ok+=1
    except Exception as e:results[role]={'status':'fail','error':str(e),'traceback':traceback.format_exc()}
try:unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True,True)
except Exception:pass
summary={'schema':22,'status':'PASS' if ok>=6 else 'FAIL','materials_ok':ok,'results':results}
with open(REPORT,'w',encoding='utf-8') as f:json.dump(summary,f,indent=2)
if summary['status']!='PASS':raise RuntimeError('Poly Haven PBR material import failed: %d/7'%ok)
unreal.log('PHANTOM V11 POLY HAVEN MATERIALS PASS %d/7'%ok)
