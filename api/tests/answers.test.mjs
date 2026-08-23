// 「この記事への意見」の保存API。D1 をモックし、投げた SQL とパラメータを検証します。
import assert from "node:assert/strict";
import test from "node:test";
import { withSessionCookie, withSessionDb } from "./session-fixture.mjs";

// article_questions の1行ぶん。articles.ts の select と同じ列順です。
const questionRows = [
  ["energy-2035_q1", "energy-2035", 1, "発電設備が自然環境に与える影響について", "care_harm", "自然環境", "beneficiary", 0.7, 0.9],
  ["energy-2035_q2", "energy-2035", 2, "電気料金への影響について", "efficiency_utility", "国民全体", "beneficiary", 0.7, 0.9],
];

// 保存後にプロファイルを集計するときの SELECT が返す行。
// 列の順序は user-profile.ts の select に合わせる。
// （interest, answerId, stance, frame, target, role, intensity, confidence）
const selectionRows = [
  [1, "ans1", "override", "care_harm", "自然環境", "beneficiary", 0.7, 0.9],
  [1, "ans1", "uphold", "efficiency_utility", "国民全体", "beneficiary", 0.7, 0.9],
];

function createDbMock(rows = questionRows, selections = selectionRows) {
  const calls = [];
  const db = {
    calls,
    prepare(query) {
      // 設問の取得とプロファイル集計で別のクエリが走るので、SQL の中身で振り分ける
      const isProfileQuery = /select/i.test(query) && query.includes("answer_selections");
      const statement = {
        query,
        params: [],
        bind(...params) {
          statement.params = params;
          calls.push({ query, params });
          return statement;
        },
        raw: async () => (isProfileQuery ? selections : rows).map((row) => [...row]),
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
      };
      return statement;
    },
    batch: async (statements) => statements.map(() => ({ success: true })),
  };
  return db;
}

/** KV のモック。put された内容をそのまま持っておく。 */
function createKvMock() {
  const store = new Map();
  return {
    store,
    put: async (key, value) => { store.set(key, value); },
    get: async (key) => store.get(key) ?? null,
  };
}

async function post(
  body,
  db = createDbMock(),
  kv = createKvMock(),
  user = { user_id: "test_user1", name: "テストユーザー" },
) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: app } = await import(workerUrl.href);

  const response = await app.fetch(
    new Request("http://localhost/api/answers", withSessionCookie({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })),
    { DB: withSessionDb(db, user), USER_PROFILES: kv },
    {},
  );
  return { response, db, kv };
}

const valid = {
  articleId: "energy-2035",
  interest: 1,
  comment: "電気代が上がるのは困る",
  selections: { "energy-2035_q1": "override", "energy-2035_q2": "uphold" },
};

test("意見を保存すると保存内容が返る", async () => {
  const { response } = await post(valid);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.answer.articleId, "energy-2035");
  assert.equal(data.answer.interest, 1);
  assert.equal(data.answer.comment, "電気代が上がるのは困る");
  assert.deepEqual(data.answer.selections, valid.selections);
  assert.ok(!Number.isNaN(Date.parse(data.answer.savedAt)));
});

test("セルはクライアントの申告ではなく article_questions の値を保存する", async () => {
  const { db } = await post({
    ...valid,
    // 送りつけても無視されること
    selections: { "energy-2035_q1": "override", "energy-2035_q2": "uphold" },
    frame: "sovereignty",
    target: "外国人・移民",
    role: "threat",
  });

  const insert = db.calls.find((call) => /insert into .?answer_selections/i.test(call.query));
  assert.ok(insert, "answer_selections への INSERT が無い");
  assert.ok(insert.params.includes("care_harm"), "設問側の frame が保存されていない");
  assert.ok(insert.params.includes("efficiency_utility"));
  assert.ok(!insert.params.includes("sovereignty"), "クライアントが送った frame が混入している");
  assert.ok(!insert.params.includes("threat"), "クライアントが送った role が混入している");
});

test("ユーザーはサーバー側で決まる（クライアントの user_id を受け付けない）", async () => {
  const { db } = await post({ ...valid, userId: "someone_else" });

  const insert = db.calls.find((call) => /insert into .?answers/i.test(call.query));
  assert.ok(insert.params.includes("test_user1"));
  assert.ok(!insert.params.includes("someone_else"));
});

test("未回答の設問があると拒否する", async () => {
  const { response } = await post({ ...valid, selections: { "energy-2035_q1": "uphold" } });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(data.unanswered, ["energy-2035_q2"]);
});

test("他の記事の設問が混ざっていると拒否する", async () => {
  const { response } = await post({
    ...valid,
    selections: { ...valid.selections, "care_q1": "uphold" },
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(data.strayIds, ["care_q1"]);
});

test("未定義の stance を拒否する", async () => {
  const { response } = await post({
    ...valid,
    selections: { "energy-2035_q1": "agree", "energy-2035_q2": "uphold" },
  });

  assert.equal(response.status, 400);
});

test("interest が 0〜1 の外なら拒否する", async () => {
  for (const interest of [-0.1, 1.5, "1", Number.NaN]) {
    const { response } = await post({ ...valid, interest });
    assert.equal(response.status, 400, `interest=${String(interest)} が通ってしまった`);
  }
});

test("設問のない記事IDは 404", async () => {
  const { response } = await post(valid, createDbMock([]));
  assert.equal(response.status, 404);
});

test("コメントは省略できるが、長すぎると拒否する", async () => {
  const { comment: _comment, ...withoutComment } = valid;
  assert.equal((await post(withoutComment)).response.status, 200);
  assert.equal((await post({ ...valid, comment: "あ".repeat(161) })).response.status, 400);
});

test("保存するとユーザープロファイルが KV に書かれる", async () => {
  const { kv } = await post(valid);

  const raw = await kv.get("profile:user:test_user1");
  assert.ok(raw, "profile:user:test_user1 が書かれていない");

  const profile = JSON.parse(raw);
  assert.equal(profile.user_id, "test_user1");
  // uphold と override が1つずつ。どちらもセルになる
  assert.equal(profile.cells.length, 2);
  assert.deepEqual(
    profile.cells.map((c) => `${c.frame}|${c.target}|${c.role}`).sort(),
    ["care_harm|自然環境|beneficiary", "efficiency_utility|国民全体|beneficiary"],
  );
  // 議員側にしかない指標はユーザー側では持たない
  assert.ok(profile.cells.every((c) => !("distinctiveness" in c)));
});

test("CookieのユーザーごとにD1回答とUSER_PROFILESを分離する", async () => {
  const db = createDbMock();
  const kv = createKvMock();
  const user = { user_id: "usr_browser_b", name: "ユーザーB" };
  await post(valid, db, kv, user);

  const insert = db.calls.find((call) => /insert into .?answers/i.test(call.query));
  assert.ok(insert.params.includes("usr_browser_b"));
  assert.ok(!insert.params.includes("test_user1"));
  assert.ok(await kv.get("profile:user:usr_browser_b"));
  assert.equal(await kv.get("profile:user:test_user1"), null);
});

test("「関心がない」で保存すると cells ではなく declined_cells に入る", async () => {
  const declinedRows = selectionRows.map((row) => [0, ...row.slice(1)]);
  const { kv } = await post({ ...valid, interest: 0 }, createDbMock(questionRows, declinedRows));
  const profile = JSON.parse(await kv.get("profile:user:test_user1"));

  assert.deepEqual(profile.cells, []);
  assert.equal(profile.declined_cells.length, 2);
});

test("KV への書き込みが失敗しても保存自体は成功する", async () => {
  const failing = { put: async () => { throw new Error("KV unavailable"); }, get: async () => null };
  const { response } = await post(valid, createDbMock(), failing);

  // プロファイルは D1 から作り直せる派生データなので、ここで 500 にはしない
  assert.equal(response.status, 200);
});
