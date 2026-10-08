import test from "node:test";
import assert from "node:assert/strict";
import { IdentityClient } from "../src/network/identity-client.mjs";
import { IdentityPanel } from "../src/network/identity-view.mjs";

// Small DOM/event boundary model for the real component. These tests cover
// lifecycle, secrets, request handling and focus contracts, not rendered pixels,
// native autofill, mobile keyboards or the browser accessibility tree.
function dom() {
  const listeners = new Map();
  const document = { activeElement: null };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.listeners = new Map(); this.attrs = {}; this.id = ""; this.value = "";
      this.hidden = false; this.disabled = false; this.inert = false; this._text = "";
      this.classes = new Set();
      this.classList = { add: (v) => this.classes.add(v), remove: (v) => this.classes.delete(v), contains: (v) => this.classes.has(v) };
    }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(" "); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    replaceChildren(...children) {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      for (const child of this.children) child.parentElement = null;
      this.children = []; this._text = "";
      for (const child of children) this.appendChild(child);
    }
    set textContent(text) { this.replaceChildren(); this._text = String(text); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    contains(other) { return this === other || this.children.some((child) => child.contains(other)); }
    get isConnected() { return document.body.contains(this); }
    matches(selector) {
      return selector.split(",").some((part) => {
        const value = part.trim();
        if (value.startsWith("#")) return this.id === value.slice(1);
        if (value.startsWith(".")) return this.classes.has(value.slice(1));
        const attribute = value.match(/^\[([^=]+)="([^"]*)"\]$/);
        if (attribute) return this.attrs[attribute[1]] === attribute[2];
        return this.tagName.toLowerCase() === value;
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== callback)); }
    focus() { if (this.isConnected && !this.disabled) document.activeElement = this; }
    select() { this.selected = true; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
    dispatch(type, extra = {}) {
      const event = { target: this, key: "", shiftKey: false, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; this.immediate = true; }, ...extra };
      for (const entry of listeners.get(type) || []) if (entry.capture) { entry.callback(event); if (event.immediate) break; }
      let current = this;
      while (current && !event.stopped) {
        for (const callback of current.listeners.get(type) || []) callback(event);
        current = current.parentElement;
      }
      if (!event.stopped) for (const entry of listeners.get(type) || []) if (!entry.capture) entry.callback(event);
      return event;
    }
  }
  document.createElement = (tag) => new Element(tag);
  document.body = new Element("body"); document.activeElement = document.body;
  document.addEventListener = (type, callback, capture = false) => {
    if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ callback, capture });
  };
  document.removeEventListener = (type, callback) => listeners.set(type, (listeners.get(type) || []).filter((entry) => entry.callback !== callback));
  return document;
}

const player = (kind = "guest", name = "MapleOwl5678") => ({ playerId: "same-player", name, kind, username: kind === "account" ? name : null });
const reply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function setup(fetcher = async () => reply({ player: player() })) {
  const document = dom();
  const opener = document.createElement("button"); opener.textContent = "营地身份";
  const previouslyInert = document.createElement("aside"); previouslyInert.inert = true;
  document.body.appendChild(opener); document.body.appendChild(previouslyInert); opener.focus();
  let fetch = fetcher;
  const client = new IdentityClient({ fetch: (...args) => fetch(...args) });
  await client.bootstrap();
  const changed = [], notices = [], closed = [];
  const panel = new IdentityPanel({ client, document, onChanged: (value) => changed.push(value), onNotice: (value) => notices.push(value), onClose: (value) => closed.push(value) });
  const button = (label) => panel.root.querySelectorAll("button").find((node) => node.textContent === label);
  const field = (name) => panel.root.querySelectorAll("input").find((node) => node.name === name);
  const click = (label) => { const node = button(label); assert.ok(node, `Button ${label} exists`); if (!node.disabled) node.dispatch("click"); return node; };
  const submit = (fields) => {
    for (const [name, value] of Object.entries(fields)) { assert.ok(field(name), `Field ${name} exists`); field(name).value = value; }
    return panel.root.querySelector("form").dispatch("submit");
  };
  return { document, opener, previouslyInert, client, panel, changed, notices, closed, button, field, click, submit,
    setFetch: (next) => { fetch = next; } };
}

test("open shows the real guest, mounts outside game roots and restores focus/inert on Escape", async () => {
  const h = await setup();
  h.panel.open();
  assert.match(h.panel.root.textContent, /随机游客.*MapleOwl5678/);
  assert.equal(h.panel.root.parentElement, h.document.body);
  assert.equal(h.opener.inert, true);
  assert.equal(h.panel.root.querySelector("section").getAttribute("aria-modal"), "true");
  let backgroundKeys = 0;
  h.document.addEventListener("keydown", () => backgroundKeys++);
  h.document.addEventListener("keyup", () => backgroundKeys++);
  const close = h.button("关闭");
  close.dispatch("keydown", { key: "1" }); close.dispatch("keyup", { key: "1" });
  const escape = close.dispatch("keydown", { key: "Escape" });
  h.opener.dispatch("keyup", { key: "Escape" });
  assert.equal(escape.prevented, true);
  assert.equal(backgroundKeys, 0);
  assert.equal(h.panel.isOpen, false);
  assert.equal(h.document.activeElement, h.opener);
  assert.equal(h.opener.inert, false);
  assert.equal(h.previouslyInert.inert, true);
  assert.equal(h.panel.root.children.length, 0);
  h.panel.destroy();
});

test("Tab wraps in both directions and stray focus returns inside", async () => {
  const h = await setup(); h.panel.open();
  const buttons = h.panel.root.querySelectorAll("button");
  buttons[0].focus();
  assert.equal(buttons[0].dispatch("keydown", { key: "Tab", shiftKey: true }).prevented, true);
  assert.equal(h.document.activeElement, buttons.at(-1));
  assert.equal(buttons.at(-1).dispatch("keydown", { key: "Tab" }).prevented, true);
  assert.equal(h.document.activeElement, buttons[0]);
  h.opener.focus(); h.opener.dispatch("focusin");
  assert.equal(h.document.activeElement, buttons[0]);
  h.panel.destroy();
});

test("forms are progressively shown with labels, password types and matching autocomplete", async () => {
  const h = await setup(); h.panel.open();
  assert.equal(h.panel.root.querySelector("form"), null);
  h.click("创建账号，保留此游客");
  assert.equal(h.panel.root.querySelectorAll("form").length, 1);
  assert.equal(h.field("username").autocomplete, "username");
  assert.equal(h.field("username").pattern, "[A-Za-z]+");
  assert.equal(h.field("username").minLength, undefined);
  assert.equal(h.field("password").type, "password");
  assert.equal(h.field("password").autocomplete, "new-password");
  for (const field of h.panel.root.querySelectorAll("input")) {
    assert.ok(field.required);
    assert.ok(h.panel.root.querySelectorAll("label").some((label) => label.htmlFor === field.id));
  }
  h.field("password").value = "PRIVATE-PASSWORD";
  const oldPassword = h.field("password");
  h.panel.update();
  assert.equal(h.field("password"), oldPassword, "repeated app renders must not replace an unchanged form");
  assert.equal(h.field("password").value, "PRIVATE-PASSWORD");
  h.click("返回");
  assert.equal(oldPassword.value, "");
  h.click("登录已有账号");
  assert.equal(h.field("password").autocomplete, "current-password");
  h.click("返回"); h.click("忘记密码 · 用恢复码找回");
  assert.equal(h.field("recoveryCode").autocomplete, "off");
  assert.equal(h.field("password").autocomplete, "new-password");
  h.panel.destroy();
});

test("five characters and missing fields block submission; six simple characters and one-letter name submit once", async () => {
  const h = await setup(); const gate = defer(); let calls = 0, sent;
  h.setFetch((url, options) => { calls++; sent = JSON.parse(options.body); return gate.promise; });
  h.panel.open(); h.click("创建账号，保留此游客");
  h.submit({ username: "a", password: "12345" });
  assert.equal(calls, 0); assert.match(h.panel.root.textContent, /至少需要 6 个字符/);
  h.submit({ username: "", password: "123456" });
  assert.equal(calls, 0); assert.match(h.panel.root.textContent, /请填写用户名/);
  h.submit({ username: "a", password: "123456" });
  const disabled = h.panel.root.querySelectorAll("button").find((button) => button.type === "submit");
  assert.equal(disabled.disabled, true);
  h.panel.root.querySelector("form").dispatch("submit");
  await tick(); assert.equal(calls, 1); assert.deepEqual(sent, { username: "a", password: "123456" });
  gate.resolve(reply({ player: player("account", "a"), recoveryCode: "ONLY-ONCE-SECRET" }));
  await tick();
  assert.equal(h.changed.length, 1); assert.equal(h.changed[0].playerId, "same-player");
  assert.equal(h.panel.root.querySelector("input"), null);
  assert.equal(h.panel.root.querySelector("textarea").value, "ONLY-ONCE-SECRET");
  h.click("选中恢复码"); assert.equal(h.panel.root.querySelector("textarea").selected, true);
  const recovery = h.panel.root.querySelector("textarea");
  h.click("继续返回营地");
  assert.equal(recovery.value, "");
  h.panel.open();
  assert.equal(h.panel.root.querySelector("textarea"), null);
  assert.doesNotMatch(JSON.stringify(h.client.state), /ONLY-ONCE-SECRET|123456/);
  h.panel.destroy();
});

test("server conflicts and incorrect password produce concise errors without a fake account", async () => {
  const h = await setup(); h.panel.open(); h.click("创建账号，保留此游客");
  h.setFetch(async () => reply({ error: "USERNAME_TAKEN" }, 409));
  h.submit({ username: "Oak", password: "123456" }); await tick();
  assert.match(h.panel.root.textContent, /用户名已有人使用/);
  assert.equal(h.field("password").value, "");
  assert.equal(h.client.player.kind, "guest");
  h.click("返回"); h.click("登录已有账号");
  assert.doesNotMatch(h.panel.root.textContent, /用户名已有人使用/);
  h.setFetch(async () => reply({ error: "INVALID_CREDENTIALS" }, 401));
  h.submit({ username: "Oak", password: "123456" }); await tick();
  assert.match(h.panel.root.textContent, /用户名或密码不正确/);
  assert.equal(h.changed.length, 0);
  h.panel.destroy();
});

test("closing a pending registration clears secrets but completion still updates identity and reports its real outcome", async () => {
  const h = await setup(); const gate = defer();
  h.setFetch(() => gate.promise); h.panel.open(); h.click("创建账号，保留此游客");
  const password = h.field("password");
  h.submit({ username: "Oak", password: "secret" });
  h.click("收起");
  assert.equal(password.value, ""); assert.equal(h.closed[0].pending, true);
  assert.match(h.notices[0], /仍在处理中/);
  h.panel.open(); // Reopening does not allow the old request to reveal its code.
  gate.resolve(reply({ player: player("account", "Oak"), recoveryCode: "DISCARDED-SECRET" }));
  await tick();
  assert.equal(h.client.player.kind, "account");
  assert.equal(h.changed.length, 1);
  assert.equal(h.panel.root.querySelector("textarea"), null);
  assert.match(h.notices.at(-1), /账号已创建.*恢复码未保留/);
  assert.doesNotMatch(h.notices.join(" "), /DISCARDED-SECRET|secret/);
  h.panel.destroy();
});

test("an unreachable backend asks to verify, keeps the guest and never automatically resubmits", async () => {
  const h = await setup(); let calls = 0;
  h.setFetch(async () => { calls++; throw new Error("network down"); });
  h.panel.open(); h.click("创建账号，保留此游客");
  h.submit({ username: "Oak", password: "123456" }); await tick();
  assert.equal(calls, 1);
  assert.equal(h.client.player.kind, "guest");
  assert.match(h.panel.root.textContent, /可能已完成/);
  assert.ok(h.button("重新确认身份"));
  assert.equal(h.panel.root.querySelector("form"), null);
  h.setFetch(async () => reply({ player: player("account", "Oak") }));
  h.click("重新确认身份"); await tick();
  assert.equal(h.client.player.kind, "account");
  assert.ok(h.button("退出账号"));
  h.panel.destroy();
});

test("a code can be regenerated after closing its first display with password confirmation and no clipboard call", async () => {
  const h = await setup(async () => reply({ player: player("account", "Oak") }));
  let body, url;
  h.setFetch(async (path, options) => { url = path; body = JSON.parse(options.body); return reply({ player: player("account", "Oak"), recoveryCode: "NEW-CODE" }); });
  h.panel.open(); h.click("重新生成恢复码");
  assert.equal(h.field("username"), undefined);
  assert.equal(h.field("password").autocomplete, "current-password");
  assert.match(h.panel.root.textContent, /旧恢复码会立即失效/);
  h.submit({ password: "123456" }); await tick();
  assert.equal(url, "/api/identity/recovery-code");
  assert.deepEqual(body, { password: "123456" });
  assert.equal(h.panel.root.querySelector("textarea").value, "NEW-CODE");
  h.panel.destroy();
});

test("expired account prompts an actionable identity refresh then allows a new guest", async () => {
  const h = await setup(async () => reply({ player: player("account", "Oak") }));
  h.setFetch(async () => reply({ code: "ACCOUNT_SESSION_REQUIRED" }, 401));
  h.panel.open(); h.click("重新生成恢复码");
  h.submit({ password: "123456" }); await tick();
  assert.ok(h.button("重新确认身份"));
  h.setFetch(async () => reply({ player: null }));
  h.click("重新确认身份"); await tick();
  assert.ok(h.button("连接服务器，确认身份"));
  assert.equal(h.client.player, null);
  h.panel.destroy();
});

test("logout explains the original guest/new guest split and uses the actual returned identity", async () => {
  const h = await setup(async () => reply({ player: player("account", "Oak") }));
  let path;
  h.setFetch(async (url) => { path = url; return reply({ player: { ...player(), playerId: "original-guest" } }); });
  h.panel.open(); h.click("退出账号");
  assert.match(h.panel.root.textContent, /尚未绑定账号的游客/);
  assert.match(h.panel.root.textContent, /创建一位新游客/);
  h.click("确认退出账号"); await tick();
  assert.equal(path, "/api/identity/logout");
  assert.equal(h.changed[0].playerId, "original-guest");
  h.panel.destroy();
});

test("an external identity change wipes an already displayed recovery code and success state", async () => {
  const h = await setup(async () => reply({ player: player("account", "Oak") }));
  h.panel.open(); h.click("重新生成恢复码");
  h.setFetch(async () => reply({ player: player("account", "Oak"), recoveryCode: "SYNTHETIC-RECOVERY" }));
  h.submit({ password: "123456" }); await tick();
  const oldField = h.panel.root.querySelector("textarea");
  assert.ok(oldField); assert.equal(oldField.value, "SYNTHETIC-RECOVERY");
  h.setFetch(async () => reply({ player: { ...player(), playerId: "replacement-guest" } }));
  await h.client.me();
  assert.equal(oldField.value, "", "even the detached field must be cleared");
  assert.equal(h.panel.root.querySelector("textarea"), null);
  assert.doesNotMatch(h.panel.root.textContent, /新的恢复码已生成/);
  assert.ok(h.button("创建账号，保留此游客"));
  h.panel.destroy();
});

test("an old recovery completion cannot restore secrets after a newer identity update", async () => {
  const h = await setup(async () => reply({ player: player("account", "Oak") }));
  const gate = defer();
  // Hold the presentation's call completion independently of state publication.
  h.client.recoveryCode = () => gate.promise;
  h.panel.open(); h.click("重新生成恢复码"); h.submit({ password: "123456" });
  h.setFetch(async () => reply({ player: { ...player(), playerId: "replacement-guest" } }));
  await h.client.me();
  gate.resolve({ player: player("account", "Oak"), recoveryCode: "STALE-SYNTHETIC-RECOVERY" });
  await tick();
  assert.equal(h.panel.root.querySelector("textarea"), null);
  assert.doesNotMatch(h.panel.root.textContent, /新的恢复码已生成/);
  assert.ok(h.button("创建账号，保留此游客"));
  h.panel.destroy();
});
