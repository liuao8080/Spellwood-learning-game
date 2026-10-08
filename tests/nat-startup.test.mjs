import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
import {IdentityClient} from '../src/network/identity-client.mjs';
import {StudyDesk} from '../src/network/study-desk.mjs';
import {RemoteProgressStore} from '../src/network/remote-progress.mjs';
import {Client} from './network-helpers.mjs';

test('fifty cold client-module startup flows fit one NAT burst at exactly 200 API/WS requests', async t => {
  const s = createGameServer({port: 0, identityOptions: {now: () => 0}});
  await s.listen(); t.after(() => s.close());
  const counts = new Map(), players = new Set();
  s.server.on('request', req => {
    if (req.url.startsWith('/api/')) counts.set(req.url, (counts.get(req.url) || 0) + 1);
  });
  s.server.on('upgrade', () => counts.set('/ws', (counts.get('/ws') || 0) + 1));
  async function openBrowser() {
    const jar = new Map();
    const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
    const fetcher = async (pathname, options = {}) => {
      const response = await fetch(s.origin + pathname, {...options, headers: {...options.headers, Origin: s.origin, Cookie: cookie()}});
      for (const item of response.headers.getSetCookie()) {
        const [key, value] = item.split(';')[0].split('=');
        if (item.includes('Max-Age=0')) jar.delete(key); else jar.set(key, value);
      }
      assert.equal(response.status, 200, pathname);
      return response;
    };
    const identity = new IdentityClient({fetch: fetcher});
    const {player} = await identity.bootstrap();
    players.add(player.playerId);
    const desk = new StudyDesk({fetcher, storeFactory: options => new RemoteProgressStore({...options, playerId: player.playerId, fetcher})});
    t.after(() => desk.dispose());
    await desk.initialize();
    assert.equal(desk.canStart, true);
    assert.equal(desk.catalogue.questions.filter(question => (question.bank || 'school') === 'school').length, 432);
    assert.equal(desk.catalogue.questions.filter(question => question.bank === 'teacher-academic').length, 48);
    const connection = await new Client(s, undefined, cookie()).open();
    assert.equal(connection.session.playerId, player.playerId);
    desk.dispose();
  }
  // A frozen admission clock means no token refills between groups. The HTTP
  // cold-bootstrap test separately opens all fifty requests simultaneously.
  for (let group = 0; group < 5; group++) await Promise.all(Array.from({length: 10}, openBrowser));
  assert.equal(players.size, 50);
  assert.equal(s.service.sessions.size, 50);
  assert.deepEqual(Object.fromEntries(counts), {'/api/identity/guest': 50, '/api/curriculum': 50, '/api/progress': 50, '/ws': 50});
});
