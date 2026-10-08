import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Scene, Group, PerspectiveCamera, Mesh, SphereGeometry, BoxGeometry, PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, Texture, DoubleSide } from 'three';
import { SoftwareRenderer } from '../src/arena3d/software-renderer.mjs';

// Deterministic complete-frame reference from the pre-optimization renderer.
// No screenshots, browser state, network or GPU behavior are mocked as passed.
export function referenceFrames(Renderer) {
 const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>o[k]||(()=>{})});
 const r=new Renderer({getContext:()=>context});r.setSize(96,72);
 const scene=new Scene(),camera=new PerspectiveCamera(48,96/72,.1,30);camera.position.set(.2,.5,4.5);camera.lookAt(0,0,0);
 const fixed=new Group();const floor=new Mesh(new BoxGeometry(3,.2,1.8),new MeshStandardMaterial({color:0x678060}));floor.position.set(0,-1,0);fixed.add(floor);fixed.traverse(o=>o.userData.cpuStatic=true);scene.add(fixed);
 const smooth=new MeshStandardMaterial({color:0xad7538,roughness:.25,emissive:0x102820,emissiveIntensity:.15});smooth.userData.cpuSmooth=true;
 const shared=new SphereGeometry(.65,9,7),a=new Mesh(shared,smooth);a.position.x=-.45;scene.add(a);
 const flat=new Mesh(shared,new MeshStandardMaterial({color:0x307aab,roughness:.8}));flat.position.set(.6,-.25,.3);flat.scale.setScalar(.64);scene.add(flat);
 const texture=new Texture({width:3,height:2});texture.userData.testPixels={width:3,height:2,pixels:new Uint32Array([0xffaa6633,0,0xffffeeee,0x80447799,0xff339977,0xffddee44])};
 r.textureData=t=>t.userData.testPixels;
 const material=new MeshStandardMaterial({color:0xccddff,map:texture,side:DoubleSide,transparent:true,opacity:.72});material.userData.cpuSmooth=true;material.userData.cpuLitTexture=true;
 const plane=new Mesh(new PlaneGeometry(1.6,1.2,2,2),material);plane.position.set(.25,.16,1);plane.rotation.y=.25;scene.add(plane);
 const hashes=[];
 const capture=label=>{r.render(scene,camera);hashes.push({label,sha256:createHash('sha256').update(r.frame.data).digest('hex')});};
 capture('mixed-depth-texture-smooth-flat');capture('static-cache-reuse');
 a.rotation.set(.2,.3,.1);smooth.emissiveIntensity=.4;flat.position.x=.4;capture('material-and-pose-change');
 material.userData.cpuSmooth=false;material.opacity=.45;capture('flat-transparent-cutout');
 plane.visible=false;flat.visible=false;capture('smaller-frame-releases-texture');
 if(r.trianglePool)for(let i=r.triangleCursor;i<r.trianglePool.length;i++)assert.equal(r.trianglePool[i].texture,null);
 camera.position.x=.8;camera.lookAt(0,0,0);r.setSize(80,80);camera.aspect=1;camera.updateProjectionMatrix();capture('camera-and-size-change');
 const pool=r.trianglePool?[...r.trianglePool]:null;capture('retained-pool-reuse');
 if(pool)assert.ok(pool.every((x,i)=>r.trianglePool[i]===x));
 r.dispose();if(r.trianglePool)assert.equal(r.trianglePool.length,0);
 shared.dispose();floor.geometry.dispose();floor.material.dispose();smooth.dispose();flat.material.dispose();plane.geometry.dispose();material.dispose();texture.dispose();return hashes;
}

test('pooled CPU frames preserve exact pre-optimization pixels and release hidden textures',()=>{
 const expected=JSON.parse(readFileSync(new URL('./fixtures/software-renderer-pixels.json',import.meta.url),'utf8'));
 assert.deepEqual(referenceFrames(SoftwareRenderer),expected.frames);
});
