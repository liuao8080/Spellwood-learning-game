/** Original Grove of Letters: real volumetric architecture, no backdrop image. */
import {Group,Mesh,Shape,MeshBasicMaterial,MeshStandardMaterial,BufferGeometry,Float32BufferAttribute,Sprite,SpriteMaterial,PlaneGeometry,BoxGeometry,CylinderGeometry,SphereGeometry,TorusGeometry,Vector3} from 'three';
import {ModelBuilder,taperedTube,leafSolid,roundedSlab,extrudeShape,seededRandom,geometryBudget} from './model-utils.mjs';
import {createModelLibrary} from './models.mjs';

export function createLobbyWorld({quality='low',textures=null}={}){
 const root=new Group(),fixed=new Group(),moving=new Group();root.name='grove-of-letters';fixed.name='handcrafted-forest-diorama';root.add(fixed,moving);
 const b=new ModelBuilder({quality}), random=seededRandom('grove-home-32'), resources=new Set(), matResources=new Set(), interactive=[];
 const woodMat=new MeshStandardMaterial({color:textures?0xb3a18b:0x81623e,map:textures?.get('bark')||null,roughness:.88});woodMat.userData.cpuSmooth=true;woodMat.userData.cpuLitTexture=true;matResources.add(woodMat);
 const mossMat=new MeshStandardMaterial({color:textures?0xbad0b4:0x51735a,map:textures?.get('moss')||null,roughness:.92});mossMat.userData.cpuSmooth=true;mossMat.userData.cpuLitTexture=true;matResources.add(mossMat);
 const earthMat=new MeshStandardMaterial({color:0x3f624b,roughness:.9});earthMat.userData.cpuSmooth=true;matResources.add(earthMat);
 const part=(name,parent=fixed,pos=[0,0,0])=>b.part(name,parent,pos);
 const texturedMesh=(parent,g,material)=>{resources.add(g);const m=new Mesh(g,material);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
 function barkTube(points,radii,segments,sides){const original=taperedTube(points,radii,segments,sides),p=original.attributes.position,n=original.attributes.normal,positions=[],normals=[],uv=[],indices=[];for(let i=0;i<=segments;i++)for(let j=0;j<=sides;j++){const k=i*sides+j%sides;positions.push(p.getX(k),p.getY(k),p.getZ(k));normals.push(n.getX(k),n.getY(k),n.getZ(k));uv.push(j/sides,1-i/segments);}for(let i=0;i<segments;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,c=a+sides+1;indices.push(a,a+1,c,a+1,c+1,c);}const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('normal',new Float32BufferAttribute(normals,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);original.dispose();return g;}

 const box=(p,c,pos,size,rotation=[0,0,0],style='matte')=>b.add(p,new BoxGeometry(...size),c,{position:pos,rotation,style});
 const oval=(p,c,pos,size,style='matte')=>b.oval(p,c,pos,size,{style});
 const tube=(p,c,points,radii,segments=9,sides=7)=>p.userData.bark&&Math.max(...radii)>.1?texturedMesh(p,barkTube(points,radii,segments,sides),woodMat):b.add(p,taperedTube(points,radii,segments,sides),c);
 const ring=(p,c,pos,r,tubeWidth=.035,rot=[Math.PI/2,0,0])=>b.add(p,new TorusGeometry(r,tubeWidth,4,32),c,{position:pos,rotation:rot,style:'metal'});
 const slab=(p,c,pos,w,h,d,rotation=[0,0,0])=>b.add(p,roundedSlab(w,h,d,.12,.025),c,{position:pos,rotation});
 const ground=part('moss-and-layered-stone');
 b.add(ground,new CylinderGeometry(8.3,8.8,.65,40),'#284d40',{position:[0,-.45,0],scale:[1,1,.79]});
 const turf=texturedMesh(ground,new CylinderGeometry(8.2,8.3,.16,40),[earthMat,mossMat,earthMat]);turf.position.y=-.045;turf.scale.z=.79;
 const shadows=[];
 if(textures){const shadowMat=new MeshBasicMaterial({map:textures.get('shadow'),transparent:true,opacity:.78,depthWrite:false});matResources.add(shadowMat);for(const [x,z,w,h]of[[0,-.7,4.5,4],[-2.9,4.05,2.6,1.7],[2.85,4.25,2.1,1.45],[-4.55,2,2.6,2],[4.3,2.2,2.8,2.2],[0,2.3,2.7,2]]){const shadow=texturedMesh(ground,new PlaneGeometry(w,h),shadowMat);shadow.rotation.x=-Math.PI/2;shadow.position.set(x,.042,z);shadow.userData.homeX=x;shadow.userData.homeZ=z;shadows.push(shadow);}}
 b.add(ground,new CylinderGeometry(8.65,9.4,.33,40),'#192f2c',{position:[0,-.9,0],scale:[1,1,.8]});
 for(let i=0;i<17;i++){const a=i/17*Math.PI*2;oval(ground,['#365b4b','#46644e','#7c8060'][i%3],[Math.cos(a)*7.7,-.14,Math.sin(a)*5.8],[.65+.2*random(),.26,.47+.2*random()]);}
 for(let i=0;i<6;i++)slab(ground,i%2?'#ad9c73':'#c4b48c',[Math.sin(i*.7)*.1,.03+i*.035,5.5-i*.74],1.85-i*.12,.62,.2,[-Math.PI/2,0,0]);
 for(let i=0;i<38;i++){const a=random()*Math.PI*2,r=3.3+random()*4.2;const x=Math.cos(a)*r,z=Math.sin(a)*r*.75;if(Math.abs(x)<1.8&&z>0)continue;const g=leafSolid(.28+random()*.32,.14,.028);b.add(ground,g,i%3?'#7e9f59':'#a3b867',{position:[x,.06,z],rotation:[-.2,random()*6.28,(random()-.5)*.8],style:'leaf'});}

 const tree=part('great-story-tree',fixed,[0,0,-1.4]);tree.userData.bark=true;
 tube(tree,'#6f5739',[[0,0,0],[-.4,1.6,-.05],[.28,3.2,-.18],[-.06,4.7,-.3],[.65,6.1,-.5]],[1.12,.84,.62,.44,.15],17,9);
 tube(tree,'#98704b',[[-.58,.5,.43],[-.63,1.8,.42],[.02,3.2,.41],[.1,4.9,.1]],[.22,.19,.13,.03],12,6);
 for(const side of [-1,1]){
  tube(tree,'#765b3c',[[side*.25,3.0,-.13],[side*1.15,4.3,-.2],[side*2.45,5.0,-.5],[side*3.6,5.7,-.6]],[.48,.33,.2,.035],12,7);
  tube(tree,'#8f7048',[[side*.3,4.8,-.32],[side*1.2,5.6,-1],[side*2.1,6.7,-1.2]],[.28,.17,.025],9,6);
  for(let k=0;k<3;k++){
   const a=side*(.5+k*.62),x=side*(2.2+k*.44),z=1.2+k*.55;
   tube(tree,k%2?'#886642':'#67513a',[[side*.6,.8,.15],[a,.3,.7],[x,.04,z],[x+side*.65,-.03,z+.23]],[.42,.28,.16,.025],8,6);
  }
 }
 const canopy=[[-3.2,5.7,-.65,1.7,1.2,1.4],[-1.8,6.4,-.9,2,1.5,1.55],[.1,6.9,-.5,2.1,1.45,1.6],[2.15,6.6,-1,2,1.3,1.5],[3.5,5.8,-.45,1.5,1.1,1.25],[-.6,5.4,-1.65,2.4,1.5,1.8],[1.9,5.2,-1.65,2,1.3,1.7]];
 canopy.forEach((a,i)=>{const crown=new SphereGeometry(1,22,13),p=crown.attributes.position;for(let j=0;j<p.count;j++){const x=p.getX(j),y=p.getY(j),z=p.getZ(j),r=1+.055*Math.sin(x*12+y*5)*Math.sin(z*10-y*7)+.035*Math.cos(y*15+x*4);p.setXYZ(j,x*r,y*r,z*r);}crown.computeVertexNormals();b.add(tree,crown,['#37674d','#4e8157','#658a51','#44765a'][i%4],{position:a.slice(0,3),scale:a.slice(3),style:'leaf'});
  for(let j=0;j<8;j++){const angle=j*2.4+i,dx=Math.cos(angle)*.75,dy=Math.sin(angle)*.52;for(const side of[-1,1])b.add(tree,leafSolid(.52+random()*.22,.28,.035),['#749854','#92ad63','#5e8954'][(j+i)%3],{position:[a[0]+dx*a[3],a[1]+dy*a[4],a[2]+a[5]*Math.sqrt(Math.max(.1,1-dx*dx-dy*dy))+.01],rotation:[.05,side*.15,angle+side*.4],style:'leaf'});}
 });
 for(let i=0;i<5;i++){const x=(i-2)*.17;tube(tree,'#ad8750',[[x-.15,.6,.94],[x-.3,1.2,.82],[x+.12,2.1,.73],[x,2.85,.62]],[.016,.026,.023,.012],9,4);}
 // Deep arched doorway, inset panels and bronze edging supply the central depth.
 const doorway=part('door-of-stories',fixed,[0,.25,-.31]);doorway.userData.lobbyAction='match-setup';interactive.push(doorway);
 const arch=(width,height)=>{const s=new Shape(),r=width/2;s.moveTo(-r,0);s.lineTo(r,0);s.lineTo(r,height-r);s.absarc(0,height-r,r,0,Math.PI,false);s.closePath();return s;};
 b.add(doorway,extrudeShape(arch(2.04,3.28),.40,.06,12),'#443f2d',{position:[0,0,.02]});
 b.add(doorway,extrudeShape(arch(1.82,3.1),.25,.025,12),'#b39359',{position:[0,.05,.24],style:'metal'});
 b.add(doorway,extrudeShape(arch(1.59,2.94),.17,.025,12),'#264d43',{position:[0,.09,.4]});
 for(let i=-3;i<=3;i++){const x=i*.21,h=2.1+Math.sqrt(Math.max(0,.78*.78-x*x));box(doorway,i%2?'#426854':'#395e4d',[x,.12+h/2,.51],[.195,h,.038]);}
 for(const y of[.62,1.45])box(doorway,'#8d784a',[0,y,.56],[1.52,.075,.048]);
 for(const side of[-1,1])for(const y of[.62,1.45])b.add(doorway,new CylinderGeometry(.052,.052,.03,7),'#d4bd7a',{position:[side*.56,y,.60],rotation:[Math.PI/2,0,0],style:'metal'});
 // A warm recessed window, cross bars and a leaf handle make a lived-in tree house.
 ring(doorway,'#b59b60',[0,2.25,.61],.38,.06,[0,0,0]);
 b.add(doorway,new CylinderGeometry(.34,.34,.035,22),'#e8c776',{position:[0,2.25,.58],rotation:[Math.PI/2,0,0],style:'glow'});
 box(doorway,'#596044',[0,2.25,.65],[.045,.67,.04]);box(doorway,'#596044',[0,2.25,.65],[.67,.045,.04]);
 ring(doorway,'#d5bb77',[.5,1.06,.65],.10,.025,[0,0,0]);
 b.add(doorway,leafSolid(.42,.20,.06),'#d7bd7f',{position:[.46,.9,.69],rotation:[0,0,-.35],style:'metal'});
 for(const side of[-1,1]){tube(doorway,'#687947',[[side*.94,.18,.44],[side*1.06,1.1,.4],[side*.98,2.14,.31],[side*.62,3.12,.22]],[.035,.035,.027,.009],10,5);for(let j=0;j<6;j++)b.add(doorway,leafSolid(.42,.21,.035),j%2?'#7f9b58':'#a5b96b',{position:[side*(.92+.08*Math.sin(j)),.32+j*.44,.5],rotation:[0,side*.2,side*(.6+j%2*.55)],style:'leaf'});}
 // Quiet distant trees are geometry, tinted for depth rather than a flat picture.
 for(const [x,z,sc]of[[-6.5,-3.5,.7],[6.4,-3.8,.78],[-4.6,-5,.52],[4.4,-5.7,.5]]){const t=part('distant-forest',fixed,[x,0,z]);tube(t,'#254e43',[[0,0,0],[.2,2.5,0],[-.1,5,0]],[.34,.22,.025],7,6);for(let i=0;i<3;i++)oval(t,'#2a5646',[(i-1)*1.1,3.3+i*.4,0],[1.6,1.9,1.3],'leaf');t.scale.setScalar(sc);}

 function books(p,x,y,z){for(let i=0;i<3;i++){box(p,['#334f68','#8c5942','#526a45'][i],[x,y+i*.19,z],[1.25,.17,.8],[0,(i-1)*.13,0]);box(p,'#e3d8b5',[x+.025,y+i*.19+.025,z+.05],[1.15,.09,.69],[0,(i-1)*.13,0]);}}
 const study=part('learning-books',fixed,[-4.55,.06,2.0]);study.userData.lobbyAction='study';interactive.push(study);
 b.add(study,new CylinderGeometry(.85,1,.45,10),'#5d503c',{position:[0,.22,0]});ring(study,'#b5a061',[0,.46,0],.82,.03);books(study,0,.66,0);
 tube(study,'#d2bd78',[[.43,1.2,0],[.53,1.65,0],[.7,2,0]],[.032,.022,.012],7,4);
 b.add(study,leafSolid(.7,.26,.035),'#c0d8aa',{position:[.48,1.26,.02],rotation:[0,0,-.3],style:'leaf'});
 const chest=part('learning-gift-chest',fixed,[4.3,.1,2.2]);chest.userData.lobbyAction='collection';interactive.push(chest);
 slab(chest,'#816241',[0,.55,0],1.65,1.03,1.08);box(chest,'#3b7b66',[0,.55,.566],[1.38,.78,.045]);
 for(const side of[-1,1]){box(chest,'#d3b675',[side*.53,.6,.61],[.12,1.05,.09]);box(chest,'#b89a63',[side*.53,1.11,0],[.12,.08,1.08]);}
 slab(chest,'#567d57',[0,1.12,0],1.8,1.14,.2,[-Math.PI/2,0,0]);
 b.add(chest,new CylinderGeometry(.17,.17,.07,10),'#e2cb83',{position:[0,.57,.63],rotation:[Math.PI/2,0,0],style:'metal'});
 b.add(chest,leafSolid(.29,.16,.025),'#e1eab2',{position:[0,.43,.68],style:'glow'});
 const rack=part('companions-card-rack',fixed,[-4.6,.05,-.7]);rack.userData.lobbyAction='library';interactive.push(rack);
 box(rack,'#67523b',[0,.1,0],[2,.2,1]);
 for(let i=0;i<3;i++){const card=part('wood-card',rack,[(i-1)*.55,.84,0]);card.rotation.y=(i-1)*.18;card.rotation.z=(i-1)*-.08;slab(card,'#c8b270',[0,0,0],.67,1.02,.11);slab(card,['#416852','#485b74','#744e3f'][i],[0,0,.08],.56,.89,.025);b.add(card,leafSolid(.38,.2,.05),'#ead4a0',{position:[0,-.2,.11],rotation:[0,0,-.25],style:'metal'});}

 const table=part('central-lectern');
 b.add(table,new CylinderGeometry(.7,.92,.2,14),'#8e7952',{position:[0,.13,2.25]});
 b.add(table,new CylinderGeometry(.37,.5,.76,10),'#594b39',{position:[0,.59,2.25]});
 ring(table,'#cfb67c',[0,.24,2.25],.5,.055);ring(table,'#a89a67',[0,.89,2.25],.38,.04);
 const book=part('floating-book',moving,[0,1.28,2.25]);book.userData.lobbyAction='match-setup';interactive.push(book);
 for(const side of[-1,1]){const page=part('open-book-half',book,[side*.72,0,0]);page.rotation.z=side*.13;box(page,'#335e55',[0,-.08,0],[1.46,.18,1.65]);box(page,'#d4b06b',[0,-.02,.81],[1.47,.08,.04]);box(page,'#f2e3b8',[0,.055,0],[1.33,.095,1.53]);for(let i=0;i<5;i++)box(page,'#b9b089',[0,.108,-.43+i*.2],[.87-(i%2)*.15,.008,.017]);}
 tube(book,'#bd9b58',[[0,-.05,-.83],[0,.09,0],[0,-.03,.83]],[.065,.075,.065],9,6);
 b.add(book,leafSolid(.47,.26,.04),'#c7a768',{position:[.54,.125,.17],rotation:[-Math.PI/2,0,-.4],style:'metal'});

 const glowMat=textures?new SpriteMaterial({map:textures.get('light'),transparent:true,opacity:.55,depthWrite:false}):null;if(glowMat)matResources.add(glowMat);
 const lampPoints=[[-2.0,4.4,.4],[2.75,4.9,-.7],[-5.5,1.8,3.7],[5.4,1.8,3.6]],lanterns=[];
 lampPoints.forEach((a,i)=>{const anchor=part('lantern-rope',fixed);tube(anchor,'#a59762',[[a[0],a[1]+1,a[2]],[a[0]-.07,a[1]+.55,a[2]],[a[0],a[1],a[2]]],[.014,.017,.018],6,4);const lamp=part('amber-lantern',moving,a);lanterns.push(lamp);if(glowMat){const glow=new Sprite(glowMat);glow.position.set(0,-.22,.16);glow.scale.set(1.25,1.25,1);lamp.add(glow);}b.add(lamp,new CylinderGeometry(.22,.18,.13,6),'#bc9e5f',{position:[0,.1,0],style:'metal'});b.add(lamp,new CylinderGeometry(.18,.22,.1,6),'#866841',{position:[0,-.51,0],style:'metal'});oval(lamp,'#ffe39a',[0,-.23,0],[.15,.28,.15],'glow');for(let j=0;j<4;j++){const angle=j*Math.PI/2;box(lamp,'#a88c57',[Math.sin(angle)*.18,-.23,Math.cos(angle)*.18],[.03,.5,.03]);}});
 b.compile();fixed.traverse(o=>o.userData.cpuStatic=true);fixed.userData.cpuStatic=true;

 const library=createModelLibrary({quality:'low'}),fox=library.createCreature({species:'fox'}),rabbit=library.createCreature({species:'rabbit'});
 fox.root.position.set(-2.9,.03,4.05);fox.root.scale.setScalar(.96);fox.root.rotation.y=.35;
 rabbit.root.position.set(2.85,.035,4.25);rabbit.root.scale.setScalar(.86);rabbit.root.rotation.y=-.3;
 moving.add(fox.root,rabbit.root);
 const motes=new Group();moving.add(motes);const moteGeo=leafSolid(.09,.045,.018);resources.add(moteGeo);
 const moteMat=new MeshBasicMaterial({color:0xf2d38a});matResources.add(moteMat);
 for(let i=0;i<22;i++){const m=new Mesh(moteGeo,moteMat);m.userData.home=new Vector3((random()-.5)*9,.9+random()*6,(random()-.5)*5);motes.add(m);}
 const orb=new Group();orb.name='floating-golden-letter-a';const orbMat=new MeshStandardMaterial({color:0xf4df9b,emissive:0xc59f45,emissiveIntensity:.45,metalness:.55,roughness:.3});orbMat.userData.cpuSmooth=true;matResources.add(orbMat);const legGeo=new BoxGeometry(.065,.64,.09),barGeo=new BoxGeometry(.29,.06,.085);resources.add(legGeo);resources.add(barGeo);for(const side of[-1,1]){const leg=new Mesh(legGeo,orbMat);leg.position.x=side*.115;leg.rotation.z=side*.38;orb.add(leg);}const cross=new Mesh(barGeo,orbMat);cross.position.y=-.065;orb.add(cross);orb.position.set(0,2.10,2.28);moving.add(orb);
 let disposed=false;
 return{root,staticRoot:fixed,moving,book,lanterns,props:{study,chest,rack},interactive,buddies:[fox,rabbit],
  layout(portrait,landscape=false){fox.root.scale.setScalar(.96);rabbit.root.scale.setScalar(.86);fox.root.position.z=4.05;rabbit.root.position.z=4.25;study.position.x=portrait?-2.6:-4.55;chest.position.x=portrait?2.6:4.3;rack.position.x=portrait?-2.9:-4.6;fox.root.position.x=portrait?-1.8:landscape?-4.6:-2.9;rabbit.root.position.x=portrait?1.8:landscape?4.6:2.85;study.scale.setScalar(portrait ? .79 : 1);chest.scale.setScalar(portrait ? .79 : 1);rack.scale.setScalar(portrait ? .76 : 1);shadows.forEach((shadow,i)=>{shadow.scale.setScalar(1);shadow.position.z=shadow.userData.homeZ;shadow.position.x=portrait?([0,-1.8,1.8,-2.6,2.6,0][i]):landscape&&[1,2].includes(i)?(i===1?-4.6:4.6):shadow.userData.homeX;});},
  placeBuddy(index,{x,z,scale}){const buddy=[fox,rabbit][index];if(!buddy)return;buddy.root.position.x=x;buddy.root.position.z=z;buddy.root.scale.setScalar((index?.86:.96)*scale);const shadow=shadows[index+1];if(shadow){shadow.position.x=x;shadow.position.z=z;shadow.scale.setScalar(scale);}},
  animate(time,reduced=false){const t=reduced?0:time;book.position.y=1.28+Math.sin(t*.0012)*.055;book.rotation.y=Math.sin(t*.0007)*.035;orb.position.y=2.10+Math.sin(t*.0012)*.13;orb.rotation.y=Math.sin(t*.0007)*.22;orb.rotation.z=Math.sin(t*.0009)*.04;lanterns.forEach((m,i)=>m.rotation.z=Math.sin(t*.001+i)*.055);fox.applyPose({idlePhase:t*.001,lean:0,attackProgress:0});rabbit.applyPose({idlePhase:t*.001+1.5,lean:0,attackProgress:0});motes.children.forEach((m,i)=>{const p=m.userData.home;m.position.set(p.x+Math.sin(t*.0004+i)*.16,p.y+Math.sin(t*.0007+i*1.4)*.22,p.z);m.rotation.set(t*.0004+i,t*.0006,Math.sin(t*.0008+i));});},
  metrics(){return geometryBudget(root);},
  dispose(){if(disposed)return;disposed=true;library.dispose();b.dispose();resources.forEach(x=>x.dispose());matResources.forEach(x=>x.dispose());root.clear();},
 };
}
