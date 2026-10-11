import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafeTraceSummary } from '../scripts/safe-trace-summary.mjs';
test('trace summary rejects arbitrary names and retains only numeric allowlisted complete slices',()=>{
 const s=createSafeTraceSummary();s.add([{name:'Paint',ph:'X',dur:300000,args:{url:'private',token:'secret'}},{name:'Paint',ph:'X',dur:1000},{name:'secret',ph:'X',dur:9},{name:'Paint',ph:'B',ts:99},{name:'Paint',ph:'X',dur:NaN}]);
 const x=s.result();assert.equal(x.seen,5);assert.equal(x.accepted,2);assert.deepEqual(x.events.Paint,{count:2,totalMs:301,maximumMs:300,over50Ms:1,over250Ms:1});assert(!JSON.stringify(x).includes('secret'));assert(!JSON.stringify(x).includes('private'));
});
