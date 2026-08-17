from pathlib import Path
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix

ROOT = Path('/mnt/data/phantom_overhaul/SourceArt/Generated')
for d in ['Common','Legends','Ages','Cubetown']:
    (ROOT/d).mkdir(parents=True, exist_ok=True)


def box(ext, loc=(0,0,0)):
    m=trimesh.creation.box(extents=ext)
    m.apply_translation(loc)
    return m

def cyl(r,h,loc=(0,0,0),sections=10):
    m=trimesh.creation.cylinder(radius=r,height=h,sections=sections)
    m.apply_translation(loc)
    return m

def cone(r,h,loc=(0,0,0),sections=8):
    m=trimesh.creation.cone(radius=r,height=h,sections=sections)
    m.apply_translation(loc)
    return m

def sphere(r,loc=(0,0,0),sub=1,scale=None):
    m=trimesh.creation.icosphere(subdivisions=sub,radius=r)
    if scale:
        m.apply_scale(scale)
    m.apply_translation(loc)
    return m

def wedge(ext=(100,100,100), loc=(0,0,0)):
    # triangular prism roof, long axis Y
    x,y,z = ext[0]/2, ext[1]/2, ext[2]
    verts=np.array([[-x,-y,0],[x,-y,0],[0,-y,z],[-x,y,0],[x,y,0],[0,y,z]],float)
    faces=np.array([[0,1,2],[3,5,4],[0,3,4],[0,4,1],[1,4,5],[1,5,2],[2,5,3],[2,3,0]])
    m=trimesh.Trimesh(vertices=verts,faces=faces,process=True)
    m.apply_translation(loc)
    return m

def arch(width=300,depth=90,height=300,thick=55,loc=(0,0,0)):
    parts=[]
    parts.append(box((thick,depth,height*0.72),(loc[0]-width/2+thick/2,loc[1],loc[2]+height*0.36)))
    parts.append(box((thick,depth,height*0.72),(loc[0]+width/2-thick/2,loc[1],loc[2]+height*0.36)))
    # stepped arch top
    for i in range(5):
        w=width-(i*thick*0.8)
        parts.append(box((w,depth,thick),(loc[0],loc[1],loc[2]+height*0.72+i*thick*0.52)))
    return trimesh.util.concatenate(parts)

def save(name, meshes, subdir):
    m=trimesh.util.concatenate(meshes if isinstance(meshes,(list,tuple)) else [meshes])
    m.remove_unreferenced_vertices()
    m.fix_normals()
    out=ROOT/subdir/f'{name}.obj'
    m.export(out)
    return out

# Common stylized props
save('SM_StorybookTree_A', [
    cyl(24,180,(0,0,90),sections=8),
    sphere(92,(0,0,205),sub=1,scale=(1.0,0.82,0.95)),
    sphere(60,(-48,12,245),sub=1,scale=(1,0.85,0.9)),
    sphere(58,(52,-5,238),sub=1,scale=(0.95,0.8,0.9)),
], 'Common')
save('SM_StorybookTree_B', [
    cyl(20,150,(0,0,75),sections=8),
    cone(88,170,(0,0,190),sections=9),
    cone(66,140,(0,0,285),sections=9),
], 'Common')
save('SM_RockCluster_A', [
    sphere(75,(-25,0,48),sub=1,scale=(1.15,0.8,0.65)),
    sphere(52,(55,18,42),sub=1,scale=(0.9,0.72,0.65)),
    sphere(38,(8,-55,32),sub=1,scale=(0.9,0.8,0.55)),
], 'Common')
save('SM_GrassTuft_A', [
    cone(18,95,(-25,0,47),sections=5), cone(16,115,(0,8,57),sections=5), cone(17,88,(25,-6,44),sections=5),
    cone(13,75,(-8,-22,37),sections=5)
], 'Common')
save('SM_LanternPost_A', [
    cyl(8,180,(0,0,90),sections=8), box((70,14,10),(28,0,168)),
    cyl(24,36,(58,0,145),sections=8), cone(32,28,(58,0,177),sections=8)
], 'Common')

# Legends
save('SM_LegionKeep', [
    box((520,430,300),(0,0,150)), box((310,300,210),(0,0,405)),
    cyl(85,420,(-220,-165,210),sections=10), cyl(85,420,(220,-165,210),sections=10),
    cyl(85,420,(-220,165,210),sections=10), cyl(85,420,(220,165,210),sections=10),
    cone(115,150,(-220,-165,495),sections=10), cone(115,150,(220,-165,495),sections=10),
    cone(115,150,(-220,165,495),sections=10), cone(115,150,(220,165,495),sections=10),
    arch(190,80,220,45,(0,-230,0)),
    box((120,30,140),(0,-250,115)),
], 'Legends')
save('SM_RiftKeep', [
    box((430,340,260),(0,0,130)),
    arch(230,100,360,58,(0,-210,0)),
    cone(95,390,(-190,0,225),sections=7), cone(95,390,(190,0,225),sections=7),
    cone(150,360,(0,115,330),sections=7),
    sphere(75,(0,-205,285),sub=1,scale=(1.0,0.45,1.5)),
], 'Legends')
save('SM_FantasyCottage', [
    box((280,230,175),(0,0,87.5)), wedge((330,270,150),(0,0,175)),
    box((62,24,105),(0,-127,52)), box((70,18,55),(-72,-126,110)), box((70,18,55),(72,-126,110)),
    cyl(22,120,(88,65,220),sections=8), cone(34,42,(88,65,300),sections=8)
], 'Legends')
save('SM_StoneBridge', [
    box((620,250,38),(0,0,120)),
    arch(220,270,150,38,(-180,0,0)), arch(220,270,150,38,(180,0,0)),
    box((620,28,75),(0,-125,150)), box((620,28,75),(0,125,150)),
], 'Legends')
save('SM_LegionBarracks', [
    box((370,270,200),(0,0,100)), wedge((420,320,135),(0,0,200)),
    box((80,28,125),(0,-150,62)), cyl(25,210,(-155,100,105),sections=8), cyl(25,210,(155,100,105),sections=8),
], 'Legends')

# Ages towers: distinct silhouettes by era
save('SM_AgeTower_Stone', [
    box((330,280,220),(0,0,110)), sphere(90,(-110,0,260),sub=1,scale=(1,0.9,0.7)), sphere(90,(110,0,260),sub=1,scale=(1,0.9,0.7)),
    box((120,30,120),(0,-155,60))
], 'Ages')
save('SM_AgeTower_Bronze', [
    box((330,280,260),(0,0,130)), cyl(62,330,(-125,0,165),sections=8), cyl(62,330,(125,0,165),sections=8),
    cone(85,90,(-125,0,375),sections=8), cone(85,90,(125,0,375),sections=8), arch(130,40,170,35,(0,-155,0))
], 'Ages')
save('SM_AgeTower_Iron', [
    box((360,300,290),(0,0,145)), box((440,80,80),(0,0,325)),
    cyl(72,380,(-150,0,190),sections=10), cyl(72,380,(150,0,190),sections=10),
    cone(92,110,(-150,0,435),sections=10), cone(92,110,(150,0,435),sections=10), arch(150,44,180,38,(0,-170,0))
], 'Ages')
save('SM_AgeTower_Medieval', [
    box((430,330,330),(0,0,165)),
    cyl(90,460,(-180,-125,230),sections=12), cyl(90,460,(180,-125,230),sections=12),
    cyl(90,460,(-180,125,230),sections=12), cyl(90,460,(180,125,230),sections=12),
    cone(112,140,(-180,-125,520),sections=12), cone(112,140,(180,-125,520),sections=12),
    cone(112,140,(-180,125,520),sections=12), cone(112,140,(180,125,520),sections=12),
    arch(190,48,230,48,(0,-188,0))
], 'Ages')
save('SM_AgeTower_Future', [
    box((360,320,260),(0,0,130)),
    cyl(62,500,(-140,0,250),sections=12), cyl(62,500,(140,0,250),sections=12),
    sphere(88,(0,-170,300),sub=2,scale=(1.0,0.35,1.5)),
    box((260,60,45),(0,0,425)), cone(75,150,(0,0,520),sections=8)
], 'Ages')
save('SM_AgeTower_Phantom', [
    box((390,320,250),(0,0,125)),
    cone(100,540,(-150,0,270),sections=7), cone(100,540,(150,0,270),sections=7),
    cone(135,620,(0,90,330),sections=7),
    sphere(105,(0,-185,330),sub=2,scale=(1.0,0.35,1.7)),
    sphere(52,(0,-215,520),sub=2)
], 'Ages')

# Cubetown storybook / diorama props
save('SM_CubetownHouse_A', [
    box((300,250,170),(0,0,85)), wedge((360,300,150),(0,0,170)),
    box((70,24,108),(0,-138,54)), box((68,18,58),(-78,-137,115)), box((68,18,58),(78,-137,115)),
    cyl(24,130,(105,72,225),sections=8), cone(38,42,(105,72,310),sections=8)
], 'Cubetown')
save('SM_CubetownHouse_B', [
    cyl(155,180,(0,0,90),sections=10), cone(210,175,(0,0,260),sections=10),
    box((68,24,110),(0,-160,55)), box((58,16,52),(-76,-155,120)), box((58,16,52),(76,-155,120))
], 'Cubetown')
save('SM_CubetownShrine', [
    cyl(185,34,(0,0,17),sections=12), cyl(120,42,(0,0,52),sections=12),
    cyl(28,210,(-105,0,150),sections=8), cyl(28,210,(105,0,150),sections=8),
    cone(48,72,(-105,0,291),sections=8), cone(48,72,(105,0,291),sections=8),
    sphere(62,(0,0,150),sub=2),
], 'Cubetown')
save('SM_CubetownTree', [
    cyl(22,160,(0,0,80),sections=8),
    sphere(85,(0,0,190),sub=1,scale=(1.0,0.88,0.92)), sphere(55,(-52,8,225),sub=1), sphere(55,(52,-2,228),sub=1),
], 'Cubetown')
save('SM_CubetownArch', [
    arch(300,80,300,52,(0,0,0)), cone(45,80,(-125,0,335),sections=8), cone(45,80,(125,0,335),sections=8)
], 'Cubetown')
save('SM_CubetownMarketStall', [
    box((260,180,30),(0,0,15)), cyl(10,190,(-110,-70,95),sections=8), cyl(10,190,(110,-70,95),sections=8),
    cyl(10,190,(-110,70,95),sections=8), cyl(10,190,(110,70,95),sections=8), wedge((300,220,90),(0,0,190))
], 'Cubetown')

print('Generated', len(list(ROOT.rglob('*.obj'))), 'OBJ assets')

# Overhaul expansion props -------------------------------------------------
save('SM_Bush_A', [
    sphere(58,(0,0,42),sub=1,scale=(1.2,0.9,0.75)),
    sphere(42,(-42,8,46),sub=1,scale=(1.0,0.9,0.9)),
    sphere(42,(44,-5,48),sub=1,scale=(1.0,0.9,0.9)),
], 'Common')
save('SM_FlowerPatch_A', [
    cyl(4,34,(-36,-20,17),sections=6), sphere(11,(-36,-20,38),sub=1),
    cyl(4,42,(0,10,21),sections=6), sphere(12,(0,10,47),sub=1),
    cyl(4,30,(32,-5,15),sections=6), sphere(10,(32,-5,34),sub=1),
    cyl(4,36,(18,28,18),sections=6), sphere(10,(18,28,40),sub=1),
], 'Common')
save('SM_MushroomCluster_A', [
    cyl(7,30,(-28,0,15),sections=7), sphere(19,(-28,0,34),sub=1,scale=(1.2,1.2,0.55)),
    cyl(6,22,(4,18,11),sections=7), sphere(15,(4,18,25),sub=1,scale=(1.2,1.2,0.55)),
    cyl(8,38,(31,-10,19),sections=7), sphere(21,(31,-10,42),sub=1,scale=(1.2,1.2,0.55)),
], 'Common')
save('SM_Fence_A', [
    box((420,22,26),(0,0,80)), box((420,22,22),(0,0,145)),
    *[box((24,28,190),(x,0,95)) for x in (-190,-95,0,95,190)]
], 'Common')

save('SM_LegionWatchtower', [
    cyl(64,330,(0,0,165),sections=10), box((185,185,42),(0,0,345)),
    cone(128,130,(0,0,430),sections=10), box((30,18,170),(0,-78,270)),
], 'Legends')
save('SM_FantasyWall', [
    box((520,80,180),(0,0,90)),
    *[box((72,92,235),(x,0,117.5)) for x in (-225,-75,75,225)],
], 'Legends')
save('SM_RiftObelisk', [
    cone(92,390,(0,0,195),sections=7), sphere(42,(0,0,405),sub=1),
    cone(34,115,(-74,0,92),sections=6), cone(34,115,(74,0,92),sections=6)
], 'Legends')

save('SM_CubetownBridge', [
    box((430,170,30),(0,0,80)),
    box((430,18,48),(0,-86,105)), box((430,18,48),(0,86,105)),
    *[cyl(8,125,(x,-82,62),sections=7) for x in (-185,-95,0,95,185)],
    *[cyl(8,125,(x,82,62),sections=7) for x in (-185,-95,0,95,185)],
], 'Cubetown')
save('SM_CubetownFountain', [
    cyl(165,32,(0,0,16),sections=14), cyl(118,28,(0,0,43),sections=14),
    cyl(24,135,(0,0,108),sections=10), sphere(45,(0,0,192),sub=1),
], 'Cubetown')
save('SM_CubetownInn', [
    box((430,310,210),(0,0,105)), wedge((500,365,190),(0,0,210)),
    box((90,26,140),(0,-170,70)), box((72,22,72),(-120,-168,130)), box((72,22,72),(120,-168,130)),
    box((250,24,48),(0,-188,255)), cyl(30,180,(150,80,300),sections=8), cone(45,46,(150,80,412),sections=8)
], 'Cubetown')
save('SM_CubetownShop', [
    box((350,260,190),(0,0,95)), wedge((410,310,145),(0,0,190)),
    box((86,26,125),(-80,-145,62)), box((125,24,82),(86,-144,112)),
    box((250,110,28),(0,-188,184)), box((20,110,105),(-120,-188,130)), box((20,110,105),(120,-188,130)),
], 'Cubetown')
save('SM_CubetownSignpost', [
    cyl(10,150,(0,0,75),sections=8), box((170,18,48),(45,0,130)), cone(18,38,(142,0,130),sections=6)
], 'Cubetown')
save('SM_CubetownGardenArch', [
    arch(270,70,265,44,(0,0,0)),
    sphere(40,(-112,0,250),sub=1), sphere(40,(112,0,250),sub=1), sphere(34,(0,0,315),sub=1)
], 'Cubetown')
save('SM_CubetownGuardian', [
    sphere(115,(0,0,135),sub=2,scale=(1.15,0.9,1.15)),
    cone(74,160,(0,0,280),sections=7),
    cone(48,130,(-120,0,145),sections=7), cone(48,130,(120,0,145),sections=7),
    sphere(30,(-48,-92,175),sub=1), sphere(30,(48,-92,175),sub=1),
], 'Cubetown')

print('Expanded total', len(list(ROOT.rglob('*.obj'))), 'OBJ assets')
# Color-separable storybook overlays. These are spawned on top of the main silhouettes
# so runtime tinting can preserve a two/three-tone Nintendo-like diorama read without textures.
save('SM_CubetownHouseRoof_A', [wedge((360,300,150),(0,0,0))], 'Cubetown')
save('SM_CubetownHouseRoof_B', [cone(210,175,(0,0,87.5),sections=10)], 'Cubetown')
save('SM_CubetownInnRoof', [wedge((500,365,190),(0,0,0))], 'Cubetown')
save('SM_CubetownShopRoof', [wedge((410,310,145),(0,0,0))], 'Cubetown')
save('SM_CubetownMarketCanopy', [wedge((300,220,90),(0,0,0))], 'Cubetown')
print('Final total', len(list(ROOT.rglob('*.obj'))), 'OBJ assets')
