import assert from "node:assert/strict";
import test from "node:test";
import { withSessionCookie, withSessionDb } from "./session-fixture.mjs";

async function loadApp() {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function createWriteDbMock() {
  const calls = [];
  const db = {
    calls,
    prepare(query) {
      const statement = {
        query,
        params: [],
        bind(...params) {
          statement.params = params;
          calls.push(statement);
          return statement;
        },
      };
      return statement;
    },
    batch: async (statements) => statements.map(() => ({ success: true })),
  };
  return db;
}

test("Cookieがなければ未登録として返す", async () => {
  const app = await loadApp();
  const response = await app.fetch(new Request("http://localhost/api/session"), { DB: {} }, {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("有効なCookieから既存ユーザーを返す", async () => {
  const app = await loadApp();
  const response = await app.fetch(
    new Request("http://localhost/api/session", withSessionCookie()),
    { DB: withSessionDb({}, { user_id: "usr_existing", name: "既存ユーザー" }) },
    {},
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: { user_id: "usr_existing", name: "既存ユーザー" } });
});

test("名前からユーザーとセッションを作り、安全なCookieを発行する", async () => {
  const app = await loadApp();
  const db = createWriteDbMock();
  const response = await app.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "  山田 太郎  " }),
  }), { DB: db }, {});
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.match(data.user.user_id, /^usr_[0-9a-f-]{36}$/);
  assert.equal(data.user.name, "山田 太郎");

  const userInsert = db.calls.find(({ query }) => /INSERT INTO users/i.test(query));
  const sessionInsert = db.calls.find(({ query }) => /INSERT INTO user_sessions/i.test(query));
  assert.ok(userInsert);
  assert.ok(sessionInsert);
  assert.equal(userInsert.params[0], data.user.user_id);
  assert.equal(userInsert.params[1], "山田 太郎");
  assert.equal(userInsert.params[2], `${data.user.user_id}@anonymous.invalid`);
  assert.match(sessionInsert.params[0], /^[0-9a-f]{64}$/);
  assert.equal(sessionInsert.params[1], data.user.user_id);

  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^__Host-civic_session=[0-9a-f]{64}/);
  assert.match(cookie, /Max-Age=31536000/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Priority=High/i);
});

test("空または長すぎる名前を拒否する", async () => {
  const app = await loadApp();
  for (const name of ["   ", "あ".repeat(31), "山田\n太郎"]) {
    const response = await app.fetch(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }), { DB: {} }, {});
    assert.equal(response.status, 400, `name=${JSON.stringify(name)} が通ってしまった`);
  }
});

test("有効なCookieがあればユーザーを重複作成しない", async () => {
  const app = await loadApp();
  const existing = { user_id: "usr_existing", name: "既存ユーザー" };
  const response = await app.fetch(new Request("http://localhost/api/session", withSessionCookie({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "別の名前" }),
  })), { DB: withSessionDb({}, existing) }, {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: existing });
  assert.equal(response.headers.get("set-cookie"), null);
});
