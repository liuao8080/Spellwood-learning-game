import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeroModel } from '../src/arena3d/hero-models.mjs';
import { getHeroSkin } from '../src/hero-skins.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const parts=model=>model.root.children.filter(o=>o.isMesh&&!o.userData.pickProxy);
for(const quality of ['low','medium']) test(`${quality} ranger seams change only existing garment colors`,()=>{
 const plain=createHeroModel('leaf_ranger',{quality,garmentDetail:false});
 const detail=createHeroModel('leaf_ranger',{quality});
 assert.equal(detail.metrics.meshes,3);assert.equal(detail.metrics.triangles,plain.metrics.triangles);
 assert.equal(detail.metrics.vertices,plain.metrics.vertices);
 let changed=0;
 for(let i=0;i<parts(plain).length;i++){
  const a=parts(plain)[i],b=parts(detail)[i];
  assert.deepEqual(a.geometry.index.array,b.geometry.index.array);
  for(const name of ['position','normal'])assert.deepEqual(a.geometry.attributes[name].array,b.geometry.attributes[name].array);
  assert.equal(a.material.roughness,b.material.roughness);assert.equal(a.material.metalness,b.material.metalness);
  const ac=a.geometry.attributes.color,bc=b.geometry.attributes.color,p=b.geometry.attributes.position;
  for(let k=0;k<p.count;k++) for(let c=0;c<3;c++){
   const av=ac.array[k*3+c],bv=bc.array[k*3+c];assert.ok(Number.isFinite(bv)&&bv>=0&&bv<=1);
   if(av!==bv){changed++;assert.ok(p.getY(k)<=1.4,'face, hair and headdress must remain unchanged');}
  }
 }
 assert.ok(changed>100);
 for(const pose of [{castProgress:.5},{hitProgress:.6},{idlePhase:1.7}]){
  plain.applyPose(pose);detail.applyPose(pose);
  for(let i=0;i<parts(plain).length;i++) for(const attr of ['position','normal'])
   assert.deepEqual(parts(plain)[i].geometry.attributes[attr].array,parts(detail)[i].geometry.attributes[attr].array);
 }
 plain.dispose();detail.dispose();
});

test('single-character treatment does not recolor other heroes',()=>{
 for(const skin of ['forest_apprentice','mushroom_keeper','copper_gardener']){
  const a=createHeroModel(skin,{garmentDetail:false}),b=createHeroModel(skin);
  for(let i=0;i<parts(a).length;i++)assert.deepEqual(parts(a)[i].geometry.attributes.color.array,parts(b)[i].geometry.attributes.color.array);
  a.dispose();b.dispose();
 }
});

test('ranger preview assets use the new cache key and match their recorded bytes',()=>{
 const skin=getHeroSkin('leaf_ranger');
 const manifest=JSON.parse(readFileSync(new URL('../dist/assets/heroes/manifest.json',import.meta.url),'utf8'));
 const row=manifest.find(item=>item.skinId===skin.id);
 assert.equal(row.assetVersion,skin.assetVersion);
 for(const type of ['thumb','portrait']){
  const url=new URL(skin[type],'http://localhost');
  assert.equal(url.searchParams.get('v'),'ranger-seams-2026-10-09');
  const bytes=readFileSync(new URL(`../dist${url.pathname}`,import.meta.url));
  assert.equal(bytes.length,row[type].bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row[type].sha256);
 }
 assert.equal(getHeroSkin('forest_apprentice').thumb,'/assets/heroes/forest_apprentice/thumb.webp');
});
