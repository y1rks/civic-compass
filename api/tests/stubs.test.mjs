import assert from "node:assert/strict";
import test from "node:test";

async function request(path, init) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request(`http://localhost${path}`, init), { DB: {} }, {});
}

test("関心情報APIが保存結果のスタブを返す", async () => {
  const response = await request("/api/interests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleId: "energy-2035", comment: "地域との合意形成が気になる" }),
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.interest.articleId, "energy-2035");
  assert.equal(data.interest.comment, "地域との合意形成が気になる");
  assert.equal(data.interest.interested, true);
  assert.ok(!Number.isNaN(Date.parse(data.interest.savedAt)));
});

test("関心情報APIが不正なリクエストを拒否する", async () => {
  const response = await request("/api/interests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleId: "energy-2035", comment: 123 }),
  });

  assert.equal(response.status, 400);
});

test("記事単位の政治家マッチAPIが3人を返す", async () => {
  const response = await request("/api/matches/energy-2035");
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.matches.length, 3);
  assert.equal(data.matches[0].score, 92);
});

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
