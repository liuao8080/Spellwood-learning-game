const MESSAGES = Object.freeze({
  REQUIRED_USERNAME: "请填写用户名",
  INVALID_USERNAME: "用户名只能使用英文字母",
  REQUIRED_PASSWORD: "请填写密码",
  INVALID_PASSWORD: "密码包含无法读取的字符，请重新输入",
  PASSWORD_TOO_SHORT: "密码至少需要 6 个字符",
  PASSWORD_TOO_LARGE: "密码太长，请缩短后重试",
  USERNAME_TAKEN: "这个用户名已有人使用，换一个试试",
  INVALID_CREDENTIALS: "用户名或密码不正确",
  REQUIRED_RECOVERY: "请填写恢复码",
  INVALID_RECOVERY: "用户名或恢复码不正确",
  GUEST_SESSION_REQUIRED: "游客身份已变化，请重新确认身份",
  ACCOUNT_SESSION_REQUIRED: "账号登录已过期，请重新确认身份",
  RECOVERY_CODE_CHANGED: "恢复码已在另一处更新，请重新确认后再试",
  SESSION_REQUIRED: "身份已过期，请重新确认身份",
  UNAUTHENTICATED: "身份已过期，请重新确认身份",
  ALREADY_REGISTERED: "当前已是账号，请先退出再创建新账号",
  REQUEST_PENDING: "上一项操作还在处理中，请稍等",
  VERIFY_REQUIRED: "上次操作结果尚未确认，请先重新确认身份",
  PASSWORD_BUSY: "服务器正忙，请稍后重试",
  RATE_LIMITED: "操作有些频繁，请稍后再试",
  RATE_LIMIT: "操作有些频繁，请稍后再试",
  NETWORK_ERROR: "暂时连不上服务器，请稍后重试",
  TIMEOUT: "服务器还没有回复，请稍后重新确认身份",
  INVALID_RESPONSE: "暂时无法读取服务器回复，请稍后重试",
  SERVER_ERROR: "服务器暂时不可用，请稍后重试",
});

export class IdentityError extends Error {
  constructor(code, { uncertain = false } = {}) {
    super(MESSAGES[code] || "这次操作未能完成，请稍后重试");
    this.name = "IdentityError";
    this.code = code;
    this.uncertain = uncertain;
  }
}

/** The same rules as the server: letters only, one letter is valid; no password
 * trimming or character-class rules. Count Unicode code points, not UTF-16 units. */
export function validateIdentityFields({ username, password, recoveryCode }, operation) {
  if (operation !== "recovery-code") {
    if (typeof username !== "string" || !username) throw new IdentityError("REQUIRED_USERNAME");
    if (!/^[A-Za-z]+$/.test(username)) throw new IdentityError("INVALID_USERNAME");
  }
  if (typeof password !== "string" || !password) throw new IdentityError("REQUIRED_PASSWORD");
  if (password.isWellFormed && !password.isWellFormed()) throw new IdentityError("INVALID_PASSWORD");
  if ([...password].length < 6) throw new IdentityError("PASSWORD_TOO_SHORT");
  if (operation === "recover" && (typeof recoveryCode !== "string" || !recoveryCode))
    throw new IdentityError("REQUIRED_RECOVERY");
}

function publicPlayer(value, allowNull = false) {
  if (value === null && allowNull) return null;
  if (!value || typeof value.playerId !== "string" || !value.playerId ||
      typeof value.name !== "string" || !["guest", "account"].includes(value.kind))
    throw new IdentityError("INVALID_RESPONSE");
  // Copy only the public contract. Tokens, cookies and response envelopes never
  // become client state, even if an endpoint accidentally includes extra fields.
  const player = { playerId: value.playerId, kind: value.kind, name: value.name,
    username: value.kind === "account" ? value.username ?? value.name : null };
  for (const key of ["createdAt", "profile", "progress", "revision", "updatedAt"])
    if (Object.hasOwn(value, key)) player[key] = value[key];
  return Object.freeze(player);
}

/** Cookie-only, same-origin identity transport. No storage or automatic retries.
 * Mutation calls are single-flight. Reads can supersede older reads; old replies
 * cannot publish state. A timeout is an unknown outcome, never a cancellation.
 * After an unknown mutation outcome, me() must confirm identity before retrying.
 */
export class IdentityClient {
  #fetch;
  #timeoutMs;
  #listeners = new Set();
  #sequence = 0;
  #pending = null;
  #state = Object.freeze({ player: null, status: "idle", busy: false,
    operation: null, error: null, uncertain: false });

  constructor({ fetch: fetcher = globalThis.fetch?.bind(globalThis), timeoutMs = 15000 } = {}) {
    if (typeof fetcher !== "function") throw new TypeError("IdentityClient requires fetch");
    this.#fetch = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  get state() { return this.#state; }
  get player() { return this.#state.player; }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(patch) {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) {
      // Presentation failures cannot turn a completed registration into an error.
      try { listener(this.#state); } catch {}
    }
  }

  bootstrap() { return this.#request("guest"); }
  me() { return this.#request("me"); }
  register(fields) { return this.#submit("register", fields); }
  login(fields) { return this.#submit("login", fields); }
  logout() { return this.#request("logout"); }
  recover(fields) { return this.#submit("recover", fields); }
  recoveryCode(fields) { return this.#submit("recovery-code", fields); }

  #submit(operation, fields = {}) {
    try { validateIdentityFields(fields, operation); }
    catch (error) { return Promise.reject(error); }
    const body = { password: fields.password };
    if (operation !== "recovery-code") body.username = fields.username;
    if (operation === "recover") body.recoveryCode = fields.recoveryCode;
    return this.#request(operation, body);
  }

  #request(operation, body) {
    const mutation = operation !== "me";
    if (this.#pending)
      return this.#pending.operation === operation ? this.#pending.promise : Promise.reject(new IdentityError("REQUEST_PENDING"));
    if (mutation && this.#state.uncertain) return Promise.reject(new IdentityError("VERIFY_REQUIRED", { uncertain: true }));
    const sequence = ++this.#sequence;
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new IdentityError("TIMEOUT", { uncertain: mutation }));
          }, this.#timeoutMs);
        });
        const request = (async () => {
          const options = { method: mutation ? "POST" : "GET", credentials: "same-origin",
            cache: "no-store", redirect: "error", signal: controller.signal,
            headers: { Accept: "application/json" } };
          if (mutation) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body ?? {});
          }
          let response;
          try { response = await this.#fetch(`/api/identity/${operation}`, options); }
          catch { throw new IdentityError("NETWORK_ERROR", { uncertain: mutation }); }
          let payload;
          try { payload = await response.json(); }
          catch { throw new IdentityError("INVALID_RESPONSE", { uncertain: mutation }); }
          if (!response.ok) {
            const suppliedCode = payload?.code ?? payload?.error?.code ?? payload?.error;
            const code = typeof suppliedCode === "string" && Object.hasOwn(MESSAGES, suppliedCode)
              ? suppliedCode : response.status === 429 ? "RATE_LIMITED" : "SERVER_ERROR";
            throw new IdentityError(code, { uncertain: mutation && response.status >= 500 });
          }
          let player;
          try { player = publicPlayer(payload?.player, operation === "me" || operation === "logout"); }
          catch { throw new IdentityError("INVALID_RESPONSE", { uncertain: mutation }); }
          const result = { player };
          // Recovery codes travel only to this call's consumer, never subscribers.
          if (["register", "recover", "recovery-code"].includes(operation) && typeof payload.recoveryCode === "string")
            result.recoveryCode = payload.recoveryCode;
          return result;
        })();
        const result = await Promise.race([request, timeout]);
        if (sequence === this.#sequence)
          this.#publish({ player: result.player, status: "ready", error: null, uncertain: false });
        return { ...result, stale: sequence !== this.#sequence };
      } catch (failure) {
        const error = failure instanceof IdentityError ? failure : new IdentityError("NETWORK_ERROR", { uncertain: mutation });
        if (sequence === this.#sequence)
          this.#publish({ status: "error", error, uncertain: this.#state.uncertain || error.uncertain });
        throw error;
      } finally {
        clearTimeout(timer);
        if (this.#pending?.promise === promise) this.#pending = null;
        if (sequence === this.#sequence) this.#publish({ busy: false, operation: null });
      }
    });
    if (mutation) this.#pending = { operation, promise };
    this.#publish({ busy: true, operation, status: "loading", error: null });
    return promise;
  }
}
