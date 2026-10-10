import test from 'node:test';
import assert from 'node:assert/strict';
import { unitLabelWidth } from '../src/network/unit-label-width.mjs';

test('all desktop labels including long shielded names fit actual projected slots', () => {
  for (const gap of [58, 75, 100, 134.6875, 180]) {
    const anchors = Array.from({ length: 4 }, (_, uid) => ({ uid, seat: 0, x: 100 + gap * uid, visible: true }));
    const widths = anchors.map(anchor => unitLabelWidth(anchor, anchors));
    assert(widths.every(width => width >= 44 && width <= 128));
    for (let i=1;i<4;i++) assert((widths[i-1]+widths[i])/2 <= gap-6);
  }
});
test('hidden and opposing labels do not shrink a visible row', () => {
  const a = { uid:'a', seat:0, x:100, visible:true };
  assert.equal(unitLabelWidth(a,[a,{uid:'b',seat:1,x:100,visible:true},{uid:'c',seat:0,x:101,visible:false}]),128);
});
