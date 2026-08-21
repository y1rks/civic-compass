import assert from "node:assert/strict";
import test from "node:test";

async function request(path) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request(`http://localhost${path}`), { DB: {} }, {});
}

test("記事一覧APIが画面表示用のスタブを返す", async () => {
  const response = await request("/api/articles");
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(data.articles.length, 8);
  assert.equal(data.articles[0].id, "energy-2035");
  assert.ok(data.articles.every((article) => Array.isArray(article.body)));
});
