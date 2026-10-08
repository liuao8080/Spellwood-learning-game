/** Observe a real local server's absolute session lifetime without making a game.
 * No browser, player simulation, or stored credentials. Default observation: 2h. */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const origin = new URL(option('--origin', 'http://127.0.0.1:4173'));
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:') throw Error('Use only a local development server');
const expectedMs = Number(option('--expected-ttl-seconds', '7200')) * 1000;
if (!Number.isFinite(expectedMs) || expectedMs < 50 || expectedMs > 10800000) throw Error('Invalid bounded observation duration');
const output = path.resolve(option('--output', 'test-results/session-lifetime.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
const address = new URL('/ws', origin); address.protocol = 'ws:';
let token, readyAt, finished = false, heartbeatPings = 0, main, reportTimer, deadline, authDeadline;
const report = { kind: 'real-local-websocket-lifetime-observation', origin: origin.origin, expectedTtlMs: expectedMs,
  startedAt: new Date().toISOString(), status: 'connecting', browserOrHumanPlaytest: false };
function save() {
  report.lastObservedAt = new Date().toISOString();
  report.heartbeatPings = heartbeatPings;
  if (readyAt !== undefined) report.elapsedMs = Math.round(performance.now() - readyAt);
  const temporary = output + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temporary, output);
}
async function cannotResume() {
  return new Promise((resolve, reject) => {
    const retry = new WebSocket(address, { origin: origin.origin });
    let received = false;
    const timer = setTimeout(() => { retry.terminate(); reject(Error('Expired-session verification timed out')); }, 5000);
    retry.on('open', () => retry.send(JSON.stringify({ type: 'session.resume', protocol: 1, resumeToken: token })));
    retry.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.type === 'session.error' && message.code === 'SESSION_EXPIRED') { received = true; clearTimeout(timer); retry.close(); resolve(true); }
      else if (message.type === 'session.ready') { clearTimeout(timer); retry.close(); reject(Error('Expired session was incorrectly resumed')); }
    });
    retry.on('error', () => { clearTimeout(timer); reject(Error('Could not verify expired session')); });
    retry.on('close', () => { if (!received) { clearTimeout(timer); reject(Error('Closed before an expiry rejection')); } });
  });
}
async function finish(error = null) {
  if (finished) return; finished = true;
  clearInterval(reportTimer); clearTimeout(deadline); clearTimeout(authDeadline);
  if (error) { report.status = 'failed'; report.error = error.message; }
  else {
    try {
      report.expiredSessionRejected = await cannotResume();
      const health = await fetch(new URL('/health', origin), { signal: AbortSignal.timeout(5000) });
      report.healthStatus = health.status; report.health = await health.json();
      if (report.healthStatus !== 200 || report.health.status !== 'ok') throw Error('Server unhealthy after lifetime observation');
      report.status = 'passed';
    } catch (problem) { report.status = 'failed'; report.error = problem.message; }
  }
  report.finishedAt = new Date().toISOString(); save(); token = null;
  main?.terminate(); console.log(JSON.stringify(report)); process.exitCode = report.status === 'passed' ? 0 : 1;
}
save();
main = new WebSocket(address, { origin: origin.origin });
authDeadline = setTimeout(() => finish(Error('Initial session did not open')), 6000);
main.on('open', () => main.send(JSON.stringify({ type: 'session.open', protocol: 1 })));
main.on('ping', () => heartbeatPings++);
main.on('message', data => {
  let message; try { message = JSON.parse(String(data)); } catch { void finish(Error('Invalid protocol response')); return; }
  if (message.type === 'session.ready') {
    if (readyAt !== undefined) { void finish(Error('Unexpected session replacement')); return; }
    token = message.resumeToken; readyAt = performance.now(); clearTimeout(authDeadline);
    report.status = 'observing'; report.readyAt = new Date().toISOString(); report.protocol = message.protocol;
    save(); console.log(JSON.stringify({ status: 'observing', expectedMinutes: expectedMs / 60000, output }));
    reportTimer = setInterval(save, 60000);
    deadline = setTimeout(() => finish(Error('Session did not expire within its observation bound')), expectedMs + 15000);
  } else if (message.type === 'session.error') report.expiryCode = message.code;
});
main.on('error', () => { if (!finished) void finish(Error('Local session connection failed')); });
main.on('close', code => {
  if (finished) return;
  report.closeCode = code;
  const elapsed = readyAt === undefined ? 0 : performance.now() - readyAt;
  if (code !== 4003) void finish(Error('Session ended before a normal absolute expiry'));
  else if (elapsed < expectedMs - 1500 || elapsed > expectedMs + 10000) void finish(Error('Expiry occurred outside the expected duration'));
  else void finish();
});
process.on('SIGINT', () => { void finish(Error('Observation interrupted')); });
