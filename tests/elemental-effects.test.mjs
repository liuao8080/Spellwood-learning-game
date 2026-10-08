import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { createElementalCast } from "../src/arena3d/elemental-effects.mjs";
for(const element of ["fire","water","nature","arcane"])test(`${element} has depth-tested mesh charge, flight, impact and cleanup`,()=>{
  const fx=createElementalCast({element,from:new Vector3(-3,1,2),to:new Vector3(3,1,-2)});
  const phases=[[.1,"charge"],[.4,"flight"],[.7,"impact"],[.94,"dissipate"]];
  let maximum=0;
  for(const [t,phase]of phases){
    fx.update(t);assert.equal(fx.root.userData.phase,phase);
    let triangles=0,visible=0;
    fx.root.traverseVisible(o=>{assert(!o.isPoints&&!o.isSprite&&!o.isLine);if(!o.isMesh)return;visible++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;assert(o.material.depthTest);assert([...o.position,...o.scale,...o.quaternion].every(Number.isFinite));assert([...o.geometry.attributes.position.array].every(Number.isFinite));});
    assert(visible>0);maximum=Math.max(maximum,triangles);
  }
  for(let i=0;i<=100;i++){fx.update(i/100);let triangles=0;fx.root.traverseVisible(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});maximum=Math.max(maximum,triangles);}
  assert(maximum<=1000,`visible geometry is bounded: ${maximum}`);
  fx.update(.1);const start=fx.root.getObjectByName("flying-element").position.clone();
  fx.update(.4);assert(fx.root.getObjectByName("flying-element").position.distanceTo(start)>2);
  const geometries=new Set();fx.root.traverse(o=>o.geometry&&geometries.add(o.geometry));let released=0;for(const g of geometries)g.addEventListener("dispose",()=>released++);
  fx.dispose();fx.dispose();assert.equal(released,geometries.size);assert.equal(fx.root.children.length,0);
});
