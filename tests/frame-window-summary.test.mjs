import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrameWindow } from '../scripts/frame-window-summary.mjs';
const samples=times=>times.map(elapsedMs=>({elapsedMs,timing:{updateMs:2,submitMs:3}}));
test('fixed click window retains stalls crossing either boundary and excludes distant cleanup',()=>{
 const x=summarizeFrameWindow(samples([0,100,500,3000,3400,9000]),200);
 assert.equal(x.maximumOverlappingRafGapMs,2500);assert.equal(x.boundarySpanningGaps.length,2);
 assert.equal(x.sampleCount,2);assert.equal(x.uncoveredTailMs,200);assert.equal(x.tailBracketed,true);
 assert.equal(x.afterWindowSampleCount,2);assert.equal(x.beforeClickSampleCount,2);
});
test('missing post-window RAF reports an unbracketed tail',()=>{
 const x=summarizeFrameWindow(samples([0,100,1000]),100);
 assert.equal(x.tailBracketed,false);assert.equal(x.uncoveredTailMs,2100);
 assert.equal(summarizeFrameWindow([],100).maximumOverlappingRafGapMs,null);
});
