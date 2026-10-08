import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {createLobbyWorld} from '../src/arena3d/lobby-model.mjs';

test('the forest lobby contains distinct volumetric architecture and named interactive props',()=>{
 const world=createLobbyWorld();
 const names=new Set();world.root.traverse(node=>names.add(node.name));
 for(const name of['great-story-tree','door-of-stories','floating-book','amber-lantern','floating-golden-letter-a'])assert.ok(names.has(name),name);
 const actions=new Set(world.interactive.map(node=>node.userData.lobbyAction));
 assert.deepEqual([...actions].sort(),['collection','library','match-setup','study']);
 const bounds=new Box3().setFromObject(world.root),size=bounds.getSize(new Vector3());
 assert.ok(size.x>15&&size.y>7&&size.z>10);
 assert.ok(world.metrics().triangles<30000);
 world.dispose();
});

test('portrait props remain reachable and short-landscape buddies clear the central button lane',()=>{
 const world=createLobbyWorld();
 world.layout(true);assert.equal(world.props.study.position.x,-2.6);assert.equal(world.props.chest.position.x,2.6);
 world.layout(false,true);assert.equal(world.buddies[0].root.position.x,-4.6);assert.equal(world.buddies[1].root.position.x,4.6);
 world.layout(false,false);assert.equal(world.buddies[0].root.position.x,-2.9);assert.equal(world.buddies[1].root.position.x,2.85);
 world.dispose();
});

test('lobby motion changes the book and lanterns without moving the cached island, then respects reduced motion',()=>{
 const world=createLobbyWorld();world.root.updateMatrixWorld(true);const matrix=world.staticRoot.matrixWorld.clone();
 world.animate(0);const bookY=world.book.position.y,lampAngle=world.lanterns[0].rotation.z;
 world.animate(900);assert.notEqual(world.book.position.y,bookY);assert.notEqual(world.lanterns[0].rotation.z,lampAngle);
 world.root.updateMatrixWorld(true);assert.deepEqual(world.staticRoot.matrixWorld.elements,matrix.elements);
 world.animate(1000,true);const pose=world.book.matrixWorld.clone();world.root.updateMatrixWorld(true);const y=world.book.position.y;
 world.animate(9000,true);assert.equal(world.book.position.y,y);assert.equal(world.lanterns[0].rotation.z,0);
 world.dispose();
});

test('disposing the original lobby twice releases each owned material and geometry once',()=>{
 const world=createLobbyWorld(),resources=new Set();world.root.traverse(node=>{if(node.geometry)resources.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)resources.add(material);});
 const counts=new Map();for(const resource of resources)resource.addEventListener('dispose',()=>counts.set(resource,(counts.get(resource)||0)+1));
 world.dispose();world.dispose();assert.equal(world.root.children.length,0);
 assert.equal(counts.size,resources.size);assert.ok([...counts.values()].every(value=>value===1));
});
