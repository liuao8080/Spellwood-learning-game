import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Owns only this test's real server process and temporary SQLite directory.
 * No test-only API, clock changes, engine access, seeded answers, or game-rule
 * overrides are installed. Restarting runs the production entry point again.
 */
export async function createAcceptanceServer() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.SPELLWOOD_BROWSER_CI !== '1') {
    throw new Error('Browser acceptance execution is restricted to the authorized GitHub Actions job; --list remains available locally.');
  }
  const directory = await mkdtemp(path.join(process.env.RUNNER_TEMP || tmpdir(), 'spellwood-browser-'));
  const origin = 'http://127.0.0.1:4173';
  let child;
  let starts = 0;
  async function start() {
    if (child) throw new Error('The acceptance server already has an owned process');
    child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        HOST: '127.0.0.1', PORT: '4173',
        PUBLIC_ORIGIN: origin, ALLOWED_ORIGINS: origin,
        SPELLWOOD_DATABASE: path.join(directory, 'progress.sqlite'),
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null) throw new Error('The real acceptance server failed to start');
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(800) });
        if (response.ok && (await response.json()).status === 'ok') {
          starts += 1;
          return;
        }
      } catch { /* Wait for this process to bind its ordinary loopback port. */ }
      await delay(100);
    }
    throw new Error('The real acceptance server did not become healthy');
  }
  async function stop() {
    if (!child) return;
    const current = child;
    child = undefined;
    if (current.exitCode !== null || current.signalCode !== null) return;
    const exited = once(current, 'exit').catch(() => {});
    current.kill('SIGTERM');
    const clean = await Promise.race([exited.then(() => true), delay(7000).then(() => false)]);
    if (!clean) { current.kill('SIGKILL'); await exited; }
  }
  return {
    origin,
    get starts() { return starts; },
    start,
    async restart() { await stop(); await start(); },
    async close() { await stop(); await rm(directory, { recursive: true, force: true }); },
  };
}
