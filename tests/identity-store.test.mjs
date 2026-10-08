import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  createIdentityStore,
  IDENTITY_SCHEMA_VERSION,
  PLAYER_PROGRESS_MAX_BYTES,
  validateUsername,
} from "../server/identity-store.mjs";
import { createPasswordService } from "../server/passwords.mjs";

const passwords = createPasswordService({
  scryptParameters: { N: 1024, r: 8, p: 1 },
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
function memoryStore(t, options = {}) {
  const store = createIdentityStore({ passwords, ...options });
  t.after(() => store.close());
  return store;
}
function databasePath(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "spellwood-identity-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return path.join(folder, "identity.sqlite");
}
async function account(store, username = "ForestFox", password = "abcdef") {
  const guest = store.createGuest();
  const registered = await store.registerGuest({
    guestToken: guest.session.token,
    username,
    password,
  });
  return { guest, registered };
}

test("persistent guest and learning data survive database restart; migrations are idempotent", (t) => {
  const filename = databasePath(t);
  let store = createIdentityStore({ databasePath: filename, passwords });
  const guest = store.createGuest();
  assert.equal(guest.player.kind, "guest");
  assert.match(guest.player.name, /^[A-Za-z]+\d{4}$/);
  const saved = store.updatePlayerData(guest.player.playerId, {
    profile: { grade: 3, course: "s1-u2", deckId: "grove" },
    progress: { learning: { "pep1-g3-s1-u2-q1": { attempts: 2, correct: 1 } } },
    expectedRevision: 0,
  });
  store.close();
  store = createIdentityStore({ databasePath: filename, passwords });
  try {
    const resumed = store.ensureGuest(guest.session.token);
    assert.deepEqual(resumed.player, saved);
    assert.equal(resumed.session.token, undefined);
    const sql = new DatabaseSync(filename);
    try {
      assert.equal(
        sql.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n,
        IDENTITY_SCHEMA_VERSION,
      );
      assert.equal(
        sql
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get().version,
        IDENTITY_SCHEMA_VERSION,
      );
    } finally {
      sql.close();
    }
  } finally {
    store.close();
  }
});

test("guest registration preserves player ID and all data while retiring guest credential", async (t) => {
  const store = memoryStore(t);
  const guest = store.createGuest();
  const saved = store.updatePlayerData(guest.player.playerId, {
    profile: { grade: 2 },
    progress: { learning: ["apple"], wallet: 3 },
    expectedRevision: 0,
  });
  const registered = await store.registerGuest({
    guestToken: guest.session.token,
    username: "FoReSt",
    password: "aaaaaa",
  });
  assert.equal(registered.player.playerId, guest.player.playerId);
  assert.equal(registered.player.kind, "account");
  assert.equal(registered.player.name, "FoReSt");
  assert.equal(registered.player.username, "FoReSt");
  assert.deepEqual(registered.player.profile, saved.profile);
  assert.deepEqual(registered.player.progress, saved.progress);
  assert.equal(registered.player.revision, saved.revision);
  assert.equal(store.resolveSession(guest.session.token, "guest"), null);
  assert.equal(
    store.resolveSession(registered.session.token, "account").player.playerId,
    guest.player.playerId,
  );
  const logout = store.logout({
    guestToken: guest.session.token,
    accountToken: registered.session.token,
  });
  assert.equal(logout.player.kind, "guest");
  assert.notEqual(logout.player.playerId, guest.player.playerId);
  const login = await store.login({ username: "forest", password: "aaaaaa" });
  assert.equal(login.player.playerId, guest.player.playerId);
  assert.deepEqual(login.player.progress, saved.progress);
});

test("case-insensitive concurrent registration has one winner across database connections", async (t) => {
  const filename = databasePath(t);
  const first = memoryStore(t, { databasePath: filename });
  const second = memoryStore(t, { databasePath: filename });
  const guestA = first.createGuest(),
    guestB = second.createGuest();
  const results = await Promise.allSettled([
    first.registerGuest({
      guestToken: guestA.session.token,
      username: "MapleFox",
      password: "abcdef",
    }),
    second.registerGuest({
      guestToken: guestB.session.token,
      username: "mApLeFoX",
      password: "uvwxyz",
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "USERNAME_TAKEN",
  );
  const survivor = [guestA, guestB].find((guest) =>
    first.resolveSession(guest.session.token, "guest"),
  );
  assert(survivor);
  assert.equal(first.getPublicPlayer(survivor.player.playerId).kind, "guest");
});

test("one guest cannot bind two accounts while password hashing overlaps", async (t) => {
  const store = memoryStore(t);
  const guest = store.createGuest();
  const results = await Promise.allSettled(
    ["Forest", "Meadow"].map((username) =>
      store.registerGuest({
        guestToken: guest.session.token,
        username,
        password: "abcdef",
      }),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "GUEST_SESSION_REQUIRED",
  );
});

test("six characters are accepted, five rejected, and invalid credentials do not authenticate", async (t) => {
  const store = memoryStore(t);
  const guest = store.createGuest();
  await assert.rejects(
    store.registerGuest({
      guestToken: guest.session.token,
      username: "Short",
      password: "12345",
    }),
    { code: "PASSWORD_TOO_SHORT" },
  );
  const registered = await store.registerGuest({
    guestToken: guest.session.token,
    username: "Simple",
    password: "123456",
  });
  assert(registered.session.token);
  await assert.rejects(
    store.login({ username: "Simple", password: "123457" }),
    { code: "INVALID_CREDENTIALS" },
  );
  await assert.rejects(
    store.login({ username: "Missing", password: "123456" }),
    { code: "INVALID_CREDENTIALS" },
  );
  await assert.rejects(store.login({ username: "Simple", password: "12345" }), {
    code: "PASSWORD_TOO_SHORT",
  });
});

test("account login takes precedence but logout restores the browser's unrelated guest", async (t) => {
  const store = memoryStore(t);
  await account(store);
  const original = store.createGuest();
  const saved = store.updatePlayerData(original.player.playerId, {
    progress: { practiced: 4 },
    expectedRevision: 0,
  });
  const login = await store.login({
    username: "FORESTFOX",
    password: "abcdef",
  });
  assert.notEqual(login.player.playerId, original.player.playerId);
  assert.equal(
    store.resolveIdentity({
      guestToken: original.session.token,
      accountToken: login.session.token,
    }).player.playerId,
    login.player.playerId,
  );
  const after = store.logout({
    guestToken: original.session.token,
    accountToken: login.session.token,
  });
  assert.deepEqual(after.player, saved);
  assert.equal(after.session.token, undefined);
  assert.equal(store.resolveSession(login.session.token, "account"), null);
  assert.deepEqual(
    store.resolveIdentity({
      guestToken: original.session.token,
      accountToken: login.session.token,
    }).player,
    saved,
  );
});

test("sessions enforce exact type, expiration, revocation, and account-wide revocation", async (t) => {
  let now = 1000;
  const store = memoryStore(t, {
    now: () => now,
    guestSessionTtlMs: 100,
    accountSessionTtlMs: 200,
  });
  const guest = store.createGuest();
  assert(store.resolveSession(guest.session.token, "guest"));
  assert.equal(store.resolveSession(guest.session.token, "account"), null);
  assert.equal(store.resolveSession("bogus", "guest"), null);
  now = 1100;
  assert.equal(store.resolveSession(guest.session.token, "guest"), null);
  assert.equal(store.pruneExpiredSessions(), 1);
  const next = store.ensureGuest(guest.session.token);
  assert.notEqual(next.player.playerId, guest.player.playerId);
  assert.equal(store.revokeSession(next.session.token, "account"), false);
  assert.equal(store.revokeSession(next.session.token, "guest"), true);
  assert.equal(store.revokeSession(next.session.token, "guest"), false);
  const { registered } = await account(store);
  const second = await store.login({
    username: "ForestFox",
    password: "abcdef",
  });
  assert.equal(
    store.revokePlayerSessions(registered.player.playerId, "account"),
    2,
  );
  assert.equal(store.resolveSession(registered.session.token, "account"), null);
  assert.equal(store.resolveSession(second.session.token, "account"), null);
});

test("one recovery wins concurrently, rotates its code, and invalidates every previous account session", async (t) => {
  const filename = databasePath(t);
  const first = memoryStore(t, { databasePath: filename });
  const second = memoryStore(t, { databasePath: filename });
  const { registered } = await account(first);
  const login = await first.login({
    username: "ForestFox",
    password: "abcdef",
  });
  const request = {
    username: "forestfox",
    recoveryCode: registered.recoveryCode,
    password: "newpass",
  };
  const results = await Promise.allSettled([
    first.recoverAccount(request),
    second.recoverAccount(request),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "INVALID_RECOVERY",
  );
  const recovered = results.find(
    (result) => result.status === "fulfilled",
  ).value;
  assert.equal(recovered.player.playerId, registered.player.playerId);
  assert.notEqual(recovered.recoveryCode, registered.recoveryCode);
  assert.equal(first.resolveSession(registered.session.token, "account"), null);
  assert.equal(first.resolveSession(login.session.token, "account"), null);
  assert(first.resolveSession(recovered.session.token, "account"));
  await assert.rejects(first.recoverAccount(request), {
    code: "INVALID_RECOVERY",
  });
  await assert.rejects(
    first.login({ username: "ForestFox", password: "abcdef" }),
    { code: "INVALID_CREDENTIALS" },
  );
  assert(await first.login({ username: "ForestFox", password: "newpass" }));
  assert(
    await first.recoverAccount({
      ...request,
      recoveryCode: recovered.recoveryCode,
      password: "thirdpass",
    }),
  );
});

test("login verified before recovery cannot issue a stale-password session afterward", async (t) => {
  let release, verified;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const reached = new Promise((resolve) => {
    verified = resolve;
  });
  const store = memoryStore(t, {
    passwords: {
      ...passwords,
      async verify(password, hash) {
        const result = await passwords.verify(password, hash);
        verified();
        await waiting;
        return result;
      },
    },
  });
  const { registered } = await account(store);
  const pendingLogin = store.login({
    username: "ForestFox",
    password: "abcdef",
  });
  const rejected = assert.rejects(pendingLogin, {
    code: "INVALID_CREDENTIALS",
  });
  await reached;
  const recovery = await store.recoverAccount({
    username: "ForestFox",
    recoveryCode: registered.recoveryCode,
    password: "newpass",
  });
  release();
  await rejected;
  assert(store.resolveSession(recovery.session.token, "account"));
});

test("signed-in recovery-code rotation requires the current password and invalidates the previous code", async (t) => {
  const store = memoryStore(t);
  const { guest, registered } = await account(store);
  const otherLogin = await store.login({
    username: "ForestFox",
    password: "abcdef",
  });
  await assert.rejects(
    store.rotateRecoveryCode({
      accountToken: guest.session.token,
      password: "abcdef",
    }),
    { code: "ACCOUNT_SESSION_REQUIRED" },
  );
  await assert.rejects(
    store.rotateRecoveryCode({
      accountToken: registered.session.token,
      password: "wrongpass",
    }),
    { code: "INVALID_CREDENTIALS" },
  );
  const rotated = await store.rotateRecoveryCode({
    accountToken: registered.session.token,
    password: "abcdef",
  });
  assert.deepEqual(Object.keys(rotated).sort(), ["player", "recoveryCode"]);
  assert.deepEqual(rotated.player, registered.player);
  assert.notEqual(rotated.recoveryCode, registered.recoveryCode);
  assert(store.resolveSession(registered.session.token, "account"));
  assert(store.resolveSession(otherLogin.session.token, "account"));
  await assert.rejects(
    store.recoverAccount({
      username: "ForestFox",
      recoveryCode: registered.recoveryCode,
      password: "newpass",
    }),
    { code: "INVALID_RECOVERY" },
  );
  const recovered = await store.recoverAccount({
    username: "ForestFox",
    recoveryCode: rotated.recoveryCode,
    password: "newpass",
  });
  assert.equal(recovered.player.playerId, registered.player.playerId);
});

test("concurrent recovery-code rotations have one winner across database connections", async (t) => {
  const filename = databasePath(t);
  const first = memoryStore(t, { databasePath: filename });
  const second = memoryStore(t, { databasePath: filename });
  const { registered } = await account(first);
  const request = {
    accountToken: registered.session.token,
    password: "abcdef",
  };
  const results = await Promise.allSettled([
    first.rotateRecoveryCode(request),
    second.rotateRecoveryCode(request),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "RECOVERY_CODE_CHANGED",
  );
  const rotated = results.find((result) => result.status === "fulfilled").value;
  assert(
    await first.recoverAccount({
      username: "ForestFox",
      recoveryCode: rotated.recoveryCode,
      password: "newpass",
    }),
  );
});

test("logout, expiration, and password recovery prevent an in-flight code rotation", async (t) => {
  for (const action of ["logout", "expiry", "recover"]) {
    await t.test(action, async (t) => {
      let release,
        verified,
        now = 1000;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const reached = new Promise((resolve) => {
        verified = resolve;
      });
      const store = memoryStore(t, {
        now: () => now,
        accountSessionTtlMs: 200,
        passwords: {
          ...passwords,
          async verify(password, hash) {
            const result = await passwords.verify(password, hash);
            verified();
            await held;
            return result;
          },
        },
      });
      const { registered } = await account(store);
      const pending = store.rotateRecoveryCode({
        accountToken: registered.session.token,
        password: "abcdef",
      });
      const rejected = assert.rejects(pending, {
        code: "ACCOUNT_SESSION_REQUIRED",
      });
      await reached;
      let currentCode = registered.recoveryCode;
      if (action === "logout")
        store.logout({ accountToken: registered.session.token });
      if (action === "expiry") now = 1200;
      if (action === "recover") {
        const recovered = await store.recoverAccount({
          username: "ForestFox",
          recoveryCode: registered.recoveryCode,
          password: "newpass",
        });
        currentCode = recovered.recoveryCode;
      }
      release();
      await rejected;
      // The rejected late request must not invalidate the still-current code.
      assert(
        await store.recoverAccount({
          username: "ForestFox",
          recoveryCode: currentCode,
          password: "thirdpass",
        }),
      );
    });
  }
});

test("invalid and SQL-like usernames are rejected without a database mutation", async (t) => {
  const store = memoryStore(t);
  const guest = store.createGuest();
  for (const username of [
    "",
    "forest fox",
    "Forest1",
    "森林",
    "A'; DROP TABLE players;--",
    " abcdef",
    "abcdef ",
  ])
    await assert.rejects(
      store.registerGuest({
        guestToken: guest.session.token,
        username,
        password: "abcdef",
      }),
      { code: "INVALID_USERNAME" },
    );
  assert.deepEqual(validateUsername("MixedCASE"), {
    username: "MixedCASE",
    usernameKey: "mixedcase",
  });
  assert.deepEqual(store.getPublicPlayer(guest.player.playerId), guest.player);
  assert(store.resolveSession(guest.session.token, "guest"));
});

test("registration rolls back credential insert and guest revocation if account session storage fails", async (t) => {
  const filename = databasePath(t);
  const store = memoryStore(t, { databasePath: filename });
  const guest = store.createGuest();
  const sql = new DatabaseSync(filename);
  t.after(() => sql.close());
  sql.exec(`CREATE TRIGGER fail_account_session BEFORE INSERT ON sessions
    WHEN NEW.type = 'account' BEGIN SELECT RAISE(ABORT, 'TEST_DISK_WRITE_FAILURE'); END`);
  await assert.rejects(
    store.registerGuest({
      guestToken: guest.session.token,
      username: "Unbroken",
      password: "abcdef",
    }),
    /TEST_DISK_WRITE_FAILURE/,
  );
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM credentials").get().n, 0);
  assert.equal(store.getPublicPlayer(guest.player.playerId).kind, "guest");
  assert(store.resolveSession(guest.session.token, "guest"));
  sql.exec("DROP TRIGGER fail_account_session");
  const registered = await store.registerGuest({
    guestToken: guest.session.token,
    username: "Unbroken",
    password: "abcdef",
  });
  assert.equal(registered.player.playerId, guest.player.playerId);
});

test("public reads exclude secrets, and persistence contains only token/recovery hashes", async (t) => {
  const filename = databasePath(t);
  const store = memoryStore(t, { databasePath: filename });
  const { guest, registered } = await account(
    store,
    "PrivateFox",
    "plainsecret",
  );
  const resolved = store.resolveSession(registered.session.token, "account");
  const publicJson = JSON.stringify({
    player: registered.player,
    resolved,
    read: store.getPublicPlayer(registered.player.playerId),
  });
  for (const secret of [
    "plainsecret",
    registered.recoveryCode,
    registered.session.token,
    "password_hash",
    "recovery_hash",
    "token_hash",
    "username_key",
  ])
    assert(!publicJson.includes(secret));
  const sql = new DatabaseSync(filename);
  try {
    const credential = sql.prepare("SELECT * FROM credentials").get();
    const session = sql.prepare("SELECT * FROM sessions").get();
    assert.match(credential.password_hash, /^scrypt\$v1\$/);
    assert.equal(credential.recovery_hash, digest(registered.recoveryCode));
    assert.equal(Buffer.from(registered.recoveryCode, "base64url").length, 32);
    assert.equal(session.token_hash, digest(registered.session.token));
    assert.deepEqual(Object.keys(session).sort(), [
      "expires_at",
      "player_id",
      "token_hash",
      "type",
    ]);
    const rows = JSON.stringify({ credential, session });
    for (const secret of [
      "plainsecret",
      registered.recoveryCode,
      registered.session.token,
      guest.session.token,
    ])
      assert(!rows.includes(secret));
  } finally {
    sql.close();
  }
});

test("player data uses revision CAS and does not expose shared mutable objects", (t) => {
  const store = memoryStore(t);
  const guest = store.createGuest();
  const saved = store.updatePlayerData(guest.player.playerId, {
    profile: { grade: 1 },
    expectedRevision: 0,
  });
  saved.profile.grade = 6;
  assert.equal(store.getPublicPlayer(guest.player.playerId).profile.grade, 1);
  assert.throws(
    () =>
      store.updatePlayerData(guest.player.playerId, {
        profile: { grade: 5 },
        expectedRevision: 0,
      }),
    { code: "REVISION_CONFLICT" },
  );
  assert.throws(
    () =>
      store.updatePlayerData("missing", { profile: {}, expectedRevision: 0 }),
    { code: "PLAYER_NOT_FOUND" },
  );
  assert.throws(
    () =>
      store.updatePlayerData(guest.player.playerId, {
        progress: { big: "x".repeat(PLAYER_PROGRESS_MAX_BYTES) },
        expectedRevision: 1,
      }),
    { code: "PLAYER_DATA_TOO_LARGE" },
  );
  assert.equal(store.getPublicPlayer(guest.player.playerId).revision, 1);
});

test("default stores are isolated and a future database schema is rejected", (t) => {
  const first = memoryStore(t),
    second = memoryStore(t);
  const guest = first.createGuest();
  assert.equal(second.resolveSession(guest.session.token, "guest"), null);
  const filename = databasePath(t);
  const initial = createIdentityStore({ databasePath: filename, passwords });
  initial.close();
  const sql = new DatabaseSync(filename);
  sql
    .prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    )
    .run(IDENTITY_SCHEMA_VERSION + 1, Date.now());
  sql.close();
  assert.throws(
    () => createIdentityStore({ databasePath: filename, passwords }),
    { code: "UNSUPPORTED_DATABASE_VERSION" },
  );
});
