import { plain } from './protocol.mjs';

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
  const rates = new Map();
  const methods = new Set(['guest', 'register', 'login', 'logout', 'recover', 'recovery-code']);
  const limits = {global: 90, guest: 30, pair: 8};
  function consume(key, limit, period = 60000) {
    const time = now(), old = (rates.get(key) || []).filter(t => time - t < period);
    if (old.length >= limit) return false;
    if (!rates.has(key) && rates.size >= 4096) for (const [k, v] of rates) if (!v.some(t => time - t < 60000)) rates.delete(k);
    if (!rates.has(key) && rates.size >= 8192) return false;
    old.push(time); rates.set(key, old);
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
  function error(res, code) {
    const known = new Set(['INVALID_USERNAME', 'INVALID_PASSWORD', 'PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LARGE', 'PASSWORD_BUSY', 'GUEST_SESSION_REQUIRED', 'ACCOUNT_SESSION_REQUIRED', 'USERNAME_TAKEN', 'RECOVERY_CODE_CHANGED', 'INVALID_CREDENTIALS', 'INVALID_RECOVERY', 'BAD_IDENTITY_REQUEST', 'PAYLOAD_TOO_LARGE', 'REQUEST_TIMEOUT', 'BAD_JSON']);
    const safeCode = known.has(code) ? code : 'IDENTITY_UNAVAILABLE';
    const status = ['USERNAME_TAKEN', 'RECOVERY_CODE_CHANGED'].includes(safeCode) ? 409 : ['GUEST_SESSION_REQUIRED', 'ACCOUNT_SESSION_REQUIRED', 'INVALID_CREDENTIALS', 'INVALID_RECOVERY'].includes(safeCode) ? 401 : safeCode === 'PASSWORD_BUSY' ? 429 : safeCode === 'IDENTITY_UNAVAILABLE' ? 503 : 400;
    if (status === 429) res.setHeader('Retry-After', '2');
    json(res, status, {code: safeCode});
  }
  return {
    current,
    secure,
    close() { rates.clear(); },
    forConnection(req) {
      const {tokens, identity} = current(req);
      if (tokens.invalid) throw Object.assign(Error(), {code: 'INVALID_IDENTITY_COOKIE'});
      if (identity) return {tokens, identity, cookies: []};
      // HTTP bootstrap normally establishes the cookie. This also supports a
      // first WebSocket connection without making an unbounded number of guests.
      const address = req.socket.remoteAddress || 'unknown';
      if (!consume(`guest:${address}`, limits.guest)) throw Object.assign(Error(), {code: 'RATE_LIMIT'});
      const result = store.createGuest();
      return {tokens: {guestToken: result.session.token}, identity: result,
        cookies: [identityCookie('guest', result.session.token, result.session.expiresAt, {secure, now: now()}),
          ...(tokens.accountToken ? [identityCookie('account', '', 0, {secure})] : [])]};
    },
    async handle(req, res, pathname) {
      if (!pathname.startsWith('/api/identity/')) return false;
      const route = pathname.slice('/api/identity/'.length);
      const {tokens, identity} = current(req);
      if (tokens.invalid) { json(res, 400, {code: 'INVALID_IDENTITY_COOKIE'}); return true; }
      if (route === 'me' && req.method === 'GET') {
        json(res, 200, {player: identity?.player || null});
        return true;
      }
      if (!methods.has(route) || req.method !== 'POST') { json(res, 404, {code: 'NOT_FOUND'}); return true; }
      if (!validOrigin(req)) { json(res, 403, {code: 'ORIGIN_REJECTED'}); return true; }
      if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, {code: 'JSON_REQUIRED'}); return true; }
      const address = req.socket.remoteAddress || 'unknown';
      if (!consume(`all:${address}`, limits.global) || route === 'guest' && !identity && !consume(`guest:${address}`, limits.guest)) {
        res.setHeader('Retry-After', '60'); json(res, 429, {code: 'RATE_LIMIT'}); return true;
      }
      try {
        const body = await readJson(req);
        const fields = route === 'register' || route === 'login' ? ['username', 'password'] : route === 'recover' ? ['username', 'password', 'recoveryCode'] : route === 'recovery-code' ? ['password'] : [];
        if (!plain(body) || Object.keys(body).some(k => !fields.includes(k))) throw Object.assign(Error(), {code: 'BAD_IDENTITY_REQUEST'});
        if (['register', 'login', 'recover'].includes(route)) {
          const username = typeof body.username === 'string' ? body.username.toLowerCase() : '';
          if (!consume(`attempt:${address}:${username}`, limits.pair)) { res.setHeader('Retry-After', '60'); json(res, 429, {code: 'RATE_LIMIT'}); return true; }
        }
        if (route === 'guest') {
          if (identity) reply(res, identity);
          else reply(res, store.ensureGuest(tokens.guestToken), tokens.accountToken ? [identityCookie('account', '', 0, {secure})] : []);
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
          const result = store.logout(tokens);
          onMutation(); reply(res, result, [identityCookie('account', '', 0, {secure})]);
        } else {
          if (identity?.player.kind !== 'account') throw Object.assign(Error(), {code: 'ACCOUNT_SESSION_REQUIRED'});
          const result = await store.rotateRecoveryCode({accountToken: tokens.accountToken, password: body.password});
          reply(res, result);
        }
      } catch (e) { error(res, e.code); }
      return true;
    }
  };
}
