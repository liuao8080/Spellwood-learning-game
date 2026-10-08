import test from "node:test";
import assert from "node:assert/strict";
import { SoftwareRenderer } from "../src/arena3d/software-renderer.mjs";
function renderer() {
  const canvas = { getContext: () => ({ createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4) }) }) };
  const r = new SoftwareRenderer(canvas); r.setSize(20,20); r.depths.fill(Infinity); r.pixels.fill(0xff000000); return r;
}
const triangle = (color, depth) => ({x0:1,y0:1,x1:18,y1:1,x2:1,y2:18,z0:depth,z1:depth,z2:depth,q0:1,q1:1,q2:1,color,alpha:1});
test('direct CPU projection matches Three for ordinary and converted attributes after mutations', async () => {
  const { BufferAttribute, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Vector3 } = await import('three');
  const values = Array.from({ length: 129 * 4 }, (_, i) => Math.sin(i * 1.73) * 2);
  const custom = new BufferAttribute(new Float32Array(values), 4);
  const getX = custom.getX; custom.getX = function (i) { return getX.call(this, i) + .375; };
  const half = new Float16BufferAttribute(values.length, 4);
  for (let i = 0; i < half.count; i++) half.setXYZ(i, values[i * 4], values[i * 4 + 1], values[i * 4 + 2]);
  const attributes = [
    new BufferAttribute(new Float32Array(values), 4),
    new BufferAttribute(new Float64Array(values), 4),
    new BufferAttribute(Int16Array.from(values, n => n * 12000), 4, true),
    new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(values), 4), 3, 1),
    half, custom,
  ];
  const r = renderer(), point = new Vector3();
  const check = (attribute, width, height) => {
    const expected = new Float32Array(attribute.count * 4), actual = expected.slice(), e = r.transform.elements;
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i).applyMatrix4(r.transform);
      expected[i * 4] = (point.x + 1) * width / 2;
      expected[i * 4 + 1] = (1 - point.y) * height / 2;
      expected[i * 4 + 2] = point.z;
      expected[i * 4 + 3] = 1 / (e[3] * attribute.getX(i) + e[7] * attribute.getY(i) + e[11] * attribute.getZ(i) + e[15]);
    }
    r.projectPositions(attribute, actual, width, height);
    assert.deepEqual(new Uint8Array(actual.buffer), new Uint8Array(expected.buffer));
  };
  for (const attribute of attributes) {
    r.transform.set(1.7,.2,.3,2, .1,.9,-.1,-1, -.2,.3,.6,.5, .05,-.1,.2,2.3);
    check(attribute, 960, 600);
    attribute.setXYZ(7, -.4, .6, .12); // CPU rendering must also see unversioned data edits.
    r.transform.elements[12] = -.27;
    check(attribute, 347, 219);
  }
  r.dispose();
});
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
test('small CPU triangles retain exact general-path coverage, rounding, depth and alpha', () => {
  const actual = renderer(), expected = renderer();
  let seed = 192713;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const texture = { width: 2, height: 2, pixels: new Uint32Array([0, 0xffcc7755, 0x803366aa, 0xffffffff]) };
  for (let i = 0; i < 2048; i++) {
    const x = random() * 24 - 4, y = random() * 24 - 4;
    const t = {
      x0: x, y0: y, x1: x + random() * 6, y1: y + random() * 6,
      x2: x + random() * 6, y2: y + random() * 6,
      z0: random(), z1: random(), z2: random(), q0: .5, q1: 1, q2: .7,
      color: Math.floor(random() * 0xffffff), alpha: [1, .995, .9949, .5][i % 4],
      shade: i % 3 ? Float32Array.from({ length: 9 }, () => random() * 255) : null,
      texture: i % 7 ? null : texture, uv: [0, 0, 1, 0, 0, 1],
    };
    // Include shared/coplanar re-draws as well as clipped and subpixel faces.
    for (let repeat = 0; repeat < 2; repeat++) {
      actual.rasterize(t); expected.rasterizeGeneral(t);
    }
    if (i % 32 === 31) {
      assert.deepEqual(actual.pixels, expected.pixels);
      assert.deepEqual(new Uint8Array(actual.depths.buffer), new Uint8Array(expected.depths.buffer));
      for (const r of [actual, expected]) { r.pixels.fill(0xff000000); r.depths.fill(Infinity); }
    }
  }
  actual.dispose(); expected.dispose();
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

test('lighting cache invalidates every light, attribute and material input like a fresh renderer', async () => {
  const { Scene, PerspectiveCamera, Mesh, SphereGeometry, MeshStandardMaterial, Float32BufferAttribute } = await import('three');
  const context = () => new Proxy({ createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4) }) }, { get: (o,k) => o[k] || (() => {}) });
  const make = () => { const r = new SoftwareRenderer({ getContext: context }); r.setSize(48, 48); return r; };
  const r = make(), scene = new Scene(), camera = new PerspectiveCamera(50, 1, .1, 20); camera.position.z = 4;
  const geometry = new SphereGeometry(.8, 8, 6), material = new MeshStandardMaterial({ color: 0xaa7733 }); material.userData.cpuSmooth = true;
  const mesh = new Mesh(geometry, material); scene.add(mesh);
  const changes = [
    () => {}, () => { mesh.rotation.y = .32; }, () => { mesh.scale.set(1.1, .8, 1.3); },
    () => material.color.set(0x8899cc), () => { material.emissive.set(0x224499); material.emissiveIntensity = .4; },
    () => { material.roughness = .2; }, () => { r.light.set(.2, .7, -.3).normalize(); },
    () => { r.highlight.set(-.6, .1, .7).normalize(); },
    () => { geometry.setAttribute('color', new Float32BufferAttribute(Array.from({ length: geometry.attributes.position.count * 3 }, (_, i) => .2 + i % 5 * .15), 3)); material.vertexColors = true; },
    () => { geometry.attributes.color.setXYZ(12, .9, .1, .4); geometry.attributes.color.needsUpdate = true; },
    () => { geometry.attributes.normal.setXYZ(12, -.6, .8, .2); geometry.attributes.normal.needsUpdate = true; },
    () => { geometry.setAttribute('normal', geometry.attributes.normal.clone()); },
    () => { material.vertexColors = false; },
  ];
  for (const change of changes) {
    change(); r.render(scene, camera);
    const fresh = make(); fresh.light.copy(r.light); fresh.highlight.copy(r.highlight); fresh.render(scene, camera);
    assert.deepEqual(r.pixels, fresh.pixels); assert.deepEqual(r.depths, fresh.depths); fresh.dispose();
  }
  r.dispose(); geometry.dispose(); material.dispose();
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
