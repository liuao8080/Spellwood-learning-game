import test from "node:test";
import assert from "node:assert/strict";
import {
  createPasswordService,
  DEFAULT_SCRYPT_PARAMETERS,
  PASSWORD_MAX_BYTES,
  validatePassword,
} from "../server/passwords.mjs";

const lowCost = () =>
  createPasswordService({ scryptParameters: { N: 1024, r: 8, p: 1 } });

test("password policy counts Unicode characters and keeps spaces and simple passwords", async () => {
  const passwords = lowCost();
  for (const value of ["aaaaaa", "123456", "      ", "🌱🌱🌱🌱🌱🌱", "  abcd"])
    assert.equal(validatePassword(value), value);
  for (const value of ["12345", "🌱🌱🌱🌱🌱"])
    await assert.rejects(passwords.hash(value), { code: "PASSWORD_TOO_SHORT" });
  assert.throws(() => validatePassword(null), { code: "INVALID_PASSWORD" });
  assert.throws(() => validatePassword("abcdef\ud800"), {
    code: "INVALID_PASSWORD",
  });
  assert.throws(() => validatePassword("a".repeat(PASSWORD_MAX_BYTES + 1)), {
    code: "PASSWORD_TOO_LARGE",
  });
  const encoded = await passwords.hash("  abcd");
  assert(await passwords.verify("  abcd", encoded));
  assert.equal(await passwords.verify("  abcD", encoded), false);
  const composed = await passwords.hash("éééééé");
  assert.equal(await passwords.verify("éééééé", composed), false);
});

test("password hashes have independent salts, versioned parameters, and no plaintext", async () => {
  const passwords = lowCost();
  const first = await passwords.hash("onlyatest");
  const second = await passwords.hash("onlyatest");
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$v1\$N=1024,r=8,p=1\$/);
  assert(!first.includes("onlyatest"));
  assert(await passwords.verify("onlyatest", first));
  assert.equal(await passwords.verify("wrongpass", first), false);
  assert.equal(passwords.needsRehash(first), false);
  assert.equal(createPasswordService().needsRehash(first), true);
});

test("real default scrypt parameters hash and verify successfully", async () => {
  assert.deepEqual(DEFAULT_SCRYPT_PARAMETERS, { N: 32768, r: 8, p: 3 });
  const passwords = createPasswordService();
  const hash = await passwords.hash("defaulttest");
  assert.match(hash, /^scrypt\$v1\$N=32768,r=8,p=3\$/);
  assert(await passwords.verify("defaulttest", hash));
  assert.equal(passwords.needsRehash(hash), false);
});

test("malformed or excessive stored parameters are rejected before derivation", async () => {
  let calls = 0;
  const passwords = createPasswordService({
    deriveKey: async () => {
      calls++;
      return Buffer.alloc(64);
    },
  });
  for (const hash of [
    null,
    "",
    "scrypt$v2$invalid",
    passwords.dummyHash.replace("N=32768", "N=1073741824"),
    passwords.dummyHash.replace("p=3", "p=3000"),
  ])
    assert.equal(await passwords.verify("abcdef", hash), false);
  assert.equal(calls, 0);
  assert.throws(
    () => createPasswordService({ scryptParameters: { N: 12345, r: 8, p: 1 } }),
    { code: "INVALID_SCRYPT_PARAMETERS" },
  );
});

test("all service instances share a two-job derivation limit and bounded backlog", async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let active = 0,
    maximum = 0,
    started = 0;
  const deriveKey = async (_password, _salt, keyLength, options) => {
    active++;
    started++;
    maximum = Math.max(maximum, active);
    assert.equal(keyLength, 64);
    assert.equal(options.maxmem, 64 * 1024 * 1024);
    await held;
    active--;
    return Buffer.alloc(64);
  };
  const first = createPasswordService({ deriveKey });
  const second = createPasswordService({ deriveKey });
  const settled = Promise.allSettled(
    Array.from({ length: 35 }, (_, index) =>
      (index % 2 ? first : second).hash("abcdef"),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 2);
  assert.equal(maximum, 2);
  release();
  const results = await settled;
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    34,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "PASSWORD_BUSY",
  );
  assert.equal(maximum, 2);
});

test("derivation failures free queue capacity without storing passwords", async () => {
  let calls = 0;
  const passwords = createPasswordService({
    deriveKey: async () => {
      if (++calls === 1)
        throw Object.assign(Error("TEST_DERIVATION_FAILURE"), {
          code: "TEST_DERIVATION_FAILURE",
        });
      return Buffer.alloc(64);
    },
  });
  await assert.rejects(passwords.hash("abcdef"), {
    code: "TEST_DERIVATION_FAILURE",
  });
  assert.match(await passwords.hash("abcdef"), /^scrypt\$v1\$/);
});
