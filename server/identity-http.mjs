import { plain } from './protocol.mjs';
import { createHash } from 'node:crypto';
import { createTokenBuckets, createAttemptWindow } from './admission.mjs';

export const IDENTITY_ADMISSION = Object.freeze({
  requests: Object.freeze({peerBurst: 360, peerPerMinute: 180, globalBurst: 1200, globalPerMinute: 600}),
  guest: Object.freeze({peerBurst: 60, peerPerMinute: 30, globalBurst: 180, globalPerMinute: 90}),
  credentials: Object.freeze({peerBurst: 60, peerPerMinute: 30, globalBurst: 120, globalPerMinute: 60}),
});

export const IDENTITY_COOKIE_NAMES = Object.freeze({guest: 'sw_guest', account: 'sw_account'});
export function identityCookieNames(secure = false) {
  return secure ? {guest: '__Host-sw_guest', account: '__Host-sw_account'} : IDENTITY_COOKIE_NAMES;
}
export function readIdentityCookies(header, secure = false) {
  const names = identityCookieNames(secure), found = new Map();
  if (typeof header !== 'string') return {};
  if (header.length > 16384) return {invalid: true};
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (!Object.values(names).includes(name)) continue;
    if (found.has(name)) return {invalid: true};
    found.set(name, part.slice(at + 1).trim());
  }
  return {guestToken: found.get(names.guest), accountToken: found.get(names.account)};
}
export function identityCookie(type, token, expiresAt, {secure = false, now = Date.now()} = {}) {
  const name = identityCookieNames(secure)[type];
  if (!name || typeof token !== 'string' || token && !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Invalid identity cookie');
  const maxAge = token ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** Cookie/HTTP boundary. Authentication tokens never enter JSON responses. */
export function createIdentityHttp({store, readJson, json, validOrigin, secure = false, now = () => Date.now(), onMutation = () => {}}) {
  const rates = createTokenBuckets({now}), attempts = createAttemptWindow({now});
  const methods = new Set(['guest', 'register', 'login', 'logout', 'recover', 'recovery-code']);
  function consume(kind, address) {
    const policy = IDENTITY_ADMISSION[kind];
    return rates.consume([
      {key: `${kind}:peer:${address}`, capacity: policy.peerBurst, refillPerSecond: policy.peerPerMinute / 60},
      {key: `${kind}:global`, capacity: policy.globalBurst, refillPerSecond: policy.globalPerMinute / 60},
    ]);
  }
  function admitGuest(address) {
    const result = consume('guest', address);
    if (!result.ok) throw Object.assign(Error('RATE_LIMIT'), {code: 'RATE_LIMIT', retryAfter: result.retryAfter});
  }
  function limited(res, result) {
    if (result.ok) return false;
    res.setHeader('Retry-After', String(result.retryAfter));
    json(res, 429, {code: 'RATE_LIMIT'});
    return true;
  }
  function logout(res, tokens, address, allowCreation = true) {
    // Revocation is never conditional on replacement guest admission.
    if (tokens.accountToken) store.revokeSession(tokens.accountToken, 'account');
    onMutation();
    let result = store.resolveSession(tokens.guestToken, 'guest');
    if (!result && allowCreation && consume('guest', address).ok) result = store.createGuest();
    reply(res, result || {player: null}, [identityCookie('account', '', 0, {secure})]);
  }
  function logoutAtCapacity(req, res) {
    // This narrow fallback cannot issue a new player or session. It only signs
    // out an already authenticated account, even under request-quota pressure.
    // The route has no input fields: discard any body without buffering it.
    if (req.method !== 'POST' || !validOrigin(req) || !req.headers['content-type']?.startsWith('application/json')) return false;
    const tokens = readIdentityCookies(req.headers.cookie, secure);
    if (tokens.invalid || !store.resolveSessionBrief(tokens.accountToken, 'account')) return false;
    req.resume();
    logout(res, tokens, req.socket.remoteAddress || 'unknown', false);
    return true;
  }
  function current(req, brief = false) {
    const tokens = readIdentityCookies(req.headers.cookie, secure);
    return {tokens, identity: tokens.invalid ? null : brief ? store.resolveIdentityBrief(tokens) : store.resolveIdentity(tokens)};
  }
  function reply(res, result, cookies = []) {
    if (result.session?.token) cookies.push(identityCookie(result.session.type, result.session.token, result.session.expiresAt, {secure, now: now()}));
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    const body = {player: result.player};
    if (result.recoveryCode) body.recoveryCode = result.recoveryCode;
    json(res, 200, body);
  }
  function error(res, code, retryAfter) {
    const known = new Set(['INVALID_USERNAME', 'INVALID_PASSWORD', 'PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LARGE', 'PASSWORD_BUSY', 'RATE_LIMIT', 'GUEST_SESSION_REQUIRED', 'ACCOUNT_SESSION_REQUIRED', 'USERNAME_TAKEN', 'RECOVERY_CODE_CHANGED', 'INVALID_CREDENTIALS', 'INVALID_RECOVERY', 'BAD_IDENTITY_REQUEST', 'PAYLOAD_TOO_LARGE', 'REQUEST_TIMEOUT', 'BAD_JSON']);
    const safeCode = known.has(code) ? code : 'IDENTITY_UNAVAILABLE';
    const status = ['USERNAME_TAKEN', 'RECOVERY_CODE_CHANGED'].includes(safeCode) ? 409 : ['GUEST_SESSION_REQUIRED', 'ACCOUNT_SESSION_REQUIRED', 'INVALID_CREDENTIALS', 'INVALID_RECOVERY'].includes(safeCode) ? 401 : ['PASSWORD_BUSY', 'RATE_LIMIT'].includes(safeCode) ? 429 : safeCode === 'IDENTITY_UNAVAILABLE' ? 503 : 400;
    if (status === 429) res.setHeader('Retry-After', String(retryAfter || 2));
    json(res, status, {code: safeCode});
  }
  return {
    current,
    secure,
    logoutAtCapacity,
    close() { rates.clear(); attempts.clear(); },
    forConnection(req) {
      const {tokens, identity} = current(req);
      if (tokens.invalid) throw Object.assign(Error(), {code: 'INVALID_IDENTITY_COOKIE'});
      if (identity) return {tokens, identity, cookies: []};
      // HTTP bootstrap normally establishes the cookie. This also supports a
      // first WebSocket connection without making an unbounded number of guests.
      const address = req.socket.remoteAddress || 'unknown';
      admitGuest(address);
      const result = store.createGuest();
      return {tokens: {guestToken: result.session.token}, identity: result,
        cookies: [identityCookie('guest', result.session.token, result.session.expiresAt, {secure, now: now()}),
          ...(tokens.accountToken ? [identityCookie('account', '', 0, {secure})] : [])]};
    },
    async handle(req, res, pathname) {
      if (!pathname.startsWith('/api/identity/')) return false;
      const route = pathname.slice('/api/identity/'.length);
      let {tokens, identity} = current(req);
      if (tokens.invalid) { json(res, 400, {code: 'INVALID_IDENTITY_COOKIE'}); return true; }
      if (route === 'me' && req.method === 'GET') {
        json(res, 200, {player: identity?.player || null});
        return true;
      }
      if (!methods.has(route) || req.method !== 'POST') { json(res, 404, {code: 'NOT_FOUND'}); return true; }
      if (!validOrigin(req)) { json(res, 403, {code: 'ORIGIN_REJECTED'}); return true; }
      if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, {code: 'JSON_REQUIRED'}); return true; }
      const address = req.socket.remoteAddress || 'unknown';
      const admission = consume('requests', address);
      if (!admission.ok && route === 'logout' && logoutAtCapacity(req, res)) return true;
      if (limited(res, admission)) return true;
      try {
        const body = await readJson(req);
        const fields = route === 'register' || route === 'login' ? ['username', 'password'] : route === 'recover' ? ['username', 'password', 'recoveryCode'] : route === 'recovery-code' ? ['password'] : [];
        if (!plain(body) || Object.keys(body).some(k => !fields.includes(k))) throw Object.assign(Error(), {code: 'BAD_IDENTITY_REQUEST'});
        // Body reading yields: expiry, logout, or a second tab's registration may
        // have invalidated the cookie while the request was in flight.
        identity = store.resolveIdentity(tokens);
        if (['register', 'login', 'recover', 'recovery-code'].includes(route)) {
          if (route === 'recovery-code' && identity?.player.kind !== 'account') throw Object.assign(Error(), {code: 'ACCOUNT_SESSION_REQUIRED'});
          const username = route === 'recovery-code' ? identity.player.username : body.username;
          // A bounded digest avoids retaining up to 8 KiB of client text per key.
          const nameKey = createHash('sha256').update(typeof username === 'string' ? username.toLowerCase() : '').digest('hex');
          const key = `attempt:${address}:${nameKey}`;
          if (limited(res, attempts.check(key)) || limited(res, consume('credentials', address))) return true;
          attempts.consume(key);
        }
        if (route === 'guest') {
          if (identity) reply(res, identity);
          else {
            admitGuest(address);
            reply(res, store.ensureGuest(tokens.guestToken), tokens.accountToken ? [identityCookie('account', '', 0, {secure})] : []);
          }
        } else if (route === 'register') {
          if (identity?.player.kind !== 'guest') throw Object.assign(Error(), {code: 'GUEST_SESSION_REQUIRED'});
          const result = await store.registerGuest({...body, guestToken: tokens.guestToken});
          onMutation();
          reply(res, result, [identityCookie('guest', '', 0, {secure})]);
        } else if (route === 'login' || route === 'recover') {
          const result = await (route === 'login' ? store.login(body) : store.recoverAccount(body));
          if (tokens.accountToken) store.revokeSession(tokens.accountToken, 'account');
          onMutation(); reply(res, result);
        } else if (route === 'logout') {
          if (!identity) { reply(res, {player: null}, [identityCookie('account', '', 0, {secure})]); return true; }
          logout(res, tokens, address);
        } else {
          if (identity?.player.kind !== 'account') throw Object.assign(Error(), {code: 'ACCOUNT_SESSION_REQUIRED'});
          const result = await store.rotateRecoveryCode({accountToken: tokens.accountToken, password: body.password});
          reply(res, result);
        }
      } catch (e) { error(res, e.code, e.retryAfter); }
      return true;
    }
  };
}
