import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelLibrary } from '../src/arena3d/models.mjs';
import { Vector3, Box3 } from 'three';

for(const quality of ['low','medium'])test(`${quality} raised hedgehog face preserves geometry, envelope and existing pose joints`,()=>{
 const library=createModelLibrary({quality});
 const before=library.createCreature({species:'hedgehog',faceDetail:false,variantSeed:1});
 const after=library.createCreature({species:'hedgehog',faceDetail:true,variantSeed:1});
 try {
  assert.deepEqual(after.metrics,before.metrics);
  for(const axis of ['x','y','z']){
   assert.ok(after.bounds.min[axis]>=before.bounds.min[axis]-1e-5,`${axis} minimum remains inside old envelope`);
   assert.ok(after.bounds.max[axis]<=before.bounds.max[axis]+1e-5,`${axis} maximum remains inside old envelope`);
  }
  for(const name of Object.keys(before.anchors))assert.deepEqual(after.anchors[name].position.toArray(),before.anchors[name].position.toArray());
  const joint=after.root.getObjectByName('hedgehog-face'),staticFace=after.root.getObjectByName('hedgehog-raised-face');
  for(const idlePhase of [0,1,2,3,4,5,6])for(const attackProgress of [0,.25,.5,.75,1]){
   before.applyPose({idlePhase,attackProgress});after.applyPose({idlePhase,attackProgress});
   assert.equal(staticFace.rotation.x,-.18);assert.deepEqual(joint.rotation.toArray(),before.root.getObjectByName('hedgehog-face').rotation.toArray());
   const center=joint.getWorldPosition(new Vector3());assert.ok(Number.isFinite(center.y));
   before.root.updateMatrixWorld(true);after.root.updateMatrixWorld(true);
   const oldPose=new Box3().setFromObject(before.root),newPose=new Box3().setFromObject(after.root);
   for(const axis of ['x','y','z']){
    assert.ok(newPose.min[axis]>=oldPose.min[axis]-1e-5,`${axis} pose minimum at ${idlePhase}/${attackProgress}`);
    assert.ok(newPose.max[axis]<=oldPose.max[axis]+1e-5,`${axis} pose maximum at ${idlePhase}/${attackProgress}: ${newPose.max[axis]} versus ${oldPose.max[axis]}`);
   }
  }
 } finally {before.dispose();after.dispose();library.dispose();}
});
test('face reference option does not change other creatures',()=>{
 const library=createModelLibrary({quality:'low'}),a=library.createCreature({species:'fox',faceDetail:false}),b=library.createCreature({species:'fox'});
 try{assert.deepEqual(a.metrics,b.metrics);assert.deepEqual([a.bounds.min.toArray(),a.bounds.max.toArray()],[b.bounds.min.toArray(),b.bounds.max.toArray()]);}
 finally{library.dispose();}
});
