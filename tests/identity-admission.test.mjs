import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createGameServer} from '../server/index.mjs';
import {createPasswordService} from '../server/passwords.mjs';
import {Client} from './network-helpers.mjs';

const passwords = createPasswordService({scryptParameters: {N: 1024, r: 1, p: 1}});
const name = index => 'Fictional' + String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26);

async function server(t, identityOptions = {}) {
  const clock = {value: 0};
  const s = createGameServer({port: 0, identityOptions: {passwords, now: () => clock.value, ...identityOptions}});
  await s.listen();
  t.after(() => s.close());
  return {s, clock};
}
function call(s, route = 'guest', {body = {}, cookie = '', address = '127.0.0.1', headers = {}, method = 'POST', raw, pathname} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(s.origin + (pathname || '/api/identity/' + route), {
      method, localAddress: address, agent: false,
      headers: {Origin: s.origin, Cookie: cookie, 'Content-Type': 'application/json', ...headers},
    }, res => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try {
          resolve({status: res.statusCode, body: JSON.parse(text), retryAfter: res.headers['retry-after'],
            cookies: res.headers['set-cookie'] || [], cookie: (res.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ')});
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(method === 'GET' ? undefined : raw ?? JSON.stringify(body));
  });
}
async function batch(count, work, size = 20) {
  const results = [];
  for (let offset = 0; offset < count; offset += size) {
    results.push(...await Promise.all(Array.from({length: Math.min(size, count - offset)}, (_, i) => work(offset + i))));
  }
  return results;
}
const allStatus = (values, expected = 200) => assert.deepEqual(values.map(value => value.status), values.map(() => expected));

test('fifty same-IP cold browsers enter; parallel existing-cookie bootstraps use no creation slots', async t => {
  const {s} = await server(t);
  const fresh = await Promise.all(Array.from({length: 50}, () => call(s)));
  allStatus(fresh);
  assert.equal(new Set(fresh.map(value => value.body.player.playerId)).size, 50);
  const repeated = await Promise.all(Array.from({length: 100}, () => call(s, 'guest', {cookie: fresh[0].cookie})));
  allStatus(repeated);
  for (const value of repeated) {
    assert.equal(value.body.player.playerId, fresh[0].body.player.playerId);
    assert.deepEqual(value.cookies, []);
  }
  allStatus(await batch(10, () => call(s)));
  const blocked = await call(s);
  assert.equal(blocked.status, 429); assert.equal(blocked.retryAfter, '2');
  assert.equal((await call(s, 'guest', {cookie: fresh[0].cookie})).status, 200);
});

test('HTTP guest creation refills one slot per two seconds without restoring the burst early', async t => {
  const {s, clock} = await server(t);
  allStatus(await batch(60, () => call(s)));
  assert.equal((await call(s)).retryAfter, '2');
  clock.value = 1999; assert.equal((await call(s)).retryAfter, '1');
  clock.value = 2000; assert.equal((await call(s)).status, 200); assert.equal((await call(s)).status, 429);
  clock.value = 60000;
  allStatus(await batch(29, () => call(s)));
  assert.equal((await call(s)).status, 429);
  clock.value = 180000;
  allStatus(await batch(60, () => call(s)));
  assert.equal((await call(s)).status, 429);
});

test('process-wide guest ceiling spans real distinct loopback peers; blocked peers cannot drain it', async t => {
  const {s, clock} = await server(t);
  allStatus(await batch(60, () => call(s)));
  allStatus(await batch(20, () => call(s)), 429);
  for (const address of ['127.0.0.2', '127.0.0.3']) allStatus(await batch(60, () => call(s, 'guest', {address})));
  const blocked = await call(s, 'guest', {address: '127.0.0.4'});
  assert.equal(blocked.status, 429); assert.equal(blocked.retryAfter, '1');
  clock.value = 667;
  assert.equal((await call(s, 'guest', {address: '127.0.0.4'})).status, 200);
  assert.equal((await call(s, 'guest', {address: '127.0.0.5'})).status, 429);
});

test('forged or malformed cookies and forwarding headers do not bypass same-peer admission', async t => {
  const {s} = await server(t);
  const values = await batch(60, i => call(s, 'guest', {
    cookie: i % 2 ? 'sw_guest=malformed' : `sw_guest=${'A'.repeat(43)}`,
    headers: {'X-Forwarded-For': `192.0.2.${i + 1}`, Forwarded: `for=192.0.2.${i + 1}`},
  }));
  allStatus(values); assert.equal(new Set(values.map(value => value.body.player.playerId)).size, 60);
  assert.equal((await call(s, 'guest', {headers: {'X-Forwarded-For': '198.51.100.2'}, cookie: `sw_account=${'B'.repeat(43)}`})).status, 429);
  const duplicate = await call(s, 'guest', {cookie: 'sw_guest=x; sw_guest=y'});
  assert.equal(duplicate.status, 400); assert.equal(duplicate.body.code, 'INVALID_IDENTITY_COOKIE');
});

test('bad JSON, authority fields, arrays and excessive payloads never consume guest creation quota', async t => {
  const {s} = await server(t);
  for (const raw of ['{', '[]', 'null', '{"playerId":"forged"}', JSON.stringify({padding: 'x'.repeat(9000)})]) {
    const response = await call(s, 'guest', {raw});
    assert.equal(response.status, 400); assert.equal(response.cookies.length, 0);
  }
  allStatus(await batch(60, () => call(s)));
  assert.equal((await call(s)).status, 429);
});

test('expired guest cookies cannot reuse identity and parallel expiry replacements remain bounded', async t => {
  const {s, clock} = await server(t, {guestSessionTtlMs: 1000});
  const first = await call(s);
  clock.value = 1000;
  const replaced = await Promise.all(Array.from({length: 5}, () => call(s, 'guest', {cookie: first.cookie})));
  allStatus(replaced);
  assert.equal(new Set(replaced.map(value => value.body.player.playerId)).size, 5);
  for (const value of replaced) assert.notEqual(value.body.player.playerId, first.body.player.playerId);
  allStatus(await batch(54, () => call(s)));
  assert.equal((await call(s, 'guest', {cookie: first.cookie})).status, 429);
});

test('fifty classmates can register and then log in as credential slots refill; one wrong name cannot lock others', async t => {
  const {s, clock} = await server(t);
  const guests = await batch(50, () => call(s)); allStatus(guests);
  const registered = await batch(50, i => call(s, 'register', {cookie: guests[i].cookie, body: {username: name(i), password: '123456'}}), 8);
  allStatus(registered);
  for (let i = 0; i < 50; i++) assert.equal(registered[i].body.player.playerId, guests[i].body.player.playerId);
  allStatus(await batch(8, () => call(s, 'login', {body: {username: 'MissingClassmate', password: 'wrongpass'}}), 4), 401);
  const blocked = await call(s, 'login', {body: {username: 'MISSINGCLASSMATE', password: 'wrongpass'}});
  assert.equal(blocked.status, 429); assert.equal(blocked.retryAfter, '60');
  const other = await call(s, 'login', {body: {username: name(0), password: '123456'}});
  assert.equal(other.status, 200);
  clock.value = 120000;
  allStatus(await batch(50, i => call(s, 'login', {body: {username: name(i).toLowerCase(), password: '123456'}}), 8));
});

test('rotating wrong usernames reach explicit peer and process credential ceilings', async t => {
  const {s, clock} = await server(t);
  allStatus(await batch(60, i => call(s, 'login', {body: {username: name(i), password: 'wrongpass'}}), 8), 401);
  const localLimit = await call(s, 'login', {body: {username: name(100), password: 'wrongpass'}});
  assert.equal(localLimit.status, 429); assert.equal(localLimit.retryAfter, '2');
  allStatus(await batch(60, i => call(s, 'login', {address: '127.0.0.2', body: {username: name(i), password: 'wrongpass'}}), 8), 401);
  const globalLimit = await call(s, 'login', {address: '127.0.0.3', body: {username: name(100), password: 'wrongpass'}});
  assert.equal(globalLimit.status, 429); assert.equal(globalLimit.retryAfter, '1');
  clock.value = 1000;
  assert.equal((await call(s, 'login', {address: '127.0.0.3', body: {username: name(100), password: 'wrongpass'}})).status, 401);
});

test('logout revokes the account and WebSocket when replacement guest quota is exhausted', async t => {
  const {s} = await server(t);
  const guest = await call(s);
  const account = await call(s, 'register', {cookie: guest.cookie, body: {username: 'FictionalLogout', password: '123456'}});
  assert.equal(account.status, 200);
  const connection = await new Client(s, undefined, account.cookie).open();
  const closed = once(connection.ws, 'close');
  allStatus(await batch(59, () => call(s)));
  const logout = await call(s, 'logout', {cookie: account.cookie});
  assert.equal(logout.status, 200); assert.deepEqual(logout.body, {player: null});
  assert(logout.cookies.some(value => value.startsWith('sw_account=;') && value.includes('Max-Age=0')));
  assert.equal((await closed)[0], 4003);
  assert.deepEqual((await call(s, 'me', {method: 'GET', cookie: account.cookie})).body, {player: null});
  assert.equal((await call(s)).status, 429);
});

test('logout retains an existing unrelated guest without creation quota', async t => {
  const {s} = await server(t);
  const accountGuest = await call(s);
  const account = await call(s, 'register', {cookie: accountGuest.cookie, body: {username: 'FictionalReturn', password: '123456'}});
  const unrelated = await call(s);
  allStatus(await batch(58, () => call(s)));
  const accountCookie = account.cookies.find(value => value.startsWith('sw_account=')).split(';')[0];
  const logout = await call(s, 'logout', {cookie: accountCookie + '; ' + unrelated.cookie});
  assert.equal(logout.status, 200); assert.equal(logout.body.player.playerId, unrelated.body.player.playerId);
  assert.equal((await call(s)).status, 429);
});

test('exhausted identity and common request quotas still allow verified-account logout', async t => {
  for (const common of [false, true]) {
    const {s} = await server(t);
    const guest = await call(s), account = await call(s, 'register', {cookie: guest.cookie, body: {username: 'FictionalPressure', password: '123456'}});
    const accountCookie = account.cookies.find(value => value.startsWith('sw_account=')).split(';')[0];
    const count = common ? 398 : 358;
    allStatus(await batch(count, () => call(s, common ? 'me' : 'guest', {cookie: accountCookie, method: common ? 'GET' : 'POST'}), 20));
    const blocked = await call(s, common ? 'me' : 'guest', {cookie: accountCookie, method: common ? 'GET' : 'POST'});
    assert.equal(blocked.status, 429);
    const rejected = await call(s, 'logout', {cookie: accountCookie, headers: {Origin: 'https://unrelated.invalid'}});
    assert.notEqual(rejected.status, 200);
    for (const invalid of [
      {cookie: `sw_account=${'A'.repeat(43)}`},
      {cookie: accountCookie + '; ' + accountCookie},
      {cookie: accountCookie, headers: {Origin: ''}},
      {cookie: accountCookie, headers: {'Content-Type': 'text/plain'}},
      {cookie: accountCookie, method: 'GET'},
      {cookie: accountCookie, headers: {Host: 'unrelated.invalid'}},
    ]) {
      const response = await call(s, 'logout', invalid);
      assert.notEqual(response.status, 200); assert.equal(response.cookies.length, 0);
    }
    const logout = await call(s, 'logout', {cookie: accountCookie});
    assert.equal(logout.status, 200); assert.deepEqual(logout.body, {player: null});
    assert.equal((await call(s, 'me', {method: 'GET', cookie: accountCookie, address: '127.0.0.2'})).body.player, null);
    await s.close();
  }
});

test('cold WebSocket and HTTP paths share creation slots; established cookies bypass only creation', async t => {
  const {s} = await server(t);
  const first = await new Client(s).open();
  allStatus(await batch(59, () => call(s)));
  const ws = new WebSocket(s.origin.replace('http', 'ws') + '/ws', {origin: s.origin});
  ws.on('error', () => {});
  const blocked = await new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) => { resolve({status: res.statusCode, retry: res.headers['retry-after']}); res.resume(); ws.terminate(); });
    ws.once('open', () => { ws.terminate(); reject(Error('Cold WebSocket unexpectedly admitted')); });
  });
  assert.deepEqual(blocked, {status: 429, retry: '2'});
  const returning = await new Client(s, undefined, first.cookie).open();
  assert.equal(returning.session.playerId, first.session.playerId);
});

test('account session expiry does not grant free guest admission', async t => {
  const {s, clock} = await server(t, {accountSessionTtlMs: 1000});
  const guest = await call(s), account = await call(s, 'register', {cookie: guest.cookie, body: {username: 'FictionalExpiry', password: '123456'}});
  allStatus(await batch(59, () => call(s)));
  clock.value = 1000;
  assert.deepEqual((await call(s, 'me', {method: 'GET', cookie: account.cookie})).body, {player: null});
  assert.equal((await call(s, 'guest', {cookie: account.cookie})).status, 429);
  clock.value = 2000;
  const replacement = await call(s, 'guest', {cookie: account.cookie});
  assert.equal(replacement.status, 200); assert.notEqual(replacement.body.player.playerId, account.body.player.playerId);
});

test('an expired account cannot enter the at-capacity logout exception', async t => {
  const {s, clock} = await server(t, {accountSessionTtlMs: 1});
  const guest = await call(s), account = await call(s, 'register', {cookie: guest.cookie, body: {username: 'FictionalExpiredLogout', password: '123456'}});
  allStatus(await batch(398, () => call(s, 'me', {method: 'GET'})));
  clock.value = 1; // Less than the 25 ms needed to refill a common request slot.
  const result = await call(s, 'logout', {cookie: account.cookie});
  assert.equal(result.status, 429); assert.equal(result.cookies.length, 0);
});

test('a guest expiring while its request body arrives cannot receive a stale identity', async t => {
  const {s, clock} = await server(t, {guestSessionTtlMs: 1000});
  const first = await call(s);
  const entered = once(s.server, 'request');
  let finish;
  const pending = new Promise((resolve, reject) => {
    const req = http.request(s.origin + '/api/identity/guest', {
      method: 'POST', headers: {Origin: s.origin, Cookie: first.cookie, 'Content-Type': 'application/json'},
    }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(text)}));
    });
    req.on('error', reject);
    req.write('{'); finish = () => req.end('}');
  });
  await entered;
  clock.value = 1000;
  finish();
  const result = await pending;
  assert.equal(result.status, 200); assert.notEqual(result.body.player.playerId, first.body.player.playerId);
});

test('HTTP password backlog keeps two workers and thirty-two waiting jobs with explicit retry', async t => {
  let release, active = 0, maximum = 0, busy;
  const held = new Promise(resolve => { release = resolve; });
  const firstBusy = new Promise(resolve => { busy = resolve; });
  const limitedPasswords = createPasswordService({scryptParameters: {N: 1024, r: 1, p: 1}, deriveKey: async () => {
    active++; maximum = Math.max(maximum, active); await held; active--; return Buffer.alloc(64);
  }});
  t.after(() => release());
  const {s} = await server(t, {passwords: limitedPasswords});
  const guests = await batch(35, () => call(s)); allStatus(guests);
  const pending = Promise.all(guests.map(async (guest, i) => {
    const result = await call(s, 'register', {cookie: guest.cookie, body: {username: name(i), password: '123456'}});
    if (result.body.code === 'PASSWORD_BUSY') busy(result);
    return result;
  }));
  let timer;
  try {
    const result = await Promise.race([firstBusy, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No bounded-password rejection')), 5000); })]);
    assert.equal(result.status, 429); assert.equal(result.retryAfter, '2'); assert.equal(maximum, 2);
  } finally { clearTimeout(timer); release(); }
  const results = await pending;
  assert.equal(results.filter(result => result.status === 200).length, 34);
  assert.equal(results.filter(result => result.body.code === 'PASSWORD_BUSY').length, 1);
  assert.equal(maximum, 2);
});

test('recovery-code password attempts share the account rolling limit and cannot spill to another account', async t => {
  const {s} = await server(t);
  const guest = await call(s), account = await call(s, 'register', {cookie: guest.cookie, body: {username: 'FictionalRecovery', password: '123456'}});
  allStatus(await batch(7, () => call(s, 'recovery-code', {cookie: account.cookie, body: {password: 'wrongpass'}}), 2), 401);
  const blocked = await call(s, 'recovery-code', {cookie: account.cookie, body: {password: '123456'}});
  assert.equal(blocked.status, 429); assert.equal(blocked.retryAfter, '60');
  assert.equal((await call(s, 'login', {body: {username: 'FICTIONALRECOVERY', password: '123456'}})).status, 429);
  const separate = await call(s), registered = await call(s, 'register', {cookie: separate.cookie, body: {username: 'FictionalSeparate', password: '123456'}});
  assert.equal(registered.status, 200);
});
