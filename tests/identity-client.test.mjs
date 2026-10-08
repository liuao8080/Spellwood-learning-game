import test from "node:test";
import assert from "node:assert/strict";
import { IdentityClient, validateIdentityFields } from "../src/network/identity-client.mjs";

const player = (name = "CloverFox1234", kind = "guest", id = "player-one") =>
  ({ playerId: id, name, kind, username: kind === "guest" ? null : name, profile: {}, progress: {}, revision: 0 });
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("one-letter username and six simple characters are valid; five and missing fields never fetch", async () => {
  const calls = [];
  const client = new IdentityClient({ fetch: async (...args) => { calls.push(args); return response({ player: player("a", "account"), recoveryCode: "once" }); } });
  await client.register({ username: "a", password: "123456" });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][1].body), { username: "a", password: "123456" });
  for (const [fields, code] of [
    [{ username: "a", password: "12345" }, "PASSWORD_TOO_SHORT"],
    [{ username: "", password: "123456" }, "REQUIRED_USERNAME"],
    [{ username: "a", password: "" }, "REQUIRED_PASSWORD"],
    [{ username: "abc1", password: "123456" }, "INVALID_USERNAME"],
    [{ username: " a", password: "123456" }, "INVALID_USERNAME"],
    [{ username: "森林", password: "123456" }, "INVALID_USERNAME"],
  ]) await assert.rejects(client.register(fields), { code });
  assert.equal(calls.length, 1);
  assert.doesNotThrow(() => validateIdentityFields({ username: "ABC", password: "      " }, "register"));
  assert.doesNotThrow(() => validateIdentityFields({ username: "a", password: "😀😀😀😀😀😀" }, "register"));
  assert.throws(() => validateIdentityFields({ username: "a", password: "😀😀😀" }, "register"), { code: "PASSWORD_TOO_SHORT" });
});

test("fixed same-origin routes use HttpOnly cookie credentials, no redirects or token-bearing state", async () => {
  const calls = [];
  const states = [];
  const client = new IdentityClient({ fetch: async (url, options) => {
    calls.push([url, options]);
    return response({ player: { ...player("Oak", "account"), token: "NO-PUBLIC-TOKEN", passwordHash: "NO-HASH" },
      session: { token: "NO-SESSION" }, recoveryCode: "SHOW-ONCE" });
  } });
  client.subscribe((state) => states.push(state));
  await client.bootstrap(); await client.me();
  const registered = await client.register({ username: "Oak", password: "111111" });
  await client.login({ username: "Oak", password: "111111" }); await client.logout();
  await client.recover({ username: "Oak", password: "222222", recoveryCode: "OLD-CODE" });
  const rotated = await client.recoveryCode({ password: "222222" });
  assert.deepEqual(calls.map(([url]) => url), ["guest", "me", "register", "login", "logout", "recover", "recovery-code"].map((path) => `/api/identity/${path}`));
  for (const [url, options] of calls) {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.method, url.endsWith("/me") ? "GET" : "POST");
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal(registered.recoveryCode, "SHOW-ONCE");
  assert.equal(rotated.recoveryCode, "SHOW-ONCE");
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { password: "222222" });
  assert.doesNotMatch(JSON.stringify(states), /SHOW-ONCE|NO-PUBLIC-TOKEN|NO-HASH|NO-SESSION|111111|222222|OLD-CODE/);
});

test("server name conflicts and wrong password remain errors without changing the current guest", async () => {
  const replies = [response({ player: player() }), response({ error: "USERNAME_TAKEN" }, 409), response({ error: { code: "INVALID_CREDENTIALS" } }, 401)];
  const client = new IdentityClient({ fetch: async () => replies.shift() });
  await client.bootstrap();
  const original = client.player;
  await assert.rejects(client.register({ username: "Oak", password: "123456" }), { code: "USERNAME_TAKEN", uncertain: false });
  await assert.rejects(client.login({ username: "Oak", password: "123456" }), { code: "INVALID_CREDENTIALS", uncertain: false });
  assert.equal(client.player, original);
  assert.equal(client.state.busy, false);
});

test("bootstrap and logout send explicit empty JSON; me omits a body and content type", async () => {
  const calls = [];
  const client = new IdentityClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    return response({ player: player() });
  } });
  await client.bootstrap();
  await client.logout();
  await client.me();
  assert.deepEqual(calls.map(({ url }) => url), ["/api/identity/guest", "/api/identity/logout", "/api/identity/me"]);
  for (const { options } of calls.slice(0, 2)) {
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.body, "{}");
  }
  assert.equal(calls[2].options.method, "GET");
  assert.equal(Object.hasOwn(calls[2].options, "body"), false);
  assert.equal(Object.hasOwn(calls[2].options.headers, "Content-Type"), false);
});

test("duplicate mutation returns one request and blocks other identity changes until it settles", async () => {
  const gate = deferred(); let calls = 0;
  const client = new IdentityClient({ fetch: () => { calls++; return gate.promise; } });
  const fields = { username: "a", password: "123456" };
  const first = client.register(fields), duplicate = client.register(fields);
  assert.equal(first, duplicate);
  await assert.rejects(client.login(fields), { code: "REQUEST_PENDING" });
  await assert.rejects(client.me(), { code: "REQUEST_PENDING" });
  await tick(); assert.equal(calls, 1);
  gate.resolve(response({ player: player("a", "account") }));
  await first; assert.equal(client.state.busy, false);
});

test("late older reads cannot overwrite newer state or clear the newer busy state", async () => {
  const first = deferred(), second = deferred(), replies = [first, second];
  const client = new IdentityClient({ fetch: () => replies.shift().promise });
  const older = client.me(), newer = client.me();
  first.resolve(response({ player: player("Old", "account", "old") }));
  const oldResult = await older;
  assert.equal(oldResult.stale, true);
  assert.equal(client.player, null);
  assert.equal(client.state.busy, true);
  second.resolve(response({ player: player("New", "account", "new") }));
  await newer;
  assert.equal(client.player.playerId, "new");
  assert.equal(client.state.busy, false);
});

test("an older me response after login cannot restore a guest", async () => {
  const gate = deferred();
  const client = new IdentityClient({ fetch: (url) => url.endsWith("/me") ? gate.promise : Promise.resolve(response({ player: player("Oak", "account") })) });
  const old = client.me();
  await client.login({ username: "Oak", password: "123456" });
  gate.resolve(response({ player: player() }));
  assert.equal((await old).stale, true);
  assert.equal(client.player.kind, "account");
});

test("network failure never invents an identity and uncertain mutation requires a read before retry", async () => {
  let calls = 0;
  const client = new IdentityClient({ fetch: async () => { calls++; if (calls === 1) throw new Error("SECRET transport detail"); return response({ player: null }); } });
  await assert.rejects(client.register({ username: "a", password: "123456" }), { code: "NETWORK_ERROR", uncertain: true });
  assert.equal(client.player, null);
  assert.doesNotMatch(client.state.error.message, /SECRET/);
  await assert.rejects(client.register({ username: "a", password: "123456" }), { code: "VERIFY_REQUIRED" });
  assert.equal(calls, 1);
  await client.me();
  assert.equal(client.state.uncertain, false);
  assert.equal(client.player, null);
});

test("mutation timeout is unknown, does not retry, and its eventual reply cannot overwrite a later me", async () => {
  const gate = deferred(); let calls = 0;
  const client = new IdentityClient({ timeoutMs: 15, fetch: async (url) => { calls++; return url.endsWith("/register") ? gate.promise : response({ player: player("Current", "account", "current") }); } });
  await assert.rejects(client.register({ username: "a", password: "123456" }), { code: "TIMEOUT", uncertain: true });
  assert.equal(calls, 1);
  await client.me();
  gate.resolve(response({ player: player("Stale", "account", "stale"), recoveryCode: "LATE-SECRET" }));
  await tick();
  assert.equal(client.player.playerId, "current");
  assert.equal(client.state.uncertain, false);
  assert.equal(calls, 2);
});

test("unreadable success and 503 mutations are uncertain; recovery and rotation never auto-retry", async () => {
  for (const reply of [response({ nope: true }), response({ error: "PASSWORD_BUSY" }, 503)]) {
    let calls = 0;
    const client = new IdentityClient({ fetch: async () => { calls++; return reply; } });
    await assert.rejects(client.recover({ username: "a", password: "123456", recoveryCode: "CODE" }), { uncertain: true });
    assert.equal(calls, 1);
    assert.equal(client.player, null);
  }
  let calls = 0;
  const client = new IdentityClient({ fetch: async () => { calls++; return response({ error: "RECOVERY_CODE_CHANGED" }, 409); } });
  await assert.rejects(client.recoveryCode({ password: "123456" }), { code: "RECOVERY_CODE_CHANGED", uncertain: false });
  assert.equal(calls, 1);
});

test("unknown backend text is never echoed and a failed read does not invent a logout", async () => {
  let calls = 0;
  const client = new IdentityClient({ fetch: async () => ++calls === 1 ? response({ player: player("a", "account") }) : response({ error: "password=SECRET\n<script>" }, 429) });
  await client.bootstrap();
  await assert.rejects(client.me(), { code: "RATE_LIMITED" });
  assert.equal(client.player.kind, "account");
  assert.doesNotMatch(client.state.error.message, /SECRET|script/);
});
