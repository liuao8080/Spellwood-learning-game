import test from "node:test";
import assert from "node:assert/strict";
import { SoftwareRenderer } from "../src/arena3d/software-renderer.mjs";
function renderer() {
  const canvas = { getContext: () => ({ createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4) }) }) };
  const r = new SoftwareRenderer(canvas); r.setSize(20,20); r.depths.fill(Infinity); r.pixels.fill(0xff000000); return r;
}
const triangle = (color, depth) => ({x0:1,y0:1,x1:18,y1:1,x2:1,y2:18,z0:depth,z1:depth,z2:depth,q0:1,q1:1,q2:1,color,alpha:1});
test("CPU depth preserves a near card face regardless of triangle draw order", () => {
  for (const reverse of [false,true]) {
    const r=renderer(), near=triangle(0xff0000,.2), far=triangle(0x0000ff,.5);
    for(const t of reverse?[near,far]:[far,near])r.rasterize(t);
    assert.equal(r.pixels[5*20+5],0xff0000ff); assert.ok(Math.abs(r.depths[105]-.2)<.000001);
  }
});
test("CPU texture cutouts do not hide the surface behind transparent pixels", () => {
  const r=renderer();r.rasterize(triangle(0x00ff00,.5));
  r.rasterize({...triangle(0xff0000,.2),uv:[0,0,1,0,0,1],texture:{width:1,height:1,pixels:new Uint32Array([0])}});
  assert.equal(r.pixels[105],0xff00ff00);
});
test("CPU translucent effect blends without replacing opaque depth", () => {
  const r=renderer();r.rasterize(triangle(0x0000ff,.5));r.rasterize({...triangle(0xff0000,.2),alpha:.5});
  assert.equal(r.pixels[105],0xff800080);assert.equal(r.depths[105],.5);
});
test("shared transparent edges blend exactly once", () => {
  for (const reverse of [false, true]) {
    const r = renderer();
    const a = { ...triangle(0xffffff,.2), alpha:.5 };
    const b = { ...a, x0:18,y0:1,x1:18,y1:18,x2:1,y2:18 };
    for (const item of reverse ? [b,a] : [a,b]) r.rasterize(item);
    assert.equal(r.pixels[9*20+9], 0xff808080);
    assert.equal(r.pixels[5*20+5], 0xff808080);
  }
});

test("CPU curved shading interpolates vertex colors while preserving depth", () => {
  const r=renderer();
  r.rasterize({...triangle(0xffffff,.2),shade:[255,0,0,0,255,0,0,0,255]});
  const at=(x,y)=>r.pixels[y*20+x];
  assert.notEqual(at(3,3),at(10,3));
  assert.notEqual(at(3,3),at(3,10));
  assert.ok((at(3,3)&255)>(at(10,3)&255));
  r.rasterize(triangle(0x000000,.5));
  assert.notEqual(at(3,3),0xff000000);
});


test('smooth lighting reuses stable normals but responds to rotation and material changes',async()=>{
 const {Scene,PerspectiveCamera,Mesh,SphereGeometry,MeshStandardMaterial}=await import('three');
 const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>o[k]||(()=>{})});
 const r=new SoftwareRenderer({getContext:()=>context});r.setSize(32,32);
 const scene=new Scene(),camera=new PerspectiveCamera(50,1,.1,20);camera.position.z=4;
 const geo=new SphereGeometry(.8,8,6),mat=new MeshStandardMaterial({color:0xaa7733});mat.userData.cpuSmooth=true;
 const mesh=new Mesh(geo,mat);scene.add(mesh);let reads=0;const read=geo.attributes.normal.getX.bind(geo.attributes.normal);geo.attributes.normal.getX=i=>{reads++;return read(i);};
 r.render(scene,camera);const first=reads;assert.ok(first>0);
 r.render(scene,camera);assert.equal(reads,first);
 mesh.position.x=.1;r.render(scene,camera);assert.equal(reads,first);
 mesh.rotation.y=.4;r.render(scene,camera);assert.ok(reads>first);const rotated=reads;
 mat.color.set(0x33aacc);r.render(scene,camera);assert.ok(reads>rotated);
 r.dispose();geo.dispose();mat.dispose();
});

test('authored material maps retain texture color while curved lighting varies across their surface',()=>{
 const r=renderer();
 const texture={width:1,height:1,pixels:new Uint32Array([0xff4080c0])};
 r.rasterize({...triangle(0xffffff,.2),uv:[0,0,1,0,0,1],texture,shade:[255,255,255,100,100,100,180,180,180]});
 const near=r.pixels[3*20+3],far=r.pixels[3*20+13];
 assert.ok((near&255)>(far&255));
 assert.ok((near&255)>(near>>8&255));
 assert.ok((near>>8&255)>(near>>16&255));
 assert.ok(r.depths[3*20+3]<.21);
});

test('a nested static model subtree is cached while its animated sibling keeps rendering',async()=>{
 const {Scene,Group,PerspectiveCamera,Mesh,BoxGeometry,MeshBasicMaterial}=await import('three');
 const ctx=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>o[k]||(()=>{})});
 const r=new SoftwareRenderer({getContext:()=>ctx});r.setSize(32,32);
 const scene=new Scene(),root=new Group(),fixed=new Group(),camera=new PerspectiveCamera(50,1,.1,20);camera.position.z=5;
 const geometry=new BoxGeometry(1,1,1),mat=new MeshBasicMaterial({color:0x88ccaa});
 const block=new Mesh(geometry,mat);fixed.add(block);fixed.traverse(o=>o.userData.cpuStatic=true);root.add(fixed);scene.add(root);
 const moving=new Mesh(geometry,mat);moving.position.x=1.2;root.add(moving);
 r.render(scene,camera);const cached=r.staticFrame;assert.ok(cached.triangles>0);
 moving.position.y=.4;r.render(scene,camera);assert.equal(r.staticFrame,cached);assert.ok(r.info.render.triangles>0);
 camera.position.x=.3;r.render(scene,camera);assert.notEqual(r.staticFrame,cached);
 r.dispose();geometry.dispose();mat.dispose();
});
