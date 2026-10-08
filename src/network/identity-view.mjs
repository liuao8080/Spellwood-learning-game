import { IdentityError, validateIdentityFields } from "./identity-client.mjs";

let nextPanelId = 0;
const TITLES = { home: "营地身份", register: "为游客创建账号", login: "登录已有账号",
  recover: "用恢复码找回", "recovery-code": "重新生成恢复码", logout: "退出账号", complete: "身份已确认" };
const SUCCESS = { guest: "游客身份已确认", me: "已重新确认当前身份", register: "账号已创建，保留了当前游客身份",
  login: "已登录账号", logout: "已退出账号", recover: "密码已更新，已登录账号", "recovery-code": "新的恢复码已生成，旧码已失效" };

/** Mount separately from the game's render root. Load identity.css with the
 * network entry. client owns cookie-backed state; this view never stores secrets.
 * open()/close()/update(state) are safe across async completions. onClose receives
 * { pending, operation }; closing a pending request does not abort that request.
 */
export class IdentityPanel {
  #document;
  #client;
  #callbacks;
  #unsubscribe;
  #state;
  #lastPlayer;
  #opened = false;
  #disposed = false;
  #mode = "home";
  #cycle = 0;
  #username = "";
  #error = null;
  #recovery = "";
  #success = "";
  #submitting = false;
  #runOperation = null;
  #identityEpoch = 0;
  #returnFocus = null;
  #background = [];
  #suppressEscapeUp = false;
  #id;

  constructor({ client, document: documentObject = globalThis.document,
    onChanged = () => {}, onClose = () => {}, onNotice = () => {} } = {}) {
    if (!client || !documentObject?.body) throw new TypeError("IdentityPanel requires a client and document");
    this.#document = documentObject;
    this.#client = client;
    this.#callbacks = { onChanged, onClose, onNotice };
    this.#state = client.state;
    this.#lastPlayer = client.state.player;
    this.#id = `identity-${++nextPanelId}`;
    this.root = this.#element("div", { className: "identity-root", id: this.#id, hidden: true });
    this.root.addEventListener("keydown", this.#onKeyDown);
    this.root.addEventListener("keyup", (event) => event.stopPropagation());
    this.#document.addEventListener("keyup", this.#onKeyUp, true);
    this.#document.addEventListener("focusin", this.#onFocus, true);
    this.#document.body.appendChild(this.root);
    this.#unsubscribe = client.subscribe((state) => this.update(state));
  }

  get isOpen() { return this.#opened; }

  update(state = this.#client.state) {
    if (this.#disposed || state === this.#state) return;
    this.#state = state;
    this.#error = state.error;
    if (state.player !== this.#lastPlayer) {
      const changedOwner = state.player?.playerId !== this.#lastPlayer?.playerId ||
        state.player?.kind !== this.#lastPlayer?.kind;
      if (changedOwner) {
        // A different tab can replace the cookie while this panel stays open.
        // An in-panel registration may still show its own returned code.
        const ownCompletion = this.#submitting && this.#runOperation === state.operation && state.status === "ready";
        this.#clearSecrets(); this.#success = ""; this.#username = ""; this.#mode = "home";
        if (!ownCompletion) { this.#identityEpoch++; this.#cycle++; }
      }
      this.#lastPlayer = state.player;
      this.#callbacks.onChanged(state.player);
    }
    if (this.#opened) this.#render();
  }

  open() {
    if (this.#disposed || this.#opened) return;
    this.#opened = true;
    this.#cycle += 1;
    this.#state = this.#client.state;
    this.#mode = "home";
    this.#error = this.#state.error;
    this.#returnFocus = this.#document.activeElement;
    this.#background = [...this.#document.body.children].filter((child) => child !== this.root)
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of this.#background) element.inert = true;
    this.#document.body.classList.add("identity-open");
    this.root.hidden = false;
    this.#render(true);
  }

  close() {
    if (!this.#opened) return;
    const pending = this.#busy();
    const operation = this.#state.operation;
    this.#opened = false;
    this.#cycle += 1;
    this.#clearSecrets();
    this.#username = "";
    this.#error = null;
    this.root.replaceChildren();
    this.root.hidden = true;
    this.#document.body.classList.remove("identity-open");
    for (const { element, inert } of this.#background) element.inert = inert;
    this.#background = [];
    if (this.#returnFocus?.isConnected) this.#returnFocus.focus();
    this.#returnFocus = null;
    this.#callbacks.onClose({ pending, operation });
    if (pending) this.#callbacks.onNotice("窗口已收起，操作仍在处理中；完成后会通知你");
  }

  destroy() {
    this.close();
    this.#disposed = true;
    this.#unsubscribe();
    this.#document.removeEventListener("focusin", this.#onFocus, true);
    this.#document.removeEventListener("keyup", this.#onKeyUp, true);
    this.root.remove();
  }

  #busy() { return this.#submitting || this.#state.busy; }

  #element(tag, properties = {}, text) {
    const element = this.#document.createElement(tag);
    for (const [key, value] of Object.entries(properties)) {
      if (key.startsWith("aria-") || key.startsWith("data-") || key === "role") element.setAttribute(key, String(value));
      else element[key] = value;
    }
    if (text !== undefined) element.textContent = text;
    return element;
  }

  #button(text, action, { primary = false, disabled = this.#busy(), id, type = "button" } = {}) {
    const button = this.#element("button", { type, className: `identity-button${primary ? " identity-primary" : ""}`, disabled, id: id || "" }, text);
    if (action) button.addEventListener("click", action);
    return button;
  }

  #paragraph(text, className = "identity-hint") { return this.#element("p", { className }, text); }

  #clearSecretFields() {
    for (const field of this.root.querySelectorAll("input, textarea")) {
      if (field.type === "password" || field.name === "recoveryCode" || field.tagName === "TEXTAREA") field.value = "";
    }
  }

  #clearSecrets() {
    this.#clearSecretFields();
    this.#recovery = "";
  }

  #changeMode(mode) {
    if (this.#busy()) return;
    this.#clearSecrets();
    this.#mode = mode;
    this.#error = null;
    this.#render(true);
  }

  #field(form, name, labelText, { password = false, autocomplete = "off", help, required = true } = {}) {
    const id = `${this.#id}-${name}`;
    const group = this.#element("div", { className: "identity-field" });
    const label = this.#element("label", { htmlFor: id }, labelText);
    const input = this.#element("input", { id, name, type: password ? "password" : "text", autocomplete, required,
      disabled: this.#busy(), spellcheck: false, autocapitalize: "none" });
    if (name === "username") { input.pattern = "[A-Za-z]+"; input.value = this.#username; }
    if (help) {
      input.setAttribute("aria-describedby", `${id}-hint`);
      group.appendChild(label); group.appendChild(input);
      group.appendChild(this.#element("p", { id: `${id}-hint`, className: "identity-field-hint" }, help));
    } else { group.appendChild(label); group.appendChild(input); }
    form.appendChild(group);
    return input;
  }

  #render(focusFirst = false) {
    if (!this.#opened) return;
    const focusId = this.root.contains(this.#document.activeElement) ? this.#document.activeElement.id : null;
    const dialog = this.#element("section", { className: "identity-panel", role: "dialog", "aria-modal": "true",
      "aria-labelledby": `${this.#id}-title`, tabIndex: -1 });
    const header = this.#element("header", { className: "identity-header" });
    const headings = this.#element("div");
    headings.appendChild(this.#paragraph("SPELLWOOD · 森林营地", "identity-eyebrow"));
    headings.appendChild(this.#element("h2", { id: `${this.#id}-title` }, TITLES[this.#mode]));
    header.appendChild(headings);
    header.appendChild(this.#button(this.#busy() ? "收起" : "关闭", () => this.close(), {
      disabled: false, id: `${this.#id}-close` }));
    dialog.appendChild(header);
    const body = this.#element("div", { className: "identity-body", "aria-busy": String(this.#busy()) });
    const player = this.#state.player;
    const badge = this.#element("div", { className: "identity-card" });
    badge.appendChild(this.#element("span", { className: "identity-kind" }, player ? player.kind === "guest" ? "随机游客" : "已登录账号" : "尚未确认身份"));
    badge.appendChild(this.#element("strong", { className: "identity-name" }, player?.name || "等待服务器确认"));
    body.appendChild(badge);

    if (this.#busy()) body.appendChild(this.#paragraph("正在确认操作。收起窗口不会撤销请求；本次恢复码在收起后不会保留。", "identity-status"));
    const error = this.#error;
    if (error) body.appendChild(this.#element("p", { className: "identity-error", role: "alert" }, error.message));
    const needsRecheck = this.#state.uncertain || ["GUEST_SESSION_REQUIRED", "ACCOUNT_SESSION_REQUIRED", "SESSION_REQUIRED", "UNAUTHENTICATED", "RECOVERY_CODE_CHANGED"].includes(error?.code);
    if (needsRecheck) {
      body.appendChild(this.#paragraph(this.#state.uncertain
        ? "上次操作可能已完成。请先重新确认身份，再决定是否重试；我们不会自动重新提交。"
        : "身份或恢复码已变化，请先向服务器重新确认当前身份。"));
      body.appendChild(this.#button("重新确认身份", () => void this.#run("me"), { primary: true }));
    } else if (this.#mode === "complete") {
      body.appendChild(this.#paragraph(this.#success, "identity-success"));
      if (this.#recovery) {
        body.appendChild(this.#paragraph("恢复码只在这里显示一次。你可以自行保存，也可以直接继续。"));
        const label = this.#element("label", { htmlFor: `${this.#id}-recovery` }, "你的恢复码");
        const code = this.#element("textarea", { id: `${this.#id}-recovery`, className: "identity-recovery", readOnly: true,
          rows: 2, spellcheck: false, autocomplete: "off", value: this.#recovery });
        body.appendChild(label); body.appendChild(code);
        body.appendChild(this.#button("选中恢复码", () => { code.focus(); code.select(); }, { disabled: false }));
        body.appendChild(this.#paragraph("选中后使用系统的复制功能。没有邮箱找回；如果密码和恢复码都丢失，不能凭个人问题找回。登录后可用当前密码生成新码。"));
      }
      body.appendChild(this.#button("继续返回营地", () => this.close(), { primary: true, disabled: false }));
    } else if (this.#mode === "home") {
      body.appendChild(this.#paragraph(player?.kind === "account"
        ? "使用用户名和密码，可在其他浏览器登录同一账号。"
        : "游客身份会保存在这个浏览器中。清除网站数据、使用无痕模式或换浏览器后，可能无法回到这位游客。"));
      const actions = this.#element("div", { className: "identity-actions" });
      if (!player) actions.appendChild(this.#button("连接服务器，确认身份", () => void this.#run("guest"), { primary: true }));
      else if (player.kind === "guest") actions.appendChild(this.#button("创建账号，保留此游客", () => this.#changeMode("register"), { primary: true }));
      if (player?.kind !== "account") {
        actions.appendChild(this.#button("登录已有账号", () => this.#changeMode("login")));
        actions.appendChild(this.#button("忘记密码 · 用恢复码找回", () => this.#changeMode("recover")));
      } else {
        actions.appendChild(this.#button("重新生成恢复码", () => this.#changeMode("recovery-code")));
        actions.appendChild(this.#button("退出账号", () => this.#changeMode("logout")));
      }
      body.appendChild(actions);
      body.appendChild(this.#paragraph("账号用于确认你的身份；是否联网保存进度，以当前游戏的保存状态为准。", "identity-footnote"));
    } else if (this.#mode === "logout") {
      body.appendChild(this.#paragraph("退出后会回到登录前尚未绑定账号的游客。如果原游客已经注册成账号，会创建一位新游客。原账号仍可用用户名和密码登录。"));
      body.appendChild(this.#button("确认退出账号", () => void this.#run("logout"), { primary: true }));
    } else this.#renderForm(body);

    if (!["home", "complete"].includes(this.#mode)) body.appendChild(this.#button("返回", () => this.#changeMode("home")));
    dialog.appendChild(body);
    this.#clearSecretFields();
    this.root.replaceChildren(dialog);
    const matching = focusId && this.root.querySelectorAll("button, input, textarea");
    const previous = matching && [...matching].find((element) => element.id === focusId && !element.disabled);
    if (focusFirst) (this.root.querySelector("input") || this.root.querySelector("button") || dialog).focus();
    else if (previous) previous.focus();
    else if (!this.root.contains(this.#document.activeElement)) this.root.querySelector("button")?.focus();
  }

  #renderForm(body) {
    const mode = this.#mode;
    const information = {
      register: "只需英文字母用户名和至少 6 个字符的密码，不需要邮箱。注册会保留当前游客的身份与进度。",
      login: "登录会切换到已有账号。当前未绑定账号的游客会单独保留，退出后可回来。",
      recover: "填写用户名、保存过的恢复码和新密码。成功后会退出此账号的其他登录，并生成新恢复码，旧码随即失效。",
      "recovery-code": "用当前密码确认后生成新恢复码。旧恢复码会立即失效，请按需保存新码。",
    };
    body.appendChild(this.#paragraph(information[mode]));
    const form = this.#element("form", { className: "identity-form", noValidate: true });
    const username = mode !== "recovery-code" && this.#field(form, "username", "用户名", { autocomplete: "username", help: "只用英文字母，大小写均可；一个字母也可以" });
    const recovery = mode === "recover" && this.#field(form, "recoveryCode", "恢复码", { help: "填写你曾保存的完整恢复码" });
    const password = this.#field(form, "password", mode === "recover" ? "新密码" : "密码", {
      password: true, autocomplete: ["register", "recover"].includes(mode) ? "new-password" : "current-password",
      help: "至少 6 个字符，不要求数字、符号或大小写组合" });
    form.appendChild(this.#button(this.#busy() ? "正在确认…" : { register: "创建账号", login: "登录", recover: "更新密码并登录", "recovery-code": "确认生成新码" }[mode], null,
      { primary: true, type: "submit", id: `${this.#id}-submit` }));
    form.addEventListener("submit", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (this.#busy()) return;
      const fields = { username: username ? username.value : undefined, password: password.value,
        recoveryCode: recovery ? recovery.value : undefined };
      this.#username = fields.username || "";
      try { validateIdentityFields(fields, mode); }
      catch (error) {
        this.#error = error;
        this.#clearSecrets(); this.#render();
        const name = error.code.includes("USERNAME") ? "username" : error.code.includes("RECOVERY") ? "recoveryCode" : "password";
        this.root.querySelectorAll("input").forEach((input) => { if (input.name === name) input.focus(); });
        return;
      }
      this.#clearSecrets();
      void this.#run(mode, fields);
    });
    body.appendChild(form);
    if (["register", "recover"].includes(mode)) body.appendChild(this.#paragraph("没有邮箱找回。若密码和恢复码都丢失，不能凭个人问题找回；不保存恢复码也可以继续。", "identity-footnote"));
  }

  async #run(operation, fields) {
    if (this.#busy()) return;
    const cycle = this.#cycle;
    const identityEpoch = this.#identityEpoch;
    this.#submitting = true;
    this.#runOperation = operation;
    this.#error = null;
    this.#clearSecrets();
    this.#render();
    const method = operation === "guest" ? "bootstrap" : operation === "recovery-code" ? "recoveryCode" : operation;
    try {
      const result = await this.#client[method](fields);
      if (result.stale || this.#disposed || identityEpoch !== this.#identityEpoch ||
          result.player?.playerId !== this.#state.player?.playerId || result.player?.kind !== this.#state.player?.kind) return;
      this.#success = SUCCESS[operation];
      if (!this.#opened || cycle !== this.#cycle) {
        this.#callbacks.onNotice(`${this.#success}${result.recoveryCode ? "。恢复码未保留，登录后可用密码重新生成" : ""}`);
        return;
      }
      this.#recovery = result.recoveryCode || "";
      this.#mode = operation === "me" || operation === "guest" ? "home" : "complete";
      this.#username = "";
    } catch (error) {
      const safeError = error instanceof IdentityError ? error : new IdentityError("NETWORK_ERROR");
      if (this.#opened && cycle === this.#cycle) this.#error = safeError;
      else if (!this.#disposed) this.#callbacks.onNotice(safeError.uncertain
        ? "操作结果尚未确认，请打开营地身份重新确认" : safeError.message);
    } finally {
      this.#submitting = false;
      this.#runOperation = null;
      if (this.#opened && !this.#disposed) this.#render();
    }
  }

  #focusable() { return [...this.root.querySelectorAll("button, input, textarea")].filter((element) => !element.disabled && !element.hidden); }

  #onFocus = (event) => {
    if (this.#opened && !this.root.contains(event.target)) this.#focusable()[0]?.focus();
  };

  #onKeyUp = (event) => {
    if (this.#suppressEscapeUp && event.key === "Escape") {
      this.#suppressEscapeUp = false;
      event.stopImmediatePropagation();
    }
  };

  #onKeyDown = (event) => {
    if (!this.#opened) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault(); this.#suppressEscapeUp = true; this.close(); return;
    }
    if (event.key !== "Tab") return;
    const items = this.#focusable();
    const first = items[0], last = items.at(-1), current = this.#document.activeElement;
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (current === first || !items.includes(current))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (current === last || !items.includes(current))) { event.preventDefault(); first.focus(); }
  };
}
