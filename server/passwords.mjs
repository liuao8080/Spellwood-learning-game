import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Node's asynchronous scrypt, with the OWASP N=2^15/r=8/p=3 profile.
// https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
export const DEFAULT_SCRYPT_PARAMETERS = Object.freeze({
  N: 32768,
  r: 8,
  p: 3,
});
export const PASSWORD_MAX_BYTES = 65536;
const KEY_BYTES = 64;
const SALT_BYTES = 32;
const MAX_MEMORY = 64 * 1024 * 1024;
const MAX_RUNNING = 2;
const MAX_WAITING = 32;
const waiting = [];
let running = 0;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export function validatePassword(password) {
  if (typeof password !== "string" || !password.isWellFormed())
    fail("INVALID_PASSWORD");
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES)
    fail("PASSWORD_TOO_LARGE");
  if ([...password].length < 6) fail("PASSWORD_TOO_SHORT");
  // Intentionally do not trim, normalize, require character classes, or reject
  // common passwords. The user's only content requirement is six characters.
  return password;
}

function parameters(value) {
  const { N, r, p } = value ?? {};
  if (
    !Number.isSafeInteger(N) ||
    N < 1024 ||
    N > 32768 ||
    (N & (N - 1)) !== 0 ||
    !Number.isSafeInteger(r) ||
    r < 1 ||
    r > 8 ||
    !Number.isSafeInteger(p) ||
    p < 1 ||
    p > 3
  )
    fail("INVALID_SCRYPT_PARAMETERS");
  return { N, r, p };
}

function encode(opts, salt, key) {
  return `scrypt$v1$N=${opts.N},r=${opts.r},p=${opts.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function decode(encoded) {
  if (typeof encoded !== "string" || encoded.length > 256) return null;
  const match =
    /^scrypt\$v1\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]{43})\$([A-Za-z0-9_-]{86})$/.exec(
      encoded,
    );
  if (!match) return null;
  try {
    const opts = parameters({
      N: Number(match[1]),
      r: Number(match[2]),
      p: Number(match[3]),
    });
    const salt = Buffer.from(match[4], "base64url");
    const key = Buffer.from(match[5], "base64url");
    if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
    if (encode(opts, salt, key) !== encoded) return null;
    return { opts, salt, key };
  } catch {
    return null;
  }
}

function drain() {
  while (running < MAX_RUNNING && waiting.length) {
    const { work, resolve, reject } = waiting.shift();
    running += 1;
    Promise.resolve()
      .then(work)
      .then(resolve, reject)
      .finally(() => {
        running -= 1;
        drain();
      });
  }
}

function limited(work) {
  if (running >= MAX_RUNNING && waiting.length >= MAX_WAITING)
    return Promise.reject(
      Object.assign(new Error("PASSWORD_BUSY"), { code: "PASSWORD_BUSY" }),
    );
  return new Promise((resolve, reject) => {
    waiting.push({ work, resolve, reject });
    drain();
  });
}

function derive(password, salt, keyLength, options) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

// Lower parameters / a derivation function may be injected by focused tests.
// The process-wide limit still applies across all service instances.
export function createPasswordService({
  scryptParameters = DEFAULT_SCRYPT_PARAMETERS,
  deriveKey = derive,
} = {}) {
  const opts = Object.freeze(parameters(scryptParameters));
  const dummyHash = encode(
    opts,
    Buffer.alloc(SALT_BYTES),
    Buffer.alloc(KEY_BYTES),
  );
  const run = (password, salt, options) =>
    limited(async () => {
      const result = await deriveKey(password, salt, KEY_BYTES, {
        ...options,
        maxmem: MAX_MEMORY,
      });
      if (!Buffer.isBuffer(result) || result.length !== KEY_BYTES)
        fail("INVALID_DERIVED_KEY");
      return result;
    });
  return Object.freeze({
    dummyHash,
    async hash(password) {
      validatePassword(password);
      const salt = randomBytes(SALT_BYTES);
      const key = await run(password, salt, opts);
      return encode(opts, salt, key);
    },
    async verify(password, encoded) {
      validatePassword(password);
      const parsed = decode(encoded);
      if (!parsed) return false;
      const actual = await run(password, parsed.salt, parsed.opts);
      return timingSafeEqual(actual, parsed.key);
    },
    needsRehash(encoded) {
      const parsed = decode(encoded);
      return (
        !parsed ||
        Object.keys(opts).some((key) => parsed.opts[key] !== opts[key])
      );
    },
  });
}

export const passwords = createPasswordService();
