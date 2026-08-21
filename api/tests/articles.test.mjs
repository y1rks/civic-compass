import assert from "node:assert/strict";
import test from "node:test";

const articleRows = [
  {
    id: "energy-2035",
    display_order: 1,
    category: "環境・エネルギー",
    title: "再生可能エネルギー、2035年までに電源構成の50%へ",
    summary: "再生可能エネルギーの比率を引き上げる目標案が示されました。",
    body: JSON.stringify(["第1段落です。", "第2段落です。"]),
    image: "https://example.com/energy.jpg",
    source: "civic-compass NEWS",
    published_at: "2時間前",
  },
];

function createDbMock(rows) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        raw: async () => rows.map((row) => Object.values(row)),
      };
    },
  };
}

async function request(path, rows = articleRows) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request(`http://localhost${path}`), { DB: createDbMock(rows) }, {});
}

test("記事一覧APIがD1から取得した記事を画面用の形式で返す", async () => {
  const response = await request("/api/articles");
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(data.articles.length, 1);
  assert.equal(data.articles[0].id, "energy-2035");
  assert.deepEqual(data.articles[0].body, ["第1段落です。", "第2段落です。"]);
  assert.equal("displayOrder" in data.articles[0], false);
  assert.equal("readTime" in data.articles[0], false);
});
