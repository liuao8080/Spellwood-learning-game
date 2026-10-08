import test from 'node:test';
import assert from 'node:assert/strict';
import {createTokenBuckets, createAttemptWindow} from '../server/admission.mjs';

const bucket = (key, capacity = 2, refillPerSecond = 0.5) => ({key, capacity, refillPerSecond});

test('token buckets admit a finite burst, refill steadily, and return the next whole retry second', () => {
  let now = 0;
  const rates = createTokenBuckets({now: () => now});
  const take = () => rates.consume([bucket('peer')]);
  assert(take().ok); assert(take().ok);
  assert.deepEqual(take(), {ok: false, retryAfter: 2});
  now = 1999; assert.deepEqual(take(), {ok: false, retryAfter: 1});
  now = 2000; assert(take().ok); assert(!take().ok);
  now = 4000; assert(take().ok); assert(!take().ok);
  now = 1e9; assert(take().ok); assert(take().ok); assert(!take().ok);
});

test('blocked peers do not drain the shared bucket, and shared exhaustion spans peers', () => {
  const rates = createTokenBuckets({now: () => 0});
  const take = peer => rates.consume([bucket(peer, 1, 1), bucket('global', 3, 1)]);
  assert(take('A').ok);
  for (let i = 0; i < 100; i++) assert(!take('A').ok);
  assert(take('B').ok); assert(take('C').ok);
  assert(!take('D').ok);
  assert.equal(rates.size, 4, 'rejected new keys never allocate state');
});

test('token memory is bounded; cleanup never resets a depleted bucket', () => {
  let now = 0;
  const rates = createTokenBuckets({now: () => now, maxKeys: 2});
  const take = key => rates.consume([bucket(key, 120, 0.5)]);
  for (let i = 0; i < 120; i++) assert(take('A').ok);
  assert(take('B').ok);
  for (let i = 0; i < 10000; i++) assert(!take(`rotating-${i}`).ok);
  assert.equal(rates.size, 2);
  now = 60000; rates.prune();
  assert.equal(rates.size, 1, 'only fully refilled B can be removed');
  for (let i = 0; i < 30; i++) assert(take('A').ok);
  assert(!take('A').ok, 'A received thirty tokens, not a new 120-token burst');
  now = 300000; rates.prune(); assert.equal(rates.size, 0);
  assert(take('C').ok);
  rates.clear(); assert.equal(rates.size, 0);
});

test('clock rollback does not produce refill credit and policy changes are rejected', () => {
  let now = 1000;
  const rates = createTokenBuckets({now: () => now});
  const take = () => rates.consume([bucket('A', 1, 1)]);
  assert(take().ok);
  now = 0; assert(!take().ok);
  now = 1000; assert(!take().ok);
  now = 2000; assert(take().ok);
  assert.throws(() => rates.consume([bucket('A', 2, 1)]), /policy changed/);
  assert.throws(() => rates.consume([bucket('B'), bucket('B')]), /Invalid admission bucket/);
  assert.throws(() => rates.consume([bucket('X'.repeat(161))]), /Invalid admission key/);
  assert.equal(rates.size, 1);
});

test('password attempts preserve an exact eight-attempt rolling minute', () => {
  let now = 0;
  const rates = createAttemptWindow({now: () => now});
  for (let i = 0; i < 8; i++) { now = i * 1000; assert(rates.consume('peer:name').ok); }
  assert.deepEqual(rates.check('peer:name'), {ok: false, retryAfter: 53});
  now = 59999; assert.deepEqual(rates.consume('peer:name'), {ok: false, retryAfter: 1});
  now = 60000; assert(rates.consume('peer:name').ok); assert(!rates.consume('peer:name').ok);
  now = 61000; assert(rates.consume('peer:name').ok);
  assert(rates.consume('peer:another').ok); assert(rates.consume('other-peer:name').ok);
});

test('password attempt keys are bounded and old entries expire without active-key eviction', () => {
  let now = 0;
  const rates = createAttemptWindow({now: () => now, maxKeys: 2});
  assert(rates.consume('A').ok); assert(rates.consume('B').ok);
  for (let i = 0; i < 10000; i++) assert(!rates.consume(`rotating-${i}`).ok);
  assert.equal(rates.size, 2);
  now = 59999; assert(!rates.consume('C').ok);
  now = 60000; assert(rates.consume('C').ok); assert.equal(rates.size, 1);
  rates.clear(); assert.equal(rates.size, 0);
});
