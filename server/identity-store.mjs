import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  passwords as defaultPasswords,
  validatePassword,
} from "./passwords.mjs";

export const IDENTITY_SCHEMA_VERSION = 2;
// Limits apply to normalized UTF-8 JSON, not a backup's source characters.
// Profiles contain metadata/summaries; the v3 learning archive needs more room.
export const PLAYER_PROFILE_MAX_BYTES = 1024 * 1024;
export const PLAYER_PROGRESS_MAX_BYTES = 8 * 1024 * 1024;
export const IDENTITY_DEFAULTS = Object.freeze({
  guestSessionTtlMs: 365 * 24 * 60 * 60 * 1000,
  accountSessionTtlMs: 30 * 24 * 60 * 60 * 1000,
});
const MAX_USERNAME_BYTES = 4096;
const MAX_RECEIPT_BYTES = 64 * 1024;
const PLAYER_COLUMNS = `p.player_id, p.guest_name, p.created_at,
  c.username, d.profile_json, d.progress_json, d.revision, d.updated_at`;
const PLAYER_TABLES = `FROM players p LEFT JOIN credentials c ON c.player_id = p.player_id
  JOIN progress d ON d.player_id = p.player_id`;
const SELECT_PLAYER = `SELECT ${PLAYER_COLUMNS} ${PLAYER_TABLES}`;
const BRIEF_COLUMNS = `p.player_id, p.guest_name, c.username`;
const BRIEF_TABLES = `FROM players p LEFT JOIN credentials c ON c.player_id = p.player_id`;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const opaqueToken = () => randomBytes(32).toString("base64url");
const validToken = (token) =>
  typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
const validType = (type) => type === "guest" || type === "account";

export function validateUsername(username) {
  if (
    typeof username !== "string" ||
    Buffer.byteLength(username, "utf8") > MAX_USERNAME_BYTES ||
    !/^[A-Za-z]+$/.test(username)
  )
    fail("INVALID_USERNAME");
  return { username, usernameKey: username.toLowerCase() };
}

function publicPlayer(row) {
  if (!row) return null;
  return {
    playerId: row.player_id,
    kind: row.username === null ? "guest" : "account",
    name: row.username ?? row.guest_name,
    username: row.username,
    createdAt: row.created_at,
    profile: JSON.parse(row.profile_json),
    progress: JSON.parse(row.progress_json),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function dataJson(value, maxBytes = PLAYER_PROGRESS_MAX_BYTES) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_PLAYER_DATA");
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    fail("INVALID_PLAYER_DATA");
  }
  if (typeof json !== "string" || !json.startsWith("{"))
    fail("INVALID_PLAYER_DATA");
  if (Buffer.byteLength(json, "utf8") > maxBytes)
    fail("PLAYER_DATA_TOO_LARGE");
  return json;
}

function eventIdentity({ eventId, type, payload }) {
  if (typeof eventId !== "string" || !/^[A-Za-z0-9_:.\-]{1,200}$/.test(eventId) ||
      typeof type !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(type))
    fail("INVALID_PLAYER_EVENT");
  // Canonical object keys make an identical retried intent insensitive to JSON
  // property order. Store the digest, not private feedback or a second archive.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === "object" ? Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    ) : value;
  let fingerprint;
  try {
    fingerprint = digest(type + "\n" + JSON.stringify(canonical(JSON.parse(dataJson(payload)))));
  } catch (error) {
    if (error.code === "PLAYER_DATA_TOO_LARGE") throw error;
    fail("INVALID_PLAYER_EVENT");
  }
  return { eventId, type, fingerprint };
}

function briefPlayer(row) {
  return {
    playerId: row.player_id,
    kind: row.username === null ? "guest" : "account",
    name: row.username ?? row.guest_name,
    username: row.username,
  };
}

/** Persistent identity and server-owned data. Never expose a database row.
 * Authentication results contain session.token only for the HTTP cookie writer;
 * serialize result.player for clients and show recoveryCode only once.
 * This constructor defaults to an isolated in-memory database for tests. The
 * production entrypoint must pass a durable, non-repository databasePath.
 */
export class IdentityStore {
  #db;
  #passwords;
  #now;
  #ttl;
  #closed = false;

  constructor({
    databasePath = ":memory:",
    passwords = defaultPasswords,
    now = () => Date.now(),
    guestSessionTtlMs = IDENTITY_DEFAULTS.guestSessionTtlMs,
    accountSessionTtlMs = IDENTITY_DEFAULTS.accountSessionTtlMs,
  } = {}) {
    for (const ttl of [guestSessionTtlMs, accountSessionTtlMs])
      if (!Number.isSafeInteger(ttl) || ttl <= 0) fail("INVALID_SESSION_TTL");
    this.#passwords = passwords;
    this.#now = now;
    this.#ttl = { guest: guestSessionTtlMs, account: accountSessionTtlMs };
    this.#db = new DatabaseSync(databasePath);
    try {
      this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      if (databasePath !== ":memory:")
        this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      this.#migrate();
    } catch (error) {
      this.#db.close();
      this.#closed = true;
      throw error;
    }
  }

  #transaction(work) {
    if (this.#closed) fail("IDENTITY_STORE_CLOSED");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #migrate() {
    this.#transaction(() => {
      this.#db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
      ) STRICT`);
      const latest =
        this.#db
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get().version ?? 0;
      if (latest > IDENTITY_SCHEMA_VERSION)
        fail("UNSUPPORTED_DATABASE_VERSION");
      if (latest < 1) {
        this.#db.exec(`
          CREATE TABLE players (
            player_id TEXT PRIMARY KEY,
            guest_name TEXT NOT NULL,
            created_at INTEGER NOT NULL
          ) STRICT;
          CREATE TABLE credentials (
            player_id TEXT PRIMARY KEY REFERENCES players(player_id),
            username TEXT NOT NULL,
            username_key TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            recovery_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          ) STRICT;
          CREATE TABLE sessions (
            token_hash TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('guest', 'account')),
            player_id TEXT NOT NULL REFERENCES players(player_id),
            expires_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX sessions_player ON sessions(player_id);
          CREATE INDEX sessions_expiry ON sessions(expires_at);
          CREATE TABLE progress (
            player_id TEXT PRIMARY KEY REFERENCES players(player_id),
            profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
            progress_json TEXT NOT NULL CHECK (json_valid(progress_json)),
            revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
            updated_at INTEGER NOT NULL
          ) STRICT;
        `);
        this.#db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(1, this.#now());
      }
      if (latest < 2) {
        this.#db.exec(`CREATE TABLE player_events (
          player_id TEXT NOT NULL REFERENCES players(player_id),
          event_id TEXT NOT NULL,
          type TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
          created_at INTEGER NOT NULL,
          PRIMARY KEY (player_id, event_id)
        ) STRICT`);
        this.#db.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        ).run(2, this.#now());
      }
    });
  }

  #newSession(playerId, type) {
    const token = opaqueToken();
    const expiresAt = this.#now() + this.#ttl[type];
    this.#db
      .prepare(
        "INSERT INTO sessions (token_hash, type, player_id, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(digest(token), type, playerId, expiresAt);
    return { token, type, expiresAt };
  }

  #newGuest() {
    const playerId = randomUUID();
    const name =
      ["Willow", "Maple", "Clover", "Hazel", "Fern", "Cedar"][randomInt(6)] +
      ["Fox", "Owl", "Deer", "Hare", "Robin", "Otter"][randomInt(6)] +
      String(randomInt(1000, 10000));
    const now = this.#now();
    this.#db
      .prepare(
        "INSERT INTO players (player_id, guest_name, created_at) VALUES (?, ?, ?)",
      )
      .run(playerId, name, now);
    this.#db
      .prepare(
        "INSERT INTO progress (player_id, profile_json, progress_json, revision, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(playerId, "{}", "{}", 0, now);
    return {
      player: this.getPublicPlayer(playerId),
      session: this.#newSession(playerId, "guest"),
    };
  }

  createGuest() {
    return this.#transaction(() => this.#newGuest());
  }

  ensureGuest(guestToken) {
    return this.resolveSession(guestToken, "guest") ?? this.createGuest();
  }

  getPublicPlayer(playerId) {
    return publicPlayer(
      this.#db.prepare(`${SELECT_PLAYER} WHERE p.player_id = ?`).get(playerId),
    );
  }

  resolveSession(token, type) {
    if (!validToken(token) || !validType(type)) return null;
    const row = this.#db
      .prepare(
        `SELECT ${PLAYER_COLUMNS}, s.type AS session_type,
      s.expires_at AS session_expires_at ${PLAYER_TABLES}
      JOIN sessions s ON s.player_id = p.player_id
      WHERE s.token_hash = ? AND s.type = ? AND s.expires_at > ?
        AND ((s.type = 'guest' AND c.player_id IS NULL) OR (s.type = 'account' AND c.player_id IS NOT NULL))`,
      )
      .get(digest(token), type, this.#now());
    if (!row) return null;
    return {
      player: publicPlayer(row),
      session: { type: row.session_type, expiresAt: row.session_expires_at },
    };
  }

  resolveIdentity({ guestToken, accountToken } = {}) {
    return (
      this.resolveSession(accountToken, "account") ??
      this.resolveSession(guestToken, "guest")
    );
  }

  // WebSocket authorization needs identity/session state only. Do not join or
  // parse progress here: a frame must not deserialize years of learning data.
  resolveSessionBrief(token, type) {
    if (!validToken(token) || !validType(type)) return null;
    const row = this.#db.prepare(`SELECT ${BRIEF_COLUMNS},
      s.type AS session_type, s.expires_at AS session_expires_at ${BRIEF_TABLES}
      JOIN sessions s ON s.player_id = p.player_id
      WHERE s.token_hash = ? AND s.type = ? AND s.expires_at > ?
      AND ((s.type = 'guest' AND c.player_id IS NULL) OR
           (s.type = 'account' AND c.player_id IS NOT NULL))`
    ).get(digest(token), type, this.#now());
    return row ? {
      player: briefPlayer(row),
      session: { type: row.session_type, expiresAt: row.session_expires_at },
    } : null;
  }

  resolveIdentityBrief({ guestToken, accountToken } = {}) {
    return this.resolveSessionBrief(accountToken, "account") ??
      this.resolveSessionBrief(guestToken, "guest");
  }

  async registerGuest({ guestToken, username, password }) {
    const { usernameKey } = validateUsername(username);
    validatePassword(password);
    const initial = this.resolveSession(guestToken, "guest");
    if (!initial) fail("GUEST_SESSION_REQUIRED");
    const passwordHash = await this.#passwords.hash(password);
    const recoveryCode = opaqueToken();
    return this.#transaction(() => {
      const current = this.resolveSession(guestToken, "guest");
      if (!current || current.player.playerId !== initial.player.playerId)
        fail("GUEST_SESSION_REQUIRED");
      if (
        this.#db
          .prepare("SELECT 1 FROM credentials WHERE username_key = ?")
          .get(usernameKey)
      )
        fail("USERNAME_TAKEN");
      const now = this.#now();
      this.#db
        .prepare(
          `INSERT INTO credentials
        (player_id, username, username_key, password_hash, recovery_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          current.player.playerId,
          username,
          usernameKey,
          passwordHash,
          digest(recoveryCode),
          now,
          now,
        );
      this.#db
        .prepare("DELETE FROM sessions WHERE player_id = ? AND type = ?")
        .run(current.player.playerId, "guest");
      const session = this.#newSession(current.player.playerId, "account");
      return {
        player: this.getPublicPlayer(current.player.playerId),
        session,
        recoveryCode,
      };
    });
  }

  async login({ username, password }) {
    const { usernameKey } = validateUsername(username);
    validatePassword(password);
    const credential = this.#db
      .prepare(
        "SELECT player_id, password_hash FROM credentials WHERE username_key = ?",
      )
      .get(usernameKey);
    // Unknown names perform the same bounded password derivation as a known name.
    const valid = await this.#passwords.verify(
      password,
      credential?.password_hash ?? this.#passwords.dummyHash,
    );
    if (!credential || !valid) fail("INVALID_CREDENTIALS");
    return this.#transaction(() => {
      // A concurrent password recovery must not allow an old-password login to
      // mint a fresh session after the recovery revoked previous sessions.
      const current = this.#db
        .prepare("SELECT password_hash FROM credentials WHERE player_id = ?")
        .get(credential.player_id);
      if (current?.password_hash !== credential.password_hash)
        fail("INVALID_CREDENTIALS");
      return {
        player: this.getPublicPlayer(credential.player_id),
        session: this.#newSession(credential.player_id, "account"),
      };
    });
  }

  logout({ guestToken, accountToken } = {}) {
    return this.#transaction(() => {
      if (validToken(accountToken))
        this.#db
          .prepare("DELETE FROM sessions WHERE token_hash = ? AND type = ?")
          .run(digest(accountToken), "account");
      return this.resolveSession(guestToken, "guest") ?? this.#newGuest();
    });
  }

  async rotateRecoveryCode({ accountToken, password }) {
    validatePassword(password);
    const initial = this.resolveSession(accountToken, "account");
    if (!initial) fail("ACCOUNT_SESSION_REQUIRED");
    const playerId = initial.player.playerId;
    const credential = this.#db
      .prepare(
        "SELECT password_hash, recovery_hash FROM credentials WHERE player_id = ?",
      )
      .get(playerId);
    if (
      !credential ||
      !(await this.#passwords.verify(password, credential.password_hash))
    )
      fail("INVALID_CREDENTIALS");
    const recoveryCode = opaqueToken();
    return this.#transaction(() => {
      // Logout, expiry, or account recovery can happen while scrypt is running.
      // Recheck the exact session before allowing this sensitive account change.
      const current = this.resolveSession(accountToken, "account");
      if (!current || current.player.playerId !== playerId)
        fail("ACCOUNT_SESSION_REQUIRED");
      const latest = this.#db
        .prepare("SELECT password_hash FROM credentials WHERE player_id = ?")
        .get(playerId);
      if (latest?.password_hash !== credential.password_hash)
        fail("INVALID_CREDENTIALS");
      const updated = this.#db
        .prepare(
          `UPDATE credentials SET recovery_hash = ?, updated_at = ?
          WHERE player_id = ? AND password_hash = ? AND recovery_hash = ?`,
        )
        .run(
          digest(recoveryCode),
          this.#now(),
          playerId,
          credential.password_hash,
          credential.recovery_hash,
        );
      // Two overlapping requests must not return two apparently usable codes.
      if (updated.changes !== 1) fail("RECOVERY_CODE_CHANGED");
      return { player: this.getPublicPlayer(playerId), recoveryCode };
    });
  }

  async recoverAccount({ username, recoveryCode, password }) {
    const { usernameKey } = validateUsername(username);
    validatePassword(password);
    if (!validToken(recoveryCode)) fail("INVALID_RECOVERY");
    const credential = this.#db
      .prepare(
        "SELECT player_id, recovery_hash FROM credentials WHERE username_key = ?",
      )
      .get(usernameKey);
    const suppliedHash = digest(recoveryCode);
    if (
      !credential ||
      !timingSafeEqual(
        Buffer.from(credential.recovery_hash, "hex"),
        Buffer.from(suppliedHash, "hex"),
      )
    )
      fail("INVALID_RECOVERY");
    const passwordHash = await this.#passwords.hash(password);
    const nextRecoveryCode = opaqueToken();
    return this.#transaction(() => {
      const updated = this.#db
        .prepare(
          `UPDATE credentials SET password_hash = ?, recovery_hash = ?, updated_at = ?
        WHERE player_id = ? AND recovery_hash = ?`,
        )
        .run(
          passwordHash,
          digest(nextRecoveryCode),
          this.#now(),
          credential.player_id,
          suppliedHash,
        );
      if (updated.changes !== 1) fail("INVALID_RECOVERY");
      this.#db
        .prepare("DELETE FROM sessions WHERE player_id = ?")
        .run(credential.player_id);
      const session = this.#newSession(credential.player_id, "account");
      return {
        player: this.getPublicPlayer(credential.player_id),
        session,
        recoveryCode: nextRecoveryCode,
      };
    });
  }

  revokeSession(token, type) {
    if (!validToken(token) || !validType(type)) return false;
    return this.#transaction(
      () =>
        this.#db
          .prepare("DELETE FROM sessions WHERE token_hash = ? AND type = ?")
          .run(digest(token), type).changes === 1,
    );
  }

  revokePlayerSessions(playerId, type) {
    if (type !== undefined && !validType(type)) fail("INVALID_SESSION_TYPE");
    return this.#transaction(() =>
      type === undefined
        ? this.#db
            .prepare("DELETE FROM sessions WHERE player_id = ?")
            .run(playerId).changes
        : this.#db
            .prepare("DELETE FROM sessions WHERE player_id = ? AND type = ?")
            .run(playerId, type).changes,
    );
  }

  pruneExpiredSessions() {
    return this.#transaction(
      () =>
        this.#db
          .prepare("DELETE FROM sessions WHERE expires_at <= ?")
          .run(this.#now()).changes,
    );
  }

  // Server-only CAS setter. HTTP handlers must choose allowed profile fields;
  // client-supplied rewards, wallet balances, and progress are never authority.
  updatePlayerData(playerId, { profile, progress, expectedRevision }) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      fail("INVALID_REVISION");
    const profileJson = profile === undefined ? undefined : dataJson(profile, PLAYER_PROFILE_MAX_BYTES);
    const progressJson =
      progress === undefined ? undefined : dataJson(progress);
    if (profileJson === undefined && progressJson === undefined)
      fail("INVALID_PLAYER_DATA");
    return this.#transaction(() => {
      const updated = this.#db
        .prepare(
          `UPDATE progress SET
        profile_json = COALESCE(?, profile_json), progress_json = COALESCE(?, progress_json),
        revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?`,
        )
        .run(
          profileJson ?? null,
          progressJson ?? null,
          this.#now(),
          playerId,
          expectedRevision,
        );
      if (updated.changes !== 1) {
        if (!this.getPublicPlayer(playerId)) fail("PLAYER_NOT_FOUND");
        fail("REVISION_CONFLICT");
      }
      return this.getPublicPlayer(playerId);
    });
  }

  #existingEvent(playerId, identity) {
    const row = this.#db.prepare(`SELECT type, fingerprint, receipt_json
      FROM player_events WHERE player_id = ? AND event_id = ?`
    ).get(playerId, identity.eventId);
    if (!row) return null;
    if (row.type !== identity.type || row.fingerprint !== identity.fingerprint)
      fail("PLAYER_EVENT_CONFLICT");
    return {
      player: this.getPublicPlayer(playerId),
      receipt: JSON.parse(row.receipt_json),
      duplicate: true,
    };
  }

  // Server-only replay lookup. The transactional commit below repeats this
  // check; callers cannot make a replay safe using a check-then-write sequence.
  getPlayerEvent(playerId, event) {
    return this.#existingEvent(playerId, eventIdentity(event));
  }

  // A polling client only needs to know whether its authoritative receipt has
  // committed. No progress JSON or fingerprint/payload is exposed by this read.
  hasPlayerEvent(playerId, eventId) {
    if (typeof eventId !== "string" || !/^[A-Za-z0-9_:.\-]{1,200}$/.test(eventId))
      fail("INVALID_PLAYER_EVENT");
    return !!this.#db.prepare(
      "SELECT 1 FROM player_events WHERE player_id = ? AND event_id = ?",
    ).get(playerId, eventId);
  }

  /** Atomically record one validated server intent and its resulting snapshot.
   * The original receipt is replayed, while player is the latest durable view.
   * This method is never an HTTP API accepting arbitrary client data. */
  commitPlayerEvent(playerId, {
    eventId, type, payload, expectedRevision, profile, progress, receipt = {},
  }) {
    const identity = eventIdentity({ eventId, type, payload });
    return this.#transaction(() => {
      const existing = this.#existingEvent(playerId, identity);
      if (existing) return existing;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
          expectedRevision >= Number.MAX_SAFE_INTEGER)
        fail("INVALID_REVISION");
      const profileJson = profile === undefined ? null : dataJson(profile, PLAYER_PROFILE_MAX_BYTES);
      const progressJson = progress === undefined ? null : dataJson(progress);
      if (profileJson === null && progressJson === null) fail("INVALID_PLAYER_DATA");
      const savedReceipt = {
        ...JSON.parse(dataJson(receipt, MAX_RECEIPT_BYTES)),
        eventId, type, revision: expectedRevision + 1,
      };
      const receiptJson = dataJson(savedReceipt, MAX_RECEIPT_BYTES);
      const now = this.#now();
      const updated = this.#db.prepare(`UPDATE progress SET
        profile_json = COALESCE(?, profile_json), progress_json = COALESCE(?, progress_json),
        revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?`
      ).run(profileJson, progressJson, now, playerId, expectedRevision);
      if (updated.changes !== 1) {
        if (!this.#db.prepare("SELECT 1 FROM players WHERE player_id = ?").get(playerId))
          fail("PLAYER_NOT_FOUND");
        fail("REVISION_CONFLICT");
      }
      this.#db.prepare(`INSERT INTO player_events
        (player_id, event_id, type, fingerprint, receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`
      ).run(playerId, eventId, type, identity.fingerprint, receiptJson, now);
      return { player: this.getPublicPlayer(playerId), receipt: savedReceipt, duplicate: false };
    });
  }

  close() {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
  }
}

export function createIdentityStore(options) {
  return new IdentityStore(options);
}
