import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerClock, durationText } from '../src/network/deadlines.mjs';

test('countdown follows server time and elapsed monotonic time rather than a client wall clock', () => {
  let elapsed = 123;
  const clock = new ServerClock({ now: () => elapsed });
  assert.equal(clock.remaining(100000), null);
  clock.sync(1_000_000); assert.equal(clock.remaining(1_150_000), 150);
  elapsed += 25_100; assert.equal(clock.remaining(1_150_000), 125);
  elapsed += 500_000; assert.equal(clock.remaining(1_150_000), 0);
  clock.sync(1_600_000); assert.equal(clock.remaining(1_720_000), 120, 'a server-granted question window replaces the earlier turn display');
  clock.sync(NaN); assert.equal(clock.remaining(1_720_000), 120);
  clock.reset(); assert.equal(clock.remaining(1_720_000), null);
});

test('time labels remain bounded and clearly distinguish minutes from seconds', () => {
  assert.equal(durationText(150), '2:30'); assert.equal(durationText(61), '1:01');
  assert.equal(durationText(.1), '0:01'); assert.equal(durationText(-1), '0:00'); assert.equal(durationText(NaN), '');
});
