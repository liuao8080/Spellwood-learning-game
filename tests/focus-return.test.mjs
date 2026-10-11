import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreModalOpener } from '../src/network/focus-return.mjs';
const element = (dataset = {}) => ({ dataset, isConnected: true, disabled: false, blocked: false, painted: true, calls: [], ownerDocument: {activeElement:null},
 closest() { return this.blocked ? {} : null; }, getClientRects() { return this.painted ? [{}] : []; },
 focus(options) { this.calls.push(options);if(!this.refuseFocus)this.ownerDocument.activeElement=this; } });
test('an inert hand cannot receive return focus until background sync removes the block',()=>{
 const canvas=element(),opener={element:canvas};canvas.blocked=true;
 assert.equal(restoreModalOpener(opener),null);assert.equal(canvas.calls.length,0);
 canvas.blocked=false;assert.equal(restoreModalOpener(opener),canvas);assert.deepEqual(canvas.calls,[{preventScroll:true}]);
});
test('a connected semantic opener is retained without selecting or substituting another card',()=>{
 const original=element(),other=element();assert.equal(restoreModalOpener({element:original},[other],other),original);
 assert.equal(original.calls.length,1);assert.equal(other.calls.length,0);
});
test('removed or disabled controls resolve only to the same complete action identity',()=>{
 const old=element(),wrong=element({action:'unit',uid:'other',seat:'0'}),same=element({action:'unit',uid:'current',seat:'0'});
 const opener={element:old,action:'unit',uid:'current',seat:'0'};old.isConnected=false;
 assert.equal(restoreModalOpener(opener,[wrong,same]),same);assert.equal(wrong.calls.length,0);
 old.isConnected=true;old.disabled=true;assert.equal(restoreModalOpener(opener,[same]),same);
});
test('a missing opener uses only an available fallback; hidden or inert fallback is skipped',()=>{
 const old=element(),canvas=element();old.isConnected=false;
 assert.equal(restoreModalOpener({element:old},[],canvas),canvas);
 canvas.painted=false;assert.equal(restoreModalOpener({element:old},[],canvas),null);
 canvas.painted=true;canvas.blocked=true;assert.equal(restoreModalOpener({element:old},[],canvas),null);
});
test('no closing opener does not move focus during a dialog refresh or nested transition',()=>{
 const control=element();assert.equal(restoreModalOpener(null,[control],control),null);assert.equal(control.calls.length,0);
});
test('a browser-refused focus attempt continues to the available fallback',()=>{
 const hiddenByStyle=element(),fallback=element();hiddenByStyle.refuseFocus=true;
 assert.equal(restoreModalOpener({element:hiddenByStyle},[],fallback),fallback);
 assert.equal(hiddenByStyle.calls.length,1);assert.equal(fallback.ownerDocument.activeElement,fallback);
});
