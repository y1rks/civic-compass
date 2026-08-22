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

// 設問と選択肢を1クエリで引いた結果。列の順序は articles.ts の select に合わせる。
const questionOptionRows = [
  {
    question_id: "energy-2035_q1",
    article_id: "energy-2035",
    question_order: 1,
    prompt: "発電設備が自然環境に与える影響について",
    frame: "care_harm",
    target: "自然環境",
    role: "beneficiary",
    option_id: "energy-2035_q1_uphold",
    option_order: 1,
    stance: "uphold",
    label: "生態系や景観を壊さないことを優先すべきだ",
  },
  {
    question_id: "energy-2035_q1",
    article_id: "energy-2035",
    question_order: 1,
    prompt: "発電設備が自然環境に与える影響について",
    frame: "care_harm",
    target: "自然環境",
    role: "beneficiary",
    option_id: "energy-2035_q1_neutral",
    option_order: 3,
    stance: "neutral",
    label: "特に気にならない",
  },
];

// D1 のモック。記事と設問で別のクエリが走るので、SQL の中身で振り分ける。
function createDbMock(rows, questionRows) {
  return {
    prepare(query) {
      const target = query.includes("article_questions") ? questionRows : rows;
      return {
        bind() {
          return this;
        },
        raw: async () => target.map((row) => Object.values(row)),
      };
    },
  };
}

async function request(path, rows = articleRows, questionRows = questionOptionRows) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request(`http://localhost${path}`), { DB: createDbMock(rows, questionRows) }, {});
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

test("記事一覧APIが記事ごとの設問と選択肢を返す", async () => {
  const response = await request("/api/articles");
  const data = await response.json();
  const [article] = data.articles;

  assert.equal(article.questions.length, 1);
  assert.equal(article.questions[0].id, "energy-2035_q1");
  assert.equal(article.questions[0].prompt, "発電設備が自然環境に与える影響について");
  // 設問はセル（frame × target × role）1つに対応する
  assert.equal(article.questions[0].frame, "care_harm");
  assert.equal(article.questions[0].target, "自然環境");
  assert.equal(article.questions[0].role, "beneficiary");
  // 同じ設問の選択肢は1つの設問にまとめられる
  assert.deepEqual(
    article.questions[0].options.map((option) => option.stance),
    ["uphold", "neutral"],
  );
});

test("設問のない記事は questions が空配列になる", async () => {
  const response = await request("/api/articles", articleRows, []);
  const data = await response.json();

  assert.deepEqual(data.articles[0].questions, []);
});
