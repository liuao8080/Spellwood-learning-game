import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { createStoneSurfaceTexture } from '../src/arena3d/stone-surface.mjs';
import { createModelLibrary } from '../src/arena3d/models.mjs';

test('engraved stone is deterministic and opaque with a quiet low-frequency centre', () => {
  const a = createStoneSurfaceTexture(), b = createStoneSurfaceTexture();
  assert.deepEqual(a.image.data, b.image.data);
  assert.notEqual(a.image.data, b.image.data);
  assert.equal(a.image.width, 512); assert.equal(a.image.data.byteLength, 512 * 512 * 4);
  const bases = [53, 91, 85], data = a.image.data;
  let changes = 0;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4, centre = x > 102 && x < 409 && y > 102 && y < 409;
    assert.equal(data[i+3], 255);
    for (let c = 0; c < 3; c++) {
      // Decorative grooves stay outside the unit lanes. The old centre colour
      // and neighbour limits still apply; only the perimeter has carved detail.
      assert.ok(Math.abs(data[i+c] / bases[c] - 1) < (centre ? .1 : .3));
      if (centre) assert.ok(Math.abs(data[i+c] - data[i+4+c]) <= 1);
      if (data[i+c] !== bases[c]) changes++;
    }
  }
  assert.ok(changes > 1000);
  a.image.data.fill(0);
  const c = createStoneSurfaceTexture();
  assert.deepEqual(c.image.data, b.image.data, 'responsive textures cannot mutate the cached artwork or each other');
  c.dispose();
  a.dispose(); b.dispose();
});

for (const quality of ['low', 'medium']) test(`${quality} stone keeps solid bounds/slots, adds one mesh and disposes resources once`, () => {
  const plain = createModelLibrary({ quality, arenaSurface: 'plain' }), textured = createModelLibrary({ quality, arenaSurface: 'stone' });
  const a = plain.createArena(), b = textured.createArena();
  assert.equal(b.metrics.meshes, a.metrics.meshes + 1);
  assert.equal(b.metrics.triangles, a.metrics.triangles);
  assert.deepEqual(b.bounds.min.toArray(), a.bounds.min.toArray());
  assert.deepEqual(b.bounds.max.toArray(), a.bounds.max.toArray());
  assert.deepEqual(b.slots.map(row=>row.map(s=>s.position.toArray())), a.slots.map(row=>row.map(s=>s.position.toArray())));
  b.root.updateMatrixWorld(true);
  const mesh = b.root.getObjectByName('forest-table:quiet-stone');
  assert.ok(mesh); assert.equal(mesh.material.roughness, .94);
  const hit = new Raycaster(new Vector3(0,4,0), new Vector3(0,-1,0)).intersectObject(mesh)[0];
  assert.ok(hit); assert.ok(Math.abs(hit.point.y) < .005);
  for (const value of mesh.geometry.getAttribute('uv').array) assert.ok(value >= 0 && value <= 1);
  let geometry = 0, material = 0, texture = 0;
  mesh.geometry.addEventListener('dispose',()=>geometry++);
  mesh.material.addEventListener('dispose',()=>material++);
  mesh.material.map.addEventListener('dispose',()=>texture++);
  b.dispose(); b.dispose(); textured.dispose();
  assert.deepEqual([geometry,material,texture],[1,1,1]);
  let maps = 0; a.root.traverse(o=>{if(o.isMesh&&o.material.map)maps++;});
  assert.equal(maps,0); // CPU fallback has no large per-pixel mapped surface.
  plain.dispose();
});

test('library disposal and repeated responsive arena replacement release each owned surface once', () => {
  const library = createModelLibrary({ arenaSurface: 'stone' });
  const records = [];
  let previous;
  for (const [rowDepth, width, frontSlots] of [[2.12,1,null],[1.7,.9,[-5,-1.8,1.8,5]],[2.8,.72,[-6,-2,2,6]]]) {
    previous?.dispose();
    assert.equal(library.activeCount,0);
    const arena = library.createArena({rowDepth,frontSlots,backRowDepth:3.1});
    arena.root.scale.x = width;
    const mesh = arena.root.getObjectByName('forest-table:quiet-stone');
    const record = {geometry:0,material:0,texture:0}; records.push(record);
    mesh.geometry.addEventListener('dispose',()=>record.geometry++);
    mesh.material.addEventListener('dispose',()=>record.material++);
    mesh.material.map.addEventListener('dispose',()=>record.texture++);
    assert.equal(library.activeCount,1);
    previous = arena;
  }
  // Last handle is released by the library, earlier handles already released.
  library.dispose(); library.dispose(); previous.dispose();
  assert.equal(library.activeCount,0);
  for (const record of records) assert.deepEqual(record,{geometry:1,material:1,texture:1});
});
