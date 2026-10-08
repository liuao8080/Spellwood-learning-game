/** Original, bounded mesh effects. Shared by WebGL and the depth-buffered CPU
 * renderer: no screen-space particle overlay or shader-only fallback. */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { leafSolid } from "./model-utils.mjs";

export const ELEMENT_COLORS = Object.freeze({ fire: 0xff922b, water: 0x55ccf4, nature: 0x9bd566, arcane: 0xc4a0ff });
const clamp = n => Math.max(0, Math.min(1, n));
const axis = new Vector3(0, 0, 1);
const ease = n => n * n * (3 - 2 * n);

// Eight-sided lobed tear: rounded belly, curved pointed tip, closed volume.
function tearGeometry() {
  const positions = [], indices = [], rings = [[0,.05],[.14,.26],[.40,.24],[.7,.14],[1,.005]], sides = 8;
  for (const [y,r] of rings) for (let i=0;i<sides;i++) {
    const a=i*Math.PI*2/sides;
    positions.push(Math.cos(a)*r + y*y*.14, y-.25, Math.sin(a)*r);
  }
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){
    const a=j*sides+i,b=j*sides+(i+1)%sides,c=(j+1)*sides+i,d=(j+1)*sides+(i+1)%sides;
    indices.push(a,c,b,b,c,d);
  }
  for(let i=1;i<sides-1;i++)indices.push(0,i,i+1,32,32+i+1,32+i);
  const g=new BufferGeometry();g.setAttribute("position",new Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

function effectParts() {
  const root=new Group(), geometries=new Set(), materials=new Set(); let disposed=false;
  const geometry=g=>(geometries.add(g),g);
  const material=(color,lit=false,opacity=1)=>{
    const m=lit?new MeshStandardMaterial({color,roughness:.22,metalness:.15,transparent:opacity<1,opacity}):new MeshBasicMaterial({color,transparent:opacity<1,opacity});
    if(lit)m.userData.cpuSmooth=true;
    materials.add(m);return m;
  };
  const mesh=(g,m,parent=root)=>{const o=new Mesh(g,m);parent.add(o);return o;};
  return {root,geometry,material,mesh,dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();root.clear();}};
}

/** One self-contained 820ms cast; impact() is owned by the scene's event guard. */
export function createElementalCast({ element="fire", from, to, reduced=false }={}) {
  if(!ELEMENT_COLORS[element])element="arcane";
  const fx=effectParts(),{root,geometry,material,mesh}=fx;
  root.name=`elemental-cast:${element}`;
  const color=ELEMENT_COLORS[element], charge=new Group(), missile=new Group(), impact=new Group();
  charge.name="source-charge";missile.name="flying-element";impact.name="target-impact";
  root.add(charge,missile,impact);charge.position.copy(from);impact.position.copy(to);
  const ringGeo=geometry(new TorusGeometry(.34,.024,4,22));
  const chargeMat=material(color), ring=mesh(ringGeo,chargeMat,charge);ring.rotation.x=-Math.PI/2;
  const sparkGeo=geometry(new OctahedronGeometry(.08,0));
  const chargeBits=Array.from({length:4},()=>mesh(sparkGeo,chargeMat,charge));
  const travelBits=[], trail=[], direction=to.clone().sub(from).normalize();
  const bright=material(element==="fire"?0xffe7a0:element==="water"?0xd4faff:element==="nature"?0xe8fbb1:0xf2ddff);
  const mid=material(color,element==="water"||element==="fire"), dark=material(element==="fire"?0xe7461d:element==="water"?0x178ed1:element==="nature"?0x417c44:0x8654d2,element==="fire");
  if(element==="fire"){mid.emissive.set(0x6b2105);mid.emissiveIntensity=.4;dark.emissive.set(0x621001);dark.emissiveIntensity=.3;mid.roughness=.55;dark.roughness=.65;}
  const tear=geometry(tearGeometry()), orb=geometry(new SphereGeometry(1,8,5));
  let stream=null,streamPositions=null;
  if(element==="fire") {
    const shell=mesh(orb,dark,missile);shell.scale.set(.40,.34,.40);
    const body=mesh(orb,mid,missile);body.scale.set(.32,.30,.37);body.position.set(-.07,.06,.14);
    const core=mesh(orb,bright,missile);core.scale.set(.18,.20,.21);core.position.set(-.09,.09,.30);
    for(let i=0;i<3;i++){
      const flame=mesh(tear,i===1?mid:dark,missile);flame.rotation.x=-Math.PI/2;flame.position.set((i-1)*.23,i===1?.23:-.09,-.18);travelBits.push(flame);
    }
    for(let i=0;i<5;i++){const m=mesh(tear,i%2?mid:dark);m.rotation.x=-Math.PI/2;trail.push(m);}
  }else if(element==="water") {
    const drop=mesh(orb,mid,missile);drop.scale.set(.30,.27,.44);
    const shine=mesh(orb,bright,missile);shine.position.set(-.11,.10,.12);shine.scale.set(.055,.07,.21);
    // One continuously curved liquid tube, rather than disconnected beads.
    const positions=[],normals=[],indices=[];
    for(let j=0;j<10;j++)for(let i=0;i<6;i++){positions.push(0,0,0);normals.push(1,0,0);}
    for(let j=0;j<9;j++)for(let i=0;i<6;i++){const a=j*6+i,b=j*6+(i+1)%6,c=a+6,d=b+6;indices.push(a,b,c,b,d,c);}
    const g=geometry(new BufferGeometry());g.setAttribute("position",new Float32BufferAttribute(positions,3));g.setAttribute("normal",new Float32BufferAttribute(normals,3));g.setIndex(indices);
    stream=mesh(g,mid);stream.frustumCulled=false;streamPositions=g.attributes.position;
    for(let i=0;i<3;i++)trail.push(mesh(orb,i%2?mid:bright));
  }else if(element==="nature") {
    const leaf=geometry(leafSolid(.68,.34,.09));
    for(let i=0;i<3;i++){const m=mesh(leaf,i===1?bright:mid,missile);m.rotation.set(.3,i*2.094,.2);m.position.set(Math.sin(i*2.094)*.13,0,Math.cos(i*2.094)*.13);travelBits.push(m);}
    for(let i=0;i<6;i++)trail.push(mesh(leaf,i%2?mid:dark));
  }else{
    const crystal=geometry(new OctahedronGeometry(.29,0));
    const core=mesh(crystal,bright,missile);core.scale.set(.75,.75,1.5);travelBits.push(core);
    const orbit=mesh(ringGeo,mid,missile);orbit.rotation.x=.8;travelBits.push(orbit);
    for(let i=0;i<7;i++)trail.push(mesh(sparkGeo,i%2?mid:bright));
  }
  const splashGeo=element==="water"?tear:element==="nature"?geometry(leafSolid(.23,.13,.04)):sparkGeo;
  const splash=Array.from({length:element==="fire"?10:element==="water"?6:8},(_,i)=>mesh(splashGeo,i%3?mid:bright,impact));
  const hitRing=mesh(ringGeo,mid,impact);hitRing.rotation.x=-Math.PI/2;
  const ripple=mesh(ringGeo,bright,impact);ripple.rotation.x=-Math.PI/2;ripple.position.y=-.13;
  const center=mesh(orb,bright,impact);center.scale.setScalar(.18);
  const p=new Vector3(),q=new Vector3();
  const point=(n,out)=>out.copy(from).lerp(to,n).add(new Vector3(0,Math.sin(n*Math.PI)*.65,0));
  function update(t) {
    t=clamp(t);const flight=clamp((t-.20)/.39),hit=clamp((t-.59)/.41);
    root.userData.phase=t<.20?"charge":t<.59?"flight":t<.9?"impact":"dissipate";
    charge.visible=t<.24;missile.visible=t>=.17&&t<.60;impact.visible=t>=.59;
    charge.scale.setScalar(.35+Math.sin(clamp(t/.24)*Math.PI)*.9);
    chargeBits.forEach((o,i)=>{const a=i*Math.PI/2+t*7,r=.68*(1-clamp(t/.22));o.position.set(Math.cos(a)*r,Math.sin(a)*r,.1);o.scale.setScalar(.7);});
    point(ease(flight),p);point(Math.min(1,ease(flight)+.01),q);
    missile.position.copy(p);missile.quaternion.setFromUnitVectors(axis,q.sub(p).lengthSq()>.00001?q.normalize():direction);
    missile.scale.setScalar(t<.20?.35+clamp(t/.2)*.65:1);
    travelBits.forEach((o,i)=>{if(element==="fire"){o.scale.set(.75+.12*Math.sin(t*39+i),.65+.22*Math.sin(t*31+i*2),.8);o.rotation.z=Math.sin(t*27+i)*.25;}else if(element==="arcane")o.rotation.z=t*7;else o.rotation.z=Math.sin(t*12+i)*.3;});
    if(stream){
      stream.visible=t>=.20&&t<.63;
      const side=new Vector3().crossVectors(direction,new Vector3(0,1,0)).normalize(),up=new Vector3().crossVectors(side,direction).normalize();
      for(let j=0;j<10;j++){
        const u=j/9,pathTime=clamp(ease(flight)-.23*(1-u)),radius=(.025+.19*u)*(1-clamp((t-.58)/.05));
        point(pathTime,p);p.addScaledVector(side,Math.sin(u*8-t*22)*.07*(1-u));
        for(let i=0;i<6;i++){const a=i*Math.PI/3;q.copy(p).addScaledVector(side,Math.cos(a)*radius).addScaledVector(up,Math.sin(a)*radius);streamPositions.setXYZ(j*6+i,q.x,q.y,q.z);}
      }
      streamPositions.needsUpdate=true;stream.geometry.computeVertexNormals();
    }
    trail.forEach((o,i)=>{
      const behind=(i+1)*.027,tailTime=ease(flight)-behind;
      o.visible=t>=.2&&t<.65&&tailTime>0;
      point(clamp(tailTime),o.position);point(clamp(tailTime+.008),q);q.sub(o.position).normalize();
      o.quaternion.setFromUnitVectors(new Vector3(0,1,0),q.negate());
      const fade=(1-i/(trail.length+1))*(1-clamp((t-.57)/.08));
      const size=element==="water"?.075:element==="fire"?.58:.8;
      o.scale.set(size*fade,element==="water"?.2*fade:size*fade,size*fade);
      if(element==="water")o.position.y+=.13+Math.sin(t*18+i)*.05;
      if(element==="nature")o.rotation.z+=t*9+i;
    });
    const expansion=ease(clamp(hit/.65)),fade=1-clamp((hit-.42)/.58);
    splash.forEach((o,i)=>{const a=i*2.39996,r=expansion*(.55+(i%3)*.2);o.position.set(Math.cos(a)*r,Math.sin(hit*Math.PI)*(.45+(i%4)*.16)-hit*.16,Math.sin(a)*r);o.rotation.set(i+t*4,a,t*7);const size=element==="water"?.25:.9;o.scale.set(size*fade,size*fade*(element==="water"?1.5:1),size*fade);});
    hitRing.scale.setScalar(.4+hit*3);ripple.scale.setScalar(.25+hit*3.9);
    hitRing.visible=hit>.03&&hit<.85;ripple.visible=hit>.16&&hit<.95;
    hitRing.scale.y=hitRing.scale.x*Math.max(.01,fade);ripple.scale.y=ripple.scale.x*Math.max(.01,fade);
    center.scale.setScalar(Math.sin(clamp(hit/.5)*Math.PI)*.35);center.visible=hit<.5;
    if(reduced){charge.visible=false;missile.visible=false;if(stream)stream.visible=false;trail.forEach(o=>o.visible=false);}
  }
  update(0);
  return {...fx,update,impactAt:.59,duration:820};
}

/** Small mesh motes for heals, growth, shield breaks and melee contacts. */
export function createElementalBurst({ element="nature", at, kind="damage" }={}) {
  const fx=effectParts(),{root,geometry,material,mesh}=fx;root.name=`elemental-burst:${element}:${kind}`;root.position.copy(at);
  const geo=geometry(element==="nature"?leafSolid(.22,.13,.04):new OctahedronGeometry(.095,0));
  const mat=material(ELEMENT_COLORS[element]||ELEMENT_COLORS.nature),light=material(kind==="heal"?0xd9ffd4:0xffe4a9);
  const bits=Array.from({length:10},(_,i)=>mesh(geo,i%3?mat:light));
  const ring=mesh(geometry(new TorusGeometry(.4,.023,4,24)),mat);ring.rotation.x=-Math.PI/2;
  return {...fx,update(t){const fade=1-t;bits.forEach((m,i)=>{const a=i*2.39996,r=t*(.5+i%3*.2);m.position.set(Math.cos(a)*r,(kind==="heal"||kind==="grow"?t*1.4:Math.sin(t*Math.PI)*.6),Math.sin(a)*r);m.rotation.set(t*3+i,t*5,i);m.scale.setScalar(fade);});ring.scale.setScalar(.4+t*2.3);ring.visible=t<.75;}};
}

export function createBarrierBadge() {
  const fx=effectParts(),{root,geometry,material,mesh}=fx;
  root.name="one-hit-barrier";
  const ring=mesh(geometry(new TorusGeometry(.64,.035,4,28)),material(0x78d8ef));ring.rotation.x=-Math.PI/2;ring.position.y=.1;
  const diamond=mesh(geometry(new OctahedronGeometry(.16,0)),material(0xcdf8ff));diamond.scale.set(1,1.22,.4);diamond.position.set(.55,.62,.42);
  return fx;
}
