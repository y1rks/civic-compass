import assert from "node:assert/strict";
import test from "node:test";
import { withSessionCookie, withSessionDb } from "./session-fixture.mjs";

async function request({ user, cookie = true } = {}) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(
    new Request("http://localhost/api/user", cookie ? withSessionCookie() : undefined),
    { DB: withSessionDb({}, user) },
    {},
  );
}

test("Cookieから解決したユーザーIDと名前を返す", async () => {
  const response = await request({ user: { user_id: "user-123", name: "山田 太郎" } });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data, { user: { user_id: "user-123", name: "山田 太郎" } });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("Cookieがなければ401を返す", async () => {
  const response = await request({ cookie: false });
  assert.equal(response.status, 401);
});

test("Cookieに対応するユーザーが存在しなければ401を返す", async () => {
  const response = await request({ user: null });
  assert.equal(response.status, 401);
});
