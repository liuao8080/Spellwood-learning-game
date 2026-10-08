import { createProgressModel, PROGRESS_LIMITS, skinIntent } from "./progress.mjs";
import { CARD } from "../cards.mjs";
import { FINISH } from "../collection.mjs";

const clone = (value) => structuredClone(value);
const plain = (value) => !!value && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const token = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value) &&
  !Object.hasOwn(Object.prototype, value) && value !== "prototype";
const fail = (code, extra = {}) => { throw Object.assign(new Error(code), { code, ...extra }); };
const requestId = () => globalThis.crypto?.randomUUID?.() ||
  `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const same = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.hasOwn(right, key) && same(left[key], right[key]));
};
const messages = Object.freeze({
  READ_FAILED: "暂时读不到账号记录，已载入的记录仍留在本页，请重试。",
  NETWORK_ERROR: "暂时连不上服务器，账号记录尚未同步，请保留本页并重试。",
  TIMEOUT: "服务器尚未确认这次操作；重试会继续确认同一次操作，不会重新抽取或扣除。",
  INVALID_RESPONSE: "服务器回复未通过校验，原记录仍保留，请稍后重试。",
  SERVER_ERROR: "服务器暂时无法保存，原记录仍保留，请稍后重试。",
  PROGRESS_UNSYNCED: "上次操作尚未确认，请先重试同步；本页已有记录仍可导出。",
  RECEIPT_PENDING: "服务器还没有确认这条学习或对战记录，请稍后重试同步。",
  PROFILE_CHANGED: "当前登录身份已变化，旧账号记录不会合入新账号，请重新确认身份。",
  SESSION_REQUIRED: "登录身份已过期，请重新确认身份后读取账号记录。",
  UNAUTHENTICATED: "登录身份已过期，请重新确认身份后读取账号记录。",
  IDENTITY_REQUIRED: "登录身份已过期，请重新确认身份后读取账号记录。",
  PROGRESS_PENDING: "学习结果正在等待服务器保存，请保留本页并重试同步。",
  PROGRESS_UNAVAILABLE: "服务器暂时无法读取或保存记录，已有内容仍保留，请稍后重试。",
  PLAYER_DATA_TOO_LARGE: "账号记录已达到容量上限，请先导出备份再联系维护者。",
  PAYLOAD_TOO_LARGE: "导入文件过大，请保留原文件并选择符合大小限制的备份。",
  LEGACY_IMPORT_CONFLICT: "账号已有记录，无法导入覆盖。现有账号记录和选中的备份均未改变。",
  STALE_REVISION: "确认期间账号记录已变化，请重新选择备份并核对摘要。",
  INSUFFICIENT_SKIN_TICKETS: "造型券还不够，可以先看看今日小任务。",
  INSUFFICIENT_OFFICIAL_DUST: "指定兑换需要100正式叶屑，当前余额还不够。",
  SKIN_PACK_PENDING: "有一份造型礼盒还没看完，先接着揭晓吧。",
  SKIN_PACK_NOT_FOUND: "这份造型礼盒已变化，请刷新账号记录。",
  SKIN_NOT_OWNED: "还没有获得这款造型，暂时不能装备。",
});
const serverCodes = new Set([
  ...Object.keys(messages), "ACCOUNT_SESSION_REQUIRED", "GUEST_SESSION_REQUIRED", "PLAYER_NOT_FOUND",
  "PROGRESS_IDENTITY_MISMATCH", "INVALID_STORED_PROGRESS", "PROGRESS_BUSY", "PROGRESS_FULL",
  "INVALID_PROGRESS", "INVALID_PREFERENCES", "INVALID_CUSTOM_DECK", "INVALID_COLLECTION_ACTION",
  "TEST_PACKS_DISABLED", "PACK_NOT_REVEALED", "FINISH_NOT_COLLECTED", "COLLECTION_HISTORY_FULL",
  "REWARD_HISTORY_FULL", "NO_REWARD_PACK", "NOT_ENOUGH_DUST", "OPENING_PENDING",
  "INVALID_PARTICIPATION", "INVALID_LEARNING", "LEARNING_RECEIPT_REQUIRED", "LEARNING_NOT_FOUND",
  "INVALID_IMPORT", "IMPORT_TOO_LARGE", "INVALID_REQUEST_ID", "INVALID_RECEIPT", "RECEIPT_NOT_FOUND",
  "REVISION_CONFLICT", "EVENT_CONFLICT", "EVENT_ID_CONFLICT", "REQUEST_ID_CONFLICT",
  "PLAYER_EVENT_CONFLICT", "INVALID_PROGRESS_ACTION",
  "INVALID_REWARD_STATE", "INVALID_SKIN_ACTION", "INVALID_SKIN_MODE", "INVALID_SKIN_PACK", "INVALID_SKIN_ID",
  "INVALID_SKIN_REVEAL", "SKIN_PACK_PENDING", "SKIN_PACK_NOT_FOUND", "SKIN_NOT_OWNED",
  "INSUFFICIENT_SKIN_TICKETS", "INSUFFICIENT_OFFICIAL_DUST", "REWARD_BALANCE_LIMIT",
  "REWARD_HISTORY_EXPIRED", "REWARD_EVENT_CONFLICT", "REWARD_DAY_EXPIRED", "REWARD_REVISION_CONFLICT",
  "JSON_REQUIRED", "BAD_JSON", "BODY_TOO_LARGE", "BAD_REQUEST", "ORIGIN_REJECTED", "HOST_REJECTED",
  "METHOD_NOT_ALLOWED", "RATE_LIMIT", "RATE_LIMITED", "WRITE_FAILED",
]);
const recoverableCodes = new Set([
  "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "SERVER_ERROR", "READ_FAILED", "WRITE_FAILED",
  "PROGRESS_BUSY", "PROGRESS_PENDING", "PROGRESS_UNAVAILABLE", "RATE_LIMIT", "RATE_LIMITED", "INVALID_STORED_PROGRESS",
]);
const summaryFields = ["learnedQuestions", "learningAttempts", "correctAnswers", "legacyRecords",
  "onlineRecords", "learningDays", "collectionCopies"];
function safeSummary(value) {
  if (!plain(value)) return undefined;
  const out = {};
  for (const key of ["current", "incoming"]) {
    if (!plain(value[key])) continue;
    out[key] = Object.fromEntries(summaryFields.filter((name) =>
      Number.isSafeInteger(value[key][name]) && value[key][name] >= 0).map((name) => [name, value[key][name]]));
  }
  if (Number.isSafeInteger(value.currentRevision) && value.currentRevision >= 0)
    out.currentRevision = value.currentRevision;
  if (value.canReplace === false) out.canReplace = false;
  return out;
}

/** Only intents cross this boundary. In particular an opening has no client
 * random cards, timestamps or id, and a wallet never appears in a POST body. */
function collectionIntent(action) {
  if (!plain(action)) fail("INVALID_COLLECTION_ACTION");
  const fields = {
    "open-pack": ["kind", "mode"], "reveal-pack": ["kind", "id", "index"],
    "close-pack": ["kind", "id"], "redeem-finish": ["kind", "mode", "cardId", "finish"],
    "equip-finish": ["kind", "mode", "cardId", "finish"],
  };
  if (!Object.hasOwn(fields, action.kind) || Object.keys(action).some((key) => !fields[action.kind].includes(key)))
    fail("INVALID_COLLECTION_ACTION");
  const result = Object.fromEntries(fields[action.kind].filter((key) => Object.hasOwn(action, key))
    .map((key) => [key, action[key]]));
  if (action.kind === "open-pack") {
    if (!["earned", "test"].includes(action.mode)) fail("INVALID_COLLECTION_ACTION");
  } else if (["reveal-pack", "close-pack"].includes(action.kind)) {
    if (!token(action.id) || action.kind === "reveal-pack" && action.index !== "all" &&
        (!Number.isInteger(action.index) || action.index < 0 || action.index > 9)) fail("INVALID_COLLECTION_ACTION");
  } else if (!["earned", "test"].includes(action.mode) || !Object.hasOwn(CARD, action.cardId) ||
      !(Object.hasOwn(FINISH, action.finish) || action.kind === "equip-finish" && action.finish === "base"))
    fail("INVALID_COLLECTION_ACTION");
  return result;
}

/** Cookie-authenticated, memory-only account progress. Unknown mutation outcomes
 * keep their original request id until a server response confirms that intent.
 * No local ProgressStore mutation, random pack or uploaded learning/result is
 * used here. Existing local practice continues to use ProgressStore separately. */
export class RemoteProgressStore {
  constructor({ questions = [], playerId = null, onChange = () => {}, onIssue = () => {},
    fetcher = globalThis.fetch?.bind(globalThis), timeoutMs = 15000,
    monotonicNow = () => globalThis.performance.now() } = {}) {
    if (typeof fetcher !== "function") throw new TypeError("RemoteProgressStore requires fetch");
    if (playerId !== null && !token(playerId)) fail("INVALID_PLAYER_ID");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("Invalid timeoutMs");
    if (typeof monotonicNow !== "function") throw new TypeError("Invalid monotonicNow");
    this._monotonicNow = monotonicNow; this._serverClock = null;
    this.model = createProgressModel({ questions });
    this.fetcher = fetcher; this.timeoutMs = timeoutMs;
    this.onChange = onChange; this.onIssue = onIssue;
    this._playerId = playerId; this._data = null; this._epoch = 0; this._disposed = false;
    this._serial = Promise.resolve(); this._inflight = new Map(); this._controllers = new Set();
    this._pending = null; this._receipts = new Set(); this._prepared = new WeakMap();
    this.loaded = false; this.readPending = true; this.issue = null;
    this.singlePage = false; this.remote = true; this.recoveryRaw = ""; this.recoveryKey = null;
  }
  get data() { return this._data ? clone(this._data) : null; }
  get revision() { return this._data?.revision ?? 0; }
  /** Latest authenticated response timestamp, never an account field. */
  get serverNow() { return this._serverClock?.serverNow ?? null; }
  /** Display-only clock. Reward decisions continue to use server observations. */
  rewardNow() {
    const clock = this._serverClock;
    if (!clock) return null;
    const observed = this._monotonicNow();
    if (Number.isFinite(observed)) clock.elapsed = Math.max(clock.elapsed, observed - clock.observedAt, 0);
    return Math.min(4102444800000, clock.serverNow + Math.floor(clock.elapsed));
  }
  get dirty() { return !!this._pending || !!this._receipts.size; }
  get playerId() { return this._playerId; }
  set playerId(value) { this.setPlayerId(value); }
  get epoch() { return this._epoch; }
  _result(ok, extra = {}) {
    return { ok, data: this.data, playerId: this.playerId, revision: this.revision,
      dirty: this.dirty, singlePage: false, ...extra };
  }
  _stale() { return { ok: false, code: "STALE_REQUEST", stale: true, data: null, revision: 0 }; }
  _current(epoch) { return !this._disposed && epoch === this._epoch; }
  _notify(extra = {}) {
    if (this._disposed) return;
    try { this.onChange(this.data, this._result(!this.issue && !this.dirty,
      { issue: this.issue ? clone(this.issue) : null, ...extra })); } catch { /* Presentation is not a commit. */ }
  }
  _problem(code, extra = {}) {
    const epoch = this._epoch;
    this.issue = { code, message: messages[code] || "这次账号操作尚未完成，请查看同步状态并重试。", ...extra };
    try { this.onIssue(clone(this.issue)); } catch {}
    if (!this._current(epoch)) return this._stale();
    this._notify();
    if (!this._current(epoch)) return this._stale();
    return this._result(false, { code, issue: clone(this.issue), ...extra });
  }
  _enqueue(key, operation) {
    if (this._disposed) return Promise.resolve(this._stale());
    if (this._inflight.has(key)) return this._inflight.get(key);
    const epoch = this._epoch;
    const task = this._serial.then(() => this._current(epoch) ? operation(epoch) : this._stale());
    this._serial = task.catch(() => {});
    this._inflight.set(key, task);
    const release = () => { if (this._inflight.get(key) === task) this._inflight.delete(key); };
    task.then(release, release);
    return task;
  }
  setPlayerId(playerId) {
    if (playerId !== null && !token(playerId)) fail("INVALID_PLAYER_ID");
    if (playerId === this._playerId) return;
    this._epoch++;
    for (const controller of this._controllers) controller.abort();
    this._controllers.clear(); this._inflight.clear(); this._serial = Promise.resolve();
    this._playerId = playerId; this._data = null; this._pending = null; this._serverClock = null;
    this._receipts.clear(); this._prepared = new WeakMap();
    this.loaded = false; this.readPending = true; this.issue = null;
    this.recoveryRaw = ""; this.recoveryKey = null;
    this._notify({ identityChanged: true });
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._epoch++; this._serverClock = null;
    for (const controller of this._controllers) controller.abort();
    this._controllers.clear(); this._inflight.clear(); this._prepared = new WeakMap();
    // Keep the last verified memory copy available for an explicit rescue
    // export. Disposal is not proof that a sent mutation was cancelled.
  }
  _decode(payload, receipt) {
    if (!plain(payload) || Object.keys(payload).some((key) =>
      !["data", "playerId", "revision", "receipt", "changed", "serverNow"].includes(key)) ||
      !Number.isSafeInteger(payload.serverNow) || payload.serverNow < 0 || payload.serverNow > 4102444800000 ||
      !token(payload.playerId) || !Number.isSafeInteger(payload.revision) || payload.revision < 0 ||
      payload.data?.revision !== payload.revision || payload.data?.profileId !== payload.playerId ||
      Object.hasOwn(payload, "changed") && typeof payload.changed !== "boolean" ||
      Object.hasOwn(payload, "receipt") && !plain(payload.receipt) ||
      receipt && typeof payload.receipt?.recorded !== "boolean") fail("INVALID_RESPONSE");
    if (this.playerId !== null && payload.playerId !== this.playerId) fail("PROFILE_CHANGED");
    let data;
    try { data = this.model.validate(payload.data); } catch { fail("INVALID_RESPONSE"); }
    // validate() also supports legacy normalization. A server snapshot must
    // already be canonical; defaults or stripped unknown fields are rejected.
    if (!same(data, payload.data)) fail("INVALID_RESPONSE");
    if (this._data && data.revision === this.revision && !same(data, this._data)) fail("INVALID_RESPONSE");
    const observedAt = this._monotonicNow();
    if (!Number.isFinite(observedAt) || observedAt < 0) fail("INVALID_RESPONSE");
    return { data, playerId: payload.playerId, revision: payload.revision,
      serverNow: payload.serverNow, observedAt,
      ...(receipt ? { receipt: { recorded: payload.receipt.recorded } } : {}),
      ...(typeof payload.changed === "boolean" ? { changed: payload.changed } :
        typeof payload.receipt?.changed === "boolean" ? { changed: payload.receipt.changed } : {}) };
  }
  async _request(path, { body, receipt, epoch }) {
    if (!this._current(epoch)) fail("STALE_REQUEST");
    const mutation = body !== undefined, controller = new AbortController();
    this._controllers.add(controller);
    let timer, onAbort;
    try {
      const stop = new Promise((_, reject) => {
        onAbort = () => reject(Object.assign(new Error("STALE_REQUEST"), { code: "STALE_REQUEST" }));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          reject(Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT", uncertain: mutation }));
          controller.abort();
        }, this.timeoutMs);
      });
      const read = (async () => {
        const options = { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
          redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } };
        // The cookie can change in another tab after this store was loaded.
        // Bind the intent before the server reads or changes that cookie owner.
        if (this.playerId !== null) options.headers["X-Spellwood-Player"] = this.playerId;
        if (mutation) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body ?? {}); }
        let response, payload;
        try { response = await this.fetcher(path, options); }
        catch { fail("NETWORK_ERROR", { uncertain: mutation }); }
        try { payload = await response.json(); }
        catch { fail("INVALID_RESPONSE", { uncertain: mutation }); }
        if (!this._current(epoch)) fail("STALE_REQUEST");
        if (response.ok !== true) {
          const code = plain(payload) && serverCodes.has(payload.code) ? payload.code : "INVALID_RESPONSE";
          fail(code, { uncertain: mutation && (response.status >= 500 || recoverableCodes.has(code)),
            ...(code === "LEGACY_IMPORT_CONFLICT" ? { summary: safeSummary(payload.summary) } : {}) });
        }
        try { return this._decode(payload, receipt); }
        catch (error) { fail(error.code || "INVALID_RESPONSE", { uncertain: mutation }); }
      })();
      return await Promise.race([read, stop]);
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort);
      this._controllers.delete(controller);
    }
  }
  _accept(value) {
    const before = this.revision;
    this._serverClock = { serverNow: value.serverNow, observedAt: value.observedAt, elapsed: 0 };
    if (this.playerId === null) this._playerId = value.playerId;
    // Idempotent replay responses can describe an older commit. They confirm
    // the request, but must not undo a newer read from the same account.
    if (!this._data || value.revision >= before) this._data = value.data;
    this.loaded = true; this.readPending = false;
    return value.changed ?? value.revision > before;
  }
  async _read(epoch, receipt = null) {
    if (!this._current(epoch)) return this._stale();
    this.readPending = true;
    try {
      const value = await this._request(`/api/progress${receipt ? `?receipt=${encodeURIComponent(receipt)}` : ""}`,
        { epoch, receipt });
      if (!this._current(epoch)) return this._stale();
      const changed = this._accept(value);
      if (receipt && !value.receipt.recorded) return this._problem("RECEIPT_PENDING", { receipt: value.receipt });
      if (receipt) this._receipts.delete(receipt);
      if (!this.dirty) this.issue = null;
      this._notify();
      if (!this._current(epoch)) return this._stale();
      return this._result(true, { changed, ...(receipt ? { receipt: value.receipt } : {}) });
    } catch (error) {
      if (!this._current(epoch)) return this._stale();
      return this._problem(error.code || "READ_FAILED");
    }
  }
  async _sendPending(epoch) {
    if (!this._current(epoch)) return this._stale();
    const operation = this._pending;
    if (!operation) return this._result(true);
    try {
      const value = await this._request(operation.path, { body: operation.body, epoch });
      if (!this._current(epoch)) return this._stale();
      this._pending = null;
      const changed = this._accept(value);
      if (!this.dirty) this.issue = null;
      let extra = {};
      if (operation.importEntry) {
        this.recoveryRaw = operation.importEntry.previous;
        this._prepared.delete(operation.importEntry.prepared);
        extra = { restored: true, requiresSessionReset: true, dropsOnlineReceipts: true };
      }
      this._notify(extra);
      if (!this._current(epoch)) return this._stale();
      operation.completed = this._result(true, { changed, ...extra });
      return operation.completed;
    } catch (error) {
      if (!this._current(epoch)) return this._stale();
      if (!error.uncertain) this._pending = null;
      const result = this._problem(error.code || "SERVER_ERROR", { uncertain: !!error.uncertain,
        ...(error.summary ? { summary: error.summary } : {}) });
      if (!error.uncertain) operation.completed = result;
      return result;
    }
  }
  _mutation(path, payload, { key = `${path}:${JSON.stringify(payload)}`, importEntry } = {}) {
    // A caller can click the original action while retry() already owns the
    // queue. That call refers to the outstanding intent, even if retry confirms
    // it before this queued callback starts. Never mint another request id.
    const outstanding = this._pending?.key === key ? this._pending : null;
    return this._enqueue(key, async (epoch) => {
      if (outstanding?.completed) return { ...outstanding.completed, data: this.data, revision: this.revision };
      if (this._pending) {
        if (this._pending.key !== key) return this._result(false, { code: "PROGRESS_UNSYNCED", issue: this.issue });
        return this._sendPending(epoch);
      }
      if (!this.loaded || !this._data || this.readPending || this.issue || this._receipts.size)
        return this._result(false, { code: "PROGRESS_UNAVAILABLE", issue: this.issue });
      this._pending = { key, path, body: { requestId: requestId(), ...clone(payload) }, importEntry };
      this._notify();
      return this._sendPending(epoch);
    });
  }
  load() { return this.retry(); }
  retry() {
    return this._enqueue("retry", async (epoch) => {
      let restored;
      if (this._pending) {
        const result = await this._sendPending(epoch);
        if (!result.ok) return result;
        if (result.restored) restored = { restored: true, requiresSessionReset: true, dropsOnlineReceipts: true };
      }
      for (const receipt of this._receipts) {
        const result = await this._read(epoch, receipt);
        if (!result.ok) return result;
      }
      const result = await this._read(epoch);
      return restored ? { ...result, ...restored } : result;
    });
  }
  /** Inspect current server data without resubmitting an uncertain mutation. */
  refresh() { return this._enqueue("refresh", (epoch) => this._read(epoch)); }
  _receipt(receipt) {
    if (this._disposed) return Promise.resolve(this._stale());
    this._receipts.add(receipt);
    return this._enqueue(`receipt:${receipt}`, (epoch) => this._read(epoch, receipt));
  }
  applyLearning(feedback) {
    if (!token(feedback?.challengeId)) return Promise.resolve(this._result(false, { code: "INVALID_LEARNING" }));
    return this._receipt(`learn:${feedback.challengeId}`);
  }
  addResult(snapshot) {
    if (snapshot?.phase !== "finished" || !token(snapshot.roomId) || ![0, 1].includes(snapshot.youSeat))
      return Promise.resolve(this._result(false, { code: "INVALID_RESULT" }));
    return this._receipt(`result:${snapshot.roomId}:${snapshot.youSeat}`);
  }
  updatePreferences(patch) {
    try { return this._mutation("/api/progress/preferences", { patch: this.model.preferencePatch(patch) }); }
    catch (error) { return Promise.resolve(this._result(false, { code: error.code || "INVALID_PREFERENCES" })); }
  }
  qualifyLearning(challengeId, _clientTiming) {
    if (!token(challengeId)) return Promise.resolve(this._result(false, { code: "INVALID_LEARNING" }));
    return this._mutation("/api/progress/participation", { challengeId });
  }
  openPack(mode = "test") { return this.collectionAction({ kind: "open-pack", mode }); }
  collectionAction(action) {
    try { return this._mutation("/api/progress/collection", { action: collectionIntent(action) }); }
    catch (error) { return Promise.resolve(this._result(false, { code: error.code || "INVALID_COLLECTION_ACTION" })); }
  }
  skinAction(action) {
    try { return this._mutation("/api/progress/skins", { action: skinIntent(action) }); }
    catch (error) { return Promise.resolve(this._result(false, { code: error.code || "INVALID_SKIN_ACTION" })); }
  }
  openSkinPack(mode = "test", count = 1) { return this.skinAction({ kind: "open", mode, count }); }
  revealSkinPack(mode, batchId, index = "all") { return this.skinAction({ kind: "reveal", mode, batchId, index }); }
  closeSkinPack(mode, batchId) { return this.skinAction({ kind: "close", mode, batchId }); }
  redeemSkin(mode, skinId) { return this.skinAction({ kind: "redeem", mode, skinId }); }
  equipSkin(mode, skinId) { return this.skinAction({ kind: "equip", mode, skinId }); }
  prepareImport(input) {
    if (this._disposed || !this.loaded || this.readPending || !this._data) fail("READ_FAILED");
    if (this.dirty || this.issue) fail("PROGRESS_UNSYNCED");
    let raw;
    try { raw = typeof input === "string" ? input : JSON.stringify(input); }
    catch { fail("INVALID_IMPORT"); }
    if (typeof raw !== "string") fail("INVALID_IMPORT");
    if (raw.length > PROGRESS_LIMITS.importCharacters) fail("IMPORT_TOO_LARGE");
    const source = this.model.importLegacy(raw), sourceSchema = JSON.parse(raw).schema;
    const prepared = Object.freeze({ sourceSchema, requiresSessionReset: true, dropsOnlineReceipts: true,
      resetsEarnedRewards: true, importPolicy: "learning-and-display-only", revision: this.revision,
      preview: Object.freeze({ nickname: source.legacy.nickname, grade: source.legacy.grade,
        legacyRecords: source.legacy.records.length, onlineRecords: 0, hasOfflineMatch: !!source.legacy.match,
        learningDays: 0, collectionCopies: [source.collection.test, source.collection.earned].reduce(
          (sum, wallet) => sum + Object.values(wallet.cards).reduce((total, count) => total + count, 0), 0),
        combatRating: 700 }),
      sourceSummary: Object.freeze({ onlineRecords: source.onlineRecords.length,
        learningDays: source.collection.totalDays, combatRating: source.combatRating.rating }),
    });
    this._prepared.set(prepared, { raw, revision: this.revision, playerId: this.playerId,
      epoch: this._epoch, key: `import:${requestId()}`, previous: this.export(), prepared });
    return prepared;
  }
  restore(prepared, expectedRevision) {
    const entry = this._prepared.get(prepared);
    if (!entry || entry.playerId !== this.playerId || entry.epoch !== this._epoch ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision !== entry.revision)
      return Promise.resolve(this._result(false, { code: "INVALID_RESTORE_CONFIRMATION" }));
    if (this._pending?.key !== entry.key && this.revision !== entry.revision)
      return Promise.resolve(this._result(false, { code: "STALE_REVISION" }));
    return this._mutation("/api/progress/legacy-import", { raw: entry.raw, expectedRevision },
      { key: entry.key, importEntry: entry });
  }
  _exportLatest(kind) {
    return this._enqueue(`export:${kind}`, async (epoch) => {
      const result = await this._read(epoch);
      if (!result.ok) return result;
      if (this.dirty) return this._result(false, { code: "PROGRESS_UNSYNCED", issue: this.issue });
      return { ...result, json: JSON.stringify(kind === "legacy" ? this._data.legacy : this._data, null, 2),
        scope: "latest-durable" };
    });
  }
  exportLatest() { return this._exportLatest("complete"); }
  exportLegacyLatest() { return this._exportLatest("legacy"); }
  export() {
    if (!this._data) fail("NO_PROGRESS_TO_EXPORT");
    return JSON.stringify(this._data, null, 2);
  }
  exportLegacy() {
    if (!this._data) fail("NO_PROGRESS_TO_EXPORT");
    return JSON.stringify(this._data.legacy, null, 2);
  }
}
