import * as THREE from '../../vendor/three.module.min.js';

// Original geometry. The simulation owns all positions, health, resources and orders.
export function createBattlefield3D() {
  const canvas = document.createElement('canvas');
  canvas.id = 'battlefield3d'; canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#b8ced0');
  scene.fog = new THREE.Fog('#b8ced0', 2400, 5200);
  const view = new THREE.OrthographicCamera(-800,800,500,-500,1,6500);
  scene.add(new THREE.HemisphereLight('#dbeaff','#6c7850',2.5));
  const sun = new THREE.DirectionalLight('#fff1cf',3.4);
  sun.position.set(-500,1600,400); sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-1600; sun.shadow.camera.right=1600;
  sun.shadow.camera.top=1600; sun.shadow.camera.bottom=-1600; sun.shadow.camera.far=5000;
  sun.shadow.normalBias=2; scene.add(sun); scene.add(sun.target);
  const mats = new Map(), shapes = new Map(), objects = new Map();
  const material = color => { if(!mats.has(color)) mats.set(color,new THREE.MeshStandardMaterial({color,roughness:.93})); return mats.get(color); };
  const geometry = (key,make) => {if(!shapes.has(key))shapes.set(key,make());return shapes.get(key);};
  const boxGeo=geometry('box',()=>new THREE.BoxGeometry(1,1,1));
  const sphereGeo=geometry('sphere',()=>new THREE.IcosahedronGeometry(1,1));
  const coneGeo=geometry('cone',()=>new THREE.ConeGeometry(1,1,4));
  const cylinderGeo=geometry('cylinder',()=>new THREE.CylinderGeometry(1,1,1,8));
  function part(group,geo,color,x,y,z,sx,sy,sz,shadow=true) {
    const mesh=new THREE.Mesh(geo,material(color)); mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);
    mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);return mesh;
  }
  const box=(g,c,x,y,z,sx,sy,sz,shadow)=>part(g,boxGeo,c,x,y,z,sx,sy,sz,shadow);
  const ground=new THREE.Group();scene.add(ground);
  box(ground,'#73905b',1600,-18,1050,4200,30,3100,false);
  // Patchwork fields, footpaths and distant woodland give the map readable scale.
  const random=(i)=>{const v=Math.sin(i*127.1+41.7)*43758.5453;return v-Math.floor(v);};
  const patches=new THREE.InstancedMesh(boxGeo,material('#80985e'),280);
  const transform=new THREE.Object3D();
  for(let i=0;i<280;i++){
    transform.position.set(random(i)*4000-400,-2,random(i+1401)*2900-400);
    transform.scale.set(40+random(i+2)*130,.6,25+random(i+3)*90);transform.rotation.y=random(i+4)*3;
    transform.updateMatrix();patches.setMatrixAt(i,transform.matrix);
  } ground.add(patches);
  box(ground,'#b4a47b',1010,-.8,1100,1050,1,68,false);
  box(ground,'#b4a47b',2280,-.8,1040,1000,1,68,false);
  const river=box(ground,'#4b929e',1610,-2,1050,260,3,2900,false);
  river.material = new THREE.MeshStandardMaterial({color:'#599fa9',roughness:.25,metalness:.32});
  for(const [top,bottom] of [[460,610],[1320,1470]]){
    const bridge=new THREE.Group();ground.add(bridge);bridge.position.set(1610,0,(top+bottom)/2);
    box(bridge,'#9b917c',0,6,0,335,13,bottom-top,false);
    for(const z of [-1,1]){
      box(bridge,'#b4a891',0,20,z*(bottom-top)/2,340,24,9);
      for(let x=-150;x<=150;x+=30)box(bridge,'#c7baa0',x,36,z*(bottom-top)/2,17,12,13);
    }
    for(let x=-130;x<=130;x+=65)box(bridge,'#827a69',x,-7,0,25,24,bottom-top-15);
  }
  function tree(group,x,z,size=1){
    part(group,cylinderGeo,'#63503a',x,20*size,z,5*size,40*size,5*size,false);
    part(group,sphereGeo,'#365b35',x,56*size,z,29*size,42*size,28*size);
    part(group,sphereGeo,'#527340',x+12*size,47*size,z-8*size,25*size,26*size,26*size);
  }
  for(let i=0;i<65;i++){
    const x=random(i+4000)*3600-200,z=random(i+5000)*2500-200;
    if(x<50||x>3150||z<100||z>2000)tree(ground,x,z,.9+random(i+6000)*.8);
  }
  function flag(group,color,x,y,z){
    part(group,cylinderGeo,'#73634a',x,y/2,z,1.8,y,1.8);
    const cloth=box(group,color,x+13,y-10,z,26,18,1,false);cloth.userData.flag=true;
  }
  function house(group,size,team,tall=false){
    const timber='#66503b', plaster='#dfcda5', roof=team==='player'?'#42667a':'#8c4d44';
    const height=size*(tall?1.15:.65);
    box(group,'#918777',0,4,0,size*1.8,8,size*1.42);
    box(group,plaster,0,height/2+7,0,size*1.5,height,size*1.12);
    for(const x of [-.7,0,.7])box(group,timber,x*size,height/2+7,size*.57,4,height+2,4);
    for(const y of [height*.27,height*.8])box(group,timber,0,y+7,size*.58,size*1.5,4,4);
    const r=part(group,coneGeo,roof,0,height+size*.34,0,size*1.2,size*.68,size*.95);r.rotation.y=Math.PI/4;
    box(group,'#3d372d',0,18,size*.58,size*.23,34,2);
    for(const x of [-.45,.45]){
      box(group,timber,x*size,height*.6,size*.58,size*.23,size*.24,3);
      box(group,'#f4cb70',x*size,height*.6,size*.6,size*.14,size*.16,2,false);
    }
    box(group,'#8f8373',size*.48,height+15,-size*.28,size*.18,size*.7,size*.18);
  }
  function tower(group,x,z,size,color){
    box(group,'#bbb39d',x,size*.8,z,size*.7,size*1.6,size*.7);
    box(group,'#8f9185',x,size*1.55,z,size*.85,size*.14,size*.85);
    for(const dx of [-1,1])for(const dz of [-1,1])box(group,'#d1c8af',x+dx*size*.3,size*1.75,z+dz*size*.3,size*.22,size*.3,size*.22);
    box(group,'#364147',x,size*.9,z+size*.36,size*.12,size*.35,2);
    flag(group,color,x,size*2.4,z);
  }
  function buildingModel(entity,definitions){
    const group=new THREE.Group(),s=definitions[entity.type].size;
    const color=entity.team==='player'?'#3e88b2':'#bd5146';
    if(entity.type==='citadel'){
      house(group,s*.92,entity.team,true);
      for(const x of [-1,1])for(const z of [-1,1])tower(group,x*s*.85,z*s*.62,s*.58,color);
      box(group,'#b1a68f',0,22,s*.9,s*1.5,42,16);
      box(group,'#4d4031',0,20,s*.99,s*.38,38,4);
      flag(group,color,0,s*2.4,0);
    }else if(entity.type==='tower')tower(group,0,0,s,color);
    else if(entity.type==='wall'){
      box(group,'#a9a58e',0,22,0,s*2,44,s*.5);
      for(let i=-2;i<=2;i++)box(group,'#c4bba0',i*s*.4,49,0,s*.25,16,s*.6);
    }else if(entity.type==='dock'){
      box(group,'#816145',0,5,0,s*2,12,s*1.35);house(group,s*.6,entity.team);
      for(let i=-2;i<=2;i++)box(group,'#5a4433',i*s*.4,9,s*.8,6,28,8);
    }else {
      house(group,s,entity.team,entity.type==='barracks');
      if(entity.type==='range')for(let i=0;i<3;i++){
        part(group,cylinderGeo,'#ddd2a5',s*(i*.45-.45),26,s*.95,14,5,14).rotation.x=Math.PI/2;
        part(group,cylinderGeo,color,s*(i*.45-.45),26,s*.99,6,6,6).rotation.x=Math.PI/2;
      }
      if(entity.type==='market')for(let i=-1;i<=1;i++){
        box(group,'#77563d',i*s*.6,13,s,22,26,20);box(group,i%2?color:'#dac593',i*s*.6,36,s,27,5,24);
      }
      if(entity.type==='workshop')for(const x of [-1,1])part(group,cylinderGeo,'#554839',x*s*.8,18,s*.6,17,8,17).rotation.z=Math.PI/2;
      flag(group,color,-s*.75,s*1.5,-s*.5);
    }
    return group;
  }
  function unitModel(entity){
    const g=new THREE.Group(),team=entity.team==='player'?'#397fb2':'#b44437';
    if(entity.type==='ship'){
      box(g,'#654a31',0,10,0,24,18,65);
      part(g,coneGeo,'#866743',0,9,-38,18,22,18).rotation.x=-Math.PI/2;
      part(g,cylinderGeo,'#5b4935',0,43,0,2,80,2);
      box(g,'#e6d6ac',0,55,3,44,41,2);flag(g,team,0,90,0);
    }else if(entity.type==='catapult'){
      box(g,'#735338',0,15,0,25,8,35);
      for(const x of [-1,1])for(const z of [-1,1])part(g,cylinderGeo,'#3b352d',x*15,9,z*13,9,4,9,false).rotation.z=Math.PI/2;
      const arm=box(g,'#b99559',0,30,0,5,5,52);arm.rotation.x=-.5;
      box(g,'#6f6b62',0,40,-23,12,8,12);
    }else{
      const horse=entity.type==='cavalry',base=horse?19:0;
      if(horse){
        box(g,'#806447',0,16,0,14,15,30);
        for(const x of [-1,1])for(const z of [-1,1])box(g,'#443a2d',x*5,7,z*10,3,14,3,false);
        box(g,'#806447',0,25,-16,9,20,10);
      }
      for(const x of [-1,1]){const leg=box(g,'#4e493e',x*4,7+base,0,5,14,5,false);g.userData.legs??=[];g.userData.legs.push(leg);}
      box(g,entity.type==='worker'?'#b6a478':team,0,21+base,0,13,17,9,false);
      part(g,sphereGeo,'#d9b98d',0,35+base,0,6,7,6,false);
      if(entity.type!=='worker')part(g,sphereGeo,'#b8bfbb',0,39+base,0,7,5,7,false);
      const arm=box(g,team,-9,23+base,0,5,15,5,false);g.userData.arm=arm;
      if(entity.type==='sword'){box(g,'#b8c5c9',10,28+base,-8,3,25,3,false);box(g,team,-10,24+base,-4,3,18,15,false);}
      if(entity.type==='archer'){const bow=part(g,geometry('bow',()=>new THREE.TorusGeometry(11,1.3,4,12,Math.PI)),'#7a5a31',9,24+base,0,1,1,1,false);bow.rotation.y=Math.PI/2;}
      if(entity.type==='worker')box(g,'#756343',10,23,-6,3,26,3,false);
      if(horse)box(g,'#b9b4a0',10,37,-13,3,47,3,false);
    }
    return g;
  }
  function nodeModel(node){
    const g=new THREE.Group();
    if(node.type==='wood'){tree(g,-12,0,1.05);tree(g,18,16,.8);}
    else if(node.type==='food'){
      for(let i=0;i<5;i++){
        const a=i*2.4;part(g,sphereGeo,'#507340',Math.cos(a)*14,10,Math.sin(a)*14,13,14,13);
        part(g,sphereGeo,'#9d453b',Math.cos(a)*17,16,Math.sin(a)*17,4,4,4,false);
      }
    }else for(let i=0;i<5;i++){
      const a=i*2.4;part(g,sphereGeo,node.type==='gold'?'#a89763':'#92968d',Math.cos(a)*16,8+i*2,Math.sin(a)*16,13+i*2,12+i*2,13);
      if(node.type==='gold')part(g,sphereGeo,'#dbbf62',Math.cos(a)*13,16+i*3,Math.sin(a)*13,5,4,5,false);
    }
    return g;
  }
  function batchStatic(group){
    group.updateMatrixWorld(true);const buckets=new Map(),alreadyInstanced=[];
    group.traverse(mesh=>{
      if(mesh.isInstancedMesh){alreadyInstanced.push(mesh);return;}
      if(!mesh.isMesh)return;
      const key=mesh.geometry.uuid+mesh.material.uuid+mesh.castShadow;
      if(!buckets.has(key))buckets.set(key,{geometry:mesh.geometry,material:mesh.material,shadow:mesh.castShadow,matrices:[],entityIds:[]});
      buckets.get(key).matrices.push(mesh.matrixWorld.clone());
      let owner=mesh;while(owner&&!owner.userData.entityId)owner=owner.parent;
      buckets.get(key).entityIds.push(owner?.userData.entityId||null);
    });
    group.clear();
    for(const bucket of buckets.values()){
      const instances=new THREE.InstancedMesh(bucket.geometry,bucket.material,bucket.matrices.length);
      bucket.matrices.forEach((matrix,i)=>instances.setMatrixAt(i,matrix));
      instances.userData.entityIds=bucket.entityIds;instances.receiveShadow=true;instances.castShadow=bucket.shadow;group.add(instances);
    }
    alreadyInstanced.forEach(mesh=>group.add(mesh));
  }
  batchStatic(ground);
  const resourceLayer=new THREE.Group();scene.add(resourceLayer);let resourceKey='',resourceCount=0;
  let width=0,height=0,enabled=true,available=true,drawCalls=0;
  const vector=new THREE.Vector3(),ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  function syncCamera(camera,w,h){
    if(width!==w||height!==h){width=w;height=h;renderer.setSize(w,h,false);}
    view.left=-w/(2*camera.zoom);view.right=-view.left;view.top=h/(2*camera.zoom);view.bottom=-view.top;
    view.position.set(camera.x,1300,camera.y+1000);view.lookAt(camera.x,0,camera.y);view.updateProjectionMatrix();view.updateMatrixWorld();
    sun.position.set(camera.x-600,1600,camera.y-300);sun.target.position.set(camera.x,0,camera.y);
  }
  function worldToScreen(x,y){vector.set(x,0,y).project(view);return{x:(vector.x+1)*width/2,y:(1-vector.y)*height/2};}
  function screenToWorld(x,y){ray.setFromCamera(new THREE.Vector2(x/width*2-1,1-y/height*2),view);ray.ray.intersectPlane(plane,vector);return{x:vector.x,y:vector.z};}
  function pickEntity(x,y){
    ray.setFromCamera(new THREE.Vector2(x/width*2-1,1-y/height*2),view);
    const hits=ray.intersectObjects([...objects.values(),resourceLayer],true);
    for(const hit of hits){
      if(hit.instanceId!==undefined&&hit.object.userData.entityIds?.[hit.instanceId])return hit.object.userData.entityIds[hit.instanceId];
      let owner=hit.object;while(owner&&!owner.userData.entityId)owner=owner.parent;
      if(owner)return owner.userData.entityId;
    }
    return null;
  }
  function render(state){
    syncCamera(state.camera,state.width,state.height);
    const activeNodes=state.nodes.filter(n=>n.amount>0),key=activeNodes.map(n=>n.id+':'+n.x+':'+n.y).join('|');
    if(key!==resourceKey){
      resourceLayer.clear();resourceKey=key;resourceCount=activeNodes.length;
      for(const node of activeNodes){const g=nodeModel(node);g.userData.entityId=node.id;g.position.set(node.x,0,node.y);resourceLayer.add(g);}
      batchStatic(resourceLayer);
    }
    const live=new Set();
    const entities=[...state.buildings,...state.units];
    for(const e of entities){
      live.add(e.id);let g=objects.get(e.id);
      const modelKey=e.type+e.team+(e.id.startsWith('building')?state.age:'');
      if(g&&g.userData.modelKey!==modelKey){scene.remove(g);objects.delete(e.id);g=null;}
      if(!g){g=e.id.startsWith('building')?buildingModel(e,state.definitions):e.id.startsWith('unit')?unitModel(e):nodeModel(e);g.userData.entityId=e.id;g.userData.modelKey=modelKey;scene.add(g);objects.set(e.id,g);}
      g.position.set(e.x,0,e.y);
      if(e.id.startsWith('unit')){
        g.rotation.y=-e.facing-Math.PI/2;
        const moving=e.order!=='idle'&&Math.hypot(e.x-e.targetX,e.y-e.targetY)>10;
        const stride=moving?Math.sin(state.elapsed*10+e.x*.01)*.5:0;
        g.userData.legs?.forEach((leg,i)=>leg.rotation.x=stride*(i?1:-1));
        if(g.userData.arm)g.userData.arm.rotation.x=e.order==='gather'?Math.sin(state.elapsed*7)*.8:stride*.5;
      }
      if(e.construction!==undefined)g.scale.y=.12+.88*e.construction;
      if(e.team){
        if(!g.userData.ring){
          const ring=new THREE.Mesh(geometry('ring',()=>new THREE.RingGeometry(1,1.12,40)),new THREE.MeshBasicMaterial({color:e.team==='player'?'#9de7ff':'#fa8f75',side:THREE.DoubleSide,transparent:true,opacity:.9}));
          ring.rotation.x=-Math.PI/2;ring.position.y=2;const r=e.id.startsWith('building')?state.definitions[e.type].size*1.15:19;ring.scale.setScalar(r);g.add(ring);g.userData.ring=ring;
        } g.userData.ring.visible=state.selected.has(e.id);
      }
      g.traverse(o=>{if(o.userData.flag)o.rotation.y=Math.sin(state.elapsed*2+e.x)*.14;});
    }
    for(const [id,g] of objects)if(!live.has(id)){scene.remove(g);g.traverse(o=>{if(o.userData.ring)o.userData.ring.material.dispose();});objects.delete(id);}
    renderer.render(scene,view);drawCalls=renderer.info.render.calls;
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();available=false;enabled=false;canvas.hidden=true;document.dispatchEvent(new CustomEvent('battlefield-context-lost'));});
  canvas.addEventListener('webglcontextrestored',()=>{available=true;document.dispatchEvent(new CustomEvent('battlefield-context-lost'));});
  return {render,syncCamera,worldToScreen,screenToWorld,pickEntity,get available(){return available;},get enabled(){return enabled;},set enabled(value){enabled=Boolean(value)&&available;canvas.hidden=!enabled;},diagnostics:()=>({engine:'Three.js WebGL',objects:objects.size+resourceCount,drawCalls,triangles:renderer.info.render.triangles})};
}
