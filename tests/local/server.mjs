import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = process => process.exitCode !== null || process.signalCode !== null;
async function waitForExit(current, milliseconds) {
  if (exited(current)) return true;
  return new Promise(resolve => {
    let timer;
    const finish = value => { clearTimeout(timer); current.off('exit', onExit); resolve(value); };
    const onExit = () => finish(true);
    current.once('exit', onExit); timer = setTimeout(() => finish(exited(current)), milliseconds);
  });
}

async function requireFreePort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error('The local acceptance port is occupied; do not reuse an unrelated server.')));
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

/** Own only an ordinary production-entry server and disposable SQLite folder.
 * Default rules, queue deadlines, questions and shuffled decks remain intact.
 */
export async function createAcceptanceServer() {
  if (!process.env.SPELLWOOD_LOCAL_RUN_ID) throw new Error('Select playwright.local.config.mjs for local execution.');
  const port = Number(process.env.SPELLWOOD_LOCAL_PORT || 4184);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4173)
    throw new Error('Use a distinct unprivileged local test port; 4173 is reserved for manual play.');
  const origin = `http://127.0.0.1:${port}`;
  const clientRoot = path.resolve(process.env.SPELLWOOD_LOCAL_CLIENT_DIST || path.join(root, 'client-dist'));
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const expectedHashes = {
    appJsSha256: sha256(await readFile(path.join(clientRoot, 'app.js'))),
    indexHtmlSha256: sha256(await readFile(path.join(clientRoot, 'index.html'))),
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'spellwood-local-browser-'));
  let child;
  let starts = 0;
  let servedHashes = null;
  const killOwnedOnExit = () => { if (child && !exited(child)) { try { child.kill('SIGTERM'); } catch {} } };
  process.once('exit', killOwnedOnExit);
  async function start() {
    if (child) throw new Error('The local test already owns a running server');
    await requireFreePort(port);
    child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: root,
      env: {
        ...process.env, HOST: '127.0.0.1', PORT: String(port),
        PUBLIC_ORIGIN: origin, ALLOWED_ORIGINS: origin,
        CLIENT_DIST: clientRoot,
        SPELLWOOD_DATABASE: path.join(directory, 'progress.sqlite'),
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null) throw new Error('The real local acceptance server failed to start');
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(800) });
        if (response.ok && (await response.json()).status === 'ok') {
          const [script, html] = await Promise.all(['/app.js', '/'].map(route => fetch(origin + route, { signal: AbortSignal.timeout(3000) })));
          servedHashes = {
            appJsSha256: script.ok ? sha256(Buffer.from(await script.arrayBuffer())) : null,
            indexHtmlSha256: html.ok ? sha256(Buffer.from(await html.arrayBuffer())) : null,
          };
          if (servedHashes.appJsSha256 !== expectedHashes.appJsSha256 || servedHashes.indexHtmlSha256 !== expectedHashes.indexHtmlSha256)
            throw Object.assign(new Error('The local test server serves a different build than its explicit client snapshot.'), { code: 'LOCAL_SERVED_BUILD_MISMATCH' });
          starts += 1;
          if (process.env.SPELLWOOD_LOCAL_EVIDENCE) await writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, `served-build-${path.basename(directory)}.json`), JSON.stringify({
            schema: 1, origin, starts, clientDirectory: path.relative(root, clientRoot), expectedHashes, servedHashes,
          }, null, 2));
          return;
        }
      } catch (error) {
        if (error.code === 'LOCAL_SERVED_BUILD_MISMATCH') throw error;
        /* Wait for this owned process to start its ordinary loopback server. */
      }
      await delay(100);
    }
    throw new Error('The real local acceptance server did not become healthy');
  }
  async function stop() {
    if (!child) return;
    const current = child;
    if (!current.pid || exited(current)) { child = undefined; return; }
    current.kill('SIGTERM');
    const clean = await waitForExit(current, 7000);
    if (!clean) {
      current.kill('SIGKILL');
      if (!await waitForExit(current, 2000)) throw Object.assign(new Error('The owned local server exit is unconfirmed; its temporary database is preserved.'), { code: 'LOCAL_SERVER_EXIT_UNCONFIRMED' });
    }
    child = undefined;
  }
  return {
    origin,
    get starts() { return starts; },
    get servedHashes() { return servedHashes; },
    start,
    async restart() { await stop(); await start(); },
    async close() { await stop(); process.off('exit', killOwnedOnExit); await rm(directory, { recursive: true, force: true }); },
  };
}
