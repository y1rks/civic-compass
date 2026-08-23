import assert from "node:assert/strict";
import test from "node:test";

function createDbMock(row) {
  return {
    prepare(query) {
      assert.match(query, /SELECT user_id, name FROM users/);
      return {
        bind(userId) {
          assert.equal(userId, "test_user1");
          return this;
        },
        first: async () => row,
      };
    },
  };
}

async function request(row) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request("http://localhost/api/user"), { DB: createDbMock(row) }, {});
}

test("現在のユーザーIDと名前をD1から返す", async () => {
  const response = await request({ user_id: "test_user1", name: "山田 太郎" });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data, { user: { user_id: "test_user1", name: "山田 太郎" } });
});

test("現在のユーザーがusersテーブルに存在しなければ404を返す", async () => {
  const response = await request(null);
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.message, "User not found");
});
