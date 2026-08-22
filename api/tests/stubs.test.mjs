import assert from "node:assert/strict";
import test from "node:test";

// 記事1件ぶんの結果は B（/api/perspectives）が返します。ここは政治コンパス画面の
// 総合マッチだけで、C の実装までデモ用の固定値です。
async function request(path, init) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request(`http://localhost${path}`, init), { DB: {} }, {});
}

test("総合マッチAPIが保存記事数に応じたスコアを返す", async () => {
  const response = await request("/api/matches/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleIds: ["energy-2035", "childcare"] }),
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data.matches.map((match) => match.score), [91, 84, 76]);
});
