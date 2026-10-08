import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { checkHealth } from '../server/healthcheck.mjs';

test('health probe works locally with a declared reverse-proxy host and checks front-end artifacts', async t => {
  const publicOrigin = 'https://spellwood-test.invalid';
  const server = createGameServer({ port: 0, publicOrigin }); await server.listen(); t.after(() => server.close());
  const port = server.server.address().port;
  const result = await checkHealth({ port, publicOrigin });
  assert.equal(result.status, 'ok'); assert.equal(result.frontend, true); assert.equal(result.script, true);
  await assert.rejects(() => checkHealth({ port, publicOrigin: 'https://unrelated.invalid' }), /403/);
});

test('a running rule server is not healthy when its client build is missing', async t => {
  const server = createGameServer({ port: 0, clientRoot: new URL('./absent-client-build', import.meta.url).pathname });
  await server.listen(); t.after(() => server.close());
  await assert.rejects(() => checkHealth({ port: server.server.address().port, publicOrigin: server.origin }), /returned (503|404)/);
});

test('probe rejects invalid network configuration before making requests', async () => {
  await assert.rejects(() => checkHealth({ port: 0 }), /Invalid local port/);
  await assert.rejects(() => checkHealth({ publicOrigin: 'file:///tmp/example' }), /Invalid public origin/);
});
