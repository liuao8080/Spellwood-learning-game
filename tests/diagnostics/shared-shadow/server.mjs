import { createAcceptanceServer as createOwnedServer } from '../../local/server.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function createAcceptanceServer() {
  if (process.env.SPELLWOOD_SHARED_SHADOW_SELECTED !== '1') throw new Error('Select the explicit shared-shadow diagnostic configuration.');
  const server = await createOwnedServer();
  const manifest = JSON.parse(await readFile(process.env.SPELLWOOD_SHARED_SHADOW_MANIFEST, 'utf8'));
  const verify = async () => {
    const records = [];
    for (const entry of manifest.staticFiles) {
      const response = await fetch(server.origin + entry.route, { signal: AbortSignal.timeout(3000) });
      const actual = response.ok ? createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') : null;
      records.push({ route: entry.route, expectedSha256: entry.sha256, actualSha256: actual, status: response.status, matched: actual === entry.sha256 });
    }
    await writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, `shared-shadow-${manifest.runId}-http.json`), JSON.stringify({
      schema: 1, origin: server.origin, starts: server.starts, records,
    }, null, 2));
    if (records.some(item => !item.matched)) throw new Error('Fixed lab HTTP bundle or HTML differs; abort this diagnostic.');
  };
  return { origin: server.origin, get starts() { return server.starts; },
    async start() { await server.start(); try { await verify(); } catch (error) { await server.close(); throw error; } },
    async restart() { await server.restart(); await verify(); }, close: () => server.close() };
}
