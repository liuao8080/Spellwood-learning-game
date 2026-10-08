/** Local process probe for deployment supervision; never calls the public host. */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkHealth({ port = Number(process.env.PORT || 4173), publicOrigin = process.env.PUBLIC_ORIGIN, timeoutMs = 3000 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid local port');
  const declared = new URL(publicOrigin || `http://${process.env.HOST || '127.0.0.1'}:${port}`);
  if (!['http:', 'https:'].includes(declared.protocol) || declared.username || declared.password) throw Error('Invalid public origin');
  function request(resource, method) {
    return new Promise((resolve, reject) => {
      let settled = false, bytes = 0, body = '';
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const req = http.request({ hostname: '127.0.0.1', port, path: resource, method, headers: { Host: declared.host } }, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 8192) req.destroy(Error('Probe response too large')); else body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) { finish(Error(`Probe ${resource} returned ${res.statusCode}`)); return; }
          if (method === 'HEAD' && !(Number(res.headers['content-length']) > 0)) { finish(Error(`Probe ${resource} is empty`)); return; }
          finish(null, body);
        });
        res.on('error', error => finish(error));
      });
      const timer = setTimeout(() => req.destroy(Error('Local health probe timed out')), timeoutMs);
      req.on('error', error => finish(error)); req.end();
    });
  }
  const [body] = await Promise.all([request('/health', 'GET'), request('/', 'HEAD'), request('/app.js', 'HEAD')]);
  let health; try { health = JSON.parse(body); } catch { throw Error('Invalid health response'); }
  if (health.status !== 'ok' || health.protocol !== 1) throw Error('Server did not report a healthy protocol');
  return { status: 'ok', protocol: health.protocol, ruleset: health.ruleset, frontend: true, script: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkHealth())); }
  catch (error) { console.error(`Spellwood health: ${error.message}`); process.exitCode = 1; }
}
